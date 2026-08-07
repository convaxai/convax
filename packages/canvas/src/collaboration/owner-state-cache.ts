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
interface CanonicalPair { readonly key: string; readonly value: unknown; readonly bytes: Uint8Array; readonly evidence: CanonicalJcsEvidence }
interface CanonicalFragments {
  readonly values: ReadonlyMap<CanonicalKey, Uint8Array>
  readonly pairs: ReadonlyMap<CollectionKey, readonly CanonicalPair[]>
  readonly evidence: CanonicalJcsEvidence
  readonly bytes: Uint8Array
}
const fragmentsBySnapshot = new WeakMap<CanvasSnapshot, CanonicalFragments>()

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
        const fragments = createFragments(snapshot, issuer)
        fragmentsBySnapshot.set(snapshot, fragments)
        entry.canonicalBytes = fragments.bytes
        entry.canonicalEvidence = fragments.evidence
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
    incremental?: Readonly<{
      base: CanvasSnapshot
      changed: ReadonlyMap<string, readonly string[]>
      issuer: CanonicalJcsEvidenceIssuer
    }>,
  ): void {
    const entry = this.entry(document)
    entry.snapshot = snapshot
    entry.canonicalStateDigest = undefined
    entry.certifiedDurableHeadDigest = undefined
    const baseFragments = incremental ? fragmentsBySnapshot.get(incremental.base) : undefined
    if (incremental && baseFragments) {
      const fragments = createFragments(snapshot, incremental.issuer, baseFragments, incremental.changed)
      fragmentsBySnapshot.set(snapshot, fragments)
      entry.canonicalBytes = fragments.bytes
      entry.canonicalEvidence = fragments.evidence
    } else {
      entry.canonicalBytes = undefined
      entry.canonicalEvidence = undefined
    }
  }

  transferValidatedSnapshot(
    source: Y.Doc,
    target: Y.Doc,
    snapshot: CanvasSnapshot,
    canonicalStateDigest: Digest,
    durableHeadDigest: Digest,
  ): void {
    const sourceEntry = this.entry(source)
    if (sourceEntry.snapshot !== snapshot || sourceEntry.canonicalBytes === undefined) return
    const targetEntry = this.entry(target)
    targetEntry.snapshot = snapshot
    targetEntry.canonicalBytes = sourceEntry.canonicalBytes?.slice()
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
      entry.snapshot === undefined || entry.canonicalBytes === undefined || identity === undefined ||
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
  base?: CanonicalFragments,
  changed?: ReadonlyMap<string, readonly string[]>,
): CanonicalFragments {
  const values = new Map<CanonicalKey, Uint8Array>()
  const pairs = new Map<CollectionKey, readonly CanonicalPair[]>()
  const evidences = new Map<CanonicalKey, CanonicalJcsEvidence>()
  for (const key of CANONICAL_KEYS) {
    const changedKeys = changed?.get(key)
    if (base && changed && changedKeys === undefined) {
      values.set(key, base.values.get(key)!.slice())
      evidences.set(key, fragmentEvidence(base, key, issuer, snapshot))
      if (isCollection(key)) pairs.set(key, base.pairs.get(key)!)
      continue
    }
    if (isCollection(key)) {
      const nextPairs = base && changedKeys
        ? insertPairs(base.pairs.get(key)!, snapshotCollection(snapshot, key), key, changedKeys, issuer)
        : allPairs(snapshotCollection(snapshot, key), key, issuer)
      pairs.set(key, nextPairs)
      values.set(key, encodePairs(nextPairs))
      evidences.set(key, issuer.composeArray(nextPairs.map((pair) => pair.evidence)))
    } else {
      const value = key === "format" ? "convax.canvas-canonical-state" : snapshot[key]
      values.set(key, encodeRestrictedJcs(value))
      evidences.set(key, issuer.encodeEvidence(value))
    }
  }
  const evidence = issuer.composeObject(CANONICAL_KEYS.map((key) => [key, evidences.get(key)!] as const))
  return Object.freeze({ values, pairs, evidence, bytes: assemble(values) })
}

function fragmentEvidence(base: CanonicalFragments, key: CanonicalKey, issuer: CanonicalJcsEvidenceIssuer, snapshot: CanvasSnapshot): CanonicalJcsEvidence {
  if (isCollection(key)) return issuer.composeArray(base.pairs.get(key)!.map((pair) => pair.evidence))
  return issuer.encodeEvidence(key === "format" ? "convax.canvas-canonical-state" : snapshot[key])
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
  const tuple = [key, canonicalValue] as const
  return Object.freeze({ key, value: canonicalValue, bytes: encodeRestrictedJcs(tuple), evidence: issuer.encodeEvidence(tuple) })
}

function allPairs(collection: ReadonlyMap<string, unknown>, key: CollectionKey, issuer: CanonicalJcsEvidenceIssuer): readonly CanonicalPair[] {
  return Object.freeze([...collection].sort(([a], [b]) => compareUtf8(a, b)).map(([name, value]) => pair(name, value, key, issuer)))
}

function insertPairs(base: readonly CanonicalPair[], collection: ReadonlyMap<string, unknown>, collectionKey: CollectionKey, keys: readonly string[], issuer: CanonicalJcsEvidenceIssuer): readonly CanonicalPair[] {
  const result = [...base]
  for (const key of keys) {
    const value = collection.get(key)
    if (value === undefined) throw new TypeError(`Canvas canonical insertion is missing: ${key}`)
    let low = 0; let high = result.length
    while (low < high) { const middle = (low + high) >>> 1; if (compareUtf8(result[middle]!.key, key) < 0) low = middle + 1; else high = middle }
    if (result[low]?.key === key) throw new TypeError(`Canvas canonical insertion overwrote: ${key}`)
    result.splice(low, 0, pair(key, value, collectionKey, issuer))
  }
  return Object.freeze(result)
}

function encodePairs(pairs: readonly CanonicalPair[]): Uint8Array {
  return join([new TextEncoder().encode("["), ...pairs.flatMap((item, index) => index ? [new TextEncoder().encode(","), item.bytes] : [item.bytes]), new TextEncoder().encode("]")])
}

function assemble(values: ReadonlyMap<CanonicalKey, Uint8Array>): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = [encoder.encode("{")]
  CANONICAL_KEYS.forEach((key, index) => parts.push(...(index ? [encoder.encode(",")] : []), encodeRestrictedJcs(key), encoder.encode(":"), values.get(key)!))
  parts.push(encoder.encode("}"))
  return join(parts)
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0)); let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.byteLength }
  return result
}
