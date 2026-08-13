import type { KeyboardEvent } from "react"

export interface CanvasShortcutActions {
  addNode: () => void
  armExternalDrag: () => void
  cancelExternalDrag: () => void
  clearSelection: () => void
  copy: () => void
  delete: () => void
  duplicate: () => void
  fitView: () => void
  generate: () => void
  group: () => void
  hand?: () => void
  layout: () => void
  openSearch: () => void
  paste: () => void
  redo: () => void
  select: () => void
  selectAll: () => void
  undo: () => void
  ungroup: () => void
  zoomIn: () => void
  zoomOut: () => void
}

export interface CanvasShortcutOptions {
  canArmExternalDrag?: boolean
  externalDragShortcutModifier?: "control" | "meta"
  externalDragArmed?: boolean
}

export function resolveCanvasTidyShortcutScope(
  canArrangeSelection: boolean,
  selectedNodeCount: number,
): "canvas" | "selection" {
  return canArrangeSelection || selectedNodeCount >= 2 ? "selection" : "canvas"
}

type CanvasExternalDragChordEvent = Pick<KeyboardEvent<HTMLElement>, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">

export function isCanvasEditableShortcutTarget(target: EventTarget | null) {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(target.closest("input, textarea, select"))
}

export function ignoresCanvasShortcuts(target: EventTarget | null) {
  if (isCanvasEditableShortcutTarget(target)) return true
  return typeof HTMLElement !== "undefined" && target instanceof HTMLElement
    ? Boolean(target.closest("[data-canvas-shortcuts='ignore']"))
    : false
}

export function isCanvasExternalDragChordHeld(
  event: CanvasExternalDragChordEvent,
  shortcutModifier: CanvasShortcutOptions["externalDragShortcutModifier"],
) {
  if (!shortcutModifier) return false
  if (event.altKey || event.shiftKey) return false
  if (shortcutModifier === "meta") return event.metaKey && !event.ctrlKey
  if (shortcutModifier === "control") return event.ctrlKey && !event.metaKey
  return false
}

export function isCanvasExternalDragChordKey(
  key: string,
  shortcutModifier: CanvasShortcutOptions["externalDragShortcutModifier"],
) {
  if (!shortcutModifier) return false
  if (shortcutModifier === "meta") return key === "Meta"
  if (shortcutModifier === "control") return key === "Control"
  return false
}

export function resolveCanvasHistoryShortcut(
  event: Pick<globalThis.KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
): "redo" | "undo" | null {
  const key = event.key.toLowerCase()
  const mod = event.metaKey || event.ctrlKey
  if (mod && !event.altKey && key === "z") return event.shiftKey ? "redo" : "undo"
  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === "y") return "redo"
  return null
}

export function createCanvasShortcutHandler(
  actions: CanvasShortcutActions,
  readOnly: boolean,
  options: CanvasShortcutOptions = {},
) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const key = event.key.toLowerCase()
    const mod = event.metaKey || event.ctrlKey
    const run = (action: () => void) => {
      event.preventDefault()
      event.stopPropagation()
      action()
    }

    if (event.defaultPrevented || event.nativeEvent?.isComposing) return
    if (event.key === "Escape" && options.externalDragArmed) return run(actions.cancelExternalDrag)
    if (
      options.externalDragArmed &&
      !isCanvasExternalDragChordKey(event.key, options.externalDragShortcutModifier)
    ) {
      actions.cancelExternalDrag()
    }
    // This is an application gesture: Canvas clicks can intentionally leave a nested composer focused.
    // The exact host-selected modifier arms it, and key-up immediately ends the held gesture.
    if (
      options.canArmExternalDrag &&
      isCanvasExternalDragChordHeld(event, options.externalDragShortcutModifier) &&
      isCanvasExternalDragChordKey(event.key, options.externalDragShortcutModifier)
    ) {
      actions.armExternalDrag()
      return
    }
    if (ignoresCanvasShortcuts(event.target)) return
    if (mod && !event.altKey && !event.shiftKey && key === "0") return run(actions.fitView)
    if (mod && !event.altKey && ["=", "+"].includes(event.key)) return run(actions.zoomIn)
    if (mod && !event.altKey && ["-", "_"].includes(event.key)) return run(actions.zoomOut)
    if (mod && !event.altKey && !event.shiftKey && key === "a") return run(actions.selectAll)
    if (mod && !event.altKey && !event.shiftKey && key === "f") return run(actions.openSearch)
    // Let the browser emit copy/paste events so Canvas can use the system DataTransfer protocol.
    if (mod && !event.altKey && !event.shiftKey && (key === "c" || key === "v")) return
    if (event.key === "Escape") return run(actions.clearSelection)
    if (!mod && !event.altKey && !event.shiftKey && key === "v") return run(actions.select)
    if (!mod && !event.altKey && !event.shiftKey && key === "h" && actions.hand) return run(actions.hand)
    if (readOnly) return
    const historyShortcut = resolveCanvasHistoryShortcut(event)
    if (historyShortcut) return run(actions[historyShortcut])
    if (mod && !event.altKey && event.shiftKey && key === "g") return run(actions.ungroup)
    if (mod && !event.altKey && !event.shiftKey && key === "g") return run(actions.group)
    if (mod && !event.altKey && !event.shiftKey && key === "d") return run(actions.duplicate)
    if (mod && !event.altKey && !event.shiftKey && event.key === "Enter") return run(actions.generate)
    if (!mod && event.altKey && event.shiftKey && key === "f") return run(actions.layout)
    if (!mod && !event.altKey && ["Backspace", "Delete"].includes(event.key)) return run(actions.delete)
    if (!mod && !event.altKey && !event.shiftKey && event.key === "Tab") return run(actions.addNode)
  }
}

/** Ends the native export gesture as soon as the required modifier is released. */
export function createCanvasShortcutReleaseHandler(
  actions: Pick<CanvasShortcutActions, "cancelExternalDrag">,
  options: CanvasShortcutOptions = {},
) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (
      !options.externalDragArmed ||
      !isCanvasExternalDragChordKey(event.key, options.externalDragShortcutModifier) ||
      isCanvasExternalDragChordHeld(event, options.externalDragShortcutModifier)
    )
      return
    actions.cancelExternalDrag()
  }
}
