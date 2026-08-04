import type { CanvasDocumentRef } from "@convax/canvas/application"
import type {
  BoundedOperationReceiptV2,
  CanvasEntityRefV2,
  CanvasRendererCommandV2,
} from "@convax/canvas/collaboration"
import type { CanvasDocument } from "@convax/canvas/core"
import type { Id128V2 } from "@convax/collaboration"

export const canvasSessionIpcChannels = {
  close: "canvas:session-close",
  flush: "canvas:session-flush",
  invalidated: "canvas:session-invalidated",
  open: "canvas:session-open",
  query: "canvas:session-query",
  redo: "canvas:session-redo",
  submit: "canvas:session-submit",
  undo: "canvas:session-undo",
} as const

export interface CanvasSessionProjectionDtoV2 {
  readonly format: "convax.canvas-session-projection/2"
  readonly ref: CanvasDocumentRef
  /** Renderer mount identity only; never a document version or mutation guard. */
  readonly sessionId: Id128V2
  readonly document: CanvasDocument
  readonly nodeEntities: readonly Readonly<{
    readonly nodeId: string
    readonly entity: CanvasEntityRefV2 & { readonly kind: "node" }
  }>[]
  readonly canUndo: boolean
  readonly canRedo: boolean
}

export interface CanvasSessionInvalidationDtoV2 {
  readonly format: "convax.canvas-session-invalidation/2"
  readonly ref: CanvasDocumentRef
  readonly sessionId: Id128V2
}

export interface CanvasRendererSessionMutationResultV2 {
  readonly operationReceipt: BoundedOperationReceiptV2
  readonly projection: CanvasSessionProjectionDtoV2
}

export interface CanvasRendererSessionScopeV2 {
  readonly ref: CanvasDocumentRef
  readonly sessionId: Id128V2
}

/** Closed renderer/preload surface. It cannot carry raw Yjs updates or owner facts. */
export interface CanvasRendererSessionTransportV2 {
  open(ref: CanvasDocumentRef): Promise<CanvasSessionProjectionDtoV2>
  query(scope: CanvasRendererSessionScopeV2): Promise<CanvasSessionProjectionDtoV2>
  submit(
    input: CanvasRendererSessionScopeV2 & { readonly command: CanvasRendererCommandV2; readonly commandId: string },
  ): Promise<CanvasRendererSessionMutationResultV2>
  undo(scope: CanvasRendererSessionScopeV2 & { readonly commandId: string }): Promise<CanvasRendererSessionMutationResultV2 | null>
  redo(scope: CanvasRendererSessionScopeV2 & { readonly commandId: string }): Promise<CanvasRendererSessionMutationResultV2 | null>
  flush(scope: CanvasRendererSessionScopeV2): Promise<void>
  close(scope: CanvasRendererSessionScopeV2): Promise<void>
  subscribe(listener: (event: CanvasSessionInvalidationDtoV2) => void): () => void
}
