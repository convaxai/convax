import type { CanvasDocument } from "../types"
import type { BoundedOperationReceipt } from "../collaboration"
import type { CanvasBusinessCommandResult, CanvasCommandEnvelope } from "./commands"
import type { CanvasDocumentRef } from "./persistence"
import type { CanvasNodeQuery, CanvasNodeSummary } from "./queries"

export interface CanvasApplicationCommandRequest extends CanvasDocumentRef {
  /** Main rechecks this immediately before its binary journal/head barrier. */
  beforeCommit?: () => Promise<void>
  envelope: CanvasCommandEnvelope
  signal?: AbortSignal
}

/** A read-only UI/application projection, never a persistence payload. */
export interface CanvasApplicationCommandResult extends CanvasBusinessCommandResult {
  operationReceipt: BoundedOperationReceipt
}

export interface CanvasApplicationQueryResult {
  nodes: CanvasNodeSummary[]
  projection: CanvasDocument
}

export interface CanvasApplicationCommitEvent extends CanvasDocumentRef {
  actor: CanvasCommandEnvelope["actor"]
  operationReceipt: BoundedOperationReceipt
}

export interface CanvasApplicationServiceOptions {
  /** Failure-isolated host invalidation hook; durable Main commit stays authoritative. */
  onDidCommit?(event: CanvasApplicationCommitEvent): void
}

/**
 * Main-owned collaboration application port. Its implementation maps the
 * host-neutral command to exactly one closed typed intent, allocates operation
 * and entity identities, runs the isolated candidate, and durably commits the
 * binary frame before resolving. Commands without a frozen mapping fail closed.
 */
export interface CanvasCollaborationApplicationPort {
  query(ref: CanvasDocumentRef, query?: CanvasNodeQuery): Promise<CanvasApplicationQueryResult>
  submit(request: CanvasApplicationCommandRequest): Promise<CanvasApplicationCommandResult>
}

/**
 * Thin headless facade shared by UI/Agent/Plugin adapters. It owns no document,
 * revision, repository, retry loop, whole-document save, or second idempotency
 * cache; all mutation authority is behind CanvasCollaborationApplicationPort.
 */
export class CanvasApplicationService {
  constructor(
    private readonly collaboration: CanvasCollaborationApplicationPort,
    private readonly options: CanvasApplicationServiceOptions = {},
  ) {}

  async execute(request: CanvasApplicationCommandRequest): Promise<CanvasApplicationCommandResult> {
    throwIfAborted(request.signal)
    const result = await this.collaboration.submit(request)
    throwIfAborted(request.signal)
    try {
      this.options.onDidCommit?.({
        canvasId: request.canvasId,
        scopeId: request.scopeId,
        actor: { ...request.envelope.actor },
        operationReceipt: structuredClone(result.operationReceipt),
      })
    } catch {
      // A projection invalidation listener cannot reverse a durable Main commit.
    }
    return result
  }

  query(ref: CanvasDocumentRef, query: CanvasNodeQuery = {}): Promise<CanvasApplicationQueryResult> {
    return this.collaboration.query(ref, query)
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException("Canvas operation was canceled", "AbortError")
}
