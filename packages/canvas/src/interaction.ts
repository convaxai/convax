export type CanvasInteractionTool = "hand" | "select"

export const CANVAS_CONNECTION_RADIUS = 120
export const CANVAS_MULTI_SELECTION_KEYS = ["Meta", "Shift"] as const
export const CANVAS_PAN_ON_DRAG = [1] as const
export const CANVAS_ZOOM_ACTIVATION_KEYS = ["Meta", "Control"] as const

/**
 * Pure renderer interaction policy. The editor's custom handlers use the same
 * navigation-only predicate so Hand, Space, and read-only modes cannot bypass
 * React Flow's interaction props.
 */
export function resolveCanvasInteractionPolicy(input: {
  readOnly: boolean
  selectionDragChordHeld: boolean
  spacePanning: boolean
  tool: CanvasInteractionTool
}) {
  const navigationOnly = input.tool === "hand" || input.spacePanning
  const selectionEnabled = !input.readOnly && !navigationOnly
  return {
    elementsSelectable: selectionEnabled,
    mutationEnabled: selectionEnabled && !input.selectionDragChordHeld,
    navigationOnly,
    nodesConnectable: selectionEnabled,
    nodesDraggable: selectionEnabled && !input.selectionDragChordHeld,
    panOnDrag: input.tool === "hand" ? true : [...CANVAS_PAN_ON_DRAG],
    selectionEnabled,
    selectionOnDrag: selectionEnabled,
  }
}
