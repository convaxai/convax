import type { CanvasDocument } from "@convax/canvas"
import { canvasResourceHydrationMaximumTargetCount } from "../desktop-protocol"

export function collectStaleCanvasResourceNodeIds(document: CanvasDocument): string[] {
  const nodeIds = document.nodes.flatMap((node) => {
    const state = node.data.resourceState
    return state !== null && typeof state === "object" && "status" in state && state.status === "stale" ? [node.id] : []
  })
  if (nodeIds.length > canvasResourceHydrationMaximumTargetCount) {
    throw new Error("Canvas resource refresh target set exceeds the Desktop bridge limit")
  }
  return nodeIds
}
