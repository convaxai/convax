import type {
  BoundedOperationReceipt,
  CanvasCertifiedRendererProjectionStore,
  CanvasRendererCollaborationClient,
  CanvasRendererCommand,
  CanvasRendererProjectionChange,
  CanvasRendererProjectionPatchChange,
  CanvasRendererResourceHierarchyKey,
  CanvasRendererResourceHierarchyQueryResult,
  CanvasRendererViewportProjection,
  CanvasRendererViewportQuery,
} from "@convax/canvas/collaboration"
import { createCanvasCertifiedRendererProjectionStore } from "@convax/canvas/collaboration"
import type { CanvasApplicationCommand, CanvasApplicationCommandResult } from "@convax/canvas/application"
import {
  canvasCanonicalResourceIdentity,
  type CanvasAcceptedPreparedResourceRuntime,
  type CanvasDocument,
} from "@convax/canvas"
import { CanvasVisualHistoryCoordinator, type CanvasVisualHistoryAuthority } from "@convax/canvas/view"
import type { CanvasDocumentRef } from "@convax/canvas/application"
import { encodeRestrictedJcs, type Digest } from "@convax/collaboration"
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
  ownsProjectionChange(change: CanvasRendererProjectionPatchChange): boolean
  queryResourceHierarchy(input: CanvasRendererResourceHierarchyKey): CanvasRendererResourceHierarchyQueryResult
  queryViewport(input: CanvasRendererViewportQuery): CanvasRendererViewportProjection
  acceptApplicationMutation(
    result: CanvasRendererApplicationMutationResult,
    signal?: AbortSignal,
  ): Promise<CanvasApplicationCommandResult>
  runResourceMutation<T extends CanvasResourceAddResult | CanvasResourceRelinkResult>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<Readonly<{
    result: T
    projectionDelivered: boolean
    preparedResources: readonly CanvasAcceptedPreparedResourceRuntime[]
  }>>
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
  readonly #unsubscribe: () => void
  #snapshot: CanvasSessionProjectionDto
  #lane: Promise<void> = Promise.resolve()
  #disposed = false
  #refreshScheduled = false
  readonly #pendingInvalidationDigests = new Set<Digest>()
  readonly #coveredFrameDigests = new Set<Digest>()
  readonly #visualHistory = new CanvasVisualHistoryCoordinator()
  readonly visualOverlay = this.#visualHistory.overlay
  readonly #projectionStore: CanvasCertifiedRendererProjectionStore

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
    this.#projectionStore = requireProjectionStore(this.#snapshot)
    this.#unsubscribe = transport.subscribe((event) => this.#onInvalidation(event))
  }

  getProjection(): CanvasDocument {
    return this.#projectionStore.getProjection()
  }

  resolveNodeEntity(nodeId: string) {
    return this.#projectionStore.resolveNodeEntity(nodeId)
  }

  resolveEdgeEntity(edgeId: string) {
    return this.#projectionStore.resolveEdgeEntity(edgeId)
  }

  resolveNode(nodeId: string) {
    return this.#projectionStore.resolveNode(nodeId)
  }

  resolveEdge(edgeId: string) {
    return this.#projectionStore.resolveEdge(edgeId)
  }

  queryViewport(input: CanvasRendererViewportQuery): CanvasRendererViewportProjection {
    return this.#projectionStore.queryViewport(input)
  }

  queryResourceHierarchy(input: CanvasRendererResourceHierarchyKey): CanvasRendererResourceHierarchyQueryResult {
    return this.#projectionStore.queryResourceHierarchy(input)
  }

  ownsProjectionChange(change: CanvasRendererProjectionPatchChange): boolean {
    return this.#projectionStore.ownsProjectionChange(change)
  }

  readonly subscribeProjectionChanges = (listener: (change: CanvasRendererProjectionChange) => void) =>
    this.#projectionStore.subscribeProjectionChanges(listener)

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
  ): Promise<Readonly<{
    result: T
    projectionDelivered: boolean
    preparedResources: readonly CanvasAcceptedPreparedResourceRuntime[]
  }>> {
    const stagedRoot = this.#visualHistory.stageCertifiedResourceAppendRoot(this.#createCommandId())
    return this.#enqueue(async () => {
      try {
        throwIfAborted(signal)
        const result = await operation()
        if (result.delivery.status === "certified") {
          const accepted = this.#acceptCertifiedResourceMutation(result)
          if (!accepted) return this.#recoverResourceMutation(result, stagedRoot)
          if (
            stagedRoot &&
            !this.#visualHistory.bindStagedCertifiedResourceAppend(
              stagedRoot,
              accepted.change,
              this.#projectionStore,
            )
          ) {
            this.#visualHistory.rejectStagedRoot(stagedRoot)
          }
          return Object.freeze({
            result,
            projectionDelivered: true,
            preparedResources: accepted.preparedResources,
          })
        }
        return this.#recoverResourceMutation(result, stagedRoot)
      } catch (error) {
        this.#visualHistory.rejectStagedRoot(stagedRoot)
        if (stagedRoot) this.#publish()
        throw error
      }
    })
  }

  async #recoverResourceMutation<T extends CanvasResourceAddResult | CanvasResourceRelinkResult>(
    result: T,
    stagedRoot: string | null,
  ): Promise<Readonly<{
    result: T
    projectionDelivered: boolean
    preparedResources: readonly CanvasAcceptedPreparedResourceRuntime[]
  }>> {
    const before = this.#visualAuthority()
    try {
      const pending = [...this.#pendingInvalidationDigests]
      this.#pendingInvalidationDigests.clear()
      this.#accept(await this.#transport.query(this.#scope()))
      for (const digest of pending) rememberBounded(this.#coveredFrameDigests, digest)
      this.#reconcileMutationRoot(stagedRoot, result.operationReceipt, before, this.#visualAuthority())
      this.#publish()
      return Object.freeze({ result, projectionDelivered: true, preparedResources: Object.freeze([]) })
    } catch {
      this.#reconcileMutationRoot(stagedRoot, result.operationReceipt, before)
      this.#publish()
      return Object.freeze({ result, projectionDelivered: false, preparedResources: Object.freeze([]) })
    }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#unsubscribe()
    this.#listeners.clear()
    this.#projectionStore.dispose()
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
    const projection = requireProjection(this.ref, next, this.#snapshot.sessionId)
    if (!this.#projectionStore.resetProjection(projectionStoreInput(projection))) {
      throw new Error("Canvas renderer session projection reset is invalid")
    }
    this.#snapshot = projection
    this.#publish()
  }

  #acceptCertifiedResourceMutation(
    result: CanvasResourceAddResult | CanvasResourceRelinkResult,
  ): Readonly<{
    change: CanvasRendererProjectionPatchChange
    preparedResources: readonly CanvasAcceptedPreparedResourceRuntime[]
  }> | null {
    const delivery = result.delivery
    if (
      delivery.status !== "certified" ||
      delivery.sessionId !== this.#snapshot.sessionId ||
      !sameRef(delivery.ref, this.ref) ||
      !sameCanonicalValue(delivery.patch.receipt, result.operationReceipt) ||
      !("createdNodeIds" in result)
    ) return null
    const createdNodeIds = new Set(result.createdNodeIds)
    if (
      createdNodeIds.size !== result.createdNodeIds.length ||
      delivery.patch.nodes.length !== createdNodeIds.size ||
      delivery.patch.nodes.some((node) => !createdNodeIds.has(node.ref.id))
    ) return null

    const installed = this.#projectionStore.applyCertifiedProjectionPatch(delivery.patch, (change) => {
      const changedNodes = new Map(change.changes.nodes.map((node) => [node.id, node]))
      const changedEntities = new Map(
        change.changes.nodeEntities.map((entry) => [entry.nodeId, entry.entity]),
      )
      const runtimeNodeIds = new Set<string>()
      const preparedResources: CanvasAcceptedPreparedResourceRuntime[] = []
      let runtimePatchesValid = true
      for (const runtime of delivery.runtimePatches) {
        const node = changedNodes.get(runtime.nodeId)
        const entity = changedEntities.get(runtime.nodeId)
        const resourceIdentity = node ? canvasCanonicalResourceIdentity(node) : undefined
        if (
          runtimeNodeIds.has(runtime.nodeId) ||
          !createdNodeIds.has(runtime.nodeId) ||
          !node ||
          !entity ||
          resourceIdentity === undefined
        ) {
          runtimePatchesValid = false
          break
        }
        runtimeNodeIds.add(runtime.nodeId)
        preparedResources.push(Object.freeze({
          entity: Object.freeze({ ...entity }),
          nodeId: runtime.nodeId,
          resourceIdentity,
          state: runtime.state,
        }))
      }
      runtimePatchesValid &&= runtimeNodeIds.size === createdNodeIds.size
      return Object.freeze({
        preparedResources: runtimePatchesValid
          ? Object.freeze(preparedResources)
          : Object.freeze([]),
        resourceHierarchy: delivery.resourceHierarchy,
      })
    })
    if (installed.status !== "applied") return null
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      canRedo: delivery.canRedo,
      canUndo: delivery.canUndo,
      projectionIdentity: installed.change.identity,
      resourceHierarchy: Object.freeze({
        format: "convax.canvas-resource-hierarchy-snapshot",
        projectionIdentity: installed.change.identity,
        completeness: "unavailable",
        entries: Object.freeze([]),
      }),
    })
    rememberBounded(this.#coveredFrameDigests, delivery.acceptedFrameDigest)
    this.#pendingInvalidationDigests.delete(delivery.acceptedFrameDigest)

    return Object.freeze({
      change: installed.change,
      preparedResources: installed.change.preparedResources,
    })
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
    const document = this.#projectionStore.getProjection()
    const nodeEntities = document.nodes.map((node) => {
      const entity = this.#projectionStore.resolveNodeEntity(node.id)
      if (!entity) throw new Error("Canvas renderer node entity projection is incomplete")
      return Object.freeze({ nodeId: node.id, entity })
    })
    const edgeEntities = document.edges.map((edge) => {
      const entity = this.#projectionStore.resolveEdgeEntity(edge.id)
      if (!entity) throw new Error("Canvas renderer edge entity projection is incomplete")
      return Object.freeze({ edgeId: edge.id, entity })
    })
    return Object.freeze({
      document,
      edgeEntities: Object.freeze(edgeEntities),
      nodeEntities: Object.freeze(nodeEntities),
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

function projectionStoreInput(projection: CanvasSessionProjectionDto) {
  return {
    identity: projection.projectionIdentity,
    projection: {
      document: projection.document,
      edgeEntities: new Map(projection.edgeEntities.map((entry) => [entry.edgeId, entry.entity])),
      nodeEntities: new Map(projection.nodeEntities.map((entry) => [entry.nodeId, entry.entity])),
    },
    resourceHierarchy: projection.resourceHierarchy,
  } as const
}

function requireProjectionStore(projection: CanvasSessionProjectionDto): CanvasCertifiedRendererProjectionStore {
  const store = createCanvasCertifiedRendererProjectionStore(projectionStoreInput(projection))
  if (!store) throw new Error("Canvas renderer session projection store is invalid")
  return store
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  const leftBytes = encodeRestrictedJcs(left)
  const rightBytes = encodeRestrictedJcs(right)
  return leftBytes.byteLength === rightBytes.byteLength && leftBytes.every((byte, index) => byte === rightBytes[index])
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
