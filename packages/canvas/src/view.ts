import type { CanvasPoint } from "./types"

export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

export interface CanvasViewSnapshot {
  documentId: string
  revision: number
  scopeId: string
  selectedEdgeIds: string[]
  selectedNodeIds: string[]
  viewId: string
  viewport: CanvasViewport
}

export type CanvasViewCommand =
  | {
      type: "nodes.reveal"
      animation?: "instant" | "smooth"
      fit?: "center" | "contain" | "none"
      nodeIds: readonly string[]
      select?: boolean
    }
  | { type: "notification.show"; description?: string; kind: "error" | "info" | "success" | "warning"; title: string }
  | { type: "selection.clear" }
  | { type: "selection.set"; edgeIds?: readonly string[]; nodeIds?: readonly string[] }
  | {
      type: "viewport.center"
      animation?: "instant" | "smooth"
      position: CanvasPoint
      zoom?: number
    }
  | {
      type: "viewport.fit"
      animation?: "instant" | "smooth"
      maxZoom?: number
      nodeIds?: readonly string[]
      padding?: number
    }
  | { type: "viewport.zoom"; animation?: "instant" | "smooth"; zoom: number }

export interface CanvasViewCommandResult {
  foundNodeIds: string[]
  missingNodeIds: string[]
  snapshot: CanvasViewSnapshot
}

export interface CanvasViewExecutionGuard {
  expectedDocumentId: string
  expectedRevision?: number
  expectedScopeId: string
}

export interface CanvasViewSession {
  execute(command: CanvasViewCommand, guard?: CanvasViewExecutionGuard): Promise<CanvasViewCommandResult>
  getSnapshot(): CanvasViewSnapshot
  whenReady(): Promise<void>
  readonly viewId: string
}

export interface CanvasViewCommandRequest extends CanvasViewExecutionGuard {
  command: CanvasViewCommand
  viewId: string
}

export interface CanvasViewRegistry {
  execute(input: CanvasViewCommandRequest): Promise<CanvasViewCommandResult>
  list(): CanvasViewSnapshot[]
  register(session: CanvasViewSession): () => void
  subscribe(listener: () => void): () => void
}

export class CanvasViewNotFoundError extends Error {
  constructor(viewId: string) {
    super(`Canvas view was not found: ${viewId}`)
    this.name = "CanvasViewNotFoundError"
  }
}

export class CanvasViewDocumentMismatchError extends Error {
  readonly actualDocumentId: string
  readonly expectedDocumentId: string

  constructor(expectedDocumentId: string, actualDocumentId: string) {
    super(`Canvas view document changed: expected ${expectedDocumentId}, received ${actualDocumentId}`)
    this.name = "CanvasViewDocumentMismatchError"
    this.expectedDocumentId = expectedDocumentId
    this.actualDocumentId = actualDocumentId
  }
}

export class CanvasViewScopeMismatchError extends Error {
  readonly actualScopeId: string
  readonly expectedScopeId: string

  constructor(expectedScopeId: string, actualScopeId: string) {
    super(`Canvas view scope changed: expected ${expectedScopeId}, received ${actualScopeId}`)
    this.name = "CanvasViewScopeMismatchError"
    this.expectedScopeId = expectedScopeId
    this.actualScopeId = actualScopeId
  }
}

export class CanvasViewRevisionMismatchError extends Error {
  readonly actualRevision: number
  readonly expectedRevision: number

  constructor(expectedRevision: number, actualRevision: number) {
    super(`Canvas view revision changed: expected ${expectedRevision}, received ${actualRevision}`)
    this.name = "CanvasViewRevisionMismatchError"
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
  }
}

export function assertCanvasViewGuard(snapshot: CanvasViewSnapshot, guard: CanvasViewExecutionGuard) {
  if (snapshot.documentId !== guard.expectedDocumentId) {
    throw new CanvasViewDocumentMismatchError(guard.expectedDocumentId, snapshot.documentId)
  }
  if (snapshot.scopeId !== guard.expectedScopeId) {
    throw new CanvasViewScopeMismatchError(guard.expectedScopeId, snapshot.scopeId)
  }
  if (guard.expectedRevision !== undefined && snapshot.revision !== guard.expectedRevision) {
    throw new CanvasViewRevisionMismatchError(guard.expectedRevision, snapshot.revision)
  }
}

export function createCanvasViewRegistry(): CanvasViewRegistry {
  const sessions = new Map<string, CanvasViewSession>()
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((listener) => listener())

  return {
    async execute(input) {
      const session = sessions.get(input.viewId)
      if (!session) throw new CanvasViewNotFoundError(input.viewId)
      await session.whenReady()
      const snapshot = session.getSnapshot()
      assertCanvasViewGuard(snapshot, input)
      return session.execute(input.command, input)
    },
    list() {
      return [...sessions.values()].map((session) => session.getSnapshot())
    },
    register(session) {
      const existing = sessions.get(session.viewId)
      if (existing && existing !== session) throw new Error(`Canvas view is already registered: ${session.viewId}`)
      sessions.set(session.viewId, session)
      emit()
      return () => {
        if (sessions.get(session.viewId) !== session) return
        sessions.delete(session.viewId)
        emit()
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
