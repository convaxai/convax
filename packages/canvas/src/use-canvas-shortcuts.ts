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
  layout: () => void
  openSearch: () => void
  paste: () => void
  redo: () => void
  selectAll: () => void
  undo: () => void
  ungroup: () => void
  zoomIn: () => void
  zoomOut: () => void
}

function ignoresCanvasShortcuts(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return Boolean(target.closest("input, textarea, select, [data-canvas-shortcuts='ignore']"))
}

export function createCanvasShortcutHandler(actions: CanvasShortcutActions, readOnly: boolean) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (ignoresCanvasShortcuts(event.target)) return
    const key = event.key.toLowerCase()
    const mod = event.metaKey || event.ctrlKey
    const run = (action: () => void) => {
      event.preventDefault()
      event.stopPropagation()
      action()
    }

    if (mod && key === "0") return run(actions.fitView)
    if (mod && ["=", "+"].includes(event.key)) return run(actions.zoomIn)
    if (mod && event.key === "-") return run(actions.zoomOut)
    if (mod && key === "a") return run(actions.selectAll)
    if (mod && key === "f") return run(actions.openSearch)
    if (mod && key === "c") return run(actions.copy)
    if (event.key === "Escape") return run(actions.clearSelection)
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
