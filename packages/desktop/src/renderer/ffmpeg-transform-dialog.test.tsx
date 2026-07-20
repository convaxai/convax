import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createCanvasSelectionActionContext, createMediaNode } from "@convax/canvas"
import { renderToStaticMarkup } from "react-dom/server"
import { projectFileReferenceKey } from "@convax/project/canvas"
import type { FfmpegTransformDialogRequest } from "./ffmpeg-selection-action"
import { FfmpegTransformDialog, shouldCloseFfmpegDialogAfterFailure } from "./ffmpeg-transform-dialog"

function request(kind: FfmpegTransformDialogRequest["kind"]): FfmpegTransformDialogRequest {
  const node = createMediaNode({
    id: "video",
    position: { x: 0, y: 0 },
    resource: {
      height: 720,
      id: "resource",
      kind: "video",
      metadata: { [projectFileReferenceKey]: { path: ".convax/assets/video/source.mp4" } },
      mimeType: "video/mp4",
      url: "convax-asset://project/source.mp4",
      width: 1_280,
    },
  })
  const document = { ...createCanvasDocument({ id: "canvas", title: "Canvas" }), nodes: [node] }
  return {
    canvasId: "canvas",
    context: createCanvasSelectionActionContext(document, [node.id], [], new AbortController().signal),
    kind,
    projectId: "project",
  }
}

describe("FfmpegTransformDialog", () => {
  test("renders stable whitespace-free field ids", () => {
    const markup = renderToStaticMarkup(
      <FfmpegTransformDialog
        locale="en"
        onClose={() => undefined}
        onConfirm={async () => undefined}
        request={request("trim")}
      />,
    )
    const ids = [...markup.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1])
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => !/\s/u.test(id))).toBe(true)
    expect(markup).toContain('role="dialog"')
  })

  test("requires even crop coordinates and dimensions in the form", () => {
    const markup = renderToStaticMarkup(
      <FfmpegTransformDialog
        locale="zh-CN"
        onClose={() => undefined}
        onConfirm={async () => undefined}
        request={request("crop")}
      />,
    )
    expect(markup.match(/step="2"/gu)).toHaveLength(4)
    expect(markup).toContain("坐标、宽度和高度都必须是偶数")
  })

  test("closes after a failed transform when either operation or Canvas context became stale", () => {
    const context = new AbortController()
    const operation = new AbortController()
    expect(shouldCloseFfmpegDialogAfterFailure(context.signal, operation.signal)).toBeFalse()

    context.abort(new DOMException("Canvas changed", "AbortError"))
    expect(shouldCloseFfmpegDialogAfterFailure(context.signal, operation.signal)).toBeTrue()

    const freshContext = new AbortController()
    operation.abort(new DOMException("Canceled", "AbortError"))
    expect(shouldCloseFfmpegDialogAfterFailure(freshContext.signal, operation.signal)).toBeTrue()
  })
})
