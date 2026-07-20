import {
  getCanvasNodeSize,
  type CanvasGenerateRequest,
  type CanvasGenerationOutput,
  type CanvasDocument,
  type CanvasNode,
  type CanvasPoint,
  type CanvasSelectionActionContext,
} from "@convax/canvas"
import {
  getProjectFileReference,
  isProjectCanvasManagedAssetPath,
  requireProjectCanvasResourcePath,
} from "@convax/project/canvas"
import type { InstalledWebPluginSummary } from "../plugin-contracts"

export const ffmpegPluginId = "ffmpeg-tools"
export const ffmpegAudioToolId = `${ffmpegPluginId}/run.audio`
export const ffmpegImageToolId = `${ffmpegPluginId}/run.image`
export const ffmpegVideoToolId = `${ffmpegPluginId}/run.video`

const inputPlaceholder = "{{input:0}}"
const outputPlaceholder = "{{output}}"

export type FfmpegTransformKind = "extract-frame" | "separate-audio" | "trim" | "crop"

export interface FfmpegExtractFrameInput {
  timeSeconds: number
}

export interface FfmpegTrimInput {
  durationSeconds: number
  startSeconds: number
}

export interface FfmpegCropInput {
  height: number
  width: number
  x: number
  y: number
}

export type FfmpegSeparateAudioInput = Readonly<Record<string, never>>

export interface FfmpegTransformInputMap {
  "extract-frame": FfmpegExtractFrameInput
  "separate-audio": FfmpegSeparateAudioInput
  trim: FfmpegTrimInput
  crop: FfmpegCropInput
}

export type FfmpegTransformInput = FfmpegTransformInputMap[FfmpegTransformKind]

export interface FfmpegTransformValidationContext {
  videoDurationSeconds?: number
}

export interface FfmpegTransformPreset {
  arguments: readonly string[]
  output: CanvasGenerationOutput
  outputName: string
  prompt: string
  toolId: string
}

export interface FfmpegTransformDialogRequest {
  canvasId: string
  context: CanvasSelectionActionContext
  kind: FfmpegTransformKind
  projectId: string
}

export function isFfmpegDialogInScope(
  request: FfmpegTransformDialogRequest | null,
  projectId: string | undefined,
  canvasId: string | undefined,
) {
  return Boolean(request && request.projectId === projectId && request.canvasId === canvasId)
}

interface RequiredFfmpegTool {
  output: CanvasGenerationOutput
  toolId: string
}

const requiredToolsByKind: Readonly<Record<FfmpegTransformKind, readonly RequiredFfmpegTool[]>> = {
  "extract-frame": [{ output: "image", toolId: ffmpegImageToolId }],
  "separate-audio": [
    { output: "video", toolId: ffmpegVideoToolId },
    { output: "audio", toolId: ffmpegAudioToolId },
  ],
  crop: [{ output: "video", toolId: ffmpegVideoToolId }],
  trim: [{ output: "video", toolId: ffmpegVideoToolId }],
}

export function hasInstalledFfmpegTool(
  installedPlugins: readonly InstalledWebPluginSummary[],
  kind: FfmpegTransformKind,
) {
  const requiredTools = requiredToolsByKind[kind]
  const plugin = installedPlugins.find((candidate) => candidate.id === ffmpegPluginId)
  if (!plugin || plugin.schema !== "convax.plugin/2" || plugin.runtime?.type !== "mcp-stdio") {
    return false
  }
  return requiredTools.every(
    (required) =>
      plugin.contributes.generation?.tools.some(
        (tool) =>
          tool.id === required.toolId.slice(`${ffmpegPluginId}/`.length) &&
          tool.output === required.output &&
          tool.acceptedInputs.includes("reference_video"),
      ) ?? false,
  )
}

export function isManagedProjectVideoSelection(context: CanvasSelectionActionContext) {
  if (
    context.selectedEdgeIds.length !== 0 ||
    context.selectedNodeIds.length !== 1 ||
    context.selectedNodes.length !== 1
  ) {
    return false
  }
  const node = context.selectedNodes[0]
  return managedProjectVideoPath(node) !== undefined
}

export function canResumeFfmpegAudioVideoSeparation(
  request: FfmpegTransformDialogRequest,
  document: CanvasDocument,
  createdNodeIds: readonly string[],
) {
  if (request.kind !== "separate-audio" || document.id !== request.canvasId || createdNodeIds.length !== 1) {
    return false
  }
  const originalSource = request.context.selectedNodes[0]
  const liveSource = document.nodes.find((node) => node.id === originalSource?.id)
  const originalSourcePath = originalSource ? managedProjectVideoPath(originalSource) : undefined
  if (!originalSourcePath || !liveSource || originalSourcePath !== managedProjectVideoPath(liveSource)) {
    return false
  }
  const completedVideo = document.nodes.find((node) => node.id === createdNodeIds[0])
  return (
    completedVideo !== undefined &&
    managedProjectVideoPath(completedVideo) !== undefined &&
    document.edges.some((edge) => edge.source === originalSource.id && edge.target === completedVideo.id)
  )
}

export function canRunFfmpegTransform(
  context: CanvasSelectionActionContext,
  installedPlugins: readonly InstalledWebPluginSummary[],
  kind: FfmpegTransformKind,
) {
  return isManagedProjectVideoSelection(context) && hasInstalledFfmpegTool(installedPlugins, kind)
}

export function validateFfmpegTransformInput(
  kind: FfmpegTransformKind,
  input: FfmpegTransformInput,
  context: FfmpegTransformValidationContext = {},
): string | undefined {
  if (kind === "separate-audio") return undefined
  if (kind === "extract-frame") {
    if (!("timeSeconds" in input)) return "Frame time must be zero or a positive number."
    const { timeSeconds } = input
    if (!isNonNegativeFinite(timeSeconds)) return "Frame time must be zero or a positive number."
    return undefined
  }
  if (kind === "trim") {
    if (!("durationSeconds" in input) || !("startSeconds" in input)) {
      return "Start time must be zero or a positive number."
    }
    const { durationSeconds, startSeconds } = input
    if (!isNonNegativeFinite(startSeconds)) return "Start time must be zero or a positive number."
    if (!isPositiveFinite(durationSeconds)) return "Duration must be greater than zero."
    const videoDurationSeconds = context.videoDurationSeconds
    if (
      typeof videoDurationSeconds === "number" &&
      isPositiveFinite(videoDurationSeconds) &&
      startSeconds + durationSeconds > videoDurationSeconds + 0.0005
    ) {
      return "Trim end time cannot exceed the video duration."
    }
    return undefined
  }
  if (!("height" in input) || !("width" in input) || !("x" in input) || !("y" in input)) {
    return "Crop position must use non-negative even pixel values."
  }
  const { height, width, x, y } = input
  if (!isNonNegativeEvenInteger(x) || !isNonNegativeEvenInteger(y)) {
    return "Crop position must use non-negative even pixel values."
  }
  if (!isPositiveEvenInteger(width) || !isPositiveEvenInteger(height)) {
    return "Crop width and height must be positive even pixel values."
  }
  return undefined
}

export function createFfmpegTransformPresets(
  kind: FfmpegTransformKind,
  input: FfmpegTransformInput,
): readonly FfmpegTransformPreset[] {
  const error = validateFfmpegTransformInput(kind, input)
  if (error) throw new Error(error)

  if (kind === "separate-audio") {
    return [
      {
        arguments: [
          "-i",
          inputPlaceholder,
          "-map",
          "0:v:0",
          "-an",
          "-c:v",
          "h264_videotoolbox",
          "-allow_sw",
          "1",
          "-b:v",
          "8M",
          "-profile:v",
          "high",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          outputPlaceholder,
        ],
        output: "video",
        outputName: "separated-video.mp4",
        prompt: "Create a silent video containing only the primary video stream.",
        toolId: ffmpegVideoToolId,
      },
      {
        arguments: ["-i", inputPlaceholder, "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "192k", outputPlaceholder],
        output: "audio",
        outputName: "separated-audio.m4a",
        prompt: "Extract the primary audio stream from the video without changing the source.",
        toolId: ffmpegAudioToolId,
      },
    ]
  }

  if (kind === "extract-frame") {
    if (!("timeSeconds" in input)) throw new Error("Frame time is missing.")
    const { timeSeconds } = input
    return [
      {
        arguments: [
          "-ss",
          formatFfmpegSeconds(timeSeconds),
          "-i",
          inputPlaceholder,
          "-map",
          "0:v:0",
          "-frames:v",
          "1",
          "-an",
          outputPlaceholder,
        ],
        output: "image",
        outputName: "frame.png",
        prompt: `Extract a video frame at ${formatFfmpegSeconds(timeSeconds)} seconds.`,
        toolId: ffmpegImageToolId,
      },
    ]
  }

  const videoEncodingArguments = [
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-c:v",
    "h264_videotoolbox",
    "-allow_sw",
    "1",
    "-b:v",
    "8M",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
  ] as const

  if (kind === "trim") {
    if (!("durationSeconds" in input) || !("startSeconds" in input)) {
      throw new Error("Trim time range is missing.")
    }
    const { durationSeconds, startSeconds } = input
    return [
      {
        arguments: [
          "-ss",
          formatFfmpegSeconds(startSeconds),
          "-i",
          inputPlaceholder,
          "-t",
          formatFfmpegSeconds(durationSeconds),
          ...videoEncodingArguments,
          outputPlaceholder,
        ],
        output: "video",
        outputName: "trimmed.mp4",
        prompt: `Trim the video from ${formatFfmpegSeconds(startSeconds)} seconds for ${formatFfmpegSeconds(durationSeconds)} seconds.`,
        toolId: ffmpegVideoToolId,
      },
    ]
  }

  if (!("height" in input) || !("width" in input) || !("x" in input) || !("y" in input)) {
    throw new Error("Crop geometry is missing.")
  }
  const { height, width, x, y } = input
  return [
    {
      arguments: [
        "-i",
        inputPlaceholder,
        "-vf",
        `crop=${width}:${height}:${x}:${y}`,
        ...videoEncodingArguments,
        outputPlaceholder,
      ],
      output: "video",
      outputName: "cropped.mp4",
      prompt: `Crop the video to ${width}×${height} pixels at (${x}, ${y}).`,
      toolId: ffmpegVideoToolId,
    },
  ]
}

export function createFfmpegGenerateRequest(
  request: FfmpegTransformDialogRequest,
  input: FfmpegTransformInput,
  signal: AbortSignal = request.context.signal,
): CanvasGenerateRequest {
  const requests = createFfmpegGenerateRequests(request, input, signal)
  if (requests.length !== 1) {
    throw new Error("This FFmpeg transform creates multiple Canvas results; execute its request list instead.")
  }
  return requests[0]
}

export function createFfmpegGenerateRequests(
  request: FfmpegTransformDialogRequest,
  input: FfmpegTransformInput,
  signal: AbortSignal = request.context.signal,
): readonly CanvasGenerateRequest[] {
  const node = requireRequestVideoNode(request)
  const presets = createFfmpegTransformPresets(request.kind, input)
  const anchor = ffmpegResultAnchor(node, request.context.document.nodes)
  return presets.map((preset, index) => ({
    anchor: { x: anchor.x, y: anchor.y + index * 224 },
    context: {
      documentId: request.context.document.id,
      selectedNodeIds: [...request.context.selectedNodeIds],
      source: `desktop:ffmpeg-toolbar:${request.kind}`,
    },
    expectedOutputCount: 1,
    expectedRevision: request.context.document.revision,
    output: preset.output,
    prompt: preset.prompt,
    references: [{ nodeId: node.id, role: "reference_video" }],
    signal,
    toolId: preset.toolId,
    toolInput: {
      arguments_json: JSON.stringify(preset.arguments),
      output_name: preset.outputName,
    },
  }))
}

export function ffmpegResultAnchor(node: CanvasNode, nodes: readonly CanvasNode[] = [node]): CanvasPoint {
  const size = getCanvasNodeSize(node)
  const nodeById = new Map(nodes.map((candidate) => [candidate.id, candidate]))
  const visited = new Set<string>()
  let current: CanvasNode | undefined = node
  let x = 0
  let y = 0
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    x += current.position.x
    y += current.position.y
    current = current.parentId ? nodeById.get(current.parentId) : undefined
  }
  return { x: x + size.width + 64, y }
}

function requireRequestVideoNode(request: FfmpegTransformDialogRequest) {
  if (!isManagedProjectVideoSelection(request.context)) {
    throw new Error("The selected video is no longer available as a managed Project asset.")
  }
  return request.context.selectedNodes[0]
}

function managedProjectVideoPath(node: CanvasNode) {
  if (node.type !== "file" || node.data.kind !== "video") return undefined
  const reference = getProjectFileReference(node.data.metadata)
  if (!reference) return undefined
  try {
    const path = requireProjectCanvasResourcePath(reference.path)
    return isProjectCanvasManagedAssetPath(path) ? path : undefined
  } catch {
    return undefined
  }
}

function formatFfmpegSeconds(value: number) {
  return String(Number(value.toFixed(3)))
}

function isNonNegativeFinite(value: number) {
  return Number.isFinite(value) && value >= 0
}

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0
}

function isNonNegativeInteger(value: number) {
  return Number.isInteger(value) && value >= 0
}

function isNonNegativeEvenInteger(value: number) {
  return isNonNegativeInteger(value) && value % 2 === 0
}

function isPositiveEvenInteger(value: number) {
  return Number.isInteger(value) && value > 0 && value % 2 === 0
}
