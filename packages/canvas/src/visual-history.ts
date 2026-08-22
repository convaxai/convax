import { getCanvasNodePresentationSize } from "./document"
import { CanvasOptimisticOverlayCoordinator } from "./optimistic-overlay"
import {
  createCanvasConnectionGhost,
  createCanvasHideEntityOverlay,
  createCanvasReplacePresentationOverlay,
} from "./optimistic-overlay-plans"
import type { CanvasGhostNode, CanvasOptimisticOverlayItem, CanvasOptimisticOperationToken } from "./optimistic-overlay"
import type { CanvasDocument, CanvasNode } from "./types"
import type { CanvasRendererCommand } from "./collaboration/session"

export interface CanvasVisualHistoryAuthority {
  readonly document: CanvasDocument
  readonly edgeEntities: readonly Readonly<{
    readonly edgeId: string
    readonly entity: Readonly<{ readonly id: string; readonly incarnation: string; readonly kind: "edge" }>
  }>[]
  readonly nodeEntities: readonly Readonly<{
    readonly nodeId: string
    readonly entity: Readonly<{ readonly id: string; readonly incarnation: string; readonly kind: "node" }>
  }>[]
}

export interface CanvasVisualHistoryTransition {
  readonly direction: "undo" | "redo"
  readonly rootOperationId: string
}

interface CanvasVisualHistoryEntry {
  readonly entryKey: string
  rootOperationId: string
  provisional: boolean
  before: CanvasVisualHistoryAuthority | null
  after: CanvasVisualHistoryAuthority | null
}

export interface CanvasVisualHistoryPrediction {
  readonly direction: "undo" | "redo"
  readonly entryKey: string
  readonly token: CanvasOptimisticOperationToken
}

/** Bounded visual cursor; Main's session undo coordinator remains authoritative. */
export class CanvasVisualHistoryCoordinator {
  readonly overlay = new CanvasOptimisticOverlayCoordinator()
  readonly #entries: CanvasVisualHistoryEntry[] = []
  readonly #pending: CanvasVisualHistoryPrediction[] = []
  readonly #maximumEntries: number
  #cursor = 0

  constructor(maximumEntries = 64) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
      throw new TypeError("Canvas visual history capacity is invalid")
    }
    this.#maximumEntries = maximumEntries
  }

  record(rootOperationId: string, before: CanvasVisualHistoryAuthority, after: CanvasVisualHistoryAuthority): void {
    if (!rootOperationId) return
    if (this.#pending.length > 0) this.reset()
    this.#entries.splice(this.#cursor)
    this.#entries.push({
      entryKey: `committed:${rootOperationId}`,
      rootOperationId,
      provisional: false,
      before: retainAuthority(before),
      after: retainAuthority(after),
    })
    while (this.#entries.length > this.#maximumEntries) this.#entries.shift()
    this.#cursor = this.#entries.length
  }

  /**
   * Installs an immediate visual root for a typed renderer geometry command.
   * The command id is only a session-local correlation key; Main later binds
   * the entry to the durable semantic root returned by the authority.
   */
  stageRendererCommand(
    commandId: string,
    command: CanvasRendererCommand,
    current: CanvasVisualHistoryAuthority,
  ): string | null {
    if (!commandId || command.kind !== "canvas.nodes.set-geometry") return null
    const before = this.#authorityAtCursor(current)
    if (!before) return null
    const after = applyRendererGeometryPresentation(before, command)
    return after ? this.#stageAuthority(commandId, before, after) : null
  }

  /**
   * Reserves one ordered visual-history root without executing a business
   * command in Renderer. Main later supplies the exact before/after authority.
   */
  stagePendingRoot(commandId: string, current: CanvasVisualHistoryAuthority): string | null {
    if (!commandId) return null
    const before = this.#authorityAtCursor(current)
    return this.#stageAuthority(commandId, before, null)
  }

  bindStagedRoot(
    entryKey: string,
    rootOperationId: string,
    actualBefore: CanvasVisualHistoryAuthority,
    actualAfter?: CanvasVisualHistoryAuthority,
  ): boolean {
    const entry = this.#entries.find((candidate) => candidate.entryKey === entryKey)
    if (!entry || !entry.provisional || !rootOperationId) return false
    entry.rootOperationId = rootOperationId
    entry.provisional = false
    entry.before = retainAuthority(actualBefore)
    entry.after = actualAfter ? retainAuthority(actualAfter) : null
    this.#refreshPendingPredictions(entry)
    return true
  }

  rejectStagedRoot(entryKey: string | null): void {
    if (!entryKey) return
    const index = this.#entries.findIndex((entry) => entry.entryKey === entryKey)
    if (index < 0) return
    const removedKeys = new Set(this.#entries.slice(index).map((entry) => entry.entryKey))
    for (let pendingIndex = this.#pending.length - 1; pendingIndex >= 0; pendingIndex -= 1) {
      const prediction = this.#pending[pendingIndex]
      if (!removedKeys.has(prediction.entryKey)) continue
      this.overlay.settle(prediction.token)
      this.#pending.splice(pendingIndex, 1)
    }
    this.#entries.splice(index)
    this.#cursor = Math.min(this.#cursor, index)
  }

  canUndo(): boolean {
    return this.#cursor > 0
  }

  canRedo(): boolean {
    return this.#cursor < this.#entries.length
  }

  begin(direction: "undo" | "redo", scopeKey: string): CanvasVisualHistoryPrediction | null {
    const index = direction === "undo" ? this.#cursor - 1 : this.#cursor
    const entry = this.#entries[index]
    if (!entry) return null
    const target = direction === "undo" ? entry.before : entry.after
    const source = direction === "undo" ? entry.after : entry.before
    const overlay = source && target ? createPresentationDelta(source, target) : []
    const operation = this.overlay.begin(scopeKey, overlay)
    const prediction = Object.freeze({
      direction,
      entryKey: entry.entryKey,
      token: operation.token,
    })
    this.#pending.push(prediction)
    this.#cursor += direction === "undo" ? -1 : 1
    return prediction
  }

  reconcile(
    prediction: CanvasVisualHistoryPrediction | null,
    actual: CanvasVisualHistoryTransition | null,
    actualAuthority: CanvasVisualHistoryAuthority,
  ): boolean {
    const entry = prediction ? this.#entries.find((candidate) => candidate.entryKey === prediction.entryKey) : undefined
    if (
      !prediction ||
      !entry ||
      entry.provisional ||
      !actual ||
      prediction.direction !== actual.direction ||
      entry.rootOperationId !== actual.rootOperationId
    ) {
      this.reset()
      return false
    }
    if (prediction.direction === "undo") entry.before = retainAuthority(actualAuthority)
    else entry.after = retainAuthority(actualAuthority)
    this.overlay.settle(prediction.token)
    const pendingIndex = this.#pending.findIndex((candidate) => candidate.token === prediction.token)
    if (pendingIndex >= 0) this.#pending.splice(pendingIndex, 1)
    return true
  }

  isPredictionActive(prediction: CanvasVisualHistoryPrediction | null): boolean {
    return prediction !== null && this.#pending.some((candidate) => candidate.token === prediction.token)
  }

  reject(_prediction: CanvasVisualHistoryPrediction | null): void {
    this.reset()
  }

  reset(): void {
    this.overlay.clear()
    this.#entries.splice(0)
    this.#pending.splice(0)
    this.#cursor = 0
  }

  #authorityAtCursor(fallback: CanvasVisualHistoryAuthority): CanvasVisualHistoryAuthority {
    if (this.#cursor === 0) return this.#entries[0]?.before ?? fallback
    return this.#entries[this.#cursor - 1]?.after ?? fallback
  }

  #stageAuthority(
    commandId: string,
    before: CanvasVisualHistoryAuthority | null,
    after: CanvasVisualHistoryAuthority | null,
  ): string | null {
    this.#entries.splice(this.#cursor)
    const entryKey = `provisional:${commandId}`
    this.#entries.push({
      entryKey,
      rootOperationId: commandId,
      provisional: true,
      before: before ? retainAuthority(before) : null,
      after: after ? retainAuthority(after) : null,
    })
    while (this.#entries.length > this.#maximumEntries) this.#entries.shift()
    this.#cursor = this.#entries.length
    return entryKey
  }

  #refreshPendingPredictions(entry: CanvasVisualHistoryEntry): void {
    if (!entry.before || !entry.after) return
    for (const prediction of this.#pending) {
      if (prediction.entryKey !== entry.entryKey) continue
      const source = prediction.direction === "undo" ? entry.after : entry.before
      const target = prediction.direction === "undo" ? entry.before : entry.after
      this.overlay.replace(prediction.token, createPresentationDelta(source, target))
    }
  }
}

function createPresentationDelta(
  current: CanvasVisualHistoryAuthority,
  target: CanvasVisualHistoryAuthority,
): readonly CanvasOptimisticOverlayItem[] {
  const currentNodes = new Map(current.document.nodes.map((node) => [node.id, node]))
  const targetNodes = new Map(target.document.nodes.map((node) => [node.id, node]))
  const currentEntities = new Map(current.nodeEntities.map((entry) => [entry.nodeId, entry.entity]))
  const currentEdgeEntities = new Map(current.edgeEntities.map((entry) => [entry.edgeId, entry.entity]))
  const items: CanvasOptimisticOverlayItem[] = []
  const ghostKeys = new Map<string, string>()

  for (const [nodeId] of targetNodes) {
    if (!currentNodes.has(nodeId)) {
      ghostKeys.set(nodeId, `ghost-history-node:${globalThis.crypto.randomUUID()}`)
    }
  }

  for (const [nodeId] of currentNodes) {
    if (targetNodes.has(nodeId)) continue
    const entity = currentEntities.get(nodeId)
    if (!entity) continue
    items.push(createCanvasHideEntityOverlay({ entityId: nodeId, incarnation: entity.incarnation, kind: "node" }))
  }
  for (const [nodeId, targetNode] of targetNodes) {
    const currentNode = currentNodes.get(nodeId)
    if (!currentNode) {
      items.push(canvasNodeGhost(targetNode, ghostKeys.get(nodeId)!, ghostKeys))
      continue
    }
    if (!sameNodePresentation(currentNode, targetNode)) {
      const entity = currentEntities.get(nodeId)
      if (!entity) continue
      const geometryOnly = sameNodeNonGeometryPresentation(currentNode, targetNode)
      items.push(
        createCanvasReplacePresentationOverlay({
          entity: { entityId: nodeId, incarnation: entity.incarnation, kind: "node" },
          ...(geometryOnly
            ? {
                position: Object.freeze({ ...targetNode.position }),
                size: Object.freeze(getCanvasNodePresentationSize(targetNode)),
              }
            : {
                snapshot: canvasNodePresentationSnapshot(
                  targetNode,
                  targetNode.parentId ? (ghostKeys.get(targetNode.parentId) ?? targetNode.parentId) : undefined,
                ),
              }),
        }),
      )
    }
  }
  const currentEdges = new Map(current.document.edges.map((edge) => [edge.id, edge]))
  const targetEdges = new Map(target.document.edges.map((edge) => [edge.id, edge]))
  for (const [edgeId] of currentEdges) {
    if (targetEdges.has(edgeId)) continue
    const entity = currentEdgeEntities.get(edgeId)
    if (entity)
      items.push(createCanvasHideEntityOverlay({ entityId: edgeId, incarnation: entity.incarnation, kind: "edge" }))
  }
  for (const edge of target.document.edges) {
    const currentEdge = currentEdges.get(edge.id)
    if (currentEdge && sameEdgePresentation(currentEdge, edge)) continue
    if (currentEdge) {
      const entity = currentEdgeEntities.get(edge.id)
      if (entity)
        items.push(createCanvasHideEntityOverlay({ entityId: edge.id, incarnation: entity.incarnation, kind: "edge" }))
    }
    const source = ghostKeys.get(edge.source) ?? edge.source
    const targetKey = ghostKeys.get(edge.target) ?? edge.target
    const ghost = createCanvasConnectionGhost(source, targetKey)
    items.push(
      Object.freeze({
        ...ghost,
        ...(typeof edge.data?.label === "string" ? { label: edge.data.label } : {}),
      }),
    )
  }
  return Object.freeze(items)
}

function canvasNodeGhost(
  node: CanvasNode,
  presentationKey: string,
  ghostKeys: ReadonlyMap<string, string>,
): CanvasGhostNode {
  const nodeType = node.data.kind === "text" ? ("text" as const) : ("file" as const)
  const mediaKind =
    node.data.kind === "audio" || node.data.kind === "image" || node.data.kind === "video"
      ? node.data.kind
      : nodeType === "file"
        ? ("file" as const)
        : undefined
  return Object.freeze({
    kind: "ghost-node",
    presentationKey,
    position: Object.freeze({ ...node.position }),
    presentation: Object.freeze({
      ...(mediaKind ? { mediaKind } : {}),
      ...(typeof node.data.mimeType === "string" ? { mimeType: node.data.mimeType } : {}),
      nodeType,
      title: node.data.label,
    }),
    size: Object.freeze(getCanvasNodePresentationSize(node)),
    snapshot: canvasNodePresentationSnapshot(
      node,
      node.parentId ? (ghostKeys.get(node.parentId) ?? node.parentId) : undefined,
    ),
  })
}

function canvasNodePresentationSnapshot(node: CanvasNode, parentPresentationKey = node.parentId) {
  return Object.freeze({
    data: Object.freeze(structuredClone(node.data)),
    nodeType: node.type ?? "file",
    ...(parentPresentationKey ? { parentPresentationKey } : {}),
    position: Object.freeze({ ...node.position }),
    size: Object.freeze(getCanvasNodePresentationSize(node)),
    ...(node.zIndex === undefined ? {} : { zIndex: node.zIndex }),
  })
}

/**
 * Session projections are immutable replacement values. Visual history retains
 * those authority values instead of synchronously cloning the complete Canvas in
 * an input event. Presentation deltas still clone the one affected node when an
 * undo/redo prediction is actually rendered.
 */
function retainAuthority(authority: CanvasVisualHistoryAuthority): CanvasVisualHistoryAuthority {
  return Object.freeze({
    document: authority.document,
    edgeEntities: authority.edgeEntities,
    nodeEntities: authority.nodeEntities,
  })
}

function sameEdgePresentation(left: CanvasDocument["edges"][number], right: CanvasDocument["edges"][number]) {
  return left.source === right.source && left.target === right.target && left.data?.label === right.data?.label
}

function sameNodePresentation(left: CanvasNode, right: CanvasNode): boolean {
  return JSON.stringify(canvasNodePresentationSnapshot(left)) === JSON.stringify(canvasNodePresentationSnapshot(right))
}

function sameNodeNonGeometryPresentation(left: CanvasNode, right: CanvasNode): boolean {
  return (
    (left.type ?? "file") === (right.type ?? "file") &&
    left.parentId === right.parentId &&
    left.zIndex === right.zIndex &&
    JSON.stringify(left.data) === JSON.stringify(right.data)
  )
}

function applyRendererGeometryPresentation(
  authority: CanvasVisualHistoryAuthority,
  command: CanvasRendererCommand,
): CanvasVisualHistoryAuthority | null {
  const entities = new Map(authority.nodeEntities.map((entry) => [entry.nodeId, entry.entity]))
  const updates = new Map(command.body.updates.map((update) => [update.node.id, update]))
  let changed = false
  const nodes = authority.document.nodes.map((node) => {
    const update = updates.get(node.id)
    const entity = entities.get(node.id)
    if (!update || !entity || entity.incarnation !== update.node.incarnation) return node
    const positionChanged =
      update.position !== undefined && (node.position.x !== update.position.x || node.position.y !== update.position.y)
    const sizeChanged =
      update.size !== undefined &&
      update.size !== null &&
      (node.style?.width !== update.size.width || node.style?.height !== update.size.height)
    if (!positionChanged && !sizeChanged) return node
    changed = true
    return {
      ...node,
      ...(update.position ? { position: { ...update.position } } : {}),
      ...(update.size ? { style: { ...node.style, height: update.size.height, width: update.size.width } } : {}),
    }
  })
  if (!changed) return null
  return retainAuthority({
    document: { ...authority.document, nodes },
    edgeEntities: authority.edgeEntities,
    nodeEntities: authority.nodeEntities,
  })
}
