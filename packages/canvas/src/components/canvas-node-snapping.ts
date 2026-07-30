import type { NodeChange } from "@xyflow/react"
import { resolveCanvasNodeSnap, type CanvasNodeSnapSession, type CanvasSnapLine } from "../snapping"
import type { CanvasNode, CanvasPoint } from "../types"

export interface CanvasSnappedNodeChanges {
  changes: NodeChange<CanvasNode>[]
  lines: CanvasSnapLine[]
}

export function snapCanvasNodePositionChanges(
  changes: readonly NodeChange<CanvasNode>[],
  session: CanvasNodeSnapSession,
  tolerance: number,
): CanvasSnappedNodeChanges {
  const draggingIds = new Set(session.dragging.map((node) => node.id))
  const localPositions = new Map<string, CanvasPoint>()
  for (const change of changes) {
    if (change.type === "position" && change.position && draggingIds.has(change.id)) {
      localPositions.set(change.id, change.position)
    }
  }
  if (localPositions.size === 0) return { changes: [...changes], lines: [] }

  const snap = resolveCanvasNodeSnap(session, localPositions, tolerance)
  if (snap.offset.x === 0 && snap.offset.y === 0) {
    return { changes: [...changes], lines: snap.lines }
  }

  return {
    changes: changes.map((change) => {
      if (change.type !== "position" || !draggingIds.has(change.id)) return change
      return {
        ...change,
        ...(change.position
          ? {
              position: {
                x: change.position.x + snap.offset.x,
                y: change.position.y + snap.offset.y,
              },
            }
          : {}),
        ...(change.positionAbsolute
          ? {
              positionAbsolute: {
                x: change.positionAbsolute.x + snap.offset.x,
                y: change.positionAbsolute.y + snap.offset.y,
              },
            }
          : {}),
      }
    }),
    lines: snap.lines,
  }
}
