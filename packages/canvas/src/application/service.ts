import type { CanvasDocument } from "../types"
import type {
  BoundedOperationReceipt,
  CanvasCertifiedProjectionPatch,
  Digest,
} from "../collaboration"
import type {
  CanvasApplicationCommand,
  CanvasBusinessCommandResult,
  CanvasCommandEnvelope,
} from "./commands"
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
  /**
   * Resource-create nodes in command ordinal order. Present only when Main
   * verified that the durable receipt contains the exact same entity set.
   */
  createdResourceNodeIds?: readonly string[]
  /** Accepted frame marker for host/session reconciliation; never a command input. */
  acceptedFrameDigest?: Digest
}

export type CanvasCertifiedResourceAppendCommand = Extract<
  CanvasApplicationCommand,
  { readonly type: "resources.add" | "resources.pending.create" }
>

/**
 * Explicit patch-only result mode for one bounded resource append. It is a
 * presentation optimization; ordinary callers continue to request a full
 * document through `execute`.
 */
export interface CanvasCertifiedResourceAppendRequest extends Omit<CanvasApplicationCommandRequest, "envelope"> {
  readonly envelope: Omit<CanvasCommandEnvelope, "command"> & {
    readonly command: CanvasCertifiedResourceAppendCommand
  }
  readonly resultProjection: "certified-resource-append-patch"
}

export type CanvasCertifiedResourceProjectionDelivery =
  | Readonly<{
      readonly status: "certified"
      readonly patch: CanvasCertifiedProjectionPatch
    }>
  | Readonly<{ readonly status: "unavailable" }>

/** Closed bounded result: it deliberately has no whole-document field. */
export interface CanvasCertifiedResourceAppendResult {
  readonly acceptedFrameDigest?: Digest
  readonly affectedNodeIds: readonly string[]
  readonly changed: boolean
  readonly createdNodeIds: readonly string[]
  readonly createdResourceNodeIds?: readonly string[]
  readonly operationReceipt: BoundedOperationReceipt
  readonly projectionDelivery: CanvasCertifiedResourceProjectionDelivery
  readonly warnings: readonly string[]
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
  diagnostics?: CanvasSubmitDiagnosticsPort
  /** Mounted-view acceleration; generic full-document ports need not provide it. */
  certifiedResourceAppend?: CanvasCertifiedResourceAppendPort
}

export type CanvasSubmitDiagnosticStage =
  | "business-prepare"
  | "application-intent"
  | "document-service-submit"
  | "session-acquire/open"
  | "command-adapter-prepare"
  | "kernel-root"
  | "post-root-receipt-lookup"
  | "post-root-projection"
  | "onDidCommit/event"

export interface CanvasSubmitDiagnostic {
  readonly callCount: 1
  readonly durationMs: number
  readonly stage: CanvasSubmitDiagnosticStage
  readonly sizes?: Readonly<Record<string, number>>
}

export interface CanvasSubmitDiagnosticsPort {
  record(diagnostic: CanvasSubmitDiagnostic): void
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

/** Optional Main-owned extension used only by the certified resource-append path. */
export interface CanvasCertifiedResourceAppendPort {
  submitCertifiedResourceAppend(
    request: CanvasCertifiedResourceAppendRequest,
  ): Promise<CanvasCertifiedResourceAppendResult>
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
    return this.executeSubmission(request, () => this.collaboration.submit(request))
  }

  async executeCertifiedResourceAppend(
    request: CanvasCertifiedResourceAppendRequest,
  ): Promise<CanvasCertifiedResourceAppendResult> {
    if (
      request.resultProjection !== "certified-resource-append-patch" ||
      !isCertifiedResourceAppendCommand(request.envelope.command)
    ) {
      throw new TypeError("Canvas certified projection requests require one resource append command")
    }
    const certified = this.options.certifiedResourceAppend
    if (!certified) throw new TypeError("Canvas certified resource append port is unavailable")
    return this.executeSubmission(request, () => certified.submitCertifiedResourceAppend(request))
  }

  private async executeSubmission<T extends { readonly operationReceipt: BoundedOperationReceipt }>(
    request: CanvasApplicationCommandRequest | CanvasCertifiedResourceAppendRequest,
    submit: () => Promise<T>,
  ): Promise<T> {
    throwIfAborted(request.signal)
    const result = await traceSubmit(this.options.diagnostics, "application-intent", submit)
    throwIfAborted(request.signal)
    traceSubmitSync(this.options.diagnostics, "onDidCommit/event", () => this.options.onDidCommit?.({
        canvasId: request.canvasId,
        scopeId: request.scopeId,
        actor: { ...request.envelope.actor },
        operationReceipt: structuredClone(result.operationReceipt),
      }))
    return result
  }

  query(ref: CanvasDocumentRef, query: CanvasNodeQuery = {}): Promise<CanvasApplicationQueryResult> {
    return this.collaboration.query(ref, query)
  }
}

function isCertifiedResourceAppendCommand(
  command: CanvasApplicationCommand,
): command is CanvasCertifiedResourceAppendCommand {
  return command.type === "resources.add" || command.type === "resources.pending.create"
}

async function traceSubmit<T>(
  port: CanvasSubmitDiagnosticsPort | undefined,
  stage: CanvasSubmitDiagnosticStage,
  operation: () => Promise<T>,
): Promise<T> {
  if (!port) return operation()
  const startedAt = performance.now()
  try {
    return await operation()
  } finally {
    try { port.record({ callCount: 1, durationMs: performance.now() - startedAt, stage }) } catch {}
  }
}

function traceSubmitSync(
  port: CanvasSubmitDiagnosticsPort | undefined,
  stage: CanvasSubmitDiagnosticStage,
  operation: () => void,
): void {
  if (!port) {
    try { operation() } catch {}
    return
  }
  const startedAt = performance.now()
  try { operation() } catch {} finally {
    try { port.record({ callCount: 1, durationMs: performance.now() - startedAt, stage }) } catch {}
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException("Canvas operation was canceled", "AbortError")
}
