import type { CanvasEdgeId, CanvasNodeId, CanvasSelection } from "./types"

export type CanvasSelectionContext =
  | { kind: "none" }
  | { kind: "single-node"; nodeId: CanvasNodeId }
  | { kind: "multi-node"; nodeIds: ReadonlySet<CanvasNodeId> }
  | { kind: "single-edge"; edgeId: CanvasEdgeId }
  | { kind: "multi-edge"; edgeIds: ReadonlySet<CanvasEdgeId> }
  | {
      kind: "mixed"
      nodeIds: ReadonlySet<CanvasNodeId>
      edgeIds: ReadonlySet<CanvasEdgeId>
    }

export function isSingleNodeSelectionContext(
  context: CanvasSelectionContext,
  nodeId?: CanvasNodeId,
): context is Extract<CanvasSelectionContext, { kind: "single-node" }> {
  return context.kind === "single-node" && (nodeId === undefined || context.nodeId === nodeId)
}

export function isNodeOnlySelectionContext(
  context: CanvasSelectionContext,
): context is Extract<CanvasSelectionContext, { kind: "single-node" | "multi-node" }> {
  return context.kind === "single-node" || context.kind === "multi-node"
}

export function canShowNodeLocalMutationSurface(
  context: CanvasSelectionContext,
  nodeId: CanvasNodeId,
  readOnly: boolean,
): boolean {
  return !readOnly && isSingleNodeSelectionContext(context, nodeId)
}

function onlyItem<T>(items: ReadonlySet<T>): T {
  const result = items.values().next()
  if (result.done) throw new Error("Expected a selection set with one item")
  return result.value
}

export function deriveCanvasSelectionContext(selection: CanvasSelection): CanvasSelectionContext {
  const nodeCount = selection.nodeIds.size
  const edgeCount = selection.edgeIds.size

  if (nodeCount === 0 && edgeCount === 0) return { kind: "none" }

  if (edgeCount === 0) {
    if (nodeCount === 1) {
      return { kind: "single-node", nodeId: onlyItem(selection.nodeIds) }
    }
    return { kind: "multi-node", nodeIds: selection.nodeIds }
  }

  if (nodeCount === 0) {
    if (edgeCount === 1) {
      return { edgeId: onlyItem(selection.edgeIds), kind: "single-edge" }
    }
    return { edgeIds: selection.edgeIds, kind: "multi-edge" }
  }

  return {
    edgeIds: selection.edgeIds,
    kind: "mixed",
    nodeIds: selection.nodeIds,
  }
}
