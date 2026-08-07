import { compareDecodedBase64url, parseDigest } from "./codecs"
import type { Digest } from "./codecs"
import { KERNEL_DIGEST_DOMAINS } from "./constants"
import type {
  CausalFrontier,
  CausalHeadRef,
  DecodedCausalEditFrame,
  DocumentOwnerRuntime,
  FrameObjectRef,
  ReplicaActorHeadSet,
} from "./contracts"
import { canonicalStateDigest, nativeOrdinarySha256, ordinarySha256, structuredDigest } from "./digest"
import { CollaborationKernelError } from "./errors"
import { decodeCausalEditFrame } from "./frame"
import { encodeRestrictedJcs } from "./jcs"
import { assertSameScope, parseCausalFrontier, parseDocumentScope, parseReplicaActorHeadSet } from "./parse"
import type { AcceptedHeadMaterializationEvidence, AcceptedHeadView } from "./ports"
import type { CurrentProtocolAuthority } from "./authority"
import { causalFrontierDigest, maxCausalFrontier, type CausalClosurePort } from "./causal"
import {
  ACCEPTED_FRAME_ORIGIN,
  applyYjsUpdate,
  cloneExactBaseDocument,
  encodeFullUpdate,
  encodeStateVector,
  parseStateVector,
  stateVectorDigest,
  type YjsDocumentFactory,
} from "./yjs-codec"
import { sameBytes } from "./binary"

const ACCEPTED_HEAD_MATERIALIZED_STATE_DOMAIN = "convax.accepted-head-materialized-state"
const ACCEPTED_HEAD_MATERIALIZATION_EVIDENCE_DOMAIN = "convax.accepted-head-materialization-evidence"
interface IssuedMaterializationRecord {
  readonly previous: AcceptedHeadView
  readonly ref: FrameObjectRef
  readonly next: AcceptedHeadView
  readonly evidenceDigest: Digest
}

const issuedAcceptedHeadMaterializationEvidence = new WeakMap<object, IssuedMaterializationRecord>()

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
  if (encodeRestrictedJcsText(expected) !== encodeRestrictedJcsText(ref))
    invalid("Frame object reference mismatches exact frame bytes")
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
  if (
    frame.header.core.ownerSchemaDigest !== input.owner.protocolPort.schemaDigest ||
    frame.header.core.canonicalizerDigest !== input.owner.protocolPort.canonicalizerDigest
  ) {
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
  const document = cloneExactBaseDocument(
    input,
    new Uint8Array(input.previous.fullUpdate),
    new Uint8Array(input.previous.stateVector) as import("./codecs").StateVector,
  )
  try {
    applyYjsUpdate(document, frame.sections.yjsUpdate, ACCEPTED_FRAME_ORIGIN)
    if (input.owner.protocolPort.validateBase(document) === "rejected")
      invalid("Materialized accepted head violates owner schema")
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

export function acceptedHeadMaterializedStateDigest(head: AcceptedHeadView): Digest {
  return acceptedHeadMaterializedStateDigestWithFullUpdateDigest(head, ordinarySha256(new Uint8Array(head.fullUpdate)))
}

function acceptedHeadMaterializedStateDigestWithFullUpdateDigest(
  head: AcceptedHeadView,
  fullUpdateDigest: Digest,
): Digest {
  const scope = parseDocumentScope(head.scope)
  const frontier = parseCausalFrontier(head.frontier)
  const actorHeads = parseReplicaActorHeadSet(head.actorHeads)
  assertSameScope(actorHeads.scope, scope, "Accepted-head materialized-state actor-head scope")
  const frontierDigest = causalFrontierDigest(frontier)
  if (frontierDigest !== parseDigest(head.frontierDigest))
    invalid("Accepted-head materialized-state frontier digest mismatches")
  return structuredDigest(ACCEPTED_HEAD_MATERIALIZED_STATE_DOMAIN, {
    format: "convax.accepted-head-materialized-state",
    scope,
    frontierDigest,
    actorHeadsDigest: replicaActorHeadSetDigest(actorHeads),
    fullUpdateDigest: parseDigest(fullUpdateDigest),
    stateVectorDigest: stateVectorDigest(parseStateVector(head.stateVector)),
    canonicalStateDigest: parseDigest(head.canonicalStateDigest),
  })
}

export function createAcceptedHeadMaterializationEvidence(input: {
  readonly previous: AcceptedHeadView
  readonly ref: FrameObjectRef
  readonly nextHead: CausalHeadRef
  readonly resultingFrontier: CausalFrontier
  readonly postDocument: import("yjs").Doc
  readonly canonicalStateDigest: Digest
}): AcceptedHeadMaterializationEvidence {
  return issueAcceptedHeadMaterializationEvidence(input, ordinarySha256)
}

/** Internal local-commit acceleration; deliberately absent from the package root. */
export async function createLocalAcceptedHeadMaterializationEvidence(input: {
  readonly previous: AcceptedHeadView
  readonly ref: FrameObjectRef
  readonly nextHead: CausalHeadRef
  readonly resultingFrontier: CausalFrontier
  readonly postDocument: import("yjs").Doc
  readonly canonicalStateDigest: Digest
}): Promise<AcceptedHeadMaterializationEvidence> {
  const fullUpdate = encodeFullUpdate(input.postDocument)
  const previousFullUpdate = new Uint8Array(input.previous.fullUpdate)
  const [fullUpdateDigest, previousFullUpdateDigest] = await Promise.all([
    nativeOrdinarySha256(fullUpdate),
    nativeOrdinarySha256(previousFullUpdate),
  ])
  return issueAcceptedHeadMaterializationEvidence(
    input,
    (bytes) => {
      if (bytes === fullUpdate) return fullUpdateDigest
      if (bytes === previousFullUpdate) return previousFullUpdateDigest
      return ordinarySha256(bytes)
    },
    { fullUpdate, previousFullUpdate },
  )
}

function issueAcceptedHeadMaterializationEvidence(
  input: {
    readonly previous: AcceptedHeadView
    readonly ref: FrameObjectRef
    readonly nextHead: CausalHeadRef
    readonly resultingFrontier: CausalFrontier
    readonly postDocument: import("yjs").Doc
    readonly canonicalStateDigest: Digest
  },
  sha256: (bytes: Uint8Array<ArrayBufferLike>) => Digest,
  prepared?: Readonly<{ fullUpdate: Uint8Array; previousFullUpdate: Uint8Array }>,
): AcceptedHeadMaterializationEvidence {
  const scope = parseDocumentScope(input.previous.scope)
  assertSameScope(input.ref.scope, scope, "Accepted-head materialization frame scope")
  if (
    input.nextHead.frameDigest !== input.ref.frameDigest ||
    input.nextHead.actorId !== input.ref.actorId ||
    input.nextHead.actorSequence !== input.ref.actorSequence
  )
    invalid("Accepted-head materialization next head mismatches frame reference")
  const resultingFrontier = parseCausalFrontier(input.resultingFrontier)
  const frontierHead = resultingFrontier.heads.find((head) => head.frameDigest === input.ref.frameDigest)
  if (!frontierHead || encodeRestrictedJcsText(frontierHead) !== encodeRestrictedJcsText(input.nextHead)) {
    invalid("Accepted-head materialization frontier omits the final frame")
  }
  const resultingActorHeads = replaceReplicaActorHead(
    parseReplicaActorHeadSet(input.previous.actorHeads),
    input.nextHead,
  )
  const fullUpdate = prepared?.fullUpdate ?? encodeFullUpdate(input.postDocument)
  const stateVector = encodeStateVector(input.postDocument)
  const previousFullUpdate = prepared?.previousFullUpdate ?? new Uint8Array(input.previous.fullUpdate)
  const previous = cloneAcceptedHead(input.previous, previousFullUpdate)
  const fields = Object.freeze({
    format: "convax.accepted-head-materialization-evidence" as const,
    scope,
    baseDurableHeadRecordDigest: parseDigest(input.previous.headDigest),
    baseMaterializedStateDigest: acceptedHeadMaterializedStateDigestWithFullUpdateDigest(
      previous,
      sha256(previousFullUpdate),
    ),
    frameDigest: parseDigest(input.ref.frameDigest),
    resultingFrontier,
    resultingFrontierDigest: causalFrontierDigest(resultingFrontier),
    resultingActorHeads,
    resultingActorHeadsDigest: replicaActorHeadSetDigest(resultingActorHeads),
    fullUpdate,
    fullUpdateDigest: sha256(fullUpdate),
    stateVector,
    stateVectorDigest: stateVectorDigest(stateVector),
    canonicalStateDigest: parseDigest(input.canonicalStateDigest),
  })
  const evidenceDigest = acceptedHeadMaterializationEvidenceDigest(fields)
  const evidence = Object.freeze({
    ...fields,
    fullUpdate: new Uint8Array(fullUpdate),
    stateVector: parseStateVector(stateVector),
    evidenceDigest,
  })
  const next = Object.freeze({
    scope,
    headDigest: previous.headDigest,
    frontier: resultingFrontier,
    frontierDigest: fields.resultingFrontierDigest,
    actorHeads: resultingActorHeads,
    fullUpdate: new Uint8Array(fullUpdate),
    stateVector: parseStateVector(stateVector),
    canonicalStateDigest: fields.canonicalStateDigest,
  })
  issuedAcceptedHeadMaterializationEvidence.set(
    evidence,
    Object.freeze({ previous, ref: cloneFrameRef(input.ref), next, evidenceDigest }),
  )
  return evidence
}

/** Returns rejected so a native adapter can safely fall back to full materialization. */
export function validateAcceptedHeadMaterializationEvidence(input: {
  readonly previous: AcceptedHeadView
  readonly ref: FrameObjectRef
  readonly evidence: AcceptedHeadMaterializationEvidence
}): AcceptedHeadView | "rejected" {
  try {
    const evidence = input.evidence
    const record = issuedAcceptedHeadMaterializationEvidence.get(evidence)
    if (!record || !sameAcceptedHead(record.previous, input.previous) || !sameFrameRef(record.ref, input.ref)) {
      return "rejected"
    }
    return cloneAcceptedHead(record.next)
  } catch {
    return "rejected"
  }
}

function cloneAcceptedHead(
  head: AcceptedHeadView,
  fullUpdate: Uint8Array<ArrayBufferLike> = new Uint8Array(head.fullUpdate),
): AcceptedHeadView {
  return Object.freeze({
    scope: parseDocumentScope(head.scope),
    headDigest: parseDigest(head.headDigest),
    frontier: parseCausalFrontier(head.frontier),
    frontierDigest: parseDigest(head.frontierDigest),
    actorHeads: parseReplicaActorHeadSet(head.actorHeads),
    fullUpdate,
    stateVector: parseStateVector(head.stateVector),
    canonicalStateDigest: parseDigest(head.canonicalStateDigest),
  })
}

function cloneFrameRef(ref: FrameObjectRef): FrameObjectRef {
  return Object.freeze({ ...ref, scope: parseDocumentScope(ref.scope) })
}

function sameFrameRef(left: FrameObjectRef, right: FrameObjectRef): boolean {
  return encodeRestrictedJcsText(left) === encodeRestrictedJcsText(right)
}

function sameAcceptedHead(expected: AcceptedHeadView, actual: AcceptedHeadView): boolean {
  return (
    encodeRestrictedJcsText(expected.scope) === encodeRestrictedJcsText(actual.scope) &&
    expected.headDigest === actual.headDigest &&
    expected.frontierDigest === actual.frontierDigest &&
    encodeRestrictedJcsText(expected.frontier) === encodeRestrictedJcsText(actual.frontier) &&
    encodeRestrictedJcsText(expected.actorHeads) === encodeRestrictedJcsText(actual.actorHeads) &&
    expected.canonicalStateDigest === actual.canonicalStateDigest &&
    sameBytes(expected.stateVector, actual.stateVector) &&
    sameBytes(expected.fullUpdate, actual.fullUpdate)
  )
}

function acceptedHeadMaterializationEvidenceDigest(
  fields: Omit<AcceptedHeadMaterializationEvidence, "evidenceDigest">,
): Digest {
  return structuredDigest(ACCEPTED_HEAD_MATERIALIZATION_EVIDENCE_DOMAIN, {
    format: fields.format,
    scope: fields.scope,
    baseDurableHeadRecordDigest: fields.baseDurableHeadRecordDigest,
    baseMaterializedStateDigest: fields.baseMaterializedStateDigest,
    frameDigest: fields.frameDigest,
    resultingFrontierDigest: fields.resultingFrontierDigest,
    resultingActorHeadsDigest: fields.resultingActorHeadsDigest,
    fullUpdateDigest: fields.fullUpdateDigest,
    stateVectorDigest: fields.stateVectorDigest,
    canonicalStateDigest: fields.canonicalStateDigest,
  })
}

export function incomingFrameClosure(frame: DecodedCausalEditFrame, base: CausalClosurePort): CausalClosurePort {
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
