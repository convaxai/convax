import { describe, expect, test } from "bun:test"
import {
  createCanvasDocument,
  createCanvasSelectionActionContext,
  createGroupNode,
  createMediaNode,
  createTextNode,
} from "@convax/canvas"
import { projectResourceReferenceKey } from "@convax/project/canvas"
import type { InstalledWebPluginSummary } from "../plugin-contracts"
import {
  canResumeMediaOperation,
  canRunMediaOperation,
  createMediaOperationGenerateRequest,
  createMediaOperationGenerateRequests,
  createMediaOperationReturnRequest,
  isManagedProjectMediaSelection,
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
const projectFileVideo = createMediaNode({
  id: "project-file-video",
  position: { x: 40, y: 60 },
  resource: {
    id: "project-file-video-resource",
    kind: "video",
    metadata: {
      [projectResourceReferenceKey]: { kind: "project-file", path: "Media/project-file-video.mp4" },
    },
    state: { status: "ready", url: "convax-project://Media/project-file-video.mp4" },
  },
})
const managedImage = createMediaNode({
  id: "managed-image",
  position: { x: 20, y: 30 },
  resource: {
    height: 720,
    id: "managed-image-resource",
    kind: "image",
    metadata: {
      [projectResourceReferenceKey]: {
        kind: "managed-asset",
        mediaType: "image/png",
        name: "source.png",
        sha256: "b".repeat(64),
      },
    },
    mimeType: "image/png",
    state: { status: "ready", url: "convax-asset://project/source.png" },
    width: 1_280,
  },
})
const remoteVideo = createMediaNode({
  id: "remote-video",
  position: { x: 0, y: 0 },
  resource: {
    id: "remote-video-resource",
    kind: "video",
    metadata: {},
    state: { status: "ready", url: "https://example.com/source.mp4" },
  },
})
const text = createTextNode({
  id: "text",
  metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/no.md" } },
  position: { x: 0, y: 0 },
  resourceState: { status: "ready", text: "no" },
})

function selection(nodeIds: string[], edgeIds: string[] = []) {
  const document = createCanvasDocument({ id: "canvas", title: "Canvas" })
  return createCanvasSelectionActionContext(
    { ...document, nodes: [managedImage, managedVideo, projectFileVideo, remoteVideo, text], revision: 7 },
    nodeIds,
    edgeIds,
    signal,
  )
}

function operationPlugin(withSkill = false): InstalledWebPluginSummary {
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
      ...(withSkill ? { skills: [{ name: "media-workflow", path: "skills/media-workflow" }] } : {}),
    },
    description: "A replaceable media operation Plugin.",
    hostApi: { major: 1, optional: [], required: [] },
    id: "acme-media",
    name: "Acme Media",
    runtime: { command: "acme-media-mcp", type: "mcp-stdio" },
    schema: "convax.plugin/8",
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

function returnOperationPlugin(): InstalledWebPluginSummary {
  const plugin = operationPlugin()
  return {
    ...plugin,
    contributes: {
      ...plugin.contributes,
      canvas: {
        selectionActions: [
          {
            description: { default: "Import the selected media.", "zh-CN": "导入选中的素材。" },
            editor: "confirmation",
            id: "import-image",
            steps: [{ tool: "media.import-selected" }],
            target: "image",
            title: { default: "Import", "zh-CN": "导入" },
          },
          {
            description: { default: "Import the selected media.", "zh-CN": "导入选中的素材。" },
            editor: "confirmation",
            id: "import-video",
            steps: [{ tool: "media.import-selected" }],
            target: "video",
            title: { default: "Import", "zh-CN": "导入" },
          },
        ],
      },
      generation: {
        models: [],
        tools: [
          {
            acceptedInputs: ["reference_image", "reference_video"],
            delivery: "return",
            description: "Import selected media",
            id: "media.import-selected",
            output: "text",
            title: "Import selected media",
          },
        ],
      },
    },
  }
}

function immediateImageOperationPlugin(): InstalledWebPluginSummary {
  return {
    capabilities: [],
    contributes: {
      canvas: {
        selectionActions: [
          {
            description: { default: "Create a transparent PNG beside the selected image." },
            editor: "immediate",
            id: "remove-background",
            presentation: "cutout-scan",
            steps: [{ tool: "background.remove" }],
            target: "image",
            title: { default: "Remove background", "zh-CN": "抠图" },
          },
        ],
      },
      generation: {
        models: [],
        tools: [
          {
            acceptedInputs: ["reference_image"],
            description: "Remove the image background.",
            id: "background.remove",
            output: "image",
            title: "Remove background",
          },
        ],
      },
    },
    description: "Local cutout",
    hostApi: { major: 1, optional: [], required: [] },
    id: "cutout-studio",
    name: "Cutout Studio",
    runtime: { command: "convax-cutout-mcp", type: "mcp-stdio" },
    schema: "convax.plugin/8",
    version: "0.2.0",
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

  test("preserves manifest-driven actions for a v8 Plugin with owned Skills", () => {
    const plainActions = listInstalledMediaOperationActions([operationPlugin()])
    const pluginWithSkill = operationPlugin(true)

    expect(pluginWithSkill.contributes.skills).toEqual([{ name: "media-workflow", path: "skills/media-workflow" }])
    expect(listInstalledMediaOperationActions([pluginWithSkill])).toEqual(plainActions)
  })

  test("rejects legacy manifests instead of retaining schema aliases", () => {
    const legacy = {
      ...operationPlugin(),
      schema: "convax.plugin/7",
    } as unknown as InstalledWebPluginSummary
    expect(listInstalledMediaOperationActions([legacy])).toEqual([])
  })

  test("accepts exactly one Project-backed video without a selected edge", () => {
    const action = listInstalledMediaOperationActions([operationPlugin()])[0]!
    expect(canRunMediaOperation(selection([managedVideo.id]), action)).toBe(true)
    expect(canRunMediaOperation(selection([projectFileVideo.id]), action)).toBe(true)
    expect(isManagedProjectVideoSelection(selection([]))).toBe(false)
    expect(isManagedProjectVideoSelection(selection([managedVideo.id, text.id]))).toBe(false)
    expect(isManagedProjectVideoSelection(selection([managedVideo.id], ["edge"]))).toBe(false)
    expect(isManagedProjectVideoSelection(selection([remoteVideo.id]))).toBe(false)
  })

  test("discovers bounded return actions for one Project-backed image or video", () => {
    const actions = listInstalledMediaOperationActions([returnOperationPlugin()])
    const imageAction = actions.find((action) => action.id === "import-image")!
    const videoAction = actions.find((action) => action.id === "import-video")!

    expect(imageAction).toMatchObject({
      delivery: "return",
      steps: [{ output: "text", toolId: "acme-media/media.import-selected" }],
      target: "image",
    })
    expect(canRunMediaOperation(selection([managedImage.id]), imageAction)).toBe(true)
    expect(canRunMediaOperation(selection([managedVideo.id]), imageAction)).toBe(false)
    expect(canRunMediaOperation(selection([managedVideo.id]), videoAction)).toBe(true)
    expect(isManagedProjectMediaSelection(selection([managedImage.id]), "image")).toBe(true)
    expect(isManagedProjectMediaSelection(selection([remoteVideo.id]), "video")).toBe(false)
  })

  test("discovers one immediate adjacent-image operation with its bounded presentation", () => {
    const action = listInstalledMediaOperationActions([immediateImageOperationPlugin()])[0]!
    expect(action).toMatchObject({
      delivery: "canvas",
      editor: "immediate",
      presentation: "cutout-scan",
      steps: [{ output: "image", toolId: "cutout-studio/background.remove" }],
      target: "image",
    })
    expect(canRunMediaOperation(selection([managedImage.id]), action)).toBe(true)
    expect(canRunMediaOperation(selection([managedVideo.id]), action)).toBe(false)
  })

  test("hides executable actions unless Main currently admits their exact operation tools", () => {
    const plugin = returnOperationPlugin()
    expect(listInstalledMediaOperationActions([plugin], new Set())).toEqual([])
    expect(
      listInstalledMediaOperationActions([plugin], new Set(["acme-media/media.import-selected"])).map(
        (action) => action.id,
      ),
    ).toEqual(["import-image", "import-video"])
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

  test("creates a host-only return request for the exact selected Project media reference", () => {
    const context = selection([managedImage.id])
    const action = listInstalledMediaOperationActions([returnOperationPlugin()]).find(
      (candidate) => candidate.id === "import-image",
    )!
    expect(
      createMediaOperationReturnRequest({ action, canvasId: "canvas", context, projectId: "project" }, "operation-1"),
    ).toMatchObject({
      expectedOutputCount: 1,
      expectedRevision: 7,
      operationId: "operation-1",
      output: "text",
      prompt: "Import the selected media.",
      ref: { canvasId: "canvas", scopeId: "project" },
      references: [{ nodeId: managedImage.id, role: "reference_image" }],
      resultMode: { type: "return" },
      toolId: "acme-media/media.import-selected",
    })
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

  test("creates an adjacent pending image request from the selected image", () => {
    const context = selection([managedImage.id])
    const action = listInstalledMediaOperationActions([immediateImageOperationPlugin()])[0]!
    const request = createMediaOperationGenerateRequest(
      { action, canvasId: "canvas", context, projectId: "project" },
      {},
    )
    expect(request).toMatchObject({
      context: {
        documentId: "canvas",
        selectedNodeIds: [managedImage.id],
        source: "desktop:plugin-selection-action:cutout-studio/remove-background",
      },
      output: "image",
      references: [{ nodeId: managedImage.id, role: "reference_image" }],
      resultMode: { type: "create-pending-node" },
      toolId: "cutout-studio/background.remove",
    })
    expect(request.anchor.x).toBeGreaterThan(managedImage.position.x)
    expect(request.toolInput).toBeUndefined()
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
        metadata: {
          [projectResourceReferenceKey]: { kind: "project-file", path: "Generated/silent-video.mp4" },
        },
        mimeType: "video/mp4",
        state: { status: "ready", url: "convax-asset://project/silent-video.mp4" },
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
