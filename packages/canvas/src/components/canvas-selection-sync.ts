import type { CanvasSelection } from "../types"

interface CanvasElementSelectionChange {
  id: string
  selected: boolean
}

export function applyReactFlowNodeSelectionChanges(
  current: CanvasSelection,
  changes: readonly CanvasElementSelectionChange[],
): CanvasSelection {
  const nodeIds = new Set(current.nodeIds)
  changes.forEach((change) => (change.selected ? nodeIds.add(change.id) : nodeIds.delete(change.id)))
  return {
    edgeIds: current.edgeIds,
    nodeIds,
  }
}

export function applyReactFlowEdgeSelectionChanges(
  current: CanvasSelection,
  changes: readonly CanvasElementSelectionChange[],
): CanvasSelection {
  const edgeIds = new Set(current.edgeIds)
  changes.forEach((change) => (change.selected ? edgeIds.add(change.id) : edgeIds.delete(change.id)))
  return { edgeIds, nodeIds: current.nodeIds }
}
