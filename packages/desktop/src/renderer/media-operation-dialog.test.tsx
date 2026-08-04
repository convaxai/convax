import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createCanvasSelectionActionContext, createMediaNode } from "@convax/canvas"
import { projectResourceReferenceKey } from "@convax/project/canvas"
import { renderToStaticMarkup } from "react-dom/server"
import { MediaOperationDialog, shouldCloseMediaDialogAfterFailure } from "./media-operation-dialog"
import type {
  MediaOperationAction,
  MediaOperationDialogRequest,
  MediaOperationEditor,
} from "./media-operation-selection-action"
import { MediaOperationPartialError } from "./media-operation-runner"

function request(editor: MediaOperationEditor): MediaOperationDialogRequest {
  const node = createMediaNode({
    id: "video",
    position: { x: 0, y: 0 },
    resource: {
      durationMs: 10_000,
      height: 720,
      id: "resource",
      kind: "video",
      metadata: {
        [projectResourceReferenceKey]: {
          kind: "managed-asset",
          mediaType: "video/mp4",
          name: "source.mp4",
          sha256: "a".repeat(64),
        },
      },
      mimeType: "video/mp4",
      state: { status: "ready", url: "convax-asset://project/source.mp4" },
      width: 1_280,
    },
  })
  const document = { ...createCanvasDocument({ id: "canvas", title: "Canvas" }), nodes: [node] }
  return {
    action: action(editor),
    canvasId: "canvas",
    context: createCanvasSelectionActionContext(document, [node.id], [], new AbortController().signal),
    projectId: "project",
  }
}

function action(editor: MediaOperationEditor): MediaOperationAction {
  const confirmation = editor === "confirmation"
  return {
    delivery: "canvas",
    description: {
      default: confirmation ? "Create separate video and audio results." : "Edit the selected video.",
      "zh-CN": confirmation ? "创建独立的视频和音频结果，两张卡片会彼此关联。" : "编辑所选视频。",
    },
    editor,
    id: `action-${editor}`,
    pluginId: "acme-media",
    steps: confirmation
      ? [
          { output: "video", toolId: "acme-media/video.silent" },
          { output: "audio", toolId: "acme-media/audio.extract" },
        ]
      : [{ output: editor === "time-point" ? "image" : "video", toolId: `acme-media/${editor}` }],
    target: "video",
    title: {
      default: confirmation ? "Separate audio and video" : "Video operation",
      "zh-CN": confirmation ? "音视频分离" : editor === "crop-region" ? "裁剪视频" : "截取视频",
    },
  }
}

describe("MediaOperationDialog", () => {
  test("renders a thumbnail timeline without numeric trim inputs", () => {
    const markup = renderToStaticMarkup(
      <MediaOperationDialog
        locale="en"
        onClose={() => undefined}
        onConfirm={async () => undefined}
        request={request("time-range")}
      />,
    )
    const ids = [...markup.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1])
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every((id) => !/\s/u.test(id))).toBe(true)
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('data-testid="media-trim-timeline"')
    expect(markup.match(/type="range"/gu)).toHaveLength(2)
    expect(markup).not.toContain('type="number"')
    expect(markup).toContain("00:00.000 – 00:10.000")
    expect(markup).toContain('src="convax-asset://project/source.mp4"')
  })

  test("renders a declared two-step operation without knowing the Plugin identity", () => {
    const markup = renderToStaticMarkup(
      <MediaOperationDialog
        locale="zh-CN"
        onClose={() => undefined}
        onConfirm={async () => undefined}
        request={request("confirmation")}
      />,
    )
    expect(markup).toContain("音视频分离")
    expect(markup).toContain("视频结果")
    expect(markup).toContain("音频结果")
    expect(markup).toContain("创建 2 个结果")
    expect(markup).not.toContain("FFmpeg")
  })

  test("renders crop as an autoplaying video with a draggable eight-handle frame", () => {
    const markup = renderToStaticMarkup(
      <MediaOperationDialog
        locale="zh-CN"
        onClose={() => undefined}
        onConfirm={async () => undefined}
        request={request("crop-region")}
      />,
    )
    expect(markup).toContain('data-testid="media-crop-editor"')
    expect(markup).toContain('aria-label="视频裁剪选框"')
    expect(markup.match(/data-crop-handle=/gu)).toHaveLength(8)
    expect(markup).toContain("拖动画面中的选框调整位置")
    expect(markup).toContain("输出尺寸: 1280 × 720")
    expect(markup).toContain('autoPlay=""')
    expect(markup).toContain('src="convax-asset://project/source.mp4"')
    expect(markup).not.toContain('type="number"')
  })

  test("closes after failure when either operation or Canvas context became stale", () => {
    const context = new AbortController()
    const operation = new AbortController()
    expect(shouldCloseMediaDialogAfterFailure(context.signal, operation.signal)).toBeFalse()
    context.abort(new DOMException("Canvas changed", "AbortError"))
    expect(shouldCloseMediaDialogAfterFailure(context.signal, operation.signal)).toBeTrue()
    const freshContext = new AbortController()
    operation.abort(new DOMException("Canceled", "AbortError"))
    expect(shouldCloseMediaDialogAfterFailure(freshContext.signal, operation.signal)).toBeTrue()
  })

  test("keeps a partially completed operation open when its selection context refreshes", () => {
    const context = new AbortController()
    const operation = new AbortController()
    context.abort(new DOMException("Canvas document refreshed", "AbortError"))
    const failure = new MediaOperationPartialError("Second step failed", {
      createdNodeIds: ["first-result"],
      nextRequestIndex: 1,
      warnings: [],
    })
    expect(shouldCloseMediaDialogAfterFailure(context.signal, operation.signal, failure)).toBeFalse()
    operation.abort(new DOMException("Canceled", "AbortError"))
    expect(shouldCloseMediaDialogAfterFailure(context.signal, operation.signal, failure)).toBeTrue()
  })
})
