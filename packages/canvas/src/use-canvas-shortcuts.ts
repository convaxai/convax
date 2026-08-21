export type CanvasShortcutCommand =
  | "add-node"
  | "clear-selection"
  | "delete"
  | "duplicate"
  | "enter-group"
  | "fit-view"
  | "generate"
  | "group"
  | "hand-tool"
  | "layout"
  | "open-search"
  | "select-all"
  | "select-tool"
  | "ungroup"
  | "zoom-in"
  | "zoom-out"

export interface CanvasShortcutActions {
  addNode: () => void
  clearSelection: () => void
  delete: () => void
  duplicate: () => void
  enterGroup?: () => void
  fitView: () => void
  generate: () => void
  group: () => void
  hand?: () => void
  layout: () => void
  openSearch: () => void
  select: () => void
  selectAll: () => void
  ungroup: () => void
  zoomIn: () => void
  zoomOut: () => void
}

const readOnlyCommands = new Set<CanvasShortcutCommand>([
  "clear-selection",
  "fit-view",
  "hand-tool",
  "open-search",
  "select-all",
  "select-tool",
  "zoom-in",
  "zoom-out",
])

export function resolveCanvasTidyShortcutScope(
  canArrangeSelection: boolean,
  selectedNodeCount: number,
): "canvas" | "selection" {
  return canArrangeSelection || selectedNodeCount >= 2 ? "selection" : "canvas"
}

export function isCanvasEditableShortcutTarget(target: EventTarget | null) {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"))
}

export function canRunCanvasShortcutCommand(
  command: CanvasShortcutCommand,
  actions: CanvasShortcutActions,
  readOnly: boolean,
) {
  if (readOnly && !readOnlyCommands.has(command)) return false
  if (command === "hand-tool") return actions.hand !== undefined
  if (command === "enter-group") return actions.enterGroup !== undefined
  return true
}

export function runCanvasShortcutCommand(
  command: CanvasShortcutCommand,
  actions: CanvasShortcutActions,
  readOnly: boolean,
) {
  if (!canRunCanvasShortcutCommand(command, actions, readOnly)) return false
  switch (command) {
    case "add-node":
      actions.addNode()
      break
    case "clear-selection":
      actions.clearSelection()
      break
    case "delete":
      actions.delete()
      break
    case "duplicate":
      actions.duplicate()
      break
    case "enter-group":
      actions.enterGroup?.()
      break
    case "fit-view":
      actions.fitView()
      break
    case "generate":
      actions.generate()
      break
    case "group":
      actions.group()
      break
    case "hand-tool":
      actions.hand?.()
      break
    case "layout":
      actions.layout()
      break
    case "open-search":
      actions.openSearch()
      break
    case "select-all":
      actions.selectAll()
      break
    case "select-tool":
      actions.select()
      break
    case "ungroup":
      actions.ungroup()
      break
    case "zoom-in":
      actions.zoomIn()
      break
    case "zoom-out":
      actions.zoomOut()
      break
  }
  return true
}
