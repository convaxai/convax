import { createHash, randomUUID } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  CanvasCommandIdConflictError,
  createCanvasNodeContentGuard,
  matchesCanvasNodeContentGuard,
  type CanvasAddResourceSourcesRequest,
  type CanvasApplicationCommandResult,
  type CanvasCommandActor,
  type CanvasCreatePendingResourceRequest,
  type CanvasFailPendingResourceRequest,
  type CanvasNodeContentGuard,
  type CanvasReplaceResourceSourceRequest,
} from "@convax/canvas/application"
import { getIncomingConnectedCanvasFileNodeIds, type CanvasDocument, type CanvasNode } from "@convax/canvas/core"
import {
  getProjectFileReference,
  isManagedProjectAssetPath,
  managedProjectAssetDirectory,
} from "@convax/project/canvas"
import type {
  GenerationCanvasRequest,
  GenerationCanvasResult,
  GenerationInputRole,
  GenerationOutputModality,
  GenerationToolDescription,
  GenerationToolInput,
  GenerationToolInputValue,
  GenerationToolSummary,
} from "../generation-contracts"
import { matchesWebPluginCanvasNodeIdentity } from "../plugin-canvas-node"
import type { CanvasRendererBridge } from "./canvas-renderer-bridge"
import { validateGenerationToolInputShape } from "./generation-tool-input-schema"
import { copyStableFile } from "./stable-file-copy"
import type { McpToolCallResult, McpToolContent } from "./stdio-mcp-client"

export interface GenerationCanvasDocumentPort {
  load(ref: { canvasId: string; scopeId: string }): Promise<{ document: CanvasDocument | null }>
}

export interface GenerationCanvasProjectPort {
  deleteManagedAssets(input: { paths: string[]; projectId: string }): Promise<unknown>
  importEntries(input: {
    destinationPath?: string
    projectId: string
    sourcePaths: string[]
  }): Promise<{ targetPaths?: string[] }>
  readFileInfo(input: { path: string; projectId: string }): Promise<{
    mimeType: string
    name: string
    path: string
    size: number
  }>
  resolveEntryPath(input: { path?: string; projectId: string }): Promise<string>
}

export interface GenerationCanvasResourcePort {
  addResources(request: CanvasAddResourceSourcesRequest): Promise<CanvasApplicationCommandResult>
  createPendingResource(request: CanvasCreatePendingResourceRequest): Promise<CanvasApplicationCommandResult>
  failPendingResource(request: CanvasFailPendingResourceRequest): Promise<CanvasApplicationCommandResult>
  replaceResource(request: CanvasReplaceResourceSourceRequest): Promise<CanvasApplicationCommandResult>
}

export interface PreparedGenerationToolExecution {
  call(input: Record<string, unknown>, signal?: AbortSignal, onExternalStart?: () => void): Promise<McpToolCallResult>
  validateInput(input?: GenerationToolInput): Record<string, GenerationToolInputValue>
}

export interface GenerationToolExecutionPort {
  describeTool(toolId: string, signal?: AbortSignal): Promise<GenerationToolDescription>
  listTools(options?: { output?: GenerationOutputModality }): Promise<readonly GenerationToolSummary[]>
  prepareTool(tool: GenerationToolSummary, signal?: AbortSignal): Promise<PreparedGenerationToolExecution>
}

export interface GenerationCanvasServiceOptions {
  documents: GenerationCanvasDocumentPort
  maxInputFileBytes?: number
  maxInputBytes?: number
  maxInlineOutputFileBytes?: number
  maxOutputFileBytes?: number
  maxOutputFiles?: number
  projects: GenerationCanvasProjectPort
  renderer: Pick<CanvasRendererBridge, "executeView" | "reloadDocument">
  resources: GenerationCanvasResourcePort
  temporaryRoot?: string
  tools: GenerationToolExecutionPort
}

interface StagedTextReference {
  kind: "text"
  nodeId: string
  role: GenerationInputRole
  text: string
}

interface StagedFileReference {
  kind: "file"
  mimeType: string
  name: string
  nodeId: string
  path: string
  role: GenerationInputRole
  sourceSnapshot: ManagedAssetSnapshot
}

type StagedReference = StagedTextReference | StagedFileReference

interface NativeFileSnapshot {
  ctimeNs: bigint
  dev: bigint
  ino: bigint
  mtimeNs: bigint
  size: bigint
}

interface ManagedAssetSnapshot {
  nodeId: string
  realPath: string
  sourcePath: string
  stat: NativeFileSnapshot
}

interface ArtifactDeclaration {
  mimeType?: string
  name?: string
  path: string
}

interface GenerationExecution {
  fingerprint: string
  result: Promise<GenerationCanvasResult>
  state: {
    mustRetain: boolean
    settled: boolean
  }
}

interface PendingGenerationTarget {
  expectedRevision: number
  expectedTarget: CanvasNodeContentGuard
  nodeId: string
}

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
const singletonInputRoles = new Set<GenerationInputRole>(["first_frame", "last_frame"])
const windowsReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i
const unsafeGenerationFailureDiagnosticCharacters = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

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

function abortError(reason?: unknown) {
  const message =
    typeof reason === "string" || typeof reason === "number" || typeof reason === "boolean"
      ? String(reason)
      : "Operation was canceled"
  const error = reason instanceof Error ? reason : new Error(message)
  error.name = "AbortError"
  return error
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal.reason)
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

function managedAssetChangedError(nodeId: string, cause?: unknown) {
  return new Error(
    `Generation managed asset reference changed while the tool was running: ${nodeId}`,
    cause === undefined ? undefined : { cause },
  )
}

async function captureManagedAssetSnapshot(input: {
  expectedRealPath: string
  expectedSize: number
  nodeId: string
  sourcePath: string
}): Promise<ManagedAssetSnapshot> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    const before = await fs.lstat(input.sourcePath, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink() || before.size !== BigInt(input.expectedSize)) {
      throw managedAssetChangedError(input.nodeId)
    }
    const realPath = await fs.realpath(input.sourcePath)
    if (realPath !== input.expectedRealPath) throw managedAssetChangedError(input.nodeId)

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
      throw managedAssetChangedError(input.nodeId)
    }
    return {
      nodeId: input.nodeId,
      realPath: input.expectedRealPath,
      sourcePath: input.sourcePath,
      stat: pinnedSnapshot,
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Generation managed asset reference changed")) {
      throw error
    }
    throw managedAssetChangedError(input.nodeId, error)
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function assertManagedAssetSnapshot(expected: ManagedAssetSnapshot) {
  const current = await captureManagedAssetSnapshot({
    expectedRealPath: expected.realPath,
    expectedSize: Number(expected.stat.size),
    nodeId: expected.nodeId,
    sourcePath: expected.sourcePath,
  })
  if (!sameNativeFileSnapshot(current.stat, expected.stat)) {
    throw managedAssetChangedError(expected.nodeId)
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
  if (
    typeof request.prompt !== "string" ||
    !request.prompt.trim() ||
    request.prompt.length > maxPromptLength ||
    request.prompt.includes("\0")
  ) {
    throw new Error(`Generation prompt must contain between 1 and ${maxPromptLength} characters`)
  }
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
    throw new Error("Generation expected revision must be a non-negative integer")
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

function selectTool(tools: readonly GenerationToolSummary[], request: GenerationCanvasRequest) {
  const roles = new Set(request.references.map((reference) => reference.role))
  const satisfies = (tool: GenerationToolSummary) =>
    (request.output === undefined || tool.output === request.output) &&
    [...roles].every((role) => tool.acceptedInputs.includes(role))
  if (request.toolId) {
    const tool = tools.find((candidate) => candidate.id === request.toolId)
    if (!tool) throw new Error(`Generation tool is not installed: ${request.toolId}`)
    if (!satisfies(tool))
      throw new Error(`Generation tool does not accept the requested output or reference roles: ${tool.id}`)
    return tool
  }
  // Omitted toolId means model auto-routing. Operations are callable only by
  // their explicit host id so an installed action can never become a model by
  // coincidence.
  const candidates = tools.filter((tool) => tool.kind === "model" && satisfies(tool))
  if (candidates.length === 0) throw new Error("No installed generation tool accepts this request")
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
  const fileReference = getProjectFileReference(nodeMetadata(node))
  return {
    kind: node.data.kind,
    mimeType: "mimeType" in node.data && typeof node.data.mimeType === "string" ? node.data.mimeType : null,
    projectPath: fileReference?.path ?? null,
    text:
      node.data.kind === "text" && "text" in node.data && typeof node.data.text === "string" ? node.data.text : null,
    type: node.type,
    url: !fileReference && "url" in node.data && typeof node.data.url === "string" ? node.data.url : null,
  }
}

function generationReferenceSnapshot(document: CanvasDocument, request: GenerationCanvasRequest) {
  const constraint = request.referenceConstraint
  let incomingNodeIds: readonly string[] | undefined
  if (constraint) {
    const owner = document.nodes.find((node) => node.id === constraint.ownerNodeId)
    if (!owner || owner.type !== "file") throw new Error("Generation reference owner is no longer a Canvas file node")
    if (
      constraint.ownerPluginId !== undefined &&
      !matchesWebPluginCanvasNodeIdentity(constraint.ownerPluginId, owner.data)
    ) {
      throw new Error("Generation reference owner is no longer the declared Plugin Canvas node")
    }
    incomingNodeIds = getIncomingConnectedCanvasFileNodeIds(document, constraint.ownerNodeId)
  }
  const incoming = incomingNodeIds ? new Set(incomingNodeIds) : undefined
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
    references,
    relationAnchors,
  })
}

function generationResultRelation(request: GenerationCanvasRequest): CanvasAddResourceSourcesRequest["relation"] {
  const ownerNodeId = request.referenceConstraint?.ownerNodeId
  if (!ownerNodeId && !request.references.length && !request.relationAnchorNodeIds?.length) return undefined
  return {
    anchorNodeIds: ownerNodeId
      ? [ownerNodeId]
      : [
          ...new Set([
            ...request.references.map((reference) => reference.nodeId),
            ...(request.relationAnchorNodeIds ?? []),
          ]),
        ],
    direction: "from-anchor",
    mode: "connect",
  }
}

/**
 * Shared application service used by toolbar, Agent tools, and narrow Plugin
 * calls. It stages inputs, executes an installed Tool Plugin, admits outputs as
 * managed Project assets, and commits normal Canvas file nodes. A declarative
 * return operation reuses the same staging and execution boundary but returns
 * one bounded text result without mutating the Canvas.
 */
export class GenerationCanvasService {
  readonly #documents: GenerationCanvasDocumentPort
  readonly #executions = new Map<string, GenerationExecution>()
  readonly #maxInputFileBytes: number
  readonly #maxInputBytes: number
  readonly #maxInlineOutputFileBytes: number
  readonly #maxOutputFileBytes: number
  readonly #maxOutputFiles: number
  readonly #projects: GenerationCanvasProjectPort
  readonly #renderer: Pick<CanvasRendererBridge, "executeView" | "reloadDocument">
  readonly #resources: GenerationCanvasResourcePort
  readonly #temporaryRoot: string
  readonly #tools: GenerationToolExecutionPort

  constructor(options: GenerationCanvasServiceOptions) {
    this.#documents = options.documents
    this.#maxInputFileBytes = options.maxInputFileBytes ?? defaultMaxInputFileBytes
    this.#maxInputBytes = options.maxInputBytes ?? defaultMaxInputBytes
    this.#maxInlineOutputFileBytes = options.maxInlineOutputFileBytes ?? defaultMaxInlineOutputFileBytes
    this.#maxOutputFileBytes = options.maxOutputFileBytes ?? defaultMaxOutputFileBytes
    this.#maxOutputFiles = options.maxOutputFiles ?? defaultMaxOutputFiles
    this.#projects = options.projects
    this.#renderer = options.renderer
    this.#resources = options.resources
    this.#temporaryRoot = options.temporaryRoot ?? os.tmpdir()
    this.#tools = options.tools
  }

  async listTools(options: { output?: GenerationOutputModality } = {}) {
    return this.#tools.listTools(options)
  }

  async describeTool(toolId: string, signal?: AbortSignal) {
    return this.#tools.describeTool(toolId, signal)
  }

  async generate(
    request: GenerationCanvasRequest,
    actor: CanvasCommandActor,
    signal?: AbortSignal,
  ): Promise<GenerationCanvasResult> {
    validateRequest(request)
    requireIdentifier(actor.id, "Generation actor id")
    requireIdentifier(actor.kind, "Generation actor kind")
    const key = JSON.stringify([request.ref.scopeId, request.ref.canvasId, actor.kind, actor.id, request.operationId])
    const fingerprint = stableJson({
      anchor: request.anchor,
      expectedOutputCount: request.expectedOutputCount,
      expectedRevision: request.expectedRevision,
      output: request.output,
      prompt: request.prompt,
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
        throw new CanvasCommandIdConflictError(request.operationId)
      }
      return waitForCaller(existing.result, signal)
    }
    if (this.#executions.size >= maxGenerationExecutions) {
      const settled = [...this.#executions].find(([, execution]) => execution.state.settled)
      if (!settled) throw new Error("Too many generation operations are currently running")
      this.#executions.delete(settled[0])
    }

    const state = { mustRetain: false, settled: false }
    const result = this.#generateOnce(request, actor, signal, () => {
      state.mustRetain = true
    })
    const execution = { fingerprint, result, state }
    this.#executions.set(key, execution)
    void result.then(
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
    return waitForCaller(result, signal)
  }

  async #generateOnce(
    request: GenerationCanvasRequest,
    actor: CanvasCommandActor,
    signal: AbortSignal | undefined,
    retainOperation: () => void,
  ): Promise<GenerationCanvasResult> {
    assertNotAborted(signal)
    const tool = selectTool(await this.#tools.listTools(request.output ? { output: request.output } : {}), request)
    const snapshot = await this.#documents.load(request.ref)
    if (!snapshot.document) throw new Error(`Canvas document was not found: ${request.ref.canvasId}`)
    if (snapshot.document.revision !== request.expectedRevision) {
      throw new Error(
        `Generation expected Canvas revision ${request.expectedRevision}, received ${snapshot.document.revision}`,
      )
    }
    let workingRequest = request
    let workingDocument = snapshot.document
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
    }
    let replacementGuard = replacementTarget ? createCanvasNodeContentGuard(replacementTarget) : undefined
    let requiresStableRevision =
      request.referenceConstraint !== undefined ||
      request.references.length > 0 ||
      (request.relationAnchorNodeIds?.length ?? 0) > 0
    let referenceSnapshot = requiresStableRevision
      ? generationReferenceSnapshot(workingDocument, workingRequest)
      : undefined
    assertNotAborted(signal)
    let pendingTarget: PendingGenerationTarget | undefined
    let temporaryDirectory: string | undefined

    try {
      if (resultMode.type === "create-pending-node") {
        const pendingResult = await this.#resources.createPendingResource({
          actor,
          anchor: request.anchor,
          canvasId: request.ref.canvasId,
          commandId: `generation-pending:${request.operationId}`,
          conflictPolicy: "reject",
          expectedRevision: request.expectedRevision,
          kind: tool.output,
          relation: generationResultRelation(request),
          scopeId: request.ref.scopeId,
        })
        retainOperation()
        if (pendingResult.createdNodeIds.length !== 1) {
          throw new Error("Pending generation must create exactly one Canvas node")
        }
        const nodeId = pendingResult.createdNodeIds[0]!
        const pendingNode = pendingResult.document.nodes.find((node) => node.id === nodeId)
        if (
          !pendingNode ||
          pendingNode.type !== "file" ||
          pendingNode.data.kind !== tool.output ||
          pendingNode.data.status !== "pending"
        ) {
          throw new Error("Pending generation did not create the expected Canvas file node")
        }
        pendingTarget = {
          expectedRevision: pendingResult.document.revision,
          expectedTarget: createCanvasNodeContentGuard(pendingNode),
          nodeId,
        }
        workingRequest = {
          ...request,
          expectedRevision: pendingResult.document.revision,
          resultMode: { nodeId, type: "replace-node" },
        }
        workingDocument = pendingResult.document
        resultMode = { nodeId, type: "replace-node" }
        replacementGuard = pendingTarget.expectedTarget
        requiresStableRevision =
          workingRequest.referenceConstraint !== undefined ||
          workingRequest.references.length > 0 ||
          (workingRequest.relationAnchorNodeIds?.length ?? 0) > 0
        referenceSnapshot = requiresStableRevision
          ? generationReferenceSnapshot(workingDocument, workingRequest)
          : undefined

        this.#refreshRendererProjection(request.ref, pendingResult.document.revision, [nodeId])
      }

      const preparedTool = await this.#tools.prepareTool(tool, signal)
      preparedTool.validateInput(workingRequest.toolInput)
      assertNotAborted(signal)

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
      await this.#assertStableReferences(workingRequest, referenceSnapshot, references, requiresStableRevision)
      if (replacementGuard) await this.#assertStableReplacementTarget(workingRequest, replacementGuard)
      assertNotAborted(signal)
      const toolInput = preparedTool.validateInput(workingRequest.toolInput)
      const toolResult = await preparedTool.call(
        {
          ...toolInput,
          operation_id: externalGenerationOperationId(workingRequest, actor),
          output: tool.output,
          output_directory: outputDirectory,
          prompt: workingRequest.prompt.trim(),
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
        retainOperation,
      )
      assertNotAborted(signal)
      await this.#assertStableReferences(workingRequest, referenceSnapshot, references, requiresStableRevision)
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
        references,
        requiresStableRevision,
      )
      if (replacementGuard) await this.#assertStableReplacementTarget(workingRequest, replacementGuard)
      assertNotAborted(signal)

      if (resultMode.type === "return") {
        if (admitted.files.length || admitted.texts.length !== 1) {
          throw new Error("Returned Plugin operation must return exactly one MCP text result")
        }
        const outputText = admitted.texts[0]!
        if (Buffer.byteLength(outputText, "utf8") > maxReturnedOutputTextBytes) {
          throw new Error("Returned Plugin operation text exceeds the Agent result size limit")
        }
        const currentDocument = stableDocument ?? (await this.#documents.load(workingRequest.ref)).document
        if (!currentDocument) throw new Error(`Canvas document was not found: ${workingRequest.ref.canvasId}`)
        assertNotAborted(signal)
        return {
          createdNodeIds: [],
          outputText,
          revision: currentDocument.revision,
          toolId: tool.id,
          warnings: admitted.warnings,
        }
      }

      const importedOutputs = admitted.files.length
        ? await this.#importOutputFiles(workingRequest.ref.scopeId, admitted.files, signal)
        : { assetPaths: [], sources: [] }
      let result: CanvasApplicationCommandResult
      try {
        await this.#assertStableReferences(workingRequest, referenceSnapshot, references, requiresStableRevision)
        if (replacementGuard) await this.#assertStableReplacementTarget(workingRequest, replacementGuard)
        const sources: CanvasAddResourceSourcesRequest["sources"] = [
          ...admitted.texts.map((text) => ({
            kind: "inline-text" as const,
            name: "Generated",
            sourceId: randomUUID(),
            text,
          })),
          ...importedOutputs.sources,
        ]
        if (!sources.length) throw new Error("Generation tool returned no usable output")
        if (resultMode.type === "replace-node" && sources.length !== 1) {
          throw new Error("Card generation must resolve to exactly one replacement resource")
        }
        assertNotAborted(signal)
        result =
          resultMode.type === "replace-node"
            ? await this.#resources.replaceResource({
                actor,
                canvasId: workingRequest.ref.canvasId,
                commandId: `generation:${workingRequest.operationId}`,
                conflictPolicy: "retry",
                expectedRevision: workingRequest.expectedRevision,
                expectedTarget: replacementGuard!,
                scopeId: workingRequest.ref.scopeId,
                source: sources[0]!,
                targetNodeId: resultMode.nodeId,
              })
            : await this.#resources.addResources({
                actor,
                anchor: workingRequest.anchor,
                canvasId: workingRequest.ref.canvasId,
                commandId: `generation:${workingRequest.operationId}`,
                conflictPolicy: "retry",
                expectedRevision: workingRequest.expectedRevision,
                relation: generationResultRelation(workingRequest),
                scopeId: workingRequest.ref.scopeId,
                sources,
              })
      } catch (error) {
        if (importedOutputs.assetPaths.length) {
          try {
            await this.#projects.deleteManagedAssets({
              paths: importedOutputs.assetPaths,
              projectId: workingRequest.ref.scopeId,
            })
          } catch (cleanupError) {
            throw generationCleanupFailure(error, cleanupError)
          }
        }
        throw error
      }
      const warnings = normalizeGenerationWarnings([...admitted.warnings, ...result.warnings])
      this.#refreshRendererProjection(request.ref, result.document.revision, result.createdNodeIds)
      return {
        createdNodeIds: pendingTarget ? [pendingTarget.nodeId] : result.createdNodeIds,
        revision: result.document.revision,
        toolId: tool.id,
        warnings,
      }
    } catch (error) {
      if (pendingTarget) await this.#markPendingGenerationFailed(request, actor, pendingTarget, error)
      throw error
    } finally {
      if (temporaryDirectory) {
        await fs.rm(temporaryDirectory, { force: true, recursive: true }).catch(() => undefined)
      }
    }
  }

  async #markPendingGenerationFailed(
    request: GenerationCanvasRequest,
    actor: CanvasCommandActor,
    target: PendingGenerationTarget,
    error: unknown,
  ) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Generation was canceled"
        : "Generation could not be completed"
    try {
      const failed = await this.#resources.failPendingResource({
        actor,
        canvasId: request.ref.canvasId,
        commandId: `generation-pending-fail:${request.operationId}`,
        conflictPolicy: "retry",
        expectedRevision: target.expectedRevision,
        expectedTarget: target.expectedTarget,
        message,
        scopeId: request.ref.scopeId,
        targetNodeId: target.nodeId,
      })
      this.#refreshRendererProjection(request.ref, failed.document.revision, [target.nodeId])
    } catch {
      // The pending target is guard-bound. A user deletion or edit wins, and a
      // secondary status-update failure must never replace the generation error.
    }
  }

  #refreshRendererProjection(ref: GenerationCanvasRequest["ref"], revision: number, nodeIds: readonly string[]) {
    void (async () => {
      const reloaded = await this.#renderer.reloadDocument(ref)
      if (!reloaded || nodeIds.length === 0) return
      await this.#renderer.executeView({
        command: {
          fit: "none",
          nodeIds: [...nodeIds],
          select: false,
          type: "nodes.reveal",
        },
        expectedDocumentId: ref.canvasId,
        expectedRevision: revision,
        expectedScopeId: ref.scopeId,
        viewId: "desktop-main",
      })
    })().catch((error) => console.warn("Could not refresh the Canvas renderer projection", error))
  }

  async #assertStableReplacementTarget(request: GenerationCanvasRequest, expected: CanvasNodeContentGuard) {
    let document: CanvasDocument | null
    try {
      document = (await this.#documents.load(request.ref)).document
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
      !matchesCanvasNodeContentGuard(target, expected)
    ) {
      throw new Error("Generation replacement target changed while the tool was running")
    }
  }

  async #assertStableCanvasDocument(
    request: GenerationCanvasRequest,
    expectedReferenceSnapshot: string | undefined,
    required: boolean,
  ) {
    if (!required) return undefined
    let document: CanvasDocument | null
    try {
      const snapshot = await this.#documents.load(request.ref)
      document = snapshot.document
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
      currentReferenceSnapshot = generationReferenceSnapshot(document, request)
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
    references: readonly StagedReference[],
    required: boolean,
  ) {
    const document = await this.#assertStableCanvasDocument(request, expectedReferenceSnapshot, required)
    try {
      await Promise.all(
        references.map((reference) =>
          reference.kind === "file" ? assertManagedAssetSnapshot(reference.sourceSnapshot) : Promise.resolve(),
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
      if (reference.role === "text") {
        const text = "text" in node.data && typeof node.data.text === "string" ? node.data.text : ""
        const textBytes = Buffer.byteLength(text, "utf8")
        if (!text || textBytes > maxTextReferenceLength) {
          throw new Error(`Generation text reference is empty or too large: ${reference.nodeId}`)
        }
        stagedBytes += textBytes
        if (stagedBytes > this.#maxInputBytes)
          throw new Error("Generation references exceed the total input size limit")
        references.push({ kind: "text", nodeId: node.id, role: reference.role, text })
        continue
      }
      const fileReference = getProjectFileReference(nodeMetadata(node))
      if (!fileReference || !isManagedProjectAssetPath(fileReference.path)) {
        throw new Error(`Generation media references must be managed Project assets: ${reference.nodeId}`)
      }
      const info = await this.#projects.readFileInfo({ path: fileReference.path, projectId: request.ref.scopeId })
      const mimeType = normalizeMimeType(info.mimeType)
      if (!mimeType.startsWith(expectedMimePrefix(reference.role))) {
        throw new Error(`Generation reference MIME type does not match ${reference.role}: ${mimeType || "unknown"}`)
      }
      if (!Number.isSafeInteger(info.size) || info.size < 1 || info.size > this.#maxInputFileBytes) {
        throw new Error(`Generation reference file is empty or too large: ${reference.nodeId}`)
      }
      stagedBytes += info.size
      if (stagedBytes > this.#maxInputBytes) throw new Error("Generation references exceed the total input size limit")
      const absolutePath = await this.#projects.resolveEntryPath({
        path: fileReference.path,
        projectId: request.ref.scopeId,
      })
      const referenceRealPath = await fs.realpath(absolutePath)
      const sourceSnapshot = await captureManagedAssetSnapshot({
        expectedRealPath: referenceRealPath,
        expectedSize: info.size,
        nodeId: node.id,
        sourcePath: absolutePath,
      })
      const target = path.join(inputDirectory, `${index + 1}-${safeFileName(info.name, `reference-${index + 1}`)}`)
      await copyStableFile({
        description: `Generation reference file ${reference.nodeId}`,
        expectedRealPath: referenceRealPath,
        expectedSize: info.size,
        maximumBytes: this.#maxInputFileBytes,
        prepareTarget: () => target,
        signal,
        sourcePath: absolutePath,
      })
      await assertManagedAssetSnapshot(sourceSnapshot)
      references.push({
        kind: "file",
        mimeType,
        name: info.name,
        nodeId: node.id,
        path: target,
        role: reference.role,
        sourceSnapshot,
      })
    }
    return references
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

  async #importOutputFiles(projectId: string, files: readonly string[], signal?: AbortSignal) {
    if (files.length > this.#maxOutputFiles) throw new Error("Generation tool returned too many output files")
    assertNotAborted(signal)
    const imported = await this.#projects.importEntries({
      destinationPath: managedProjectAssetDirectory,
      projectId,
      sourcePaths: [...files],
    })
    if (!imported.targetPaths || imported.targetPaths.length !== files.length) {
      throw new Error("Generation outputs could not be imported as managed Project assets")
    }
    const sources = imported.targetPaths.map((assetPath) => {
      if (!isManagedProjectAssetPath(assetPath)) {
        throw new Error("Generation output import escaped the managed Project asset directory")
      }
      return { kind: "host-file" as const, path: assetPath, sourceId: randomUUID() }
    })
    return { assetPaths: imported.targetPaths, sources }
  }
}

function generationCleanupFailure(error: unknown, cleanupError: unknown) {
  return new AggregateError([error, cleanupError], "Generation failed and its imported assets could not be removed", {
    cause: error,
  })
}
