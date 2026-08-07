import { CollaborationCodecError } from "./errors"
import { encodeRestrictedJcs } from "./jcs"

const MAX_EVIDENCE_DEPTH = 128
const MAX_EVIDENCE_CHILDREN = 65_536
const MAX_EVIDENCE_BYTES = 16 * 1024 * 1024
const encoder = new TextEncoder()

declare const canonicalJcsEvidenceBrand: unique symbol
export interface CanonicalJcsEvidence {
  readonly [canonicalJcsEvidenceBrand]: true
}

export interface CanonicalJcsEvidenceIssuer {
  encodeEvidence(value: unknown): CanonicalJcsEvidence
  composeArray(items: readonly CanonicalJcsEvidence[]): CanonicalJcsEvidence
  composeObject(entries: readonly (readonly [string, CanonicalJcsEvidence])[]): CanonicalJcsEvidence
}

type Rope = Readonly<{ kind: "leaf"; bytes: Uint8Array }> | Readonly<{ kind: "branch"; chunks: readonly Rope[] }>
type EvidenceRecord = Readonly<{ issuer: object; rope: Rope; byteLength: number; depth: number }>
const liveEvidence = new WeakMap<object, EvidenceRecord>()
const liveIssuers = new WeakMap<object, object>()

/** Selected-owner-factory seam. Deliberately not exported from the package root. */
export function createCanonicalJcsEvidenceIssuer(): CanonicalJcsEvidenceIssuer {
  const identity = Object.freeze({})
  const issue = (rope: Rope, byteLength: number, depth: number): CanonicalJcsEvidence => {
    if (byteLength > MAX_EVIDENCE_BYTES) invalid("Canonical JCS evidence exceeds the byte limit")
    if (depth > MAX_EVIDENCE_DEPTH) invalid("Canonical JCS evidence exceeds the depth limit")
    const evidence = Object.freeze({}) as CanonicalJcsEvidence
    liveEvidence.set(evidence, Object.freeze({ issuer: identity, rope, byteLength, depth }))
    return evidence
  }
  const requireOwn = (value: CanonicalJcsEvidence): EvidenceRecord => {
    const record = typeof value === "object" && value !== null ? liveEvidence.get(value as object) : undefined
    if (!record || record.issuer !== identity) invalid("Canonical JCS evidence is structural or belongs to another issuer")
    return record
  }
  const issuer = Object.freeze({
    encodeEvidence(value: unknown) {
      const bytes = Uint8Array.from(encodeRestrictedJcs(value))
      return issue(Object.freeze({ kind: "leaf", bytes }), bytes.byteLength, 1)
    },
    composeArray(items: readonly CanonicalJcsEvidence[]) {
      requireDenseChildren(items)
      const children = items.map(requireOwn)
      const chunks: Rope[] = [leaf("[")]
      children.forEach((child, index) => {
        if (index !== 0) chunks.push(leaf(","))
        chunks.push(child.rope)
      })
      chunks.push(leaf("]"))
      return issue(branch(chunks), 2 + children.reduce((sum, child, index) => sum + child.byteLength + (index === 0 ? 0 : 1), 0), 1 + maxDepth(children))
    },
    composeObject(entries: readonly (readonly [string, CanonicalJcsEvidence])[]) {
      requireDenseChildren(entries)
      let previous: string | undefined
      const chunks: Rope[] = [leaf("{")]
      let byteLength = 2
      let depth = 0
      entries.forEach((entry, index) => {
        requireDenseChildren(entry)
        if (entry.length !== 2 || typeof entry[0] !== "string") invalid("Canonical JCS object entry is invalid")
        const [key, evidence] = entry
        if (previous !== undefined && previous >= key) invalid("Canonical JCS object keys must be unique and UTF-16 ordered")
        previous = key
        const child = requireOwn(evidence)
        const keyBytes = Uint8Array.from(encodeRestrictedJcs(key))
        if (index !== 0) chunks.push(leaf(","))
        chunks.push(Object.freeze({ kind: "leaf", bytes: keyBytes }), leaf(":"), child.rope)
        byteLength += (index === 0 ? 0 : 1) + keyBytes.byteLength + 1 + child.byteLength
        depth = Math.max(depth, child.depth)
      })
      chunks.push(leaf("}"))
      return issue(branch(chunks), byteLength, depth + 1)
    },
  }) satisfies CanonicalJcsEvidenceIssuer
  liveIssuers.set(issuer, identity)
  return issuer
}

/** Test-only inspection; production consumers will use a private owner-runtime binder. */
export function testOnlyCanonicalJcsEvidenceBytes(
  issuer: CanonicalJcsEvidenceIssuer,
  evidence: CanonicalJcsEvidence,
): Uint8Array {
  const identity = liveIssuers.get(issuer as object)
  const record = typeof evidence === "object" && evidence !== null ? liveEvidence.get(evidence as object) : undefined
  if (!identity || !record || record.issuer !== identity) invalid("Canonical JCS evidence is not live for this issuer")
  const output = new Uint8Array(record.byteLength)
  let offset = 0
  const write = (rope: Rope) => {
    if (rope.kind === "leaf") {
      output.set(rope.bytes, offset)
      offset += rope.bytes.byteLength
    } else for (const chunk of rope.chunks) write(chunk)
  }
  write(record.rope)
  if (offset !== output.byteLength) invalid("Canonical JCS evidence length mismatch")
  return output
}

export function consumeCanonicalJcsEvidence(
  issuer: CanonicalJcsEvidenceIssuer,
  evidence: CanonicalJcsEvidence,
): Readonly<{ bytes: Uint8Array; byteLength: number }> | null {
  try {
    const bytes = testOnlyCanonicalJcsEvidenceBytes(issuer, evidence)
    return Object.freeze({ bytes, byteLength: bytes.byteLength })
  } catch {
    return null
  }
}

function leaf(value: string): Rope {
  return Object.freeze({ kind: "leaf", bytes: encoder.encode(value) })
}

function branch(chunks: readonly Rope[]): Rope {
  return Object.freeze({ kind: "branch", chunks: Object.freeze([...chunks]) })
}

function maxDepth(records: readonly EvidenceRecord[]): number {
  return records.reduce((maximum, record) => Math.max(maximum, record.depth), 0)
}

function requireDenseChildren(value: readonly unknown[]): void {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_CHILDREN) invalid("Canonical JCS evidence child list is invalid or exceeds the limit")
  if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0) {
    invalid("Canonical JCS evidence child list must be an ordinary array")
  }
  const names = Object.getOwnPropertyNames(value)
  const expected = Array.from({ length: value.length }, (_, index) => String(index)).concat("length")
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    invalid("Canonical JCS evidence child list must be dense")
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    if (!descriptor || !("value" in descriptor) || (name !== "length" && !descriptor.enumerable)) {
      invalid("Canonical JCS evidence child list cannot contain accessors")
    }
  }
}

function invalid(message: string): never {
  throw new CollaborationCodecError("invalid-canonical-jcs", message)
}
