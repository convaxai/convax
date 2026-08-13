import type { KeyboardEvent } from "react"

export interface CanvasShortcutActions {
  addNode: () => void
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

export function resolveCanvasTidyShortcutScope(
  canArrangeSelection: boolean,
  selectedNodeCount: number,
): "canvas" | "selection" {
  return canArrangeSelection || selectedNodeCount >= 2 ? "selection" : "canvas"
}

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

export function resolveCanvasHistoryShortcut(
  event: Pick<globalThis.KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
): "redo" | "undo" | null {
  const key = event.key.toLowerCase()
  const mod = event.metaKey || event.ctrlKey
  if (mod && !event.altKey && key === "z") return event.shiftKey ? "redo" : "undo"
  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === "y") return "redo"
  return null
}

export function createCanvasShortcutHandler(actions: CanvasShortcutActions, readOnly: boolean) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const key = event.key.toLowerCase()
    const mod = event.metaKey || event.ctrlKey
    const run = (action: () => void) => {
      event.preventDefault()
      event.stopPropagation()
      action()
    }

    if (event.defaultPrevented || event.nativeEvent?.isComposing) return
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
