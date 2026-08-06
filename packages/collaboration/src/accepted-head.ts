import { compareDecodedBase64url, parseDigest } from "./codecs"
import type { Digest } from "./codecs"
import { KERNEL_DIGEST_DOMAINS } from "./constants"
import type {
  CausalHeadRef,
  DecodedCausalEditFrame,
  DocumentOwnerRuntime,
  FrameObjectRef,
  ReplicaActorHeadSet,
} from "./contracts"
import { canonicalStateDigest, structuredDigest } from "./digest"
import { CollaborationKernelError } from "./errors"
import { decodeCausalEditFrame } from "./frame"
import { encodeRestrictedJcs } from "./jcs"
import { assertSameScope, parseCausalFrontier, parseDocumentScope, parseReplicaActorHeadSet } from "./parse"
import type { AcceptedHeadView } from "./ports"
import type { CurrentProtocolAuthority } from "./authority"
import {
  causalFrontierDigest,
  maxCausalFrontier,
  type CausalClosurePort,
} from "./causal"
import {
  ACCEPTED_FRAME_ORIGIN,
  applyYjsUpdate,
  cloneExactBaseDocument,
  encodeFullUpdate,
  encodeStateVector,
  type YjsDocumentFactory,
} from "./yjs-codec"

export interface MaterializeAcceptedFrameInput extends YjsDocumentFactory {
  readonly authority: CurrentProtocolAuthority
  readonly owner: DocumentOwnerRuntime
  readonly previous: AcceptedHeadView
  readonly ref: FrameObjectRef
  readonly exactFrameBytes: Readonly<Uint8Array>
  readonly causalClosure: CausalClosurePort
}

/** Exact pure inspection used by native stores before admitting opaque bytes. */
export function inspectAcceptedFrameObject(
  authority: CurrentProtocolAuthority,
  ref: FrameObjectRef,
  exactFrameBytes: Readonly<Uint8Array>,
): DecodedCausalEditFrame {
  const frame = decodeCausalEditFrame(authority, new Uint8Array(exactFrameBytes))
  const expected = frameObjectRefFromDecodedFrame(frame)
  if (encodeRestrictedJcsText(expected) !== encodeRestrictedJcsText(ref)) invalid("Frame object reference mismatches exact frame bytes")
  return frame
}

/**
 * Headless deterministic accepted-head materialization. Project/node supplies only
 * durable bytes and a causal-closure port; it never reimplements frame or Yjs
 * protocol algorithms.
 */
export function materializeAcceptedFrame(input: MaterializeAcceptedFrameInput): AcceptedHeadView {
  const previousScope = parseDocumentScope(input.previous.scope)
  const frame = inspectAcceptedFrameObject(input.authority, input.ref, input.exactFrameBytes)
  assertSameScope(frame.header.core.scope, previousScope, "Accepted-frame materialization scope")
  if (frame.header.core.ownerSchemaDigest !== input.owner.protocolPort.schemaDigest
    || frame.header.core.canonicalizerDigest !== input.owner.protocolPort.canonicalizerDigest) {
    invalid("Accepted-frame materialization owner binding mismatches")
  }
  const previousFrontier = parseCausalFrontier(input.previous.frontier)
  const previousActorHeads = parseReplicaActorHeadSet(input.previous.actorHeads)
  assertSameScope(previousActorHeads.scope, previousScope, "Accepted-frame actor-head scope")
  const nextHead = causalHeadRefFromDecodedFrame(frame)
  const frontier = maxCausalFrontier(
    [...previousFrontier.heads, nextHead],
    incomingFrameClosure(frame, input.causalClosure),
  )
  if (frontier === "pending") invalid("Accepted-frame causal closure is incomplete")
  const actorHeads = replaceReplicaActorHead(previousActorHeads, nextHead)
  const document = cloneExactBaseDocument(input, new Uint8Array(input.previous.fullUpdate), new Uint8Array(input.previous.stateVector) as import("./codecs").StateVector)
  try {
    applyYjsUpdate(document, frame.sections.yjsUpdate, ACCEPTED_FRAME_ORIGIN)
    if (input.owner.protocolPort.validateBase(document) === "rejected") invalid("Materialized accepted head violates owner schema")
    const canonicalBytes = input.owner.protocolPort.canonicalStateBytes(document)
    if (canonicalBytes === "rejected") invalid("Materialized accepted head cannot be canonicalized")
    return Object.freeze({
      scope: previousScope,
      headDigest: parseDigest(input.previous.headDigest),
      frontier,
      frontierDigest: causalFrontierDigest(frontier),
      actorHeads,
      fullUpdate: encodeFullUpdate(document),
      stateVector: encodeStateVector(document),
      canonicalStateDigest: canonicalStateDigest(input.owner.protocolPort.schemaDigest, new Uint8Array(canonicalBytes)),
    })
  } finally {
    document.destroy()
  }
}

export function causalHeadRefFromDecodedFrame(frame: DecodedCausalEditFrame): CausalHeadRef {
  const core = frame.header.core
  return Object.freeze({
    format: "convax.causal-head-ref",
    actorId: core.actorId,
    actorSequence: core.actorSequence,
    frameDigest: frame.frameDigest,
    lamport: core.lamport,
  })
}

export function frameObjectRefFromDecodedFrame(frame: DecodedCausalEditFrame): FrameObjectRef {
  const core = frame.header.core
  return Object.freeze({
    scope: core.scope,
    frameDigest: frame.frameDigest,
    actorId: core.actorId,
    actorSequence: core.actorSequence,
    operationId: core.operationId,
  })
}

export function replicaActorHeadSetDigest(actorHeads: ReplicaActorHeadSet) {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.replicaActorHeadSet, parseReplicaActorHeadSet(actorHeads))
}

export function incomingFrameClosure(
  frame: DecodedCausalEditFrame,
  base: CausalClosurePort,
): CausalClosurePort {
  return Object.freeze({
    contains(descendantFrameDigest: Digest, ancestorFrameDigest: Digest) {
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

export function replaceReplicaActorHead(set: ReplicaActorHeadSet, head: CausalHeadRef): ReplicaActorHeadSet {
  const heads = set.heads.filter((item) => item.actorId !== head.actorId).concat(head)
  heads.sort((left, right) => compareDecodedBase64url(left.actorId, right.actorId))
  return Object.freeze({ format: "convax.replica-actor-head-set", scope: set.scope, heads: Object.freeze(heads) })
}

function encodeRestrictedJcsText(value: unknown): string {
  return new TextDecoder().decode(encodeRestrictedJcs(value))
}

function invalid(message: string): never {
  throw new CollaborationKernelError("invalid-owner-result", message)
}
