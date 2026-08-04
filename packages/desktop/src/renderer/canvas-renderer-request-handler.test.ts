import { describe, expect, mock, test } from "bun:test"
import type { CanvasDocumentRef } from "@convax/canvas/application"
import { createCanvasRendererRequestHandler, type CanvasRendererEditorHandle } from "./canvas-renderer-request-handler"

const ref: CanvasDocumentRef = { canvasId: "canvas-1", scopeId: "project-1" }

function handler(input: { active?: CanvasDocumentRef | null; editor?: CanvasRendererEditorHandle | null } = {}) {
  const reloadAuthoritative = mock(async () => undefined)
  const execute = mock(async (request) => ({
    foundNodeIds: [],
    missingNodeIds: [],
    snapshot: {
      documentId: "canvas-1",
      revision: request.expectedRevision,
      scopeId: "project-1",
      selectedEdgeIds: [],
      selectedNodeIds: [],
      viewId: request.viewId,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  }))
  const snapshot = {
    documentId: "canvas-1",
    revision: 4,
    scopeId: "project-1",
    selectedEdgeIds: [],
    selectedNodeIds: [],
    viewId: "desktop-main",
    viewport: { x: 0, y: 0, zoom: 1 },
  }
  const request = createCanvasRendererRequestHandler({
    getActiveRef: () => (input.active === undefined ? ref : input.active),
    getEditor: () => (input.editor === undefined ? { reloadAuthoritative } : input.editor),
    views: { execute, list: () => [snapshot] },
  })
  return { execute, reloadAuthoritative, request, snapshot }
}

describe("Canvas renderer request handler", () => {
  test("reloads the active editor from Main without saving its current projection", async () => {
    const host = handler()

    await expect(host.request({ ref, type: "document.reload" })).resolves.toEqual({
      reloaded: true,
      type: "document.reload",
    })
    expect(host.reloadAuthoritative).toHaveBeenCalledTimes(1)
  })

  test("does not reload an inactive or unmounted Canvas", async () => {
    const inactive = handler({ active: { ...ref, canvasId: "canvas-2" } })
    const unmounted = handler({ editor: null })

    await expect(inactive.request({ ref, type: "document.reload" })).resolves.toEqual({
      reloaded: false,
      type: "document.reload",
    })
    await expect(unmounted.request({ ref, type: "document.reload" })).resolves.toEqual({
      reloaded: false,
      type: "document.reload",
    })
  })

  test("serves view queries and commands as projection-only requests", async () => {
    const host = handler()

    await expect(host.request({ type: "view.snapshot", viewId: "desktop-main" })).resolves.toEqual({
      snapshot: host.snapshot,
      type: "view.snapshot",
    })
    await expect(
      host.request({
        input: {
          command: { type: "selection.clear" },
          expectedDocumentId: "canvas-1",
          expectedScopeId: "project-1",
          viewId: "desktop-main",
        },
        type: "view.execute",
      }),
    ).resolves.toMatchObject({ type: "view.execute" })
    expect(host.execute).toHaveBeenCalledTimes(1)
  })
})
