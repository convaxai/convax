import type { CanvasDocumentRef } from "@convax/canvas/application"
import type { CanvasViewCommandRequest, CanvasViewCommandResult } from "@convax/canvas/view"

export const canvasRendererChannels = {
  request: "canvas:renderer-request",
  response: "canvas:renderer-response",
} as const

export type CanvasRendererRequest =
  | { type: "document.reload"; ref: CanvasDocumentRef }
  | { type: "view.execute"; input: CanvasViewCommandRequest }

export type CanvasRendererRequestResult =
  | { type: "document.reload"; reloaded: boolean }
  | { type: "view.execute"; result: CanvasViewCommandResult }

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
