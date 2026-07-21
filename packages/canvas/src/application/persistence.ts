import { parseCanvasDocument } from "../document"
import type { CanvasDocument } from "../types"

export const canvasDocumentSchemaVersion = "convax.canvas/2" as const

interface StoredCanvasDocumentV2 {
  document: unknown
  schemaVersion: typeof canvasDocumentSchemaVersion
}

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

/** Main-owned document storage port; renderer callers use application commands instead. */
export interface CanvasDocumentClient extends CanvasDocumentRepository {}

export class InvalidCanvasDocumentError extends Error {
  constructor(canvasId: string) {
    super(`Canvas document is invalid or belongs to another canvas: ${canvasId}`)
    this.name = "InvalidCanvasDocumentError"
  }
}

export class UnsupportedCanvasDocumentVersionError extends Error {
  constructor(readonly schemaVersion: unknown) {
    super("Canvas document schema is not supported")
    this.name = "UnsupportedCanvasDocumentVersionError"
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
  let stored: unknown
  try {
    stored = JSON.parse(content)
  } catch {
    throw new InvalidCanvasDocumentError(expectedCanvasId)
  }

  if (!isRecord(stored)) throw new InvalidCanvasDocumentError(expectedCanvasId)
  if (stored.schemaVersion !== canvasDocumentSchemaVersion) {
    throw new UnsupportedCanvasDocumentVersionError(stored.schemaVersion)
  }

  const envelope: StoredCanvasDocumentV2 = {
    document: stored.document,
    schemaVersion: stored.schemaVersion,
  }
  const document = parseCanvasDocument(envelope.document, expectedCanvasId)
  if (!document || hasDurableRuntimeState(document)) {
    throw new InvalidCanvasDocumentError(expectedCanvasId)
  }
  return document
}

export function serializeCanvasDocument(document: CanvasDocument) {
  const parsed = parseCanvasDocument(document, document.id)
  if (!parsed) throw new InvalidCanvasDocumentError(document.id)
  const envelope: StoredCanvasDocumentV2 = {
    document: stripRuntimeState(parsed),
    schemaVersion: canvasDocumentSchemaVersion,
  }
  return `${JSON.stringify(envelope, null, 2)}\n`
}

function hasDurableRuntimeState(document: CanvasDocument) {
  return document.nodes.some((node) => Object.hasOwn(node.data, "resourceState"))
}

function stripRuntimeState(document: CanvasDocument): CanvasDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (!Object.hasOwn(node.data, "resourceState")) {
        return node
      }
      const { resourceState: _resourceState, ...data } = node.data
      return { ...node, data }
    }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
