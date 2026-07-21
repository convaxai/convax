import type { NodeChange } from "@xyflow/react"
import { duplicateCanvasSelection } from "../commands"
import type { CanvasDocument, CanvasNode } from "../types"

export interface CanvasDuplicateDragPlan {
  document: CanvasDocument
  duplicatedNodeIdBySourceId: ReadonlyMap<string, string>
  selectedNodeIds: readonly string[]
}

export function createCanvasDuplicateDragPlan(
  document: CanvasDocument,
  nodeIds: readonly string[],
  preserveConnections: boolean,
): CanvasDuplicateDragPlan | null {
  const result = duplicateCanvasSelection(
    document,
    nodeIds,
    { x: 0, y: 0 },
    {
      edgeScope: preserveConnections ? "connected" : "internal",
    },
  )
  if (result.selectedNodeIds.length === 0) return null
  return result
}

export function remapCanvasDuplicateDragChanges(
  changes: readonly NodeChange<CanvasNode>[],
  duplicatedNodeIdBySourceId: ReadonlyMap<string, string>,
): NodeChange<CanvasNode>[] {
  return changes.map((change) => {
    if (change.type !== "position" && change.type !== "select") return change
    const duplicateId = duplicatedNodeIdBySourceId.get(change.id)
    return duplicateId ? { ...change, id: duplicateId } : change
  })
}
