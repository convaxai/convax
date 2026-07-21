import type { CanvasDocumentRef } from "@convax/canvas/application"
import type { CanvasViewRegistry } from "@convax/canvas/view"
import {
  sameCanvasDocumentRef,
  type CanvasDocumentMutationOutcome,
  type CanvasRendererClient,
} from "../canvas-renderer-contracts"

export interface CanvasRendererEditorHandle {
  beginExternalMutation(this: void, signal?: AbortSignal): Promise<void>
  endExternalMutation(this: void, outcome: CanvasDocumentMutationOutcome): Promise<void>
  reload(this: void): Promise<void>
}

export interface CanvasRendererRequestHandlerOptions {
  getActiveRef(): CanvasDocumentRef | null
  getEditor(): CanvasRendererEditorHandle | null
  onDocumentMutationChange?(ref: CanvasDocumentRef | null): void
  views: Pick<CanvasViewRegistry, "execute" | "list">
}

interface PreparedDocumentMutation {
  cancelRequested: boolean
  controller: AbortController
  editor: CanvasRendererEditorHandle | null
  leaseId: string
  phase: "preparing" | "prepared"
  ref: CanvasDocumentRef
}

function activeRefMatches(active: CanvasDocumentRef | null, expected: CanvasDocumentRef) {
  return active !== null && sameCanvasDocumentRef(active, expected)
}

/** Creates the stateful renderer endpoint for one Desktop window. */
export function createCanvasRendererRequestHandler(
  options: CanvasRendererRequestHandlerOptions,
): Parameters<CanvasRendererClient["onRequest"]>[0] {
  let preparedMutation: PreparedDocumentMutation | null = null
  const reserveMutation = (mutation: PreparedDocumentMutation) => {
    preparedMutation = mutation
    options.onDocumentMutationChange?.({ ...mutation.ref })
  }
  const releaseMutation = (mutation: PreparedDocumentMutation) => {
    if (preparedMutation !== mutation) return
    preparedMutation = null
    options.onDocumentMutationChange?.(null)
  }

  return async (request) => {
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
      await editor.reload()
      return { type: "document.reload", reloaded: true }
    }
    if (request.type === "document.mutation.cancel") {
      const mutation = preparedMutation
      if (!mutation || mutation.leaseId !== request.leaseId || !sameCanvasDocumentRef(mutation.ref, request.ref)) {
        return {
          canceled: false,
          leaseId: request.leaseId,
          ref: request.ref,
          type: request.type,
        }
      }
      mutation.cancelRequested = true
      mutation.controller.abort(new DOMException("Canvas document mutation preparation was canceled", "AbortError"))
      if (mutation.phase === "prepared") {
        try {
          await mutation.editor?.endExternalMutation("aborted")
        } finally {
          releaseMutation(mutation)
        }
      }
      return {
        canceled: true,
        leaseId: request.leaseId,
        ref: request.ref,
        type: request.type,
      }
    }
    if (request.type === "document.mutation.prepare") {
      if (preparedMutation) throw new Error("A Canvas document mutation is already prepared")
      if (!activeRefMatches(options.getActiveRef(), request.ref)) {
        reserveMutation({
          cancelRequested: false,
          controller: new AbortController(),
          editor: null,
          leaseId: request.leaseId,
          phase: "prepared",
          ref: request.ref,
        })
        return {
          leaseId: request.leaseId,
          prepared: false,
          ref: request.ref,
          type: request.type,
        }
      }
      const editor = options.getEditor()
      if (!editor) throw new Error("The active Canvas editor is unavailable for an external mutation")

      const mutation: PreparedDocumentMutation = {
        cancelRequested: false,
        controller: new AbortController(),
        editor,
        leaseId: request.leaseId,
        phase: "preparing",
        ref: request.ref,
      }
      reserveMutation(mutation)
      try {
        await editor.beginExternalMutation(mutation.controller.signal)
        if (mutation.cancelRequested) {
          await editor.endExternalMutation("aborted")
          throw new Error("Canvas document mutation preparation was canceled")
        }
        if (!activeRefMatches(options.getActiveRef(), request.ref) || options.getEditor() !== editor) {
          await editor.endExternalMutation("aborted")
          throw new Error("The active Canvas changed while preparing an external mutation")
        }
        mutation.phase = "prepared"
      } catch (error) {
        releaseMutation(mutation)
        throw error
      }
      return {
        leaseId: request.leaseId,
        prepared: true,
        ref: request.ref,
        type: request.type,
      }
    }

    const prepared = preparedMutation
    if (!prepared || prepared.leaseId !== request.leaseId || !sameCanvasDocumentRef(prepared.ref, request.ref)) {
      throw new Error("Canvas document mutation finish did not match the prepared lease")
    }
    if (prepared.phase !== "prepared" || prepared.cancelRequested) {
      throw new Error("Canvas document mutation cannot finish while preparation is pending or canceled")
    }
    if (!prepared.editor) {
      if (activeRefMatches(options.getActiveRef(), request.ref)) {
        releaseMutation(prepared)
        throw new Error("An inactive Canvas became active during an external document operation")
      }
      releaseMutation(prepared)
      return {
        finished: true,
        leaseId: request.leaseId,
        ref: request.ref,
        type: request.type,
      }
    }
    if (!activeRefMatches(options.getActiveRef(), request.ref) || options.getEditor() !== prepared.editor) {
      try {
        await prepared.editor.endExternalMutation("aborted")
      } finally {
        releaseMutation(prepared)
      }
      throw new Error("The active Canvas editor changed before the external mutation finished")
    }
    try {
      await prepared.editor.endExternalMutation(request.outcome)
    } finally {
      releaseMutation(prepared)
    }
    return {
      finished: true,
      leaseId: request.leaseId,
      ref: request.ref,
      type: request.type,
    }
  }
}
