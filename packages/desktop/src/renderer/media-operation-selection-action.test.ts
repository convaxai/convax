import { describe, expect, test } from "bun:test"
import {
  createCanvasDocument,
  createCanvasSelectionActionContext,
  createGroupNode,
  createMediaNode,
  createTextNode,
} from "@convax/canvas"
import { projectFileReferenceKey } from "@convax/project/canvas"
import type { InstalledWebPluginSummary } from "../plugin-contracts"
import {
  canResumeMediaOperation,
  canRunMediaOperation,
  createMediaOperationGenerateRequest,
  createMediaOperationGenerateRequests,
  isManagedProjectVideoSelection,
  isMediaOperationDialogInScope,
  listInstalledMediaOperationActions,
  mediaOperationResultAnchor,
  validateMediaOperationInput,
} from "./media-operation-selection-action"

const signal = new AbortController().signal
const managedVideo = createMediaNode({
  id: "managed-video",
  position: { x: 40, y: 60 },
  resource: {
    height: 720,
    id: "managed-video-resource",
    kind: "video",
    metadata: { [projectFileReferenceKey]: { path: ".convax/assets/source.mp4" } },
    mimeType: "video/mp4",
    url: "convax-asset://project/source.mp4",
    width: 1_280,
  },
})
const remoteVideo = createMediaNode({
  id: "remote-video",
  position: { x: 0, y: 0 },
  resource: { id: "remote-video-resource", kind: "video", url: "https://example.com/source.mp4" },
})
const text = createTextNode({ id: "text", position: { x: 0, y: 0 }, text: "no" })

function selection(nodeIds: string[], edgeIds: string[] = []) {
  const document = createCanvasDocument({ id: "canvas", title: "Canvas" })
  return createCanvasSelectionActionContext(
    { ...document, nodes: [managedVideo, remoteVideo, text], revision: 7 },
    nodeIds,
    edgeIds,
    signal,
  )
}

function operationPlugin(schema: "convax.plugin/3" | "convax.plugin/4" = "convax.plugin/3"): InstalledWebPluginSummary {
  const localized = (defaultText: string, chinese: string) => ({ default: defaultText, "zh-CN": chinese })
  return {
    capabilities: [],
    contributes: {
      agent: { tools: [{ id: "run_video", tool: "raw.video" }] },
      canvas: {
        selectionActions: [
          {
            description: localized("Extract one frame.", "抽取一帧。"),
            editor: "time-point",
            id: "extract-frame",
            steps: [{ tool: "frame.extract" }],
            target: "video",
            title: localized("Extract frame", "抽帧"),
          },
          {
            description: localized("Trim a range.", "截取一段视频。"),
            editor: "time-range",
            id: "trim",
            steps: [{ tool: "video.trim" }],
            target: "video",
            title: localized("Trim video", "截取视频"),
          },
          {
            description: localized("Crop the picture.", "裁剪画面。"),
            editor: "crop-region",
            id: "crop",
            steps: [{ tool: "video.crop" }],
            target: "video",
            title: localized("Crop video", "裁剪视频"),
          },
          {
            description: localized("Create video and audio outputs.", "创建视频和音频结果。"),
            editor: "confirmation",
            id: "split",
            steps: [{ tool: "video.silent" }, { tool: "audio.extract" }],
            target: "video",
            title: localized("Separate audio and video", "音视频分离"),
          },
        ],
      },
      generation: {
        models: [],
        tools: [
          tool("raw.video", "video"),
          tool("frame.extract", "image"),
          tool("video.trim", "video"),
          tool("video.crop", "video"),
          tool("video.silent", "video"),
          tool("audio.extract", "audio"),
        ],
      },
      ...(schema === "convax.plugin/4" ? { skills: [{ name: "media-workflow", path: "skills/media-workflow" }] } : {}),
    },
    description: "A replaceable media operation Plugin.",
    id: "acme-media",
    name: "Acme Media",
    runtime: { command: "acme-media-mcp", type: "mcp-stdio" },
    schema,
    version: "1.0.0",
  }
}

function tool(id: string, output: "audio" | "image" | "video") {
  return {
    acceptedInputs: ["reference_video" as const],
    description: `${id} operation`,
    id,
    output,
    title: id,
  }
}

describe("manifest-driven media operation visibility", () => {
  test("discovers actions from an arbitrary installed Plugin without knowing its id", () => {
    const actions = listInstalledMediaOperationActions([operationPlugin()])
    expect(actions.map((action) => action.id)).toEqual(["extract-frame", "trim", "crop", "split"])
    expect(actions[0]).toMatchObject({
      pluginId: "acme-media",
      steps: [{ output: "image", toolId: "acme-media/frame.extract" }],
    })
    expect(listInstalledMediaOperationActions([])).toEqual([])
  })

  test("preserves manifest-driven actions for a v4 Plugin with owned Skills", () => {
    const v3Actions = listInstalledMediaOperationActions([operationPlugin()])
    const v4Plugin = operationPlugin("convax.plugin/4")

    expect(v4Plugin.contributes.skills).toEqual([{ name: "media-workflow", path: "skills/media-workflow" }])
    expect(listInstalledMediaOperationActions([v4Plugin])).toEqual(v3Actions)
  })

  test("accepts exactly one managed Project video without a selected edge", () => {
    const action = listInstalledMediaOperationActions([operationPlugin()])[0]!
    expect(canRunMediaOperation(selection([managedVideo.id]), action)).toBe(true)
    expect(isManagedProjectVideoSelection(selection([]))).toBe(false)
    expect(isManagedProjectVideoSelection(selection([managedVideo.id, text.id]))).toBe(false)
    expect(isManagedProjectVideoSelection(selection([managedVideo.id], ["edge"]))).toBe(false)
    expect(isManagedProjectVideoSelection(selection([remoteVideo.id]))).toBe(false)
  })
})

describe("manifest-driven media operation requests", () => {
  test("passes editor values to the declared operation tool without building vendor argv", () => {
    const context = selection([managedVideo.id])
    const actions = listInstalledMediaOperationActions([operationPlugin()])
    const trim = actions.find((action) => action.id === "trim")!
    const request = createMediaOperationGenerateRequest(
      { action: trim, canvasId: "canvas", context, projectId: "project" },
      { durationSeconds: 3, startSeconds: 1 },
    )
    expect(request).toMatchObject({
      context: {
        documentId: "canvas",
        selectedNodeIds: [managedVideo.id],
        source: "desktop:plugin-selection-action:acme-media/trim",
      },
      output: "video",
      references: [{ nodeId: managedVideo.id, role: "reference_video" }],
      toolId: "acme-media/video.trim",
      toolInput: { duration_seconds: 3, start_seconds: 1 },
    })
    expect(request.toolInput).not.toHaveProperty("arguments_json")
  })

  test("creates a generic linked multi-step workflow from the declaration", () => {
    const context = selection([managedVideo.id])
    const split = listInstalledMediaOperationActions([operationPlugin()]).find((action) => action.id === "split")!
    const requests = createMediaOperationGenerateRequests(
      { action: split, canvasId: "canvas", context, projectId: "project" },
      {},
    )
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({ output: "video", toolId: "acme-media/video.silent" })
    expect(requests[1]).toMatchObject({ output: "audio", toolId: "acme-media/audio.extract" })
    expect(requests[0].toolInput).toBeUndefined()
    expect(requests[1].anchor).toEqual({ x: requests[0].anchor.x, y: requests[0].anchor.y + 224 })
    expect(() =>
      createMediaOperationGenerateRequest({ action: split, canvasId: "canvas", context, projectId: "project" }, {}),
    ).toThrow("creates multiple Canvas results")
  })

  test("rejects invalid time ranges and crop geometry before execution", () => {
    expect(validateMediaOperationInput("time-point", { timeSeconds: -1 })).toBeDefined()
    expect(validateMediaOperationInput("time-range", { durationSeconds: 0, startSeconds: 0 })).toBeDefined()
    expect(
      validateMediaOperationInput(
        "time-range",
        { durationSeconds: 2.001, startSeconds: 8 },
        { videoDurationSeconds: 10 },
      ),
    ).toBe("Trim end time cannot exceed the video duration.")
    expect(validateMediaOperationInput("crop-region", { height: 721, width: 1_280, x: 0, y: 0 })).toBeDefined()
    expect(validateMediaOperationInput("crop-region", { height: 720, width: 1_280, x: 0, y: 0 })).toBeUndefined()
  })

  test("places results beside a nested source in Canvas world coordinates", () => {
    const group = createGroupNode({ id: "group", height: 400, position: { x: 500, y: 200 }, width: 600 })
    const nestedVideo = { ...managedVideo, parentId: group.id, position: { x: 30, y: 40 } }
    expect(mediaOperationResultAnchor(nestedVideo, [group, nestedVideo])).toEqual({
      x: 500 + 30 + 320 + 64,
      y: 200 + 40,
    })
  })

  test("binds a dialog to its original scope and verifies resumable partial output", () => {
    const context = selection([managedVideo.id])
    const split = listInstalledMediaOperationActions([operationPlugin()]).find((action) => action.id === "split")!
    const request = { action: split, canvasId: "canvas", context, projectId: "project" }
    expect(isMediaOperationDialogInScope(request, "project", "canvas")).toBe(true)
    expect(isMediaOperationDialogInScope(request, "project", "other")).toBe(false)

    const completedVideo = createMediaNode({
      id: "silent-video",
      position: { x: 400, y: 60 },
      resource: {
        id: "silent-video-resource",
        kind: "video",
        metadata: { [projectFileReferenceKey]: { path: ".convax/assets/silent-video.mp4" } },
        mimeType: "video/mp4",
        url: "convax-asset://project/silent-video.mp4",
      },
    })
    const current = {
      ...context.document,
      edges: [{ id: "source-result", source: managedVideo.id, target: completedVideo.id, type: "canvas" as const }],
      nodes: [...context.document.nodes, completedVideo],
      revision: 9,
    }
    expect(canResumeMediaOperation(request, current, [completedVideo.id])).toBe(true)
    expect(canResumeMediaOperation(request, { ...current, edges: [] }, [completedVideo.id])).toBe(false)
  })
})
