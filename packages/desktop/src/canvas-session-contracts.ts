import type {
  CanvasApplicationCommand,
  CanvasApplicationCommandResult,
  CanvasDocumentRef,
} from "@convax/canvas/application"
import type { BoundedOperationReceipt, CanvasEntityRef, CanvasRendererCommand } from "@convax/canvas/collaboration"
import type { CanvasDocument } from "@convax/canvas/core"
import type { Digest, Id128 } from "@convax/collaboration"

export const canvasSessionIpcChannels = {
  close: "canvas:session-close",
  executeApplication: "canvas:session-execute-application",
  flush: "canvas:session-flush",
  invalidated: "canvas:session-invalidated",
  open: "canvas:session-open",
  query: "canvas:session-query",
  redo: "canvas:session-redo",
  submit: "canvas:session-submit",
  undo: "canvas:session-undo",
} as const

export interface CanvasSessionProjectionDto {
  readonly format: "convax.canvas-session-projection"
  readonly ref: CanvasDocumentRef
  /** Renderer mount identity only; never a document version or mutation guard. */
  readonly sessionId: Id128
  readonly document: CanvasDocument
  readonly edgeEntities: readonly Readonly<{
    readonly edgeId: string
    readonly entity: CanvasEntityRef & { readonly kind: "edge" }
  }>[]
  readonly nodeEntities: readonly Readonly<{
    readonly nodeId: string
    readonly entity: CanvasEntityRef & { readonly kind: "node" }
  }>[]
  readonly canUndo: boolean
  readonly canRedo: boolean
}

export interface CanvasSessionInvalidationDto {
  readonly format: "convax.canvas-session-invalidation"
  readonly ref: CanvasDocumentRef
  readonly sessionId: Id128
  readonly frameDigest: Digest
}

export interface CanvasRendererSessionMutationResult {
  readonly operationReceipt: BoundedOperationReceipt
  readonly projection: CanvasSessionProjectionDto
  readonly acceptedFrameDigest: Digest
  readonly historyTransition?: Readonly<{
    readonly direction: "undo" | "redo"
    readonly rootOperationId: Id128
  }>
}

export interface CanvasRendererApplicationMutationResult extends Omit<
  CanvasApplicationCommandResult,
  "createdResourceNodeIds" | "document"
> {
  readonly projection: CanvasSessionProjectionDto
  readonly acceptedFrameDigest: Digest
}

export interface CanvasRendererSessionScope {
  readonly ref: CanvasDocumentRef
  readonly sessionId: Id128
}

/** Closed renderer/preload surface. It cannot carry raw Yjs updates or owner facts. */
export interface CanvasRendererSessionTransport {
  open(ref: CanvasDocumentRef): Promise<CanvasSessionProjectionDto>
  query(scope: CanvasRendererSessionScope): Promise<CanvasSessionProjectionDto>
  executeApplication(
    input: CanvasRendererSessionScope & { readonly command: CanvasApplicationCommand; readonly commandId: string },
  ): Promise<CanvasRendererApplicationMutationResult>
  submit(
    input: CanvasRendererSessionScope & { readonly command: CanvasRendererCommand; readonly commandId: string },
  ): Promise<CanvasRendererSessionMutationResult>
  undo(
    scope: CanvasRendererSessionScope & { readonly commandId: string },
  ): Promise<CanvasRendererSessionMutationResult | null>
  redo(
    scope: CanvasRendererSessionScope & { readonly commandId: string },
  ): Promise<CanvasRendererSessionMutationResult | null>
  flush(scope: CanvasRendererSessionScope): Promise<void>
  close(scope: CanvasRendererSessionScope): Promise<void>
  subscribe(listener: (event: CanvasSessionInvalidationDto) => void): () => void
}
