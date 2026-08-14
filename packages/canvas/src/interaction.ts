export type CanvasInteractionTool = "hand" | "select"

export const CANVAS_CONNECTION_RADIUS = 120
export const CANVAS_PAN_ON_DRAG = [1] as const

/**
 * React Flow's modifier-key hook is window-global and can retain a pressed Meta
 * key when macOS consumes the matching key-up for a system shortcut. Canvas
 * therefore derives additive selection only from the pointer event that starts
 * the gesture. Extra modifiers are rejected instead of broadening the shortcut.
 */
export function isCanvasMultiSelectionPointerGesture(
  event: Pick<PointerEvent, "altKey" | "button" | "ctrlKey" | "metaKey" | "shiftKey">,
) {
  return (
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    event.metaKey !== event.shiftKey &&
    (event.metaKey || event.shiftKey)
  )
}

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
    panOnDrag: navigationOnly ? true : [...CANVAS_PAN_ON_DRAG],
    selectionEnabled,
    selectionOnDrag: selectionEnabled,
  }
}
