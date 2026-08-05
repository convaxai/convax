import { compareDecodedBase64urlV2, parseDigestV2 } from "./codecs"
import type { DigestV2 } from "./codecs"
import { KERNEL_DIGEST_DOMAINS_V2 } from "./constants"
import type {
  CausalHeadRefV2,
  DecodedCausalEditFrameV2,
  DocumentOwnerRuntimeV2,
  FrameObjectRefV2,
  ReplicaActorHeadSetV2,
} from "./contracts"
import { canonicalStateDigestV2, structuredDigestV2 } from "./digest"
import { CollaborationKernelErrorV2 } from "./errors"
import { decodeCausalEditFrameV2 } from "./frame"
import { encodeRestrictedJcsV2 } from "./jcs"
import { assertSameScopeV2, parseCausalFrontierV2, parseDocumentScopeV2, parseReplicaActorHeadSetV2 } from "./parse"
import type { AcceptedHeadViewV2 } from "./ports"
import type { VerifiedProtocolAuthorityV2 } from "./authority"
import {
  causalFrontierDigestV2,
  maxCausalFrontierV2,
  type CausalClosurePortV2,
} from "./causal"
import {
  ACCEPTED_FRAME_ORIGIN_V2,
  applyUpdateV1V2,
  cloneExactBaseDocumentV2,
  encodeFullUpdateV2,
  encodeStateVectorV2,
  type YjsDocumentFactoryV2,
} from "./yjs-codec"
import {
  decodeCausalEditFrameV3,
  type SuccessorProtocolAuthorityV3,
  type DecodedCausalEditFrameV3,
} from "./successor-frame"

export interface MaterializeAcceptedFrameInputV2 extends YjsDocumentFactoryV2 {
  readonly authority: VerifiedProtocolAuthorityV2
  readonly owner: DocumentOwnerRuntimeV2
  readonly previous: AcceptedHeadViewV2
  readonly ref: FrameObjectRefV2
  readonly exactFrameBytes: Readonly<Uint8Array>
  readonly causalClosure: CausalClosurePortV2
}

export interface MaterializeAcceptedFrameInputV3 extends YjsDocumentFactoryV2 {
  readonly authority: SuccessorProtocolAuthorityV3
  readonly owner: DocumentOwnerRuntimeV2
  readonly previous: AcceptedHeadViewV2
  readonly ref: FrameObjectRefV2
  readonly exactFrameBytes: Readonly<Uint8Array>
  readonly causalClosure: CausalClosurePortV2
}

/** Exact pure inspection used by native stores before admitting opaque bytes. */
export function inspectAcceptedFrameObjectV2(
  authority: VerifiedProtocolAuthorityV2,
  ref: FrameObjectRefV2,
  exactFrameBytes: Readonly<Uint8Array>,
): DecodedCausalEditFrameV2 {
  const frame = decodeCausalEditFrameV2(authority, new Uint8Array(exactFrameBytes))
  const expected = frameObjectRefFromDecodedFrameV2(frame)
  if (encodeRestrictedJcsText(expected) !== encodeRestrictedJcsText(ref)) invalid("Frame object reference mismatches exact frame bytes")
  return frame
}

/**
 * Headless deterministic accepted-head materialization. Project/node supplies only
 * durable bytes and a causal-closure port; it never reimplements frame or Yjs
 * protocol algorithms.
 */
export function materializeAcceptedFrameV2(input: MaterializeAcceptedFrameInputV2): AcceptedHeadViewV2 {
  const previousScope = parseDocumentScopeV2(input.previous.scope)
  const frame = inspectAcceptedFrameObjectV2(input.authority, input.ref, input.exactFrameBytes)
  assertSameScopeV2(frame.header.core.scope, previousScope, "Accepted-frame materialization scope")
  if (frame.header.core.ownerSchemaDigest !== input.owner.protocolPort.schemaDigest
    || frame.header.core.canonicalizerDigest !== input.owner.protocolPort.canonicalizerDigest) {
    invalid("Accepted-frame materialization owner binding mismatches")
  }
  const previousFrontier = parseCausalFrontierV2(input.previous.frontier)
  const previousActorHeads = parseReplicaActorHeadSetV2(input.previous.actorHeads)
  assertSameScopeV2(previousActorHeads.scope, previousScope, "Accepted-frame actor-head scope")
  const nextHead = causalHeadRefFromDecodedFrameV2(frame)
  const frontier = maxCausalFrontierV2(
    [...previousFrontier.heads, nextHead],
    incomingFrameClosureV2(frame, input.causalClosure),
  )
  if (frontier === "pending") invalid("Accepted-frame causal closure is incomplete")
  const actorHeads = replaceReplicaActorHeadV2(previousActorHeads, nextHead)
  const document = cloneExactBaseDocumentV2(input, new Uint8Array(input.previous.fullUpdate), new Uint8Array(input.previous.stateVector) as import("./codecs").StateVectorV2)
  try {
    applyUpdateV1V2(document, frame.sections.yjsUpdate, ACCEPTED_FRAME_ORIGIN_V2)
    if (input.owner.protocolPort.validateBase(document) === "rejected") invalid("Materialized accepted head violates owner schema")
    const canonicalBytes = input.owner.protocolPort.canonicalStateBytes(document)
    if (canonicalBytes === "rejected") invalid("Materialized accepted head cannot be canonicalized")
    return Object.freeze({
      scope: previousScope,
      headDigest: parseDigestV2(input.previous.headDigest),
      frontier,
      frontierDigest: causalFrontierDigestV2(frontier),
      actorHeads,
      fullUpdate: encodeFullUpdateV2(document),
      stateVector: encodeStateVectorV2(document),
      canonicalStateDigest: canonicalStateDigestV2(input.owner.protocolPort.schemaDigest, new Uint8Array(canonicalBytes)),
    })
  } finally {
    document.destroy()
  }
}

/** Candidate-only V3 counterpart; activation replaces its authority capability. */
export function materializeAcceptedFrameV3(input: MaterializeAcceptedFrameInputV3): AcceptedHeadViewV2 {
  const previousScope = parseDocumentScopeV2(input.previous.scope)
  const frame = inspectAcceptedFrameObjectV3(input.authority, input.ref, input.exactFrameBytes)
  assertSameScopeV2(frame.header.core.scope, previousScope, "Accepted V3 frame materialization scope")
  if (frame.header.core.ownerSchemaDigest !== input.owner.protocolPort.schemaDigest
    || frame.header.core.canonicalizerDigest !== input.owner.protocolPort.canonicalizerDigest) {
    invalid("Accepted V3 frame materialization owner binding mismatches")
  }
  const previousFrontier = parseCausalFrontierV2(input.previous.frontier)
  const previousActorHeads = parseReplicaActorHeadSetV2(input.previous.actorHeads)
  assertSameScopeV2(previousActorHeads.scope, previousScope, "Accepted V3 frame actor-head scope")
  const nextHead = causalHeadRefFromDecodedFrameV3(frame)
  const frontier = maxCausalFrontierV2(
    [...previousFrontier.heads, nextHead],
    incomingFrameClosureV3(frame, input.causalClosure),
  )
  if (frontier === "pending") invalid("Accepted V3 frame causal closure is incomplete")
  const actorHeads = replaceReplicaActorHeadV2(previousActorHeads, nextHead)
  const document = cloneExactBaseDocumentV2(input, new Uint8Array(input.previous.fullUpdate), new Uint8Array(input.previous.stateVector) as import("./codecs").StateVectorV2)
  try {
    applyUpdateV1V2(document, frame.sections.yjsUpdate, ACCEPTED_FRAME_ORIGIN_V2)
    if (input.owner.protocolPort.validateBase(document) === "rejected") invalid("Materialized V3 accepted head violates owner schema")
    const canonicalBytes = input.owner.protocolPort.canonicalStateBytes(document)
    if (canonicalBytes === "rejected") invalid("Materialized V3 accepted head cannot be canonicalized")
    return Object.freeze({
      scope: previousScope,
      headDigest: parseDigestV2(input.previous.headDigest),
      frontier,
      frontierDigest: causalFrontierDigestV2(frontier),
      actorHeads,
      fullUpdate: encodeFullUpdateV2(document),
      stateVector: encodeStateVectorV2(document),
      canonicalStateDigest: canonicalStateDigestV2(input.owner.protocolPort.schemaDigest, new Uint8Array(canonicalBytes)),
    })
  } finally {
    document.destroy()
  }
}

export function inspectAcceptedFrameObjectV3(
  authority: SuccessorProtocolAuthorityV3,
  ref: FrameObjectRefV2,
  exactFrameBytes: Readonly<Uint8Array>,
): DecodedCausalEditFrameV3 {
  const frame = decodeCausalEditFrameV3(authority, new Uint8Array(exactFrameBytes))
  const expected = frameObjectRefFromDecodedFrameV3(frame)
  if (encodeRestrictedJcsText(expected) !== encodeRestrictedJcsText(ref)) invalid("V3 frame object reference mismatches exact frame bytes")
  return frame
}

export function causalHeadRefFromDecodedFrameV2(frame: DecodedCausalEditFrameV2): CausalHeadRefV2 {
  const core = frame.header.core
  return Object.freeze({
    format: "convax.causal-head-ref/2",
    actorId: core.actorId,
    actorSequence: core.actorSequence,
    frameDigest: frame.frameDigest,
    lamport: core.lamport,
  })
}

export function frameObjectRefFromDecodedFrameV2(frame: DecodedCausalEditFrameV2): FrameObjectRefV2 {
  const core = frame.header.core
  return Object.freeze({
    scope: core.scope,
    frameDigest: frame.frameDigest,
    actorId: core.actorId,
    actorSequence: core.actorSequence,
    operationId: core.operationId,
  })
}

export function causalHeadRefFromDecodedFrameV3(frame: DecodedCausalEditFrameV3): CausalHeadRefV2 {
  const core = frame.header.core
  return Object.freeze({
    format: "convax.causal-head-ref/2",
    actorId: core.actorId,
    actorSequence: core.actorSequence,
    frameDigest: frame.frameDigest,
    lamport: core.lamport,
  })
}

export function frameObjectRefFromDecodedFrameV3(frame: DecodedCausalEditFrameV3): FrameObjectRefV2 {
  const core = frame.header.core
  return Object.freeze({
    scope: core.scope,
    frameDigest: frame.frameDigest,
    actorId: core.actorId,
    actorSequence: core.actorSequence,
    operationId: core.operationId,
  })
}

export function replicaActorHeadSetDigestV2(actorHeads: ReplicaActorHeadSetV2) {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.replicaActorHeadSet, parseReplicaActorHeadSetV2(actorHeads))
}

export function incomingFrameClosureV2(
  frame: DecodedCausalEditFrameV2,
  base: CausalClosurePortV2,
): CausalClosurePortV2 {
  return Object.freeze({
    contains(descendantFrameDigest: DigestV2, ancestorFrameDigest: DigestV2) {
      if (descendantFrameDigest !== frame.frameDigest) return base.contains(descendantFrameDigest, ancestorFrameDigest)
      if (ancestorFrameDigest === frame.frameDigest) return true
      for (const head of frame.context.baseFrontier.heads) {
        if (head.frameDigest === ancestorFrameDigest) return true
        const contained = base.contains(head.frameDigest, ancestorFrameDigest)
        if (contained === "pending") return "pending"
        if (contained) return true
      }
      return false
    },
  })
}

export function incomingFrameClosureV3(
  frame: DecodedCausalEditFrameV3,
  base: CausalClosurePortV2,
): CausalClosurePortV2 {
  return Object.freeze({
    contains(descendantFrameDigest: DigestV2, ancestorFrameDigest: DigestV2) {
      if (descendantFrameDigest !== frame.frameDigest) return base.contains(descendantFrameDigest, ancestorFrameDigest)
      if (ancestorFrameDigest === frame.frameDigest) return true
      for (const head of frame.context.baseFrontier.heads) {
        if (head.frameDigest === ancestorFrameDigest) return true
        const contained = base.contains(head.frameDigest, ancestorFrameDigest)
        if (contained === "pending") return "pending"
        if (contained) return true
      }
      return false
    },
  })
}

export function replaceReplicaActorHeadV2(set: ReplicaActorHeadSetV2, head: CausalHeadRefV2): ReplicaActorHeadSetV2 {
  const heads = set.heads.filter((item) => item.actorId !== head.actorId).concat(head)
  heads.sort((left, right) => compareDecodedBase64urlV2(left.actorId, right.actorId))
  return Object.freeze({ format: "convax.replica-actor-head-set/2", scope: set.scope, heads: Object.freeze(heads) })
}

function encodeRestrictedJcsText(value: unknown): string {
  return new TextDecoder().decode(encodeRestrictedJcsV2(value))
}

function invalid(message: string): never {
  throw new CollaborationKernelErrorV2("invalid-owner-result", message)
}
