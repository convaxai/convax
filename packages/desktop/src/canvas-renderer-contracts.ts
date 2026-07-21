import type { CanvasDocumentRef } from "@convax/canvas/application"
import type { CanvasViewCommandRequest, CanvasViewCommandResult, CanvasViewSnapshot } from "@convax/canvas/view"

export const canvasRendererChannels = {
  request: "canvas:renderer-request",
  response: "canvas:renderer-response",
} as const

export type CanvasDocumentMutationOutcome = "aborted" | "committed"

export interface CanvasDocumentMutationPrepareRequest {
  leaseId: string
  ref: CanvasDocumentRef
  type: "document.mutation.prepare"
}

export interface CanvasDocumentMutationFinishRequest {
  leaseId: string
  outcome: CanvasDocumentMutationOutcome
  ref: CanvasDocumentRef
  type: "document.mutation.finish"
}

export interface CanvasDocumentMutationCancelRequest {
  leaseId: string
  ref: CanvasDocumentRef
  type: "document.mutation.cancel"
}

export interface CanvasDocumentMutationPrepareResult {
  leaseId: string
  prepared: boolean
  ref: CanvasDocumentRef
  type: "document.mutation.prepare"
}

export interface CanvasDocumentMutationFinishResult {
  finished: true
  leaseId: string
  ref: CanvasDocumentRef
  type: "document.mutation.finish"
}

export interface CanvasDocumentMutationCancelResult {
  canceled: boolean
  leaseId: string
  ref: CanvasDocumentRef
  type: "document.mutation.cancel"
}

export type CanvasRendererRequest =
  | { type: "document.reload"; ref: CanvasDocumentRef }
  | CanvasDocumentMutationCancelRequest
  | CanvasDocumentMutationPrepareRequest
  | CanvasDocumentMutationFinishRequest
  | { type: "view.snapshot"; viewId: string }
  | { type: "view.execute"; input: CanvasViewCommandRequest }

export type CanvasRendererRequestResult =
  | { type: "document.reload"; reloaded: boolean }
  | CanvasDocumentMutationCancelResult
  | CanvasDocumentMutationPrepareResult
  | CanvasDocumentMutationFinishResult
  | { type: "view.snapshot"; snapshot: CanvasViewSnapshot | null }
  | { type: "view.execute"; result: CanvasViewCommandResult }

export function sameCanvasDocumentRef(left: CanvasDocumentRef, right: CanvasDocumentRef) {
  return left.scopeId === right.scopeId && left.canvasId === right.canvasId
}

export function matchesCanvasDocumentMutationResult(
  request:
    | CanvasDocumentMutationCancelRequest
    | CanvasDocumentMutationPrepareRequest
    | CanvasDocumentMutationFinishRequest,
  result: CanvasRendererRequestResult,
): result is
  | CanvasDocumentMutationCancelResult
  | CanvasDocumentMutationPrepareResult
  | CanvasDocumentMutationFinishResult {
  return (
    result.type === request.type &&
    result.leaseId === request.leaseId &&
    sameCanvasDocumentRef(result.ref, request.ref) &&
    (result.type !== "document.mutation.prepare" || typeof result.prepared === "boolean") &&
    (result.type !== "document.mutation.cancel" || typeof result.canceled === "boolean")
  )
}

export interface CanvasRendererRequestEnvelope {
  id: string
  request: CanvasRendererRequest
}

export type CanvasRendererResponseEnvelope =
  | { id: string; ok: true; result: CanvasRendererRequestResult }
  | { error: string; id: string; ok: false }

export interface CanvasRendererClient {
  onRequest(handler: (request: CanvasRendererRequest) => Promise<CanvasRendererRequestResult>): () => void
}
