import { primeCanvasDocumentPlacementIndexes } from "../resource-placement"
import type { CanvasDocument, CanvasEdge, CanvasNode } from "../types"
import { parseCanvasResourceRuntimeState, type CanvasResourceRuntimeState } from "../types"
import type { CanvasDocumentProjection } from "./projection"
import {
  applyCanvasCertifiedProjectionPatch,
  createCanvasIndexedProjectionCursor,
  parseCanvasCertifiedProjectionPatch,
  readCanvasIndexedProjectionEdge,
  readCanvasIndexedProjectionNode,
  type CanvasAppliedProjectionPatchChanges,
  type CanvasCertifiedProjectionIdentity,
  type CanvasCertifiedProjectionPatch,
  type CanvasIndexedProjectionCursor,
} from "./projection-patch"
import type { BoundedOperationReceipt, CanvasEntityRef } from "./types"
import {
  CanvasRendererViewportIndex,
  type CanvasRendererViewportProjection,
  type CanvasRendererViewportQuery,
} from "./renderer-viewport-index"
import {
  CanvasRendererResourceHierarchyIndex,
  type CanvasRendererResourceHierarchyDelta,
  type CanvasRendererResourceHierarchyKey,
  type CanvasRendererResourceHierarchyQueryResult,
  type CanvasRendererResourceHierarchySnapshot,
} from "./renderer-resource-hierarchy-index"

export interface CanvasRendererPreparedResourceRuntime {
  readonly entity: CanvasEntityRef & { readonly kind: "node" }
  readonly nodeId: string
  readonly resourceIdentity: string
  readonly state: CanvasResourceRuntimeState
}

export interface CanvasRendererProjectionPatchChange {
  readonly kind: "patch"
  readonly identity: CanvasCertifiedProjectionIdentity
  readonly receipt: BoundedOperationReceipt
  readonly changes: CanvasAppliedProjectionPatchChanges
  /** Validated sibling presentation state published in the same bounded batch. */
  readonly preparedResources: readonly CanvasRendererPreparedResourceRuntime[]
}

export interface CanvasRendererProjectionResetChange {
  readonly kind: "reset"
  readonly identity: CanvasCertifiedProjectionIdentity
}

export type CanvasRendererProjectionChange =
  | CanvasRendererProjectionPatchChange
  | CanvasRendererProjectionResetChange

export type CanvasRendererCertifiedPatchInstallResult =
  | Readonly<{ readonly status: "applied"; readonly change: CanvasRendererProjectionPatchChange }>
  | Readonly<{ readonly status: "base-mismatch" }>
  | Readonly<{ readonly status: "rejected" }>

export interface CanvasCertifiedRendererProjectionStore {
  applyCertifiedProjectionPatch(
    patch: CanvasCertifiedProjectionPatch,
    preparePresentation?: CanvasRendererProjectionPatchPreparation,
  ): CanvasRendererCertifiedPatchInstallResult
  dispose(): void
  getProjection(): CanvasDocument
  getProjectionIdentity(): CanvasCertifiedProjectionIdentity
  /** Store-instance proof; another disposable store cannot mint this session's history evidence. */
  ownsProjectionChange(change: CanvasRendererProjectionPatchChange): boolean
  queryResourceHierarchy(input: CanvasRendererResourceHierarchyKey): CanvasRendererResourceHierarchyQueryResult
  queryViewport(input: CanvasRendererViewportQuery): CanvasRendererViewportProjection
  resetProjection(input: Readonly<{
    identity: CanvasCertifiedProjectionIdentity
    projection: CanvasDocumentProjection
    resourceHierarchy: CanvasRendererResourceHierarchySnapshot
  }>): boolean
  resolveEdge(edgeId: string): CanvasEdge | undefined
  resolveEdgeEntity(edgeId: string): (CanvasEntityRef & { readonly kind: "edge" }) | undefined
  resolveNode(nodeId: string): CanvasNode | undefined
  resolveNodeEntity(nodeId: string): (CanvasEntityRef & { readonly kind: "node" }) | undefined
  /** Full/reset invalidation only. A patch never invokes this listener. */
  subscribe(listener: () => void): () => void
  /** Hot path: publishes exactly the certified k entries and never reads getProjection. */
  subscribeProjectionChanges(listener: (change: CanvasRendererProjectionChange) => void): () => void
}

export type CanvasRendererProjectionPatchPreparation = (
  change: Omit<CanvasRendererProjectionPatchChange, "preparedResources">,
) => Readonly<{
  readonly preparedResources: readonly CanvasRendererPreparedResourceRuntime[]
  readonly resourceHierarchy: CanvasRendererResourceHierarchyDelta
}>

let rendererProjectionPatchEntriesPublished = 0
let rendererProjectionFullReads = 0

/** Package-private structural evidence; not part of the package surface. */
export function canvasRendererProjectionStoreWorkCounts() {
  return Object.freeze({
    fullReads: rendererProjectionFullReads,
    patchEntriesPublished: rendererProjectionPatchEntriesPublished,
  })
}

/**
 * Creates the Canvas-owned mounted-view cache from one explicit cold/reset
 * projection. Certified appends path-copy its cursor and publish only k upserts.
 */
export function createCanvasCertifiedRendererProjectionStore(input: Readonly<{
  identity: CanvasCertifiedProjectionIdentity
  projection: CanvasDocumentProjection
  resourceHierarchy: CanvasRendererResourceHierarchySnapshot
}>): CanvasCertifiedRendererProjectionStore | null {
  const cursor = createCanvasIndexedProjectionCursor(input)
  return cursor ? new CertifiedRendererProjectionStore(cursor, input.resourceHierarchy) : null
}

class CertifiedRendererProjectionStore implements CanvasCertifiedRendererProjectionStore {
  readonly #fullListeners = new Set<() => void>()
  readonly #patchListeners = new Set<(change: CanvasRendererProjectionChange) => void>()
  #cursor: CanvasIndexedProjectionCursor
  readonly #issuedPatchChanges = new WeakSet<object>()
  #materializedCursor: CanvasIndexedProjectionCursor
  #materialized: CanvasDocumentProjection
  #resourceHierarchyIndex: CanvasRendererResourceHierarchyIndex
  #viewportIndex: CanvasRendererViewportIndex
  #disposed = false

  constructor(cursor: CanvasIndexedProjectionCursor, resourceHierarchy: CanvasRendererResourceHierarchySnapshot) {
    this.#cursor = cursor
    this.#materializedCursor = cursor
    // Cursor creation is the explicit cold bootstrap and already owns this
    // frozen projection. Reading it here never performs incremental materialization.
    this.#materialized = cursor.projection
    this.#resourceHierarchyIndex = CanvasRendererResourceHierarchyIndex.fromSnapshot({
      identity: cursor.identity,
      projection: cursor.projection,
      resourceHierarchy,
    })
    this.#viewportIndex = new CanvasRendererViewportIndex(this.#materialized.document)
  }

  applyCertifiedProjectionPatch(
    patchValue: CanvasCertifiedProjectionPatch,
    preparePresentation?: CanvasRendererProjectionPatchPreparation,
  ): CanvasRendererCertifiedPatchInstallResult {
    if (this.#disposed) return Object.freeze({ status: "rejected" })
    try {
      const patch = parseCanvasCertifiedProjectionPatch(patchValue)
      const applied = applyCanvasCertifiedProjectionPatch(this.#cursor, patch)
      if (applied.status !== "applied") return applied
      const coreChange = Object.freeze({
        kind: "patch" as const,
        identity: applied.cursor.identity,
        receipt: patch.receipt,
        changes: applied.changes,
      })
      const preparation = readPatchPreparation(preparePresentation, coreChange)
      const preparedResources = validatePreparedResources(preparation?.preparedResources, applied.changes)
      this.#viewportIndex.append(applied.changes)
      this.#cursor = applied.cursor
      this.#resourceHierarchyIndex.applyDelta({
        changes: applied.changes,
        identity: applied.cursor.identity,
        resourceHierarchy: preparation?.resourceHierarchy,
      })
      rendererProjectionPatchEntriesPublished += applied.changes.nodes.length + applied.changes.edges.length
      const change = Object.freeze({ ...coreChange, preparedResources })
      this.#issuedPatchChanges.add(change)
      for (const listener of [...this.#patchListeners]) {
        try { listener(change) } catch {}
      }
      return Object.freeze({ status: "applied" as const, change })
    } catch {
      return Object.freeze({ status: "rejected" })
    }
  }

  getProjection(): CanvasDocument {
    if (this.#disposed) throw new TypeError("Canvas Renderer projection store is disposed")
    if (this.#materializedCursor === this.#cursor) return this.#materialized.document
    rendererProjectionFullReads += 1
    const next = this.#cursor.projection
    // Full materialization is explicit bulk work; prime every placement scope
    // so the next root or focused-Group optimistic create remains indexed.
    primeCanvasDocumentPlacementIndexes(next.document)
    this.#materialized = next
    this.#materializedCursor = this.#cursor
    return next.document
  }

  getProjectionIdentity(): CanvasCertifiedProjectionIdentity {
    return this.#cursor.identity
  }

  ownsProjectionChange(change: CanvasRendererProjectionPatchChange): boolean {
    return this.#issuedPatchChanges.has(change as object)
  }

  queryResourceHierarchy(input: CanvasRendererResourceHierarchyKey): CanvasRendererResourceHierarchyQueryResult {
    if (this.#disposed) return Object.freeze({ status: "unavailable" })
    return this.#resourceHierarchyIndex.query(input)
  }

  queryViewport(input: CanvasRendererViewportQuery): CanvasRendererViewportProjection {
    if (this.#disposed) throw new TypeError("Canvas Renderer projection store is disposed")
    return this.#viewportIndex.query(input)
  }

  resetProjection(input: Readonly<{
    identity: CanvasCertifiedProjectionIdentity
    projection: CanvasDocumentProjection
    resourceHierarchy: CanvasRendererResourceHierarchySnapshot
  }>): boolean {
    if (this.#disposed) return false
    if (
      input.identity.canvasId !== this.#cursor.identity.canvasId ||
      input.identity.ownerSchemaDigest !== this.#cursor.identity.ownerSchemaDigest
    ) return false
    const cursor = createCanvasIndexedProjectionCursor(input)
    if (!cursor) return false
    this.#cursor = cursor
    this.#materializedCursor = cursor
    this.#materialized = cursor.projection
    this.#resourceHierarchyIndex = CanvasRendererResourceHierarchyIndex.fromSnapshot({
      identity: cursor.identity,
      projection: cursor.projection,
      resourceHierarchy: input.resourceHierarchy,
    })
    this.#viewportIndex = new CanvasRendererViewportIndex(this.#materialized.document)
    const change = Object.freeze({ kind: "reset" as const, identity: cursor.identity })
    for (const listener of [...this.#patchListeners]) {
      try { listener(change) } catch {}
    }
    for (const listener of [...this.#fullListeners]) {
      try { listener() } catch {}
    }
    return true
  }

  resolveNode(nodeId: string): CanvasNode | undefined {
    return readCanvasIndexedProjectionNode(this.#cursor, nodeId)?.node
  }

  resolveNodeEntity(nodeId: string): (CanvasEntityRef & { readonly kind: "node" }) | undefined {
    return readCanvasIndexedProjectionNode(this.#cursor, nodeId)?.entity
  }

  resolveEdge(edgeId: string): CanvasEdge | undefined {
    return readCanvasIndexedProjectionEdge(this.#cursor, edgeId)?.edge
  }

  resolveEdgeEntity(edgeId: string): (CanvasEntityRef & { readonly kind: "edge" }) | undefined {
    return readCanvasIndexedProjectionEdge(this.#cursor, edgeId)?.entity
  }

  subscribe(listener: () => void): () => void {
    if (this.#disposed) return () => undefined
    this.#fullListeners.add(listener)
    return () => this.#fullListeners.delete(listener)
  }

  subscribeProjectionChanges(listener: (change: CanvasRendererProjectionChange) => void): () => void {
    if (this.#disposed) return () => undefined
    this.#patchListeners.add(listener)
    return () => this.#patchListeners.delete(listener)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#fullListeners.clear()
    this.#patchListeners.clear()
  }
}

function readPatchPreparation(
  prepare: CanvasRendererProjectionPatchPreparation | undefined,
  change: Omit<CanvasRendererProjectionPatchChange, "preparedResources">,
): ReturnType<CanvasRendererProjectionPatchPreparation> | null {
  if (!prepare) return null
  try {
    const value = prepare(change)
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !("preparedResources" in value) ||
      !("resourceHierarchy" in value)
    ) return null
    return value
  } catch {
    return null
  }
}

function validatePreparedResources(
  values: readonly CanvasRendererPreparedResourceRuntime[] | undefined,
  changes: CanvasAppliedProjectionPatchChanges,
): readonly CanvasRendererPreparedResourceRuntime[] {
  if (!values) return Object.freeze([])
  try {
    if (!Array.isArray(values) || values.length > changes.nodes.length) return Object.freeze([])
    const nodes = new Map(changes.nodes.map((node) => [node.id, node]))
    const entities = new Map(changes.nodeEntities.map((entry) => [entry.nodeId, entry.entity]))
    const seen = new Set<string>()
    const result: CanvasRendererPreparedResourceRuntime[] = []
    for (const value of values) {
      const entity = entities.get(value.nodeId)
      const state = parseCanvasResourceRuntimeState(value.state)
      if (
        seen.has(value.nodeId) ||
        !nodes.has(value.nodeId) ||
        !entity ||
        value.entity.kind !== "node" ||
        value.entity.id !== entity.id ||
        value.entity.incarnation !== entity.incarnation ||
        typeof value.resourceIdentity !== "string" ||
        value.resourceIdentity.length < 1 ||
        value.resourceIdentity.length > 8_192 ||
        !state
      ) return Object.freeze([])
      seen.add(value.nodeId)
      result.push(Object.freeze({
        entity: Object.freeze({ ...entity }),
        nodeId: value.nodeId,
        resourceIdentity: value.resourceIdentity,
        state,
      }))
    }
    return Object.freeze(result)
  } catch {
    return Object.freeze([])
  }
}
