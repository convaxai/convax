import { constants as fsConstants } from "node:fs"
import fs from "node:fs/promises"
import {
  createCanvasNodeContentGuard,
  matchesCanvasNodeContentGuard,
  type CanvasApplicationService,
  type CanvasDocumentRef,
  type CanvasNodeContentGuard,
} from "@convax/canvas/application"
import type { ProjectFileInfo } from "@convax/project-files/contracts"
import { getProjectResourceReference, type ProjectResourceReference } from "@convax/project/canvas"
import type { ProjectManagedAssetStore } from "@convax/project/node"

export type ManagedCanvasMediaKind = "audio" | "image" | "video"

export interface ManagedCanvasMediaRequest extends CanvasDocumentRef {
  nodeIds: readonly string[]
}

export interface ManagedCanvasMediaResolutionOptions {
  allowedKinds: ReadonlySet<ManagedCanvasMediaKind>
  /** Human-readable noun phrase used only in boundary errors. */
  allowedKindsDescription: string
  operationLabel: string
}

export interface ResolvedManagedCanvasMedia {
  identity: ManagedCanvasMediaFileIdentity
  kind: ManagedCanvasMediaKind
  mimeType: string
  name: string
  path: string
  resourcePath: string
  size: number
}

export interface ManagedCanvasMediaFileIdentity {
  ctimeMs: number
  dev: number
  ino: number
  mtimeMs: number
  size: number
}

export interface ManagedCanvasMediaResolutionPort {
  resolve(
    request: ManagedCanvasMediaRequest,
    options: ManagedCanvasMediaResolutionOptions,
    signal?: AbortSignal,
  ): Promise<readonly ResolvedManagedCanvasMedia[]>
}

/**
 * Expected resource-state failure from the authoritative media resolver.
 * Callers may translate only this type into a recoverable public error;
 * programming faults and unknown adapter failures must remain internal.
 */
export class ManagedCanvasMediaResourceUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "ManagedCanvasMediaResourceUnavailableError"
  }
}

/** A previously checked Canvas/media binding changed while it was resolving. */
export class ManagedCanvasMediaStaleError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "ManagedCanvasMediaStaleError"
  }
}

export interface ManagedCanvasMediaProjectPathResolver {
  readFileInfo(input: { path: string; projectId: string }): Promise<ProjectFileInfo>
  resolveEntryPath(input: { path: string; projectId: string }): Promise<string>
}

/**
 * Main-only resolver for Canvas media backed by managed Project assets. It is
 * shared by native integrations so none of them can accept renderer paths.
 */
export class ManagedCanvasMediaResolver implements ManagedCanvasMediaResolutionPort {
  constructor(
    private readonly input: {
      assets: Pick<ProjectManagedAssetStore, "resolve">
      application: Pick<CanvasApplicationService, "query">
      projects: ManagedCanvasMediaProjectPathResolver
    },
  ) {}

  async resolve(
    request: ManagedCanvasMediaRequest,
    options: ManagedCanvasMediaResolutionOptions,
    signal?: AbortSignal,
  ): Promise<readonly ResolvedManagedCanvasMedia[]> {
    throwIfAborted(signal)
    validateResolutionRequest(request)
    if (options.allowedKinds.size === 0) throw new Error("Managed Canvas media kinds are required")

    const snapshot = await this.input.application.query({ canvasId: request.canvasId, scopeId: request.scopeId })
    throwIfAborted(signal)
    const document = snapshot.projection
    if (document.id !== request.canvasId) {
      throw new ManagedCanvasMediaStaleError(
        `Canvas document scope did not match the ${options.operationLabel} request`,
      )
    }
    const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
    const references = request.nodeIds.map((nodeId) => {
      const node = nodeById.get(nodeId)
      if (!node) throw new ManagedCanvasMediaStaleError(`Selected Canvas node was not found: ${nodeId}`)
      const kind = node.data.kind
      if (node.type !== "file" || !isManagedCanvasMediaKind(kind) || !options.allowedKinds.has(kind)) {
        throw new ManagedCanvasMediaResourceUnavailableError(
          `Only Canvas ${options.allowedKindsDescription} can be used for ${options.operationLabel}: ${nodeId}`,
        )
      }
      const reference = getProjectResourceReference(node.data.metadata)
      if (!reference || reference.kind === "project-directory") {
        throw new ManagedCanvasMediaResourceUnavailableError(
          `Canvas media must be stored in the active Project before ${options.operationLabel}: ${node.data.label}`,
        )
      }
      return { expectedTarget: createCanvasNodeContentGuard(node), kind, nodeId, reference }
    })

    const resolved: ResolvedManagedCanvasMedia[] = []
    for (const { kind, reference } of references) {
      throwIfAborted(signal)
      const resourcePath = projectResourceLabel(reference)
      let mimeType: string
      let name: string
      let source: string
      if (reference.kind === "managed-asset") {
        mimeType = normalizeMimeType(reference.mediaType ?? "")
        name = reference.name
        source = await safeProjectMediaCall(resourcePath, () =>
          this.input.assets.resolve({ projectId: request.scopeId, reference }),
        )
      } else {
        const info = await safeProjectMediaCall(resourcePath, () =>
          this.input.projects.readFileInfo({ path: reference.path, projectId: request.scopeId }),
        )
        mimeType = normalizeMimeType(info.mimeType)
        name = info.name
        source = await safeProjectMediaCall(resourcePath, () =>
          this.input.projects.resolveEntryPath({ path: reference.path, projectId: request.scopeId }),
        )
      }
      if (!mimeType.startsWith(`${kind}/`)) {
        throw new ManagedCanvasMediaResourceUnavailableError(
          `Canvas ${kind} does not reference a matching media file: ${resourcePath}`,
        )
      }
      resolved.push(
        await inspectMatchingMediaFile(
          {
            kind,
            mimeType,
            name,
            resourcePath,
            source,
          },
          signal,
        ),
      )
    }
    await this.recheckCanvasTargets(request, references, options.operationLabel, signal)
    return resolved
  }

  private async recheckCanvasTargets(
    request: ManagedCanvasMediaRequest,
    expected: readonly { expectedTarget: CanvasNodeContentGuard; nodeId: string }[],
    operationLabel: string,
    signal?: AbortSignal,
  ) {
    throwIfAborted(signal)
    const current = await this.input.application.query({ canvasId: request.canvasId, scopeId: request.scopeId })
    throwIfAborted(signal)
    for (const item of expected) {
      const matches = current.projection.nodes.filter((node) => node.id === item.nodeId)
      if (matches.length !== 1 || !matchesCanvasNodeContentGuard(matches[0]!, item.expectedTarget)) {
        throw new ManagedCanvasMediaStaleError(`Canvas media changed while preparing ${operationLabel}: ${item.nodeId}`)
      }
    }
  }
}

function projectResourceLabel(reference: Exclude<ProjectResourceReference, { kind: "project-directory" }>) {
  return reference.kind === "project-file" ? reference.path : `managed-asset:${reference.sha256}`
}

function isManagedCanvasMediaKind(value: unknown): value is ManagedCanvasMediaKind {
  return value === "audio" || value === "image" || value === "video"
}

async function inspectMatchingMediaFile(
  input: {
    kind: ManagedCanvasMediaKind
    mimeType: string
    name: string
    resourcePath: string
    source: string
  },
  signal?: AbortSignal,
): Promise<ResolvedManagedCanvasMedia> {
  try {
    throwIfAborted(signal)
    const before = await fs.lstat(input.source)
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new CanvasMediaValidationError(`Canvas media is not a regular Project file: ${input.resourcePath}`)
    }
    const canonical = await fs.realpath(input.source)
    const handle = await fs.open(canonical, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    let size = 0
    try {
      const stat = await handle.stat()
      size = stat.size
      if (
        !stat.isFile() ||
        stat.dev !== before.dev ||
        stat.ino !== before.ino ||
        stat.size !== before.size ||
        stat.mtimeMs !== before.mtimeMs ||
        stat.ctimeMs !== before.ctimeMs
      ) {
        throw new CanvasMediaValidationError(`Canvas media changed while it was validated: ${input.resourcePath}`)
      }
      const header = Buffer.alloc(Math.min(4_096, stat.size))
      const { bytesRead } = await handle.read(header, 0, header.length, 0)
      if (!matchesMediaSignature(header.subarray(0, bytesRead), input.kind, input.mimeType)) {
        throw new CanvasMediaValidationError(
          `Canvas ${input.kind} content does not match its media type: ${input.resourcePath}`,
        )
      }
    } finally {
      await handle.close()
    }
    throwIfAborted(signal)
    const after = await fs.lstat(input.source)
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new CanvasMediaValidationError(`Canvas media changed while it was validated: ${input.resourcePath}`)
    }
    return {
      identity: {
        ctimeMs: after.ctimeMs,
        dev: after.dev,
        ino: after.ino,
        mtimeMs: after.mtimeMs,
        size: after.size,
      },
      kind: input.kind,
      mimeType: input.mimeType,
      name: input.name,
      path: canonical,
      resourcePath: input.resourcePath,
      size,
    }
  } catch (error) {
    if (error instanceof CanvasMediaValidationError) {
      throw new ManagedCanvasMediaResourceUnavailableError(error.message, { cause: error })
    }
    if (isAbortError(error)) throw error
    if (isNodeOperationalError(error)) {
      throw new ManagedCanvasMediaResourceUnavailableError(
        `Could not validate Canvas media: ${input.resourcePath}${nodeErrorCode(error)}`,
        { cause: error },
      )
    }
    throw error
  }
}

class CanvasMediaValidationError extends Error {}

async function safeProjectMediaCall<Result>(resourcePath: string, operation: () => Promise<Result>) {
  try {
    return await operation()
  } catch (error) {
    if (
      error instanceof ManagedCanvasMediaResourceUnavailableError ||
      error instanceof ManagedCanvasMediaStaleError ||
      isAbortError(error)
    ) {
      throw error
    }
    if (isNodeOperationalError(error)) {
      throw new ManagedCanvasMediaResourceUnavailableError(
        `Could not resolve Canvas media inside the Project: ${resourcePath}${nodeErrorCode(error)}`,
        { cause: error },
      )
    }
    throw error
  }
}

function isNodeOperationalError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && "code" in error && typeof error.code === "string"
}

function nodeErrorCode(error: unknown) {
  return isNodeOperationalError(error) ? ` (${error.code})` : ""
}

function normalizeMimeType(value: string) {
  return value.split(";", 1)[0]!.trim().toLowerCase()
}

function matchesMediaSignature(header: Buffer, kind: ManagedCanvasMediaKind, mimeType: string) {
  if (kind === "image") {
    if (mimeType === "image/png") {
      return header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    }
    if (mimeType === "image/jpeg") return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
    if (mimeType === "image/gif") return ["GIF87a", "GIF89a"].includes(header.subarray(0, 6).toString("ascii"))
    if (mimeType === "image/webp") {
      return header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP"
    }
    if (mimeType === "image/svg+xml") {
      const text = header
        .toString("utf8")
        .replace(/^\uFEFF/, "")
        .trimStart()
      return text.startsWith("<svg") || (text.startsWith("<?xml") && /<svg(?:\s|>)/i.test(text))
    }
    return false
  }

  if (kind === "video") {
    if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
      return header.subarray(4, 8).toString("ascii") === "ftyp"
    }
    if (mimeType === "video/webm") return header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    return false
  }

  if (mimeType === "audio/aac") return header[0] === 0xff && ((header[1] ?? 0) & 0xf6) === 0xf0
  if (mimeType === "audio/mp4") return header.subarray(4, 8).toString("ascii") === "ftyp"
  if (mimeType === "audio/mpeg") {
    return (
      header.subarray(0, 3).toString("ascii") === "ID3" || (header[0] === 0xff && ((header[1] ?? 0) & 0xe0) === 0xe0)
    )
  }
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") {
    return header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WAVE"
  }
  if (mimeType === "audio/ogg") return header.subarray(0, 4).toString("ascii") === "OggS"
  if (mimeType === "audio/flac") return header.subarray(0, 4).toString("ascii") === "fLaC"
  return false
}

function validateResolutionRequest(request: ManagedCanvasMediaRequest) {
  if (!request || typeof request !== "object") throw new Error("Canvas media request is required")
  if (
    typeof request.scopeId !== "string" ||
    !request.scopeId ||
    typeof request.canvasId !== "string" ||
    !request.canvasId
  ) {
    throw new Error("A Project-scoped Canvas reference is required")
  }
  if (
    !Array.isArray(request.nodeIds) ||
    request.nodeIds.length === 0 ||
    request.nodeIds.length > 500 ||
    request.nodeIds.some((nodeId) => typeof nodeId !== "string" || !nodeId) ||
    new Set(request.nodeIds).size !== request.nodeIds.length
  ) {
    throw new Error("Canvas media nodeIds must contain unique Canvas node ids")
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError"
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Canceled", "AbortError")
}
