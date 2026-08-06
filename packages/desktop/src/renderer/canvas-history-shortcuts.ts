import { ignoresCanvasShortcuts, resolveCanvasHistoryShortcut } from "@convax/canvas"

export interface WorkspaceCanvasHistorySession {
  redo(): Promise<unknown>
  undo(): Promise<unknown>
}

export function createWorkspaceCanvasHistoryShortcutHandler(input: {
  readonly onError: (direction: "redo" | "undo", error: unknown) => void
  readonly session: WorkspaceCanvasHistorySession
}) {
  return (event: KeyboardEvent) => {
    const direction = resolveCanvasHistoryShortcut(event)
    const target = event.target instanceof HTMLElement ? event.target : null
    if (
      !direction ||
      event.defaultPrevented ||
      event.isComposing ||
      ignoresCanvasShortcuts(event.target) ||
      target?.closest(".convax-canvas")
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    void input.session[direction]().catch((error) => input.onError(direction, error))
  }
}
