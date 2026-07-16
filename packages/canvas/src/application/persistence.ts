import { parseCanvasDocument } from "../document"
import type { CanvasDocument } from "../types"

export interface CanvasDocumentRef {
  canvasId: string
  /** Host-defined isolation boundary (for example a project, tenant, or document space). */
  scopeId: string
}

export interface CanvasDocumentSnapshot {
  document: CanvasDocument | null
  storageVersion: string | null
}

export interface CanvasDocumentSaveRequest {
  document: CanvasDocument
  expectedStorageVersion: string | null
  ref: CanvasDocumentRef
}

export interface CanvasDocumentSaveResult {
  storageVersion: string
}

export interface CanvasDocumentRepository {
  load(ref: CanvasDocumentRef): Promise<CanvasDocumentSnapshot>
  save(request: CanvasDocumentSaveRequest): Promise<CanvasDocumentSaveResult>
}

/** Renderer-safe transport with the same semantics as the repository port. */
export interface CanvasDocumentClient extends CanvasDocumentRepository {}

export class InvalidCanvasDocumentError extends Error {
  constructor(canvasId: string) {
    super(`Canvas document is invalid or belongs to another canvas: ${canvasId}`)
    this.name = "InvalidCanvasDocumentError"
  }
}

export class CanvasStorageConflictError extends Error {
  readonly actualStorageVersion: string | null
  readonly expectedStorageVersion: string | null

  constructor(expectedStorageVersion: string | null, actualStorageVersion: string | null) {
    super("Canvas document changed since it was loaded")
    this.name = "CanvasStorageConflictError"
    this.expectedStorageVersion = expectedStorageVersion
    this.actualStorageVersion = actualStorageVersion
  }
}

export function parseStoredCanvasDocument(content: string, expectedCanvasId: string) {
  try {
    const document = parseCanvasDocument(JSON.parse(content), expectedCanvasId)
    if (document) return document
  } catch {
    // Report one stable domain error for malformed JSON and schema failures.
  }
  throw new InvalidCanvasDocumentError(expectedCanvasId)
}

export function serializeCanvasDocument(document: CanvasDocument) {
  const parsed = parseCanvasDocument(document, document.id)
  if (!parsed) throw new InvalidCanvasDocumentError(document.id)
  return `${JSON.stringify(parsed, null, 2)}\n`
}
