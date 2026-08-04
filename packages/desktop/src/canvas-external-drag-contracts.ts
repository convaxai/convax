import type { CanvasDocumentRef } from "@convax/canvas/application"

export const canvasExternalMediaDragIpcChannels = {
  cancel: "canvas:external-media-drag-cancel",
  cancelPrepare: "canvas:external-media-drag-prepare-cancel",
  prepare: "canvas:external-media-drag-prepare",
  start: "canvas:external-media-drag-start",
} as const

/** Pathless selection snapshot admitted by Desktop main before a native file drag. */
export interface CanvasExternalMediaDragRequest {
  nodeIds: string[]
  ref: CanvasDocumentRef
}

/** Renderer-owned correlation id used only to cancel an in-flight preparation. */
export interface CanvasExternalMediaDragPrepareRequest extends CanvasExternalMediaDragRequest {
  prepareId: string
}

export interface CanvasExternalMediaDragPrepareCancellationRequest {
  prepareId: string
}

/** Sender-scoped, short-lived authorization for already staged native files. */
export interface CanvasExternalMediaDragTicket {
  expiresAt: number
  itemCount: number
  ticket: string
}

export interface CanvasExternalMediaDragTicketRequest {
  ticket: string
}

export interface CanvasExternalMediaDragRendererClient {
  cancel(input: CanvasExternalMediaDragTicketRequest): void
  cancelPrepare(input: CanvasExternalMediaDragPrepareCancellationRequest): void
  prepare(input: CanvasExternalMediaDragPrepareRequest): Promise<CanvasExternalMediaDragTicket>
  start(input: CanvasExternalMediaDragTicketRequest): void
}
