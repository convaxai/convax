import type { AgentResource } from "@convax/agent-runtime"
import type { CanvasSelectionAction } from "@convax/canvas"
import { createAgentCanvasNodeResource } from "../agent-canvas-context"

export const addSelectionToConversationActionId = "agent.add-selection-to-conversation"

export function createAddSelectionToConversationAction(input: {
  addResources(resources: readonly AgentResource[]): void
  canvasId?: string
  icon?: CanvasSelectionAction["icon"]
  label: string
}): CanvasSelectionAction {
  return {
    id: addSelectionToConversationActionId,
    icon: input.icon,
    label: input.label,
    visible(context) {
      return (
        context.selectedEdgeIds.length === 0 &&
        context.selectedNodeIds.length > 0 &&
        context.selectedNodes.length === context.selectedNodeIds.length
      )
    },
    execute(context) {
      const canvasId = input.canvasId
      if (context.signal.aborted || !canvasId || context.document.id !== canvasId) return
      input.addResources(
        context.selectedNodes.map((node) => createAgentCanvasNodeResource(canvasId, node.id, node.data.label)),
      )
    },
  }
}
