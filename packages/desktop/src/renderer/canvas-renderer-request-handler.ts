import type { CanvasDocumentRef } from "@convax/canvas/application"
import type { CanvasViewRegistry } from "@convax/canvas/view"
import { sameCanvasDocumentRef, type CanvasRendererClient } from "../canvas-renderer-contracts"

export interface CanvasRendererEditorHandle {
  reloadAuthoritative(this: void): Promise<void>
}

export interface CanvasRendererRequestHandlerOptions {
  getActiveRef(): CanvasDocumentRef | null
  getEditor(): CanvasRendererEditorHandle | null
  views: Pick<CanvasViewRegistry, "execute" | "list">
}

function activeRefMatches(active: CanvasDocumentRef | null, expected: CanvasDocumentRef) {
  return active !== null && sameCanvasDocumentRef(active, expected)
}

/** Creates the stateful renderer endpoint for one Desktop window. */
export function createCanvasRendererRequestHandler(
  options: CanvasRendererRequestHandlerOptions,
): Parameters<CanvasRendererClient["onRequest"]>[0] {
  return async (request) => {
    if (request.type === "workbench.active-ref") {
      return { ref: options.getActiveRef(), type: "workbench.active-ref" }
    }
    if (request.type === "view.snapshot") {
      const snapshots = options.views.list().filter((snapshot) => snapshot.viewId === request.viewId)
      return { snapshot: snapshots.length === 1 ? snapshots[0] : null, type: "view.snapshot" }
    }
    if (request.type === "view.execute") {
      const result = await options.views.execute(request.input)
      return { type: "view.execute", result }
    }
    if (request.type === "document.reload") {
      if (!activeRefMatches(options.getActiveRef(), request.ref)) {
        return { type: "document.reload", reloaded: false }
      }
      const editor = options.getEditor()
      if (!editor) return { type: "document.reload", reloaded: false }
      await editor.reloadAuthoritative()
      return { type: "document.reload", reloaded: true }
    }
    return assertNever(request)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Canvas renderer request: ${JSON.stringify(value)}`)
}
