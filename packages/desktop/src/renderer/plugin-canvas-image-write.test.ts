import { expect, mock, test } from "bun:test"
import { createCanvasDocument } from "@convax/canvas"

import { executePluginCanvasImageWrite, preparePluginCanvasImageWrite } from "./plugin-canvas-image-write"

test("waits for a pending renderer flush and uses Main's authoritative projection", async () => {
  let releaseSave!: (document: ReturnType<typeof createCanvasDocument>) => void
  const pendingSave = new Promise<ReturnType<typeof createCanvasDocument>>((resolve) => {
    releaseSave = resolve
  })
  const assertCurrentScope = mock(() => undefined)
  let settled = false
  const write = preparePluginCanvasImageWrite(
    {
      canvasId: "canvas-1",
      projectId: "project-1",
      signal: new AbortController().signal,
    },
    {
      assertCurrentScope,
      flushAuthoritativeCanvas: () => pendingSave,
    },
  ).then((document) => {
    settled = true
    return document
  })

  await Promise.resolve()
  expect(settled).toBeFalse()

  releaseSave(createCanvasDocument({ id: "canvas-1" }))
  await expect(write).resolves.toMatchObject({ id: "canvas-1" })
  expect(assertCurrentScope).toHaveBeenCalledTimes(2)
})

test("rechecks scope and cancellation after the authoritative save barrier", async () => {
  let activeCanvasId = "canvas-1"
  const controller = new AbortController()
  let releaseSave!: (document: ReturnType<typeof createCanvasDocument>) => void
  const pendingSave = new Promise<ReturnType<typeof createCanvasDocument>>((resolve) => {
    releaseSave = resolve
  })
  const write = preparePluginCanvasImageWrite(
    {
      canvasId: "canvas-1",
      projectId: "project-1",
      signal: controller.signal,
    },
    {
      assertCurrentScope: (_projectId, canvasId) => {
        if (canvasId !== activeCanvasId) throw new Error("Plugin call is no longer in the active Canvas")
      },
      flushAuthoritativeCanvas: () => pendingSave,
    },
  )

  activeCanvasId = "canvas-2"
  releaseSave(createCanvasDocument({ id: "canvas-1" }))
  await expect(write).rejects.toThrow("Plugin call is no longer in the active Canvas")

  const canceled = new AbortController()
  const cancellation = new Error("Canceled after save")
  const canceledWrite = preparePluginCanvasImageWrite(
    {
      canvasId: "canvas-1",
      projectId: "project-1",
      signal: canceled.signal,
    },
    {
      assertCurrentScope: () => undefined,
      flushAuthoritativeCanvas: async () => {
        canceled.abort(cancellation)
        return { ...createCanvasDocument({ id: "canvas-1" }), revision: 4 }
      },
    },
  )
  await expect(canceledWrite).rejects.toBe(cancellation)
})

test("does not invoke Main when cancellation wins in the post-barrier microtask gap", async () => {
  const controller = new AbortController()
  const cancellation = new Error("Canceled before Main")
  const cancel = mock(() => undefined)
  const writeMain = mock(async () => ({ createdNodeIds: ["frame-1"] }))
  let scopeChecks = 0

  const write = executePluginCanvasImageWrite(
    {
      canvasId: "canvas-1",
      projectId: "project-1",
      signal: controller.signal,
    },
    {
      assertCurrentScope: () => {
        scopeChecks += 1
        if (scopeChecks === 2) queueMicrotask(() => controller.abort(cancellation))
      },
      cancel,
      flushAuthoritativeCanvas: async () => ({ ...createCanvasDocument({ id: "canvas-1" }), revision: 5 }),
      write: writeMain,
    },
  )

  await expect(write).rejects.toBe(cancellation)
  expect(writeMain).not.toHaveBeenCalled()
  expect(cancel).not.toHaveBeenCalled()
})

test("does not invoke Main when Canvas scope changes in the post-barrier microtask gap", async () => {
  let active = true
  let scopeChecks = 0
  const writeMain = mock(async () => ({ createdNodeIds: ["frame-1"] }))

  const write = executePluginCanvasImageWrite(
    {
      canvasId: "canvas-1",
      projectId: "project-1",
      signal: new AbortController().signal,
    },
    {
      assertCurrentScope: () => {
        scopeChecks += 1
        if (!active) throw new Error("Plugin call is no longer in the active Canvas")
        if (scopeChecks === 2) {
          queueMicrotask(() => {
            active = false
          })
        }
      },
      cancel: () => undefined,
      flushAuthoritativeCanvas: async () => ({ ...createCanvasDocument({ id: "canvas-1" }), revision: 6 }),
      write: writeMain,
    },
  )

  await expect(write).rejects.toThrow("Plugin call is no longer in the active Canvas")
  expect(writeMain).not.toHaveBeenCalled()
})
