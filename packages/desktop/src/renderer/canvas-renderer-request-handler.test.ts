import { describe, expect, mock, test } from "bun:test"
import type { CanvasDocumentRef } from "@convax/canvas/application"
import { createCanvasRendererRequestHandler, type CanvasRendererEditorHandle } from "./canvas-renderer-request-handler"

const ref: CanvasDocumentRef = { canvasId: "canvas-1", scopeId: "project-1" }

function editor(): CanvasRendererEditorHandle {
  return {
    beginExternalMutation: mock(async () => undefined),
    endExternalMutation: mock(async () => undefined),
    reload: mock(async () => undefined),
  }
}

function handler(input: { active?: CanvasDocumentRef | null; editor?: CanvasRendererEditorHandle | null }) {
  let active = input.active === undefined ? ref : input.active
  let currentEditor = input.editor === undefined ? editor() : input.editor
  let reserved: CanvasDocumentRef | null = null
  const request = createCanvasRendererRequestHandler({
    getActiveRef: () => active,
    getEditor: () => currentEditor,
    onDocumentMutationChange: (value) => {
      reserved = value
    },
    views: {
      execute: mock(async () => {
        throw new Error("Unexpected view request")
      }),
      list: mock(() => []),
    },
  })
  return {
    getReserved: () => reserved,
    request,
    setActive(value: CanvasDocumentRef | null) {
      active = value
    },
    setEditor(value: CanvasRendererEditorHandle | null) {
      currentEditor = value
    },
  }
}

describe("Canvas renderer request handler", () => {
  test("prepares and finishes the exact active Canvas mutation lease", async () => {
    const currentEditor = editor()
    const host = handler({ editor: currentEditor })

    await expect(host.request({ leaseId: "lease-1", ref, type: "document.mutation.prepare" })).resolves.toEqual({
      leaseId: "lease-1",
      prepared: true,
      ref,
      type: "document.mutation.prepare",
    })
    expect(currentEditor.beginExternalMutation).toHaveBeenCalledTimes(1)

    await expect(
      host.request({ leaseId: "lease-1", outcome: "committed", ref, type: "document.mutation.finish" }),
    ).resolves.toEqual({ finished: true, leaseId: "lease-1", ref, type: "document.mutation.finish" })
    expect(currentEditor.endExternalMutation).toHaveBeenCalledWith("committed")
  })

  test("reserves an inactive Canvas until Main finishes its direct access", async () => {
    const currentEditor = editor()
    const host = handler({ active: { canvasId: "canvas-2", scopeId: ref.scopeId }, editor: currentEditor })

    await expect(host.request({ leaseId: "lease-1", ref, type: "document.mutation.prepare" })).resolves.toEqual({
      leaseId: "lease-1",
      prepared: false,
      ref,
      type: "document.mutation.prepare",
    })
    expect(currentEditor.beginExternalMutation).not.toHaveBeenCalled()
    expect(host.getReserved()).toEqual(ref)

    await expect(
      host.request({ leaseId: "lease-1", outcome: "committed", ref, type: "document.mutation.finish" }),
    ).resolves.toMatchObject({ finished: true })
    expect(host.getReserved()).toBeNull()
  })

  test("fails closed when the active Canvas has no editor", async () => {
    const host = handler({ editor: null })

    await expect(host.request({ leaseId: "lease-1", ref, type: "document.mutation.prepare" })).rejects.toThrow(
      "active Canvas editor is unavailable",
    )
  })

  test("rejects a finish with a different lease or document ref", async () => {
    const currentEditor = editor()
    const host = handler({ editor: currentEditor })
    await host.request({ leaseId: "lease-1", ref, type: "document.mutation.prepare" })

    await expect(
      host.request({ leaseId: "lease-2", outcome: "aborted", ref, type: "document.mutation.finish" }),
    ).rejects.toThrow("did not match")
    await expect(
      host.request({
        leaseId: "lease-1",
        outcome: "aborted",
        ref: { ...ref, canvasId: "canvas-2" },
        type: "document.mutation.finish",
      }),
    ).rejects.toThrow("did not match")
    expect(currentEditor.endExternalMutation).not.toHaveBeenCalled()
  })

  test("aborts and releases the prepared editor when the active Canvas changes before finish", async () => {
    const currentEditor = editor()
    const host = handler({ editor: currentEditor })
    await host.request({ leaseId: "lease-1", ref, type: "document.mutation.prepare" })
    host.setActive({ ...ref, canvasId: "canvas-2" })

    await expect(
      host.request({ leaseId: "lease-1", outcome: "committed", ref, type: "document.mutation.finish" }),
    ).rejects.toThrow("changed before")
    expect(currentEditor.endExternalMutation).toHaveBeenCalledWith("aborted")

    host.setActive(ref)
    await expect(host.request({ leaseId: "lease-2", ref, type: "document.mutation.prepare" })).resolves.toMatchObject({
      leaseId: "lease-2",
      prepared: true,
    })
  })

  test("cancels and releases a preparation that finishes after Main timed out", async () => {
    let releaseBegin!: () => void
    const begin = new Promise<void>((resolve) => {
      releaseBegin = resolve
    })
    const currentEditor = editor()
    currentEditor.beginExternalMutation = mock(() => begin)
    const host = handler({ editor: currentEditor })
    const preparing = host.request({ leaseId: "lease-timeout", ref, type: "document.mutation.prepare" })

    await Promise.resolve()
    await expect(host.request({ leaseId: "lease-timeout", ref, type: "document.mutation.cancel" })).resolves.toEqual({
      canceled: true,
      leaseId: "lease-timeout",
      ref,
      type: "document.mutation.cancel",
    })
    releaseBegin()
    await expect(preparing).rejects.toThrow("preparation was canceled")
    expect(currentEditor.endExternalMutation).toHaveBeenCalledWith("aborted")
    expect(host.getReserved()).toBeNull()
  })

  test("passes cancellation into a preparation that would otherwise never settle", async () => {
    let receivedSignal: AbortSignal | undefined
    const currentEditor = editor()
    currentEditor.beginExternalMutation = mock(
      (signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          receivedSignal = signal
          signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Canceled", "AbortError")), {
            once: true,
          })
        }),
    )
    const host = handler({ editor: currentEditor })
    const preparing = host.request({ leaseId: "lease-never", ref, type: "document.mutation.prepare" })
    await Promise.resolve()

    await expect(
      host.request({ leaseId: "lease-never", ref, type: "document.mutation.cancel" }),
    ).resolves.toMatchObject({
      canceled: true,
    })
    await expect(preparing).rejects.toThrow("preparation was canceled")
    expect(receivedSignal?.aborted).toBeTrue()
    expect(host.getReserved()).toBeNull()
  })

  test("fails closed if an inactive reserved Canvas becomes active before finish", async () => {
    const host = handler({ active: { ...ref, canvasId: "other" } })
    await host.request({ leaseId: "lease-1", ref, type: "document.mutation.prepare" })
    host.setActive(ref)

    await expect(
      host.request({ leaseId: "lease-1", outcome: "committed", ref, type: "document.mutation.finish" }),
    ).rejects.toThrow("became active")
    expect(host.getReserved()).toBeNull()
  })
})
