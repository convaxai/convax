import {
  canvasSnapshotFromValidatedOwnerStateV2,
  constructCanvasAuthoritativeIntentV2,
  constructCanvasHistoryIntentV2,
  deriveCanvasCommandOperationIdV2,
  discoverCanvasHistoryIntentDependenciesV2,
  projectCanvasDocumentV2,
  projectCanvasV2,
  type BoundedOperationReceiptV2,
  type CanvasAuthoritativeCommandV2,
  type CanvasEntityRefV2,
  type CanvasIntentCallerV2,
  type CanvasRendererCommandV2,
  type CanvasSnapshotV2,
} from "@convax/canvas/collaboration"
import {
  queryCanvasNodes,
  type CanvasCommandActor,
  type CanvasApplicationCommandRequest,
  type CanvasApplicationCommandResult,
  type CanvasApplicationQueryResult,
  type CanvasCollaborationApplicationPort,
  type CanvasDocumentRef,
  type CanvasNodeQuery,
} from "@convax/canvas/application"
import type { CanvasDocument } from "@convax/canvas"
import {
  TransientSessionUndoCoordinatorV2,
  parseId128V2,
  type Id128V2,
  type DocumentScopeV2,
  type OwnerExternalFactPortV2,
  type OwnerIntentConstructionContextV2,
  type OwnerIntentDependenciesV2,
  type OwnerValidatedStateV2,
} from "@convax/collaboration"

import type { MainCollaborationDocumentSessionV2 } from "./collaboration-document-session"
import type {
  CanvasRendererSessionMutationResultV2,
  CanvasSessionInvalidationDtoV2,
  CanvasSessionProjectionDtoV2,
} from "../canvas-session-contracts"

export type {
  CanvasSessionInvalidationDtoV2,
  CanvasSessionProjectionDtoV2,
} from "../canvas-session-contracts"

export interface CanvasAuthoritativeSubmitResultV2 {
  readonly operationReceipt: BoundedOperationReceiptV2
  readonly projection: CanvasDocument
}

export interface CanvasAuthoritativeProjectionV2 {
  readonly document: CanvasDocument
  readonly nodeEntities: readonly Readonly<{
    readonly nodeId: string
    readonly entity: CanvasEntityRefV2 & { readonly kind: "node" }
  }>[]
}

export type CanvasRendererSubmitResultV2 = CanvasRendererSessionMutationResultV2

export interface CanvasApplicationCommandAdapterV2 {
  construct(input: {
    readonly request: CanvasApplicationCommandRequest
    readonly snapshot: CanvasSnapshotV2
    readonly context: OwnerIntentConstructionContextV2
  }): Readonly<{ caller: CanvasIntentCallerV2; command: CanvasAuthoritativeCommandV2 }> | "rejected"
}

export type CanvasFactResolutionV2 =
  | Readonly<{ status: "resolved"; port: OwnerExternalFactPortV2<"canvas"> }>
  | Readonly<{ status: "pending" | "stale" | "rejected" }>

export interface CreateCanvasCollaborationSessionOwnerOptionsV2 {
  readonly createSessionId: () => Id128V2
  readonly createCursorToken: () => Id128V2
  readonly openDocumentSession: (
    ref: CanvasDocumentRef,
  ) => Promise<MainCollaborationDocumentSessionV2<"canvas">>
  readonly resolveFacts: (input: {
    readonly ref: CanvasDocumentRef
    readonly scope: DocumentScopeV2 & { readonly docKind: "canvas" }
    readonly dependencies: OwnerIntentDependenciesV2<"canvas">
    readonly signal?: AbortSignal
  }) => Promise<CanvasFactResolutionV2>
  readonly applicationCommands: CanvasApplicationCommandAdapterV2
}

export interface CanvasCollaborationSessionOwnerV2 extends CanvasCollaborationApplicationPort {
  open(input: { readonly ref: CanvasDocumentRef; readonly actor: CanvasCommandActor }): Promise<CanvasSessionProjectionDtoV2>
  close(input: { readonly ref: CanvasDocumentRef; readonly sessionId: Id128V2 }): void
  queryRenderer(ref: CanvasDocumentRef, sessionId: Id128V2): Promise<CanvasSessionProjectionDtoV2>
  submitRenderer(input: {
    readonly ref: CanvasDocumentRef
    readonly sessionId: Id128V2
    readonly commandId: string
    readonly command: CanvasRendererCommandV2
    readonly signal?: AbortSignal
  }): Promise<CanvasRendererSubmitResultV2>
  /** Main-only host surface; Plugin/renderer IPC must not expose it directly. */
  queryAuthoritative(ref: CanvasDocumentRef): Promise<CanvasAuthoritativeProjectionV2>
  /** Main-only host surface; Plugin/renderer IPC must not expose it directly. */
  submitAuthoritative(input: {
    readonly ref: CanvasDocumentRef
    readonly caller: CanvasIntentCallerV2
    readonly actor: CanvasCommandActor
    readonly commandId: string
    readonly command: CanvasAuthoritativeCommandV2
    readonly signal?: AbortSignal
  }): Promise<CanvasAuthoritativeSubmitResultV2>
  undo(input: { readonly ref: CanvasDocumentRef; readonly sessionId: Id128V2; readonly commandId: string; readonly signal?: AbortSignal }): Promise<CanvasRendererSubmitResultV2 | null>
  redo(input: { readonly ref: CanvasDocumentRef; readonly sessionId: Id128V2; readonly commandId: string; readonly signal?: AbortSignal }): Promise<CanvasRendererSubmitResultV2 | null>
  flush(ref: CanvasDocumentRef, sessionId?: Id128V2): Promise<void>
  /** Main-only reset barrier. No new session for this Project may open until resumed. */
  quiesceProject(scopeId: string): Promise<void>
  /** Re-enables lazy opens after the Project reset/open transition has completed. */
  resumeProject(scopeId: string): void
  subscribe(listener: (event: CanvasSessionInvalidationDtoV2) => void): () => void
  dispose(): void
}

interface CanvasDocumentEntryV2 {
  readonly ref: CanvasDocumentRef
  readonly document: MainCollaborationDocumentSessionV2<"canvas">
  readonly leases: Map<Id128V2, CanvasRendererLeaseV2>
  readonly unsubscribe: () => void
}

interface CanvasRendererLeaseV2 {
  readonly owner: CanvasDocumentEntryV2
  readonly sessionId: Id128V2
  readonly actor: CanvasCommandActor
  readonly undo: TransientSessionUndoCoordinatorV2
  readonly abort: AbortController
}

export function createCanvasCollaborationSessionOwnerV2(
  options: CreateCanvasCollaborationSessionOwnerOptionsV2,
): CanvasCollaborationSessionOwnerV2 {
  const documents = new Map<string, Promise<CanvasDocumentEntryV2>>()
  const leases = new Map<Id128V2, CanvasRendererLeaseV2>()
  const leaseLanes = new WeakMap<CanvasRendererLeaseV2, Promise<void>>()
  const listeners = new Set<(event: CanvasSessionInvalidationDtoV2) => void>()
  const quiescedProjects = new Set<string>()
  let disposed = false

  const owner: CanvasCollaborationSessionOwnerV2 = {
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
    async submitRenderer(input) {
      const lease = requireLease(input.ref, input.sessionId)
      return exclusiveLease(lease, async () => {
        const operationId = deriveCanvasCommandOperationIdV2({ ref: lease.owner.ref, actor: lease.actor, commandId: input.commandId })
        const result = await submitCommand(lease.owner, lease, "ui", { kind: "renderer", command: input.command }, operationId, leaseSignal(lease, input.signal))
        return Object.freeze({ operationReceipt: result.operationReceipt, projection: projectSnapshot(lease.owner, lease, result.snapshot) })
      })
    },
    async submitAuthoritative(input) {
      const current = await documentEntry(input.ref)
      const operationId = deriveCanvasCommandOperationIdV2({ ref: current.ref, actor: input.actor, commandId: input.commandId })
      const result = await submitCommand(current, undefined, input.caller, input.command, operationId, input.signal)
      return Object.freeze({ operationReceipt: result.operationReceipt, projection: canvasDocumentFromSnapshot(result.snapshot) })
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
      const current = await documentEntry(request)
      let beforeIds = new Set<string>()
      const committed = await current.document.submit({
        operationId: deriveCanvasCommandOperationIdV2({ ref: request, actor: request.envelope.actor, commandId: request.envelope.commandId }),
        signal: request.signal,
        prepare: async ({ base, context, signal }) => {
          const snapshot = requireCanvasSnapshot(base)
          beforeIds = new Set(projectCanvasV2(snapshot).nodes.map((node) => node.ref.id))
          const adapted = options.applicationCommands.construct({ request, snapshot, context })
          if (adapted === "rejected") throw new Error("Canvas application command has no frozen authoritative mapping")
          return prepareCanvasCommand(current, snapshot, context, adapted.command, signal)
        },
      })
      const result = await resultForCommit(current, committed.frame.header.core.operationId)
      recordLocalSemanticRoot(current, undefined, committed.status, result.operationReceipt)
      const affectedNodeIds = result.operationReceipt.resultEntities.filter((entity) => entity.kind === "node").map((entity) => entity.id)
      return {
        affectedNodeIds,
        changed: true,
        createdNodeIds: canvasDocumentFromSnapshot(result.snapshot).nodes.map((node) => node.id).filter((id) => !beforeIds.has(id)),
        document: canvasDocumentFromSnapshot(result.snapshot),
        operationReceipt: result.operationReceipt,
        warnings: [],
      }
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
      for (const promised of documents.values()) void promised.then((value) => {
        value.unsubscribe()
        value.document.dispose()
      })
      documents.clear()
      quiescedProjects.clear()
    },
  }
  return Object.freeze(owner)

  async function documentEntry(refInput: CanvasDocumentRef): Promise<CanvasDocumentEntryV2> {
    requireLive()
    const ref = normalizeRef(refInput)
    if (quiescedProjects.has(ref.scopeId)) throw new Error("Canvas Project is quiesced")
    const key = refKey(ref)
    let promised = documents.get(key)
    if (!promised) {
      promised = openDocumentEntry(ref)
      documents.set(key, promised)
      void promised.catch(() => { if (documents.get(key) === promised) documents.delete(key) })
    }
    const entry = await promised
    if (quiescedProjects.has(ref.scopeId)) {
      if (documents.get(key) === promised) documents.delete(key)
      throw new Error("Canvas Project is quiesced")
    }
    return entry
  }

  async function openDocumentEntry(ref: CanvasDocumentRef): Promise<CanvasDocumentEntryV2> {
    const document = await options.openDocumentSession(ref)
    const entry = { ref, document, leases: new Map<Id128V2, CanvasRendererLeaseV2>() } as
      Omit<CanvasDocumentEntryV2, "unsubscribe"> & { unsubscribe?: () => void }
    entry.unsubscribe = document.subscribe(() => publishDocument(entry as CanvasDocumentEntryV2))
    return Object.freeze({ ...entry, unsubscribe: entry.unsubscribe }) as CanvasDocumentEntryV2
  }

  async function submitCommand(
    current: CanvasDocumentEntryV2,
    lease: CanvasRendererLeaseV2 | undefined,
    caller: CanvasIntentCallerV2,
    command: CanvasAuthoritativeCommandV2,
    operationId: Id128V2 | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Readonly<{ operationReceipt: BoundedOperationReceiptV2; snapshot: CanvasSnapshotV2 }>> {
    const committed = await current.document.submit({
      operationId,
      signal,
      prepare: ({ base, context, signal: attemptSignal }) =>
        prepareCanvasCommand(current, requireCanvasSnapshot(base), context, command, attemptSignal),
    })
    const result = await resultForCommit(current, committed.frame.header.core.operationId)
    recordLocalSemanticRoot(current, caller === "ui" ? lease : undefined, committed.status, result.operationReceipt)
    return result
  }

  function recordLocalSemanticRoot(
    current: CanvasDocumentEntryV2,
    originatingLease: CanvasRendererLeaseV2 | undefined,
    commitStatus: "saved-locally" | "duplicate" | "recovered-final-frame",
    receipt: BoundedOperationReceiptV2,
  ): void {
    if (commitStatus === "duplicate" || !receipt.semanticRoot) return
    const targets = originatingLease ? [originatingLease] : [...current.leases.values()]
    for (const target of targets) {
      try {
        target.undo.recordDurableRoot(receipt.operationId)
      } catch {
        // The document commit is already durable. A concurrent/stale transient
        // cursor cannot turn success into failure; fail closed by dropping only
        // this mounted session's non-durable history.
        target.undo.clear("post-commit-cursor-failure")
      }
      publishLease(target)
    }
  }

  async function prepareCanvasCommand(
    current: CanvasDocumentEntryV2,
    snapshot: CanvasSnapshotV2,
    context: OwnerIntentConstructionContextV2,
    command: CanvasAuthoritativeCommandV2,
    signal?: AbortSignal,
  ) {
    const constructed = constructCanvasAuthoritativeIntentV2({ snapshot, context, command })
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
    lease: CanvasRendererLeaseV2,
    direction: "undo" | "redo",
    commandId: string,
    signal?: AbortSignal,
  ): Promise<CanvasRendererSubmitResultV2 | null> {
    const operationId = deriveCanvasCommandOperationIdV2({ ref: lease.owner.ref, actor: lease.actor, commandId })
    const currentCursor = direction === "undo" ? lease.undo.peekUndo() : lease.undo.peekRedo()
    if (!currentCursor) {
      const existing = await resultForOperationIfPresent(lease.owner, operationId)
      return existing
        ? Object.freeze({ operationReceipt: existing.operationReceipt, projection: projectSnapshot(lease.owner, lease, existing.snapshot) })
        : null
    }
    const cursorHolder: { value: ReturnType<TransientSessionUndoCoordinatorV2["peekUndo"]> } = { value: null }
    const committed = await lease.owner.document.submit({
      operationId,
      signal: leaseSignal(lease, signal),
      prepare: async ({ base, context, signal: attemptSignal }) => {
        const cursor = direction === "undo" ? lease.undo.peekUndo() : lease.undo.peekRedo()
        if (!cursor) throw new Error(`Canvas ${direction} has no session-local semantic root`)
        cursorHolder.value = cursor
        const snapshot = requireCanvasSnapshot(base)
        const dependencies = discoverCanvasHistoryIntentDependenciesV2({
          snapshot, context, direction, rootOperationId: cursor.rootOperationId,
        })
        if (dependencies === "rejected") throw new Error("Canvas history dependency discovery is rejected")
        const facts = await options.resolveFacts({
          ref: lease.owner.ref,
          scope: lease.owner.document.scope,
          dependencies,
          signal: attemptSignal,
        })
        if (facts.status !== "resolved") throw new Error(`Canvas history fact resolution is ${facts.status}`)
        const constructed = constructCanvasHistoryIntentV2({
          snapshot, context, direction, rootOperationId: cursor.rootOperationId, externalFacts: facts.port,
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
    const result = await resultForCommit(lease.owner, committed.frame.header.core.operationId)
    publishLease(lease)
    return Object.freeze({ operationReceipt: result.operationReceipt, projection: projectSnapshot(lease.owner, lease, result.snapshot) })
  }

  async function resultForCommit(current: CanvasDocumentEntryV2, operationId: Id128V2): Promise<Readonly<{ operationReceipt: BoundedOperationReceiptV2; snapshot: CanvasSnapshotV2 }>> {
    const snapshot = await current.document.query(requireCanvasSnapshot)
    const receipt = [...snapshot.operations.values()].find((candidate) => candidate.operationId === operationId)
    if (!receipt) throw new Error("Durable Canvas operation receipt is absent from the authoritative projection")
    return Object.freeze({ operationReceipt: structuredClone(receipt), snapshot })
  }

  async function resultForOperationIfPresent(current: CanvasDocumentEntryV2, operationId: Id128V2): Promise<Readonly<{ operationReceipt: BoundedOperationReceiptV2; snapshot: CanvasSnapshotV2 }> | null> {
    const snapshot = await current.document.query(requireCanvasSnapshot)
    const receipt = [...snapshot.operations.values()].find((candidate) => candidate.operationId === operationId)
    return receipt ? Object.freeze({ operationReceipt: structuredClone(receipt), snapshot }) : null
  }

  async function projectLease(lease: CanvasRendererLeaseV2): Promise<CanvasSessionProjectionDtoV2> {
    return projectSnapshot(lease.owner, lease, await lease.owner.document.query(requireCanvasSnapshot))
  }

  function projectSnapshot(current: CanvasDocumentEntryV2, lease: CanvasRendererLeaseV2, snapshot: CanvasSnapshotV2): CanvasSessionProjectionDtoV2 {
    const projected = projectCanvasDocumentV2(projectCanvasV2(snapshot))
    return Object.freeze({
      format: "convax.canvas-session-projection/2",
      ref: current.ref,
      sessionId: lease.sessionId,
      document: structuredClone(projected.document),
      nodeEntities: Object.freeze([...projected.nodeEntities.entries()].map(([nodeId, entity]) =>
        Object.freeze({ nodeId, entity: Object.freeze({ ...entity }) }))),
      canUndo: lease.undo.getSnapshot().undo.length > 0,
      canRedo: lease.undo.getSnapshot().redo.length > 0,
    })
  }

  function publishLease(lease: CanvasRendererLeaseV2): void {
    const event = Object.freeze({ format: "convax.canvas-session-invalidation/2" as const, ref: lease.owner.ref, sessionId: lease.sessionId })
    for (const listener of listeners) {
      try { listener(event) } catch { /* Invalidation failure cannot reverse durability. */ }
    }
  }

  function publishDocument(current: CanvasDocumentEntryV2): void {
    for (const lease of current.leases.values()) publishLease(lease)
  }

  function createLease(current: CanvasDocumentEntryV2, actorInput: CanvasCommandActor): CanvasRendererLeaseV2 {
    const actor = normalizeActor(actorInput)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const sessionId = parseId128V2(options.createSessionId())
      if (leases.has(sessionId)) continue
      const lease = Object.freeze({
        owner: current,
        sessionId,
        actor,
        undo: new TransientSessionUndoCoordinatorV2({ createCursorToken: options.createCursorToken }),
        abort: new AbortController(),
      })
      current.leases.set(sessionId, lease)
      leases.set(sessionId, lease)
      leaseLanes.set(lease, Promise.resolve())
      return lease
    }
    throw new Error("Canvas renderer session identity allocation exhausted")
  }

  function requireLease(refInput: CanvasDocumentRef, sessionIdInput: Id128V2): CanvasRendererLeaseV2 {
    requireLive()
    const ref = normalizeRef(refInput)
    const sessionId = parseId128V2(sessionIdInput)
    const lease = leases.get(sessionId)
    if (!lease || refKey(lease.owner.ref) !== refKey(ref)) throw new Error("Canvas renderer session is stale")
    return lease
  }

  function revokeLease(lease: CanvasRendererLeaseV2, reason: "unmount" | "scope-change"): void {
    lease.abort.abort(new DOMException("Canvas renderer session was closed", "AbortError"))
    lease.undo.clear(reason)
    lease.owner.leases.delete(lease.sessionId)
    leases.delete(lease.sessionId)
    leaseLanes.delete(lease)
  }

  function exclusiveLease<T>(lease: CanvasRendererLeaseV2, operation: () => Promise<T>): Promise<T> {
    const prior = leaseLanes.get(lease)
    if (!prior) return Promise.reject(new Error("Canvas renderer session is stale"))
    const current = prior.then(() => {
      if (!leaseLanes.has(lease)) throw new Error("Canvas renderer session is stale")
      return operation()
    })
    leaseLanes.set(lease, current.then(() => undefined, () => undefined))
    return current
  }

  function requireLive(): void {
    if (disposed) throw new Error("Canvas collaboration session owner is disposed")
  }
}

function requireCanvasSnapshot(state: OwnerValidatedStateV2<"canvas">): CanvasSnapshotV2 {
  const snapshot = canvasSnapshotFromValidatedOwnerStateV2(state)
  if (!snapshot) throw new Error("Selected Canvas owner returned an invalid validated snapshot")
  return snapshot
}

function canvasDocumentFromSnapshot(snapshot: CanvasSnapshotV2): CanvasDocument {
  return structuredClone(projectCanvasDocumentV2(projectCanvasV2(snapshot)).document)
}

function authoritativeProjection(snapshot: CanvasSnapshotV2): CanvasAuthoritativeProjectionV2 {
  const projected = projectCanvasDocumentV2(projectCanvasV2(snapshot))
  return Object.freeze({
    document: structuredClone(projected.document),
    nodeEntities: Object.freeze([...projected.nodeEntities.entries()].map(([nodeId, entity]) =>
      Object.freeze({ nodeId, entity: Object.freeze({ ...entity }) }))),
  })
}

function normalizeActor(actor: CanvasCommandActor): CanvasCommandActor {
  if (!actor || typeof actor !== "object" || typeof actor.id !== "string" || typeof actor.kind !== "string") {
    throw new TypeError("Canvas renderer actor is invalid")
  }
  // The Canvas-owned operation-id derivation performs the exact bounded/NFC checks.
  deriveCanvasCommandOperationIdV2({
    ref: { scopeId: "actor-validation", canvasId: "actor-validation" },
    actor,
    commandId: "actor-validation",
  })
  return Object.freeze({ id: actor.id, kind: actor.kind })
}

function leaseSignal(lease: CanvasRendererLeaseV2, signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([lease.abort.signal, signal]) : lease.abort.signal
}

function normalizeRef(ref: CanvasDocumentRef): CanvasDocumentRef {
  const scopeId = normalizeScopeId(ref.scopeId)
  if (typeof ref.canvasId !== "string" || ref.canvasId.length < 1 || ref.canvasId.includes("\0")) throw new TypeError("Canvas id is invalid")
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
