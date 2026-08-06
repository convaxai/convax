import type { Digest, Uint64 } from "./codecs"
import { compareDecodedBase64url, incrementUint64, uint64ToBigInt } from "./codecs"
import type { CausalFrontier, CausalHeadRef, DocumentScope, PortableStamp } from "./contracts"
import { KERNEL_DIGEST_DOMAINS, KERNEL_LIMITS } from "./constants"
import { structuredDigest } from "./digest"
import { CollaborationCodecError } from "./errors"
import { compareUtf8 } from "./jcs"
import { parseCausalFrontier, parseCausalHeadRef, parsePortableStamp } from "./parse"

export interface CausalClosurePort {
  /** True only when descendant's verified causal closure contains ancestor. */
  contains(descendantFrameDigest: Digest, ancestorFrameDigest: Digest): boolean | "pending"
}

export function documentScopeDigest(scope: DocumentScope) {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.documentScope, scope)
}

export function causalHeadRefDigest(head: CausalHeadRef) {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.causalHeadRef, parseCausalHeadRef(head))
}

export function causalFrontierDigest(frontier: CausalFrontier) {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.causalFrontier, parseCausalFrontier(frontier))
}

export function comparePortableStamps(left: PortableStamp, right: PortableStamp): number {
  const a = parsePortableStamp(left)
  const b = parsePortableStamp(right)
  const lamport = compareBigInt(uint64ToBigInt(a.lamport), uint64ToBigInt(b.lamport))
  return lamport || compareDecodedBase64url(a.actorId, b.actorId) || compareDecodedBase64url(a.operationId, b.operationId) || compareBigInt(BigInt(a.writeOrdinal), BigInt(b.writeOrdinal))
}

export function nextLamport(frontier: CausalFrontier): Uint64 {
  const parsed = parseCausalFrontier(frontier)
  let maximum = 0n
  for (const head of parsed.heads) {
    const value = uint64ToBigInt(head.lamport)
    if (value > maximum) maximum = value
  }
  return incrementUint64(maximum.toString())
}

export function validateActorSequenceStep(
  previous: CausalHeadRef | null,
  actorId: CausalHeadRef["actorId"],
  actorSequence: Uint64,
  predecessorFrameDigest: Digest | null,
): void {
  const sequence = uint64ToBigInt(actorSequence)
  if (previous === null) {
    if (sequence !== 1n || predecessorFrameDigest !== null) invalid("First actor frame must use sequence one and null predecessor")
    return
  }
  const parsed = parseCausalHeadRef(previous)
  if (parsed.actorId !== actorId || sequence !== uint64ToBigInt(parsed.actorSequence) + 1n || predecessorFrameDigest !== parsed.frameDigest) {
    invalid("Actor frame is not exact +1 with the immediate predecessor digest")
  }
}

export function maxCausalFrontier(
  input: readonly CausalHeadRef[],
  closure: CausalClosurePort,
): CausalFrontier | "pending" {
  if (!Array.isArray(input) || input.length > KERNEL_LIMITS.causalFrontierHeads) invalid("Causal head set exceeds 256")
  const seen = new Set<string>()
  const heads: CausalHeadRef[] = []
  for (const raw of input) {
    const head = parseCausalHeadRef(raw)
    if (seen.has(head.frameDigest)) continue
    seen.add(head.frameDigest)
    heads.push(head)
  }
  const maximal: CausalHeadRef[] = []
  for (const candidate of heads) {
    let dominated = false
    for (const other of heads) {
      if (candidate === other) continue
      const contains = closure.contains(other.frameDigest, candidate.frameDigest)
      if (contains === "pending") return "pending"
      if (contains) {
        dominated = true
        break
      }
    }
    if (!dominated) maximal.push(candidate)
  }
  maximal.sort((left, right) => compareDecodedBase64url(left.actorId, right.actorId))
  for (let index = 1; index < maximal.length; index += 1) {
    if (maximal[index - 1]!.actorId === maximal[index]!.actorId) invalid("Causal frontier contains an unresolved same-actor fork")
  }
  return Object.freeze({ format: "convax.causal-frontier", heads: Object.freeze(maximal) })
}

export function assertFrontierLeq(left: CausalFrontier, right: CausalFrontier, closure: CausalClosurePort): boolean | "pending" {
  const a = parseCausalFrontier(left)
  const b = parseCausalFrontier(right)
  for (const head of a.heads) {
    let found = false
    for (const descendant of b.heads) {
      if (descendant.frameDigest === head.frameDigest) {
        found = true
        break
      }
      const contains = closure.contains(descendant.frameDigest, head.frameDigest)
      if (contains === "pending") return "pending"
      if (contains) {
        found = true
        break
      }
    }
    if (!found) return false
  }
  return true
}

export function compareCausalDependencies(
  left: { readonly kind: string; readonly digest: string },
  right: { readonly kind: string; readonly digest: string },
): number {
  return compareUtf8(left.kind, right.kind) || compareUtf8(left.digest, right.digest)
}

function compareBigInt(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function invalid(message: string): never {
  throw new CollaborationCodecError("invalid-codec", message)
}
