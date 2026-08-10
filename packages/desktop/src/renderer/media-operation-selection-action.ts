import {
  getCanvasNodeSize,
  type CanvasDocument,
  type CanvasGenerateRequest,
  type CanvasGenerationOutput,
  type CanvasNode,
  type CanvasPoint,
  type CanvasSelectionActionContext,
} from "@convax/canvas"
import { assertResourceRef, canvasProjectionResourceMetadataKey } from "@convax/canvas/collaboration"
import { getProjectResourceReference } from "@convax/project/canvas"
import { parseProjectUri } from "@convax/uri"
import {
  resolvePortablePluginLocalizedText,
  type PortablePluginI18n,
  type PortablePluginLocalizedText,
} from "@convax/plugin-sdk"
import type { GenerationCanvasRequest } from "../generation-contracts"
import type { InstalledWebPluginSummary } from "../plugin-contracts"

export type MediaOperationEditor = "confirmation" | "crop-region" | "immediate" | "time-point" | "time-range"

export type MediaOperationLocalizedText = PortablePluginLocalizedText

export interface MediaOperationStep {
  output: CanvasGenerationOutput
  toolId: string
}

export interface MediaOperationAction {
  delivery: "canvas" | "return"
  description: MediaOperationLocalizedText
  editor: MediaOperationEditor
  id: string
  i18n?: PortablePluginI18n
  pluginId: string
  presentation?: "cutout-scan"
  steps: readonly MediaOperationStep[]
  target: "image" | "video"
  title: MediaOperationLocalizedText
}

export interface MediaOperationExtractFrameInput {
  timeSeconds: number
}

export interface MediaOperationTimeRangeInput {
  durationSeconds: number
  startSeconds: number
}

export interface MediaOperationCropInput {
  height: number
  width: number
  x: number
  y: number
}

export type MediaOperationConfirmationInput = Readonly<Record<string, never>>

export type MediaOperationInput =
  | MediaOperationConfirmationInput
  | MediaOperationCropInput
  | MediaOperationExtractFrameInput
  | MediaOperationTimeRangeInput

export interface MediaOperationValidationContext {
  videoHeight?: number
  videoWidth?: number
  videoDurationSeconds?: number
}

export interface MediaOperationDialogRequest {
  action: MediaOperationAction
  canvasId: string
  context: CanvasSelectionActionContext
  projectId: string
}

export function localizedMediaOperationText(
  text: MediaOperationLocalizedText,
  locale: "en" | "zh-CN",
  i18n?: PortablePluginI18n,
) {
  return resolvePortablePluginLocalizedText(text, locale, i18n)
}

export function listInstalledMediaOperationActions(
  installedPlugins: readonly InstalledWebPluginSummary[],
  admittedToolIds?: ReadonlySet<string>,
): readonly MediaOperationAction[] {
  return installedPlugins.flatMap((plugin) => {
    if (plugin.schema !== "convax.plugin/8" || !plugin.hostApi || plugin.runtime?.type !== "mcp-stdio") return []
    const generationTools = plugin.contributes.generation?.tools ?? []
    const actions = plugin.contributes.canvas?.selectionActions ?? []
    return actions.flatMap((action) => {
      if (!("steps" in action)) return []
      if (!("target" in action) || (action.target !== "image" && action.target !== "video")) return []
      const referenceRole = action.target === "image" ? "reference_image" : "reference_video"
      const steps = action.steps.flatMap((step) => {
        if (!("tool" in step)) return []
        const tool = generationTools.find((candidate) => candidate.id === step.tool)
        const toolId = `${plugin.id}/${step.tool}`
        if (admittedToolIds && !admittedToolIds.has(toolId)) return []
        return tool?.acceptedInputs.includes(referenceRole) ? [{ output: tool.output, toolId }] : []
      })
      if (steps.length !== action.steps.length || steps.length === 0) return []
      const tools = action.steps.map((step) => generationTools.find((candidate) => candidate.id === step.tool))
      const returnDelivery = tools.every((tool) => tool?.delivery === "return")
      if (
        tools.some((tool) => tool?.inputBinding !== undefined) ||
        (returnDelivery &&
          (action.editor !== "confirmation" ||
            action.steps.length !== 1 ||
            tools.some((tool) => tool?.output !== "text"))) ||
        (!returnDelivery &&
          (tools.some((tool) => tool?.delivery === "return") ||
            (action.target === "image" &&
              (action.editor !== "immediate" ||
                action.presentation !== "cutout-scan" ||
                action.steps.length !== 1 ||
                tools.some((tool) => tool?.output !== "image")))))
      ) {
        return []
      }
      return [
        {
          delivery: returnDelivery ? "return" : "canvas",
          description: action.description,
          editor: action.editor,
          id: action.id,
          ...(plugin.i18n === undefined ? {} : { i18n: plugin.i18n }),
          pluginId: plugin.id,
          ...("presentation" in action && action.presentation ? { presentation: action.presentation } : {}),
          steps,
          target: action.target,
          title: action.title,
        },
      ]
    })
  })
}

export function isMediaOperationDialogInScope(
  request: MediaOperationDialogRequest | null,
  projectId: string | undefined,
  canvasId: string | undefined,
) {
  return Boolean(request && request.projectId === projectId && request.canvasId === canvasId)
}

export function isManagedProjectVideoSelection(context: CanvasSelectionActionContext) {
  return isManagedProjectMediaSelection(context, "video")
}

export function isManagedProjectMediaSelection(context: CanvasSelectionActionContext, target: "image" | "video") {
  if (
    context.selectedEdgeIds.length !== 0 ||
    context.selectedNodeIds.length !== 1 ||
    context.selectedNodes.length !== 1
  ) {
    return false
  }
  return projectMediaReferenceIdentity(context.selectedNodes[0], target) !== undefined
}

export function canRunMediaOperation(context: CanvasSelectionActionContext, action: MediaOperationAction) {
  return action.steps.length > 0 && isManagedProjectMediaSelection(context, action.target)
}

export function canResumeMediaOperation(
  request: MediaOperationDialogRequest,
  document: CanvasDocument,
  createdNodeIds: readonly string[],
) {
  if (
    request.action.steps.length < 2 ||
    document.id !== request.canvasId ||
    createdNodeIds.length < 1 ||
    createdNodeIds.length >= request.action.steps.length
  ) {
    return false
  }
  const originalSource = request.context.selectedNodes[0]
  const liveSource = document.nodes.find((node) => node.id === originalSource?.id)
  const originalSourceReference = originalSource ? projectMediaReferenceIdentity(originalSource, "video") : undefined
  if (
    !originalSourceReference ||
    !liveSource ||
    originalSourceReference !== projectMediaReferenceIdentity(liveSource, "video")
  ) {
    return false
  }
  return createdNodeIds.every((nodeId, index) => {
    const completed = document.nodes.find((node) => node.id === nodeId)
    const expectedOutput = request.action.steps[index]?.output
    return (
      completed !== undefined &&
      expectedOutput !== undefined &&
      projectMediaReferenceIdentity(completed, expectedOutput) !== undefined &&
      document.edges.some((edge) => edge.source === originalSource.id && edge.target === completed.id)
    )
  })
}

export function validateMediaOperationInput(
  editor: MediaOperationEditor,
  input: MediaOperationInput,
  context: MediaOperationValidationContext = {},
): string | undefined {
  if (editor === "confirmation" || editor === "immediate") return undefined
  if (editor === "time-point") {
    if (!("timeSeconds" in input) || !isNonNegativeFinite(input.timeSeconds)) {
      return "Frame time must be zero or a positive number."
    }
    return undefined
  }
  if (editor === "time-range") {
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
  const { videoHeight, videoWidth } = context
  if (
    (typeof videoWidth === "number" && isPositiveFinite(videoWidth) && x + width > videoWidth) ||
    (typeof videoHeight === "number" && isPositiveFinite(videoHeight) && y + height > videoHeight)
  ) {
    return "Crop area cannot exceed the video dimensions."
  }
  return undefined
}

export function createMediaOperationGenerateRequest(
  request: MediaOperationDialogRequest,
  input: MediaOperationInput,
  signal: AbortSignal = request.context.signal,
): CanvasGenerateRequest {
  const requests = createMediaOperationGenerateRequests(request, input, signal)
  if (requests.length !== 1) {
    throw new Error("This media operation creates multiple Canvas results; execute its request list instead.")
  }
  return requests[0]
}

export function createMediaOperationGenerateRequests(
  request: MediaOperationDialogRequest,
  input: MediaOperationInput,
  signal: AbortSignal = request.context.signal,
): readonly CanvasGenerateRequest[] {
  if (request.action.delivery !== "canvas") {
    throw new Error("Return-delivery media operations must use the bounded Host return request")
  }
  const validationError = validateMediaOperationInput(request.action.editor, input)
  if (validationError) throw new Error(validationError)
  const node = requireRequestMediaNode(request)
  const anchor = mediaOperationResultAnchor(node, request.context.document.nodes)
  const toolInput = editorToolInput(request.action.editor, input)
  const createsPendingImage =
    request.action.target === "image" &&
    request.action.editor === "immediate" &&
    request.action.presentation === "cutout-scan"
  return request.action.steps.map((step, index) => ({
    anchor: { x: anchor.x, y: anchor.y + index * 224 },
    context: {
      documentId: request.context.document.id,
      selectedNodeIds: [...request.context.selectedNodeIds],
      source: `desktop:plugin-selection-action:${request.action.pluginId}/${request.action.id}`,
    },
    expectedOutputCount: 1,
    output: step.output,
    prompt: request.action.description.default,
    references: [
      {
        nodeId: node.id,
        role: request.action.target === "image" ? "reference_image" : "reference_video",
      },
    ],
    ...(createsPendingImage ? { resultMode: { type: "create-pending-node" as const } } : {}),
    signal,
    toolId: step.toolId,
    ...(toolInput ? { toolInput } : {}),
  }))
}

export function createMediaOperationReturnRequest(
  request: MediaOperationDialogRequest,
  operationId: string,
): GenerationCanvasRequest {
  if (
    request.action.delivery !== "return" ||
    request.action.editor !== "confirmation" ||
    request.action.steps.length !== 1
  ) {
    throw new Error("The selected media operation is not one bounded return-delivery action")
  }
  const node = requireRequestMediaNode(request)
  const step = request.action.steps[0]
  if (!step || step.output !== "text") {
    throw new Error("Return-delivery media operations must produce one bounded text result")
  }
  return {
    anchor: mediaOperationResultAnchor(node, request.context.document.nodes),
    expectedOutputCount: 1,
    operationId,
    output: "text",
    prompt: request.action.description.default,
    ref: { canvasId: request.canvasId, scopeId: request.projectId },
    references: [
      {
        nodeId: node.id,
        role: request.action.target === "image" ? "reference_image" : "reference_video",
      },
    ],
    resultMode: { type: "return" },
    toolId: step.toolId,
  }
}

export function mediaOperationResultAnchor(node: CanvasNode, nodes: readonly CanvasNode[] = [node]): CanvasPoint {
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

function editorToolInput(
  editor: MediaOperationEditor,
  input: MediaOperationInput,
): Readonly<Record<string, string | number | boolean>> | undefined {
  if (editor === "confirmation" || editor === "immediate") return undefined
  if (editor === "time-point") {
    if (!("timeSeconds" in input)) throw new Error("Frame time is missing.")
    return { time_seconds: input.timeSeconds }
  }
  if (editor === "time-range") {
    if (!("durationSeconds" in input) || !("startSeconds" in input)) throw new Error("Time range is missing.")
    return { duration_seconds: input.durationSeconds, start_seconds: input.startSeconds }
  }
  if (!("height" in input) || !("width" in input) || !("x" in input) || !("y" in input)) {
    throw new Error("Crop geometry is missing.")
  }
  return { height: input.height, width: input.width, x: input.x, y: input.y }
}

function requireRequestMediaNode(request: MediaOperationDialogRequest) {
  if (!isManagedProjectMediaSelection(request.context, request.action.target)) {
    throw new Error(`The selected ${request.action.target} is no longer available as a Project-backed file.`)
  }
  return request.context.selectedNodes[0]
}

function projectMediaReferenceIdentity(node: CanvasNode, output: CanvasGenerationOutput) {
  if (node.type !== "file" || node.data.kind !== output) return undefined
  const metadata = node.data.metadata
  if (
    metadata &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    Object.hasOwn(metadata, canvasProjectionResourceMetadataKey)
  ) {
    const resource = (metadata as Record<string, unknown>)[canvasProjectionResourceMetadataKey]
    try {
      assertResourceRef(resource)
      parseProjectUri(resource.uri)
    } catch {
      return undefined
    }
    if (resource.mediaClass !== output) return undefined
    return [
      "canvas-resource",
      resource.format,
      resource.uri,
      resource.mediaClass,
      resource.mime,
      resource.byteLength,
      resource.contentDigest,
      resource.ownerProofDigest,
    ].join("\u0000")
  }
  const reference = getProjectResourceReference(node.data.metadata)
  if (!reference || reference.kind === "project-directory") return undefined
  return reference.kind === "project-file" ? `project-file:${reference.path}` : `managed-asset:${reference.sha256}`
}

function isNonNegativeFinite(value: number) {
  return Number.isFinite(value) && value >= 0
}

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0
}

function isNonNegativeEvenInteger(value: number) {
  return Number.isInteger(value) && value >= 0 && value % 2 === 0
}

function isPositiveEvenInteger(value: number) {
  return Number.isInteger(value) && value > 0 && value % 2 === 0
}
