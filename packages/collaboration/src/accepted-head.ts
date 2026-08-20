import { compareDecodedBase64url, parseDigest } from "./codecs"
import type { Digest } from "./codecs"
import { sameBytes } from "./binary"
import { CURRENT_PROTOCOL_IDENTITIES, KERNEL_DIGEST_DOMAINS } from "./constants"
import type {
  CausalFrontier,
  CausalHeadRef,
  DecodedCausalEditFrame,
  DocumentOwnerRuntime,
  FrameObjectRef,
  ReplicaActorHeadSet,
} from "./contracts"
import { ordinarySha256, structuredDigest } from "./digest"
import { CollaborationKernelError } from "./errors"
import { decodeCausalEditFrame } from "./frame"
import { assertExactKeys, encodeRestrictedJcs, isPlainDataObject } from "./jcs"
import { assertSameScope, parseCausalFrontier, parseDocumentScope, parseReplicaActorHeadSet } from "./parse"
import type {
  AcceptedHeadIdentityView,
  AcceptedHeadDurableDeltaMetadata,
  AcceptedHeadMaterializationEvidence,
  AcceptedHeadTransitionView,
  AcceptedHeadView,
  ValidatedAcceptedHeadTransition,
} from "./ports"
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
  yjsUpdateDigest,
  type YjsDocumentFactory,
} from "./yjs-codec"
import { consumeOwnerStateCommitmentDigest } from "./owner-runtime"

const ACCEPTED_HEAD_MATERIALIZED_STATE_DOMAIN = "convax.accepted-head-materialized-state"
interface IssuedMaterializationRecord {
  readonly previousIdentityDigest: Digest
  readonly ref: FrameObjectRef
  readonly next: AcceptedHeadTransitionView
  readonly durableDelta: AcceptedHeadDurableDeltaMetadata
}

const issuedAcceptedHeadMaterializationEvidence = new WeakMap<object, IssuedMaterializationRecord>()

export interface MaterializeAcceptedFrameInput extends YjsDocumentFactory {
  readonly authority: CurrentProtocolAuthority
  readonly owner: DocumentOwnerRuntime
  readonly previous: AcceptedHeadView
  readonly ref: FrameObjectRef
  readonly exactFrameBytes: Readonly<Uint8Array>
  /** Untrusted persisted metadata; exact-frame replay must reproduce it. */
  readonly durableDelta: unknown
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
  const durableDelta = parseAcceptedHeadDurableDeltaMetadata(input.durableDelta)
  assertSameScope(durableDelta.scope, previousScope, "Accepted-frame durable delta scope")
  if (
    durableDelta.baseDurableHeadRecordDigest !== parseDigest(input.previous.headDigest) ||
    durableDelta.baseMaterializationDigest !== parseDigest(input.previous.materializationDigest) ||
    durableDelta.frameDigest !== parseDigest(input.ref.frameDigest)
  ) {
    invalid("Accepted-frame durable delta base binding mismatches")
  }
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
    const state = input.owner.protocolPort.validateBase(document)
    if (typeof state === "string") invalid("Materialized accepted head violates owner schema")
    const stateVector = encodeStateVector(document)
    const canonicalStateDigest = consumeOwnerStateCommitmentDigest(input.owner, document, state)
    if (canonicalStateDigest === null) invalid("Materialized accepted head omitted its exact state commitment")
    const materializationDigest = acceptedHeadDeltaCommitmentDigest({
      format: "convax.accepted-head-durable-delta-metadata",
      scope: previousScope,
      protocolDigest: frame.header.core.protocolDigest,
      baseDurableHeadRecordDigest: input.previous.headDigest,
      baseMaterializationDigest: input.previous.materializationDigest,
      frameDigest: input.ref.frameDigest,
      yjsUpdateDigest: yjsUpdateDigest(frame.sections.yjsUpdate),
      resultingFrontierDigest: causalFrontierDigest(frontier),
      resultingActorHeadsDigest: replicaActorHeadSetDigest(actorHeads),
      stateVectorDigest: stateVectorDigest(stateVector),
      canonicalStateDigest,
    })
    const transition = Object.freeze({
      scope: previousScope,
      frontier,
      frontierDigest: causalFrontierDigest(frontier),
      actorHeads,
      stateVector,
      canonicalStateDigest,
      materializationDigest,
    }) satisfies AcceptedHeadTransitionView
    assertDurableDeltaMatchesTransition(durableDelta, transition, frame.sections.yjsUpdate)
    return Object.freeze({
      scope: previousScope,
      headDigest: parseDigest(input.previous.headDigest),
      frontier: transition.frontier,
      frontierDigest: transition.frontierDigest,
      actorHeads: transition.actorHeads,
      fullUpdate: encodeFullUpdate(document),
      stateVector: transition.stateVector,
      canonicalStateDigest: transition.canonicalStateDigest,
      materializationDigest: transition.materializationDigest,
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
  readonly previous: AcceptedHeadIdentityView
  readonly ref: FrameObjectRef
  readonly nextHead: CausalHeadRef
  readonly resultingFrontier: CausalFrontier
  readonly postStateVector: import("./codecs").StateVector
  readonly yjsUpdateDigest: Digest
  readonly canonicalStateDigest: Digest
  readonly candidateFullClones?: 0 | 1
}): AcceptedHeadMaterializationEvidence {
  return issueAcceptedHeadMaterializationEvidence(input)
}

/** Internal local-commit issuer; no full document bytes are accepted or visited. */
export function createLocalAcceptedHeadMaterializationEvidence(input: {
  readonly previous: AcceptedHeadIdentityView
  readonly ref: FrameObjectRef
  readonly nextHead: CausalHeadRef
  readonly resultingFrontier: CausalFrontier
  readonly postStateVector: import("./codecs").StateVector
  readonly yjsUpdateDigest: Digest
  readonly canonicalStateDigest: Digest
  readonly candidateFullClones: 0 | 1
}): AcceptedHeadMaterializationEvidence {
  return issueAcceptedHeadMaterializationEvidence(input)
}

function issueAcceptedHeadMaterializationEvidence(
  input: {
    readonly previous: AcceptedHeadIdentityView
    readonly ref: FrameObjectRef
    readonly nextHead: CausalHeadRef
    readonly resultingFrontier: CausalFrontier
    readonly postStateVector: import("./codecs").StateVector
    readonly yjsUpdateDigest: Digest
    readonly canonicalStateDigest: Digest
    readonly candidateFullClones?: 0 | 1
  },
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
  const stateVector = parseStateVector(input.postStateVector)
  const fields = Object.freeze({
    format: "convax.accepted-head-durable-delta-metadata" as const,
    scope,
    protocolDigest: parseDigest(CURRENT_PROTOCOL_IDENTITIES.protocolDigest),
    baseDurableHeadRecordDigest: parseDigest(input.previous.headDigest),
    baseMaterializationDigest: parseDigest(input.previous.materializationDigest),
    frameDigest: parseDigest(input.ref.frameDigest),
    yjsUpdateDigest: parseDigest(input.yjsUpdateDigest),
    resultingFrontier,
    resultingFrontierDigest: causalFrontierDigest(resultingFrontier),
    resultingActorHeads,
    resultingActorHeadsDigest: replicaActorHeadSetDigest(resultingActorHeads),
    stateVector,
    stateVectorDigest: stateVectorDigest(stateVector),
    canonicalStateDigest: parseDigest(input.canonicalStateDigest),
  })
  const resultingMaterializationDigest = acceptedHeadDeltaCommitmentDigest(fields)
  const durableDelta = Object.freeze({
    ...fields,
    resultingFrontier,
    resultingActorHeads,
    stateVector: parseStateVector(stateVector),
    resultingMaterializationDigest,
  }) satisfies AcceptedHeadDurableDeltaMetadata
  const evidence = Object.freeze({
    format: fields.format,
    scope,
    protocolDigest: fields.protocolDigest,
    baseDurableHeadRecordDigest: fields.baseDurableHeadRecordDigest,
    baseMaterializationDigest: fields.baseMaterializationDigest,
    frameDigest: fields.frameDigest,
    yjsUpdateDigest: fields.yjsUpdateDigest,
    resultingFrontierDigest: fields.resultingFrontierDigest,
    resultingActorHeadsDigest: fields.resultingActorHeadsDigest,
    stateVectorDigest: fields.stateVectorDigest,
    canonicalStateDigest: fields.canonicalStateDigest,
    resultingMaterializationDigest,
    work: Object.freeze({
      fullUpdateEncodes: 0 as const,
      historicalBytesVisited: 0 as const,
      candidateFullClones: input.candidateFullClones ?? 0,
    }),
  }) as AcceptedHeadMaterializationEvidence
  const next = Object.freeze({
    scope,
    frontier: resultingFrontier,
    frontierDigest: fields.resultingFrontierDigest,
    actorHeads: resultingActorHeads,
    stateVector: parseStateVector(stateVector),
    canonicalStateDigest: fields.canonicalStateDigest,
    materializationDigest: resultingMaterializationDigest,
  }) satisfies AcceptedHeadTransitionView
  issuedAcceptedHeadMaterializationEvidence.set(
    evidence,
    Object.freeze({
      previousIdentityDigest: acceptedHeadMetadataIdentityDigest(input.previous),
      ref: cloneFrameRef(input.ref),
      next,
      durableDelta,
    }),
  )
  return evidence
}

/** Returns metadata only; full-update materialization is a cold persistence concern. */
export function validateAcceptedHeadMaterializationEvidence(input: {
  readonly previous: AcceptedHeadIdentityView
  readonly ref: FrameObjectRef
  readonly evidence: AcceptedHeadMaterializationEvidence
}): ValidatedAcceptedHeadTransition | "rejected" {
  try {
    const evidence = input.evidence
    const record = issuedAcceptedHeadMaterializationEvidence.get(evidence)
    if (
      !record ||
      record.previousIdentityDigest !== acceptedHeadMetadataIdentityDigest(input.previous) ||
      !sameFrameRef(record.ref, input.ref) ||
      !evidenceMirrorsDurableDelta(evidence, record.durableDelta) ||
      evidence.resultingMaterializationDigest !== acceptedHeadDeltaCommitmentDigest(record.durableDelta)
    ) {
      return "rejected"
    }
    return Object.freeze({
      transition: cloneAcceptedHeadTransition(record.next),
      durableDelta: cloneAcceptedHeadDurableDeltaMetadata(record.durableDelta),
    })
  } catch {
    return "rejected"
  }
}

/** Parses closed persisted metadata without granting it process-local authority. */
export function parseAcceptedHeadDurableDeltaMetadata(value: unknown): AcceptedHeadDurableDeltaMetadata {
  if (!isPlainDataObject(value)) invalid("Accepted-head durable delta metadata is invalid")
  assertExactKeys(value, [
    "format",
    "scope",
    "protocolDigest",
    "baseDurableHeadRecordDigest",
    "baseMaterializationDigest",
    "frameDigest",
    "yjsUpdateDigest",
    "resultingFrontier",
    "resultingFrontierDigest",
    "resultingActorHeads",
    "resultingActorHeadsDigest",
    "stateVector",
    "stateVectorDigest",
    "canonicalStateDigest",
    "resultingMaterializationDigest",
  ], "AcceptedHeadDurableDeltaMetadata")
  if (value.format !== "convax.accepted-head-durable-delta-metadata") {
    invalid("Accepted-head durable delta metadata format is invalid")
  }
  const scope = parseDocumentScope(value.scope)
  const resultingFrontier = parseCausalFrontier(value.resultingFrontier)
  const resultingActorHeads = parseReplicaActorHeadSet(value.resultingActorHeads)
  assertSameScope(resultingActorHeads.scope, scope, "Accepted-head durable delta actor-head scope")
  if (!(value.stateVector instanceof Uint8Array)) invalid("Accepted-head durable delta state vector is invalid")
  const stateVector = parseStateVector(value.stateVector)
  const parsed = Object.freeze({
    format: value.format,
    scope,
    protocolDigest: parseDigest(value.protocolDigest),
    baseDurableHeadRecordDigest: parseDigest(value.baseDurableHeadRecordDigest),
    baseMaterializationDigest: parseDigest(value.baseMaterializationDigest),
    frameDigest: parseDigest(value.frameDigest),
    yjsUpdateDigest: parseDigest(value.yjsUpdateDigest),
    resultingFrontier,
    resultingFrontierDigest: parseDigest(value.resultingFrontierDigest),
    resultingActorHeads,
    resultingActorHeadsDigest: parseDigest(value.resultingActorHeadsDigest),
    stateVector,
    stateVectorDigest: parseDigest(value.stateVectorDigest),
    canonicalStateDigest: parseDigest(value.canonicalStateDigest),
    resultingMaterializationDigest: parseDigest(value.resultingMaterializationDigest),
  }) satisfies AcceptedHeadDurableDeltaMetadata
  if (
    parsed.protocolDigest !== CURRENT_PROTOCOL_IDENTITIES.protocolDigest ||
    causalFrontierDigest(parsed.resultingFrontier) !== parsed.resultingFrontierDigest ||
    replicaActorHeadSetDigest(parsed.resultingActorHeads) !== parsed.resultingActorHeadsDigest ||
    stateVectorDigest(parsed.stateVector) !== parsed.stateVectorDigest ||
    acceptedHeadDeltaCommitmentDigest(parsed) !== parsed.resultingMaterializationDigest
  ) {
    invalid("Accepted-head durable delta metadata commitment mismatches")
  }
  return parsed
}

function evidenceMirrorsDurableDelta(
  evidence: AcceptedHeadMaterializationEvidence,
  durableDelta: AcceptedHeadDurableDeltaMetadata,
): boolean {
  return (
    evidence.format === durableDelta.format &&
    encodeRestrictedJcsText(evidence.scope) === encodeRestrictedJcsText(durableDelta.scope) &&
    evidence.protocolDigest === durableDelta.protocolDigest &&
    evidence.baseDurableHeadRecordDigest === durableDelta.baseDurableHeadRecordDigest &&
    evidence.baseMaterializationDigest === durableDelta.baseMaterializationDigest &&
    evidence.frameDigest === durableDelta.frameDigest &&
    evidence.yjsUpdateDigest === durableDelta.yjsUpdateDigest &&
    evidence.resultingFrontierDigest === durableDelta.resultingFrontierDigest &&
    evidence.resultingActorHeadsDigest === durableDelta.resultingActorHeadsDigest &&
    evidence.stateVectorDigest === durableDelta.stateVectorDigest &&
    evidence.canonicalStateDigest === durableDelta.canonicalStateDigest &&
    evidence.resultingMaterializationDigest === durableDelta.resultingMaterializationDigest &&
    evidence.work.fullUpdateEncodes === 0 &&
    evidence.work.historicalBytesVisited === 0 &&
    (evidence.work.candidateFullClones === 0 || evidence.work.candidateFullClones === 1)
  )
}

function assertDurableDeltaMatchesTransition(
  durableDelta: AcceptedHeadDurableDeltaMetadata,
  transition: AcceptedHeadTransitionView,
  exactYjsUpdate: Readonly<Uint8Array>,
): void {
  if (
    durableDelta.yjsUpdateDigest !== yjsUpdateDigest(new Uint8Array(exactYjsUpdate)) ||
    encodeRestrictedJcsText(durableDelta.scope) !== encodeRestrictedJcsText(transition.scope) ||
    encodeRestrictedJcsText(durableDelta.resultingFrontier) !== encodeRestrictedJcsText(transition.frontier) ||
    durableDelta.resultingFrontierDigest !== transition.frontierDigest ||
    encodeRestrictedJcsText(durableDelta.resultingActorHeads) !== encodeRestrictedJcsText(transition.actorHeads) ||
    !sameBytes(durableDelta.stateVector, transition.stateVector) ||
    durableDelta.canonicalStateDigest !== transition.canonicalStateDigest ||
    durableDelta.resultingMaterializationDigest !== transition.materializationDigest
  ) {
    invalid("Exact accepted-frame replay differs from its durable delta metadata")
  }
}

function cloneAcceptedHeadTransition(head: AcceptedHeadTransitionView): AcceptedHeadTransitionView {
  return Object.freeze({
    scope: parseDocumentScope(head.scope),
    frontier: parseCausalFrontier(head.frontier),
    frontierDigest: parseDigest(head.frontierDigest),
    actorHeads: parseReplicaActorHeadSet(head.actorHeads),
    stateVector: parseStateVector(head.stateVector),
    canonicalStateDigest: parseDigest(head.canonicalStateDigest),
    materializationDigest: parseDigest(head.materializationDigest),
  })
}

function cloneAcceptedHeadDurableDeltaMetadata(
  value: AcceptedHeadDurableDeltaMetadata,
): AcceptedHeadDurableDeltaMetadata {
  return parseAcceptedHeadDurableDeltaMetadata(value)
}

function cloneFrameRef(ref: FrameObjectRef): FrameObjectRef {
  return Object.freeze({ ...ref, scope: parseDocumentScope(ref.scope) })
}

function sameFrameRef(left: FrameObjectRef, right: FrameObjectRef): boolean {
  return encodeRestrictedJcsText(left) === encodeRestrictedJcsText(right)
}

function acceptedHeadDeltaCommitmentDigest(
  fields: Pick<
    AcceptedHeadDurableDeltaMetadata,
    | "format"
    | "scope"
    | "protocolDigest"
    | "baseDurableHeadRecordDigest"
    | "baseMaterializationDigest"
    | "frameDigest"
    | "yjsUpdateDigest"
    | "resultingFrontierDigest"
    | "resultingActorHeadsDigest"
    | "stateVectorDigest"
    | "canonicalStateDigest"
  >,
): Digest {
  if (parseDigest(fields.protocolDigest) !== CURRENT_PROTOCOL_IDENTITIES.protocolDigest) {
    invalid("Accepted-head delta commitment protocol is unsupported")
  }
  return structuredDigest(KERNEL_DIGEST_DOMAINS.acceptedHeadDurableDeltaMetadata, {
    format: fields.format,
    scope: parseDocumentScope(fields.scope),
    protocolDigest: parseDigest(fields.protocolDigest),
    baseDurableHeadRecordDigest: parseDigest(fields.baseDurableHeadRecordDigest),
    baseMaterializationDigest: parseDigest(fields.baseMaterializationDigest),
    frameDigest: parseDigest(fields.frameDigest),
    yjsUpdateDigest: parseDigest(fields.yjsUpdateDigest),
    resultingFrontierDigest: parseDigest(fields.resultingFrontierDigest),
    resultingActorHeadsDigest: parseDigest(fields.resultingActorHeadsDigest),
    stateVectorDigest: parseDigest(fields.stateVectorDigest),
    canonicalStateDigest: parseDigest(fields.canonicalStateDigest),
  })
}

function acceptedHeadMetadataIdentityDigest(head: AcceptedHeadIdentityView): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.acceptedHeadMetadataIdentity, {
    format: "convax.accepted-head-metadata-identity",
    scope: parseDocumentScope(head.scope),
    headDigest: parseDigest(head.headDigest),
    frontierDigest: parseDigest(head.frontierDigest),
    actorHeadsDigest: replicaActorHeadSetDigest(head.actorHeads),
    stateVectorDigest: stateVectorDigest(head.stateVector),
    canonicalStateDigest: parseDigest(head.canonicalStateDigest),
    materializationDigest: parseDigest(head.materializationDigest),
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
