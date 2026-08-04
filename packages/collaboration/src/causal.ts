import type { DigestV2, Uint64V2 } from "./codecs"
import { compareDecodedBase64urlV2, incrementUint64V2, uint64ToBigIntV2 } from "./codecs"
import type { CausalFrontierV2, CausalHeadRefV2, DocumentScopeV2, PortableStampV2 } from "./contracts"
import { KERNEL_DIGEST_DOMAINS_V2, KERNEL_LIMITS_V2 } from "./constants"
import { structuredDigestV2 } from "./digest"
import { CollaborationCodecErrorV2 } from "./errors"
import { compareUtf8V2 } from "./jcs"
import { parseCausalFrontierV2, parseCausalHeadRefV2, parsePortableStampV2 } from "./parse"

export interface CausalClosurePortV2 {
  /** True only when descendant's verified causal closure contains ancestor. */
  contains(descendantFrameDigest: DigestV2, ancestorFrameDigest: DigestV2): boolean | "pending"
}

export function documentScopeDigestV2(scope: DocumentScopeV2) {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.documentScope, scope)
}

export function causalHeadRefDigestV2(head: CausalHeadRefV2) {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.causalHeadRef, parseCausalHeadRefV2(head))
}

export function causalFrontierDigestV2(frontier: CausalFrontierV2) {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.causalFrontier, parseCausalFrontierV2(frontier))
}

export function comparePortableStampsV2(left: PortableStampV2, right: PortableStampV2): number {
  const a = parsePortableStampV2(left)
  const b = parsePortableStampV2(right)
  const lamport = compareBigInt(uint64ToBigIntV2(a.lamport), uint64ToBigIntV2(b.lamport))
  return lamport || compareDecodedBase64urlV2(a.actorId, b.actorId) || compareDecodedBase64urlV2(a.operationId, b.operationId) || compareBigInt(BigInt(a.writeOrdinal), BigInt(b.writeOrdinal))
}

export function nextLamportV2(frontier: CausalFrontierV2): Uint64V2 {
  const parsed = parseCausalFrontierV2(frontier)
  let maximum = 0n
  for (const head of parsed.heads) {
    const value = uint64ToBigIntV2(head.lamport)
    if (value > maximum) maximum = value
  }
  return incrementUint64V2(maximum.toString())
}

export function validateActorSuccessorV2(
  previous: CausalHeadRefV2 | null,
  actorId: CausalHeadRefV2["actorId"],
  actorSequence: Uint64V2,
  predecessorFrameDigest: DigestV2 | null,
): void {
  const sequence = uint64ToBigIntV2(actorSequence)
  if (previous === null) {
    if (sequence !== 1n || predecessorFrameDigest !== null) invalid("First actor frame must use sequence one and null predecessor")
    return
  }
  const parsed = parseCausalHeadRefV2(previous)
  if (parsed.actorId !== actorId || sequence !== uint64ToBigIntV2(parsed.actorSequence) + 1n || predecessorFrameDigest !== parsed.frameDigest) {
    invalid("Actor successor is not exact +1 with the immediate predecessor digest")
  }
}

export function maxCausalFrontierV2(
  input: readonly CausalHeadRefV2[],
  closure: CausalClosurePortV2,
): CausalFrontierV2 | "pending" {
  if (!Array.isArray(input) || input.length > KERNEL_LIMITS_V2.causalFrontierHeads) invalid("Causal head set exceeds 256")
  const seen = new Set<string>()
  const heads: CausalHeadRefV2[] = []
  for (const raw of input) {
    const head = parseCausalHeadRefV2(raw)
    if (seen.has(head.frameDigest)) continue
    seen.add(head.frameDigest)
    heads.push(head)
  }
  const maximal: CausalHeadRefV2[] = []
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
  maximal.sort((left, right) => compareDecodedBase64urlV2(left.actorId, right.actorId))
  for (let index = 1; index < maximal.length; index += 1) {
    if (maximal[index - 1]!.actorId === maximal[index]!.actorId) invalid("Causal frontier contains an unresolved same-actor fork")
  }
  return Object.freeze({ format: "convax.causal-frontier/2", heads: Object.freeze(maximal) })
}

export function assertFrontierLeqV2(left: CausalFrontierV2, right: CausalFrontierV2, closure: CausalClosurePortV2): boolean | "pending" {
  const a = parseCausalFrontierV2(left)
  const b = parseCausalFrontierV2(right)
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

export function compareCausalDependenciesV2(
  left: { readonly kind: string; readonly digest: string },
  right: { readonly kind: string; readonly digest: string },
): number {
  return compareUtf8V2(left.kind, right.kind) || compareUtf8V2(left.digest, right.digest)
}

function compareBigInt(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function invalid(message: string): never {
  throw new CollaborationCodecErrorV2("invalid-codec", message)
}
