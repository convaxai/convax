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

type CanvasExternalDragChordEvent = Pick<KeyboardEvent<HTMLElement>, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">

function ignoresCanvasShortcuts(target: EventTarget | null) {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(target.closest("input, textarea, select, [data-canvas-shortcuts='ignore']"))
}

export function isCanvasExternalDragChordHeld(
  event: CanvasExternalDragChordEvent,
  shortcutModifier: CanvasShortcutOptions["externalDragShortcutModifier"],
) {
  if (event.altKey || !event.shiftKey) return false
  if (shortcutModifier === "meta") return event.metaKey && !event.ctrlKey
  if (shortcutModifier === "control") return event.ctrlKey && !event.metaKey
  return event.metaKey !== event.ctrlKey
}

export function isCanvasExternalDragChordKey(
  key: string,
  shortcutModifier: CanvasShortcutOptions["externalDragShortcutModifier"],
) {
  if (key === "Shift") return true
  if (shortcutModifier === "meta") return key === "Meta"
  if (shortcutModifier === "control") return key === "Control"
  return key === "Meta" || key === "Control"
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

    if (event.key === "Escape" && options.externalDragArmed) return run(actions.cancelExternalDrag)
    if (options.externalDragArmed && !["Meta", "Control", "Shift"].includes(event.key)) {
      actions.cancelExternalDrag()
    }
    // This is an application gesture: Canvas clicks can intentionally leave a nested composer focused.
    // Either key order works, and key-up immediately ends the held gesture.
    if (
      options.canArmExternalDrag &&
      isCanvasExternalDragChordHeld(event, options.externalDragShortcutModifier) &&
      isCanvasExternalDragChordKey(event.key, options.externalDragShortcutModifier)
    ) {
      actions.armExternalDrag()
      return
    }
    if (ignoresCanvasShortcuts(event.target)) return
    if (mod && key === "0") return run(actions.fitView)
    if (mod && ["=", "+"].includes(event.key)) return run(actions.zoomIn)
    if (mod && event.key === "-") return run(actions.zoomOut)
    if (mod && key === "a") return run(actions.selectAll)
    if (mod && key === "f") return run(actions.openSearch)
    if (mod && key === "c") return run(actions.copy)
    if (event.key === "Escape") return run(actions.clearSelection)
    if (!mod && key === "v") return run(actions.select)
    if (readOnly) return
    if (mod && key === "z") return run(event.shiftKey ? actions.redo : actions.undo)
    if (mod && key === "y") return run(actions.redo)
    if (mod && event.shiftKey && key === "g") return run(actions.ungroup)
    if (mod && key === "g") return run(actions.group)
    if (mod && key === "v") return run(actions.paste)
    if (mod && key === "d") return run(actions.duplicate)
    if (mod && event.key === "Enter") return run(actions.generate)
    if (event.altKey && event.shiftKey && key === "f") return run(actions.layout)
    if (["Backspace", "Delete"].includes(event.key)) return run(actions.delete)
    if (event.key === "Tab") return run(actions.addNode)
  }
}

/** Ends the native export gesture as soon as either required modifier is released. */
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
