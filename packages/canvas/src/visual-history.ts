import { getCanvasNodePresentationSize } from "./document"
import { CanvasOptimisticOverlayCoordinator } from "./optimistic-overlay"
import { createCanvasConnectionGhost, createCanvasHideEntityOverlay, createCanvasReplacePresentationOverlay } from "./optimistic-overlay-plans"
import type { CanvasGhostNode, CanvasOptimisticOverlayItem, CanvasOptimisticOperationToken } from "./optimistic-overlay"
import type { CanvasDocument, CanvasNode } from "./types"

export interface CanvasVisualHistoryAuthority {
  readonly document: CanvasDocument
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
  readonly rootOperationId: string
  readonly before: CanvasVisualHistoryAuthority
  readonly after: CanvasVisualHistoryAuthority
}

export interface CanvasVisualHistoryPrediction {
  readonly direction: "undo" | "redo"
  readonly expectedRootOperationId: string
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
    if (!rootOperationId || !hasPresentationDifference(before.document, after.document)) return
    if (this.#pending.length > 0) this.reset()
    this.#entries.splice(this.#cursor)
    this.#entries.push(Object.freeze({
      rootOperationId,
      before: cloneAuthority(before),
      after: cloneAuthority(after),
    }))
    while (this.#entries.length > this.#maximumEntries) this.#entries.shift()
    this.#cursor = this.#entries.length
  }

  begin(direction: "undo" | "redo", current: CanvasVisualHistoryAuthority, scopeKey: string): CanvasVisualHistoryPrediction | null {
    const index = direction === "undo" ? this.#cursor - 1 : this.#cursor
    const entry = this.#entries[index]
    if (!entry) return null
    const target = direction === "undo" ? entry.before : entry.after
    const overlay = createPresentationDelta(current, target)
    const operation = this.overlay.begin(scopeKey, overlay)
    const prediction = Object.freeze({
      direction,
      expectedRootOperationId: entry.rootOperationId,
      token: operation.token,
    })
    this.#pending.push(prediction)
    this.#cursor += direction === "undo" ? -1 : 1
    return prediction
  }

  reconcile(prediction: CanvasVisualHistoryPrediction | null, actual: CanvasVisualHistoryTransition | null): boolean {
    if (
      !prediction ||
      !actual ||
      prediction.direction !== actual.direction ||
      prediction.expectedRootOperationId !== actual.rootOperationId
    ) {
      this.reset()
      return false
    }
    this.overlay.settle(prediction.token)
    const pendingIndex = this.#pending.findIndex((candidate) => candidate.token === prediction.token)
    if (pendingIndex >= 0) this.#pending.splice(pendingIndex, 1)
    return true
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
}

function createPresentationDelta(
  current: CanvasVisualHistoryAuthority,
  target: CanvasVisualHistoryAuthority,
): readonly CanvasOptimisticOverlayItem[] {
  const currentNodes = new Map(current.document.nodes.map((node) => [node.id, node]))
  const targetNodes = new Map(target.document.nodes.map((node) => [node.id, node]))
  const currentEntities = new Map(current.nodeEntities.map((entry) => [entry.nodeId, entry.entity]))
  const items: CanvasOptimisticOverlayItem[] = []
  const ghostKeys = new Map<string, string>()

  for (const [nodeId] of currentNodes) {
    if (targetNodes.has(nodeId)) continue
    const entity = currentEntities.get(nodeId)
    if (!entity) continue
    items.push(createCanvasHideEntityOverlay({ entityId: nodeId, incarnation: entity.incarnation, kind: "node" }))
  }
  for (const [nodeId, targetNode] of targetNodes) {
    const currentNode = currentNodes.get(nodeId)
    if (!currentNode) {
      const presentationKey = `ghost-history-node:${globalThis.crypto.randomUUID()}`
      ghostKeys.set(nodeId, presentationKey)
      items.push(canvasNodeGhost(targetNode, presentationKey))
      continue
    }
    if (!sameNodePresentation(currentNode, targetNode)) {
      const entity = currentEntities.get(nodeId)
      if (!entity) continue
      items.push(createCanvasReplacePresentationOverlay({
        entity: { entityId: nodeId, incarnation: entity.incarnation, kind: "node" },
        position: targetNode.position,
        size: getCanvasNodePresentationSize(targetNode),
        title: targetNode.data.label,
      }))
    }
  }
  for (const edge of target.document.edges) {
    if (current.document.edges.some((candidate) => candidate.id === edge.id)) continue
    const source = ghostKeys.get(edge.source) ?? edge.source
    const targetKey = ghostKeys.get(edge.target) ?? edge.target
    items.push(createCanvasConnectionGhost(source, targetKey))
  }
  return Object.freeze(items)
}

function canvasNodeGhost(node: CanvasNode, presentationKey: string): CanvasGhostNode {
  const nodeType = node.data.kind === "text" ? "text" as const : "file" as const
  const mediaKind =
    node.data.kind === "audio" || node.data.kind === "image" || node.data.kind === "video"
      ? node.data.kind
      : nodeType === "file"
        ? "file" as const
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
  })
}

function cloneAuthority(authority: CanvasVisualHistoryAuthority): CanvasVisualHistoryAuthority {
  return Object.freeze({
    document: structuredClone(authority.document),
    nodeEntities: Object.freeze(authority.nodeEntities.map((entry) => Object.freeze({
      nodeId: entry.nodeId,
      entity: Object.freeze({ ...entry.entity }),
    }))),
  })
}

function hasPresentationDifference(left: CanvasDocument, right: CanvasDocument): boolean {
  return JSON.stringify(left) !== JSON.stringify(right)
}

function sameNodePresentation(left: CanvasNode, right: CanvasNode): boolean {
  const leftSize = getCanvasNodePresentationSize(left)
  const rightSize = getCanvasNodePresentationSize(right)
  return (
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    leftSize.width === rightSize.width &&
    leftSize.height === rightSize.height &&
    left.data.label === right.data.label
  )
}
