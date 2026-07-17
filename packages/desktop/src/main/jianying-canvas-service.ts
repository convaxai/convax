import fs from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import type { CanvasDocumentClient } from "@convax/canvas/application"
import type { ProjectFileInfo } from "@convax/project-files/contracts"
import {
  getProjectFileReference,
  isProjectCanvasManagedAssetPath,
  requireProjectCanvasResourcePath,
} from "@convax/project/canvas"

import type {
  JianyingCanvasExportRequest,
  JianyingClient,
  JianyingDraftStatusResult,
} from "../jianying-contracts"
import type { JianyingIntegrationService } from "./jianying-service"

export interface JianyingProjectPathResolver {
  readFileInfo(input: { path: string; projectId: string }): Promise<ProjectFileInfo>
  resolveEntryPath(input: { path: string; projectId: string }): Promise<string>
}

export class JianyingCanvasService implements JianyingClient {
  constructor(
    private readonly input: {
      documents: Pick<CanvasDocumentClient, "load">
      integration: Pick<JianyingIntegrationService, "exportMedia" | "getDraftStatus">
      isEnabled: () => Promise<boolean>
      projects: JianyingProjectPathResolver
    },
  ) {}

  async getDraftStatus(): Promise<JianyingDraftStatusResult> {
    await this.requireEnabled()
    try {
      return await this.input.integration.getDraftStatus()
    } catch (error) {
      throw sanitizeNativeBoundaryError(error)
    }
  }

  async exportCanvasMedia(request: JianyingCanvasExportRequest, signal?: AbortSignal) {
    throwIfAborted(signal)
    await this.requireEnabled()
    validateRequest(request)
    const snapshot = await this.input.documents.load(request.ref)
    throwIfAborted(signal)
    const document = snapshot.document
    if (!document) throw new Error(`Canvas was not found: ${request.ref.canvasId}`)
    if (document.id !== request.ref.canvasId) throw new Error("Canvas document scope did not match the export request")
    if (document.revision !== request.expectedRevision) {
      throw new Error(
        `Canvas changed before JianYing export (expected revision ${request.expectedRevision}, found ${document.revision})`,
      )
    }
    const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
    const references = request.nodeIds.map((nodeId) => {
      const node = nodeById.get(nodeId)
      if (!node) throw new Error(`Selected Canvas node was not found: ${nodeId}`)
      if (node.type !== "file" || (node.data.kind !== "image" && node.data.kind !== "video")) {
        throw new Error(`Only Canvas images and videos can be exported to JianYing: ${nodeId}`)
      }
      const kind = node.data.kind as "image" | "video"
      const reference = getProjectFileReference(node.data.metadata)
      if (!reference?.path) {
        throw new Error(`Canvas media must be stored in the active Project before JianYing export: ${node.data.label}`)
      }
      const resourcePath = requireProjectCanvasResourcePath(reference.path)
      if (!isProjectCanvasManagedAssetPath(resourcePath)) {
        throw new Error(`Canvas media must be stored in the managed Project asset directory: ${node.data.label}`)
      }
      return { kind, path: resourcePath }
    })
    const sourceMedia = await Promise.all(
      references.map(async (reference) => {
        throwIfAborted(signal)
        const info = await safeProjectMediaCall(reference.path, () =>
          this.input.projects.readFileInfo({
            path: reference.path,
            projectId: request.ref.scopeId,
          }),
        )
        if (!info.mimeType.toLowerCase().startsWith(`${reference.kind}/`)) {
          throw new Error(`Canvas ${reference.kind} does not reference a matching media file: ${reference.path}`)
        }
        const source = await safeProjectMediaCall(reference.path, () =>
          this.input.projects.resolveEntryPath({
            path: reference.path,
            projectId: request.ref.scopeId,
          }),
        )
        return inspectMatchingMediaFile(source, reference.path, reference.kind, info.mimeType)
      }),
    )
    throwIfAborted(signal)
    try {
      return await (signal
        ? this.input.integration.exportMedia(sourceMedia, request.target, signal)
        : this.input.integration.exportMedia(sourceMedia, request.target))
    } catch (error) {
      throw sanitizeNativeBoundaryError(error)
    }
  }

  private async requireEnabled() {
    if (!(await this.input.isEnabled())) {
      throw new Error("The built-in JianYing Plugin is not installed")
    }
  }
}

async function inspectMatchingMediaFile(
  source: string,
  resourcePath: string,
  kind: "image" | "video",
  mimeType: string,
) {
  try {
    const before = await fs.lstat(source)
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new CanvasMediaValidationError(`Canvas media is not a regular Project file: ${resourcePath}`)
    }
    const canonical = await fs.realpath(source)
    const handle = await fs.open(canonical, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino) {
        throw new CanvasMediaValidationError(`Canvas media changed while it was validated: ${resourcePath}`)
      }
      const header = Buffer.alloc(Math.min(4_096, stat.size))
      const { bytesRead } = await handle.read(header, 0, header.length, 0)
      if (!matchesMediaSignature(header.subarray(0, bytesRead), kind, mimeType.toLowerCase())) {
        throw new CanvasMediaValidationError(`Canvas ${kind} content does not match its media type: ${resourcePath}`)
      }
    } finally {
      await handle.close()
    }
    const after = await fs.lstat(source)
    if (after.isSymbolicLink() || !after.isFile() || after.dev !== before.dev || after.ino !== before.ino) {
      throw new CanvasMediaValidationError(`Canvas media changed while it was validated: ${resourcePath}`)
    }
    return { mimeType: mimeType.toLowerCase(), path: canonical }
  } catch (error) {
    if (error instanceof CanvasMediaValidationError) throw error
    throw new Error(`Could not validate Canvas media: ${resourcePath}${nodeErrorCode(error)}`)
  }
}

class CanvasMediaValidationError extends Error {}

async function safeProjectMediaCall<Result>(resourcePath: string, operation: () => Promise<Result>) {
  try {
    return await operation()
  } catch (error) {
    throw new Error(`Could not resolve Canvas media inside the Project: ${resourcePath}${nodeErrorCode(error)}`)
  }
}

function nodeErrorCode(error: unknown) {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? ` (${error.code})` : ""
}

function sanitizeNativeBoundaryError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return error
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return new Error(`JianYing native operation failed (${error.code})`)
  }
  return error instanceof Error ? error : new Error("JianYing native operation failed")
}

function matchesMediaSignature(header: Buffer, kind: "image" | "video", mimeType: string) {
  if (kind === "image") {
    if (mimeType === "image/png") return header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
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
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
    return header.subarray(4, 8).toString("ascii") === "ftyp"
  }
  if (mimeType === "video/webm") {
    return header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  }
  return false
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Canceled", "AbortError")
}

function validateRequest(request: JianyingCanvasExportRequest) {
  if (!request || typeof request !== "object") throw new Error("JianYing export request is required")
  if (Object.keys(request).some((key) => !["expectedRevision", "nodeIds", "ref", "target"].includes(key))) {
    throw new Error("JianYing export request contains unsupported fields")
  }
  if (
    !request.ref ||
    typeof request.ref.scopeId !== "string" ||
    !request.ref.scopeId ||
    typeof request.ref.canvasId !== "string" ||
    !request.ref.canvasId
  ) {
    throw new Error("A Project-scoped Canvas reference is required")
  }
  if (Object.keys(request.ref).some((key) => key !== "scopeId" && key !== "canvasId")) {
    throw new Error("JianYing Canvas reference contains unsupported fields")
  }
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
    throw new Error("Canvas expectedRevision must be a non-negative integer")
  }
  if (
    !Array.isArray(request.nodeIds) ||
    request.nodeIds.length === 0 ||
    request.nodeIds.length > 500 ||
    request.nodeIds.some((nodeId) => typeof nodeId !== "string" || !nodeId) ||
    new Set(request.nodeIds).size !== request.nodeIds.length
  ) {
    throw new Error("JianYing export nodeIds must contain unique Canvas node ids")
  }
  if (!request.target || typeof request.target !== "object") throw new Error("JianYing export target is required")
  if (request.target.kind === "current-or-new") {
    if (Object.keys(request.target).length !== 1) throw new Error("Toolbar JianYing export target is invalid")
    return
  }
  if (
    (request.target.kind !== "current" && request.target.kind !== "new") ||
    typeof request.target.draftToken !== "string" ||
    !request.target.draftToken ||
    Object.keys(request.target).some((key) => key !== "kind" && key !== "draftToken")
  ) {
    throw new Error("Agent JianYing export requires an explicit target and draftToken")
  }
}
