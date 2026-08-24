import {
  assertDenseArray,
  assertExactKeys,
  compareUtf8,
  parseCanvasId,
  parseDigest,
  type CanvasId,
} from "@convax/collaboration"
import { parseCanvasDocument } from "../document"
import type { CanvasDocument, CanvasEdge, CanvasNode } from "../types"
import { appendCanvasSnapshotEntries, createCanvasSnapshotMap } from "./persistent-append-map"
import {
  projectCanvasEdgeForDocument,
  projectCanvasNodeForDocument,
  readCanvasProjectionIndex,
  type CanvasDocumentProjection,
} from "./projection"
import type {
  BoundedOperationReceipt,
  CanvasEntityRef,
  CanvasProjectedEdge,
  CanvasProjectedNode,
  CanvasSnapshot,
  Digest,
} from "./types"
import {
  assertEdgeData,
  assertEntityRef,
  assertNodeData,
  assertOperationReceipt,
  assertPluginState,
  assertPoint,
  assertSize,
  canvasEntityKey,
  historyRootKey,
  operationKey,
  sameCanonicalValue,
} from "./validation"

export interface CanvasCertifiedProjectionIdentity {
  readonly format: "convax.canvas-certified-projection-identity"
  readonly canvasId: CanvasId
  readonly ownerSchemaDigest: Digest
  readonly stateCommitmentDigest: Digest
}

/**
 * A bounded, Main-issued presentation acceleration for one sealed resource
 * append. It is not an intent, a persistence carrier, or authorization proof.
 */
export interface CanvasCertifiedProjectionPatch {
  readonly format: "convax.canvas-certified-projection-patch"
  readonly kind: "resource-append"
  readonly canvasId: CanvasId
  readonly ownerSchemaDigest: Digest
  readonly baseStateCommitmentDigest: Digest
  readonly resultStateCommitmentDigest: Digest
  readonly receipt: BoundedOperationReceipt
  readonly nodes: readonly CanvasProjectedNode[]
  readonly edges: readonly CanvasProjectedEdge[]
}

declare const canvasIndexedProjectionCursorBrand: unique symbol

/** Disposable indexed Renderer view. Its hidden cache never authorizes a mutation. */
export interface CanvasIndexedProjectionCursor {
  readonly [canvasIndexedProjectionCursorBrand]: true
  readonly identity: CanvasCertifiedProjectionIdentity
  /** Cold/full consumers may materialize this; patch application itself never does. */
  readonly projection: CanvasDocumentProjection
}

export interface CanvasAppliedProjectionPatchChanges {
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
  readonly nodeEntities: readonly Readonly<{
    readonly nodeId: string
    readonly entity: CanvasEntityRef & { readonly kind: "node" }
  }>[]
  readonly edgeEntities: readonly Readonly<{
    readonly edgeId: string
    readonly entity: CanvasEntityRef & { readonly kind: "edge" }
  }>[]
}

export type CanvasProjectionPatchApplyResult =
  | Readonly<{
      readonly status: "applied"
      readonly cursor: CanvasIndexedProjectionCursor
      readonly changes: CanvasAppliedProjectionPatchChanges
    }>
  | Readonly<{ readonly status: "base-mismatch" }>
  | Readonly<{ readonly status: "rejected" }>

interface CertifiedProjectionRootRecord {
  readonly identity: CanvasCertifiedProjectionIdentity
}

interface CertifiedProjectionPatchRecord {
  readonly base: CanvasSnapshot
  readonly result: CanvasSnapshot
  readonly receipt: BoundedOperationReceipt
  readonly changed: readonly Readonly<{
    readonly name: "edges" | "nodes" | "operations" | "semanticHistory"
    readonly keys: readonly string[]
  }>[]
  readonly nodeKeys: readonly string[]
  readonly edgeKeys: readonly string[]
}

interface IndexedProjectionCursorState {
  readonly identity: CanvasCertifiedProjectionIdentity
  readonly metadata: CanvasDocument["metadata"]
  readonly nodesByEntityKey: ReadonlyMap<string, CanvasNode>
  readonly edgesByEntityKey: ReadonlyMap<string, CanvasEdge>
  readonly nodeEntitiesById: ReadonlyMap<string, CanvasEntityRef & { readonly kind: "node" }>
  readonly edgeEntitiesById: ReadonlyMap<string, CanvasEntityRef & { readonly kind: "edge" }>
  materialized: CanvasDocumentProjection | null
}

export interface CanvasIndexedProjectionNodeEntry {
  readonly node: CanvasNode
  readonly entity: CanvasEntityRef & { readonly kind: "node" }
}

export interface CanvasIndexedProjectionEdgeEntry {
  readonly edge: CanvasEdge
  readonly entity: CanvasEntityRef & { readonly kind: "edge" }
}

const certifiedRoots = new WeakMap<CanvasSnapshot, CertifiedProjectionRootRecord>()
const certifiedPatchRecords = new WeakMap<CanvasSnapshot, CertifiedProjectionPatchRecord>()
const certifiedPatches = new WeakMap<CanvasSnapshot, CanvasCertifiedProjectionPatch>()
const indexedCursorStates = new WeakMap<CanvasIndexedProjectionCursor, IndexedProjectionCursorState>()
const issuedIndexedCursors = new WeakSet<object>()

let certifiedPatchEntryVisits = 0
let indexedPatchEntryVisits = 0
let cursorMaterializedEntryVisits = 0

/** Package-private structural evidence; never exported from the package surface. */
export function canvasCertifiedProjectionPatchWorkCounts() {
  return Object.freeze({
    certifiedPatchEntryVisits,
    indexedPatchEntryVisits,
    cursorMaterializedEntryVisits,
  })
}

/** Package-private owner-runtime issuer. Public callers cannot install evidence. */
export function bindCanvasCertifiedProjectionRoot(input: Readonly<{
  snapshot: CanvasSnapshot
  ownerSchemaDigest: Digest
  stateCommitmentDigest: Digest
}>): void {
  const identity = freezePortable({
    format: "convax.canvas-certified-projection-identity" as const,
    canvasId: parseCanvasId(input.snapshot.identity.canvasId),
    ownerSchemaDigest: parseDigest(input.ownerSchemaDigest),
    stateCommitmentDigest: parseDigest(input.stateCommitmentDigest),
  })
  const current = certifiedRoots.get(input.snapshot)
  if (current && !sameCanonicalValue(current.identity, identity)) {
    throw new TypeError("Canvas snapshot already has a different certified projection root")
  }
  certifiedRoots.set(input.snapshot, Object.freeze({ identity }))
}

/** Package-private sealed-post issuer. `changed` is copied before it enters the cache. */
export function bindCanvasCertifiedProjectionPatch(input: Readonly<{
  base: CanvasSnapshot
  result: CanvasSnapshot
  changed: ReadonlyMap<string, readonly string[]>
  receipt: BoundedOperationReceipt
}>): void {
  const baseRoot = certifiedRoots.get(input.base)
  const resultRoot = certifiedRoots.get(input.result)
  if (!baseRoot || !resultRoot) throw new TypeError("Canvas certified projection roots are unavailable")
  if (
    baseRoot.identity.canvasId !== resultRoot.identity.canvasId ||
    baseRoot.identity.ownerSchemaDigest !== resultRoot.identity.ownerSchemaDigest ||
    baseRoot.identity.stateCommitmentDigest === resultRoot.identity.stateCommitmentDigest
  ) {
    throw new TypeError("Canvas certified projection roots do not describe one state transition")
  }
  assertOperationReceipt(input.receipt)
  if (input.receipt.intentKind !== "canvas.resources.add" && input.receipt.intentKind !== "canvas.resources.pending.create") {
    throw new TypeError("Canvas certified projection patch requires a resource append receipt")
  }
  const changedNames = [...input.changed.keys()].sort(compareUtf8)
  const allowedNames = new Set(["edges", "nodes", "operations", "semanticHistory"])
  if (
    changedNames.some((name) => !allowedNames.has(name)) ||
    !input.changed.has("nodes") ||
    !input.changed.has("operations") ||
    !input.changed.has("semanticHistory")
  ) {
    throw new TypeError("Canvas certified projection patch changed an unsupported owner root")
  }
  const changed = Object.freeze(changedNames.map((name) => Object.freeze({
    name: name as "edges" | "nodes" | "operations" | "semanticHistory",
    keys: sortedUniqueKeys(input.changed.get(name) ?? [], `Canvas patch ${name} keys`),
  })))
  const changedKeys = (name: CertifiedProjectionPatchRecord["changed"][number]["name"]) =>
    changed.find((entry) => entry.name === name)?.keys ?? Object.freeze([])
  const nodeKeys = changedKeys("nodes")
  const edgeKeys = changedKeys("edges")
  const operationKeys = changedKeys("operations")
  const historyKeys = changedKeys("semanticHistory")
  const expectedOperationKey = operationKey(input.receipt.actorId, input.receipt.operationId)
  const expectedHistoryKey = historyRootKey(input.receipt.operationId)
  if (
    nodeKeys.length < 1 ||
    nodeKeys.length > 85 ||
    edgeKeys.length > 168 ||
    6 * nodeKeys.length + 3 * edgeKeys.length + 2 > 512 ||
    operationKeys.length !== 1 || operationKeys[0] !== expectedOperationKey ||
    historyKeys.length !== 1 || historyKeys[0] !== expectedHistoryKey
  ) {
    throw new TypeError("Canvas certified projection patch cardinality is invalid")
  }
  const resultEntityKeys = input.receipt.resultEntities.map(canvasEntityKey)
  const changedEntityKeys = [...nodeKeys, ...edgeKeys].sort(compareUtf8)
  if (!sameStringList(resultEntityKeys, changedEntityKeys)) {
    throw new TypeError("Canvas certified projection patch does not match its receipt entities")
  }
  if (
    !sameCanonicalValue(
      input.result.operations.get(expectedOperationKey),
      input.receipt,
    )
  ) {
    throw new TypeError("Canvas certified projection receipt is absent from the result snapshot")
  }
  const historyRoot = input.result.semanticHistory.get(expectedHistoryKey)
  if (
    !input.receipt.semanticRoot ||
    input.receipt.historyMaterialDigest === null ||
    historyRoot?.format !== "convax.canvas-semantic-history-root" ||
    historyRoot.rootOperationId !== input.receipt.operationId ||
    historyRoot.sourceIntentKind !== input.receipt.intentKind ||
    historyRoot.sourceIntentDigest !== input.receipt.intentDigest ||
    historyRoot.materialDigest !== input.receipt.historyMaterialDigest
  ) {
    throw new TypeError("Canvas certified projection history is absent from the result snapshot")
  }
  for (const key of nodeKeys) {
    if (input.base.nodes.has(key) || !input.result.nodes.has(key)) {
      throw new TypeError(`Canvas certified projection node is not an append: ${key}`)
    }
  }
  for (const key of edgeKeys) {
    if (input.base.edges.has(key) || !input.result.edges.has(key)) {
      throw new TypeError(`Canvas certified projection edge is not an append: ${key}`)
    }
  }
  if (
    input.result.identity !== input.base.identity ||
    input.result.meta !== input.base.meta ||
    input.result.containments !== input.base.containments ||
    input.result.generationBegins !== input.base.generationBegins ||
    input.result.generationTerminals !== input.base.generationTerminals ||
    input.result.generationDismissals !== input.base.generationDismissals ||
    input.result.generationRecoveryFailures !== input.base.generationRecoveryFailures ||
    (edgeKeys.length === 0 && input.result.edges !== input.base.edges) ||
    input.result.nodes.size !== input.base.nodes.size + nodeKeys.length ||
    input.result.edges.size !== input.base.edges.size + edgeKeys.length ||
    input.result.operations.size !== input.base.operations.size + 1 ||
    input.result.semanticHistory.size !== input.base.semanticHistory.size + 1
  ) {
    throw new TypeError("Canvas certified projection patch does not bind the exact append-only root set")
  }
  certifiedPatchRecords.set(input.result, Object.freeze({
    base: input.base,
    result: input.result,
    receipt: freezePortable(structuredClone(input.receipt)),
    changed,
    nodeKeys,
    edgeKeys,
  }))
}

/** Reads the exact state cursor installed only by successful owner validation. */
export function readCanvasCertifiedProjectionIdentity(
  snapshot: CanvasSnapshot,
): CanvasCertifiedProjectionIdentity | null {
  return certifiedRoots.get(snapshot)?.identity ?? null
}

/**
 * Reads one certified resource-append patch from exact sealed owner evidence.
 * A cache miss, wrong receipt, or unavailable keyed projection returns null and
 * requires a full authoritative projection.
 */
export function readCanvasCertifiedProjectionPatch(
  resultSnapshot: CanvasSnapshot,
  receipt: BoundedOperationReceipt,
): CanvasCertifiedProjectionPatch | null {
  try {
    const record = certifiedPatchRecords.get(resultSnapshot)
    if (!record || record.result !== resultSnapshot || !sameCanonicalValue(record.receipt, receipt)) return null
    const cached = certifiedPatches.get(resultSnapshot)
    if (cached) return cached
    const baseRoot = certifiedRoots.get(record.base)?.identity
    const resultRoot = certifiedRoots.get(resultSnapshot)?.identity
    const index = readCanvasProjectionIndex(resultSnapshot)
    if (!baseRoot || !resultRoot || !index) return null
    if (
      baseRoot.canvasId !== resultRoot.canvasId ||
      baseRoot.ownerSchemaDigest !== resultRoot.ownerSchemaDigest ||
      baseRoot.stateCommitmentDigest === resultRoot.stateCommitmentDigest
    ) return null

    const nodes = record.nodeKeys.map((key) => {
      certifiedPatchEntryVisits += 1
      const node = index.nodesByKey.get(key)
      if (!node || node.parent !== null) throw new TypeError(`Canvas certified projection node is unavailable: ${key}`)
      return freezePortable(structuredClone(node))
    })
    const edges = record.edgeKeys.map((key) => {
      certifiedPatchEntryVisits += 1
      const edge = index.edgesByKey.get(key)
      if (!edge) throw new TypeError(`Canvas certified projection edge is unavailable: ${key}`)
      return freezePortable(structuredClone(edge))
    })
    const patch = parseCanvasCertifiedProjectionPatch({
      format: "convax.canvas-certified-projection-patch" as const,
      kind: "resource-append" as const,
      canvasId: resultRoot.canvasId,
      ownerSchemaDigest: resultRoot.ownerSchemaDigest,
      baseStateCommitmentDigest: baseRoot.stateCommitmentDigest,
      resultStateCommitmentDigest: resultRoot.stateCommitmentDigest,
      receipt: structuredClone(record.receipt),
      nodes,
      edges,
    })
    certifiedPatches.set(resultSnapshot, patch)
    return patch
  } catch {
    return null
  }
}

/** Creates one disposable indexed view from a full, already accepted projection. */
export function createCanvasIndexedProjectionCursor(input: Readonly<{
  identity: CanvasCertifiedProjectionIdentity
  projection: CanvasDocumentProjection
}>): CanvasIndexedProjectionCursor | null {
  try {
    const identity = parseCanvasCertifiedProjectionIdentity(input.identity)
    const parsed = parseCanvasDocument(input.projection.document, identity.canvasId)
    if (!parsed) return null
    if (
      input.projection.nodeEntities.size !== parsed.nodes.length ||
      input.projection.edgeEntities.size !== parsed.edges.length
    ) return null

    const nodesByEntityKey: [string, CanvasNode][] = []
    const edgesByEntityKey: [string, CanvasEdge][] = []
    const nodeEntitiesById: [string, CanvasEntityRef & { readonly kind: "node" }][] = []
    const edgeEntitiesById: [string, CanvasEntityRef & { readonly kind: "edge" }][] = []
    for (const node of parsed.nodes) {
      const entity = input.projection.nodeEntities.get(node.id)
      assertEntityRef(entity, "node")
      if (entity.id !== node.id) throw new TypeError("Canvas indexed projection node binding is invalid")
      nodesByEntityKey.push([canvasEntityKey(entity), freezePortable(structuredClone(node))])
      nodeEntitiesById.push([node.id, freezePortable(structuredClone(entity))])
    }
    for (const edge of parsed.edges) {
      const entity = input.projection.edgeEntities.get(edge.id)
      assertEntityRef(entity, "edge")
      if (entity.id !== edge.id) throw new TypeError("Canvas indexed projection edge binding is invalid")
      const source = input.projection.nodeEntities.get(edge.source)
      const target = input.projection.nodeEntities.get(edge.target)
      if (!source || !target) throw new TypeError("Canvas indexed projection edge endpoint is invalid")
      edgesByEntityKey.push([canvasEntityKey(entity), freezePortable(structuredClone(edge))])
      edgeEntitiesById.push([edge.id, freezePortable(structuredClone(entity))])
    }
    requireSortedUniqueEntries(nodesByEntityKey, "Canvas indexed projection nodes")
    requireSortedUniqueEntries(edgesByEntityKey, "Canvas indexed projection edges")
    const nodeMap = createCanvasSnapshotMap(nodesByEntityKey)
    const edgeMap = createCanvasSnapshotMap(edgesByEntityKey)
    const nodeEntityMap = createCanvasSnapshotMap(nodeEntitiesById)
    const edgeEntityMap = createCanvasSnapshotMap(edgeEntitiesById)
    const materialized = freezeDocumentProjection({
      document: {
        id: parsed.id,
        metadata: structuredClone(parsed.metadata),
        nodes: [...nodeMap.values()],
        edges: [...edgeMap.values()],
      },
      nodeEntities: nodeEntityMap,
      edgeEntities: edgeEntityMap,
    })
    return issueIndexedCursor({
      identity,
      metadata: freezePortable(structuredClone(parsed.metadata)),
      nodesByEntityKey: nodeMap,
      edgesByEntityKey: edgeMap,
      nodeEntitiesById: nodeEntityMap,
      edgeEntitiesById: edgeEntityMap,
      materialized,
    })
  } catch {
    return null
  }
}

/** Applies only a closed, base-bound owner patch to the disposable indexed view. */
export function applyCanvasCertifiedProjectionPatch(
  cursor: CanvasIndexedProjectionCursor,
  patchValue: unknown,
): CanvasProjectionPatchApplyResult {
  const current = indexedCursorStates.get(cursor)
  if (!current || !issuedIndexedCursors.has(cursor as object)) return Object.freeze({ status: "rejected" })
  try {
    const patch = parseCanvasCertifiedProjectionPatch(patchValue)
    if (
      patch.canvasId !== current.identity.canvasId ||
      patch.ownerSchemaDigest !== current.identity.ownerSchemaDigest ||
      patch.baseStateCommitmentDigest !== current.identity.stateCommitmentDigest
    ) return Object.freeze({ status: "base-mismatch" })
    if (patch.resultStateCommitmentDigest === patch.baseStateCommitmentDigest) {
      return Object.freeze({ status: "rejected" })
    }

    const nodeEntries: [string, CanvasNode][] = []
    const edgeEntries: [string, CanvasEdge][] = []
    const nodeEntityEntries: [string, CanvasEntityRef & { readonly kind: "node" }][] = []
    const edgeEntityEntries: [string, CanvasEntityRef & { readonly kind: "edge" }][] = []
    const newNodesById = new Map<string, CanvasEntityRef & { readonly kind: "node" }>()
    for (const projected of patch.nodes) {
      indexedPatchEntryVisits += 1
      const key = canvasEntityKey(projected.ref)
      if (
        current.nodesByEntityKey.has(key) ||
        current.nodeEntitiesById.has(projected.ref.id) ||
        newNodesById.has(projected.ref.id)
      ) throw new TypeError("Canvas projection patch overwrote a node")
      const entity = freezePortable(structuredClone(projected.ref))
      const node = freezePortable(projectCanvasNodeForDocument(projected))
      nodeEntries.push([key, node])
      nodeEntityEntries.push([entity.id, entity])
      newNodesById.set(entity.id, entity)
    }
    for (const projected of patch.edges) {
      indexedPatchEntryVisits += 1
      const key = canvasEntityKey(projected.ref)
      if (current.edgesByEntityKey.has(key) || current.edgeEntitiesById.has(projected.ref.id)) {
        throw new TypeError("Canvas projection patch overwrote an edge")
      }
      if (!hasExactNodeEntity(current, newNodesById, projected.source) ||
          !hasExactNodeEntity(current, newNodesById, projected.target)) {
        throw new TypeError("Canvas projection patch edge endpoint is unavailable")
      }
      const entity = freezePortable(structuredClone(projected.ref))
      const edge = freezePortable(projectCanvasEdgeForDocument(projected))
      edgeEntries.push([key, edge])
      edgeEntityEntries.push([entity.id, entity])
    }

    const nextIdentity = freezePortable({
      format: "convax.canvas-certified-projection-identity" as const,
      canvasId: patch.canvasId,
      ownerSchemaDigest: patch.ownerSchemaDigest,
      stateCommitmentDigest: patch.resultStateCommitmentDigest,
    })
    const next = issueIndexedCursor({
      identity: nextIdentity,
      metadata: current.metadata,
      nodesByEntityKey: appendCanvasSnapshotEntries(current.nodesByEntityKey, nodeEntries, "derived-projection"),
      edgesByEntityKey: appendCanvasSnapshotEntries(current.edgesByEntityKey, edgeEntries, "derived-projection"),
      nodeEntitiesById: appendCanvasSnapshotEntries(current.nodeEntitiesById, nodeEntityEntries, "derived-projection"),
      edgeEntitiesById: appendCanvasSnapshotEntries(current.edgeEntitiesById, edgeEntityEntries, "derived-projection"),
      materialized: null,
    })
    return Object.freeze({
      status: "applied" as const,
      cursor: next,
      changes: freezePortable({
        nodes: nodeEntries.map(([, node]) => node),
        edges: edgeEntries.map(([, edge]) => edge),
        nodeEntities: nodeEntityEntries.map(([nodeId, entity]) => ({ nodeId, entity })),
        edgeEntities: edgeEntityEntries.map(([edgeId, entity]) => ({ edgeId, entity })),
      }),
    })
  } catch {
    return Object.freeze({ status: "rejected" })
  }
}

/** Package-private keyed read used by the Canvas-owned Renderer store. */
export function readCanvasIndexedProjectionNode(
  cursor: CanvasIndexedProjectionCursor,
  nodeId: string,
): CanvasIndexedProjectionNodeEntry | null {
  const state = indexedCursorStates.get(cursor)
  if (!state || !issuedIndexedCursors.has(cursor as object)) return null
  const entity = state.nodeEntitiesById.get(nodeId)
  if (!entity) return null
  const node = state.nodesByEntityKey.get(canvasEntityKey(entity))
  return node ? Object.freeze({ node, entity }) : null
}

/** Package-private keyed read used by the Canvas-owned Renderer store. */
export function readCanvasIndexedProjectionEdge(
  cursor: CanvasIndexedProjectionCursor,
  edgeId: string,
): CanvasIndexedProjectionEdgeEntry | null {
  const state = indexedCursorStates.get(cursor)
  if (!state || !issuedIndexedCursors.has(cursor as object)) return null
  const entity = state.edgeEntitiesById.get(edgeId)
  if (!entity) return null
  const edge = state.edgesByEntityKey.get(canvasEntityKey(entity))
  return edge ? Object.freeze({ edge, entity }) : null
}

function issueIndexedCursor(state: IndexedProjectionCursorState): CanvasIndexedProjectionCursor {
  let cursor!: CanvasIndexedProjectionCursor
  cursor = Object.freeze({
    identity: state.identity,
    get projection() {
      return materializeIndexedCursor(cursor)
    },
  }) as CanvasIndexedProjectionCursor
  indexedCursorStates.set(cursor, state)
  issuedIndexedCursors.add(cursor)
  return cursor
}

function materializeIndexedCursor(cursor: CanvasIndexedProjectionCursor): CanvasDocumentProjection {
  const state = indexedCursorStates.get(cursor)
  if (!state) throw new TypeError("Canvas indexed projection cursor is invalid")
  if (state.materialized) return state.materialized
  const nodes = [...state.nodesByEntityKey.entries()].sort((left, right) => compareUtf8(left[0], right[0]))
  const edges = [...state.edgesByEntityKey.entries()].sort((left, right) => compareUtf8(left[0], right[0]))
  cursorMaterializedEntryVisits += nodes.length + edges.length
  state.materialized = freezeDocumentProjection({
    document: {
      id: state.identity.canvasId,
      metadata: structuredClone(state.metadata),
      nodes: nodes.map(([, node]) => node),
      edges: edges.map(([, edge]) => edge),
    },
    nodeEntities: state.nodeEntitiesById,
    edgeEntities: state.edgeEntitiesById,
  })
  return state.materialized
}

/** Strict browser-safe codec for a cold/reset projection identity. */
export function parseCanvasCertifiedProjectionIdentity(value: unknown): CanvasCertifiedProjectionIdentity {
  const cloned = structuredClone(value)
  assertExactKeys(
    cloned,
    ["format", "canvasId", "ownerSchemaDigest", "stateCommitmentDigest"],
    "Canvas certified projection identity",
  )
  if (cloned.format !== "convax.canvas-certified-projection-identity") {
    throw new TypeError("Canvas certified projection identity format is invalid")
  }
  return freezePortable({
    format: cloned.format,
    canvasId: parseCanvasId(cloned.canvasId),
    ownerSchemaDigest: parseDigest(cloned.ownerSchemaDigest),
    stateCommitmentDigest: parseDigest(cloned.stateCommitmentDigest),
  })
}

/** Strict browser-safe codec for the bounded IPC projection patch. */
export function parseCanvasCertifiedProjectionPatch(value: unknown): CanvasCertifiedProjectionPatch {
  const cloned = structuredClone(value)
  assertCertifiedProjectionPatch(cloned)
  return freezePortable(cloned)
}

function assertCertifiedProjectionPatch(value: unknown): asserts value is CanvasCertifiedProjectionPatch {
  assertExactKeys(
    value,
    [
      "format",
      "kind",
      "canvasId",
      "ownerSchemaDigest",
      "baseStateCommitmentDigest",
      "resultStateCommitmentDigest",
      "receipt",
      "nodes",
      "edges",
    ],
    "Canvas certified projection patch",
  )
  if (value.format !== "convax.canvas-certified-projection-patch" || value.kind !== "resource-append") {
    throw new TypeError("Canvas certified projection patch discriminator is invalid")
  }
  parseCanvasId(value.canvasId)
  parseDigest(value.ownerSchemaDigest)
  parseDigest(value.baseStateCommitmentDigest)
  parseDigest(value.resultStateCommitmentDigest)
  assertOperationReceipt(value.receipt)
  if (value.receipt.intentKind !== "canvas.resources.add" && value.receipt.intentKind !== "canvas.resources.pending.create") {
    throw new TypeError("Canvas certified projection patch receipt kind is invalid")
  }
  assertDenseArray(value.nodes, "Canvas certified projection patch nodes")
  assertDenseArray(value.edges, "Canvas certified projection patch edges")
  if (
    value.nodes.length < 1 ||
    value.nodes.length > 85 ||
    value.edges.length > 168 ||
    6 * value.nodes.length + 3 * value.edges.length + 2 > 512
  ) throw new TypeError("Canvas certified projection patch cardinality is invalid")

  let priorNode: string | undefined
  for (const node of value.nodes) {
    assertProjectedNode(node)
    if (node.parent !== null) throw new TypeError("Canvas resource append patch node must be top-level")
    if (value.receipt.intentKind === "canvas.resources.add" ? node.data.kind !== "resource" : node.data.kind !== "placeholder") {
      throw new TypeError("Canvas resource append patch node kind disagrees with its receipt")
    }
    const key = canvasEntityKey(node.ref)
    if (priorNode !== undefined && compareUtf8(priorNode, key) >= 0) {
      throw new TypeError("Canvas certified projection patch nodes are not sorted unique")
    }
    priorNode = key
  }
  let priorEdge: string | undefined
  for (const edge of value.edges) {
    assertProjectedEdge(edge)
    const key = canvasEntityKey(edge.ref)
    if (priorEdge !== undefined && compareUtf8(priorEdge, key) >= 0) {
      throw new TypeError("Canvas certified projection patch edges are not sorted unique")
    }
    priorEdge = key
  }
  const nodes = value.nodes as unknown as readonly CanvasProjectedNode[]
  const edges = value.edges as unknown as readonly CanvasProjectedEdge[]
  const patchEntities = [
    ...nodes.map((node) => node.ref),
    ...edges.map((edge) => edge.ref),
  ].sort((left, right) => compareUtf8(canvasEntityKey(left), canvasEntityKey(right)))
  if (!sameCanonicalValue(patchEntities, value.receipt.resultEntities)) {
    throw new TypeError("Canvas certified projection patch entities disagree with its receipt")
  }
}

function assertProjectedNode(value: unknown): asserts value is CanvasProjectedNode {
  assertExactKeys(
    value,
    ["ref", "role", "position", "size", "data", "plugin", "parent", "generationLifecycle"],
    "Canvas projected patch node",
  )
  assertEntityRef(value.ref, "node")
  if (value.role !== "file" && value.role !== "agent") throw new TypeError("Canvas projected patch node role is invalid")
  assertPoint(value.position)
  assertSize(value.size)
  assertNodeData(value.data)
  if (value.role === "agent" ? value.data.kind !== "agent" : value.data.kind === "agent") {
    throw new TypeError("Canvas projected patch node role/data disagree")
  }
  if (value.plugin !== null) assertPluginState(value.plugin)
  if (value.parent !== null) assertEntityRef(value.parent, "node")
  if (
    typeof value.generationLifecycle !== "string" ||
    !new Set(["none", "active", "succeeded", "failed", "dismissed", "recovery-failed"]).has(
      value.generationLifecycle,
    )
  ) {
    throw new TypeError("Canvas projected patch node generation lifecycle is invalid")
  }
}

function assertProjectedEdge(value: unknown): asserts value is CanvasProjectedEdge {
  assertExactKeys(value, ["ref", "source", "target", "data"], "Canvas projected patch edge")
  assertEntityRef(value.ref, "edge")
  assertEntityRef(value.source, "node")
  assertEntityRef(value.target, "node")
  assertEdgeData(value.data)
}

function hasExactNodeEntity(
  current: IndexedProjectionCursorState,
  appended: ReadonlyMap<string, CanvasEntityRef & { readonly kind: "node" }>,
  expected: CanvasEntityRef & { readonly kind: "node" },
): boolean {
  const actual = appended.get(expected.id) ?? current.nodeEntitiesById.get(expected.id)
  return actual !== undefined && canvasEntityKey(actual) === canvasEntityKey(expected)
}

function sortedUniqueKeys(values: readonly string[], label: string): readonly string[] {
  assertDenseArray(values, label)
  const result = [...values]
  let prior: string | undefined
  for (const value of result) {
    if (typeof value !== "string" || (prior !== undefined && compareUtf8(prior, value) >= 0)) {
      throw new TypeError(`${label} must be sorted unique strings`)
    }
    prior = value
  }
  return Object.freeze(result)
}

function requireSortedUniqueEntries<T>(values: readonly (readonly [string, T])[], label: string): void {
  let prior: string | undefined
  for (const [key] of values) {
    if (prior !== undefined && compareUtf8(prior, key) >= 0) throw new TypeError(`${label} are not sorted unique`)
    prior = key
  }
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function freezeDocumentProjection(value: CanvasDocumentProjection): CanvasDocumentProjection {
  return Object.freeze({
    document: freezePortable(value.document),
    nodeEntities: value.nodeEntities,
    edgeEntities: value.edgeEntities,
  })
}

function freezePortable<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const child of value) freezePortable(child)
    return Object.freeze(value) as T
  }
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const child of Object.values(value as Record<string, unknown>)) freezePortable(child)
    return Object.freeze(value)
  }
  return value
}
