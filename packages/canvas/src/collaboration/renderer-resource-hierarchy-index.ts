import {
  assertBoundedNfcString,
  assertDenseArray,
  assertExactKeys,
} from "@convax/collaboration"
import { CanvasPersistentRuntimeMap } from "../persistent-runtime-map"
import { canvasCanonicalResourceIdentity } from "../resource-runtime-projection"
import type { CanvasDocumentProjection } from "./projection"
import {
  parseCanvasCertifiedProjectionIdentity,
  type CanvasAppliedProjectionPatchChanges,
  type CanvasCertifiedProjectionIdentity,
} from "./projection-patch"
import type { CanvasEntityRef } from "./types"
import { assertEntityRef, canvasEntityKey } from "./validation"

const maximumHierarchyEntries = 100_000
const maximumHierarchyDeltaEntries = 85
const maximumHierarchySegments = 256
const maximumHierarchyKeyBytes = 4_096
const hierarchyTextEncoder = new TextEncoder()

export interface CanvasRendererResourceHierarchyKey {
  readonly segments: readonly string[]
}

export type CanvasRendererResourceHierarchyClassification =
  | Readonly<{
      readonly kind: "path"
      readonly key: Readonly<{
        readonly segments: readonly string[]
        readonly coverage: "leaf" | "subtree"
      }>
    }>
  | Readonly<{ readonly kind: "not-path-backed" }>

export interface CanvasRendererResourceHierarchyEntry {
  readonly entity: CanvasEntityRef & { readonly kind: "node" }
  readonly nodeId: string
  readonly classification: CanvasRendererResourceHierarchyClassification
}

export interface CanvasRendererResourceHierarchySnapshot {
  readonly format: "convax.canvas-resource-hierarchy-snapshot"
  readonly projectionIdentity: CanvasCertifiedProjectionIdentity
  readonly completeness: "complete" | "unavailable"
  readonly entries: readonly CanvasRendererResourceHierarchyEntry[]
}

export interface CanvasRendererResourceHierarchyDelta {
  readonly format: "convax.canvas-resource-hierarchy-delta"
  readonly projectionIdentity: CanvasCertifiedProjectionIdentity
  readonly entries: readonly CanvasRendererResourceHierarchyEntry[]
}

export type CanvasRendererResourceHierarchyTarget = Readonly<{
  readonly entity: CanvasEntityRef & { readonly kind: "node" }
  readonly nodeId: string
}>

export type CanvasRendererResourceHierarchyQueryResult =
  | Readonly<{
      readonly status: "available"
      readonly targets: readonly CanvasRendererResourceHierarchyTarget[]
    }>
  | Readonly<{ readonly status: "unavailable" }>

type TargetBucket = CanvasPersistentRuntimeMap<CanvasRendererResourceHierarchyTarget>
type PrefixMultimap = CanvasPersistentRuntimeMap<TargetBucket>

let coldProjectionNodeVisits = 0
let coldClassificationVisits = 0
let deltaClassificationVisits = 0
let queryAncestorLookups = 0
let queryPrefixBucketsVisited = 0
let queryTargetsVisited = 0

/** Package-private structural evidence for exact hierarchy invalidation. */
export function canvasRendererResourceHierarchyWorkCounts() {
  return Object.freeze({
    coldClassificationVisits,
    coldProjectionNodeVisits,
    deltaClassificationVisits,
    queryAncestorLookups,
    queryPrefixBucketsVisited,
    queryTargetsVisited,
  })
}

/** Strict host-neutral codec for a cold/reset hierarchy sidecar. */
export function parseCanvasRendererResourceHierarchySnapshot(
  value: unknown,
): CanvasRendererResourceHierarchySnapshot {
  const cloned = structuredClone(value)
  assertExactKeys(
    cloned,
    ["format", "projectionIdentity", "completeness", "entries"],
    "Canvas Renderer resource hierarchy snapshot",
  )
  if (cloned.format !== "convax.canvas-resource-hierarchy-snapshot") {
    throw new TypeError("Canvas Renderer resource hierarchy snapshot format is invalid")
  }
  if (cloned.completeness !== "complete" && cloned.completeness !== "unavailable") {
    throw new TypeError("Canvas Renderer resource hierarchy snapshot completeness is invalid")
  }
  assertDenseArray(cloned.entries, "Canvas Renderer resource hierarchy snapshot entries")
  if (cloned.entries.length > maximumHierarchyEntries) {
    throw new TypeError("Canvas Renderer resource hierarchy snapshot is too large")
  }
  if (cloned.completeness === "unavailable" && cloned.entries.length !== 0) {
    throw new TypeError("Unavailable Canvas Renderer resource hierarchy must not carry entries")
  }
  return freezePortable({
    format: cloned.format,
    projectionIdentity: parseCanvasCertifiedProjectionIdentity(cloned.projectionIdentity),
    completeness: cloned.completeness,
    entries: cloned.entries.map((entry) => parseHierarchyEntry(entry)),
  })
}

/** Strict host-neutral codec for one certified append hierarchy sidecar. */
export function parseCanvasRendererResourceHierarchyDelta(
  value: unknown,
): CanvasRendererResourceHierarchyDelta {
  const cloned = structuredClone(value)
  assertExactKeys(
    cloned,
    ["format", "projectionIdentity", "entries"],
    "Canvas Renderer resource hierarchy delta",
  )
  if (cloned.format !== "convax.canvas-resource-hierarchy-delta") {
    throw new TypeError("Canvas Renderer resource hierarchy delta format is invalid")
  }
  assertDenseArray(cloned.entries, "Canvas Renderer resource hierarchy delta entries")
  if (cloned.entries.length > maximumHierarchyDeltaEntries) {
    throw new TypeError("Canvas Renderer resource hierarchy delta is too large")
  }
  return freezePortable({
    format: cloned.format,
    projectionIdentity: parseCanvasCertifiedProjectionIdentity(cloned.projectionIdentity),
    entries: cloned.entries.map((entry) => parseHierarchyEntry(entry)),
  })
}

/**
 * Disposable Canvas-owned ordered prefix multimaps. `allBelow` stores exact
 * path buckets for a descendant prefix-range query; `subtreeHere` stores only
 * directory-like resources for exact proper-ancestor lookups. Storage remains
 * O(N), append path-copies logarithmic map paths, and query is
 * O(depth log N + k).
 */
export class CanvasRendererResourceHierarchyIndex {
  #allBelow = CanvasPersistentRuntimeMap.empty<TargetBucket>()
  #subtreeHere = CanvasPersistentRuntimeMap.empty<TargetBucket>()
  #available = false
  #identity: CanvasCertifiedProjectionIdentity

  private constructor(identity: CanvasCertifiedProjectionIdentity) {
    this.#identity = identity
  }

  static fromSnapshot(input: Readonly<{
    readonly identity: CanvasCertifiedProjectionIdentity
    readonly projection: CanvasDocumentProjection
    readonly resourceHierarchy: unknown
  }>): CanvasRendererResourceHierarchyIndex {
    const identity = parseCanvasCertifiedProjectionIdentity(input.identity)
    const index = new CanvasRendererResourceHierarchyIndex(identity)
    index.#installSnapshot(input.projection, input.resourceHierarchy)
    return index
  }

  applyDelta(input: Readonly<{
    readonly changes: CanvasAppliedProjectionPatchChanges
    readonly identity: CanvasCertifiedProjectionIdentity
    readonly resourceHierarchy: unknown
  }>): void {
    this.#identity = parseCanvasCertifiedProjectionIdentity(input.identity)
    if (!this.#available) return
    try {
      const delta = parseCanvasRendererResourceHierarchyDelta(input.resourceHierarchy)
      if (!sameProjectionIdentity(delta.projectionIdentity, this.#identity)) {
        throw new TypeError("Canvas Renderer resource hierarchy delta identity is stale")
      }
      const expected = expectedChangedResources(input.changes)
      const entries = requireExactEntries(delta.entries, expected)
      let allBelow = this.#allBelow
      let subtreeHere = this.#subtreeHere
      for (const entry of entries) {
        deltaClassificationVisits += 1
        if (entry.classification.kind !== "path") continue
        const encoded = encodeHierarchyKey(entry.classification.key.segments)
        const target = targetFor(entry)
        allBelow = appendTarget(allBelow, encoded, target)
        if (entry.classification.key.coverage === "subtree") {
          subtreeHere = appendTarget(subtreeHere, encoded, target)
        }
      }
      this.#allBelow = allBelow
      this.#subtreeHere = subtreeHere
    } catch {
      this.#makeUnavailable()
    }
  }

  query(keyValue: CanvasRendererResourceHierarchyKey): CanvasRendererResourceHierarchyQueryResult {
    if (!this.#available) return unavailableQueryResult
    let key: CanvasRendererResourceHierarchyKey
    try {
      key = parseCanvasRendererResourceHierarchyKey(keyValue)
    } catch {
      return unavailableQueryResult
    }

    const targets: CanvasRendererResourceHierarchyTarget[] = []
    const properAncestorKeys = encodedProperAncestorKeys(key.segments)
    for (const ancestorKey of properAncestorKeys) {
      queryAncestorLookups += 1
      const bucket = this.#subtreeHere.get(ancestorKey)
      if (!bucket) continue
      appendBucketTargets(bucket, targets)
    }

    const prefix = encodeHierarchyKey(key.segments)
    const upperBound = hierarchyPrefixUpperBound(prefix)
    for (const [, bucket] of this.#allBelow.entriesInRange(prefix, upperBound)) {
      queryPrefixBucketsVisited += 1
      appendBucketTargets(bucket, targets)
    }
    return Object.freeze({ status: "available" as const, targets: Object.freeze(targets) })
  }

  #installSnapshot(
    projection: CanvasDocumentProjection,
    snapshotValue: unknown,
  ): void {
    try {
      const snapshot = parseCanvasRendererResourceHierarchySnapshot(snapshotValue)
      if (
        snapshot.completeness !== "complete" ||
        !sameProjectionIdentity(snapshot.projectionIdentity, this.#identity)
      ) {
        throw new TypeError("Canvas Renderer resource hierarchy snapshot is unavailable or stale")
      }
      const expected = expectedProjectionResources(projection)
      const entries = requireExactEntries(snapshot.entries, expected)
      let allBelow = CanvasPersistentRuntimeMap.empty<TargetBucket>()
      let subtreeHere = CanvasPersistentRuntimeMap.empty<TargetBucket>()
      for (const entry of entries) {
        coldClassificationVisits += 1
        if (entry.classification.kind !== "path") continue
        const encoded = encodeHierarchyKey(entry.classification.key.segments)
        const target = targetFor(entry)
        allBelow = appendTarget(allBelow, encoded, target)
        if (entry.classification.key.coverage === "subtree") {
          subtreeHere = appendTarget(subtreeHere, encoded, target)
        }
      }
      this.#allBelow = allBelow
      this.#subtreeHere = subtreeHere
      this.#available = true
    } catch {
      this.#makeUnavailable()
    }
  }

  #makeUnavailable(): void {
    this.#available = false
    this.#allBelow = CanvasPersistentRuntimeMap.empty()
    this.#subtreeHere = CanvasPersistentRuntimeMap.empty()
  }
}

const unavailableQueryResult = Object.freeze({ status: "unavailable" as const })

function parseCanvasRendererResourceHierarchyKey(value: unknown): CanvasRendererResourceHierarchyKey {
  const cloned = structuredClone(value)
  assertExactKeys(cloned, ["segments"], "Canvas Renderer resource hierarchy key")
  assertHierarchySegments(cloned.segments)
  return freezePortable({ segments: [...cloned.segments] })
}

function parseHierarchyEntry(value: unknown): CanvasRendererResourceHierarchyEntry {
  assertExactKeys(value, ["entity", "nodeId", "classification"], "Canvas Renderer resource hierarchy entry")
  assertEntityRef(value.entity, "node")
  if (value.nodeId !== value.entity.id) {
    throw new TypeError("Canvas Renderer resource hierarchy node binding is invalid")
  }
  const classification = parseHierarchyClassification(value.classification)
  return freezePortable({
    entity: structuredClone(value.entity) as CanvasEntityRef & { readonly kind: "node" },
    nodeId: value.nodeId,
    classification,
  })
}

function parseHierarchyClassification(value: unknown): CanvasRendererResourceHierarchyClassification {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Canvas Renderer resource hierarchy classification is invalid")
  }
  if ((value as { kind?: unknown }).kind === "not-path-backed") {
    assertExactKeys(value, ["kind"], "Canvas Renderer non-path resource classification")
    return Object.freeze({ kind: "not-path-backed" as const })
  }
  assertExactKeys(value, ["kind", "key"], "Canvas Renderer path resource classification")
  if (value.kind !== "path") {
    throw new TypeError("Canvas Renderer resource hierarchy classification kind is invalid")
  }
  assertExactKeys(value.key, ["segments", "coverage"], "Canvas Renderer resource hierarchy path key")
  assertHierarchySegments(value.key.segments)
  if (value.key.coverage !== "leaf" && value.key.coverage !== "subtree") {
    throw new TypeError("Canvas Renderer resource hierarchy coverage is invalid")
  }
  return freezePortable({
    kind: "path" as const,
    key: {
      segments: [...value.key.segments],
      coverage: value.key.coverage,
    },
  })
}

function assertHierarchySegments(value: unknown): asserts value is readonly string[] {
  assertDenseArray(value, "Canvas Renderer resource hierarchy segments")
  if (value.length < 1 || value.length > maximumHierarchySegments) {
    throw new TypeError("Canvas Renderer resource hierarchy segment count is invalid")
  }
  let totalBytes = 0
  for (const segment of value) {
    assertBoundedNfcString(segment, 1, 255, "Canvas Renderer resource hierarchy segment")
    if (
      segment === "." ||
      segment === ".." ||
      segment.includes("\u0000") ||
      segment.includes("/") ||
      segment.includes("\\")
    ) {
      throw new TypeError("Canvas Renderer resource hierarchy segment is not portable")
    }
    totalBytes += hierarchyTextEncoder.encode(segment).byteLength
  }
  if (totalBytes + value.length > maximumHierarchyKeyBytes) {
    throw new TypeError("Canvas Renderer resource hierarchy key is too large")
  }
}

function expectedProjectionResources(
  projection: CanvasDocumentProjection,
): ReadonlyMap<string, CanvasEntityRef & { readonly kind: "node" }> {
  const expected = new Map<string, CanvasEntityRef & { readonly kind: "node" }>()
  for (const node of projection.document.nodes) {
    coldProjectionNodeVisits += 1
    if (canvasCanonicalResourceIdentity(node) === undefined) continue
    const entity = projection.nodeEntities.get(node.id)
    if (!entity || entity.kind !== "node" || entity.id !== node.id) {
      throw new TypeError("Canvas Renderer resource hierarchy projection entity is unavailable")
    }
    expected.set(node.id, entity)
  }
  return expected
}

function expectedChangedResources(
  changes: CanvasAppliedProjectionPatchChanges,
): ReadonlyMap<string, CanvasEntityRef & { readonly kind: "node" }> {
  const entities = new Map(changes.nodeEntities.map((entry) => [entry.nodeId, entry.entity]))
  const expected = new Map<string, CanvasEntityRef & { readonly kind: "node" }>()
  for (const node of changes.nodes) {
    if (canvasCanonicalResourceIdentity(node) === undefined) continue
    const entity = entities.get(node.id)
    if (!entity || entity.kind !== "node" || entity.id !== node.id) {
      throw new TypeError("Canvas Renderer resource hierarchy changed entity is unavailable")
    }
    expected.set(node.id, entity)
  }
  return expected
}

function requireExactEntries(
  entries: readonly CanvasRendererResourceHierarchyEntry[],
  expected: ReadonlyMap<string, CanvasEntityRef & { readonly kind: "node" }>,
): readonly CanvasRendererResourceHierarchyEntry[] {
  if (entries.length !== expected.size) {
    throw new TypeError("Canvas Renderer resource hierarchy classifications are incomplete")
  }
  const seen = new Set<string>()
  for (const entry of entries) {
    const entity = expected.get(entry.nodeId)
    const key = canvasEntityKey(entry.entity)
    if (
      seen.has(key) ||
      !entity ||
      entity.id !== entry.entity.id ||
      entity.incarnation !== entry.entity.incarnation
    ) {
      throw new TypeError("Canvas Renderer resource hierarchy classification binding is invalid")
    }
    seen.add(key)
  }
  return entries
}

function appendTarget(
  map: PrefixMultimap,
  encodedPath: string,
  target: CanvasRendererResourceHierarchyTarget,
): PrefixMultimap {
  const current = map.get(encodedPath) ?? CanvasPersistentRuntimeMap.empty<CanvasRendererResourceHierarchyTarget>()
  const next = current.set(canvasEntityKey(target.entity), target)
  if (next.size !== current.size + 1) {
    throw new TypeError("Canvas Renderer resource hierarchy target already exists")
  }
  return map.set(encodedPath, next)
}

function appendBucketTargets(
  bucket: TargetBucket,
  output: CanvasRendererResourceHierarchyTarget[],
): void {
  for (const target of bucket.values()) {
    queryTargetsVisited += 1
    output.push(target)
  }
}

function targetFor(entry: CanvasRendererResourceHierarchyEntry): CanvasRendererResourceHierarchyTarget {
  return Object.freeze({ entity: entry.entity, nodeId: entry.nodeId })
}

function encodeHierarchyKey(segments: readonly string[]): string {
  return `${segments.join("\u0000")}\u0000`
}

function hierarchyPrefixUpperBound(prefix: string): string {
  return `${prefix.slice(0, -1)}\u0001`
}

function encodedProperAncestorKeys(segments: readonly string[]): readonly string[] {
  const result: string[] = []
  for (let length = 1; length < segments.length; length += 1) {
    result.push(encodeHierarchyKey(segments.slice(0, length)))
  }
  return result
}

function sameProjectionIdentity(
  left: CanvasCertifiedProjectionIdentity,
  right: CanvasCertifiedProjectionIdentity,
): boolean {
  return (
    left.format === right.format &&
    left.canvasId === right.canvasId &&
    left.ownerSchemaDigest === right.ownerSchemaDigest &&
    left.stateCommitmentDigest === right.stateCommitmentDigest
  )
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
