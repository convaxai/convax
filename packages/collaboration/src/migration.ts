import {
  parseActorId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseReplicaId,
  parseSignature,
  parseUint64,
  type Digest,
  type Id128,
  type Signature,
  type StateVector,
  type Uint64,
} from "./codecs"
import type {
  CausalFrontier,
  CausalHeadRef,
  CausalSignerAuthority,
  DocumentScope,
  FrameObjectRef,
  LocalOwnerEditAuthorizationCore,
  ReplicaActorHeadSet,
  ReplicaCheckpoint,
  ReplicaCheckpointCore,
} from "./contracts"
import { cloneBytes, sameBytes } from "./binary"
import { causalFrontierDigest, maxCausalFrontier, validateActorSequenceStep } from "./causal"
import { replicaActorHeadSetDigest, replaceReplicaActorHead } from "./accepted-head"
import { KERNEL_DIGEST_DOMAINS } from "./constants"
import { hexToBytes, structuredDigest } from "./digest"
import { failFrame } from "./errors"
import {
  causalEditSignatureDigest,
  decodeCausalEditFrameForProtocol,
} from "./frame"
import {
  assertDenseArray,
  assertExactKeys,
  compareUtf8,
  decodeRestrictedJcs,
  encodeRestrictedJcs,
} from "./jcs"
import {
  assertSameScope,
  parseCausalFrontier,
  parseDocumentScope,
  parseReplicaActorHeadSet,
} from "./parse"
import {
  applyYjsUpdate,
  encodeFullUpdate,
  encodeStateVector,
  stateVectorDigest,
  yjsUpdateDigest,
} from "./yjs-codec"
import * as Y from "yjs"

/**
 * The only historical collaboration identity this build can inspect. These
 * constants seal the public build immediately preceding the current protocol;
 * this module is a one-shot migration issuer, never a runtime decoder selector.
 */
export const IMMEDIATE_PREDECESSOR_PROTOCOL = Object.freeze({
  protocolDigest: "8295f918e8f7b8297c080db03672fc410542280f639d9b40a8e324e560f07ae9" as Digest,
  canvasSchemaDigest: "09d5f8748d91474de45eb3a88fe6d3054adb79e8a44dd311c9024ab95b27250a" as Digest,
  collaborationKernelSchemaDigest: "1449c229278d0e30ddb800751c025ec546e8e0aea3c1e99215da411e3500a7dc" as Digest,
  controlPlaneSchemaDigest: "ac6605ee974a47be65a02c478e854971cbd54146db147cf943391a0f4f557e45" as Digest,
  projectPersistenceSchemaDigest: "99ebca8cc048f6cf919d55a9829091e2450e59a10b87b5410d9b0243459be37c" as Digest,
  uriProtocolDigest: "9030aecd6902888e5e91532fcc2ec3f1a377e79ae59c092ee80fbbf1a01fac38" as Digest,
  canvasCanonicalizerDigest: "bdc664a8962b83ded7cc1ca02dd514522f3eb72c2295d0cafa02a6e71de83fab" as Digest,
  projectIndexCanonicalizerDigest: "847ea9c62fea0fbcdc926e1899f31e638e7dacdf8ea8384b7102143dca0fb77f" as Digest,
} as const)

export interface ImmediatePredecessorSignatureVerification {
  readonly scope: DocumentScope
  readonly signerAuthority: CausalSignerAuthority
  readonly coreDigest: Digest
  readonly signature: Signature
  readonly purposeDigest: Uint8Array
}

export interface ImmediatePredecessorSignatureVerifier {
  verify(input: ImmediatePredecessorSignatureVerification): Promise<boolean>
}

export interface ImmediatePredecessorCheckpointSignatureVerification {
  readonly scope: DocumentScope
  readonly authorReplicaId: string
  readonly authorActorId: string
  readonly authorAuthorizationDigest: Digest
  readonly coreDigest: Digest
  readonly signature: Signature
  readonly purposeDigest: Uint8Array
}

export interface ImmediatePredecessorCheckpointSignatureVerifier {
  verifyCheckpoint(input: ImmediatePredecessorCheckpointSignatureVerification): Promise<boolean>
}

/**
 * Reconstructs the exact local-owner authorization digest carried by the one
 * sealed predecessor. The current public helper intentionally rejects this
 * protocol, so migration verification must stay on this isolated subpath.
 */
export function immediatePredecessorLocalOwnerEditAuthorizationCoreDigest(
  value: LocalOwnerEditAuthorizationCore,
): Digest {
  assertExactKeys(value, [
    "format", "scope", "replicaId", "actorId", "ownerBindingDigest",
    "protocolDigest", "ownerSchemaDigest", "expiryPolicy",
  ], "ImmediatePredecessorLocalOwnerEditAuthorizationCore")
  if (
    value.format !== "convax.local-owner-edit-authorization-core" ||
    value.protocolDigest !== IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest ||
    value.expiryPolicy !== "none"
  ) failFrame("Local owner authorization is not the sealed immediate-predecessor binding")
  const scope = parseDocumentScope(value.scope)
  const expectedSchema = scope.docKind === "canvas"
    ? IMMEDIATE_PREDECESSOR_PROTOCOL.canvasSchemaDigest
    : IMMEDIATE_PREDECESSOR_PROTOCOL.projectPersistenceSchemaDigest
  if (value.ownerSchemaDigest !== expectedSchema) {
    failFrame("Local owner authorization schema is not the sealed immediate-predecessor binding")
  }
  return structuredDigest(KERNEL_DIGEST_DOMAINS.localOwnerEditAuthorizationCore, Object.freeze({
    format: value.format,
    scope,
    replicaId: parseReplicaId(value.replicaId),
    actorId: parseActorId(value.actorId),
    ownerBindingDigest: parseDigest(value.ownerBindingDigest),
    protocolDigest: parseDigest(value.protocolDigest),
    ownerSchemaDigest: parseDigest(value.ownerSchemaDigest),
    expiryPolicy: value.expiryPolicy,
  }))
}

/**
 * Deliberately narrow output: Project's native migrator receives only a
 * signature-verified causal delta and the metadata needed to validate/replay it.
 * It cannot ask this module to keep an old document live.
 */
export interface VerifiedImmediatePredecessorFrame {
  readonly frameDigest: Digest
  readonly coreDigest: Digest
  readonly scope: DocumentScope
  readonly actorId: string
  readonly actorSequence: Uint64
  readonly predecessorFrameDigest: Digest | null
  readonly operationId: Id128
  readonly lamport: Uint64
  readonly baseFrontier: CausalFrontier
  readonly baseFrontierDigest: Digest
  readonly baseStateVectorDigest: Digest
  readonly baseCanonicalStateDigest: Digest
  readonly baseStateVector: Uint8Array
  readonly yjsUpdate: Uint8Array
  readonly postStateVectorDigest: Digest
  readonly postCanonicalStateDigest: Digest
  readonly signerAuthority: CausalSignerAuthority
}

export async function verifyImmediatePredecessorFrame(
  bytes: Uint8Array,
  verifier: ImmediatePredecessorSignatureVerifier,
): Promise<VerifiedImmediatePredecessorFrame> {
  if (typeof verifier !== "object" || verifier === null || typeof verifier.verify !== "function") {
    failFrame("Immediate-predecessor migration requires an explicit signature verifier")
  }
  const decoded = decodeCausalEditFrameForProtocol(bytes, IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest)
  const core = decoded.header.core
  const expectedSchema = core.scope.docKind === "canvas"
    ? IMMEDIATE_PREDECESSOR_PROTOCOL.canvasSchemaDigest
    : IMMEDIATE_PREDECESSOR_PROTOCOL.projectPersistenceSchemaDigest
  const expectedCanonicalizer = core.scope.docKind === "canvas"
    ? IMMEDIATE_PREDECESSOR_PROTOCOL.canvasCanonicalizerDigest
    : IMMEDIATE_PREDECESSOR_PROTOCOL.projectIndexCanonicalizerDigest
  if (core.ownerSchemaDigest !== expectedSchema || core.canonicalizerDigest !== expectedCanonicalizer) {
    failFrame("Causal edit owner binding is not the sealed immediate-predecessor binding")
  }
  const purposeDigest = causalEditSignatureDigest(decoded.header.coreDigest)
  const verified = await verifier.verify(Object.freeze({
    scope: core.scope,
    signerAuthority: decoded.context.signerAuthority,
    coreDigest: decoded.header.coreDigest,
    signature: decoded.header.replicaSignature,
    purposeDigest: cloneBytes(purposeDigest),
  }))
  if (verified !== true) failFrame("Immediate-predecessor causal edit signature is invalid")
  return Object.freeze({
    frameDigest: decoded.frameDigest,
    coreDigest: decoded.header.coreDigest,
    scope: core.scope,
    actorId: core.actorId,
    actorSequence: core.actorSequence,
    predecessorFrameDigest: core.predecessorFrameDigest,
    operationId: core.operationId,
    lamport: core.lamport,
    baseFrontier: decoded.context.baseFrontier,
    baseFrontierDigest: core.baseFrontierDigest,
    baseStateVectorDigest: core.baseStateVectorDigest,
    baseCanonicalStateDigest: core.baseCanonicalStateDigest,
    baseStateVector: cloneBytes(decoded.sections.baseStateVector),
    yjsUpdate: cloneBytes(decoded.sections.yjsUpdate),
    postStateVectorDigest: core.postStateVectorDigest,
    postCanonicalStateDigest: core.postCanonicalStateDigest,
    signerAuthority: decoded.context.signerAuthority,
  })
}

export interface VerifiedImmediatePredecessorCheckpoint {
  readonly checkpoint: ReplicaCheckpoint
  readonly checkpointObjectDigest: Digest
}

export function assertImmediatePredecessorCheckpointMaterializesHead(
  verified: VerifiedImmediatePredecessorCheckpoint,
  head: ImmediatePredecessorReplayHead,
): void {
  const core = verified.checkpoint.core
  assertSameScope(core.scope, head.scope, "Immediate-predecessor checkpoint base")
  if (
    core.baseFrontierDigest !== head.frontierDigest ||
    core.computedFrontierDigest !== head.frontierDigest ||
    core.actorHeadBoundaryDigest !== replicaActorHeadSetDigest(head.actorHeads) ||
    core.stateVectorDigest !== stateVectorDigest(head.stateVector) ||
    core.canonicalStateDigest !== head.canonicalStateDigest ||
    core.fullUpdateDigest !== yjsUpdateDigest(head.fullUpdate) ||
    core.fullUpdateByteLength !== String(head.fullUpdate.byteLength)
  ) failFrame("Immediate-predecessor checkpoint does not bind its journal base")
}

/** Verifies the exact closed checkpoint wrapper without admitting it to current runtime. */
export async function verifyImmediatePredecessorCheckpoint(
  exactBytes: Uint8Array,
  verifier: ImmediatePredecessorCheckpointSignatureVerifier,
): Promise<VerifiedImmediatePredecessorCheckpoint> {
  if (
    typeof verifier !== "object" || verifier === null ||
    typeof verifier.verifyCheckpoint !== "function"
  ) failFrame("Immediate-predecessor checkpoint requires an explicit signature verifier")
  const decoded = decodeRestrictedJcs(exactBytes)
  const checkpoint = parseImmediatePredecessorReplicaCheckpoint(decoded)
  if (!sameBytes(exactBytes, encodeRestrictedJcs(checkpoint))) {
    failFrame("Immediate-predecessor checkpoint bytes are not exact restricted JCS")
  }
  const expectedSchema = checkpoint.core.scope.docKind === "canvas"
    ? IMMEDIATE_PREDECESSOR_PROTOCOL.canvasSchemaDigest
    : IMMEDIATE_PREDECESSOR_PROTOCOL.projectPersistenceSchemaDigest
  const expectedCanonicalizer = checkpoint.core.scope.docKind === "canvas"
    ? IMMEDIATE_PREDECESSOR_PROTOCOL.canvasCanonicalizerDigest
    : IMMEDIATE_PREDECESSOR_PROTOCOL.projectIndexCanonicalizerDigest
  if (
    checkpoint.core.schemaDigest !== expectedSchema ||
    checkpoint.core.canonicalizerDigest !== expectedCanonicalizer
  ) failFrame("Immediate-predecessor checkpoint owner binding is invalid")
  if (!(await verifier.verifyCheckpoint(Object.freeze({
    scope: checkpoint.core.scope,
    authorReplicaId: checkpoint.core.authorReplicaId,
    authorActorId: checkpoint.core.authorActorId,
    authorAuthorizationDigest: checkpoint.core.authorAuthorizationDigest,
    coreDigest: checkpoint.coreDigest,
    signature: checkpoint.replicaSignature,
    purposeDigest: hexToBytes(checkpoint.coreDigest),
  })))) failFrame("Immediate-predecessor checkpoint signature is invalid")
  return Object.freeze({
    checkpoint,
    checkpointObjectDigest: structuredDigest(
      KERNEL_DIGEST_DOMAINS.replicaCheckpoint,
      parseImmediatePredecessorReplicaCheckpoint(checkpoint),
    ),
  })
}

export interface ImmediatePredecessorReplayHead {
  readonly scope: DocumentScope
  readonly headDigest: Digest
  readonly frontier: CausalFrontier
  readonly frontierDigest: Digest
  readonly actorHeads: ReplicaActorHeadSet
  readonly fullUpdate: Uint8Array
  readonly stateVector: StateVector
  readonly canonicalStateDigest: Digest
  readonly materializationDigest: Digest
}

export interface ImmediatePredecessorOwnerProjectionPort {
  createDocument(scope: DocumentScope): Y.Doc
  canonicalStateDigest(document: Y.Doc, scope: DocumentScope): Digest
}

export interface ImmediatePredecessorReplaySession {
  validateBase(head: ImmediatePredecessorReplayHead): void
  inspectFrame(ref: FrameObjectRef, exactBytes: Uint8Array): Promise<void>
  applyFrame(input: {
    readonly previous: ImmediatePredecessorReplayHead
    readonly ref: FrameObjectRef
    readonly exactBytes: Uint8Array
  }): Promise<ImmediatePredecessorReplayHead>
  actorHeadsDigest(actorHeads: ReplicaActorHeadSet): Digest
}

interface ReplayFrame {
  readonly verified: VerifiedImmediatePredecessorFrame
  readonly parents: readonly Digest[]
}

interface ReplayScopeState {
  readonly scope: DocumentScope
  readonly baseFullUpdate: Uint8Array
  readonly roots: ReadonlySet<Digest>
  readonly frames: Map<Digest, ReplayFrame>
}

/**
 * Migration-only deterministic replay. It reconstructs each frame's exact causal
 * base before applying its delta and separately materializes the accepted merged
 * head. The returned document dies with migration; it is never a second runtime.
 */
export function createImmediatePredecessorReplaySession(input: {
  readonly signatures: ImmediatePredecessorSignatureVerifier
  readonly owner: ImmediatePredecessorOwnerProjectionPort
}): ImmediatePredecessorReplaySession {
  if (typeof input.owner?.createDocument !== "function" || typeof input.owner?.canonicalStateDigest !== "function") {
    throw new TypeError("Immediate-predecessor replay owner is invalid")
  }
  const states = new Map<string, ReplayScopeState>()
  const scopeKey = (scope: DocumentScope) => new TextDecoder().decode(encodeRestrictedJcs(parseDocumentScope(scope)))
  const session: ImmediatePredecessorReplaySession = {
    validateBase(head) {
      const scope = parseDocumentScope(head.scope)
      const frontier = parseCausalFrontier(head.frontier)
      const actorHeads = parseReplicaActorHeadSet(head.actorHeads)
      assertSameScope(actorHeads.scope, scope, "Immediate-predecessor base actor heads")
      if (causalFrontierDigest(frontier) !== parseDigest(head.frontierDigest)) {
        failFrame("Immediate-predecessor base frontier digest mismatches")
      }
      if (replicaActorHeadSetDigest(actorHeads) !== replicaActorHeadSetDigest(head.actorHeads)) {
        failFrame("Immediate-predecessor base actor heads are invalid")
      }
      const document = input.owner.createDocument(scope)
      try {
        applyYjsUpdate(document, head.fullUpdate, Object.freeze({ format: "convax.immediate-predecessor-base" }))
        if (
          !sameBytes(encodeFullUpdate(document), head.fullUpdate) ||
          !sameBytes(encodeStateVector(document), head.stateVector) ||
          input.owner.canonicalStateDigest(document, scope) !== parseDigest(head.canonicalStateDigest)
        ) failFrame("Immediate-predecessor journal base materialization mismatches")
      } finally {
        document.destroy()
      }
      states.set(scopeKey(scope), {
        scope,
        baseFullUpdate: cloneBytes(head.fullUpdate),
        roots: new Set(frontier.heads.map((value) => value.frameDigest)),
        frames: new Map(),
      })
    },
    async inspectFrame(ref, exactBytes) {
      const verified = await verifyImmediatePredecessorFrame(exactBytes, input.signatures)
      assertFrameReference(ref, verified)
    },
    async applyFrame({ previous, ref, exactBytes }) {
      const scope = parseDocumentScope(previous.scope)
      const state = states.get(scopeKey(scope))
      if (!state) failFrame("Immediate-predecessor base was not validated before replay")
      const verified = await verifyImmediatePredecessorFrame(exactBytes, input.signatures)
      assertFrameReference(ref, verified)
      assertSameScope(verified.scope, scope, "Immediate-predecessor replay frame")
      const previousActorHeads = parseReplicaActorHeadSet(previous.actorHeads)
      const priorActor = previousActorHeads.heads.find((head) => head.actorId === verified.actorId) ?? null
      validateActorSequenceStep(
        priorActor,
        verified.actorId as CausalHeadRef["actorId"],
        verified.actorSequence,
        verified.predecessorFrameDigest,
      )
      const exactBase = materializeFrontier(state, verified.baseFrontier)
      try {
        const baseVector = encodeStateVector(exactBase)
        if (
          !sameBytes(baseVector, verified.baseStateVector) ||
          stateVectorDigest(baseVector) !== verified.baseStateVectorDigest ||
          input.owner.canonicalStateDigest(exactBase, scope) !== verified.baseCanonicalStateDigest
        ) failFrame("Immediate-predecessor frame exact base mismatches")
        applyYjsUpdate(exactBase, verified.yjsUpdate, Object.freeze({ format: "convax.immediate-predecessor-frame-base" }))
        if (
          stateVectorDigest(encodeStateVector(exactBase)) !== verified.postStateVectorDigest ||
          input.owner.canonicalStateDigest(exactBase, scope) !== verified.postCanonicalStateDigest
        ) failFrame("Immediate-predecessor frame post-state mismatches")
      } finally {
        exactBase.destroy()
      }
      const merged = input.owner.createDocument(scope)
      let fullUpdate: Uint8Array
      let stateVector: StateVector
      let canonicalStateDigest: Digest
      try {
        applyYjsUpdate(merged, previous.fullUpdate, Object.freeze({ format: "convax.immediate-predecessor-merged-base" }))
        if (
          !sameBytes(encodeStateVector(merged), previous.stateVector) ||
          input.owner.canonicalStateDigest(merged, scope) !== previous.canonicalStateDigest
        ) failFrame("Immediate-predecessor prior accepted head mismatches")
        applyYjsUpdate(merged, verified.yjsUpdate, Object.freeze({ format: "convax.immediate-predecessor-merged-frame" }))
        fullUpdate = encodeFullUpdate(merged)
        stateVector = encodeStateVector(merged)
        canonicalStateDigest = input.owner.canonicalStateDigest(merged, scope)
      } finally {
        merged.destroy()
      }
      const nextHead: CausalHeadRef = Object.freeze({
        format: "convax.causal-head-ref",
        actorId: verified.actorId as CausalHeadRef["actorId"],
        actorSequence: verified.actorSequence,
        frameDigest: verified.frameDigest,
        lamport: verified.lamport,
      })
      state.frames.set(verified.frameDigest, Object.freeze({
        verified,
        parents: Object.freeze(verified.baseFrontier.heads.map((head) => head.frameDigest)),
      }))
      const frontier = maxCausalFrontier(
        [...parseCausalFrontier(previous.frontier).heads, nextHead],
        { contains: (descendant, ancestor) => contains(state, descendant, ancestor, new Set()) },
      )
      if (frontier === "pending") failFrame("Immediate-predecessor causal closure is incomplete")
      const actorHeads = replaceReplicaActorHead(previousActorHeads, nextHead)
      const frontierDigest = causalFrontierDigest(frontier)
      const materializationDigest = structuredDigest("convax.immediate-predecessor-materialized-head", {
        format: "convax.immediate-predecessor-materialized-head",
        scope,
        frameDigest: verified.frameDigest,
        frontierDigest,
        actorHeadsDigest: replicaActorHeadSetDigest(actorHeads),
        stateVectorDigest: stateVectorDigest(stateVector),
        canonicalStateDigest,
      })
      return Object.freeze({
        scope,
        headDigest: previous.headDigest,
        frontier,
        frontierDigest,
        actorHeads,
        fullUpdate,
        stateVector,
        canonicalStateDigest,
        materializationDigest,
      })
    },
    actorHeadsDigest: replicaActorHeadSetDigest,
  }
  return Object.freeze(session)

  function materializeFrontier(state: ReplayScopeState, frontierInput: CausalFrontier): Y.Doc {
    const frontier = parseCausalFrontier(frontierInput)
    const document = input.owner.createDocument(state.scope)
    applyYjsUpdate(document, state.baseFullUpdate, Object.freeze({ format: "convax.immediate-predecessor-exact-base" }))
    const emitted = new Set<Digest>()
    for (const head of frontier.heads) append(head.frameDigest, new Set())
    return document

    function append(digest: Digest, visiting: Set<Digest>): void {
      if (state.roots.has(digest) || emitted.has(digest)) return
      const frame = state.frames.get(digest)
      if (!frame) failFrame("Immediate-predecessor frame references an unavailable causal parent")
      if (visiting.has(digest)) failFrame("Immediate-predecessor causal closure contains a cycle")
      visiting.add(digest)
      for (const parent of frame.parents) append(parent, visiting)
      visiting.delete(digest)
      applyYjsUpdate(document, frame.verified.yjsUpdate, Object.freeze({ format: "convax.immediate-predecessor-exact-base-frame" }))
      emitted.add(digest)
    }
  }
}

function contains(
  state: ReplayScopeState,
  descendant: Digest,
  ancestor: Digest,
  visiting: Set<Digest>,
): boolean | "pending" {
  if (descendant === ancestor) return true
  if (state.roots.has(descendant)) return false
  const frame = state.frames.get(descendant)
  if (!frame) return "pending"
  if (visiting.has(descendant)) failFrame("Immediate-predecessor causal closure contains a cycle")
  visiting.add(descendant)
  for (const parent of frame.parents) {
    if (parent === ancestor) return true
    const nested = contains(state, parent, ancestor, visiting)
    if (nested === true) return true
    if (nested === "pending") return "pending"
  }
  visiting.delete(descendant)
  return false
}

function assertFrameReference(
  ref: FrameObjectRef,
  frame: VerifiedImmediatePredecessorFrame,
): void {
  assertSameScope(ref.scope, frame.scope, "Immediate-predecessor frame object")
  if (
    ref.frameDigest !== frame.frameDigest ||
    ref.actorId !== frame.actorId ||
    ref.actorSequence !== frame.actorSequence ||
    ref.operationId !== frame.operationId
  ) failFrame("Immediate-predecessor frame object reference mismatches exact bytes")
}

function parseImmediatePredecessorReplicaCheckpoint(value: unknown): ReplicaCheckpoint {
  assertExactKeys(value, ["format", "core", "coreDigest", "replicaSignature"], "ImmediatePredecessorReplicaCheckpoint")
  if (value.format !== "convax.replica-checkpoint") failFrame("Immediate-predecessor checkpoint format is invalid")
  const core = parseImmediatePredecessorReplicaCheckpointCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== structuredDigest(KERNEL_DIGEST_DOMAINS.replicaCheckpointCore, core)) {
    failFrame("Immediate-predecessor checkpoint core digest mismatches")
  }
  return Object.freeze({
    format: value.format,
    core,
    coreDigest,
    replicaSignature: parseSignature(value.replicaSignature),
  })
}

function parseImmediatePredecessorReplicaCheckpointCore(value: unknown): ReplicaCheckpointCore {
  assertExactKeys(value, [
    "format", "scope", "checkpointId", "authorMemberId", "authorReplicaId", "authorActorId",
    "authorAuthorizationDigest", "directParentCheckpointDigests", "baseFrontierDigest",
    "computedFrontierDigest", "actorHeadBoundaryDigest", "stateVectorDigest", "canonicalStateDigest",
    "fullUpdateDigest", "fullUpdateByteLength", "protocolDigest", "schemaDigest", "canonicalizerDigest",
    "validationArtifactSetDigest",
  ], "ImmediatePredecessorReplicaCheckpointCore")
  if (value.format !== "convax.replica-checkpoint-core") {
    failFrame("Immediate-predecessor checkpoint core format is invalid")
  }
  assertDenseArray(value.directParentCheckpointDigests, "Immediate-predecessor checkpoint parents")
  if (value.directParentCheckpointDigests.length > 8) {
    failFrame("Immediate-predecessor checkpoint parent count exceeds eight")
  }
  const directParentCheckpointDigests = value.directParentCheckpointDigests.map(parseDigest)
  for (let index = 1; index < directParentCheckpointDigests.length; index += 1) {
    if (compareUtf8(directParentCheckpointDigests[index - 1]!, directParentCheckpointDigests[index]!) >= 0) {
      failFrame("Immediate-predecessor checkpoint parents are not sorted and unique")
    }
  }
  const fullUpdateByteLength = parseUint64(value.fullUpdateByteLength)
  if (BigInt(fullUpdateByteLength) > 32n * 1024n * 1024n) {
    failFrame("Immediate-predecessor checkpoint snapshot exceeds 32 MiB")
  }
  const protocolDigest = parseDigest(value.protocolDigest)
  if (protocolDigest !== IMMEDIATE_PREDECESSOR_PROTOCOL.protocolDigest) {
    failFrame("Immediate-predecessor checkpoint protocol digest mismatches")
  }
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScope(value.scope),
    checkpointId: parseId128(value.checkpointId),
    authorMemberId: parseMemberId(value.authorMemberId),
    authorReplicaId: parseReplicaId(value.authorReplicaId),
    authorActorId: parseActorId(value.authorActorId),
    authorAuthorizationDigest: parseDigest(value.authorAuthorizationDigest),
    directParentCheckpointDigests: Object.freeze(directParentCheckpointDigests),
    baseFrontierDigest: parseDigest(value.baseFrontierDigest),
    computedFrontierDigest: parseDigest(value.computedFrontierDigest),
    actorHeadBoundaryDigest: parseDigest(value.actorHeadBoundaryDigest),
    stateVectorDigest: parseDigest(value.stateVectorDigest),
    canonicalStateDigest: parseDigest(value.canonicalStateDigest),
    fullUpdateDigest: parseDigest(value.fullUpdateDigest),
    fullUpdateByteLength,
    protocolDigest,
    schemaDigest: parseDigest(value.schemaDigest),
    canonicalizerDigest: parseDigest(value.canonicalizerDigest),
    validationArtifactSetDigest: parseDigest(value.validationArtifactSetDigest),
  })
}
