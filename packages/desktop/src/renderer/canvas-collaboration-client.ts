import type {
  BoundedOperationReceipt,
  CanvasEntityRef,
  CanvasRendererCollaborationClient,
  CanvasRendererCommand,
} from "@convax/canvas/collaboration"
import type { CanvasApplicationCommand, CanvasApplicationCommandResult } from "@convax/canvas/application"
import type { CanvasDocument } from "@convax/canvas/core"
import { CanvasVisualHistoryCoordinator, type CanvasVisualHistoryAuthority } from "@convax/canvas/view"
import type { CanvasDocumentRef } from "@convax/canvas/application"
import type { Digest } from "@convax/collaboration"
import type { CanvasResourceAddResult, CanvasResourceRelinkResult } from "../desktop-protocol"
import type {
  CanvasRendererSessionTransport,
  CanvasRendererApplicationMutationResult,
  CanvasSessionInvalidationDto,
  CanvasSessionProjectionDto,
} from "../canvas-session-contracts"

export interface DesktopCanvasRendererSession extends CanvasRendererCollaborationClient {
  readonly ref: CanvasDocumentRef
  readonly sessionId: CanvasSessionProjectionDto["sessionId"]
  acceptApplicationMutation(
    result: CanvasRendererApplicationMutationResult,
    signal?: AbortSignal,
  ): Promise<CanvasApplicationCommandResult>
  runResourceMutation<T extends CanvasResourceAddResult | CanvasResourceRelinkResult>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<Readonly<{ result: T; projectionDelivered: boolean }>>
  dispose(): void
}

const maximumRememberedFrameDigests = 64

export async function openDesktopCanvasRendererSession(input: {
  readonly createCommandId?: () => string
  readonly ref: CanvasDocumentRef
  readonly transport: CanvasRendererSessionTransport
  readonly signal?: AbortSignal
}): Promise<DesktopCanvasRendererSession> {
  throwIfAborted(input.signal)
  const initial = await input.transport.open(input.ref)
  try {
    throwIfAborted(input.signal)
    return new MountedDesktopCanvasRendererSession(
      input.ref,
      input.transport,
      initial,
      input.createCommandId ?? (() => `renderer:${globalThis.crypto.randomUUID()}`),
    )
  } catch (error) {
    try {
      await input.transport.close({ ref: input.ref, sessionId: initial.sessionId })
    } catch {
      // Preserve the mount/validation failure; Main also revokes on renderer destruction.
    }
    throw error
  }
}

class MountedDesktopCanvasRendererSession implements DesktopCanvasRendererSession {
  readonly authority = "project-collaboration-application" as const
  readonly undoModel = "project-yjs-semantic-history" as const
  readonly ref: CanvasDocumentRef
  readonly #transport: CanvasRendererSessionTransport
  readonly #createCommandId: () => string
  readonly #listeners = new Set<() => void>()
  readonly #entities = new Map<string, CanvasEntityRef & { readonly kind: "node" }>()
  readonly #edgeEntities = new Map<string, CanvasEntityRef & { readonly kind: "edge" }>()
  readonly #unsubscribe: () => void
  #snapshot: CanvasSessionProjectionDto
  #lane: Promise<void> = Promise.resolve()
  #disposed = false
  #refreshScheduled = false
  readonly #pendingInvalidationDigests = new Set<Digest>()
  readonly #coveredFrameDigests = new Set<Digest>()
  readonly #visualHistory = new CanvasVisualHistoryCoordinator()
  readonly visualOverlay = this.#visualHistory.overlay

  constructor(
    ref: CanvasDocumentRef,
    transport: CanvasRendererSessionTransport,
    initial: CanvasSessionProjectionDto,
    createCommandId: () => string,
  ) {
    this.ref = Object.freeze({ ...ref })
    this.#transport = transport
    this.#createCommandId = createCommandId
    this.#snapshot = requireProjection(this.ref, initial)
    this.#replaceEntities(initial)
    this.#unsubscribe = transport.subscribe((event) => this.#onInvalidation(event))
  }

  getProjection(): CanvasDocument {
    return this.#snapshot.document
  }

  resolveNodeEntity(nodeId: string) {
    return this.#entities.get(nodeId)
  }

  resolveEdgeEntity(edgeId: string) {
    return this.#edgeEntities.get(edgeId)
  }

  subscribe(listener: () => void): () => void {
    this.#assertLive()
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  canUndo(): boolean {
    return this.#visualHistory.canUndo() || this.#snapshot.canUndo
  }

  canRedo(): boolean {
    return this.#visualHistory.canRedo() || this.#snapshot.canRedo
  }

  get sessionId() {
    return this.#snapshot.sessionId
  }

  submit(command: CanvasRendererCommand, signal?: AbortSignal): Promise<void> {
    const commandId = this.#createCommandId()
    const before = this.#visualAuthority()
    const stagedRoot = this.#visualHistory.stageRendererCommand(commandId, command, before)
    if (stagedRoot) this.#publish()
    return this.#enqueue(async () => {
      const durableBefore = this.#visualAuthority()
      try {
        throwIfAborted(signal)
        const result = await this.#transport.submit({ ...this.#scope(), command, commandId })
        // A returned mutation result is already durable. A late abort must not turn a
        // committed command into an apparent failure or skip its authoritative projection.
        this.#acceptMutation(result.projection, result.acceptedFrameDigest)
        this.#reconcileMutationRoot(stagedRoot, result.operationReceipt, durableBefore, this.#visualAuthority())
        this.#publish()
      } catch (error) {
        this.#visualHistory.rejectStagedRoot(stagedRoot)
        if (stagedRoot) this.#publish()
        throw error
      }
    })
  }

  executeApplication(command: CanvasApplicationCommand, signal?: AbortSignal): Promise<CanvasApplicationCommandResult> {
    const commandId = this.#createCommandId()
    const stagedRoot = this.#visualHistory.stagePendingRoot(commandId, this.#visualAuthority())
    if (stagedRoot) this.#publish()
    return this.#enqueue(async () => {
      const before = this.#visualAuthority()
      try {
        throwIfAborted(signal)
        const result = await this.#transport.executeApplication({ ...this.#scope(), command, commandId })
        // The transport only returns after the durable head barrier. Reconcile even when
        // the caller aborts while that barrier is completing.
        const accepted = this.#acceptApplicationMutation(result)
        this.#reconcileMutationRoot(stagedRoot, result.operationReceipt, before, this.#visualAuthority())
        this.#publish()
        return accepted
      } catch (error) {
        this.#visualHistory.rejectStagedRoot(stagedRoot)
        if (stagedRoot) this.#publish()
        throw error
      }
    })
  }

  undo(signal?: AbortSignal) {
    return this.#history("undo", signal)
  }

  redo(signal?: AbortSignal) {
    return this.#history("redo", signal)
  }

  flush(signal?: AbortSignal): Promise<void> {
    return this.#enqueue(async () => {
      throwIfAborted(signal)
      await this.#transport.flush(this.#scope())
      throwIfAborted(signal)
      this.#accept(await this.#transport.query(this.#scope()))
      throwIfAborted(signal)
    })
  }

  drain(signal?: AbortSignal): Promise<void> {
    this.#assertLive()
    return this.#lane.then(() => throwIfAborted(signal))
  }

  refresh(signal?: AbortSignal): Promise<void> {
    return this.#enqueue(async () => {
      throwIfAborted(signal)
      this.#accept(await this.#transport.query(this.#scope()))
      throwIfAborted(signal)
    })
  }

  acceptApplicationMutation(
    result: CanvasRendererApplicationMutationResult,
    signal?: AbortSignal,
  ): Promise<CanvasApplicationCommandResult> {
    return this.#enqueue(async () => {
      void signal
      // This method receives an already committed result from another Main-owned
      // resource path, so cancellation cannot revoke or hide that commit.
      return this.#acceptApplicationMutation(result)
    })
  }

  runResourceMutation<T extends CanvasResourceAddResult | CanvasResourceRelinkResult>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<Readonly<{ result: T; projectionDelivered: boolean }>> {
    const stagedRoot = this.#visualHistory.stagePendingRoot(this.#createCommandId(), this.#visualAuthority())
    if (stagedRoot) this.#publish()
    return this.#enqueue(async () => {
      const before = this.#visualAuthority()
      try {
        throwIfAborted(signal)
        const result = await operation()
        if (result.delivery.status === "accepted") {
          this.#acceptMutation(result.delivery.projection, result.delivery.acceptedFrameDigest)
          this.#reconcileMutationRoot(stagedRoot, result.operationReceipt, before, this.#visualAuthority())
          this.#publish()
          return Object.freeze({ result, projectionDelivered: true })
        }
        try {
          const pending = [...this.#pendingInvalidationDigests]
          this.#pendingInvalidationDigests.clear()
          this.#accept(await this.#transport.query(this.#scope()))
          for (const digest of pending) rememberBounded(this.#coveredFrameDigests, digest)
          this.#reconcileMutationRoot(stagedRoot, result.operationReceipt, before, this.#visualAuthority())
          this.#publish()
          return Object.freeze({ result, projectionDelivered: true })
        } catch {
          this.#reconcileMutationRoot(stagedRoot, result.operationReceipt, before)
          this.#publish()
          return Object.freeze({ result, projectionDelivered: false })
        }
      } catch (error) {
        this.#visualHistory.rejectStagedRoot(stagedRoot)
        if (stagedRoot) this.#publish()
        throw error
      }
    })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#unsubscribe()
    this.#listeners.clear()
    this.#visualHistory.reset()
    void this.#lane.finally(() => this.#transport.close(this.#scope())).catch(() => undefined)
  }

  #history(direction: "undo" | "redo", signal?: AbortSignal) {
    const commandId = this.#createCommandId()
    const prediction = this.#visualHistory.begin(direction, this.#visualScopeKey())
    return this.#enqueue(async () => {
      try {
        throwIfAborted(signal)
        if (prediction && !this.#visualHistory.isPredictionActive(prediction)) return null
        if (!prediction && !(direction === "undo" ? this.#snapshot.canUndo : this.#snapshot.canRedo)) return null
        const result = await this.#transport[direction]({ ...this.#scope(), commandId })
        if (!result) {
          this.#visualHistory.reject(prediction)
          return null
        }
        this.#acceptMutation(result.projection, result.acceptedFrameDigest)
        const transition = result.historyTransition ?? null
        this.#visualHistory.reconcile(prediction, transition, this.#visualAuthority())
        this.#publish()
        return transition
      } catch (error) {
        this.#visualHistory.reject(prediction)
        this.#publish()
        throw error
      }
    })
  }

  #onInvalidation(event: CanvasSessionInvalidationDto): void {
    if (
      this.#disposed ||
      event.sessionId !== this.#snapshot.sessionId ||
      !sameRef(event.ref, this.ref) ||
      this.#coveredFrameDigests.has(event.frameDigest)
    ) {
      return
    }
    rememberBounded(this.#pendingInvalidationDigests, event.frameDigest)
    if (this.#refreshScheduled) return
    this.#refreshScheduled = true
    void this.#enqueue(async () => {
      try {
        while (this.#pendingInvalidationDigests.size > 0) {
          const pending = [...this.#pendingInvalidationDigests]
          this.#pendingInvalidationDigests.clear()
          const uncovered = pending.filter((digest) => !this.#coveredFrameDigests.has(digest))
          if (uncovered.length === 0) continue
          this.#visualHistory.reset()
          this.#accept(await this.#transport.query(this.#scope()))
          for (const digest of uncovered) rememberBounded(this.#coveredFrameDigests, digest)
        }
      } finally {
        this.#refreshScheduled = false
        if (this.#pendingInvalidationDigests.size > 0)
          this.#onInvalidation({
            format: "convax.canvas-session-invalidation",
            ref: this.ref,
            sessionId: this.#snapshot.sessionId,
            frameDigest: this.#pendingInvalidationDigests.values().next().value!,
          })
      }
    }).catch(() => undefined)
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertLive()
    const current = this.#lane.then(operation)
    this.#lane = current.then(
      () => undefined,
      () => undefined,
    )
    return current
  }

  #accept(next: CanvasSessionProjectionDto): void {
    if (this.#disposed) return
    this.#snapshot = requireProjection(this.ref, next, this.#snapshot.sessionId)
    this.#replaceEntities(next)
    this.#publish()
  }

  #acceptMutation(next: CanvasSessionProjectionDto, frameDigest: Digest): void {
    rememberBounded(this.#coveredFrameDigests, frameDigest)
    this.#pendingInvalidationDigests.delete(frameDigest)
    this.#accept(next)
  }

  #acceptApplicationMutation(result: CanvasRendererApplicationMutationResult): CanvasApplicationCommandResult {
    this.#acceptMutation(result.projection, result.acceptedFrameDigest)
    return Object.freeze({
      acceptedFrameDigest: result.acceptedFrameDigest,
      affectedNodeIds: [...result.affectedNodeIds],
      changed: result.changed,
      createdNodeIds: [...result.createdNodeIds],
      document: result.projection.document,
      operationReceipt: structuredClone(result.operationReceipt),
      warnings: [...result.warnings],
    })
  }

  #replaceEntities(next: CanvasSessionProjectionDto): void {
    this.#entities.clear()
    for (const entry of next.nodeEntities) this.#entities.set(entry.nodeId, entry.entity)
    this.#edgeEntities.clear()
    for (const entry of next.edgeEntities) this.#edgeEntities.set(entry.edgeId, entry.entity)
  }

  #reconcileMutationRoot(
    stagedRoot: string | null,
    receipt: BoundedOperationReceipt,
    before: CanvasVisualHistoryAuthority,
    after?: CanvasVisualHistoryAuthority,
  ): void {
    if (stagedRoot && receipt.semanticRoot) {
      this.#visualHistory.bindStagedRoot(stagedRoot, receipt.operationId, before, after)
    } else if (stagedRoot) {
      this.#visualHistory.rejectStagedRoot(stagedRoot)
    } else if (after && receipt.semanticRoot) {
      this.#visualHistory.record(receipt.operationId, before, after)
    }
  }

  #visualAuthority(): CanvasVisualHistoryAuthority {
    return Object.freeze({
      document: this.#snapshot.document,
      edgeEntities: this.#snapshot.edgeEntities,
      nodeEntities: this.#snapshot.nodeEntities,
    })
  }

  #visualScopeKey(): string {
    return `${this.ref.scopeId}:${this.ref.canvasId}:${this.#snapshot.sessionId}`
  }

  #scope() {
    return { ref: this.ref, sessionId: this.#snapshot.sessionId }
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error("Canvas renderer session is closed")
  }

  #publish(): void {
    for (const listener of Array.from(this.#listeners)) listener()
  }
}

function requireProjection(
  expectedRef: CanvasDocumentRef,
  value: CanvasSessionProjectionDto,
  expectedSessionId?: CanvasSessionProjectionDto["sessionId"],
): CanvasSessionProjectionDto {
  if (
    value.format !== "convax.canvas-session-projection" ||
    !sameRef(value.ref, expectedRef) ||
    value.document.id !== expectedRef.canvasId ||
    (expectedSessionId !== undefined && value.sessionId !== expectedSessionId)
  ) {
    throw new Error("Canvas renderer session projection is outside the mounted scope")
  }
  const ids = new Set<string>()
  for (const entry of value.nodeEntities) {
    if (ids.has(entry.nodeId) || entry.nodeId !== entry.entity.id || entry.entity.kind !== "node") {
      throw new Error("Canvas renderer session entity projection is invalid")
    }
    ids.add(entry.nodeId)
  }
  if (value.document.nodes.some((node) => !ids.has(node.id)) || ids.size !== value.document.nodes.length) {
    throw new Error("Canvas renderer session entity projection is incomplete")
  }
  const edgeIds = new Set<string>()
  for (const entry of value.edgeEntities) {
    if (edgeIds.has(entry.edgeId) || entry.edgeId !== entry.entity.id || entry.entity.kind !== "edge") {
      throw new Error("Canvas renderer session edge entity projection is invalid")
    }
    edgeIds.add(entry.edgeId)
  }
  if (value.document.edges.some((edge) => !edgeIds.has(edge.id)) || edgeIds.size !== value.document.edges.length) {
    throw new Error("Canvas renderer session edge entity projection is incomplete")
  }
  return value
}

function sameRef(left: CanvasDocumentRef, right: CanvasDocumentRef): boolean {
  return left.canvasId === right.canvasId && left.scopeId === right.scopeId
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException("Canvas renderer session was canceled", "AbortError")
}

function rememberBounded(values: Set<Digest>, value: Digest): void {
  values.delete(value)
  values.add(value)
  while (values.size > maximumRememberedFrameDigests) values.delete(values.values().next().value!)
}
