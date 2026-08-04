import type {
  CanvasApplicationCommand,
  CanvasApplicationCommandResult,
  CanvasApplicationQueryResult,
  CanvasDocumentRef,
} from "@convax/canvas/application"

export const canvasDocumentIpcChannels = {
  execute: "canvas:command-execute",
  load: "canvas:document-load",
} as const

export interface CanvasRendererCommandRequest {
  command: CanvasApplicationCommand
  commandId: string
  ref: CanvasDocumentRef
}

/** Renderer transport: reads authoritative snapshots and submits commands only. */
export interface CanvasRendererDocumentClient {
  execute(request: CanvasRendererCommandRequest): Promise<CanvasApplicationCommandResult>
  load(ref: CanvasDocumentRef): Promise<CanvasApplicationQueryResult>
}
