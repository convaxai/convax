import {
  canvasOperationReceipt,
  canvasSnapshotFromValidatedOwnerState,
  assertEntityRef,
  constructCanvasAuthoritativeIntent,
  constructCanvasHistoryIntent,
  deriveCanvasCommandOperationId,
  discoverCanvasHistoryIntentDependencies,
  projectCanvasDocument,
  projectCanvas,
  type BoundedOperationReceipt,
  type CanvasAuthoritativeCommand,
  type CanvasEntityRef,
  type CanvasIntentCaller,
  type CanvasRendererCommand,
  type CanvasSnapshot,
} from "@convax/canvas/collaboration"
import {
  queryCanvasNodes,
  type CanvasCommandActor,
  type CanvasApplicationCommand,
  type CanvasApplicationCommandRequest,
  type CanvasApplicationCommandResult,
  type CanvasApplicationQueryResult,
  type CanvasCollaborationApplicationPort,
  type CanvasDocumentRef,
  type CanvasNodeQuery,
  type CanvasSubmitDiagnosticsPort,
} from "@convax/canvas/application"
import type { CanvasDocument } from "@convax/canvas"
import {
  TransientSessionUndoCoordinator,
  parseId128,
  type Id128,
  type DocumentScope,
  type OwnerExternalFactPort,
  type OwnerIntentConstructionContext,
  type OwnerIntentDependencies,
  type OwnerValidatedState,
  type Digest,
} from "@convax/collaboration"

import type { MainCollaborationDocumentSession } from "./collaboration-document-session"
import type {
  CanvasRendererSessionMutationResult,
  CanvasSessionInvalidationDto,
  CanvasSessionProjectionDto,
} from "../canvas-session-contracts"

export type { CanvasSessionInvalidationDto, CanvasSessionProjectionDto } from "../canvas-session-contracts"

export interface CanvasAuthoritativeSubmitResult {
  readonly operationReceipt: BoundedOperationReceipt
  readonly projection: CanvasDocument
  readonly acceptedFrameDigest: Digest
}

export interface CanvasAuthoritativeProjection {
  readonly document: CanvasDocument
  readonly edgeEntities: readonly Readonly<{
    readonly edgeId: string
    readonly entity: CanvasEntityRef & { readonly kind: "edge" }
  }>[]
  readonly nodeEntities: readonly Readonly<{
    readonly nodeId: string
    readonly entity: CanvasEntityRef & { readonly kind: "node" }
  }>[]
}

export type CanvasRendererSubmitResult = CanvasRendererSessionMutationResult

export interface CanvasApplicationCommandAdapter {
  construct(input: {
    readonly request: CanvasApplicationCommandRequest
    readonly snapshot: CanvasSnapshot
    readonly context: OwnerIntentConstructionContext
  }): Readonly<{ caller: CanvasIntentCaller; command: CanvasAuthoritativeCommand }> | "rejected"
}

export type CanvasFactResolution =
  | Readonly<{ status: "resolved"; port: OwnerExternalFactPort<"canvas"> }>
  | Readonly<{ status: "pending" | "stale" | "rejected" }>

export interface CreateCanvasCollaborationSessionOwnerOptions {
  readonly createSessionId: () => Id128
  readonly createCursorToken: () => Id128
  readonly openDocumentSession: (ref: CanvasDocumentRef) => Promise<MainCanvasCollaborationDocumentSession>
  readonly resolveFacts: (input: {
    readonly ref: CanvasDocumentRef
    readonly scope: DocumentScope & { readonly docKind: "canvas" }
    readonly dependencies: OwnerIntentDependencies<"canvas">
    readonly signal?: AbortSignal
  }) => Promise<CanvasFactResolution>
  readonly applicationCommands: CanvasApplicationCommandAdapter
  readonly diagnostics?: CanvasSubmitDiagnosticsPort
}

export interface CanvasCollaborationSessionOwner extends CanvasCollaborationApplicationPort {
  open(input: {
    readonly ref: CanvasDocumentRef
    readonly actor: CanvasCommandActor
  }): Promise<CanvasSessionProjectionDto>
  close(input: { readonly ref: CanvasDocumentRef; readonly sessionId: Id128 }): void
  queryRenderer(ref: CanvasDocumentRef, sessionId: Id128): Promise<CanvasSessionProjectionDto>
  /**
   * Main-only bounded resource view. It verifies the mounted lease and exact live
   * node incarnations while cloning only the selected nodes from the accepted
   * snapshot projection cache.
   */
  queryRendererResourceTargets(
    ref: CanvasDocumentRef,
    sessionId: Id128,
    targets: readonly Readonly<{
      readonly entity: CanvasEntityRef & { readonly kind: "node" }
      readonly nodeId: string
    }>[],
  ): Promise<CanvasDocument>
  submitRenderer(input: {
    readonly ref: CanvasDocumentRef
    readonly sessionId: Id128
    readonly commandId: string
    readonly command: CanvasRendererCommand
    readonly signal?: AbortSignal
  }): Promise<CanvasRendererSubmitResult>
  executeApplication(input: {
    readonly ref: CanvasDocumentRef
    readonly sessionId: Id128
    readonly commandId: string
    readonly command: CanvasApplicationCommand
    readonly signal?: AbortSignal
  }): Promise<import("../canvas-session-contracts").CanvasRendererApplicationMutationResult>
  /**
   * Binds a Main-prepared UI application commit to its originating mounted
   * renderer lease. A stale lease never reverses the already-durable commit.
   */
  deliverApplicationCommit(input: {
    readonly ref: CanvasDocumentRef
    readonly rendererActorId: string
    readonly sessionId: Id128
    readonly result: CanvasApplicationCommandResult
  }): Promise<
    | Readonly<{
        status: "accepted"
        acceptedFrameDigest: Digest
        projection: CanvasSessionProjectionDto
      }>
    | Readonly<{ status: "unavailable" }>
  >
  /** Main-only host surface; Plugin/renderer IPC must not expose it directly. */
  queryAuthoritative(ref: CanvasDocumentRef): Promise<CanvasAuthoritativeProjection>
  /** Main-only host surface; Plugin/renderer IPC must not expose it directly. */
  submitAuthoritative(input: {
    readonly ref: CanvasDocumentRef
    readonly caller: CanvasIntentCaller
    readonly actor: CanvasCommandActor
    readonly commandId: string
    readonly command: CanvasAuthoritativeCommand
    readonly signal?: AbortSignal
  }): Promise<CanvasAuthoritativeSubmitResult>
  undo(input: {
    readonly ref: CanvasDocumentRef
    readonly sessionId: Id128
    readonly commandId: string
    readonly signal?: AbortSignal
  }): Promise<CanvasRendererSubmitResult | null>
  redo(input: {
    readonly ref: CanvasDocumentRef
    readonly sessionId: Id128
    readonly commandId: string
    readonly signal?: AbortSignal
  }): Promise<CanvasRendererSubmitResult | null>
  flush(ref: CanvasDocumentRef, sessionId?: Id128): Promise<void>
  /** Main-only reset barrier. No new session for this Project may open until resumed. */
  quiesceProject(scopeId: string): Promise<void>
  /** Re-enables lazy opens after the Project reset/open transition has completed. */
  resumeProject(scopeId: string): void
  subscribe(listener: (event: CanvasSessionInvalidationDto) => void): () => void
  dispose(): void
}

export type MainCanvasCollaborationDocumentSession = MainCollaborationDocumentSession<"canvas">

interface CanvasDocumentEntry {
  readonly ref: CanvasDocumentRef
  readonly document: MainCanvasCollaborationDocumentSession
  readonly leases: Map<Id128, CanvasRendererLease>
  readonly unsubscribe: () => void
}

interface CanvasRendererLease {
  readonly owner: CanvasDocumentEntry
  readonly sessionId: Id128
  readonly actor: CanvasCommandActor
  readonly undo: TransientSessionUndoCoordinator
  readonly abort: AbortController
  readonly historyResponses: Map<Id128, CanvasRendererSubmitResult>
  readonly deliveredOperationIds: Set<Id128>
}

interface CachedCanvasProjection {
  readonly document: CanvasDocument
  readonly edgeEntities: readonly Readonly<{
    readonly edgeId: string
    readonly entity: CanvasEntityRef & { readonly kind: "edge" }
  }>[]
  readonly nodeEntities: readonly Readonly<{
    readonly nodeId: string
    readonly entity: CanvasEntityRef & { readonly kind: "node" }
  }>[]
  readonly nodesById: ReadonlyMap<string, CanvasDocument["nodes"][number]>
  readonly nodeEntitiesById: ReadonlyMap<string, CanvasEntityRef & { readonly kind: "node" }>
}

// One accepted owner snapshot can feed both the application result and the
// mounted-session response. This cache owns no document authority: keys are
// validated snapshots, are weakly held, and change after every Y.Doc mutation.
const cachedCanvasProjections = new WeakMap<CanvasSnapshot, CachedCanvasProjection>()

export function createCanvasCollaborationSessionOwner(
  options: CreateCanvasCollaborationSessionOwnerOptions,
): CanvasCollaborationSessionOwner {
  const documents = new Map<string, Promise<CanvasDocumentEntry>>()
  const leases = new Map<Id128, CanvasRendererLease>()
  const leaseLanes = new WeakMap<CanvasRendererLease, Promise<void>>()
  const listeners = new Set<(event: CanvasSessionInvalidationDto) => void>()
  const quiescedProjects = new Set<string>()
  let disposed = false

  const owner: CanvasCollaborationSessionOwner = {
    async open(input) {
      const document = await documentEntry(input.ref)
      const lease = createLease(document, input.actor)
      return projectLease(lease)
    },
    close(input) {
      const lease = requireLease(input.ref, input.sessionId)
      revokeLease(lease, "unmount")
    },
    async queryRenderer(ref, sessionId) {
      const lease = requireLease(ref, sessionId)
      return exclusiveLease(lease, () => projectLease(lease))
    },
    async queryRendererResourceTargets(ref, sessionId, targets) {
      const lease = requireLease(ref, sessionId)
      return exclusiveLease(lease, async () => {
        if (!Array.isArray(targets) || targets.length < 1 || targets.length > 4_096) {
          throw new Error("Canvas renderer resource targets are invalid")
        }
        for (let index = 0; index < targets.length; index += 1) {
          if (!Object.hasOwn(targets, index)) throw new Error("Canvas renderer resource targets are invalid")
        }
        const snapshot = await lease.owner.document.query(requireCanvasSnapshot)
        const projected = cachedCanvasProjection(snapshot)
        const selected = new Set<string>()
        const nodes = targets.map((target) => {
          if (target) assertEntityRef(target.entity, "node")
          if (
            !target ||
            target.entity.kind !== "node" ||
            target.nodeId !== target.entity.id ||
            selected.has(target.nodeId)
          ) {
            throw new Error("Canvas renderer resource target is invalid")
          }
          const currentEntity = projected.nodeEntitiesById.get(target.nodeId)
          const node = projected.nodesById.get(target.nodeId)
          if (
            !currentEntity ||
            !node ||
            currentEntity.id !== target.entity.id ||
            currentEntity.incarnation !== target.entity.incarnation
          ) {
            throw new Error("Canvas renderer resource target is stale")
          }
          selected.add(target.nodeId)
          return node
        })
        return structuredClone({ ...projected.document, edges: [], nodes })
      })
    },
    async submitRenderer(input) {
      const lease = requireLease(input.ref, input.sessionId)
      return exclusiveLease(lease, async () => {
        const operationId = deriveCanvasCommandOperationId({
          ref: lease.owner.ref,
          actor: lease.actor,
          commandId: input.commandId,
        })
        const result = await submitCommand(
          lease.owner,
          lease,
          "ui",
          { kind: "renderer", command: input.command },
          operationId,
          leaseSignal(lease, input.signal),
        )
        return Object.freeze({
          operationReceipt: result.operationReceipt,
          projection: projectSnapshot(lease.owner, lease, result.snapshot),
          acceptedFrameDigest: result.acceptedFrameDigest,
        })
      })
    },
    async executeApplication(input) {
      const lease = requireLease(input.ref, input.sessionId)
      return exclusiveLease(lease, async () => {
        const request: CanvasApplicationCommandRequest = {
          ...lease.owner.ref,
          envelope: { actor: lease.actor, command: input.command, commandId: input.commandId },
          signal: leaseSignal(lease, input.signal),
        }
        const result = await submitApplicationCommand(lease.owner, lease, request)
        return Object.freeze({
          affectedNodeIds: result.affectedNodeIds,
          changed: result.changed,
          createdNodeIds: result.createdNodeIds,
          operationReceipt: result.operationReceipt,
          warnings: result.warnings,
          acceptedFrameDigest: result.acceptedFrameDigest,
          projection: projectSnapshot(lease.owner, lease, result.snapshot),
        })
      })
    },
    async deliverApplicationCommit(input) {
      let lease: CanvasRendererLease
      try {
        lease = requireLease(input.ref, input.sessionId)
      } catch {
        return Object.freeze({ status: "unavailable" as const })
      }
      if (lease.actor.kind !== "renderer" || lease.actor.id !== input.rendererActorId) {
        return Object.freeze({ status: "unavailable" as const })
      }
      try {
        return await exclusiveLease(lease, async () => {
          const frameDigest = input.result.acceptedFrameDigest
          if (!frameDigest) return Object.freeze({ status: "unavailable" as const })
          const snapshot = await lease.owner.document.query(requireCanvasSnapshot)
          const receipt = canvasOperationReceipt(
            snapshot,
            input.result.operationReceipt.actorId,
            input.result.operationReceipt.operationId,
          )
          if (!receipt || JSON.stringify(receipt) !== JSON.stringify(input.result.operationReceipt)) {
            return Object.freeze({ status: "unavailable" as const })
          }
          if (!lease.deliveredOperationIds.has(receipt.operationId)) {
            rememberDeliveredOperation(lease, receipt.operationId)
            recordLocalSemanticRoot(lease.owner, lease, "saved-locally", receipt, frameDigest)
          }
          return Object.freeze({
            status: "accepted" as const,
            acceptedFrameDigest: frameDigest,
            projection: projectSnapshot(lease.owner, lease, snapshot),
          })
        })
      } catch {
        return Object.freeze({ status: "unavailable" as const })
      }
    },
    async submitAuthoritative(input) {
      const current = await documentEntry(input.ref)
      const operationId = deriveCanvasCommandOperationId({
        ref: current.ref,
        actor: input.actor,
        commandId: input.commandId,
      })
      const result = await submitCommand(current, undefined, input.caller, input.command, operationId, input.signal)
      return Object.freeze({
        operationReceipt: result.operationReceipt,
        projection: canvasDocumentFromSnapshot(result.snapshot),
        acceptedFrameDigest: result.acceptedFrameDigest,
      })
    },
    async queryAuthoritative(ref) {
      return authoritativeProjection(await (await documentEntry(ref)).document.query(requireCanvasSnapshot))
    },
    async undo(input) {
      const lease = requireLease(input.ref, input.sessionId)
      return exclusiveLease(lease, () => submitHistory(lease, "undo", input.commandId, input.signal))
    },
    async redo(input) {
      const lease = requireLease(input.ref, input.sessionId)
      return exclusiveLease(lease, () => submitHistory(lease, "redo", input.commandId, input.signal))
    },
    async flush(ref, sessionId) {
      if (sessionId === undefined) return (await documentEntry(ref)).document.flush()
      const lease = requireLease(ref, sessionId)
      await exclusiveLease(lease, () => lease.owner.document.flush())
    },
    async quiesceProject(scopeIdInput) {
      requireLive()
      const scopeId = normalizeScopeId(scopeIdInput)
      quiescedProjects.add(scopeId)
      const prefix = `${scopeId}\0`
      const selected = [...documents.entries()].filter(([key]) => key.startsWith(prefix))
      for (const [key] of selected) documents.delete(key)
      const settled = await Promise.allSettled(selected.map(([, promised]) => promised))
      const failures: unknown[] = []
      for (const result of settled) {
        if (result.status === "rejected") {
          // A failed lazy open owns no durable session or Project lease.
          continue
        }
        const current = result.value
        for (const lease of current.leases.values()) revokeLease(lease, "scope-change")
        try {
          await current.document.flush()
        } catch (error) {
          failures.push(error)
        } finally {
          current.unsubscribe()
          current.document.dispose()
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "Canvas Project quiescence could not flush every document")
      }
    },
    resumeProject(scopeIdInput) {
      requireLive()
      quiescedProjects.delete(normalizeScopeId(scopeIdInput))
    },
    subscribe(listener) {
      requireLive()
      if (typeof listener !== "function") throw new TypeError("Canvas session listener is required")
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async query(ref, query: CanvasNodeQuery = {}): Promise<CanvasApplicationQueryResult> {
      const current = await documentEntry(ref)
      const projection = canvasDocumentFromSnapshot(await current.document.query(requireCanvasSnapshot))
      return { nodes: queryCanvasNodes(projection, query), projection }
    },
    async submit(request): Promise<CanvasApplicationCommandResult> {
      const current = await trace(request.envelope.commandId, "session-acquire/open", () => documentEntry(request))
      const result = await submitApplicationCommand(current, undefined, request)
      return traceSync(request.envelope.commandId, result.operationReceipt.operationId, "post-root-projection", () => ({
        affectedNodeIds: result.affectedNodeIds,
        changed: true,
        createdNodeIds: result.createdNodeIds,
        ...(result.createdResourceNodeIds === undefined
          ? {}
          : { createdResourceNodeIds: result.createdResourceNodeIds }),
        document: canvasDocumentFromSnapshot(result.snapshot),
        operationReceipt: result.operationReceipt,
        acceptedFrameDigest: result.acceptedFrameDigest,
        warnings: [],
      }))
    },
    dispose() {
      if (disposed) return
      disposed = true
      listeners.clear()
      for (const lease of leases.values()) {
        lease.abort.abort(new DOMException("Canvas renderer session was disposed", "AbortError"))
        lease.undo.clear("unmount")
      }
      leases.clear()
      for (const promised of documents.values())
        void promised.then((value) => {
          value.unsubscribe()
          value.document.dispose()
        })
      documents.clear()
      quiescedProjects.clear()
    },
  }
  return Object.freeze(owner)

  async function documentEntry(refInput: CanvasDocumentRef): Promise<CanvasDocumentEntry> {
    requireLive()
    const ref = normalizeRef(refInput)
    if (quiescedProjects.has(ref.scopeId)) throw new Error("Canvas Project is quiesced")
    const key = refKey(ref)
    let promised = documents.get(key)
    if (!promised) {
      promised = openDocumentEntry(ref)
      documents.set(key, promised)
      void promised.catch(() => {
        if (documents.get(key) === promised) documents.delete(key)
      })
    }
    const entry = await promised
    if (quiescedProjects.has(ref.scopeId)) {
      if (documents.get(key) === promised) documents.delete(key)
      throw new Error("Canvas Project is quiesced")
    }
    return entry
  }

  async function openDocumentEntry(ref: CanvasDocumentRef): Promise<CanvasDocumentEntry> {
    const document = await options.openDocumentSession(ref)
    const entry = { ref, document, leases: new Map<Id128, CanvasRendererLease>() } as Omit<
      CanvasDocumentEntry,
      "unsubscribe"
    > & { unsubscribe?: () => void }
    entry.unsubscribe = document.subscribe((event) => publishDocument(entry as CanvasDocumentEntry, event.frameDigest))
    return Object.freeze({ ...entry, unsubscribe: entry.unsubscribe }) as CanvasDocumentEntry
  }

  async function submitCommand(
    current: CanvasDocumentEntry,
    lease: CanvasRendererLease | undefined,
    caller: CanvasIntentCaller,
    command: CanvasAuthoritativeCommand,
    operationId: Id128 | undefined,
    signal: AbortSignal | undefined,
  ): Promise<
    Readonly<{ operationReceipt: BoundedOperationReceipt; snapshot: CanvasSnapshot; acceptedFrameDigest: Digest }>
  > {
    const committed = await current.document.submit({
      operationId,
      signal,
      prepare: ({ base, context, signal: attemptSignal }) =>
        prepareCanvasCommand(current, requireCanvasSnapshot(base), context, command, attemptSignal),
    })
    const result = await resultForCommit(
      current,
      committed.frame.header.core.actorId,
      committed.frame.header.core.operationId,
    )
    recordLocalSemanticRoot(
      current,
      caller === "ui" ? lease : undefined,
      committed.status,
      result.operationReceipt,
      committed.frame.frameDigest,
    )
    return Object.freeze({ ...result, acceptedFrameDigest: committed.frame.frameDigest })
  }

  async function submitApplicationCommand(
    current: CanvasDocumentEntry,
    lease: CanvasRendererLease | undefined,
    request: CanvasApplicationCommandRequest,
  ): Promise<
    Readonly<{
      affectedNodeIds: string[]
      changed: true
      createdNodeIds: string[]
      createdResourceNodeIds?: readonly string[]
      operationReceipt: BoundedOperationReceipt
      snapshot: CanvasSnapshot
      acceptedFrameDigest: Digest
      warnings: string[]
    }>
  > {
    let beforeIds = new Set<string>()
    let orderedCreatedNodeIds: readonly string[] | undefined
    let caller: CanvasIntentCaller | undefined
    const operationId = deriveCanvasCommandOperationId({
      ref: request,
      actor: request.envelope.actor,
      commandId: request.envelope.commandId,
    })
    const committed = await trace(request.envelope.commandId, "kernel-root", () =>
      current.document.submit({
        operationId,
        signal: request.signal,
        prepare: async ({ base, context, signal }) => {
          const snapshot = requireCanvasSnapshot(base)
          const adapted = traceSync(
            request.envelope.commandId,
            operationId,
            "command-adapter-prepare",
            () => options.applicationCommands.construct({ request, snapshot, context }),
            { edges: snapshot.edges.size, nodes: snapshot.nodes.size },
          )
          if (adapted === "rejected") {
            console.error("Canvas application command mapping rejected", JSON.stringify(request.envelope.command))
            throw new Error("Canvas application command has no frozen authoritative mapping")
          }
          // resources-create has only expected-absent derived node/edge results;
          // its receipt therefore already is the exact created-entity set. Avoid
          // projecting the whole pre-commit Canvas solely to rediscover that set.
          const resourcesCreate = adapted.command.kind === "resources-create"
          if (!resourcesCreate) {
            beforeIds = new Set(projectCanvas(snapshot).nodes.map((node) => node.ref.id))
          }
          caller = adapted.caller
          const prepared = await prepareCanvasCommand(current, snapshot, context, adapted.command, signal)
          if (resourcesCreate) {
            if (prepared.typedIntent.kind !== "canvas.resources.add") {
              throw new Error("Canvas resource command did not construct its closed resource intent")
            }
            orderedCreatedNodeIds = Object.freeze(prepared.typedIntent.body.nodes.map((node) => node.nodeId))
          }
          return prepared
        },
      }),
    )
    const result = await trace(
      request.envelope.commandId,
      "post-root-receipt-lookup",
      () => resultForCommit(current, committed.frame.header.core.actorId, committed.frame.header.core.operationId),
      operationId,
    )
    recordLocalSemanticRoot(
      current,
      caller === "ui" ? lease : undefined,
      committed.status,
      result.operationReceipt,
      committed.frame.frameDigest,
    )
    const receiptNodeIds = result.operationReceipt.resultEntities
      .filter((entity) => entity.kind === "node")
      .map((entity) => entity.id)
    const receiptNodeIdSet = new Set(receiptNodeIds)
    const createdResourceNodeIds =
      orderedCreatedNodeIds !== undefined &&
      receiptNodeIds.length === receiptNodeIdSet.size &&
      orderedCreatedNodeIds.length === receiptNodeIdSet.size &&
      orderedCreatedNodeIds.every((nodeId) => receiptNodeIdSet.has(nodeId))
        ? orderedCreatedNodeIds
        : undefined
    if (orderedCreatedNodeIds !== undefined && createdResourceNodeIds === undefined) {
      console.error("Canvas resource receipt does not match the constructed resource ordinals")
    }
    const createdNodeIds = createdResourceNodeIds ?? (orderedCreatedNodeIds !== undefined
      ? receiptNodeIds
      : canvasDocumentFromSnapshot(result.snapshot)
          .nodes.map((node) => node.id)
          .filter((id) => !beforeIds.has(id)))
    return Object.freeze({
      affectedNodeIds: result.operationReceipt.resultEntities
        .filter((entity) => entity.kind === "node")
        .map((entity) => entity.id),
      changed: true,
      createdNodeIds: [...createdNodeIds],
      ...(createdResourceNodeIds === undefined ? {} : { createdResourceNodeIds }),
      operationReceipt: result.operationReceipt,
      snapshot: result.snapshot,
      acceptedFrameDigest: committed.frame.frameDigest,
      warnings: [],
    })
  }

  async function trace<T>(
    _commandId: string,
    stage: import("@convax/canvas/application").CanvasSubmitDiagnosticStage,
    operation: () => Promise<T>,
    _operationId?: string,
  ): Promise<T> {
    if (!options.diagnostics) return operation()
    const startedAt = performance.now()
    try {
      return await operation()
    } finally {
      try {
        options.diagnostics.record({
          callCount: 1,
          durationMs: performance.now() - startedAt,
          stage,
        })
      } catch {}
    }
  }

  function traceSync<T>(
    _commandId: string,
    _operationId: string,
    stage: import("@convax/canvas/application").CanvasSubmitDiagnosticStage,
    operation: () => T,
    sizes?: Readonly<Record<string, number>>,
  ): T {
    if (!options.diagnostics) return operation()
    const startedAt = performance.now()
    try {
      return operation()
    } finally {
      try {
        options.diagnostics.record({
          callCount: 1,
          durationMs: performance.now() - startedAt,
          ...(sizes ? { sizes } : {}),
          stage,
        })
      } catch {}
    }
  }

  function recordLocalSemanticRoot(
    current: CanvasDocumentEntry,
    originatingLease: CanvasRendererLease | undefined,
    commitStatus: "saved-locally" | "duplicate" | "recovered-final-frame",
    receipt: BoundedOperationReceipt,
    frameDigest: Digest,
  ): void {
    if (commitStatus === "duplicate" || !receipt.semanticRoot) return
    const targets = originatingLease ? [originatingLease] : []
    for (const target of targets) {
      try {
        target.undo.recordDurableRoot(receipt.operationId)
      } catch {
        // The document commit is already durable. A concurrent/stale transient
        // cursor cannot turn success into failure; fail closed by dropping only
        // this mounted session's non-durable history.
        target.undo.clear("post-commit-cursor-failure")
      }
      publishLease(target, frameDigest)
    }
  }

  async function prepareCanvasCommand(
    current: CanvasDocumentEntry,
    snapshot: CanvasSnapshot,
    context: OwnerIntentConstructionContext,
    command: CanvasAuthoritativeCommand,
    signal?: AbortSignal,
  ) {
    const constructed = constructCanvasAuthoritativeIntent({ snapshot, context, command })
    if (constructed === "rejected") throw new Error("Canvas authoritative command construction is rejected")
    const facts = await options.resolveFacts({
      ref: current.ref,
      scope: current.document.scope,
      dependencies: constructed.dependencies,
      signal,
    })
    if (facts.status !== "resolved") throw new Error(`Canvas fact resolution is ${facts.status}`)
    return { typedIntent: constructed.intent, externalFacts: facts.port }
  }

  async function submitHistory(
    lease: CanvasRendererLease,
    direction: "undo" | "redo",
    commandId: string,
    signal?: AbortSignal,
  ): Promise<CanvasRendererSubmitResult | null> {
    const operationId = deriveCanvasCommandOperationId({ ref: lease.owner.ref, actor: lease.actor, commandId })
    const currentCursor = direction === "undo" ? lease.undo.peekUndo() : lease.undo.peekRedo()
    if (!currentCursor) {
      return lease.historyResponses.get(operationId) ?? null
    }
    const cursorHolder: { value: ReturnType<TransientSessionUndoCoordinator["peekUndo"]> } = { value: null }
    const committed = await lease.owner.document.submit({
      operationId,
      signal: leaseSignal(lease, signal),
      prepare: async ({ base, context, signal: attemptSignal }) => {
        const cursor = direction === "undo" ? lease.undo.peekUndo() : lease.undo.peekRedo()
        if (!cursor) throw new Error(`Canvas ${direction} has no session-local semantic root`)
        cursorHolder.value = cursor
        const snapshot = requireCanvasSnapshot(base)
        const dependencies = discoverCanvasHistoryIntentDependencies({
          snapshot,
          context,
          direction,
          rootOperationId: cursor.rootOperationId,
        })
        if (dependencies === "rejected") throw new Error("Canvas history dependency discovery is rejected")
        const facts = await options.resolveFacts({
          ref: lease.owner.ref,
          scope: lease.owner.document.scope,
          dependencies,
          signal: attemptSignal,
        })
        if (facts.status !== "resolved") throw new Error(`Canvas history fact resolution is ${facts.status}`)
        const constructed = constructCanvasHistoryIntent({
          snapshot,
          context,
          direction,
          rootOperationId: cursor.rootOperationId,
          externalFacts: facts.port,
        })
        if (typeof constructed === "string") throw new Error(`Canvas history construction is ${constructed}`)
        return { typedIntent: constructed.intent, externalFacts: facts.port }
      },
    })
    if (committed.status !== "duplicate") {
      const cursor = cursorHolder.value
      if (!cursor) throw new Error(`Canvas ${direction} committed without a session cursor`)
      if (direction === "undo") lease.undo.commitUndo(cursor.cursorToken, operationId)
      else lease.undo.commitRedo(cursor.cursorToken, operationId)
    }
    const result = await resultForCommit(
      lease.owner,
      committed.frame.header.core.actorId,
      committed.frame.header.core.operationId,
    )
    const transition = [...result.snapshot.semanticHistory.values()].find(
      (value) =>
        value.format === "convax.canvas-semantic-history-transition" &&
        value.transitionOperationId === committed.frame.header.core.operationId,
    )
    if (
      !transition ||
      transition.format !== "convax.canvas-semantic-history-transition" ||
      transition.mode !== (direction === "undo" ? "undone" : "redone")
    ) {
      throw new Error(`Canvas ${direction} committed without its actual semantic history transition`)
    }
    const response = Object.freeze({
      operationReceipt: result.operationReceipt,
      projection: projectSnapshot(lease.owner, lease, result.snapshot),
      acceptedFrameDigest: committed.frame.frameDigest,
      historyTransition: Object.freeze({ direction, rootOperationId: transition.rootOperationId }),
    })
    lease.historyResponses.set(operationId, response)
    while (lease.historyResponses.size > 64) lease.historyResponses.delete(lease.historyResponses.keys().next().value!)
    publishLease(lease, committed.frame.frameDigest)
    return response
  }

  async function resultForCommit(
    current: CanvasDocumentEntry,
    actorId: import("@convax/collaboration").ActorId,
    operationId: Id128,
  ): Promise<Readonly<{ operationReceipt: BoundedOperationReceipt; snapshot: CanvasSnapshot }>> {
    const snapshot = await current.document.query(requireCanvasSnapshot)
    const receipt = canvasOperationReceipt(snapshot, actorId, operationId)
    if (!receipt) throw new Error("Durable Canvas operation receipt is absent from the authoritative projection")
    return Object.freeze({ operationReceipt: structuredClone(receipt), snapshot })
  }

  async function projectLease(lease: CanvasRendererLease): Promise<CanvasSessionProjectionDto> {
    return projectSnapshot(lease.owner, lease, await lease.owner.document.query(requireCanvasSnapshot))
  }

  function projectSnapshot(
    current: CanvasDocumentEntry,
    lease: CanvasRendererLease,
    snapshot: CanvasSnapshot,
  ): CanvasSessionProjectionDto {
    const projected = cachedCanvasProjection(snapshot)
    return Object.freeze({
      format: "convax.canvas-session-projection",
      ref: current.ref,
      sessionId: lease.sessionId,
      document: structuredClone(projected.document),
      edgeEntities: projected.edgeEntities,
      nodeEntities: projected.nodeEntities,
      canUndo: lease.undo.getSnapshot().undo.length > 0,
      canRedo: lease.undo.getSnapshot().redo.length > 0,
    })
  }

  function publishLease(lease: CanvasRendererLease, frameDigest: Digest): void {
    const event = Object.freeze({
      format: "convax.canvas-session-invalidation" as const,
      ref: lease.owner.ref,
      sessionId: lease.sessionId,
      frameDigest,
    })
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        /* Invalidation failure cannot reverse durability. */
      }
    }
  }

  function publishDocument(current: CanvasDocumentEntry, frameDigest: Digest): void {
    for (const lease of current.leases.values()) publishLease(lease, frameDigest)
  }

  function createLease(current: CanvasDocumentEntry, actorInput: CanvasCommandActor): CanvasRendererLease {
    const actor = normalizeActor(actorInput)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const sessionId = parseId128(options.createSessionId())
      if (leases.has(sessionId)) continue
      const lease = Object.freeze({
        owner: current,
        sessionId,
        actor,
        undo: new TransientSessionUndoCoordinator({ createCursorToken: options.createCursorToken }),
        abort: new AbortController(),
        historyResponses: new Map<Id128, CanvasRendererSubmitResult>(),
        deliveredOperationIds: new Set<Id128>(),
      })
      current.leases.set(sessionId, lease)
      leases.set(sessionId, lease)
      leaseLanes.set(lease, Promise.resolve())
      return lease
    }
    throw new Error("Canvas renderer session identity allocation exhausted")
  }

  function requireLease(refInput: CanvasDocumentRef, sessionIdInput: Id128): CanvasRendererLease {
    requireLive()
    const ref = normalizeRef(refInput)
    const sessionId = parseId128(sessionIdInput)
    const lease = leases.get(sessionId)
    if (!lease || refKey(lease.owner.ref) !== refKey(ref)) throw new Error("Canvas renderer session is stale")
    return lease
  }

  function rememberDeliveredOperation(lease: CanvasRendererLease, operationId: Id128): void {
    lease.deliveredOperationIds.add(operationId)
    while (lease.deliveredOperationIds.size > 64) {
      lease.deliveredOperationIds.delete(lease.deliveredOperationIds.values().next().value!)
    }
  }

  function revokeLease(lease: CanvasRendererLease, reason: "unmount" | "scope-change"): void {
    lease.abort.abort(new DOMException("Canvas renderer session was closed", "AbortError"))
    lease.undo.clear(reason)
    lease.owner.leases.delete(lease.sessionId)
    leases.delete(lease.sessionId)
    leaseLanes.delete(lease)
  }

  function exclusiveLease<T>(lease: CanvasRendererLease, operation: () => Promise<T>): Promise<T> {
    const prior = leaseLanes.get(lease)
    if (!prior) return Promise.reject(new Error("Canvas renderer session is stale"))
    const current = prior.then(() => {
      if (!leaseLanes.has(lease)) throw new Error("Canvas renderer session is stale")
      return operation()
    })
    leaseLanes.set(
      lease,
      current.then(
        () => undefined,
        () => undefined,
      ),
    )
    return current
  }

  function requireLive(): void {
    if (disposed) throw new Error("Canvas collaboration session owner is disposed")
  }
}

function requireCanvasSnapshot(state: OwnerValidatedState<"canvas">): CanvasSnapshot {
  const snapshot = canvasSnapshotFromValidatedOwnerState(state)
  if (!snapshot) throw new Error("Selected Canvas owner returned an invalid validated snapshot")
  return snapshot
}

function canvasDocumentFromSnapshot(snapshot: CanvasSnapshot): CanvasDocument {
  return structuredClone(cachedCanvasProjection(snapshot).document)
}

function authoritativeProjection(snapshot: CanvasSnapshot): CanvasAuthoritativeProjection {
  const projected = cachedCanvasProjection(snapshot)
  return Object.freeze({
    document: structuredClone(projected.document),
    edgeEntities: projected.edgeEntities,
    nodeEntities: projected.nodeEntities,
  })
}

function cachedCanvasProjection(snapshot: CanvasSnapshot): CachedCanvasProjection {
  const existing = cachedCanvasProjections.get(snapshot)
  if (existing !== undefined) return existing
  const projected = projectCanvasDocument(projectCanvas(snapshot))
  const nodeEntities = Object.freeze(
    [...projected.nodeEntities.entries()].map(([nodeId, entity]) =>
      Object.freeze({ nodeId, entity: Object.freeze({ ...entity }) }),
    ),
  )
  const value = Object.freeze({
    document: projected.document,
    edgeEntities: Object.freeze(
      [...projected.edgeEntities.entries()].map(([edgeId, entity]) =>
        Object.freeze({ edgeId, entity: Object.freeze({ ...entity }) }),
      ),
    ),
    nodeEntities,
    nodesById: new Map(projected.document.nodes.map((node) => [node.id, node])),
    nodeEntitiesById: new Map(nodeEntities.map(({ nodeId, entity }) => [nodeId, entity])),
  })
  cachedCanvasProjections.set(snapshot, value)
  return value
}

function normalizeActor(actor: CanvasCommandActor): CanvasCommandActor {
  if (!actor || typeof actor !== "object" || typeof actor.id !== "string" || typeof actor.kind !== "string") {
    throw new TypeError("Canvas renderer actor is invalid")
  }
  // The Canvas-owned operation-id derivation performs the exact bounded/NFC checks.
  deriveCanvasCommandOperationId({
    ref: { scopeId: "actor-validation", canvasId: "actor-validation" },
    actor,
    commandId: "actor-validation",
  })
  return Object.freeze({ id: actor.id, kind: actor.kind })
}

function leaseSignal(lease: CanvasRendererLease, signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([lease.abort.signal, signal]) : lease.abort.signal
}

function normalizeRef(ref: CanvasDocumentRef): CanvasDocumentRef {
  const scopeId = normalizeScopeId(ref.scopeId)
  if (typeof ref.canvasId !== "string" || ref.canvasId.length < 1 || ref.canvasId.includes("\0"))
    throw new TypeError("Canvas id is invalid")
  return Object.freeze({ scopeId, canvasId: ref.canvasId })
}

function normalizeScopeId(scopeId: string): string {
  if (typeof scopeId !== "string" || scopeId.length < 1 || scopeId.includes("\0")) {
    throw new TypeError("Canvas scopeId is invalid")
  }
  return scopeId
}

function refKey(ref: CanvasDocumentRef): string {
  return `${ref.scopeId}\0${ref.canvasId}`
}
