import type { CanvasDocumentRef } from "@convax/canvas/application"

export const jianyingBuiltinPluginId = "jianying-editor"
export const jianyingBuiltinPluginVersion = "1.0.0"

export type JianyingDraftStatus =
  | "active"
  | "ambiguous"
  | "no_active_draft"
  | "not_running"
  | "unavailable"
  | "unsupported"

export interface JianyingDraftStatusResult {
  draftName?: string
  /** Short-lived observation token. It never contains a native path. */
  draftToken?: string
  reason?: string
  status: JianyingDraftStatus
}

export type JianyingExportTarget = { kind: "current-or-new" } | { draftToken: string; kind: "current" | "new" }

export interface JianyingCanvasExportRequest {
  expectedRevision: number
  nodeIds: string[]
  ref: CanvasDocumentRef
  target: JianyingExportTarget
}

export interface JianyingCanvasExportResult {
  createdDraft: boolean
  draftName: string
  importedMediaCount: number
  /** `confirmed` is reserved for a future draft-level verifier. */
  importStatus: "confirmed" | "dispatched"
}

export interface JianyingClient {
  exportCanvasMedia(input: JianyingCanvasExportRequest, signal?: AbortSignal): Promise<JianyingCanvasExportResult>
  getDraftStatus(): Promise<JianyingDraftStatusResult>
}

export interface JianyingRendererClient {
  cancelCanvasMediaExport(input: { operationId: string }): void
  exportCanvasMedia(input: JianyingCanvasExportIpcEnvelope): Promise<JianyingCanvasExportResult>
  getDraftStatus(): Promise<JianyingDraftStatusResult>
}

export interface JianyingCanvasExportIpcEnvelope {
  operationId: string
  request: JianyingCanvasExportRequest
}
