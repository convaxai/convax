import { getCanvasNodeSize } from "./document"
import type { CanvasDocument, CanvasNode, CanvasPoint } from "./types"
import type { CanvasViewport } from "./view"

export interface CanvasViewportInsets {
  bottom?: number
  left?: number
  right?: number
  top?: number
}

export interface CanvasViewportRect {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
}

export interface CanvasNodeWorldRect {
  bottom: number
  left: number
  right: number
  top: number
}

export interface CanvasPostMutationRevealGuard {
  documentId: string
  navigationRevision: number
  scopeId: string
  viewId: string
}

export const CANVAS_POST_MUTATION_REVEAL = {
  maxZoom: 1.2,
  padding: 0.2,
} as const

export function resolveCanvasSafeViewportRect(
  bounds: { height: number; width: number },
  insets: CanvasViewportInsets = {},
): CanvasViewportRect | undefined {
  if (
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return undefined
  }
  const left = normalizeInset(insets.left, bounds.width)
  const rightInset = normalizeInset(insets.right, bounds.width)
  const top = normalizeInset(insets.top, bounds.height)
  const bottomInset = normalizeInset(insets.bottom, bounds.height)
  const right = Math.max(left, bounds.width - rightInset)
  const bottom = Math.max(top, bounds.height - bottomInset)
  if (right <= left || bottom <= top) return undefined
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  }
}

export function resolveCanvasVisibleWorldRect(input: {
  safeRect: CanvasViewportRect
  viewport: CanvasViewport
}): CanvasViewportRect | undefined {
  if (
    !Number.isFinite(input.viewport.x) ||
    !Number.isFinite(input.viewport.y) ||
    !Number.isFinite(input.viewport.zoom) ||
    input.viewport.zoom <= 0
  ) {
    return undefined
  }
  const left = (input.safeRect.left - input.viewport.x) / input.viewport.zoom
  const right = (input.safeRect.right - input.viewport.x) / input.viewport.zoom
  const top = (input.safeRect.top - input.viewport.y) / input.viewport.zoom
  const bottom = (input.safeRect.bottom - input.viewport.y) / input.viewport.zoom
  if (![bottom, left, right, top].every(Number.isFinite) || right <= left || bottom <= top) return undefined
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  }
}

export function resolveCanvasAnchoredZoomViewport(input: {
  anchor: CanvasPoint
  targetZoom: number
  viewport: CanvasViewport
}): CanvasViewport | undefined {
  if (
    !isFinitePoint(input.anchor) ||
    !Number.isFinite(input.targetZoom) ||
    input.targetZoom <= 0 ||
    !Number.isFinite(input.viewport.zoom) ||
    input.viewport.zoom <= 0
  ) {
    return undefined
  }
  const worldX = (input.anchor.x - input.viewport.x) / input.viewport.zoom
  const worldY = (input.anchor.y - input.viewport.y) / input.viewport.zoom
  return {
    x: input.anchor.x - worldX * input.targetZoom,
    y: input.anchor.y - worldY * input.targetZoom,
    zoom: input.targetZoom,
  }
}

export function isCanvasPostMutationRevealGuardCurrent(
  guard: CanvasPostMutationRevealGuard,
  current: CanvasPostMutationRevealGuard,
) {
  return (
    guard.documentId === current.documentId &&
    guard.navigationRevision === current.navigationRevision &&
    guard.scopeId === current.scopeId &&
    guard.viewId === current.viewId
  )
}

/**
 * Decides whether a post-commit reveal is necessary from authoritative document
 * geometry. Missing ids never cause a broad fit, and already-safe nodes leave the
 * user's camera untouched.
 */
export function shouldRevealCanvasNodes(input: {
  document: Readonly<CanvasDocument>
  nodeIds: readonly string[]
  safeRect: CanvasViewportRect
  viewport: CanvasViewport
}) {
  const bounds = resolveCanvasNodeWorldBounds(input.document, input.nodeIds)
  if (!bounds) return false
  const screen = {
    bottom: bounds.bottom * input.viewport.zoom + input.viewport.y,
    left: bounds.left * input.viewport.zoom + input.viewport.x,
    right: bounds.right * input.viewport.zoom + input.viewport.x,
    top: bounds.top * input.viewport.zoom + input.viewport.y,
  }
  return (
    screen.left < input.safeRect.left ||
    screen.right > input.safeRect.right ||
    screen.top < input.safeRect.top ||
    screen.bottom > input.safeRect.bottom
  )
}

export function resolveCanvasFocusAvoidanceViewport(input: {
  document: Readonly<CanvasDocument>
  nodeIds: readonly string[]
  safeRect: CanvasViewportRect
  viewport: CanvasViewport
}): CanvasViewport | undefined {
  const bounds = resolveCanvasNodeWorldBounds(input.document, input.nodeIds)
  if (!bounds) return undefined
  const screen = {
    bottom: bounds.bottom * input.viewport.zoom + input.viewport.y,
    left: bounds.left * input.viewport.zoom + input.viewport.x,
    right: bounds.right * input.viewport.zoom + input.viewport.x,
    top: bounds.top * input.viewport.zoom + input.viewport.y,
  }
  const x = avoidanceDelta(screen.left, screen.right, input.safeRect.left, input.safeRect.right)
  const y = avoidanceDelta(screen.top, screen.bottom, input.safeRect.top, input.safeRect.bottom)
  if (x === 0 && y === 0) return undefined
  return { ...input.viewport, x: input.viewport.x + x, y: input.viewport.y + y }
}

export function resolveCanvasNodeWorldBounds(
  document: Readonly<CanvasDocument>,
  nodeIds: readonly string[],
): CanvasNodeWorldRect | undefined {
  return resolveCanvasWorldBounds(resolveCanvasNodeWorldRects(document), nodeIds)
}

export function resolveCanvasNodeWorldRects(
  document: Readonly<CanvasDocument>,
): ReadonlyMap<string, CanvasNodeWorldRect> {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const positionCache = new Map<string, CanvasPoint>()
  const result = new Map<string, CanvasNodeWorldRect>()
  for (const node of document.nodes) {
    const position = resolveWorldPosition(node, nodeById, positionCache)
    if (!position) continue
    const size = getCanvasNodeSize(node)
    if (size.width <= 0 || size.height <= 0) continue
    result.set(node.id, {
      bottom: position.y + size.height,
      left: position.x,
      right: position.x + size.width,
      top: position.y,
    })
  }
  return result
}

export function resolveCanvasWorldBounds(
  rects: ReadonlyMap<string, CanvasNodeWorldRect>,
  nodeIds: readonly string[],
): CanvasNodeWorldRect | undefined {
  let result: CanvasNodeWorldRect | undefined
  for (const nodeId of new Set(nodeIds)) {
    const bounds = rects.get(nodeId)
    if (!bounds) continue
    result = result
      ? {
          bottom: Math.max(result.bottom, bounds.bottom),
          left: Math.min(result.left, bounds.left),
          right: Math.max(result.right, bounds.right),
          top: Math.min(result.top, bounds.top),
        }
      : bounds
  }
  return result
}

function resolveWorldPosition(
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
    const parentCached = cache.get(current.id)
    if (parentCached) {
      origin = parentCached
      break
    }
    chain.push(current)
    current = current.parentId ? nodeById.get(current.parentId) : undefined
  }
  while (chain.length > 0) {
    const entry = chain.pop()!
    origin = { x: origin.x + entry.position.x, y: origin.y + entry.position.y }
    cache.set(entry.id, origin)
  }
  return cache.get(node.id)
}

/**
 * One-time per mounted scope: mark initialization even for an empty document so
 * the first later mutation cannot replay the initial whole-document fit.
 */
export function resolveInitialCanvasCameraFit(input: {
  initializedScope: string
  nodeCount: number
  scope: string
}): "skip" | "mark-only" | "mark-and-fit" {
  if (input.initializedScope === input.scope) return "skip"
  return input.nodeCount > 0 ? "mark-and-fit" : "mark-only"
}

/** True while a started camera motion generation remains the latest owner. */
export function isCanvasCameraMotionCurrent(started: number, current: number) {
  return started === current
}

function isFinitePoint(point: CanvasPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function normalizeInset(value: number | undefined, maximum: number) {
  return Number.isFinite(value) && value! > 0 ? Math.min(value!, maximum) : 0
}

function avoidanceDelta(start: number, end: number, safeStart: number, safeEnd: number) {
  const span = end - start
  const safeSpan = safeEnd - safeStart
  if (span > safeSpan) return (safeStart + safeEnd - start - end) / 2
  if (start < safeStart) return safeStart - start
  if (end > safeEnd) return safeEnd - end
  return 0
}
