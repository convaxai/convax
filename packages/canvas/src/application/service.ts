import {
  executeCanvasApplicationCommand,
  type CanvasBusinessCommandResult,
  type CanvasCommandEnvelope,
} from "./commands"
import type { CanvasDocumentRef, CanvasDocumentRepository } from "./persistence"
import { queryCanvasNodes, type CanvasNodeQuery, type CanvasNodeSummary } from "./queries"

export interface CanvasApplicationCommandRequest extends CanvasDocumentRef {
  envelope: CanvasCommandEnvelope
}

export interface CanvasApplicationCommandResult extends CanvasBusinessCommandResult {
  storageVersion: string
}

export interface CanvasApplicationQueryResult {
  nodes: CanvasNodeSummary[]
  revision: number
  storageVersion: string | null
}

export class CanvasCommandIdConflictError extends Error {
  constructor(commandId: string) {
    super(`Canvas command id was reused with a different payload: ${commandId}`)
    this.name = "CanvasCommandIdConflictError"
  }
}

interface CanvasExecution {
  fingerprint: string
  result: Promise<CanvasApplicationCommandResult>
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

export class CanvasApplicationService {
  private readonly executions = new Map<string, CanvasExecution>()

  constructor(private readonly repository: CanvasDocumentRepository) {}

  execute(request: CanvasApplicationCommandRequest): Promise<CanvasApplicationCommandResult> {
    const key = JSON.stringify([
      request.projectId,
      request.canvasId,
      request.envelope.actor.kind,
      request.envelope.actor.id,
      request.envelope.commandId,
    ])
    const fingerprint = stableJson({
      command: request.envelope.command,
      expectedRevision: request.envelope.expectedRevision,
    })
    const existing = this.executions.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new CanvasCommandIdConflictError(request.envelope.commandId))
      }
      return existing.result
    }
    const result = this.executeOnce(request)
    const execution = { fingerprint, result }
    this.executions.set(key, execution)
    if (this.executions.size > 1_000) this.executions.delete(this.executions.keys().next().value ?? "")
    void result.catch(() => {
      if (this.executions.get(key) === execution) this.executions.delete(key)
    })
    return result
  }

  private async executeOnce(request: CanvasApplicationCommandRequest): Promise<CanvasApplicationCommandResult> {
    const ref = { canvasId: request.canvasId, projectId: request.projectId }
    const snapshot = await this.repository.load(ref)
    if (!snapshot.document) throw new Error(`Canvas document was not found: ${request.canvasId}`)
    const result = executeCanvasApplicationCommand(snapshot.document, request.envelope)
    if (!result.changed) {
      if (!snapshot.storageVersion) throw new Error(`Canvas document has no storage version: ${request.canvasId}`)
      return { ...result, storageVersion: snapshot.storageVersion }
    }
    const saved = await this.repository.save({
      document: result.document,
      expectedStorageVersion: snapshot.storageVersion,
      ref,
    })
    return { ...result, storageVersion: saved.storageVersion }
  }

  async query(ref: CanvasDocumentRef, query: CanvasNodeQuery = {}): Promise<CanvasApplicationQueryResult> {
    const snapshot = await this.repository.load(ref)
    if (!snapshot.document) throw new Error(`Canvas document was not found: ${ref.canvasId}`)
    return {
      nodes: queryCanvasNodes(snapshot.document, query),
      revision: snapshot.document.revision,
      storageVersion: snapshot.storageVersion,
    }
  }
}
