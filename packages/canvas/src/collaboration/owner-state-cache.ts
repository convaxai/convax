import { compareUtf8, documentScopeDigest, encodeRestrictedJcs } from "@convax/collaboration"
import type { CanonicalJcsEvidence, CanonicalJcsEvidenceIssuer, Digest, DocumentScope } from "@convax/collaboration"
import type * as Y from "yjs"
import type { CanvasSnapshot } from "./types"
import { CANVAS_ROOT_NAME, encodeValidatedCanvasCanonicalState, validateCanvasYDoc } from "./ydoc"

const CANONICAL_KEYS = Object.freeze([
  "containments", "edges", "format", "generationBegins", "generationDismissals",
  "generationRecoveryFailures", "generationTerminals", "identity", "meta", "nodes",
  "operations", "semanticHistory",
] as const)
type CanonicalKey = (typeof CANONICAL_KEYS)[number]
type CollectionKey = Exclude<CanonicalKey, "format" | "identity" | "meta">
interface CanonicalPair {
  readonly key: string
  readonly tuple: readonly [string, unknown]
  readonly evidence: CanonicalJcsEvidence
}
interface CanonicalFragments {
  readonly values: ReadonlyMap<CanonicalKey, Uint8Array>
  readonly pairs: ReadonlyMap<CollectionKey, readonly CanonicalPair[]>
  readonly evidences: ReadonlyMap<CanonicalKey, CanonicalJcsEvidence>
  readonly evidence: CanonicalJcsEvidence
}
const fragmentsBySnapshot = new WeakMap<CanvasSnapshot, CanonicalFragments>()
const bytesByPairCollection = new WeakMap<readonly CanonicalPair[], Uint8Array>()
const bytesByPair = new WeakMap<CanonicalPair, Uint8Array>()
let canonicalAssemblies = 0
let collectionByteAssemblies = 0
let pairByteEncodes = 0
let evidenceArrayEntries = 0

interface CacheEntry {
  root: unknown
  snapshot?: CanvasSnapshot
  canonicalBytes?: Uint8Array
  canonicalEvidence?: CanonicalJcsEvidence
  canonicalStateDigest?: Digest
  certifiedDurableHeadDigest?: Digest
  readonly invalidate: () => void
  readonly destroy: () => void
}

/**
 * Process-local acceleration for the Canvas owner protocol port only.
 *
 * This is deliberately not used by the public validator. It is rebuildable from
 * the Y.Doc, observes root identity on every access, and treats every transaction
 * boundary as hostile even when Yjs reports no changed parent type.
 */
export class CanvasOwnerStateCache {
  private readonly entries = new WeakMap<Y.Doc, CacheEntry>()
  private fullValidationTraversals = 0
  private canonicalTraversals = 0

  validate(document: Y.Doc): CanvasSnapshot {
    const entry = this.entry(document)
    if (entry.snapshot !== undefined) return entry.snapshot
    this.fullValidationTraversals += 1
    const snapshot = validateCanvasYDoc(document)
    entry.snapshot = snapshot
    return snapshot
  }

  canonicalStateBytes(document: Y.Doc, issuer?: CanonicalJcsEvidenceIssuer): Uint8Array {
    const entry = this.entry(document)
    if (entry.canonicalBytes === undefined) {
      this.canonicalTraversals += 1
      const snapshot = this.validate(document)
      if (issuer) {
        try {
          const fragments = fragmentsBySnapshot.get(snapshot) ?? createFragments(snapshot, issuer)
          if (!fragmentsBySnapshot.has(snapshot)) fragmentsBySnapshot.set(snapshot, fragments)
          entry.canonicalBytes = assemble(fragments)
          entry.canonicalEvidence = fragments.evidence
        } catch {
          // Branded canonical evidence is acceleration-only. A legal validated
          // owner state always retains the exact canonical encoder fallback.
          entry.canonicalBytes = encodeValidatedCanvasCanonicalState(snapshot)
          entry.canonicalEvidence = undefined
        }
      } else {
        entry.canonicalBytes = encodeValidatedCanvasCanonicalState(snapshot)
      }
    }
    return entry.canonicalBytes.slice()
  }

  canonicalEvidence(document: Y.Doc): CanonicalJcsEvidence | null {
    return this.entry(document).canonicalEvidence ?? null
  }

  installValidatedSnapshot(
    document: Y.Doc,
    snapshot: CanvasSnapshot,
  ): void {
    const entry = this.entry(document)
    entry.snapshot = snapshot
    // The current protocol commits the issuer-bound Merkle root. Canonical JCS
    // bytes/evidence are cold audit and recovery material only; constructing a
    // flat evidence array here would enumerate retained history on every append.
    entry.canonicalBytes = undefined
    entry.canonicalEvidence = undefined
    entry.canonicalStateDigest = undefined
    entry.certifiedDurableHeadDigest = undefined
  }

  transferValidatedSnapshot(
    source: Y.Doc,
    target: Y.Doc,
    snapshot: CanvasSnapshot,
    canonicalStateDigest: Digest,
    durableHeadDigest: Digest,
  ): void {
    const sourceEntry = this.entry(source)
    if (sourceEntry.snapshot !== snapshot) return
    const targetEntry = this.entry(target)
    targetEntry.snapshot = snapshot
    targetEntry.canonicalBytes = sourceEntry.canonicalBytes?.slice()
    targetEntry.canonicalEvidence = sourceEntry.canonicalEvidence
    targetEntry.canonicalStateDigest = canonicalStateDigest
    targetEntry.certifiedDurableHeadDigest = durableHeadDigest
  }

  readCertifiedCanonicalDigest(
    document: Y.Doc,
    scope: DocumentScope,
    durableHeadDigest: Digest,
    expectedCanonicalStateDigest: Digest,
  ): Digest | null {
    const entry = this.entry(document)
    const identity = entry.snapshot?.identity
    if (
      entry.snapshot === undefined ||
      identity === undefined ||
      entry.certifiedDurableHeadDigest !== durableHeadDigest ||
      entry.canonicalStateDigest !== expectedCanonicalStateDigest ||
      scope.docKind !== "canvas" || scope.docId !== identity.canvasId ||
      documentScopeDigest(scope) !== identity.scopeId
    ) return null
    return entry.canonicalStateDigest
  }

  /** Package-private benchmark evidence; never enters protocol or diagnostics. */
  traversalCounts(): Readonly<{ fullValidation: number; canonical: number }> {
    return Object.freeze({ fullValidation: this.fullValidationTraversals, canonical: this.canonicalTraversals })
  }

  /** Package-private canonical-work evidence. Serialization remains separately visible. */
  canonicalWorkCounts(): Readonly<{
    assemblies: number
    collectionByteAssemblies: number
    pairByteEncodes: number
    evidenceArrayEntries: number
  }> {
    return Object.freeze({
      assemblies: canonicalAssemblies,
      collectionByteAssemblies,
      pairByteEncodes,
      evidenceArrayEntries,
    })
  }

  private entry(document: Y.Doc): CacheEntry {
    const root = document.share.get(CANVAS_ROOT_NAME)
    const existing = this.entries.get(document)
    if (existing !== undefined && existing.root === root) return existing
    if (existing !== undefined) this.detach(document, existing)

    const entry = {} as CacheEntry
    Object.assign(entry, {
      root,
      invalidate: () => {
        entry.snapshot = undefined
        entry.canonicalBytes = undefined
        entry.canonicalEvidence = undefined
        entry.canonicalStateDigest = undefined
        entry.certifiedDurableHeadDigest = undefined
      },
      destroy: () => this.detach(document, entry),
    } satisfies CacheEntry)
    document.on("beforeTransaction", entry.invalidate)
    document.on("afterTransaction", entry.invalidate)
    document.on("destroy", entry.destroy)
    this.entries.set(document, entry)
    return entry
  }

  private detach(document: Y.Doc, entry: CacheEntry): void {
    document.off("beforeTransaction", entry.invalidate)
    document.off("afterTransaction", entry.invalidate)
    document.off("destroy", entry.destroy)
    entry.invalidate()
    this.entries.delete(document)
  }
}

function createFragments(
  snapshot: CanvasSnapshot,
  issuer: CanonicalJcsEvidenceIssuer,
): CanonicalFragments {
  const values = new Map<CanonicalKey, Uint8Array>()
  const pairs = new Map<CollectionKey, readonly CanonicalPair[]>()
  const evidences = new Map<CanonicalKey, CanonicalJcsEvidence>()
  for (const key of CANONICAL_KEYS) {
    if (isCollection(key)) {
      const nextPairs = allPairs(snapshotCollection(snapshot, key), key, issuer)
      pairs.set(key, nextPairs)
      evidenceArrayEntries += nextPairs.length
      evidences.set(key, issuer.composeArray(nextPairs.map((item) => item.evidence)))
    } else {
      const value = key === "format" ? "convax.canvas-canonical-state" : snapshot[key]
      values.set(key, encodeRestrictedJcs(value))
      evidences.set(key, issuer.encodeEvidence(value))
    }
  }
  const evidence = issuer.composeObject(CANONICAL_KEYS.map((key) => [key, evidences.get(key)!] as const))
  return Object.freeze({ values, pairs, evidences, evidence })
}

function isCollection(key: CanonicalKey): key is CollectionKey {
  return key !== "format" && key !== "identity" && key !== "meta"
}

function snapshotCollection(snapshot: CanvasSnapshot, key: CollectionKey): ReadonlyMap<string, unknown> {
  return snapshot[key] as ReadonlyMap<string, unknown>
}

function canonicalPairValue(key: CollectionKey, value: unknown): unknown {
  if (key === "nodes" || key === "edges") {
    const { key: _ignored, ...record } = value as Record<string, unknown>
    return record
  }
  return value
}

function pair(key: string, value: unknown, collection: CollectionKey, issuer: CanonicalJcsEvidenceIssuer): CanonicalPair {
  const canonicalValue = canonicalPairValue(collection, value)
  const tuple = Object.freeze([key, canonicalValue] as const)
  return Object.freeze({ key, tuple, evidence: issuer.encodeEvidence(tuple) })
}

function allPairs(
  collection: ReadonlyMap<string, unknown>,
  key: CollectionKey,
  issuer: CanonicalJcsEvidenceIssuer,
): readonly CanonicalPair[] {
  return Object.freeze(
    [...collection].sort(([a], [b]) => compareUtf8(a, b)).map(([name, value]) => pair(name, value, key, issuer)),
  )
}

function encodePairs(pairs: readonly CanonicalPair[]): Uint8Array {
  const cached = bytesByPairCollection.get(pairs)
  if (cached) return cached
  collectionByteAssemblies += 1
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = [encoder.encode("[")]
  let index = 0
  for (const item of pairs) {
    if (index !== 0) parts.push(encoder.encode(","))
    parts.push(encodePair(item))
    index += 1
  }
  parts.push(encoder.encode("]"))
  const result = join(parts)
  bytesByPairCollection.set(pairs, result)
  return result
}

function encodePair(pair: CanonicalPair): Uint8Array {
  const cached = bytesByPair.get(pair)
  if (cached) return cached
  pairByteEncodes += 1
  const bytes = encodeRestrictedJcs(pair.tuple)
  bytesByPair.set(pair, bytes)
  return bytes
}

function assemble(fragments: CanonicalFragments): Uint8Array {
  canonicalAssemblies += 1
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = [encoder.encode("{")]
  CANONICAL_KEYS.forEach((key, index) => parts.push(
    ...(index ? [encoder.encode(",")] : []),
    encodeRestrictedJcs(key),
    encoder.encode(":"),
    isCollection(key) ? encodePairs(fragments.pairs.get(key)!) : fragments.values.get(key)!,
  ))
  parts.push(encoder.encode("}"))
  return join(parts)
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0)); let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.byteLength }
  return result
}
