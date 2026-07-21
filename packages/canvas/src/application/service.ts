import {
  executeCanvasApplicationCommand,
  executeCanvasApplicationTransaction,
  type CanvasBusinessCommandResult,
  type CanvasCommandEnvelope,
  type CanvasTransactionEnvelope,
} from "./commands"
import type { CanvasDocumentRef, CanvasDocumentRepository } from "./persistence"
import { queryCanvasNodes, type CanvasNodeQuery, type CanvasNodeSummary } from "./queries"

export interface CanvasApplicationCommandRequest extends CanvasDocumentRef {
  envelope: CanvasCommandEnvelope
  signal?: AbortSignal
}

export interface CanvasApplicationTransactionRequest extends CanvasDocumentRef {
  envelope: CanvasTransactionEnvelope
  signal?: AbortSignal
}

export interface CanvasApplicationCommandResult extends CanvasBusinessCommandResult {
  storageVersion: string
}

export interface CanvasApplicationQueryResult {
  nodes: CanvasNodeSummary[]
  revision: number
  storageVersion: string | null
}

export interface CanvasApplicationCommitEvent extends CanvasDocumentRef {
  actor: CanvasCommandEnvelope["actor"]
  revision: number
  storageVersion: string
}

export interface CanvasApplicationServiceOptions {
  /** Failure-isolated host invalidation hook; persistence success stays authoritative. */
  onDidCommit?(event: CanvasApplicationCommitEvent): void
}

export class CanvasCommandIdConflictError extends Error {
  constructor(commandId: string) {
    super(`Canvas command id was reused with a different payload: ${commandId}`)
    this.name = "CanvasCommandIdConflictError"
  }
}

export class CanvasTransactionIdConflictError extends Error {
  constructor(transactionId: string) {
    super(`Canvas transaction id was reused with a different payload: ${transactionId}`)
    this.name = "CanvasTransactionIdConflictError"
  }
}

interface CanvasExecution {
  fingerprint: string
  result: Promise<CanvasApplicationCommandResult>
  retainedDocumentCharacters: number
}

const maximumExecutionEntries = 1_000
// Successful replay receipts retain their result document. Bound their combined
// serialized size so unique ids cannot pin hundreds of large Canvas snapshots.
const maximumRetainedDocumentCharacters = 4 * 1024 * 1024

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

export class CanvasApplicationService {
  private readonly executions = new Map<string, CanvasExecution>()
  private readonly transactions = new Map<string, CanvasExecution>()
  private retainedDocumentCharacters = 0

  constructor(
    private readonly repository: CanvasDocumentRepository,
    private readonly options: CanvasApplicationServiceOptions = {},
  ) {}

  execute(request: CanvasApplicationCommandRequest): Promise<CanvasApplicationCommandResult> {
    const key = JSON.stringify([
      request.scopeId,
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
    const execution = { fingerprint, result, retainedDocumentCharacters: 0 }
    this.rememberExecution(this.executions, key, execution)
    void result.then(
      (value) => this.retainSettledExecution(this.executions, key, execution, value),
      () => this.forgetExecution(this.executions, key, execution),
    )
    return result
  }

  executeTransaction(request: CanvasApplicationTransactionRequest): Promise<CanvasApplicationCommandResult> {
    const key = JSON.stringify([
      request.scopeId,
      request.canvasId,
      request.envelope.actor.kind,
      request.envelope.actor.id,
      request.envelope.transactionId,
    ])
    const fingerprint = stableJson({
      commands: request.envelope.commands,
      expectedRevision: request.envelope.expectedRevision,
    })
    const existing = this.transactions.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new CanvasTransactionIdConflictError(request.envelope.transactionId))
      }
      return existing.result
    }
    const result = this.executeTransactionOnce(request)
    const execution = { fingerprint, result, retainedDocumentCharacters: 0 }
    this.rememberExecution(this.transactions, key, execution)
    void result.then(
      (value) => this.retainSettledExecution(this.transactions, key, execution, value),
      () => this.forgetExecution(this.transactions, key, execution),
    )
    return result
  }

  private forgetExecution(cache: Map<string, CanvasExecution>, key: string, execution: CanvasExecution) {
    if (cache.get(key) !== execution) return
    cache.delete(key)
    this.retainedDocumentCharacters -= execution.retainedDocumentCharacters
  }

  private rememberExecution(cache: Map<string, CanvasExecution>, key: string, execution: CanvasExecution) {
    cache.set(key, execution)
    if (cache.size <= maximumExecutionEntries) return
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) this.forgetExecution(cache, oldestKey, cache.get(oldestKey)!)
  }

  private retainSettledExecution(
    cache: Map<string, CanvasExecution>,
    key: string,
    execution: CanvasExecution,
    value: CanvasApplicationCommandResult,
  ) {
    if (cache.get(key) !== execution) return
    execution.retainedDocumentCharacters = serializedDocumentCharacters(value)
    this.retainedDocumentCharacters += execution.retainedDocumentCharacters
    this.trimSettledExecutions()
  }

  private trimSettledExecutions() {
    while (this.retainedDocumentCharacters > maximumRetainedDocumentCharacters) {
      let removed = false
      for (const cache of [this.executions, this.transactions]) {
        for (const [key, execution] of cache) {
          if (execution.retainedDocumentCharacters === 0) continue
          this.forgetExecution(cache, key, execution)
          removed = true
          break
        }
        if (removed) break
      }
      if (!removed) return
    }
  }

  private async executeOnce(request: CanvasApplicationCommandRequest): Promise<CanvasApplicationCommandResult> {
    throwIfAborted(request.signal)
    const ref = { canvasId: request.canvasId, scopeId: request.scopeId }
    const snapshot = await this.repository.load(ref)
    throwIfAborted(request.signal)
    if (!snapshot.document) throw new Error(`Canvas document was not found: ${request.canvasId}`)
    const result = executeCanvasApplicationCommand(snapshot.document, request.envelope)
    if (!result.changed) {
      if (!snapshot.storageVersion) throw new Error(`Canvas document has no storage version: ${request.canvasId}`)
      return { ...result, storageVersion: snapshot.storageVersion }
    }
    throwIfAborted(request.signal)
    const saved = await this.repository.save({
      document: result.document,
      expectedStorageVersion: snapshot.storageVersion,
      ref,
    })
    this.notifyCommit(ref, request.envelope.actor, result.document.revision, saved.storageVersion)
    return { ...result, storageVersion: saved.storageVersion }
  }

  private async executeTransactionOnce(
    request: CanvasApplicationTransactionRequest,
  ): Promise<CanvasApplicationCommandResult> {
    throwIfAborted(request.signal)
    const ref = { canvasId: request.canvasId, scopeId: request.scopeId }
    const snapshot = await this.repository.load(ref)
    throwIfAborted(request.signal)
    if (!snapshot.document) throw new Error(`Canvas document was not found: ${request.canvasId}`)
    const result = executeCanvasApplicationTransaction(snapshot.document, request.envelope)
    if (!result.changed) {
      if (!snapshot.storageVersion) throw new Error(`Canvas document has no storage version: ${request.canvasId}`)
      return { ...result, storageVersion: snapshot.storageVersion }
    }
    throwIfAborted(request.signal)
    const saved = await this.repository.save({
      document: result.document,
      expectedStorageVersion: snapshot.storageVersion,
      ref,
    })
    this.notifyCommit(ref, request.envelope.actor, result.document.revision, saved.storageVersion)
    return { ...result, storageVersion: saved.storageVersion }
  }

  private notifyCommit(
    ref: CanvasDocumentRef,
    actor: CanvasCommandEnvelope["actor"],
    revision: number,
    storageVersion: string,
  ) {
    try {
      this.options.onDidCommit?.({ ...ref, actor: { ...actor }, revision, storageVersion })
    } catch {
      // A host invalidation listener cannot turn a durable Canvas commit into a failure.
    }
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

function serializedDocumentCharacters(result: CanvasApplicationCommandResult) {
  try {
    return JSON.stringify(result.document).length
  } catch {
    return maximumRetainedDocumentCharacters + 1
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException("Canvas operation was canceled", "AbortError")
}
