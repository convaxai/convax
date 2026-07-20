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
  canResumeFfmpegAudioVideoSeparation,
  canRunFfmpegTransform,
  createFfmpegGenerateRequest,
  createFfmpegGenerateRequests,
  createFfmpegTransformPresets,
  ffmpegAudioToolId,
  ffmpegImageToolId,
  ffmpegResultAnchor,
  ffmpegVideoToolId,
  isFfmpegDialogInScope,
  isManagedProjectVideoSelection,
  validateFfmpegTransformInput,
} from "./ffmpeg-selection-action"

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

function ffmpegPlugin(
  overrides: Partial<InstalledWebPluginSummary["contributes"]["generation"]> = {},
): InstalledWebPluginSummary {
  return {
    capabilities: [],
    contributes: {
      generation: {
        tools: [
          {
            acceptedInputs: ["reference_video"],
            description: "Run FFmpeg and create an image.",
            id: "run.image",
            output: "image",
            title: "FFmpeg image",
          },
          {
            acceptedInputs: ["reference_video"],
            description: "Run FFmpeg and create audio.",
            id: "run.audio",
            output: "audio",
            title: "FFmpeg audio",
          },
          {
            acceptedInputs: ["reference_video"],
            description: "Run FFmpeg and create a video.",
            id: "run.video",
            output: "video",
            title: "FFmpeg video",
          },
        ],
        ...overrides,
      },
    },
    description: "Local FFmpeg tools",
    id: "ffmpeg-tools",
    name: "FFmpeg Tools",
    runtime: { command: "convax-ffmpeg-mcp", type: "mcp-stdio" },
    schema: "convax.plugin/2",
    version: "0.1.0",
  }
}

describe("FFmpeg toolbar visibility", () => {
  test("accepts exactly one managed Project video without a selected edge", () => {
    expect(isManagedProjectVideoSelection(selection([managedVideo.id]))).toBe(true)
    expect(isManagedProjectVideoSelection(selection([]))).toBe(false)
    expect(isManagedProjectVideoSelection(selection([managedVideo.id, text.id]))).toBe(false)
    expect(isManagedProjectVideoSelection(selection([managedVideo.id], ["edge"]))).toBe(false)
    expect(isManagedProjectVideoSelection(selection([remoteVideo.id]))).toBe(false)
  })

  test("resumes a partial separation only while the source and completed video still match", () => {
    const context = selection([managedVideo.id])
    const request = { canvasId: "canvas", context, kind: "separate-audio" as const, projectId: "project" }
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
      edges: [
        ...context.document.edges,
        { id: "source-to-silent-video", source: managedVideo.id, target: completedVideo.id, type: "canvas" as const },
      ],
      nodes: [...context.document.nodes, completedVideo],
      revision: 9,
    }

    expect(canResumeFfmpegAudioVideoSeparation(request, current, [completedVideo.id])).toBe(true)
    expect(canResumeFfmpegAudioVideoSeparation(request, { ...current, edges: [] }, [completedVideo.id])).toBe(false)
    expect(canResumeFfmpegAudioVideoSeparation(request, current, [])).toBe(false)
    expect(canResumeFfmpegAudioVideoSeparation(request, current, ["missing-video"])).toBe(false)
    expect(canResumeFfmpegAudioVideoSeparation(request, { ...current, id: "other-canvas" }, [completedVideo.id])).toBe(
      false,
    )
    expect(
      canResumeFfmpegAudioVideoSeparation(
        request,
        { ...current, nodes: current.nodes.filter((node) => node.id !== managedVideo.id) },
        [completedVideo.id],
      ),
    ).toBe(false)
    const replacementSource = createMediaNode({
      id: managedVideo.id,
      position: managedVideo.position,
      resource: {
        id: "replacement-resource",
        kind: "video",
        metadata: { [projectFileReferenceKey]: { path: ".convax/assets/replacement.mp4" } },
        mimeType: "video/mp4",
        url: "convax-asset://project/replacement.mp4",
      },
    })
    expect(
      canResumeFfmpegAudioVideoSeparation(
        request,
        {
          ...current,
          nodes: current.nodes.map((node) => (node.id === managedVideo.id ? replacementSource : node)),
        },
        [completedVideo.id],
      ),
    ).toBe(false)
  })

  test("requires the installed Plugin and the exact compatible tool declaration", () => {
    const context = selection([managedVideo.id])
    expect(canRunFfmpegTransform(context, [ffmpegPlugin()], "extract-frame")).toBe(true)
    expect(canRunFfmpegTransform(context, [ffmpegPlugin()], "separate-audio")).toBe(true)
    expect(canRunFfmpegTransform(context, [ffmpegPlugin()], "trim")).toBe(true)
    expect(canRunFfmpegTransform(context, [], "crop")).toBe(false)
    expect(canRunFfmpegTransform(context, [ffmpegPlugin({ tools: [] })], "extract-frame")).toBe(false)
    expect(
      canRunFfmpegTransform(
        context,
        [
          ffmpegPlugin({
            tools: ffmpegPlugin().contributes.generation?.tools.filter((tool) => tool.id !== "run.video"),
          }),
        ],
        "separate-audio",
      ),
    ).toBe(false)
    expect(
      canRunFfmpegTransform(
        context,
        [
          ffmpegPlugin({
            tools: [
              {
                acceptedInputs: ["reference_image"],
                description: "Wrong input",
                id: "run.video",
                output: "video",
                title: "Wrong input",
              },
            ],
          }),
        ],
        "trim",
      ),
    ).toBe(false)
  })
})

describe("FFmpeg toolbar presets", () => {
  test("builds an image extraction argv without a shell or native path", () => {
    const preset = createFfmpegTransformPresets("extract-frame", { timeSeconds: 1.23456 })[0]
    expect(preset).toMatchObject({ output: "image", outputName: "frame.png", toolId: ffmpegImageToolId })
    expect(preset.arguments).toEqual([
      "-ss",
      "1.235",
      "-i",
      "{{input:0}}",
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-an",
      "{{output}}",
    ])
  })

  test("builds H.264 trim and crop presets with optional audio mapping", () => {
    const trim = createFfmpegTransformPresets("trim", { durationSeconds: 4.5, startSeconds: 2 })[0]
    expect(trim).toMatchObject({ output: "video", outputName: "trimmed.mp4", toolId: ffmpegVideoToolId })
    expect(trim.arguments).toContain("0:a?")
    expect(trim.arguments).toContain("h264_videotoolbox")
    expect(trim.arguments).not.toContain("libx264")
    expect(trim.arguments.slice(0, 6)).toEqual(["-ss", "2", "-i", "{{input:0}}", "-t", "4.5"])
    expect(trim.arguments.at(-1)).toBe("{{output}}")

    const crop = createFfmpegTransformPresets("crop", { height: 720, width: 1_280, x: 10, y: 20 })[0]
    expect(crop).toMatchObject({ output: "video", outputName: "cropped.mp4", toolId: ffmpegVideoToolId })
    expect(crop.arguments.slice(0, 4)).toEqual(["-i", "{{input:0}}", "-vf", "crop=1280:720:10:20"])
    expect(crop.arguments.at(-1)).toBe("{{output}}")
  })

  test("creates linked silent-video and independent-audio requests from one separation action", () => {
    const [videoPreset, audioPreset] = createFfmpegTransformPresets("separate-audio", {})
    expect(videoPreset).toMatchObject({
      output: "video",
      outputName: "separated-video.mp4",
      toolId: ffmpegVideoToolId,
    })
    expect(videoPreset?.arguments).toContain("-an")
    expect(videoPreset?.arguments).toContain("h264_videotoolbox")
    expect(audioPreset).toMatchObject({
      output: "audio",
      outputName: "separated-audio.m4a",
      toolId: ffmpegAudioToolId,
    })
    expect(audioPreset?.arguments).toEqual([
      "-i",
      "{{input:0}}",
      "-map",
      "0:a:0",
      "-vn",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "{{output}}",
    ])

    const context = selection([managedVideo.id])
    const operationSignal = new AbortController().signal
    const requests = createFfmpegGenerateRequests(
      { canvasId: "canvas", context, kind: "separate-audio", projectId: "project" },
      {},
      operationSignal,
    )
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({
      context: {
        documentId: "canvas",
        selectedNodeIds: [managedVideo.id],
        source: "desktop:ffmpeg-toolbar:separate-audio",
      },
      expectedOutputCount: 1,
      output: "video",
      references: [{ nodeId: managedVideo.id, role: "reference_video" }],
      signal: operationSignal,
      toolId: ffmpegVideoToolId,
      toolInput: { output_name: "separated-video.mp4" },
    })
    expect(requests[1]).toMatchObject({
      expectedOutputCount: 1,
      output: "audio",
      references: [{ nodeId: managedVideo.id, role: "reference_video" }],
      signal: operationSignal,
      toolId: ffmpegAudioToolId,
      toolInput: { output_name: "separated-audio.m4a" },
    })
    expect(requests[1].anchor).toEqual({ x: requests[0].anchor.x, y: requests[0].anchor.y + 224 })
    expect(() =>
      createFfmpegGenerateRequest(
        { canvasId: "canvas", context, kind: "separate-audio", projectId: "project" },
        {},
        operationSignal,
      ),
    ).toThrow("creates multiple Canvas results")
  })

  test("rejects invalid time ranges and crop geometry before execution", () => {
    expect(validateFfmpegTransformInput("extract-frame", { timeSeconds: -1 })).toBeDefined()
    expect(validateFfmpegTransformInput("trim", { durationSeconds: 0, startSeconds: 0 })).toBeDefined()
    expect(validateFfmpegTransformInput("trim", { durationSeconds: 1, startSeconds: Number.NaN })).toBeDefined()
    expect(
      validateFfmpegTransformInput("trim", { durationSeconds: 2, startSeconds: 8 }, { videoDurationSeconds: 10 }),
    ).toBeUndefined()
    expect(
      validateFfmpegTransformInput("trim", { durationSeconds: 2.001, startSeconds: 8 }, { videoDurationSeconds: 10 }),
    ).toBe("Trim end time cannot exceed the video duration.")
    expect(validateFfmpegTransformInput("crop", { height: 721, width: 1_280, x: 0, y: 0 })).toBeDefined()
    expect(validateFfmpegTransformInput("crop", { height: 720, width: 1_280, x: 1, y: 0 })).toBeDefined()
    expect(validateFfmpegTransformInput("crop", { height: 720, width: 1_280, x: 0, y: 0 })).toBeUndefined()
  })

  test("creates the guarded Canvas generation request and places the result beside the source", () => {
    const context = selection([managedVideo.id])
    const operationSignal = new AbortController().signal
    const request = createFfmpegGenerateRequest(
      { canvasId: "canvas", context, kind: "trim", projectId: "project" },
      { durationSeconds: 3, startSeconds: 1 },
      operationSignal,
    )
    expect(request).toMatchObject({
      anchor: ffmpegResultAnchor(managedVideo, context.document.nodes),
      context: { documentId: "canvas", selectedNodeIds: [managedVideo.id], source: "desktop:ffmpeg-toolbar:trim" },
      expectedRevision: 7,
      output: "video",
      references: [{ nodeId: managedVideo.id, role: "reference_video" }],
      signal: operationSignal,
      toolId: ffmpegVideoToolId,
      toolInput: { output_name: "trimmed.mp4" },
    })
    expect(JSON.parse(String(request.toolInput?.arguments_json))).toEqual(
      createFfmpegTransformPresets("trim", { durationSeconds: 3, startSeconds: 1 })[0].arguments,
    )
  })

  test("places a nested video result in Canvas world coordinates", () => {
    const group = createGroupNode({ id: "group", height: 400, position: { x: 500, y: 200 }, width: 600 })
    const nestedVideo = { ...managedVideo, parentId: group.id, position: { x: 30, y: 40 } }
    expect(ffmpegResultAnchor(nestedVideo, [group, nestedVideo])).toEqual({
      x: 500 + 30 + 320 + 64,
      y: 200 + 40,
    })
  })

  test("binds an open transform dialog to its original Project and Canvas", () => {
    const request = {
      canvasId: "canvas",
      context: selection([managedVideo.id]),
      kind: "trim",
      projectId: "project",
    } as const
    expect(isFfmpegDialogInScope(request, "project", "canvas")).toBe(true)
    expect(isFfmpegDialogInScope(request, "project", "other-canvas")).toBe(false)
    expect(isFfmpegDialogInScope(request, "other-project", "canvas")).toBe(false)
  })
})
