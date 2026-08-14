import { createHash, randomUUID } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  createCanvasGenerationTargetGuard,
  type CanvasAddResourceSourcesRequest,
  type CanvasApplicationCommandResult,
  type CanvasCommandActor,
  type CanvasCreatePendingGenerationResourceRequest,
  type CanvasCreatePendingResourceRequest,
  type CanvasFailPendingResourceRequest,
  type CanvasFinishNodeGenerationRunRequest,
  type CanvasGenerationTargetGuard,
  type CanvasInterruptInactiveGenerationRunsRequest,
  type CanvasMarkNodeGenerationRunRunningRequest,
  type CanvasReplaceGeneratedResourceSourceRequest,
  type CanvasReplaceResourceSourceRequest,
  type CanvasStartNodeGenerationRunRequest,
  type CanvasApplicationService,
} from "@convax/canvas/application"
import {
  assertResourceRef,
  canvasProjectionResourceMetadataKey,
  type CanvasResourceRef,
} from "@convax/canvas/collaboration"
import {
  getCanvasNodeSize,
  getCanvasNodeGenerationRun,
  getIncomingConnectedCanvasFileNodeIds,
  isCanvasNodeGenerationRunActive,
  type CanvasDocument,
  type CanvasNode,
} from "@convax/canvas/core"
import { parseProjectId } from "@convax/collaboration"
import type { ProjectIndexCurrentBlobReferencePort } from "@convax/project"
import {
  getProjectResourceReference,
  requireProjectResourceReference,
  resolveCurrentProjectResource,
  type ProjectResourceReference,
} from "@convax/project/canvas"
import {
  type GenerationCanvasAdmissionRequest,
  type GenerationCanvasAdmissionResult,
  type GenerationCanvasRequest,
  type GenerationCanvasReconcileResult,
  type GenerationCanvasResult,
  type GenerationInputRole,
  type GenerationOutputModality,
  type GenerationToolDescription,
  type GenerationToolInput,
  type GenerationToolInputValue,
  type GenerationToolSummary,
} from "../generation-contracts"
import { matchesWebPluginCanvasNodeIdentity } from "../plugin-canvas-node"
import type { CanvasRendererBridge } from "./canvas-renderer-bridge"
import { validateGenerationToolInputShape } from "./generation-tool-input-schema"
import { copyStableFile } from "./stable-file-copy"
import type { McpToolCallResult, McpToolContent } from "./stdio-mcp-client"
import type { GenerationToolLifecycleObserver } from "./stdio-mcp-client"
import type { GenerationToolOperationMetadata } from "./stdio-mcp-client"
import type { PreparedGenerationRecovery } from "./generation-plugin-runtime"
import {
  generationOperationLedgerSchema,
  generationOperationRequestDigest,
  type GenerationOperationLedger,
  type GenerationOperationStore,
} from "./generation-operation-store"
import type { GenerationInputSnapshotStore } from "./generation-input-snapshot-store"
import { generationRecoveryResultDigest } from "./generation-recovery-result-digest"

export type GenerationCanvasApplicationPort = Pick<CanvasApplicationService, "query">

export interface GenerationCanvasProjectPort {
  readFileInfo(input: { path: string; projectId: string }): Promise<{
    mimeType: string
    name: string
    path: string
    size: number
  }>
  resolveEntryPath(input: { path?: string; projectId: string }): Promise<string>
}

type GenerationManagedAssetReference = Extract<ProjectResourceReference, { kind: "managed-asset" }>

export interface GenerationCanvasManagedAssetPort {
  resolve(input: { projectId: string; reference: GenerationManagedAssetReference }): Promise<string>
}

export interface GenerationCanvasFilePublisherPort {
  publishGenerated(input: {
    bytes?: Uint8Array
    extension: string
    name?: string
    projectId: string
    sourcePath?: string
  }): Promise<{ path: string }>
}

export interface GenerationCanvasResourcePort {
  addResources(request: CanvasAddResourceSourcesRequest): Promise<CanvasApplicationCommandResult>
  createPendingGenerationResource(
    request: CanvasCreatePendingGenerationResourceRequest,
  ): Promise<CanvasApplicationCommandResult>
  createPendingResource(request: CanvasCreatePendingResourceRequest): Promise<CanvasApplicationCommandResult>
  failPendingResource(request: CanvasFailPendingResourceRequest): Promise<CanvasApplicationCommandResult>
  replaceGeneratedResource(
    request: CanvasReplaceGeneratedResourceSourceRequest,
  ): Promise<CanvasApplicationCommandResult>
  replaceResource(request: CanvasReplaceResourceSourceRequest): Promise<CanvasApplicationCommandResult>
}

export interface GenerationCanvasRunPort {
  finish(request: CanvasFinishNodeGenerationRunRequest): Promise<CanvasApplicationCommandResult>
  interruptInactive(request: CanvasInterruptInactiveGenerationRunsRequest): Promise<CanvasApplicationCommandResult>
  markRunning(request: CanvasMarkNodeGenerationRunRunningRequest): Promise<CanvasApplicationCommandResult>
  start(request: CanvasStartNodeGenerationRunRequest): Promise<CanvasApplicationCommandResult>
}

export interface GenerationToolDispatchHooks {
  /** Mutable host/Canvas checks run before and after bounded runtime/service checks. */
  validate?: () => void | Promise<void>
  /** Bounded service authorization check between the two host validations. */
  guard?: () => void | Promise<void>
}

export interface PreparedGenerationToolExecution {
  call(
    input: Record<string, unknown>,
    signal?: AbortSignal,
    lifecycleObserver?: GenerationToolLifecycleObserver,
    operation?: GenerationToolOperationMetadata,
    dispatchHooks?: GenerationToolDispatchHooks,
  ): Promise<McpToolCallResult>
  recovery?: PreparedGenerationRecovery
  validateInput(input?: GenerationToolInput): Record<string, GenerationToolInputValue>
}

/** Display-only projection admitted from one exact generation tools/list snapshot. */
export interface InspectedGenerationModel {
  description: GenerationToolDescription
  summary: GenerationToolSummary
}

export interface GenerationToolExecutionPort {
  describeTool(toolId: string, signal?: AbortSignal): Promise<GenerationToolDescription>
  listTools(options?: {
    output?: GenerationOutputModality
    refresh?: boolean
  }): Promise<readonly GenerationToolSummary[]>
  prepareRecoveryTool?(
    binding: Pick<
      GenerationOperationLedger,
      | "executionBindingDigest"
      | "pluginPackageDigest"
      | "runtimeAuthorizationDigest"
      | "sidecarRecoveryBindingDigest"
      | "toolId"
    >,
    signal?: AbortSignal,
  ): Promise<{ execution: PreparedGenerationToolExecution; tool: GenerationToolSummary }>
  prepareTool(tool: GenerationToolSummary, signal?: AbortSignal): Promise<PreparedGenerationToolExecution>
  releaseRecoveryTool?(executionBindingDigest: string): Promise<void>
}

export interface GenerationCanvasServiceOptions {
  assets: GenerationCanvasManagedAssetPort
  application: GenerationCanvasApplicationPort
  currentResources: Pick<ProjectIndexCurrentBlobReferencePort, "queryCurrentResources">
  maxInputFileBytes?: number
  maxInputBytes?: number
  maxInlineOutputFileBytes?: number
  maxOutputFileBytes?: number
  maxOutputFiles?: number
  inputSnapshots?: GenerationInputSnapshotStore
  operations?: GenerationOperationStore
  publisher: GenerationCanvasFilePublisherPort
  projects: GenerationCanvasProjectPort
  renderer: Pick<CanvasRendererBridge, "executeView" | "reloadDocument">
  resources: GenerationCanvasResourcePort
  runs: GenerationCanvasRunPort
  temporaryRoot?: string
  tools: GenerationToolExecutionPort
}

interface StagedTextReference {
  kind: "text"
  nodeId: string
  role: GenerationInputRole
  sourceSnapshot: ProjectResourceSnapshot
  text: string
}

interface StagedFileReference {
  kind: "file"
  mimeType: string
  name: string
  nodeId: string
  path: string
  role: GenerationInputRole
  sourceSnapshot: ProjectResourceSnapshot
}

type StagedReference = StagedTextReference | StagedFileReference

interface StagedPromptContext {
  nodeId: string
  promptText: string
  sourceSnapshot: ProjectResourceSnapshot
  sourceText: string
}

interface NativeFileSnapshot {
  ctimeNs: bigint
  dev: bigint
  ino: bigint
  mtimeNs: bigint
  size: bigint
}

interface ProjectResourceSnapshot {
  nodeId: string
  realPath: string
  reference: Exclude<ProjectResourceReference, { kind: "project-directory" }>
  sourcePath: string
  stat: NativeFileSnapshot
}

interface ArtifactDeclaration {
  mimeType?: string
  name?: string
  path: string
}

interface GenerationExecution {
  actor: CanvasCommandActor
  controller: AbortController
  fingerprint: string
  operationId: string
  result: Promise<GenerationCanvasResult>
  state: {
    admissionListeners: Set<(target: GenerationExecutionTarget) => void>
    mustRetain: boolean
    settled: boolean
    target?: GenerationExecutionTarget
  }
}

interface GenerationExecutionTarget {
  canvasId: string
  nodeId: string
  operationId: string
  scopeId: string
}

interface GenerationCanvasServiceHooks {
  beforeExternalCall?: () => Promise<void>
  onRunStarted?: (target: GenerationExecutionTarget) => void
  preparedTool?: {
    execution: PreparedGenerationToolExecution
    toolId: string
  }
}

interface PendingGenerationTarget {
  nodeId: string
}

type GenerationReplacementGuard = { kind: "generation"; value: CanvasGenerationTargetGuard }

const generationCallSchema = "convax.generation-call/1" as const
const maxPromptLength = 64 * 1024
const maxTextReferenceLength = 2 * 1024 * 1024
const defaultMaxInputFileBytes = 2 * 1024 * 1024 * 1024
const defaultMaxInputBytes = 2 * 1024 * 1024 * 1024
const defaultMaxInlineOutputFileBytes = 64 * 1024 * 1024
const defaultMaxOutputFileBytes = 2 * 1024 * 1024 * 1024
const defaultMaxOutputFiles = 16
const maxGenerationExecutions = 1_000
const maxReturnedOutputTextBytes = 64 * 1024
const maxGenerationWarnings = 32
const maxGenerationWarningLength = 2_000
const maxGenerationFailureDiagnosticLength = 512
const generationInputRoles = new Set<GenerationInputRole>([
  "text",
  "reference_image",
  "reference_video",
  "first_frame",
  "last_frame",
  "audio",
])
const webGenerationOutputModalities = new Set<GenerationOutputModality>(["text", "image", "video", "audio"])
const singletonInputRoles = new Set<GenerationInputRole>(["first_frame", "last_frame"])
const windowsReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i
const unsafeGenerationFailureDiagnosticCharacters = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

function requireGenerationMaximum(value: number | undefined, hardMaximum: number, name: string) {
  const maximum = value ?? hardMaximum
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > hardMaximum) {
    throw new Error(`Generation ${name} must be a positive safe integer no greater than ${hardMaximum}`)
  }
  return maximum
}

const unsafeGenerationFailureDiagnosticPatterns = [
  /(?:^|[\s("'`=:])\/(?!\/)[^\s"'`]+/,
  /(?:^|[\s("'`=:])~[\\/][^\s"'`]+/,
  /\b[A-Za-z]:[\\/][^\s"'`]+/,
  /(?:^|[\s("'`=:])\\\\[^\s"'`]+/,
  /(?:^|\s)\.\.?[\\/][^\s"'`]+/,
  /(?:^|[\s("'`=:])[^\s"'`]*[\\/][^\s"'`]+\.[A-Za-z0-9]{1,12}(?::\d+(?::\d+)?)?/,
  /\b(?:file|https?|ftp):\/\//i,
  /\b(?:authorization|cookie|set-cookie|password|passwd|secret|api[-_ ]?key|access[-_ ]?key|secret[-_ ]?key|token|ak|sk)\b/i,
  /\bbearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\bstderr\b\s*:/i,
] as const

const outputExtensions: Record<string, string> = {
  "audio/flac": ".flac",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
}

const extensionMimeTypes: Record<string, string> = Object.fromEntries(
  Object.entries(outputExtensions).map(([mimeType, extension]) => [extension, mimeType]),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizeMimeType(value?: string) {
  return (value ?? "").split(";", 1)[0].trim().toLowerCase()
}

function normalizedGenerationFailureDiagnostic(content: readonly McpToolContent[]) {
  for (const item of content) {
    if (item.type !== "text" || !item.text.trim()) continue
    // Control/format characters can hide credentials or turn copied CLI output
    // into a misleading single-line message. The MCP transport drains stderr
    // separately, and this boundary never exposes either form to callers.
    if (unsafeGenerationFailureDiagnosticCharacters.test(item.text)) continue
    const normalized = item.text.replace(/\s+/g, " ").trim()
    if (!normalized || unsafeGenerationFailureDiagnosticPatterns.some((pattern) => pattern.test(normalized))) {
      continue
    }
    return normalized.length <= maxGenerationFailureDiagnosticLength
      ? normalized
      : `${normalized.slice(0, maxGenerationFailureDiagnosticLength - 1).trimEnd()}…`
  }
  return undefined
}

function safeGenerationLogMessage(value: string) {
  if (unsafeGenerationFailureDiagnosticCharacters.test(value)) return undefined
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized || unsafeGenerationFailureDiagnosticPatterns.some((pattern) => pattern.test(normalized))) {
    return undefined
  }
  return normalized.length <= 1_000 ? normalized : `${normalized.slice(0, 999).trimEnd()}…`
}

/**
 * A caller-visible failure created only from bounded, normalized MCP text.
 * Arbitrary native/process errors must never be wrapped in this type.
 */
export class GenerationToolReportedError extends Error {
  constructor(content: readonly McpToolContent[]) {
    const diagnostic = normalizedGenerationFailureDiagnostic(content)
    super(diagnostic ? `Generation tool failed: ${diagnostic}` : "Generation tool reported a failure")
    this.name = "GenerationToolReportedError"
  }
}

const generationServiceUnavailableCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
])

function isGenerationServiceUnavailableFailure(error: unknown) {
  let current = error
  for (let depth = 0; depth < 4 && current !== undefined; depth += 1) {
    try {
      if (!isRecord(current)) return false
      // Sidecar result text is untrusted diagnostic input. It may be surfaced by
      // the thrown error, but must not select portable Canvas presentation.
      if (current instanceof GenerationToolReportedError) return false
      if (current instanceof GenerationResourceUnavailableError) return true
      if (typeof current.code === "string" && generationServiceUnavailableCodes.has(current.code.toUpperCase())) {
        return true
      }
      const message = typeof current.message === "string" ? current.message : ""
      if (
        /\b(?:generation model )?service (?:is )?(?:unavailable|disconnected|offline|not connected)\b/i.test(message) ||
        /\b(?:runtime|server|provider|process|connection|executable)\b.{0,80}\b(?:unavailable|disconnected|offline|refused|closed|exited|terminated)\b/i.test(
          message,
        ) ||
        /\b(?:connection refused|socket hang up|broken pipe)\b/i.test(message)
      ) {
        return true
      }
      current = current.cause
    } catch {
      return false
    }
  }
  return false
}

function generationFailureMessage(error: unknown, tool: GenerationToolSummary) {
  if (!isGenerationServiceUnavailableFailure(error)) return undefined
  const rawServiceName = tool.pluginName
  if (!rawServiceName || rawServiceName.length > 160 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(rawServiceName)) {
    return "生成服务不可用"
  }
  const serviceName = rawServiceName.replace(/\s+/g, " ").trim()
  return serviceName ? `${serviceName} 服务不可用` : "生成服务不可用"
}

export class GenerationResourceUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "GenerationResourceUnavailableError"
  }
}

function requireGeneratedPublicationPath(value: string) {
  const reference = requireProjectResourceReference({ kind: "project-file", path: value })
  if (reference.kind !== "project-file" || !reference.path.startsWith("Generated/")) {
    throw new Error("Generation publisher returned a path outside Generated")
  }
  const segments = reference.path.split("/")
  if (segments.length !== 2 || reference.path.length > 320) {
    throw new Error("Generation publisher returned an invalid Generated path")
  }
  return reference.path
}

export class GenerationPublicationPartialSuccessError extends Error {
  readonly publishedPaths: readonly string[]

  constructor(publishedPaths: readonly string[], cause: unknown) {
    const paths = publishedPaths.map(requireGeneratedPublicationPath)
    if (!paths.length || paths.length > defaultMaxOutputFiles || new Set(paths).size !== paths.length) {
      throw new Error("Generation partial-success paths are invalid")
    }
    super(
      `Generation succeeded and files were saved, but they could not be added to Canvas. Saved files: ${paths.join(", ")}`,
      {
        cause,
      },
    )
    this.name = "GenerationPublicationPartialSuccessError"
    this.publishedPaths = Object.freeze([...paths])
  }
}

function abortError(reason?: unknown) {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string" || typeof reason === "number" || typeof reason === "boolean"
        ? String(reason)
        : "Operation was canceled"
  // AbortSignal.reason may be a DOMException whose name is exposed through a
  // getter-only property. Always wrap it instead of mutating caller-owned errors.
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal.reason)
}

function isAbortFailure(error: unknown, signal?: AbortSignal) {
  return signal?.aborted === true || (error instanceof Error && error.name === "AbortError")
}

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError(signal.reason))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(abortError(signal.reason))
    }
    const cleanup = () => signal.removeEventListener("abort", onAbort)
    signal.addEventListener("abort", onAbort, { once: true })
    void promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

function waitForGenerationRecoveryObservation(observation: number) {
  const delay = Math.min(250, 2 ** Math.min(observation, 8))
  return new Promise<void>((resolve) => setTimeout(resolve, delay))
}

function requireIdentifier(value: string, label: string, maxLength = 256) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} must be a non-empty, trimmed string`)
  }
  return value
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

interface StoredGenerationRecoveryCall {
  canvasRequest: {
    expectedOutputCount?: number
    output?: GenerationOutputModality
    prompt?: string
    promptContextNodeIds?: readonly string[]
    referenceConstraint?: GenerationCanvasRequest["referenceConstraint"]
    references: GenerationCanvasRequest["references"]
    relationAnchorNodeIds: readonly string[]
    resultMode: GenerationCanvasRequest["resultMode"]
  }
  input: Record<string, GenerationToolInputValue>
  operationId: string
  output: GenerationOutputModality
  prompt: string
  referenceSnapshot?: string
  references: Array<
    | { kind: "text"; nodeId: string; role: GenerationInputRole; text: string }
    | {
        fileIndex: number
        kind: "file"
        mimeType: string
        name: string
        nodeId: string
        role: GenerationInputRole
      }
  >
  schema: "convax.generation-lro-call/1"
  targetGuard: CanvasGenerationTargetGuard
  toolId: string
}

function normalizeStoredReferenceSnapshot(value: unknown) {
  if (value === undefined) return { hasPromptContexts: false, snapshot: undefined }
  if (typeof value !== "string") throw new Error("Stored generation recovery call is invalid")
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error("Stored generation recovery call is invalid")
  }
  if (!isRecord(parsed) || (parsed.promptContexts !== undefined && !Array.isArray(parsed.promptContexts))) {
    throw new Error("Stored generation recovery call is invalid")
  }
  const promptContexts = parsed.promptContexts ?? []
  return {
    hasPromptContexts: promptContexts.length > 0,
    snapshot: stableJson({ ...parsed, promptContexts }),
  }
}

function storedGenerationRecoveryCall(value: unknown): StoredGenerationRecoveryCall {
  if (
    !isRecord(value) ||
    value.schema !== "convax.generation-lro-call/1" ||
    !isRecord(value.canvasRequest) ||
    !isRecord(value.input) ||
    !Array.isArray(value.references) ||
    !isRecord(value.targetGuard) ||
    typeof value.operationId !== "string" ||
    typeof value.prompt !== "string" ||
    typeof value.output !== "string" ||
    typeof value.toolId !== "string"
  ) {
    throw new Error("Stored generation recovery call is invalid")
  }
  const storedReferenceSnapshot = normalizeStoredReferenceSnapshot(value.referenceSnapshot)
  const call = structuredClone(value) as unknown as StoredGenerationRecoveryCall
  if (storedReferenceSnapshot.snapshot !== undefined) call.referenceSnapshot = storedReferenceSnapshot.snapshot
  if (
    !Array.isArray(call.canvasRequest.references) ||
    !Array.isArray(call.canvasRequest.relationAnchorNodeIds) ||
    (call.canvasRequest.prompt === undefined) !== (call.canvasRequest.promptContextNodeIds === undefined) ||
    (call.canvasRequest.prompt !== undefined && typeof call.canvasRequest.prompt !== "string") ||
    (call.canvasRequest.promptContextNodeIds !== undefined &&
      (!Array.isArray(call.canvasRequest.promptContextNodeIds) ||
        call.canvasRequest.promptContextNodeIds.length > 32 ||
        call.canvasRequest.promptContextNodeIds.some(
          (nodeId) =>
            typeof nodeId !== "string" ||
            !nodeId ||
            nodeId !== nodeId.trim() ||
            nodeId.length > 256 ||
            /[\u0000-\u001f\u007f]/.test(nodeId),
        ) ||
        new Set(call.canvasRequest.promptContextNodeIds).size !== call.canvasRequest.promptContextNodeIds.length ||
        call.canvasRequest.promptContextNodeIds.length + call.canvasRequest.references.length > 32 ||
        call.canvasRequest.promptContextNodeIds.some((nodeId) =>
          call.canvasRequest.references.some((reference) => reference.nodeId === nodeId),
        ))) ||
    storedReferenceSnapshot.hasPromptContexts !== (call.canvasRequest.promptContextNodeIds?.length ?? 0) > 0 ||
    !webGenerationOutputModalities.has(call.output) ||
    call.references.length > 32 ||
    call.references.some(
      (reference) =>
        !isRecord(reference) ||
        (reference.kind !== "text" && reference.kind !== "file") ||
        !generationInputRoles.has(reference.role),
    )
  ) {
    throw new Error("Stored generation recovery call is invalid")
  }
  return call
}

function externalGenerationOperationId(request: GenerationCanvasRequest, actor: CanvasCommandActor) {
  const digest = createHash("sha256")
    .update(
      stableJson({
        actor: { id: actor.id, kind: actor.kind },
        canvasId: request.ref.canvasId,
        operationId: request.operationId,
        scopeId: request.ref.scopeId,
      }),
    )
    .digest("hex")
  return `convax-${digest}`
}

function truncateWarning(value: string) {
  const normalized = value.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim()
  if (normalized.length <= maxGenerationWarningLength) return normalized
  const truncated = normalized.slice(0, maxGenerationWarningLength - 1)
  const safe = /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated
  return `${safe}…`
}

function normalizeGenerationWarnings(values: readonly string[]) {
  const warnings: string[] = []
  let omitted = 0
  for (const value of values) {
    const warning = truncateWarning(value)
    if (!warning) continue
    if (warnings.length < maxGenerationWarnings) warnings.push(warning)
    else omitted += 1
  }
  if (omitted > 0) {
    const summary = `${omitted} additional generation ${omitted === 1 ? "warning was" : "warnings were"} omitted.`
    if (warnings.length === maxGenerationWarnings) warnings[warnings.length - 1] = summary
    else warnings.push(summary)
  }
  return warnings
}

function isInside(candidate: string, root: string) {
  const relative = path.relative(root, candidate)
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
}

function nativeFileSnapshot(stat: BigIntStats): NativeFileSnapshot {
  return {
    ctimeNs: stat.ctimeNs,
    dev: stat.dev,
    ino: stat.ino,
    mtimeNs: stat.mtimeNs,
    size: stat.size,
  }
}

function sameNativeFileSnapshot(left: NativeFileSnapshot, right: NativeFileSnapshot) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

function projectResourceChangedError(nodeId: string, cause?: unknown) {
  return new Error(
    `Generation Project resource reference changed while the tool was running: ${nodeId}`,
    cause === undefined ? undefined : { cause },
  )
}

async function captureProjectResourceSnapshot(input: {
  expectedRealPath: string
  expectedSize?: number
  nodeId: string
  reference: Exclude<ProjectResourceReference, { kind: "project-directory" }>
  sourcePath: string
}): Promise<ProjectResourceSnapshot> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    const before = await fs.lstat(input.sourcePath, { bigint: true })
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      (input.expectedSize !== undefined && before.size !== BigInt(input.expectedSize))
    ) {
      throw projectResourceChangedError(input.nodeId)
    }
    const realPath = await fs.realpath(input.sourcePath)
    if (realPath !== input.expectedRealPath) throw projectResourceChangedError(input.nodeId)

    handle = await fs.open(
      input.expectedRealPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    )
    const pinned = await handle.stat({ bigint: true })
    const after = await fs.lstat(input.sourcePath, { bigint: true })
    const resolvedAfter = await fs.realpath(input.sourcePath)
    const beforeSnapshot = nativeFileSnapshot(before)
    const pinnedSnapshot = nativeFileSnapshot(pinned)
    const afterSnapshot = nativeFileSnapshot(after)
    if (
      !pinned.isFile() ||
      !after.isFile() ||
      after.isSymbolicLink() ||
      resolvedAfter !== input.expectedRealPath ||
      !sameNativeFileSnapshot(beforeSnapshot, pinnedSnapshot) ||
      !sameNativeFileSnapshot(pinnedSnapshot, afterSnapshot)
    ) {
      throw projectResourceChangedError(input.nodeId)
    }
    return {
      nodeId: input.nodeId,
      realPath: input.expectedRealPath,
      reference: input.reference,
      sourcePath: input.sourcePath,
      stat: pinnedSnapshot,
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Generation Project resource reference changed")) {
      throw error
    }
    throw projectResourceChangedError(input.nodeId, error)
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function readStableUtf8Resource(snapshot: ProjectResourceSnapshot, maximumBytes: number) {
  if (snapshot.stat.size < 1n || snapshot.stat.size > BigInt(maximumBytes)) {
    throw new Error(`Generation text reference is empty or too large: ${snapshot.nodeId}`)
  }
  const handle = await fs.open(
    snapshot.sourcePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  )
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !sameNativeFileSnapshot(snapshot.stat, nativeFileSnapshot(opened))) {
      throw projectResourceChangedError(snapshot.nodeId)
    }
    const bytes = await handle.readFile()
    const afterHandle = await handle.stat({ bigint: true })
    const afterPath = await fs.lstat(snapshot.sourcePath, { bigint: true })
    if (
      bytes.byteLength !== Number(snapshot.stat.size) ||
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      !sameNativeFileSnapshot(snapshot.stat, nativeFileSnapshot(afterHandle)) ||
      !sameNativeFileSnapshot(snapshot.stat, nativeFileSnapshot(afterPath)) ||
      (await fs.realpath(snapshot.sourcePath)) !== snapshot.realPath
    ) {
      throw projectResourceChangedError(snapshot.nodeId)
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
      throw new Error(`Generation text reference is not valid UTF-8: ${snapshot.nodeId}`)
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function expectedNodeKind(role: GenerationInputRole) {
  if (role === "text") return "text"
  if (role === "reference_video") return "video"
  if (role === "audio") return "audio"
  return "image"
}

function expectedMimePrefix(role: GenerationInputRole) {
  const kind = expectedNodeKind(role)
  return kind === "text" ? "text/" : `${kind}/`
}

function validateRequest(request: GenerationCanvasRequest) {
  requireIdentifier(request.operationId, "Generation operation id")
  requireIdentifier(request.ref.scopeId, "Generation scope id")
  requireIdentifier(request.ref.canvasId, "Generation Canvas id")
  const promptContextNodeIds = request.promptContextNodeIds ?? []
  if (!Array.isArray(promptContextNodeIds) || promptContextNodeIds.length > 32) {
    throw new Error("Generation accepts at most 32 Canvas prompt context nodes")
  }
  for (const nodeId of promptContextNodeIds) {
    requireIdentifier(nodeId, "Generation prompt context node id")
  }
  if (new Set(promptContextNodeIds).size !== promptContextNodeIds.length) {
    throw new Error("Generation prompt context nodes contain a duplicate node id")
  }
  if (
    typeof request.prompt !== "string" ||
    (!request.prompt.trim() && promptContextNodeIds.length === 0) ||
    request.prompt.length > maxPromptLength ||
    request.prompt.includes("\0")
  ) {
    throw new Error(`Generation prompt or text context must contain between 1 and ${maxPromptLength} characters`)
  }
  if (
    request.expectedOutputCount !== undefined &&
    (!Number.isSafeInteger(request.expectedOutputCount) ||
      request.expectedOutputCount < 1 ||
      request.expectedOutputCount > 16)
  ) {
    throw new Error("Generation expected output count must be an integer between 1 and 16")
  }
  if (!Number.isFinite(request.anchor.x) || !Number.isFinite(request.anchor.y)) {
    throw new Error("Generation anchor must contain finite coordinates")
  }
  if (request.parentId !== undefined) requireIdentifier(request.parentId, "Generation parent node id")
  if (!Array.isArray(request.references) || request.references.length > 32) {
    throw new Error("Generation accepts at most 32 Canvas references")
  }
  const pairs = new Set<string>()
  const roleCounts = new Map<GenerationInputRole, number>()
  for (const reference of request.references) {
    requireIdentifier(reference.nodeId, "Generation reference node id")
    if (!generationInputRoles.has(reference.role)) throw new Error("Generation reference role is not supported")
    const key = `${reference.nodeId}\0${reference.role}`
    if (pairs.has(key)) throw new Error("Generation references contain a duplicate node and role")
    pairs.add(key)
    const roleCount = (roleCounts.get(reference.role) ?? 0) + 1
    if (roleCount > 1 && singletonInputRoles.has(reference.role)) {
      throw new Error(`Generation accepts at most one ${reference.role} reference`)
    }
    roleCounts.set(reference.role, roleCount)
  }
  if (promptContextNodeIds.length + request.references.length > 32) {
    throw new Error("Generation prompt context and references exceed the input limit")
  }
  if (promptContextNodeIds.some((nodeId) => request.references.some((reference) => reference.nodeId === nodeId))) {
    throw new Error("Generation prompt context and references contain the same node")
  }
  if (!Array.isArray(request.relationAnchorNodeIds ?? []) || (request.relationAnchorNodeIds?.length ?? 0) > 32) {
    throw new Error("Generation accepts at most 32 Canvas relation anchors")
  }
  const relationAnchorNodeIds = request.relationAnchorNodeIds ?? []
  for (const nodeId of relationAnchorNodeIds) {
    requireIdentifier(nodeId, "Generation relation anchor node id")
  }
  if (new Set(relationAnchorNodeIds).size !== relationAnchorNodeIds.length) {
    throw new Error("Generation relation anchors contain a duplicate node id")
  }
  if (request.toolId !== undefined) requireIdentifier(request.toolId, "Generation tool id")
  if (request.resultMode !== undefined) {
    if (request.resultMode.type === "replace-node") {
      requireIdentifier(request.resultMode.nodeId, "Generation replacement node id")
    } else if (
      request.resultMode.type !== "add" &&
      request.resultMode.type !== "create-pending-node" &&
      request.resultMode.type !== "return"
    ) {
      throw new Error("Generation result mode is not supported")
    }
  }
  if (request.resultMode?.type === "return" && (request.relationAnchorNodeIds?.length ?? 0) > 0) {
    throw new Error("Returned Plugin operations cannot include Canvas relation anchors")
  }
  validateGenerationToolInputShape(request.toolInput)
  if (request.referenceConstraint !== undefined) {
    if (request.referenceConstraint.type !== "direct-incoming") {
      throw new Error("Generation reference constraint is not supported")
    }
    requireIdentifier(request.referenceConstraint.ownerNodeId, "Generation reference owner node id")
    if (request.referenceConstraint.ownerPluginId !== undefined) {
      requireIdentifier(request.referenceConstraint.ownerPluginId, "Generation reference owner Plugin id")
    }
    if (request.relationAnchorNodeIds !== undefined) {
      throw new Error("Constrained generation cannot include relation anchors")
    }
  }
}

function validateAdmissionRequest(input: GenerationCanvasAdmissionRequest) {
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 16) {
    throw new Error("Generation Canvas admission must contain between 1 and 16 steps")
  }
  const operationIds = new Set<string>()
  let expectedRef: GenerationCanvasRequest["ref"] | undefined
  for (const [stepIndex, step] of input.steps.entries()) {
    validateRequest(step.request)
    if (step.request.resultMode?.type !== "create-pending-node" || step.request.expectedOutputCount !== 1) {
      throw new Error("Generation Canvas admission steps must create exactly one pending node")
    }
    if (operationIds.has(step.request.operationId)) {
      throw new Error("Generation Canvas admission contains a duplicate operation id")
    }
    operationIds.add(step.request.operationId)
    if (
      expectedRef &&
      (expectedRef.canvasId !== step.request.ref.canvasId || expectedRef.scopeId !== step.request.ref.scopeId)
    ) {
      throw new Error("Generation Canvas admission steps must target one Canvas")
    }
    expectedRef ??= step.request.ref
    const relationIndexes = step.relationAnchorStepIndexes ?? []
    if (!Array.isArray(relationIndexes) || relationIndexes.length > 16) {
      throw new Error("Generation Canvas admission relation indexes are invalid")
    }
    if (
      relationIndexes.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= stepIndex) ||
      new Set(relationIndexes).size !== relationIndexes.length
    ) {
      throw new Error("Generation Canvas admission relation indexes must uniquely reference prior steps")
    }
    if (step.request.referenceConstraint && relationIndexes.length > 0) {
      throw new Error("Constrained generation cannot include admission relation indexes")
    }
    if ((step.request.relationAnchorNodeIds?.length ?? 0) + relationIndexes.length > 32) {
      throw new Error("Generation Canvas admission relation anchors exceed the limit")
    }
  }
}

function selectTool(tools: readonly GenerationToolSummary[], request: GenerationCanvasRequest) {
  const roles = new Set(request.references.map((reference) => reference.role))
  const satisfies = (tool: GenerationToolSummary) =>
    (request.output === undefined || tool.output === request.output) &&
    [...roles].every((role) => tool.acceptedInputs.includes(role))
  if (request.toolId) {
    const tool = tools.find((candidate) => candidate.id === request.toolId)
    if (!tool) throw new GenerationResourceUnavailableError(`Generation tool is not installed: ${request.toolId}`)
    if (!satisfies(tool))
      throw new Error(`Generation tool does not accept the requested output or reference roles: ${tool.id}`)
    return tool
  }
  // Omitted toolId means model auto-routing. Operations are callable only by
  // their explicit host id so an installed action can never become a model by
  // coincidence.
  const candidates = tools.filter((tool) => tool.kind === "model" && satisfies(tool))
  if (candidates.length === 0) {
    throw new GenerationResourceUnavailableError("No installed generation tool accepts this request")
  }
  if (candidates.length > 1) {
    throw new Error(
      `More than one generation tool accepts this request; choose one of: ${candidates.map((tool) => tool.id).join(", ")}`,
    )
  }
  return candidates[0]
}

function assertToolResultMode(
  tool: GenerationToolSummary,
  resultMode: NonNullable<GenerationCanvasRequest["resultMode"]>,
) {
  const delivery = tool.delivery ?? "canvas"
  if (delivery !== "canvas" && delivery !== "return") {
    throw new Error(`Generation tool has an unsupported delivery mode: ${tool.id}`)
  }
  if (delivery === "return" && (tool.kind !== "operation" || tool.output !== "text")) {
    throw new Error("Returned generation tools must be text Plugin operations")
  }
  if (resultMode.type === "return" && delivery !== "return") {
    throw new Error("Generation return mode requires a Plugin operation declared with return delivery")
  }
  if (resultMode.type !== "return" && delivery === "return") {
    throw new Error("Returned Plugin operations require the host-only return result mode")
  }
}

function assertToolInputBinding(
  tool: GenerationToolSummary,
  constraint: GenerationCanvasRequest["referenceConstraint"],
) {
  if (tool.inputBinding !== undefined && tool.inputBinding !== "direct-incoming") {
    throw new Error(`Generation tool has an unsupported input binding: ${tool.id}`)
  }
  if (tool.inputBinding === "direct-incoming") {
    if (tool.kind !== "operation" || tool.acceptedInputs.length === 0) {
      throw new Error("Direct-incoming generation bindings require a Plugin operation with accepted inputs")
    }
    if (
      constraint?.type !== "direct-incoming" ||
      constraint.ownerPluginId === undefined ||
      constraint.ownerPluginId !== tool.pluginId
    ) {
      throw new Error("Generation tool requires a direct-incoming owner bound to its installed Plugin")
    }
  }
  if (constraint?.ownerPluginId !== undefined && constraint.ownerPluginId !== tool.pluginId) {
    throw new Error("Generation reference owner Plugin does not match the installed tool")
  }
}

function nodeMetadata(node: CanvasNode) {
  return "metadata" in node.data ? node.data.metadata : undefined
}

function safeFileName(value: string, fallback: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 160)
  return normalized && normalized !== "." && normalized !== ".." ? normalized : fallback
}

async function assertNoSymlinkSegments(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (!isInside(candidate, root) || !relative)
    throw new Error("Generation output must be a file below output_directory")
  let current = root
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink()) throw new Error("Generation output cannot contain symbolic links")
  }
}

function validatePortableOutputSegment(value: string) {
  const stem = value.split(".", 1)[0] ?? ""
  if (
    !value ||
    value === "." ||
    value === ".." ||
    /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(value) ||
    /[. ]$/.test(value) ||
    windowsReservedName.test(stem)
  ) {
    throw new Error("Generation output path is not portable")
  }
}

function validatePortableOutputCandidate(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (!relative || !isInside(candidate, root))
    throw new Error("Generation output must be a file below output_directory")
  relative.split(path.sep).forEach(validatePortableOutputSegment)
}

function signatureMimeType(header: Buffer): string | undefined {
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png"
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg"
  if (header.subarray(0, 6).toString("ascii") === "GIF87a" || header.subarray(0, 6).toString("ascii") === "GIF89a")
    return "image/gif"
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP")
    return "image/webp"
  if (header.subarray(0, 4).toString("hex") === "1a45dfa3") return "video/webm"
  if (header.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = header.subarray(8, 12).toString("ascii")
    if (brand === "M4A " || brand === "M4B ") return "audio/mp4"
    return brand === "qt  " ? "video/quicktime" : "video/mp4"
  }
  if (header.subarray(0, 4).toString("ascii") === "OggS") return "audio/ogg"
  if (header.subarray(0, 4).toString("ascii") === "fLaC") return "audio/flac"
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WAVE")
    return "audio/wav"
  if (header.subarray(0, 3).toString("ascii") === "ID3" || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0))
    return "audio/mpeg"
  return undefined
}

function modalityForMimeType(mimeType: string): GenerationOutputModality | undefined {
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType.startsWith("audio/")) return "audio"
  return undefined
}

function compatibleMimeTypes(left: string, right: string) {
  if (left === right) return true
  return (
    new Set([left, right]).size === 2 &&
    new Set([left, right]).has("audio/wav") &&
    new Set([left, right]).has("audio/x-wav")
  )
}

function decodeBase64(value: string, maxBytes: number) {
  if (!value || value.length > Math.ceil(maxBytes / 3) * 4 + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("Generation tool returned invalid or oversized base64 data")
  }
  const data = Buffer.from(value, "base64")
  if (!data.length || data.length > maxBytes)
    throw new Error("Generation tool returned invalid or oversized base64 data")
  return data
}

function structuredArtifacts(value: Record<string, unknown> | undefined, maximum: number): ArtifactDeclaration[] {
  if (!value || value.artifacts === undefined) return []
  if (!Array.isArray(value.artifacts)) throw new Error("Generation structuredContent.artifacts must be an array")
  if (value.artifacts.length > maximum) throw new Error("Generation tool returned too many output files")
  return value.artifacts.map((item, index) => {
    if (!isRecord(item) || typeof item.path !== "string") {
      throw new Error(`Generation artifact ${index} must contain a path`)
    }
    return {
      path: item.path,
      ...(typeof item.mimeType === "string" ? { mimeType: item.mimeType } : {}),
      ...(typeof item.name === "string" ? { name: item.name } : {}),
    }
  })
}

async function assertPinnedOutputDirectory(directory: string, expectedRealPath: string) {
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Generation output_directory was replaced")
  }
  if ((await fs.realpath(directory)) !== expectedRealPath) {
    throw new Error("Generation output_directory was replaced")
  }
}

function relativeArtifactPath(value: string) {
  if (!value || value.includes("\0") || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw new Error("Generation artifact paths must be portable paths relative to output_directory")
  }
  const segments = value.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Generation artifact paths must be portable paths relative to output_directory")
  }
  segments.forEach(validatePortableOutputSegment)
  return segments.join(path.sep)
}

function generationReferenceSource(node: CanvasNode) {
  const reference = getCanonicalCanvasResource(node) ?? getProjectResourceReference(nodeMetadata(node))
  return {
    kind: node.data.kind,
    mimeType: "mimeType" in node.data && typeof node.data.mimeType === "string" ? node.data.mimeType : null,
    reference,
    type: node.type,
  }
}

function getCanonicalCanvasResource(node: CanvasNode): CanvasResourceRef | null {
  const metadata = nodeMetadata(node)
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  if (!Object.hasOwn(metadata, canvasProjectionResourceMetadataKey)) return null
  const value = (metadata as Record<string, unknown>)[canvasProjectionResourceMetadataKey]
  assertResourceRef(value)
  return value
}

function generationReferenceConstraint(document: CanvasDocument, request: GenerationCanvasRequest) {
  const constraint = request.referenceConstraint
  if (!constraint) return { incoming: undefined, incomingNodeIds: undefined }
  const owner = document.nodes.find((node) => node.id === constraint.ownerNodeId)
  if (!owner || owner.type !== "file") throw new Error("Generation reference owner is no longer a Canvas file node")
  if (
    constraint.ownerPluginId !== undefined &&
    !matchesWebPluginCanvasNodeIdentity(constraint.ownerPluginId, owner.data)
  ) {
    throw new Error("Generation reference owner is no longer the declared Plugin Canvas node")
  }
  const incomingNodeIds = getIncomingConnectedCanvasFileNodeIds(document, constraint.ownerNodeId)
  return { incoming: new Set(incomingNodeIds), incomingNodeIds }
}

function generationPromptContextNodes(
  document: CanvasDocument,
  request: GenerationCanvasRequest,
  incoming?: ReadonlySet<string>,
) {
  return (request.promptContextNodeIds ?? []).map((nodeId) => {
    if (incoming && !incoming.has(nodeId)) {
      throw new Error("Generation prompt context must remain a direct incoming Canvas text node")
    }
    const node = document.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) throw new Error(`Generation prompt context node was not found: ${nodeId}`)
    const reference = getProjectResourceReference(nodeMetadata(node))
    if (node.type !== "file" || node.data.kind !== "text" || !reference || reference.kind === "project-directory") {
      throw new Error(`Generation prompt context requires a Canvas text node: ${nodeId}`)
    }
    return node
  })
}

function composeGenerationPrompt(request: GenerationCanvasRequest, promptContexts: readonly StagedPromptContext[]) {
  const prompt = [request.prompt.trim(), ...promptContexts.map((context) => context.promptText)]
    .filter(Boolean)
    .join("\n\n")
  if (!prompt || Buffer.byteLength(prompt, "utf8") > maxPromptLength || prompt.includes("\0")) {
    throw new Error(`Generation prompt and text context must fit within ${maxPromptLength} UTF-8 bytes`)
  }
  return prompt
}

function generationReferenceSnapshot(
  document: CanvasDocument,
  request: GenerationCanvasRequest,
  stagedPromptContexts: readonly StagedPromptContext[],
) {
  const constraint = request.referenceConstraint
  const { incoming, incomingNodeIds } = generationReferenceConstraint(document, request)
  const stagedByNodeId = new Map(stagedPromptContexts.map((context) => [context.nodeId, context] as const))
  const promptContexts = generationPromptContextNodes(document, request, incoming).map((node) => {
    const staged = stagedByNodeId.get(node.id)
    if (!staged) throw new Error(`Generation prompt context was not staged: ${node.id}`)
    return {
      contentDigest: createHash("sha256").update(staged.sourceText, "utf8").digest("hex"),
      nodeId: node.id,
      source: generationReferenceSource(node),
    }
  })
  if (stagedByNodeId.size !== promptContexts.length) {
    throw new Error("Generation staged prompt contexts no longer match the Canvas request")
  }
  const references = request.references.map((reference) => {
    if (incoming && !incoming.has(reference.nodeId)) {
      throw new Error("Generation references must remain direct incoming Canvas file nodes")
    }
    const node = document.nodes.find((candidate) => candidate.id === reference.nodeId)
    if (!node) throw new Error(`Generation reference node was not found: ${reference.nodeId}`)
    return {
      nodeId: reference.nodeId,
      role: reference.role,
      source: generationReferenceSource(node),
    }
  })
  const relationAnchors = (request.relationAnchorNodeIds ?? []).map((nodeId) => {
    const node = document.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) throw new Error(`Generation relation anchor node was not found: ${nodeId}`)
    return { kind: node.data.kind, nodeId, type: node.type }
  })
  return stableJson({
    constraint: constraint
      ? {
          incomingNodeIds,
          ownerNodeId: constraint.ownerNodeId,
          ownerPluginId: constraint.ownerPluginId ?? null,
          type: constraint.type,
        }
      : null,
    promptContexts,
    references,
    relationAnchors,
  })
}

function generationResultRelation(request: GenerationCanvasRequest): CanvasAddResourceSourcesRequest["relation"] {
  const ownerNodeId = request.referenceConstraint?.ownerNodeId
  if (
    !ownerNodeId &&
    !request.promptContextNodeIds?.length &&
    !request.references.length &&
    !request.relationAnchorNodeIds?.length
  )
    return undefined
  return {
    anchorNodeIds: ownerNodeId
      ? [ownerNodeId]
      : [
          ...new Set([
            ...(request.promptContextNodeIds ?? []),
            ...request.references.map((reference) => reference.nodeId),
            ...(request.relationAnchorNodeIds ?? []),
          ]),
        ],
    direction: "from-anchor",
    mode: "connect",
  }
}

function matchingVisualReferenceSize(
  document: CanvasDocument,
  request: GenerationCanvasRequest,
  output: GenerationOutputModality,
) {
  const role = output === "image" ? "reference_image" : output === "video" ? "reference_video" : undefined
  if (role === undefined) return undefined
  const matches = request.references.flatMap((reference) => {
    if (reference.role !== role) return []
    const node = document.nodes.find((candidate) => candidate.id === reference.nodeId)
    return node?.type === "file" && node.data.kind === output ? [node] : []
  })
  return matches.length === 1 ? getCanvasNodeSize(matches[0]!) : undefined
}

/**
 * Shared application service used by toolbar, Agent tools, and narrow Plugin
 * calls. It stages inputs, executes an installed Tool Plugin, publishes outputs
 * as user-visible Project files, and commits normal Canvas file nodes. A
 * declarative return operation reuses the same staging and execution boundary
 * but returns one bounded text result without mutating the Canvas.
 */
export class GenerationCanvasService {
  readonly #assets: GenerationCanvasManagedAssetPort
  readonly #application: GenerationCanvasApplicationPort
  readonly #currentResources: Pick<ProjectIndexCurrentBlobReferencePort, "queryCurrentResources">
  readonly #executions = new Map<string, GenerationExecution>()
  readonly #maxInputFileBytes: number
  readonly #maxInputBytes: number
  readonly #maxInlineOutputFileBytes: number
  readonly #maxOutputFileBytes: number
  readonly #maxOutputFiles: number
  readonly #inputSnapshots?: GenerationInputSnapshotStore
  readonly #operations?: GenerationOperationStore
  readonly #supervisions = new Map<
    string,
    {
      promise: Promise<void>
      target: { canvasId: string; nodeId: string; operationId: string; scopeId: string }
    }
  >()
  #recoveryStoreTail: Promise<void> = Promise.resolve()
  readonly #publisher: GenerationCanvasFilePublisherPort
  readonly #projects: GenerationCanvasProjectPort
  readonly #renderer: Pick<CanvasRendererBridge, "executeView" | "reloadDocument">
  readonly #resources: GenerationCanvasResourcePort
  readonly #runs: GenerationCanvasRunPort
  readonly #temporaryRoot: string
  readonly #tools: GenerationToolExecutionPort

  constructor(options: GenerationCanvasServiceOptions) {
    this.#assets = options.assets
    this.#application = options.application
    this.#currentResources = options.currentResources
    this.#maxInputFileBytes = requireGenerationMaximum(
      options.maxInputFileBytes,
      defaultMaxInputFileBytes,
      "maxInputFileBytes",
    )
    this.#maxInputBytes = requireGenerationMaximum(options.maxInputBytes, defaultMaxInputBytes, "maxInputBytes")
    this.#maxInlineOutputFileBytes = requireGenerationMaximum(
      options.maxInlineOutputFileBytes,
      defaultMaxInlineOutputFileBytes,
      "maxInlineOutputFileBytes",
    )
    this.#maxOutputFileBytes = requireGenerationMaximum(
      options.maxOutputFileBytes,
      defaultMaxOutputFileBytes,
      "maxOutputFileBytes",
    )
    this.#maxOutputFiles = requireGenerationMaximum(options.maxOutputFiles, defaultMaxOutputFiles, "maxOutputFiles")
    this.#inputSnapshots = options.inputSnapshots
    this.#operations = options.operations
    this.#publisher = options.publisher
    this.#projects = options.projects
    this.#renderer = options.renderer
    this.#resources = options.resources
    this.#runs = options.runs
    this.#temporaryRoot = options.temporaryRoot ?? os.tmpdir()
    this.#tools = options.tools
  }

  async listTools(options: { output?: GenerationOutputModality; refresh?: boolean } = {}) {
    return this.#tools.listTools(options)
  }

  async describeTool(toolId: string, signal?: AbortSignal) {
    return this.#tools.describeTool(toolId, signal)
  }

  async cancel(operationId: string, actor: CanvasCommandActor): Promise<void> {
    requireIdentifier(operationId, "Generation operation id")
    requireIdentifier(actor.id, "Generation actor id")
    requireIdentifier(actor.kind, "Generation actor kind")
    const live = [...this.#executions.values()].filter(
      (execution) =>
        !execution.state.settled &&
        execution.operationId === operationId &&
        execution.actor.id === actor.id &&
        execution.actor.kind === actor.kind,
    )
    if (live.length > 1) {
      throw new Error("Generation cancellation operation identity is ambiguous")
    }
    if (live.length === 1) {
      live[0]!.controller.abort(abortError("The generation operation was explicitly canceled"))
      return
    }
    if (!this.#operations || !this.#inputSnapshots) return
    const candidates = (await this.#operations.list()).filter(
      (ledger) =>
        ledger.operationId === operationId &&
        ledger.phase !== "committed" &&
        ledger.phase !== "cancelled" &&
        ledger.phase !== "failed" &&
        ledger.phase !== "indeterminate",
    )
    if (candidates.length === 0) return
    if (candidates.length !== 1) {
      throw new Error("Generation cancellation operation identity is ambiguous")
    }
    let ledger = candidates[0]!
    const identity = {
      canvasId: ledger.canvasId,
      nodeId: ledger.nodeId,
      operationId: ledger.operationId,
      projectId: ledger.projectId,
    }
    if (ledger.phase === "prepared") {
      await this.#persistRecoveredTerminal(ledger, actor)
      await this.#finalizeNeverDispatchedOperation(ledger, "cancelled")
      return
    }
    const { execution } = await this.#prepareStoredRecoveryRuntime(ledger)
    const recovery = execution.recovery!
    const state = await recovery.cancel({
      operationId: ledger.operationId,
      requestDigest: ledger.requestDigest,
      ...(ledger.taskId === undefined ? {} : { taskId: ledger.taskId }),
    })
    if (state.status === "succeeded") {
      await this.#superviseStoredOperation(ledger, actor)
      return
    }
    if (state.status === "submitted" || state.status === "running") {
      ledger = await this.#operations.transition(identity, {
        phase: "accepted",
        taskId: state.taskId,
      })
      this.#ensureStoredSupervision(ledger, actor, false)
      return
    }
    if (state.status === "unknown") {
      ledger = await this.#operations.transition(identity, {
        phase: "indeterminate",
      })
      await this.#persistRecoveredTerminal(ledger, actor)
      return
    }
    const terminalStatus = state.status === "failed" ? "failed" : "cancelled"
    ledger = await this.#operations.transition(identity, {
      phase: terminalStatus,
      ...("taskId" in state && state.taskId ? { taskId: state.taskId } : {}),
    })
    await this.#persistRecoveredTerminal(ledger, actor)
    await this.#acknowledgeAndCleanup(ledger, () =>
      recovery.acknowledge({
        operationId: ledger.operationId,
        requestDigest: ledger.requestDigest,
        ...("taskId" in state && state.taskId ? { taskId: state.taskId } : {}),
      }),
    ).catch((error) => this.#logGenerationFailure("cancel acknowledgement", error))
  }

  async reconcileCanvas(
    ref: { canvasId: string; scopeId: string },
    actor: CanvasCommandActor,
  ): Promise<GenerationCanvasReconcileResult> {
    requireIdentifier(ref.canvasId, "Generation Canvas id")
    requireIdentifier(ref.scopeId, "Generation scope id")
    requireIdentifier(actor.id, "Generation actor id")
    requireIdentifier(actor.kind, "Generation actor kind")
    await this.#cleanupAcknowledgedOperations()
    const snapshot = await this.#application.query(ref)
    const activeNodes = snapshot.projection.nodes.filter((node) => {
      const run = getCanvasNodeGenerationRun(node)
      return run ? isCanvasNodeGenerationRunActive(run) : false
    })
    await this.#startStoredSupervisions(ref, actor, snapshot.projection.nodes)
    if (!activeNodes.length) {
      return { failedNodeIds: [], operationReceipt: null, projection: structuredClone(snapshot.projection) }
    }
    const observedLiveRuns = [...this.#executions.values()].flatMap((execution) => {
      const target = execution.state.target
      return !execution.state.settled && target?.scopeId === ref.scopeId && target.canvasId === ref.canvasId
        ? [{ nodeId: target.nodeId, operationId: target.operationId }]
        : []
    })
    observedLiveRuns.push(
      ...[...this.#supervisions.values()].flatMap(({ target }) =>
        target.scopeId === ref.scopeId && target.canvasId === ref.canvasId
          ? [{ nodeId: target.nodeId, operationId: target.operationId }]
          : [],
      ),
    )
    const liveRuns = [...new Map(observedLiveRuns.map((run) => [`${run.nodeId}\0${run.operationId}`, run])).values()]
    const liveRunKeys = new Set(liveRuns.map((run) => `${run.nodeId}\0${run.operationId}`))
    const hasInactiveRun = activeNodes.some((node) => {
      const run = getCanvasNodeGenerationRun(node)!
      return !liveRunKeys.has(`${node.id}\0${run.operationId}`)
    })
    if (!hasInactiveRun) {
      return { failedNodeIds: [], operationReceipt: null, projection: structuredClone(snapshot.projection) }
    }
    const result = await this.#runs.interruptInactive({
      actor,
      canvasId: ref.canvasId,
      commandId: `generation:reconcile:${randomUUID()}`,
      liveRuns,
      scopeId: ref.scopeId,
    })
    return {
      failedNodeIds: result.affectedNodeIds,
      operationReceipt: structuredClone(result.operationReceipt),
      projection: structuredClone(result.document),
    }
  }

  async reconcileDeletedCanvas(ref: { canvasId: string; scopeId: string }, actor: CanvasCommandActor): Promise<void> {
    requireIdentifier(ref.canvasId, "Generation Canvas id")
    requireIdentifier(ref.scopeId, "Generation scope id")
    requireIdentifier(actor.id, "Generation actor id")
    requireIdentifier(actor.kind, "Generation actor kind")
    await this.#cleanupAcknowledgedOperations()
    if (!this.#operations || !this.#inputSnapshots) return
    const ledgers = await this.#operations.list()
    for (const ledger of ledgers) {
      if (ledger.projectId === ref.scopeId && ledger.canvasId === ref.canvasId) {
        this.#ensureStoredSupervision(ledger, actor, true)
      }
    }
  }

  async #startStoredSupervisions(
    ref: { canvasId: string; scopeId: string },
    actor: CanvasCommandActor,
    nodes: readonly CanvasNode[],
  ) {
    if (!this.#operations || !this.#inputSnapshots) return
    const owners = new Map(
      nodes.flatMap((node) => {
        const run = getCanvasNodeGenerationRun(node)
        return run ? [[`${node.id}\0${run.operationId}`, node] as const] : []
      }),
    )
    const ledgers = await this.#operations.list()
    // A generation can acquire its exact Canvas target and persist a ledger
    // while the store listing is in flight. Snapshot live executions only after
    // that await so a same-process run is never mistaken for restart recovery.
    const liveExecutionKeys = new Set(
      [...this.#executions.values()].flatMap((execution) => {
        const target = execution.state.target
        return !execution.state.settled && target?.scopeId === ref.scopeId && target.canvasId === ref.canvasId
          ? [`${target.nodeId}\0${target.operationId}`]
          : []
      }),
    )
    for (const ledger of ledgers) {
      if (ledger.projectId !== ref.scopeId || ledger.canvasId !== ref.canvasId) continue
      if (liveExecutionKeys.has(`${ledger.nodeId}\0${ledger.operationId}`)) continue
      const owner = owners.get(`${ledger.nodeId}\0${ledger.operationId}`)
      const ownerRun = owner ? getCanvasNodeGenerationRun(owner) : undefined
      if (ledger.phase === "prepared") {
        this.#ensureStoredSupervision(
          ledger,
          actor,
          ownerRun === undefined || !isCanvasNodeGenerationRunActive(ownerRun),
        )
        continue
      }
      if (!ownerRun) {
        this.#ensureStoredSupervision(ledger, actor, true)
        continue
      }
      if (
        ledger.phase === "committed"
          ? ownerRun.status !== "succeeded"
          : ledger.phase === "failed"
            ? ownerRun.status !== "failed"
            : ledger.phase === "cancelled"
              ? ownerRun.status !== "failed"
              : !isCanvasNodeGenerationRunActive(ownerRun)
      ) {
        continue
      }
      this.#ensureStoredSupervision(ledger, actor, false)
    }
  }

  #ensureStoredSupervision(ledger: GenerationOperationLedger, actor: CanvasCommandActor, orphaned: boolean) {
    const key = stableJson([ledger.projectId, ledger.canvasId, ledger.nodeId, ledger.operationId])
    if (this.#supervisions.has(key)) return
    const target = {
      canvasId: ledger.canvasId,
      nodeId: ledger.nodeId,
      operationId: ledger.operationId,
      scopeId: ledger.projectId,
    }
    const promise = (
      orphaned ? this.#superviseOrphanedStoredOperation(ledger) : this.#superviseStoredOperation(ledger, actor)
    )
      .catch((error) => this.#logGenerationFailure("supervise", error))
      .finally(() => {
        if (this.#supervisions.get(key)?.promise === promise) this.#supervisions.delete(key)
      })
    this.#supervisions.set(key, { promise, target })
  }

  async #acknowledgeAndCleanup(ledger: GenerationOperationLedger, acknowledge: () => Promise<void>) {
    if (!this.#operations || !this.#inputSnapshots) return
    await acknowledge()
    const acknowledged =
      ledger.phase === "acknowledged" ? ledger : await this.#operations.transition(ledger, { phase: "acknowledged" })
    await this.#withRecoveryStoreLock(() => this.#cleanupAcknowledgedOperationUnlocked(acknowledged))
  }

  async #finalizeNeverDispatchedOperation(ledger: GenerationOperationLedger, terminalPhase: "cancelled" | "failed") {
    if (!this.#operations || !this.#inputSnapshots) return
    const terminal =
      ledger.phase === terminalPhase ? ledger : await this.#operations.transition(ledger, { phase: terminalPhase })
    const acknowledged = await this.#operations.transition(terminal, { phase: "acknowledged" })
    await this.#withRecoveryStoreLock(() => this.#cleanupAcknowledgedOperationUnlocked(acknowledged))
  }

  async #cleanupAcknowledgedOperations() {
    if (!this.#operations || !this.#inputSnapshots) return
    await this.#withRecoveryStoreLock(async () => {
      const ledgers = await this.#operations!.list()
      for (const ledger of ledgers) {
        if (ledger.phase === "acknowledged") {
          await this.#cleanupAcknowledgedOperationUnlocked(ledger, ledgers)
        }
      }
    })
  }

  async #cleanupAcknowledgedOperationUnlocked(
    ledger: GenerationOperationLedger,
    knownLedgers?: readonly GenerationOperationLedger[],
  ) {
    if (!this.#operations || !this.#inputSnapshots || ledger.phase !== "acknowledged") return
    const all = knownLedgers ?? (await this.#operations.list())
    const otherLedgers = all.filter(
      (candidate) =>
        !(
          candidate.projectId === ledger.projectId &&
          candidate.canvasId === ledger.canvasId &&
          candidate.nodeId === ledger.nodeId &&
          candidate.operationId === ledger.operationId
        ),
    )
    if (!otherLedgers.some((candidate) => candidate.inputSnapshotId === ledger.inputSnapshotId)) {
      await this.#inputSnapshots.remove(ledger.inputSnapshotId)
    }
    if (!otherLedgers.some((candidate) => candidate.executionBindingDigest === ledger.executionBindingDigest)) {
      await this.#tools.releaseRecoveryTool?.(ledger.executionBindingDigest)
    }
    await this.#operations.remove(ledger)
  }

  async #withRecoveryStoreLock<T>(action: () => Promise<T>): Promise<T> {
    const release = await this.#acquireRecoveryStoreLock()
    try {
      return await action()
    } finally {
      release()
    }
  }

  async #acquireRecoveryStoreLock() {
    const previous = this.#recoveryStoreTail
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    this.#recoveryStoreTail = previous.then(() => current)
    await previous
    let released = false
    return () => {
      if (released) return
      released = true
      release()
    }
  }

  async #superviseStoredOperation(initial: GenerationOperationLedger, actor: CanvasCommandActor) {
    if (!this.#operations || !this.#inputSnapshots) return
    if (initial.phase === "prepared") {
      // The durable dispatching transition happens inside the final
      // external-started callback and strictly before the stdio write. A
      // surviving prepared record therefore proves that no external request
      // was authorized; fail it safely without starting or querying a sidecar.
      await this.#persistRecoveredTerminal(initial, actor)
      await this.#finalizeNeverDispatchedOperation(initial, "failed")
      return
    }
    let ledger = initial
    const identity = {
      canvasId: ledger.canvasId,
      nodeId: ledger.nodeId,
      operationId: ledger.operationId,
      projectId: ledger.projectId,
    }
    try {
      if (ledger.phase === "committed") {
        if (!ledger.resultDigest) throw new Error("Committed generation recovery result digest is missing")
        const { execution } = await this.#prepareStoredRecoveryRuntime(ledger)
        await this.#acknowledgeAndCleanup(ledger, () =>
          execution.recovery!.acknowledge({
            operationId: ledger.operationId,
            requestDigest: ledger.requestDigest,
            resultDigest: ledger.resultDigest!,
            ...(ledger.taskId === undefined ? {} : { taskId: ledger.taskId }),
          }),
        )
        return
      }
      if (ledger.phase === "acknowledged") {
        await this.#withRecoveryStoreLock(() => this.#cleanupAcknowledgedOperationUnlocked(ledger))
        return
      }
      if (ledger.phase === "cancelled" || ledger.phase === "failed" || ledger.phase === "indeterminate") {
        await this.#persistRecoveredTerminal(ledger, actor)
        if (ledger.phase !== "indeterminate") {
          const { execution } = await this.#prepareStoredRecoveryRuntime(ledger)
          await this.#acknowledgeAndCleanup(ledger, () =>
            execution.recovery!.acknowledge({
              operationId: ledger.operationId,
              requestDigest: ledger.requestDigest,
              ...(ledger.taskId === undefined ? {} : { taskId: ledger.taskId }),
            }),
          )
        }
        return
      }
      const snapshot = await this.#inputSnapshots.open(ledger.inputSnapshotId)
      if (snapshot.requestDigest !== ledger.requestDigest) {
        throw new Error("Generation recovery request digest changed")
      }
      const stored = storedGenerationRecoveryCall(snapshot.request)
      if (stored.operationId !== ledger.operationId || stored.toolId !== ledger.toolId) {
        throw new Error("Generation recovery request identity changed")
      }
      const { execution: prepared, tool } = await this.#prepareStoredRecoveryRuntime(ledger)
      const recovery = prepared.recovery
      if (
        !recovery ||
        recovery.bindingDigest !== ledger.sidecarRecoveryBindingDigest ||
        recovery.executionBindingDigest !== ledger.executionBindingDigest ||
        recovery.pluginPackageDigest !== ledger.pluginPackageDigest ||
        recovery.runtimeAuthorizationDigest !== ledger.runtimeAuthorizationDigest
      ) {
        throw new Error("Generation recovery runtime binding changed")
      }
      const recoveryRequest = () => ({
        operationId: ledger.operationId,
        requestDigest: ledger.requestDigest,
        ...(ledger.taskId === undefined ? {} : { taskId: ledger.taskId }),
      })
      let state = await recovery.get(recoveryRequest())
      for (let observation = 0; ; observation += 1) {
        if (state.status === "absent" || state.status === "prepared") {
          ledger = await this.#operations.transition(identity, { phase: "dispatching" })
          state = await this.#replayStoredOperation(ledger, snapshot, stored, prepared, actor)
          await waitForGenerationRecoveryObservation(observation)
          continue
        }
        if (state.status === "submitted" || state.status === "running") {
          ledger = await this.#operations.transition(identity, {
            phase: "accepted",
            taskId: state.taskId,
          })
          await this.#persistRecoveredTask(ledger, state.taskId, actor)
          state = await recovery.wait(recoveryRequest())
          await waitForGenerationRecoveryObservation(observation)
          continue
        }
        if (state.status === "succeeded") {
          ledger = await this.#operations.transition(identity, {
            phase: "result-ready",
            resultDigest: state.resultDigest,
            taskId: state.taskId,
          })
          const replayDirectory = await fs.mkdtemp(path.join(this.#temporaryRoot, "convax-generation-result-replay-"))
          try {
            const outputDirectory = path.join(replayDirectory, "output")
            const materializedDirectory = path.join(replayDirectory, "materialized")
            await Promise.all([
              fs.mkdir(outputDirectory, { mode: 0o700 }),
              fs.mkdir(materializedDirectory, { mode: 0o700 }),
            ])
            const outputDirectoryRealPath = await fs.realpath(outputDirectory)
            const replayed = await recovery.result({
              ...recoveryRequest(),
              outputDirectory,
              resultDigest: state.resultDigest,
              taskId: state.taskId,
            })
            if ((await generationRecoveryResultDigest(replayed.result, outputDirectory)) !== replayed.resultDigest) {
              throw new Error("Generation recovery result digest changed")
            }
            await this.#commitRecoveredResult(ledger, stored, tool, replayed.result, actor, {
              materializedDirectory,
              outputDirectory,
              outputDirectoryRealPath,
            })
            ledger = await this.#operations.transition(identity, {
              phase: "committed",
              resultDigest: replayed.resultDigest,
              taskId: state.taskId,
            })
            await this.#acknowledgeAndCleanup(ledger, () =>
              recovery.acknowledge({
                ...recoveryRequest(),
                resultDigest: replayed.resultDigest,
              }),
            ).catch((error) => this.#logGenerationFailure("recovered result acknowledgement", error))
            return
          } finally {
            await fs.rm(replayDirectory, { force: true, recursive: true }).catch(() => undefined)
          }
        }
        if (state.status === "failed" || state.status === "cancelled") {
          await this.#persistRecoveredTerminal(ledger, actor)
          ledger = await this.#operations.transition(identity, {
            phase: state.status,
            ...(state.taskId === undefined ? {} : { taskId: state.taskId }),
          })
          await this.#acknowledgeAndCleanup(ledger, () => recovery.acknowledge(recoveryRequest())).catch((error) =>
            this.#logGenerationFailure("recovered terminal acknowledgement", error),
          )
          return
        }
        await this.#operations.transition(identity, { phase: "indeterminate" })
        await this.#persistRecoveredTerminal(ledger, actor)
        return
      }
    } catch (error) {
      if (ledger.phase === "committed" || ledger.phase === "acknowledged") throw error
      await this.#operations.transition(identity, { phase: "indeterminate" }).catch(() => undefined)
      await this.#persistRecoveredTerminal(ledger, actor).catch(() => undefined)
      throw error
    }
  }

  async #superviseOrphanedStoredOperation(initial: GenerationOperationLedger) {
    if (!this.#operations || !this.#inputSnapshots) return
    if (initial.phase === "prepared") {
      await this.#finalizeNeverDispatchedOperation(initial, "failed")
      return
    }
    let ledger = initial
    const identity = {
      canvasId: ledger.canvasId,
      nodeId: ledger.nodeId,
      operationId: ledger.operationId,
      projectId: ledger.projectId,
    }
    try {
      if (ledger.phase === "acknowledged") {
        await this.#withRecoveryStoreLock(() => this.#cleanupAcknowledgedOperationUnlocked(ledger))
        return
      }
      if (ledger.phase === "indeterminate") return
      const { execution } = await this.#prepareStoredRecoveryRuntime(ledger)
      const recovery = execution.recovery!
      const request = () => ({
        operationId: ledger.operationId,
        requestDigest: ledger.requestDigest,
        ...(ledger.taskId === undefined ? {} : { taskId: ledger.taskId }),
      })
      if (ledger.phase === "committed") {
        if (!ledger.resultDigest) throw new Error("Committed generation recovery result digest is missing")
        await this.#acknowledgeAndCleanup(ledger, () =>
          recovery.acknowledge({ ...request(), resultDigest: ledger.resultDigest! }),
        )
        return
      }
      if (ledger.phase === "failed" || ledger.phase === "cancelled") {
        await this.#acknowledgeAndCleanup(ledger, () => recovery.acknowledge(request()))
        return
      }

      let state = await recovery.cancel(request())
      for (let observation = 0; ; observation += 1) {
        if (state.status === "submitted" || state.status === "running") {
          ledger = await this.#operations.transition(identity, {
            phase: "accepted",
            taskId: state.taskId,
          })
          state = await recovery.wait(request())
          await waitForGenerationRecoveryObservation(observation)
          continue
        }
        if (state.status === "succeeded") {
          const resultDigest = state.resultDigest
          const taskId = state.taskId
          ledger = await this.#operations.transition(identity, {
            phase: "result-ready",
            resultDigest,
            taskId,
          })
          ledger = await this.#operations.transition(identity, {
            phase: "committed",
            resultDigest,
            taskId,
          })
          await this.#acknowledgeAndCleanup(ledger, () =>
            recovery.acknowledge({
              ...request(),
              resultDigest,
            }),
          )
          return
        }
        if (
          state.status === "absent" ||
          state.status === "prepared" ||
          state.status === "failed" ||
          state.status === "cancelled"
        ) {
          const phase = state.status === "failed" ? "failed" : "cancelled"
          ledger = await this.#operations.transition(identity, {
            phase,
            ...("taskId" in state && state.taskId ? { taskId: state.taskId } : {}),
          })
          await this.#acknowledgeAndCleanup(ledger, () => recovery.acknowledge(request()))
          return
        }
        await this.#operations.transition(identity, { phase: "indeterminate" })
        return
      }
    } catch (error) {
      if (ledger.phase !== "committed" && ledger.phase !== "acknowledged") {
        await this.#operations.transition(identity, { phase: "indeterminate" }).catch(() => undefined)
      }
      throw error
    }
  }

  async #prepareStoredRecoveryRuntime(ledger: GenerationOperationLedger) {
    let tool: GenerationToolSummary
    let execution: PreparedGenerationToolExecution
    if (this.#tools.prepareRecoveryTool) {
      const pinned = await this.#tools.prepareRecoveryTool(ledger)
      tool = pinned.tool
      execution = pinned.execution
    } else {
      const current = (await this.#tools.listTools()).find((candidate) => candidate.id === ledger.toolId)
      if (!current?.recovery) throw new Error("Generation recovery tool is unavailable")
      tool = current
      execution = await this.#tools.prepareTool(current)
    }
    const recovery = execution.recovery
    if (
      !recovery ||
      recovery.bindingDigest !== ledger.sidecarRecoveryBindingDigest ||
      recovery.executionBindingDigest !== ledger.executionBindingDigest ||
      recovery.pluginPackageDigest !== ledger.pluginPackageDigest ||
      recovery.runtimeAuthorizationDigest !== ledger.runtimeAuthorizationDigest
    ) {
      throw new Error("Generation recovery runtime binding changed")
    }
    return { execution, tool }
  }

  async #persistRecoveredTask(ledger: GenerationOperationLedger, taskId: string, actor: CanvasCommandActor) {
    const document = (
      await this.#application.query({
        canvasId: ledger.canvasId,
        scopeId: ledger.projectId,
      })
    ).projection
    const node = document.nodes.find((candidate) => candidate.id === ledger.nodeId)
    if (getCanvasNodeGenerationRun(node!)?.operationId !== ledger.operationId) {
      throw new Error("Generation recovery Canvas owner changed")
    }
    await this.#runs.markRunning({
      actor,
      canvasId: ledger.canvasId,
      commandId: `generation:${ledger.operationId}:recover-task:${taskId}`,
      nodeId: ledger.nodeId,
      operationId: ledger.operationId,
      scopeId: ledger.projectId,
      taskId,
    })
  }

  async #persistRecoveredTerminal(ledger: GenerationOperationLedger, actor: CanvasCommandActor) {
    await this.#application.query({
      canvasId: ledger.canvasId,
      scopeId: ledger.projectId,
    })
    await this.#runs.finish({
      actor,
      canvasId: ledger.canvasId,
      commandId: `generation:${ledger.operationId}:recover-terminal:failed`,
      nodeId: ledger.nodeId,
      operationId: ledger.operationId,
      scopeId: ledger.projectId,
    })
  }

  async #replayStoredOperation(
    ledger: GenerationOperationLedger,
    snapshot: Awaited<ReturnType<GenerationInputSnapshotStore["open"]>>,
    stored: StoredGenerationRecoveryCall,
    prepared: PreparedGenerationToolExecution,
    actor: CanvasCommandActor,
  ) {
    if (!prepared.recovery || !this.#operations) {
      throw new Error("Generation recovery runtime is unavailable")
    }
    const temporaryDirectory = await fs.mkdtemp(path.join(this.#temporaryRoot, "convax-generation-recovery-"))
    try {
      const outputDirectory = path.join(temporaryDirectory, "output")
      await fs.mkdir(outputDirectory, { mode: 0o700 })
      const references = stored.references.map((reference) => {
        if (reference.kind === "text") {
          return {
            kind: "text",
            node_id: reference.nodeId,
            role: reference.role,
            text: reference.text,
          }
        }
        const file = snapshot.files[reference.fileIndex]
        if (!file) throw new Error("Generation recovery input file is missing")
        return {
          kind: "file",
          mime_type: reference.mimeType,
          name: reference.name,
          node_id: reference.nodeId,
          path: file.path,
          role: reference.role,
        }
      })
      const currentDocument = (await this.#application.query({ canvasId: ledger.canvasId, scopeId: ledger.projectId }))
        .projection
      await this.#assertStoredRecoveryCanvasInputs(ledger, stored, currentDocument)
      await prepared.call(
        {
          ...stored.input,
          operation_id: externalGenerationOperationId(
            {
              anchor: { x: 0, y: 0 },
              operationId: ledger.operationId,
              prompt: stored.prompt,
              ref: { canvasId: ledger.canvasId, scopeId: ledger.projectId },
              references: stored.canvasRequest.references,
              resultMode: { expectedTarget: stored.targetGuard, nodeId: ledger.nodeId, type: "replace-node" },
              toolId: ledger.toolId,
            },
            actor,
          ),
          output: stored.output,
          output_directory: outputDirectory,
          prompt: stored.prompt,
          references,
          schema: generationCallSchema,
        },
        undefined,
        async (event) => {
          if (event.type === "external-started") {
            const latestDocument = (
              await this.#application.query({ canvasId: ledger.canvasId, scopeId: ledger.projectId })
            ).projection
            await this.#assertStoredRecoveryCanvasInputs(ledger, stored, latestDocument)
            return
          }
          if (event.type !== "submitted" || !this.#operations) return
          await this.#operations.transition(ledger, { phase: "accepted", taskId: event.taskId })
          await this.#persistRecoveredTask(ledger, event.taskId, actor)
        },
        {
          operationId: ledger.operationId,
          recovery: "required",
          requestDigest: ledger.requestDigest,
        },
      )
      return prepared.recovery.get({
        operationId: ledger.operationId,
        requestDigest: ledger.requestDigest,
      })
    } finally {
      await fs.rm(temporaryDirectory, { force: true, recursive: true }).catch(() => undefined)
    }
  }

  #storedRecoveryCanvasRequest(
    ledger: GenerationOperationLedger,
    stored: StoredGenerationRecoveryCall,
  ): GenerationCanvasRequest {
    return {
      anchor: { x: 0, y: 0 },
      expectedOutputCount: stored.canvasRequest.expectedOutputCount,
      operationId: ledger.operationId,
      output: stored.canvasRequest.output,
      prompt: stored.canvasRequest.prompt ?? stored.prompt,
      ...(stored.canvasRequest.promptContextNodeIds === undefined
        ? {}
        : { promptContextNodeIds: [...stored.canvasRequest.promptContextNodeIds] }),
      ref: { canvasId: ledger.canvasId, scopeId: ledger.projectId },
      referenceConstraint: stored.canvasRequest.referenceConstraint,
      references: [...stored.canvasRequest.references],
      relationAnchorNodeIds: [...stored.canvasRequest.relationAnchorNodeIds],
      resultMode: { expectedTarget: stored.targetGuard, nodeId: ledger.nodeId, type: "replace-node" },
      toolId: ledger.toolId,
      toolInput: stored.input,
    }
  }

  async #assertStoredRecoveryCanvasInputs(
    ledger: GenerationOperationLedger,
    stored: StoredGenerationRecoveryCall,
    document: CanvasDocument,
  ) {
    const target = document.nodes.find((node) => node.id === ledger.nodeId)
    const run = target ? getCanvasNodeGenerationRun(target) : undefined
    if (
      !target ||
      target.type !== "file" ||
      !run ||
      run.operationId !== ledger.operationId ||
      !isCanvasNodeGenerationRunActive(run)
    ) {
      throw new Error("Generation recovery Canvas owner changed")
    }
    const currentGuard = createCanvasGenerationTargetGuard(target)
    if (
      generationOperationRequestDigest(currentGuard) !== ledger.targetGuardDigest ||
      generationOperationRequestDigest(currentGuard) !== generationOperationRequestDigest(stored.targetGuard)
    ) {
      throw new Error("Generation recovery replacement target changed")
    }
    const request = this.#storedRecoveryCanvasRequest(ledger, stored)
    const promptContexts = await this.#stagePromptContexts(document, request)
    if (
      composeGenerationPrompt(request, promptContexts) !== stored.prompt ||
      (stored.referenceSnapshot !== undefined &&
        generationReferenceSnapshot(document, request, promptContexts) !== stored.referenceSnapshot)
    ) {
      throw new Error("Generation recovery references changed")
    }
    return request
  }

  async #commitRecoveredResult(
    ledger: GenerationOperationLedger,
    stored: StoredGenerationRecoveryCall,
    tool: GenerationToolSummary,
    toolResult: McpToolCallResult,
    actor: CanvasCommandActor,
    replayDirectories?: {
      materializedDirectory: string
      outputDirectory: string
      outputDirectoryRealPath: string
    },
  ) {
    const ref = { canvasId: ledger.canvasId, scopeId: ledger.projectId }
    const snapshot = await this.#application.query(ref)
    await this.#assertStoredRecoveryCanvasInputs(ledger, stored, snapshot.projection)
    const temporaryDirectory = replayDirectories
      ? undefined
      : await fs.mkdtemp(path.join(this.#temporaryRoot, "convax-generation-result-"))
    try {
      const outputDirectory = replayDirectories?.outputDirectory ?? path.join(temporaryDirectory!, "output")
      const materializedDirectory =
        replayDirectories?.materializedDirectory ?? path.join(temporaryDirectory!, "materialized")
      if (!replayDirectories) {
        await Promise.all([
          fs.mkdir(outputDirectory, { mode: 0o700 }),
          fs.mkdir(materializedDirectory, { mode: 0o700 }),
        ])
      }
      const admitted = await this.#admitOutputs(
        tool,
        toolResult,
        outputDirectory,
        replayDirectories?.outputDirectoryRealPath ?? (await fs.realpath(outputDirectory)),
        materializedDirectory,
        undefined,
        1,
      )
      if (admitted.files.length + admitted.texts.length !== 1) {
        throw new Error("Generation recovery result must contain exactly one output")
      }
      let publishedPath: string
      if (admitted.texts.length) {
        publishedPath = requireGeneratedPublicationPath(
          (
            await this.#publisher.publishGenerated({
              bytes: Buffer.from(admitted.texts[0]!, "utf8"),
              extension: ".md",
              name: "generated",
              projectId: ledger.projectId,
            })
          ).path,
        )
      } else {
        const file = admitted.files[0]!
        publishedPath = requireGeneratedPublicationPath(
          (
            await this.#publisher.publishGenerated({
              extension: path.extname(file).toLowerCase(),
              name: "generated",
              projectId: ledger.projectId,
              sourcePath: file,
            })
          ).path,
        )
      }
      const latest = await this.#application.query(ref)
      await this.#assertStoredRecoveryCanvasInputs(ledger, stored, latest.projection)
      await this.#resources.replaceGeneratedResource({
        actor,
        canvasId: ledger.canvasId,
        commandId: `generation:${ledger.operationId}`,
        expectedTarget: stored.targetGuard,
        operationId: ledger.operationId,
        scopeId: ledger.projectId,
        source: { kind: "host-file", path: publishedPath, sourceId: randomUUID() },
        targetNodeId: ledger.nodeId,
      })
      this.#refreshRendererProjection(ref, [])
    } finally {
      if (temporaryDirectory) {
        await fs.rm(temporaryDirectory, { force: true, recursive: true }).catch(() => undefined)
      }
    }
  }

  async admitCanvas(
    input: GenerationCanvasAdmissionRequest,
    actor: CanvasCommandActor,
    signal?: AbortSignal,
  ): Promise<GenerationCanvasAdmissionResult> {
    validateAdmissionRequest(input)
    requireIdentifier(actor.id, "Generation actor id")
    requireIdentifier(actor.kind, "Generation actor kind")
    assertNotAborted(signal)

    let releaseDispatch!: () => void
    let rejectDispatch!: (failure: unknown) => void
    const dispatchGate = new Promise<void>((resolve, reject) => {
      releaseDispatch = resolve
      rejectDispatch = reject
    })
    // A failed admission may reject the gate before any execution reaches it.
    // Keep that bounded failure observed while admitted runs converge on it.
    void dispatchGate.catch(() => undefined)
    const admitted: GenerationExecutionTarget[] = []

    try {
      const preparedTools: NonNullable<GenerationCanvasServiceHooks["preparedTool"]>[] = []
      for (const step of input.steps) {
        preparedTools.push(await this.#preflightPendingAdmission(step.request, signal))
      }
      for (const [stepIndex, step] of input.steps.entries()) {
        assertNotAborted(signal)
        const relationAnchorNodeIds = [
          ...(step.request.relationAnchorNodeIds ?? []),
          ...(step.relationAnchorStepIndexes ?? []).map((index) => admitted[index]!.nodeId),
        ]
        const request: GenerationCanvasRequest = {
          ...step.request,
          ...(relationAnchorNodeIds.length === 0 ? {} : { relationAnchorNodeIds }),
        }
        let resolveAdmission!: (target: GenerationExecutionTarget) => void
        let rejectAdmission!: (failure: unknown) => void
        const admission = new Promise<GenerationExecutionTarget>((resolve, reject) => {
          resolveAdmission = resolve
          rejectAdmission = reject
        })
        const terminal = this.generate(request, actor, signal, {
          beforeExternalCall: () => dispatchGate,
          onRunStarted: resolveAdmission,
          preparedTool: preparedTools[stepIndex],
        })
        // Main owns terminal execution after admission. The admission caller
        // observes only pre-admission failure and never becomes task owner.
        void terminal.catch((failure) => {
          rejectAdmission(failure)
        })
        admitted.push(await waitForCaller(admission, signal))
      }
      assertNotAborted(signal)
      releaseDispatch()
      return {
        operations: admitted.map(({ nodeId, operationId }) => ({ nodeId, operationId })),
      }
    } catch (failure) {
      rejectDispatch(failure)
      throw failure
    }
  }

  async #preflightPendingAdmission(
    request: GenerationCanvasRequest,
    signal?: AbortSignal,
  ): Promise<NonNullable<GenerationCanvasServiceHooks["preparedTool"]>> {
    assertNotAborted(signal)
    const tool = selectTool(await this.#tools.listTools(request.output ? { output: request.output } : {}), request)
    const snapshot = await this.#application.query(request.ref)
    assertToolResultMode(tool, request.resultMode ?? { type: "add" })
    assertToolInputBinding(tool, request.referenceConstraint)
    const promptContexts = await this.#stagePromptContexts(snapshot.projection, request, signal)
    generationReferenceSnapshot(snapshot.projection, request, promptContexts)
    const execution = await this.#tools.prepareTool(tool, signal)
    execution.validateInput(request.toolInput)
    assertNotAborted(signal)
    return { execution, toolId: tool.id }
  }

  async generate(
    request: GenerationCanvasRequest,
    actor: CanvasCommandActor,
    signal?: AbortSignal,
    hooks?: GenerationCanvasServiceHooks,
  ): Promise<GenerationCanvasResult> {
    validateRequest(request)
    requireIdentifier(actor.id, "Generation actor id")
    requireIdentifier(actor.kind, "Generation actor kind")
    const key = JSON.stringify([request.ref.scopeId, request.ref.canvasId, actor.kind, actor.id, request.operationId])
    const fingerprint = stableJson({
      anchor: request.anchor,
      expectedOutputCount: request.expectedOutputCount,
      output: request.output,
      parentId: request.parentId,
      prompt: request.prompt,
      promptContextNodeIds: request.promptContextNodeIds ?? [],
      ref: request.ref,
      referenceConstraint: request.referenceConstraint,
      references: request.references,
      relationAnchorNodeIds: request.relationAnchorNodeIds ?? [],
      resultMode: request.resultMode ?? { type: "add" },
      toolId: request.toolId,
      toolInput: request.toolInput ?? {},
    })
    const existing = this.#executions.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new Error("Generation operation id was reused with a different request")
      }
      if (hooks?.onRunStarted) {
        if (existing.state.target) hooks.onRunStarted(existing.state.target)
        else existing.state.admissionListeners.add(hooks.onRunStarted)
      }
      return waitForCaller(existing.result, signal)
    }
    if (this.#executions.size >= maxGenerationExecutions) {
      const settled = [...this.#executions].find(([, execution]) => execution.state.settled)
      if (!settled) throw new Error("Too many generation operations are currently running")
      this.#executions.delete(settled[0])
    }

    const controller = new AbortController()
    const state: GenerationExecution["state"] = {
      admissionListeners: new Set(hooks?.onRunStarted ? [hooks.onRunStarted] : []),
      mustRetain: false,
      settled: false,
    }
    const result = this.#generateOnce(
      request,
      actor,
      controller.signal,
      () => {
        state.mustRetain = true
      },
      (target) => {
        state.target = target
        for (const listener of state.admissionListeners) listener(target)
        state.admissionListeners.clear()
      },
      hooks,
    )
    const execution = {
      actor: structuredClone(actor),
      controller,
      fingerprint,
      operationId: request.operationId,
      result,
      state,
    }
    this.#executions.set(key, execution)
    const stopUnacceptedExecution = () => {
      if (!state.mustRetain && !state.settled) {
        controller.abort(abortError(signal?.reason))
      }
    }
    if (signal?.aborted) stopUnacceptedExecution()
    else signal?.addEventListener("abort", stopUnacceptedExecution, { once: true })
    void result
      .then(
        () => {
          state.settled = true
        },
        () => {
          state.settled = true
          // Pure preflight errors are safe to retry. Once an external executable
          // was invoked or a pending Canvas node was committed, retain the failed
          // operation id as an at-most-once tombstone. Either side effect requires
          // a fresh operation id for another attempt.
          if (!state.mustRetain && this.#executions.get(key) === execution) {
            this.#executions.delete(key)
          }
        },
      )
      .finally(() => {
        signal?.removeEventListener("abort", stopUnacceptedExecution)
      })
    // Callers only own their wait. Once the run or external execution has been
    // accepted, renderer/frame/transport teardown must not cancel Main's task.
    return waitForCaller(result, signal)
  }

  async #generateOnce(
    request: GenerationCanvasRequest,
    actor: CanvasCommandActor,
    signal: AbortSignal | undefined,
    retainOperation: () => void,
    onRunStarted: (target: NonNullable<GenerationExecution["state"]["target"]>) => void,
    hooks?: GenerationCanvasServiceHooks,
  ): Promise<GenerationCanvasResult> {
    assertNotAborted(signal)
    const tool = selectTool(await this.#tools.listTools(request.output ? { output: request.output } : {}), request)
    const snapshot = await this.#application.query(request.ref)
    let workingRequest = request
    let workingDocument = snapshot.projection
    let resultMode = request.resultMode ?? { type: "add" as const }
    assertToolResultMode(tool, resultMode)
    assertToolInputBinding(tool, request.referenceConstraint)
    if (
      resultMode.type === "return" &&
      request.expectedOutputCount !== undefined &&
      request.expectedOutputCount !== 1
    ) {
      throw new Error("Returned Plugin operations must expect exactly one text output")
    }
    const replacementNodeId = resultMode.type === "replace-node" ? resultMode.nodeId : undefined
    const replacementTarget = replacementNodeId
      ? workingDocument.nodes.find((node) => node.id === replacementNodeId)
      : undefined
    if (resultMode.type === "replace-node") {
      if (!replacementTarget) throw new Error(`Generation replacement node was not found: ${resultMode.nodeId}`)
      if (replacementTarget.type !== "file" || replacementTarget.data.kind === "group") {
        throw new Error(`Generation replacement requires a Canvas file node: ${resultMode.nodeId}`)
      }
      if (stableJson(createCanvasGenerationTargetGuard(replacementTarget)) !== stableJson(resultMode.expectedTarget)) {
        throw new Error("Generation replacement target changed before the operation started")
      }
    }
    let replacementGuard: GenerationReplacementGuard | undefined =
      resultMode.type === "replace-node" ? { kind: "generation", value: resultMode.expectedTarget } : undefined
    let requiresStableReferences =
      request.referenceConstraint !== undefined ||
      (request.promptContextNodeIds?.length ?? 0) > 0 ||
      request.references.length > 0 ||
      (request.relationAnchorNodeIds?.length ?? 0) > 0
    const promptContexts = await this.#stagePromptContexts(workingDocument, workingRequest, signal)
    let effectivePrompt = composeGenerationPrompt(workingRequest, promptContexts)
    let referenceSnapshot = requiresStableReferences
      ? generationReferenceSnapshot(workingDocument, workingRequest, promptContexts)
      : undefined
    assertNotAborted(signal)
    let pendingTarget: PendingGenerationTarget | undefined
    let temporaryDirectory: string | undefined
    let runStarted = false
    let recordedTaskId: string | undefined
    let operationLedger: GenerationOperationLedger | undefined
    let operationInputSnapshotId: string | undefined
    let recoveryRequestDigest: string | undefined
    let externalStarted = false
    let preparedTool: PreparedGenerationToolExecution | undefined
    let releaseRecoveryStore: (() => void) | undefined

    try {
      // Tool availability, lease preparation, and schema validation are
      // admission preflight. A failure here must not leave a pending node.
      if (resultMode.type === "create-pending-node") {
        if (hooks?.preparedTool && hooks.preparedTool.toolId !== tool.id) {
          throw new Error("Generation tool changed during Canvas admission")
        }
        preparedTool = hooks?.preparedTool?.execution ?? (await this.#tools.prepareTool(tool, signal))
        preparedTool.validateInput(workingRequest.toolInput)
        assertNotAborted(signal)
      }

      if (resultMode.type === "create-pending-node") {
        const pendingSize = matchingVisualReferenceSize(workingDocument, workingRequest, tool.output)
        const pendingResult = await this.#resources.createPendingGenerationResource({
          actor,
          anchor: request.anchor,
          canvasId: request.ref.canvasId,
          commandId: `generation-pending:${request.operationId}`,
          kind: tool.output,
          operationId: request.operationId,
          ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
          prompt: workingRequest.prompt.trim(),
          relation: generationResultRelation(request),
          scopeId: request.ref.scopeId,
          signal,
          ...(pendingSize === undefined ? {} : { size: pendingSize }),
          toolId: tool.id,
        })
        retainOperation()
        if (pendingResult.createdNodeIds.length !== 1) {
          throw new Error("Pending generation must create exactly one Canvas node")
        }
        const nodeId = pendingResult.createdNodeIds[0]
        const pendingNode = pendingResult.document.nodes.find((node) => node.id === nodeId)
        if (
          !pendingNode ||
          pendingNode.type !== "file" ||
          pendingNode.data.kind !== tool.output ||
          pendingNode.data.status !== "pending" ||
          getCanvasNodeGenerationRun(pendingNode)?.operationId !== request.operationId
        ) {
          throw new Error("Pending generation did not create the expected Canvas file node and run")
        }
        pendingTarget = { nodeId }
        runStarted = true
        onRunStarted({
          canvasId: request.ref.canvasId,
          nodeId,
          operationId: request.operationId,
          scopeId: request.ref.scopeId,
        })
        const expectedTarget = createCanvasGenerationTargetGuard(pendingNode)
        workingRequest = { ...request, resultMode: { expectedTarget, nodeId, type: "replace-node" } }
        workingDocument = pendingResult.document
        resultMode = { expectedTarget, nodeId, type: "replace-node" }
        replacementGuard = { kind: "generation", value: expectedTarget }
        requiresStableReferences =
          workingRequest.referenceConstraint !== undefined ||
          (workingRequest.promptContextNodeIds?.length ?? 0) > 0 ||
          workingRequest.references.length > 0 ||
          (workingRequest.relationAnchorNodeIds?.length ?? 0) > 0
        effectivePrompt = composeGenerationPrompt(workingRequest, promptContexts)
        referenceSnapshot = requiresStableReferences
          ? generationReferenceSnapshot(workingDocument, workingRequest, promptContexts)
          : undefined

        this.#refreshRendererProjection(request.ref, [nodeId], { focus: true })
      } else if (replacementTarget && resultMode.type === "replace-node") {
        onRunStarted({
          canvasId: request.ref.canvasId,
          nodeId: resultMode.nodeId,
          operationId: request.operationId,
          scopeId: request.ref.scopeId,
        })
        const started = await this.#runs.start({
          actor,
          canvasId: request.ref.canvasId,
          commandId: `generation:${request.operationId}:submitting`,
          nodeId: resultMode.nodeId,
          operationId: request.operationId,
          prompt: workingRequest.prompt.trim(),
          scopeId: request.ref.scopeId,
          signal,
          toolId: tool.id,
        })
        retainOperation()
        runStarted = true
        workingDocument = started.document
        this.#refreshRendererProjection(request.ref, [])
      }

      if (tool.recovery && this.#operations && this.#inputSnapshots) {
        releaseRecoveryStore = await this.#acquireRecoveryStoreLock()
      }
      if (!preparedTool) {
        preparedTool = await this.#tools.prepareTool(tool, signal)
        preparedTool.validateInput(workingRequest.toolInput)
        assertNotAborted(signal)
      }

      temporaryDirectory = await fs.mkdtemp(path.join(this.#temporaryRoot, "convax-generation-"))
      const inputDirectory = path.join(temporaryDirectory, "inputs")
      const outputDirectory = path.join(temporaryDirectory, "output")
      const materializedDirectory = path.join(temporaryDirectory, "materialized")
      await Promise.all([
        fs.mkdir(inputDirectory, { mode: 0o700 }),
        fs.mkdir(outputDirectory, { mode: 0o700 }),
        fs.mkdir(materializedDirectory, { mode: 0o700 }),
      ])
      const outputDirectoryRealPath = await fs.realpath(outputDirectory)
      const references = await this.#stageReferences(workingDocument, workingRequest, inputDirectory, signal)
      assertNotAborted(signal)
      await this.#assertStableReferences(
        workingRequest,
        referenceSnapshot,
        promptContexts,
        references,
        requiresStableReferences,
      )
      if (replacementGuard) await this.#assertStableReplacementTarget(workingRequest, replacementGuard)
      assertNotAborted(signal)
      const toolInput = preparedTool.validateInput(workingRequest.toolInput)
      if (preparedTool.recovery && runStarted && resultMode.type === "replace-node") {
        if (!this.#inputSnapshots || !this.#operations) {
          throw new Error("Generation recovery private stores are unavailable")
        }
        let snapshotFileIndex = 0
        const canonicalRequest = {
          canvasRequest: {
            expectedOutputCount: workingRequest.expectedOutputCount,
            output: workingRequest.output,
            prompt: workingRequest.prompt.trim(),
            promptContextNodeIds: workingRequest.promptContextNodeIds ?? [],
            referenceConstraint: workingRequest.referenceConstraint,
            references: workingRequest.references,
            relationAnchorNodeIds: workingRequest.relationAnchorNodeIds ?? [],
            resultMode: workingRequest.resultMode,
          },
          input: toolInput,
          operationId: workingRequest.operationId,
          output: tool.output,
          prompt: effectivePrompt,
          referenceSnapshot,
          references: references.map((reference) => {
            if (reference.kind === "text") {
              return {
                kind: "text",
                nodeId: reference.nodeId,
                role: reference.role,
                text: reference.text,
              }
            }
            const fileIndex = snapshotFileIndex
            snapshotFileIndex += 1
            return {
              fileIndex,
              kind: "file",
              mimeType: reference.mimeType,
              name: reference.name,
              nodeId: reference.nodeId,
              role: reference.role,
            }
          }),
          schema: "convax.generation-lro-call/1",
          targetGuard: replacementGuard!.value,
          toolId: tool.id,
        }
        const inputSnapshot = await this.#inputSnapshots.create({
          files: references.flatMap((reference) =>
            reference.kind === "file"
              ? [{ logicalName: safeFileName(reference.name, "reference"), sourcePath: reference.path }]
              : [],
          ),
          request: canonicalRequest,
        })
        operationInputSnapshotId = inputSnapshot.id
        recoveryRequestDigest = inputSnapshot.requestDigest
        const targetGuardDigest = generationOperationRequestDigest(replacementGuard!.value)
        operationLedger = await this.#operations.create({
          canvasId: workingRequest.ref.canvasId,
          createdAt: 0,
          executionBindingDigest: preparedTool.recovery.executionBindingDigest,
          inputSnapshotId: inputSnapshot.id,
          nodeId: resultMode.nodeId,
          operationId: workingRequest.operationId,
          phase: "prepared",
          pluginPackageDigest: preparedTool.recovery.pluginPackageDigest,
          projectId: workingRequest.ref.scopeId,
          requestDigest: inputSnapshot.requestDigest,
          runtimeAuthorizationDigest: preparedTool.recovery.runtimeAuthorizationDigest,
          schema: generationOperationLedgerSchema,
          sidecarRecoveryBindingDigest: preparedTool.recovery.bindingDigest,
          targetGuardDigest,
          toolId: tool.id,
          updatedAt: 0,
        })
      }
      releaseRecoveryStore?.()
      releaseRecoveryStore = undefined
      const validateDispatchCanvas = async () => {
        await this.#assertStableReferences(
          workingRequest,
          referenceSnapshot,
          promptContexts,
          references,
          requiresStableReferences,
        )
        if (replacementGuard) {
          await this.#assertStableReplacementTarget(workingRequest, replacementGuard)
        }
        assertNotAborted(signal)
      }
      const dispatchHooks: GenerationToolDispatchHooks = {
        validate: async () => {
          await validateDispatchCanvas()
          await hooks?.beforeExternalCall?.()
          assertNotAborted(signal)
        },
      }
      const lifecycleObserver: GenerationToolLifecycleObserver = async (event) => {
        if (!runStarted || resultMode.type !== "replace-node") {
          if (event.type === "external-started") retainOperation()
          return
        }
        if (event.type === "submitted" && recordedTaskId === event.taskId) return
        if (event.type === "submitted" && operationLedger && this.#operations) {
          operationLedger = await this.#operations.transition(operationLedger, {
            phase: "accepted",
            taskId: event.taskId,
          })
        }
        await this.#runs.markRunning({
          actor,
          canvasId: workingRequest.ref.canvasId,
          commandId:
            event.type === "external-started"
              ? `generation:${workingRequest.operationId}:running`
              : `generation:${workingRequest.operationId}:task:${event.taskId}`,
          nodeId: resultMode.nodeId,
          operationId: workingRequest.operationId,
          scopeId: workingRequest.ref.scopeId,
          signal,
          ...(event.type === "submitted" ? { taskId: event.taskId } : {}),
        })
        if (event.type === "submitted") recordedTaskId = event.taskId
        if (event.type === "external-started") {
          // markRunning may reconcile a newer Canvas revision. Verify the exact
          // staged references and replacement owner once more before granting
          // durable dispatch authorization.
          await validateDispatchCanvas()
          retainOperation()
          if (operationLedger && this.#operations) {
            operationLedger = await this.#operations.transition(operationLedger, { phase: "dispatching" })
          }
          // The durable transition above is the final persistence boundary
          // before tools/call. Recheck mutable Canvas state once more after it
          // completes so edits during persistence cannot cross into the paid
          // external dispatch.
          await validateDispatchCanvas()
          externalStarted = true
        }
      }
      let toolResult = await preparedTool.call(
        {
          ...toolInput,
          operation_id: externalGenerationOperationId(workingRequest, actor),
          output: tool.output,
          output_directory: outputDirectory,
          prompt: effectivePrompt,
          references: references.map((reference) =>
            reference.kind === "text"
              ? {
                  kind: reference.kind,
                  node_id: reference.nodeId,
                  role: reference.role,
                  text: reference.text,
                }
              : {
                  kind: reference.kind,
                  mime_type: reference.mimeType,
                  name: reference.name,
                  node_id: reference.nodeId,
                  path: reference.path,
                  role: reference.role,
                },
          ),
          schema: generationCallSchema,
        },
        signal,
        lifecycleObserver,
        preparedTool.recovery
          ? {
              operationId: workingRequest.operationId,
              recovery: "required",
              requestDigest:
                recoveryRequestDigest ??
                generationOperationRequestDigest({
                  input: toolInput,
                  output: tool.output,
                  prompt: effectivePrompt,
                  schema: generationCallSchema,
                  toolId: tool.id,
                }),
            }
          : undefined,
        dispatchHooks,
      )
      let recoveryResultDigest: string | undefined
      if (operationLedger && preparedTool.recovery && this.#operations) {
        let recoveryState = await preparedTool.recovery.get(
          {
            operationId: operationLedger.operationId,
            requestDigest: operationLedger.requestDigest,
            ...(recordedTaskId === undefined ? {} : { taskId: recordedTaskId }),
          },
          signal,
        )
        for (let observation = 0; recoveryState.status === "submitted" || recoveryState.status === "running"; ) {
          await lifecycleObserver({ type: "submitted", taskId: recoveryState.taskId })
          recoveryState = await preparedTool.recovery.wait(
            {
              operationId: operationLedger.operationId,
              requestDigest: operationLedger.requestDigest,
              taskId: recoveryState.taskId,
            },
            signal,
          )
          await waitForGenerationRecoveryObservation(observation)
          observation += 1
        }
        if (recoveryState.status !== "succeeded") {
          if (toolResult.isError) throw new GenerationToolReportedError(toolResult.content)
          throw new Error("Recoverable generation returned without a durable succeeded result")
        }
        recordedTaskId = recoveryState.taskId
        const replayed = await preparedTool.recovery.result(
          {
            operationId: operationLedger.operationId,
            outputDirectory,
            requestDigest: operationLedger.requestDigest,
            resultDigest: recoveryState.resultDigest,
            taskId: recoveryState.taskId,
          },
          signal,
        )
        if ((await generationRecoveryResultDigest(replayed.result, outputDirectory)) !== replayed.resultDigest) {
          throw new Error("Generation recovery result digest changed")
        }
        toolResult = replayed.result
        recoveryResultDigest = replayed.resultDigest
        operationLedger = await this.#operations.transition(operationLedger, {
          phase: "result-ready",
          resultDigest: replayed.resultDigest,
          taskId: recoveryState.taskId,
        })
      }
      assertNotAborted(signal)
      await this.#assertStableReferences(
        workingRequest,
        referenceSnapshot,
        promptContexts,
        references,
        requiresStableReferences,
      )
      if (replacementGuard) await this.#assertStableReplacementTarget(workingRequest, replacementGuard)
      if (toolResult.isError) {
        throw new GenerationToolReportedError(toolResult.content)
      }
      const admitted = await this.#admitOutputs(
        tool,
        toolResult,
        outputDirectory,
        outputDirectoryRealPath,
        materializedDirectory,
        signal,
        resultMode.type === "replace-node" || resultMode.type === "return" ? 1 : this.#maxOutputFiles,
      )
      const admittedOutputCount = admitted.files.length + admitted.texts.length
      if (
        workingRequest.expectedOutputCount !== undefined &&
        admittedOutputCount !== workingRequest.expectedOutputCount
      ) {
        throw new Error(
          `Generation tool returned ${admittedOutputCount} outputs; expected exactly ${workingRequest.expectedOutputCount}`,
        )
      }
      const stableDocument = await this.#assertStableReferences(
        workingRequest,
        referenceSnapshot,
        promptContexts,
        references,
        requiresStableReferences,
      )
      if (replacementGuard) await this.#assertStableReplacementTarget(workingRequest, replacementGuard)
      assertNotAborted(signal)

      if (resultMode.type === "return") {
        if (admitted.files.length || admitted.texts.length !== 1) {
          throw new Error("Returned Plugin operation must return exactly one MCP text result")
        }
        const outputText = admitted.texts[0]
        if (Buffer.byteLength(outputText, "utf8") > maxReturnedOutputTextBytes) {
          throw new Error("Returned Plugin operation text exceeds the Agent result size limit")
        }
        const currentDocument = stableDocument ?? (await this.#application.query(workingRequest.ref)).projection
        assertNotAborted(signal)
        return {
          createdNodeIds: [],
          operationReceipt: null,
          outputText,
          projection: structuredClone(currentDocument),
          toolId: tool.id,
          warnings: admitted.warnings,
        }
      }

      const publishedPaths: string[] = []
      let result: CanvasApplicationCommandResult
      try {
        for (const text of admitted.texts) {
          assertNotAborted(signal)
          const published = await this.#publisher.publishGenerated({
            bytes: Buffer.from(text, "utf8"),
            extension: ".md",
            name: "generated",
            projectId: workingRequest.ref.scopeId,
          })
          publishedPaths.push(requireGeneratedPublicationPath(published.path))
        }
        for (const file of admitted.files) {
          assertNotAborted(signal)
          const extension = path.extname(file).toLowerCase()
          if (!Object.values(outputExtensions).includes(extension)) {
            throw new Error("Generation admitted output has no canonical extension")
          }
          const published = await this.#publisher.publishGenerated({
            extension,
            name: "generated",
            projectId: workingRequest.ref.scopeId,
            sourcePath: file,
          })
          publishedPaths.push(requireGeneratedPublicationPath(published.path))
        }
        await this.#assertStableReferences(
          workingRequest,
          referenceSnapshot,
          promptContexts,
          references,
          requiresStableReferences,
        )
        if (replacementGuard) await this.#assertStableReplacementTarget(workingRequest, replacementGuard)
        const sources: CanvasAddResourceSourcesRequest["sources"] = publishedPaths.map((publishedPath) => ({
          kind: "host-file",
          path: publishedPath,
          sourceId: randomUUID(),
        }))
        if (!sources.length) throw new Error("Generation tool returned no usable output")
        if (resultMode.type === "replace-node" && sources.length !== 1) {
          throw new Error("Card generation must resolve to exactly one replacement resource")
        }
        assertNotAborted(signal)
        result =
          resultMode.type === "replace-node"
            ? await this.#resources.replaceGeneratedResource({
                actor,
                canvasId: workingRequest.ref.canvasId,
                commandId: `generation:${workingRequest.operationId}`,
                expectedTarget: replacementGuard!.value,
                operationId: workingRequest.operationId,
                scopeId: workingRequest.ref.scopeId,
                signal,
                source: sources[0],
                targetNodeId: resultMode.nodeId,
              })
            : await this.#resources.addResources({
                actor,
                anchor: workingRequest.anchor,
                canvasId: workingRequest.ref.canvasId,
                commandId: `generation:${workingRequest.operationId}`,
                relation: generationResultRelation(workingRequest),
                scopeId: workingRequest.ref.scopeId,
                ...(signal ? { signal } : {}),
                sources,
              })
      } catch (error) {
        if (publishedPaths.length) throw new GenerationPublicationPartialSuccessError(publishedPaths, error)
        throw error
      }
      const warnings = normalizeGenerationWarnings([...admitted.warnings, ...result.warnings])
      const completedRecovery = preparedTool?.recovery
      if (operationLedger && completedRecovery && this.#operations && recoveryResultDigest) {
        try {
          operationLedger = await this.#operations.transition(operationLedger, {
            phase: "committed",
            resultDigest: recoveryResultDigest,
            ...(recordedTaskId === undefined ? {} : { taskId: recordedTaskId }),
          })
          await this.#acknowledgeAndCleanup(operationLedger, () =>
            completedRecovery.acknowledge({
              operationId: operationLedger!.operationId,
              requestDigest: operationLedger!.requestDigest,
              resultDigest: recoveryResultDigest,
              ...(recordedTaskId === undefined ? {} : { taskId: recordedTaskId }),
            }),
          )
        } catch (error) {
          this.#logGenerationFailure("committed receipt finalization", error)
        }
      }
      this.#refreshRendererProjection(request.ref, result.createdNodeIds)
      return {
        createdNodeIds: pendingTarget ? [pendingTarget.nodeId] : result.createdNodeIds,
        operationReceipt: structuredClone(result.operationReceipt),
        projection: structuredClone(result.document),
        toolId: tool.id,
        warnings,
      }
    } catch (error) {
      this.#logGenerationFailure("tool execution", error)
      if (!operationLedger && operationInputSnapshotId && this.#inputSnapshots) {
        await this.#inputSnapshots.remove(operationInputSnapshotId).catch(() => undefined)
      }
      if (runStarted && resultMode.type === "replace-node") {
        try {
          let terminalIsProven = !externalStarted
          let terminalPhase: "cancelled" | "failed" | "indeterminate" = isAbortFailure(error, signal)
            ? "cancelled"
            : "failed"
          const recovery = preparedTool?.recovery
          const definitelyNotDispatched =
            !externalStarted && operationLedger !== undefined && operationLedger.phase === "prepared"
          let recoveryTerminal:
            | { status: "absent" | "prepared" | "unknown" }
            | { status: "submitted" | "running" | "succeeded"; taskId: string }
            | { status: "failed" | "cancelled"; taskId?: string }
            | undefined
          if (operationLedger && recovery && this.#operations) {
            recoveryTerminal = definitelyNotDispatched
              ? { status: "prepared" }
              : await (isAbortFailure(error, signal)
                  ? recovery.cancel({
                      operationId: operationLedger.operationId,
                      requestDigest: operationLedger.requestDigest,
                      ...(recordedTaskId === undefined ? {} : { taskId: recordedTaskId }),
                    })
                  : recovery.get({
                      operationId: operationLedger.operationId,
                      requestDigest: operationLedger.requestDigest,
                      ...(recordedTaskId === undefined ? {} : { taskId: recordedTaskId }),
                    }))
            if (recoveryTerminal.status === "succeeded") {
              // The exact terminal result remains replayable. Keep the Canvas run
              // active so startup recovery can finish the guarded commit.
              this.#ensureStoredSupervision(operationLedger, actor, false)
              throw error
            }
            if (recoveryTerminal.status === "submitted" || recoveryTerminal.status === "running") {
              operationLedger = await this.#operations.transition(operationLedger, {
                phase: "accepted",
                taskId: recoveryTerminal.taskId,
              })
              this.#ensureStoredSupervision(operationLedger, actor, false)
              throw error
            }
            if (
              externalStarted &&
              (recoveryTerminal.status === "absent" || recoveryTerminal.status === "prepared")
            ) {
              // Dispatch authorization crossed the durable boundary, but the
              // sidecar has not yet persisted provider acceptance. Preserve
              // the exact stored request so supervision can safely replay it.
              this.#ensureStoredSupervision(operationLedger, actor, false)
              throw error
            }
            if (
              recoveryTerminal.status === "absent" ||
              recoveryTerminal.status === "prepared" ||
              recoveryTerminal.status === "failed" ||
              recoveryTerminal.status === "cancelled"
            ) {
              terminalIsProven = true
              terminalPhase =
                recoveryTerminal.status === "cancelled" || isAbortFailure(error, signal) ? "cancelled" : "failed"
            } else {
              terminalIsProven = false
              terminalPhase = "indeterminate"
            }
            operationLedger = await this.#operations.transition(operationLedger, {
              phase: terminalPhase,
              ...("taskId" in recoveryTerminal && recoveryTerminal.taskId ? { taskId: recoveryTerminal.taskId } : {}),
            })
          } else if (externalStarted && isAbortFailure(error, signal)) {
            terminalIsProven = false
            terminalPhase = "indeterminate"
          }
          const failureMessage = generationFailureMessage(error, tool)
          await this.#runs.finish({
            actor,
            canvasId: request.ref.canvasId,
            commandId: `generation:${request.operationId}:terminal`,
            ...(failureMessage === undefined ? {} : { failureMessage }),
            nodeId: resultMode.nodeId,
            operationId: request.operationId,
            scopeId: request.ref.scopeId,
          })
          this.#refreshRendererProjection(request.ref, [])
          if (
            operationLedger &&
            recovery &&
            terminalIsProven &&
            recoveryTerminal &&
            (recoveryTerminal.status === "absent" ||
              recoveryTerminal.status === "prepared" ||
              recoveryTerminal.status === "failed" ||
              recoveryTerminal.status === "cancelled")
          ) {
            if (definitelyNotDispatched) {
              await this.#finalizeNeverDispatchedOperation(
                operationLedger,
                terminalPhase === "cancelled" ? "cancelled" : "failed",
              )
            } else {
              await this.#acknowledgeAndCleanup(operationLedger, () =>
                recovery.acknowledge({
                  operationId: operationLedger!.operationId,
                  requestDigest: operationLedger!.requestDigest,
                  ...("taskId" in recoveryTerminal && recoveryTerminal.taskId
                    ? { taskId: recoveryTerminal.taskId }
                    : {}),
                }),
              )
            }
          }
        } catch (terminalError) {
          if (terminalError === error) throw error
          this.#logGenerationFailure("terminal Canvas persistence", terminalError)
        }
      }
      throw error
    } finally {
      releaseRecoveryStore?.()
      if (temporaryDirectory) {
        await fs.rm(temporaryDirectory, { force: true, recursive: true }).catch(() => undefined)
      }
    }
  }

  #refreshRendererProjection(
    ref: GenerationCanvasRequest["ref"],
    nodeIds: readonly string[],
    options: { focus?: boolean } = {},
  ) {
    void (async () => {
      const reloaded = await this.#renderer.reloadDocument(ref)
      if (!reloaded || nodeIds.length === 0) return
      await this.#renderer.executeView({
        command: options.focus
          ? {
              animation: "smooth",
              fit: "center",
              nodeIds: [...nodeIds],
              select: true,
              type: "nodes.reveal",
            }
          : {
              fit: "none",
              nodeIds: [...nodeIds],
              select: false,
              type: "nodes.reveal",
            },
        expectedDocumentId: ref.canvasId,
        expectedScopeId: ref.scopeId,
        viewId: "desktop-main",
      })
    })().catch((error) => this.#logGenerationFailure("renderer projection refresh", error))
  }

  #logGenerationFailure(stage: string, error: unknown) {
    const diagnostics: Array<{ message?: string; name: string }> = []
    let current: unknown = error
    for (let depth = 0; depth < 4 && current !== undefined; depth += 1) {
      if (!(current instanceof Error)) {
        const message = safeGenerationLogMessage(String(current))
        diagnostics.push({ ...(message === undefined ? {} : { message }), name: typeof current })
        break
      }
      const message = safeGenerationLogMessage(current.message)
      diagnostics.push({
        ...(message === undefined ? {} : { message }),
        name: /^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(current.name) ? current.name : "Error",
      })
      current = current.cause
    }
    console.warn(`Canvas generation ${stage} failed`, { diagnostics })
  }

  async #assertStableReplacementTarget(request: GenerationCanvasRequest, expected: GenerationReplacementGuard) {
    let document: CanvasDocument | null
    try {
      document = (await this.#application.query(request.ref)).projection
    } catch {
      document = null
    }
    const mode = request.resultMode
    const target =
      document && mode?.type === "replace-node" ? document.nodes.find((node) => node.id === mode.nodeId) : undefined
    if (
      !document ||
      !target ||
      target.type !== "file" ||
      target.data.kind === "group" ||
      stableJson(createCanvasGenerationTargetGuard(target)) !== stableJson(expected.value)
    ) {
      throw new Error("Generation replacement target changed while the tool was running")
    }
  }

  async #assertStableCanvasDocument(
    request: GenerationCanvasRequest,
    expectedReferenceSnapshot: string | undefined,
    promptContexts: readonly StagedPromptContext[],
    required: boolean,
  ) {
    if (!required) return undefined
    let document: CanvasDocument | null
    try {
      const snapshot = await this.#application.query(request.ref)
      document = snapshot.projection
    } catch {
      // Collapse every stale document/edge/source shape to one application error.
      document = null
    }
    if (!document) {
      throw new Error(
        request.referenceConstraint !== undefined
          ? "Generation direct incoming references changed while the tool was running"
          : "Generation references changed while the tool was running",
      )
    }
    let currentReferenceSnapshot: string
    try {
      currentReferenceSnapshot = generationReferenceSnapshot(document, request, promptContexts)
    } catch {
      currentReferenceSnapshot = ""
    }
    if (expectedReferenceSnapshot === undefined || currentReferenceSnapshot === expectedReferenceSnapshot) {
      return document
    }
    if (request.referenceConstraint !== undefined) {
      throw new Error("Generation direct incoming references changed while the tool was running")
    }
    throw new Error("Generation references changed while the tool was running")
  }

  async #assertStableReferences(
    request: GenerationCanvasRequest,
    expectedReferenceSnapshot: string | undefined,
    promptContexts: readonly StagedPromptContext[],
    references: readonly StagedReference[],
    required: boolean,
  ) {
    const document = await this.#assertStableCanvasDocument(
      request,
      expectedReferenceSnapshot,
      promptContexts,
      required,
    )
    try {
      await Promise.all(
        [...promptContexts, ...references].map((reference) =>
          this.#assertProjectResourceSnapshot(request, reference.sourceSnapshot),
        ),
      )
    } catch {
      throw new Error(
        request.referenceConstraint !== undefined
          ? "Generation direct incoming references changed while the tool was running"
          : "Generation references changed while the tool was running",
      )
    }
    return document
  }

  async #assertProjectResourceSnapshot(request: GenerationCanvasRequest, expected: ProjectResourceSnapshot) {
    let sourcePath: string
    let expectedSize: number | undefined
    if (expected.reference.kind === "managed-asset") {
      sourcePath = await this.#assets.resolve({
        projectId: request.ref.scopeId,
        reference: expected.reference,
      })
    } else {
      const info = await this.#projects.readFileInfo({
        path: expected.reference.path,
        projectId: request.ref.scopeId,
      })
      expectedSize = info.size
      sourcePath = await this.#projects.resolveEntryPath({
        path: expected.reference.path,
        projectId: request.ref.scopeId,
      })
    }
    const current = await captureProjectResourceSnapshot({
      expectedRealPath: await fs.realpath(sourcePath),
      expectedSize,
      nodeId: expected.nodeId,
      reference: expected.reference,
      sourcePath,
    })
    if (
      current.realPath !== expected.realPath ||
      current.sourcePath !== expected.sourcePath ||
      !sameNativeFileSnapshot(current.stat, expected.stat)
    ) {
      throw projectResourceChangedError(expected.nodeId)
    }
  }

  async #stagePromptContexts(
    document: CanvasDocument,
    request: GenerationCanvasRequest,
    signal?: AbortSignal,
  ): Promise<StagedPromptContext[]> {
    const { incoming } = generationReferenceConstraint(document, request)
    const nodes = generationPromptContextNodes(document, request, incoming)
    const contexts: StagedPromptContext[] = []
    for (const node of nodes) {
      assertNotAborted(signal)
      const resolved = await this.#resolveProjectResourceReference(request.ref.scopeId, node, signal)
      assertNotAborted(signal)
      if (resolved.sourceSnapshot.stat.size < 1n) {
        throw new Error(`Generation prompt context is empty: ${node.id}`)
      }
      if (resolved.sourceSnapshot.stat.size > BigInt(maxTextReferenceLength)) {
        throw new Error(`Generation prompt context is invalid or too large: ${node.id}`)
      }
      const sourceText = await readStableUtf8Resource(resolved.sourceSnapshot, maxTextReferenceLength)
      assertNotAborted(signal)
      if (sourceText.includes("\0")) {
        throw new Error(`Generation prompt context is invalid or too large: ${node.id}`)
      }
      const promptText = sourceText.trim()
      if (!promptText) throw new Error(`Generation prompt context is empty: ${node.id}`)
      if (Buffer.byteLength(promptText, "utf8") > maxPromptLength) {
        throw new Error(`Generation prompt context is too large: ${node.id}`)
      }
      await this.#assertProjectResourceSnapshot(request, resolved.sourceSnapshot)
      assertNotAborted(signal)
      contexts.push({
        nodeId: node.id,
        promptText,
        sourceSnapshot: resolved.sourceSnapshot,
        sourceText,
      })
    }
    return contexts
  }

  async #stageReferences(
    document: CanvasDocument,
    request: GenerationCanvasRequest,
    inputDirectory: string,
    signal?: AbortSignal,
  ): Promise<StagedReference[]> {
    const references: StagedReference[] = []
    let stagedBytes = 0
    for (const [index, reference] of request.references.entries()) {
      assertNotAborted(signal)
      const node = document.nodes.find((candidate) => candidate.id === reference.nodeId)
      if (!node) throw new Error(`Generation reference node was not found: ${reference.nodeId}`)
      const expectedKind = expectedNodeKind(reference.role)
      if (node.data.kind !== expectedKind) {
        throw new Error(`Generation role ${reference.role} requires a ${expectedKind} node: ${reference.nodeId}`)
      }
      const resolved = await this.#resolveProjectResourceReference(request.ref.scopeId, node, signal)
      if (reference.role === "text") {
        const text = await readStableUtf8Resource(resolved.sourceSnapshot, maxTextReferenceLength)
        const textBytes = Buffer.byteLength(text, "utf8")
        if (!text || textBytes > maxTextReferenceLength) {
          throw new Error(`Generation text reference is empty or too large: ${reference.nodeId}`)
        }
        stagedBytes += textBytes
        if (stagedBytes > this.#maxInputBytes)
          throw new Error("Generation references exceed the total input size limit")
        await this.#assertProjectResourceSnapshot(request, resolved.sourceSnapshot)
        references.push({
          kind: "text",
          nodeId: node.id,
          role: reference.role,
          sourceSnapshot: resolved.sourceSnapshot,
          text,
        })
        continue
      }
      const size = Number(resolved.sourceSnapshot.stat.size)
      if (!Number.isSafeInteger(size) || size < 1 || size > this.#maxInputFileBytes) {
        throw new Error(`Generation reference file is empty or too large: ${reference.nodeId}`)
      }
      stagedBytes += size
      if (stagedBytes > this.#maxInputBytes) throw new Error("Generation references exceed the total input size limit")
      const target = path.join(inputDirectory, `${index + 1}-${safeFileName(resolved.name, `reference-${index + 1}`)}`)
      await copyStableFile({
        description: `Generation reference file ${reference.nodeId}`,
        expectedRealPath: resolved.sourceSnapshot.realPath,
        expectedSize: size,
        linkPolicy: "stable-count",
        maximumBytes: this.#maxInputFileBytes,
        prepareTarget: () => target,
        signal,
        sourcePath: resolved.sourceSnapshot.sourcePath,
      })
      const handle = await fs.open(target, constants.O_RDONLY)
      let header: Buffer
      try {
        header = Buffer.alloc(Math.min(32, size))
        const { bytesRead } = await handle.read(header, 0, header.length, 0)
        header = header.subarray(0, bytesRead)
      } finally {
        await handle.close().catch(() => undefined)
      }
      const detectedMimeType = signatureMimeType(header)
      if (
        !detectedMimeType ||
        !detectedMimeType.startsWith(expectedMimePrefix(reference.role)) ||
        (resolved.mimeType && !compatibleMimeTypes(resolved.mimeType, detectedMimeType))
      ) {
        throw new Error(
          `Generation reference MIME type does not match ${reference.role}: ${detectedMimeType || "unknown"}`,
        )
      }
      await this.#assertProjectResourceSnapshot(request, resolved.sourceSnapshot)
      references.push({
        kind: "file",
        mimeType: detectedMimeType,
        name: resolved.name,
        nodeId: node.id,
        path: target,
        role: reference.role,
        sourceSnapshot: resolved.sourceSnapshot,
      })
    }
    return references
  }

  async #resolveProjectResourceReference(projectId: string, node: CanvasNode, signal?: AbortSignal) {
    assertNotAborted(signal)
    const canonicalResource = getCanonicalCanvasResource(node)
    let reference: ProjectResourceReference | null
    if (canonicalResource) {
      const currentResources = await this.#currentResources.queryCurrentResources({
        projectId: parseProjectId(projectId),
      })
      assertNotAborted(signal)
      const resolution = resolveCurrentProjectResource({
        currentResources,
        name: node.data.label || canonicalResource.contentDigest,
        resource: canonicalResource,
      })
      reference = resolution.status === "ready" ? resolution.reference : null
    } else {
      reference = getProjectResourceReference(nodeMetadata(node))
    }
    if (!reference) throw new Error(`Generation reference requires a typed Project resource: ${node.id}`)
    if (reference.kind === "project-directory") {
      throw new Error(`Generation reference cannot use a Project directory: ${node.id}`)
    }

    let expectedSize: number | undefined
    let mimeType = normalizeMimeType(reference.kind === "managed-asset" ? reference.mediaType : undefined)
    let name = reference.kind === "managed-asset" ? reference.name : path.posix.basename(reference.path)
    let sourcePath: string
    if (reference.kind === "managed-asset") {
      sourcePath = await this.#assets.resolve({ projectId, reference })
      assertNotAborted(signal)
    } else {
      const info = await this.#projects.readFileInfo({ path: reference.path, projectId })
      assertNotAborted(signal)
      expectedSize = info.size
      mimeType = normalizeMimeType(info.mimeType)
      name = info.name
      sourcePath = await this.#projects.resolveEntryPath({ path: reference.path, projectId })
      assertNotAborted(signal)
    }
    const realPath = await fs.realpath(sourcePath)
    assertNotAborted(signal)
    const sourceSnapshot = await captureProjectResourceSnapshot({
      expectedRealPath: realPath,
      expectedSize,
      nodeId: node.id,
      reference,
      sourcePath,
    })
    return { mimeType, name, sourceSnapshot }
  }

  async #admitOutputs(
    tool: GenerationToolSummary,
    result: McpToolCallResult,
    outputDirectory: string,
    outputDirectoryRealPath: string,
    materializedDirectory: string,
    signal?: AbortSignal,
    maximumAdmittedFiles = this.#maxOutputFiles,
  ) {
    if (!Number.isSafeInteger(maximumAdmittedFiles) || maximumAdmittedFiles < 1) {
      throw new Error("Generation output admission limit is invalid")
    }
    await assertPinnedOutputDirectory(outputDirectory, outputDirectoryRealPath)
    const warnings: string[] = []
    const texts = result.content
      .filter((content): content is Extract<McpToolContent, { type: "text" }> => content.type === "text")
      .map((content) => content.text.trim())
      .filter(Boolean)
    if (texts.reduce((total, text) => total + Buffer.byteLength(text, "utf8"), 0) > maxTextReferenceLength) {
      throw new Error("Generation tool returned too much text")
    }
    const files: string[] = []
    const reportedPaths = new Set<string>()
    let declaredFileCount = 0
    let omittedFileCount = 0
    if (tool.output !== "text") warnings.push(...texts)

    for (const content of result.content) {
      assertNotAborted(signal)
      if (content.type === "text") continue
      declaredFileCount += 1
      if (declaredFileCount > this.#maxOutputFiles) throw new Error("Generation tool returned too many output files")
      if (files.length >= maximumAdmittedFiles) {
        omittedFileCount += 1
        continue
      }
      if (content.type === "image" || content.type === "audio") {
        const expected = content.type
        if (tool.output !== expected)
          throw new Error(`Generation tool returned ${content.type} data for ${tool.output} output`)
        const mimeType = normalizeMimeType(content.mimeType)
        const data = decodeBase64(content.data, Math.min(this.#maxInlineOutputFileBytes, this.#maxOutputFileBytes))
        const detected = signatureMimeType(data.subarray(0, 32))
        if (!detected || modalityForMimeType(detected) !== tool.output || !compatibleMimeTypes(mimeType, detected)) {
          throw new Error("Generation inline output MIME type does not match its content")
        }
        const extension = outputExtensions[detected]
        if (!extension) throw new Error(`Generation output MIME type is not supported: ${detected}`)
        const target = path.join(materializedDirectory, `${files.length + 1}-${randomUUID()}${extension}`)
        await fs.writeFile(target, data, { flag: "wx", mode: 0o600 })
        files.push(target)
        continue
      }
      if (content.type === "resource_link") {
        let sourcePath: string
        try {
          const url = new URL(content.uri)
          if (url.protocol !== "file:") throw new Error("not file")
          sourcePath = fileURLToPath(url)
        } catch {
          throw new Error("Generation resource links must be file URLs below output_directory")
        }
        const realPath = await fs.realpath(sourcePath)
        if (reportedPaths.has(realPath)) continue
        reportedPaths.add(realPath)
        files.push(
          await this.#admitOutputFile(
            sourcePath,
            tool.output,
            content.mimeType,
            content.name,
            outputDirectory,
            outputDirectoryRealPath,
            materializedDirectory,
            files.length,
            signal,
          ),
        )
      }
    }

    for (const artifact of structuredArtifacts(result.structuredContent, this.#maxOutputFiles)) {
      assertNotAborted(signal)
      declaredFileCount += 1
      if (declaredFileCount > this.#maxOutputFiles) throw new Error("Generation tool returned too many output files")
      if (files.length >= maximumAdmittedFiles) {
        omittedFileCount += 1
        continue
      }
      const sourcePath = path.join(outputDirectory, relativeArtifactPath(artifact.path))
      const realPath = await fs.realpath(sourcePath)
      if (reportedPaths.has(realPath)) continue
      reportedPaths.add(realPath)
      files.push(
        await this.#admitOutputFile(
          sourcePath,
          tool.output,
          artifact.mimeType,
          artifact.name,
          outputDirectory,
          outputDirectoryRealPath,
          materializedDirectory,
          files.length,
          signal,
        ),
      )
    }

    if (omittedFileCount > 0) {
      warnings.push(`Generation returned ${declaredFileCount} outputs; only the first replaced the target card.`)
    }
    if (tool.output === "text") {
      if (files.length) throw new Error("Text generation tools must return MCP text content")
      return { files, texts: texts.length ? [texts.join("\n\n")] : [], warnings: normalizeGenerationWarnings(warnings) }
    }
    if (files.length === 0) throw new Error(`Generation tool returned no ${tool.output} output`)
    return { files, texts: [], warnings: normalizeGenerationWarnings(warnings) }
  }

  async #admitOutputFile(
    sourcePath: string,
    output: GenerationOutputModality,
    declaredMimeType: string | undefined,
    declaredName: string | undefined,
    outputDirectory: string,
    outputDirectoryRealPath: string,
    materializedDirectory: string,
    index: number,
    signal?: AbortSignal,
  ) {
    if (output === "text") throw new Error("Text generation tools cannot return file artifacts")
    await assertPinnedOutputDirectory(outputDirectory, outputDirectoryRealPath)
    const unresolvedRoot = path.resolve(outputDirectory)
    const unresolvedCandidate = path.resolve(sourcePath)
    validatePortableOutputCandidate(unresolvedRoot, unresolvedCandidate)
    if (isInside(unresolvedCandidate, unresolvedRoot)) {
      await assertNoSymlinkSegments(unresolvedRoot, unresolvedCandidate)
    } else {
      const unresolvedStat = await fs.lstat(unresolvedCandidate)
      if (unresolvedStat.isSymbolicLink()) throw new Error("Generation output cannot contain symbolic links")
    }
    const realPath = await fs.realpath(unresolvedCandidate)
    if (!isInside(realPath, outputDirectoryRealPath)) throw new Error("Generation output escaped output_directory")
    return copyStableFile({
      description: "Generation output",
      expectedRealPath: realPath,
      maximumBytes: this.#maxOutputFileBytes,
      prepareTarget: async ({ handle, size }) => {
        const header = Buffer.alloc(Math.min(32, size))
        const { bytesRead } = await handle.read(header, 0, header.length, 0)
        if (bytesRead !== header.length) throw new Error("Generation output changed while its header was being read")
        const detectedMimeType = signatureMimeType(header)
        if (!detectedMimeType || modalityForMimeType(detectedMimeType) !== output) {
          throw new Error(`Generation output content is not valid ${output} media`)
        }
        const declared = normalizeMimeType(declaredMimeType)
        if (declared && !compatibleMimeTypes(declared, detectedMimeType)) {
          throw new Error("Generation output declared MIME type does not match its content")
        }
        const declaredExtension = path.extname(declaredName ?? sourcePath).toLowerCase()
        const extensionMimeType = extensionMimeTypes[declaredExtension]
        if (extensionMimeType && !compatibleMimeTypes(extensionMimeType, detectedMimeType)) {
          throw new Error("Generation output filename extension does not match its content")
        }
        const extension = outputExtensions[detectedMimeType]
        if (!extension) throw new Error(`Generation output MIME type is not supported: ${detectedMimeType}`)
        const stem = safeFileName(
          path.basename(declaredName ?? sourcePath, path.extname(declaredName ?? sourcePath)),
          "generated",
        )
        return path.join(materializedDirectory, `${index + 1}-${stem}-${randomUUID()}${extension}`)
      },
      signal,
      sourcePath: unresolvedCandidate,
    })
  }
}
