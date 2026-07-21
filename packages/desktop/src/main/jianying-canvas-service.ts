import type { CanvasDocumentClient } from "@convax/canvas/application"

import type { JianyingCanvasExportRequest, JianyingClient, JianyingDraftStatusResult } from "../jianying-contracts"
import type { JianyingIntegrationService } from "./jianying-service"
import {
  ManagedCanvasMediaResolver,
  type ManagedCanvasMediaProjectPathResolver,
  type ManagedCanvasMediaResolutionPort,
} from "./managed-canvas-media-resolver"

export interface JianyingProjectPathResolver extends ManagedCanvasMediaProjectPathResolver {}

export class JianyingCanvasService implements JianyingClient {
  private readonly media: ManagedCanvasMediaResolutionPort

  constructor(
    private readonly input: {
      documents: Pick<CanvasDocumentClient, "load">
      integration: Pick<JianyingIntegrationService, "exportMedia" | "getDraftStatus">
      isEnabled: () => Promise<boolean>
      media?: ManagedCanvasMediaResolutionPort
      projects: JianyingProjectPathResolver
    },
  ) {
    this.media = input.media ?? new ManagedCanvasMediaResolver({ documents: input.documents, projects: input.projects })
  }

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
    const resolved = await this.media.resolve(
      {
        canvasId: request.ref.canvasId,
        expectedRevision: request.expectedRevision,
        nodeIds: request.nodeIds,
        scopeId: request.ref.scopeId,
      },
      {
        allowedKinds: new Set(["image", "video"]),
        allowedKindsDescription: "images and videos",
        operationLabel: "JianYing export",
      },
      signal,
    )
    const sourceMedia = resolved.map(({ mimeType, path }) => ({ mimeType, path }))
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

function sanitizeNativeBoundaryError(error: unknown) {
  if (error instanceof Error && error.name === "AbortError") return error
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return new Error(`JianYing native operation failed (${error.code})`)
  }
  return error instanceof Error ? error : new Error("JianYing native operation failed")
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
