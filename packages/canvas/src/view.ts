import { getCanvasNodePresentationSize } from "./document"
import type { CanvasDocument, CanvasNode, CanvasPoint } from "./types"

export * from "./optimistic-overlay"
export * from "./optimistic-overlay-plans"
export * from "./visual-history"

export const CANVAS_VIEW_MIN_ZOOM = 0.15
export const CANVAS_VIEW_MAX_ZOOM = 2.5

export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

export interface CanvasFitViewportBounds {
  height: number
  left?: number
  maxZoom?: number
  minZoom?: number
  top?: number
  width: number
}

export interface CanvasFitViewportOptions {
  /** Limit the fit to these nodes. Missing and duplicate ids are ignored. An empty list fits the whole document. */
  nodeIds?: readonly string[]
  /** Fractional padding on each side of the fitted bounds. */
  padding?: number
  /** Per-request zoom ceiling, further bounded by the viewport ceiling. */
  maxZoom?: number
}

export interface CanvasFitTargetResolution {
  explicit: boolean
  foundNodeIds: string[]
  missingNodeIds: string[]
}

export type CanvasDocumentFitEffect =
  | { kind: "none" }
  | { kind: "renderer-fallback"; maxZoom?: number; nodeIds?: string[]; padding: number }
  | { kind: "viewport"; viewport: CanvasViewport }

/** Empty and omitted target lists both mean the complete Canvas document. */
export function resolveCanvasFitTargetNodeIds(
  document: Readonly<CanvasDocument>,
  requestedNodeIds?: readonly string[],
): CanvasFitTargetResolution {
  const explicit = Boolean(requestedNodeIds?.length)
  const candidates = explicit ? requestedNodeIds! : document.nodes.map((node) => node.id)
  const existing = new Set(document.nodes.map((node) => node.id))
  const foundNodeIds: string[] = []
  const missingNodeIds: string[] = []
  const seen = new Set<string>()
  for (const nodeId of candidates) {
    if (seen.has(nodeId)) continue
    seen.add(nodeId)
    if (existing.has(nodeId)) foundNodeIds.push(nodeId)
    else missingNodeIds.push(nodeId)
  }
  return { explicit, foundNodeIds, missingNodeIds }
}

/**
 * Resolves the renderer effect without reading mounted node geometry. An absent
 * host bounds object is reserved for static-render fallback; an invalid or
 * zero-sized mounted host deliberately produces no view movement.
 */
export function resolveCanvasDocumentFitEffect({
  bounds,
  document,
  maxZoom,
  nodeIds,
  padding = 0,
}: CanvasFitViewportOptions & {
  bounds?: CanvasFitViewportBounds
  document: Readonly<CanvasDocument>
}): CanvasDocumentFitEffect {
  if (!bounds) {
    return {
      kind: "renderer-fallback",
      maxZoom,
      padding,
      ...(nodeIds?.length ? { nodeIds: [...nodeIds] } : {}),
    }
  }
  const viewport = resolveCanvasFitViewport({ bounds, document, maxZoom, nodeIds, padding })
  return viewport ? { kind: "viewport", viewport } : { kind: "none" }
}

interface CanvasViewRect {
  maxX: number
  maxY: number
  minX: number
  minY: number
}

/**
 * Resolves a viewport entirely from persisted Canvas geometry. This deliberately
 * does not depend on mounted renderer nodes, measurements, or DOM timing.
 */
export function resolveCanvasFitViewport({
  bounds,
  document,
  maxZoom,
  nodeIds,
  padding = 0,
}: CanvasFitViewportOptions & {
  bounds: CanvasFitViewportBounds
  document: Readonly<CanvasDocument>
}): CanvasViewport | undefined {
  if (
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    (bounds.left !== undefined && !Number.isFinite(bounds.left)) ||
    (bounds.top !== undefined && !Number.isFinite(bounds.top)) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    !isCanvasFitZoomLimit(bounds.minZoom) ||
    !isCanvasFitZoomLimit(bounds.maxZoom) ||
    !isCanvasFitZoomLimit(maxZoom) ||
    !Number.isFinite(padding) ||
    padding < 0
  ) {
    return undefined
  }
  const effectiveMaxZoom =
    maxZoom === undefined ? bounds.maxZoom : bounds.maxZoom === undefined ? maxZoom : Math.min(maxZoom, bounds.maxZoom)
  if (bounds.minZoom !== undefined && effectiveMaxZoom !== undefined && effectiveMaxZoom < bounds.minZoom) {
    return undefined
  }

  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const worldPositionById = new Map<string, CanvasPoint>()
  const targetIds = nodeIds?.length ? nodeIds : document.nodes.map((node) => node.id)
  const seen = new Set<string>()
  let targetBounds: CanvasViewRect | undefined

  for (const nodeId of targetIds) {
    if (seen.has(nodeId)) continue
    seen.add(nodeId)
    const node = nodeById.get(nodeId)
    if (!node) continue
    const position = getCanvasNodeWorldPosition(node, nodeById, worldPositionById)
    const size = getCanvasNodePresentationSize(node)
    if (
      !position ||
      !Number.isFinite(size.width) ||
      !Number.isFinite(size.height) ||
      size.width <= 0 ||
      size.height <= 0
    ) {
      continue
    }
    const nodeBounds = {
      maxX: position.x + size.width,
      maxY: position.y + size.height,
      minX: position.x,
      minY: position.y,
    }
    targetBounds = targetBounds ? unionCanvasViewRects(targetBounds, nodeBounds) : nodeBounds
  }

  if (!targetBounds) return undefined
  const width = Math.max(targetBounds.maxX - targetBounds.minX, 1)
  const height = Math.max(targetBounds.maxY - targetBounds.minY, 1)
  const paddingScale = 1 + padding * 2
  const rawZoom = Math.min(bounds.width / (width * paddingScale), bounds.height / (height * paddingScale))
  const zoom = clampCanvasFitZoom(rawZoom, bounds.minZoom, effectiveMaxZoom)
  const centerX = (targetBounds.minX + targetBounds.maxX) / 2
  const centerY = (targetBounds.minY + targetBounds.maxY) / 2
  return {
    x: (bounds.left ?? 0) + bounds.width / 2 - centerX * zoom,
    y: (bounds.top ?? 0) + bounds.height / 2 - centerY * zoom,
    zoom,
  }
}

function getCanvasNodeWorldPosition(
  node: CanvasNode,
  nodeById: ReadonlyMap<string, CanvasNode>,
  cache: Map<string, CanvasPoint>,
): CanvasPoint | undefined {
  const cached = cache.get(node.id)
  if (cached) return cached
  const chain: CanvasNode[] = []
  const visited = new Set<string>()
  let current: CanvasNode | undefined = node
  let origin: CanvasPoint = { x: 0, y: 0 }

  while (current) {
    if (visited.has(current.id)) return undefined
    visited.add(current.id)
    const currentCached = cache.get(current.id)
    if (currentCached) {
      origin = currentCached
      break
    }
    if (!Number.isFinite(current.position.x) || !Number.isFinite(current.position.y)) return undefined
    chain.push(current)
    if (!current.parentId) break
    current = nodeById.get(current.parentId)
    if (!current) return undefined
  }

  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const item = chain[index]!
    origin = { x: origin.x + item.position.x, y: origin.y + item.position.y }
    cache.set(item.id, origin)
  }
  return cache.get(node.id)
}

function unionCanvasViewRects(left: CanvasViewRect, right: CanvasViewRect): CanvasViewRect {
  return {
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
  }
}

function clampCanvasFitZoom(zoom: number, minZoom?: number, maxZoom?: number) {
  let result = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  if (typeof minZoom === "number" && Number.isFinite(minZoom)) result = Math.max(result, minZoom)
  if (typeof maxZoom === "number" && Number.isFinite(maxZoom)) result = Math.min(result, maxZoom)
  return result
}

function isCanvasFitZoomLimit(value: number | undefined) {
  return value === undefined || (Number.isFinite(value) && value > 0)
}

export interface CanvasViewSnapshot {
  documentId: string
  focusedGroupId?: string | null
  scopeId: string
  selectedEdgeIds: string[]
  selectedNodeIds: string[]
  viewId: string
  viewport: CanvasViewport
}

export type CanvasViewCommand =
  | {
      type: "nodes.reveal"
      animation?: "instant" | "smooth"
      fit?: "center" | "contain" | "none"
      nodeIds: readonly string[]
      select?: boolean
    }
  | { type: "notification.show"; description?: string; kind: "error" | "info" | "success" | "warning"; title: string }
  | { type: "selection.clear" }
  | { type: "selection.set"; edgeIds?: readonly string[]; nodeIds?: readonly string[] }
  | {
      type: "viewport.center"
      animation?: "instant" | "smooth"
      position: CanvasPoint
      zoom?: number
    }
  | {
      type: "viewport.fit"
      animation?: "instant" | "smooth"
      maxZoom?: number
      nodeIds?: readonly string[]
      padding?: number
    }
  | { type: "viewport.zoom"; animation?: "instant" | "smooth"; zoom: number }

export interface CanvasViewCommandResult {
  foundNodeIds: string[]
  missingNodeIds: string[]
  snapshot: CanvasViewSnapshot
}

export interface CanvasViewExecutionGuard {
  expectedDocumentId: string
  expectedScopeId: string
}

export interface CanvasViewSession {
  execute(command: CanvasViewCommand, guard?: CanvasViewExecutionGuard): Promise<CanvasViewCommandResult>
  getSnapshot(): CanvasViewSnapshot
  whenReady(): Promise<void>
  readonly viewId: string
}

export interface CanvasViewCommandRequest extends CanvasViewExecutionGuard {
  command: CanvasViewCommand
  viewId: string
}

export interface CanvasViewRegistry {
  execute(input: CanvasViewCommandRequest): Promise<CanvasViewCommandResult>
  list(): CanvasViewSnapshot[]
  register(session: CanvasViewSession): () => void
  subscribe(listener: () => void): () => void
}

export class CanvasViewNotFoundError extends Error {
  constructor(viewId: string) {
    super(`Canvas view was not found: ${viewId}`)
    this.name = "CanvasViewNotFoundError"
  }
}

export class CanvasViewDocumentMismatchError extends Error {
  readonly actualDocumentId: string
  readonly expectedDocumentId: string

  constructor(expectedDocumentId: string, actualDocumentId: string) {
    super(`Canvas view document changed: expected ${expectedDocumentId}, received ${actualDocumentId}`)
    this.name = "CanvasViewDocumentMismatchError"
    this.expectedDocumentId = expectedDocumentId
    this.actualDocumentId = actualDocumentId
  }
}

export class CanvasViewScopeMismatchError extends Error {
  readonly actualScopeId: string
  readonly expectedScopeId: string

  constructor(expectedScopeId: string, actualScopeId: string) {
    super(`Canvas view scope changed: expected ${expectedScopeId}, received ${actualScopeId}`)
    this.name = "CanvasViewScopeMismatchError"
    this.expectedScopeId = expectedScopeId
    this.actualScopeId = actualScopeId
  }
}

export function assertCanvasViewGuard(snapshot: CanvasViewSnapshot, guard: CanvasViewExecutionGuard) {
  if (snapshot.documentId !== guard.expectedDocumentId) {
    throw new CanvasViewDocumentMismatchError(guard.expectedDocumentId, snapshot.documentId)
  }
  if (snapshot.scopeId !== guard.expectedScopeId) {
    throw new CanvasViewScopeMismatchError(guard.expectedScopeId, snapshot.scopeId)
  }
}

export function createCanvasViewRegistry(): CanvasViewRegistry {
  const sessions = new Map<string, CanvasViewSession>()
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((listener) => listener())

  return {
    async execute(input) {
      const session = sessions.get(input.viewId)
      if (!session) throw new CanvasViewNotFoundError(input.viewId)
      await session.whenReady()
      const snapshot = session.getSnapshot()
      assertCanvasViewGuard(snapshot, input)
      return session.execute(input.command, input)
    },
    list() {
      return [...sessions.values()].map((session) => session.getSnapshot())
    },
    register(session) {
      const existing = sessions.get(session.viewId)
      if (existing && existing !== session) throw new Error(`Canvas view is already registered: ${session.viewId}`)
      sessions.set(session.viewId, session)
      emit()
      return () => {
        if (sessions.get(session.viewId) !== session) return
        sessions.delete(session.viewId)
        emit()
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
