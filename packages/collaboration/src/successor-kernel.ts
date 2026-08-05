import type * as Y from "yjs"
import { type VerifiedProtocolAuthorityV2 } from "./authority"
import {
  causalHeadRefFromDecodedFrameV3,
  frameObjectRefFromDecodedFrameV3,
  incomingFrameClosureV3,
  replaceReplicaActorHeadV2,
} from "./accepted-head"
import { cloneBytesV2, sameBytes } from "./binary"
import { maxCausalFrontierV2, nextLamportV2 } from "./causal"
import { assertDocumentOwnerBindingV2, validateOwnerCanonicalStateBytesV2 } from "./canonicalizer"
import type { DigestV2, Id128V2, StateVectorV2 } from "./codecs"
import { parseDigestV2, parseId128V2, parseUint64V2 } from "./codecs"
import { KERNEL_DIGEST_DOMAINS_V2 } from "./constants"
import type {
  ActualWriteEvidenceV2,
  CausalFrontierV2,
  CausalHeadRefV2,
  DocumentOwnerRuntimeV2,
  DocumentOwnerProtocolPortV2,
  DocumentScopeV2,
  FrameObjectRefV2,
  OwnerExternalFactPortV2,
  OwnerIntentConstructionContextV2,
  OwnerIntentDependenciesV2,
  OwnerValidatedStateV2,
  OwnerApplyResultV2,
  ReplicaActorHeadSetV2,
  ValidationArtifactSetV2,
} from "./contracts"
import {
  actualWriteEvidenceDigestV3,
  type CausalContextV3,
  type CausalDependencyRefV3,
  type CausalEditCoreV3,
  type DecodedCausalEditFrameV3,
  type VerifiedProtocolAuthorityV3,
} from "./successor-frame"
import { causalSignerAuthorityDigestV3 } from "./successor-authority"
import { selectedCausalProtocolCodecV3, type SelectedCausalProtocolCodecV3 } from "./protocol-codec-strategy"
import { selectedSuccessorValidationArtifactSetV3 } from "./successor-validation-artifacts"
import { canonicalStateDigestV2, structuredDigestV2 } from "./digest"
import { CollaborationKernelErrorV2 } from "./errors"
import { verifyExactEd25519V2, type Ed25519VerifierPortV2 } from "./crypto"
import { assertExactKeysV2, decodeRestrictedJcsV2, encodeRestrictedJcsV2, isPlainDataObject, sameBytes as sameJcsBytes } from "./jcs"
import { assertSameScopeV2, parseCausalFrontierV2, parseDocumentScopeV2, parseReplicaActorHeadSetV2, parseValidationArtifactSetV2 } from "./parse"
import type { AcceptedHeadViewV2, CollaborationKernelPortsV3, PendingFrameReasonV2 } from "./ports"
import type { SessionUndoCoordinatorV2 } from "./undo"
import { assertDocumentOwnerRuntimeV2, assertOwnerExternalFactPortV2 } from "./owner-runtime"
import {
  ACCEPTED_FRAME_ORIGIN_V2,
  LOCAL_CANDIDATE_ORIGIN_V2,
  applyUpdateV1V2,
  cloneExactBaseDocumentV2,
  encodeCandidateDeltaV2,
  encodeFullUpdateV2,
  encodeStateVectorV2,
  parseStateVectorV2,
  stateVectorDigestV2,
  validateCanonicalDeltaV2,
  yjsUpdateDigestV2,
} from "./yjs-codec"

const claimedOwnerFactPortsV2 = new WeakSet<object>()

export interface CollaborationKernelOptionsV3 {
  readonly authority: VerifiedProtocolAuthorityV3
  /** R5 remains the immutable owner-artifact verifier for unchanged owner schemas. */
  readonly historicalAuthority: VerifiedProtocolAuthorityV2
  readonly scope: DocumentScopeV2
  readonly owner: DocumentOwnerRuntimeV2
  readonly ports: CollaborationKernelPortsV3
  readonly signatureVerifier: Ed25519VerifierPortV2
  readonly projection?: { publish(input: { readonly scope: DocumentScopeV2; readonly frameDigest: DigestV2 }): void }
  readonly undo?: SessionUndoCoordinatorV2
}

export interface LocalIntentRequestV3 {
  readonly operationId: Id128V2
  readonly prepare: (input: {
    readonly base: OwnerValidatedStateV2
    readonly context: OwnerIntentConstructionContextV2
    readonly signal?: AbortSignal
  }) => Promise<PreparedLocalIntentV3> | PreparedLocalIntentV3
  readonly signal?: AbortSignal
  readonly historyTransition?: Readonly<{ direction: "undo" | "redo"; cursorToken: Id128V2 }>
}

export interface PreparedLocalIntentV3 {
  readonly typedIntent: unknown
  readonly externalFacts: OwnerExternalFactPortV2
}

export type LocalCommitResultV3 =
  | { readonly status: "saved-locally"; readonly frame: DecodedCausalEditFrameV3; readonly acceptedFrontierDigest: DigestV2 }
  | { readonly status: "duplicate"; readonly frame: DecodedCausalEditFrameV3; readonly acceptedFrontierDigest: DigestV2 }
  | { readonly status: "recovered-final-frame"; readonly frame: DecodedCausalEditFrameV3; readonly acceptedFrontierDigest: DigestV2 }

export type IncomingFrameResultV3 =
  | { readonly status: "accepted"; readonly frame: DecodedCausalEditFrameV3 }
  | { readonly status: "duplicate"; readonly frame: DecodedCausalEditFrameV3 }
  | { readonly status: "dependency-pending"; readonly frame: DecodedCausalEditFrameV3; readonly reason: PendingFrameReasonV2 }

export interface ReplicaProjectionSnapshotV3 {
  readonly scope: DocumentScopeV2
  readonly acceptedHeadDigest: DigestV2
  readonly frontier: CausalFrontierV2
  readonly stateVector: StateVectorV2
  readonly fullUpdate: Readonly<Uint8Array>
  readonly canonicalStateDigest: DigestV2
}

export class CollaborationKernelV3 {
  private readonly codec: SelectedCausalProtocolCodecV3
  private disposed = false
  private head: AcceptedHeadViewV2
  private replicaDoc: Y.Doc
  private queue: Promise<void> = Promise.resolve()

  private constructor(private readonly options: CollaborationKernelOptionsV3, head: AcceptedHeadViewV2, replicaDoc: Y.Doc) {
    this.codec = selectedCausalProtocolCodecV3(options.authority)
    this.head = head
    this.replicaDoc = replicaDoc
  }

  static async open(options: CollaborationKernelOptionsV3): Promise<CollaborationKernelV3> {
    // Candidate capability liveness is checked by the selected V3 codec.
    selectedCausalProtocolCodecV3(options.authority)
    assertDocumentOwnerRuntimeV2(options.owner, options.historicalAuthority)
    const owner = options.owner.protocolPort
    const scope = parseDocumentScopeV2(options.scope)
    if (owner.owner !== scope.docKind) invalid("Document owner kind differs from the shard scope")
    assertDocumentOwnerBindingV2(owner)
    const head = normalizeAcceptedHead(await options.ports.persistence.loadReplicaHead(scope), scope)
    const replicaDoc = cloneExactBaseDocumentV2(options.ports, head.fullUpdate, head.stateVector)
    try {
      assertOwnerCanonical(owner, replicaDoc, head.canonicalStateDigest)
      requireOwnerState(owner.validateBase(replicaDoc), "Accepted head does not satisfy the owner schema")
      return new CollaborationKernelV3({ ...options, scope }, head, replicaDoc)
    } catch (error) {
      replicaDoc.destroy()
      throw error
    }
  }

  commitLocalIntent(request: LocalIntentRequestV3): Promise<LocalCommitResultV3> {
    return this.exclusive(() => this.commitLocalIntentExclusive(request))
  }

  receiveFrame(exactBytes: Uint8Array, signal?: AbortSignal): Promise<IncomingFrameResultV3> {
    const retained = cloneBytesV2(exactBytes, "incoming causal frame")
    return this.exclusive(async () => {
      try {
        return await this.receiveFrameExclusive(retained, signal)
      } catch (error) {
        if (error instanceof CollaborationKernelErrorV2 && error.code === "dependency-pending") {
          return this.retainPending(this.codec.decodeFrame(retained), "missing-artifact")
        }
        throw error
      }
    })
  }

  getProjectionSnapshot(): ReplicaProjectionSnapshotV3 {
    this.requireLive()
    return Object.freeze({
      scope: this.options.scope,
      acceptedHeadDigest: this.head.headDigest,
      frontier: this.head.frontier,
      stateVector: encodeStateVectorV2(this.replicaDoc),
      fullUpdate: encodeFullUpdateV2(this.replicaDoc),
      canonicalStateDigest: this.head.canonicalStateDigest,
    })
  }

  queryOwnerState<T>(project: (state: OwnerValidatedStateV2) => T): Promise<T> {
    if (typeof project !== "function") invalid("Owner-state projector is required")
    return this.exclusive(async () => {
      this.requireLive()
      const state = requireOwnerState(
        this.options.owner.protocolPort.validateBase(this.replicaDoc),
        "Current replicaDoc violates the owner schema",
      )
      return project(state)
    })
  }

  flush(): Promise<void> {
    return this.exclusive(async () => this.requireLive())
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.options.undo?.clear("unmount")
    this.replicaDoc.destroy()
  }

  private async commitLocalIntentExclusive(request: LocalIntentRequestV3): Promise<LocalCommitResultV3> {
    this.requireLive()
    assertDocumentOwnerBindingV2(this.options.owner.protocolPort)
    if (typeof request.prepare !== "function") invalid("Local intent prepare callback is required")
    const operationId = parseId128V2(request.operationId)
    const localActorId = this.options.ports.localAuthority.actorId
    const lookup = await this.options.ports.persistence.lookupOperation(localActorId, operationId)
    if (lookup.status === "accepted") {
      if (!await this.options.ports.persistence.isReachableFromAcceptedHead(lookup.ref)) throw new CollaborationKernelErrorV2("read-only-recovery-required", "Accepted operation is not reachable from the sole durable head")
      await this.refreshAcceptedHead()
      return Object.freeze({ status: "duplicate", frame: this.codec.decodeFrame(lookup.bytes), acceptedFrontierDigest: this.head.frontierDigest })
    }
    if (lookup.status === "same-frame-recovery" || lookup.status === "object-only-recovery") {
      return this.recoverFinalLocalFrame(lookup.bytes, localActorId, operationId, request.signal)
    }
    if (lookup.status === "equivocation") await this.quarantineEquivocation(lookup.frameDigests)
    assertNotAborted(request.signal)
    const durableHead = normalizeAcceptedHead(await this.options.ports.persistence.loadReplicaHead(this.options.scope), this.options.scope)
    if (durableHead.headDigest !== this.head.headDigest) stale()
    const previousActorHead = actorHeadFor(this.head.actorHeads, localActorId)
    const authority = await this.options.ports.localAuthority.prepareFinalFrameAuthority({
      scope: this.options.scope,
      operationId,
      baseFrontier: this.head.frontier,
      previousActorHead,
      ownerSchemaDigest: this.options.owner.protocolPort.schemaDigest,
    })
    if (authority === "pending") pending("Local edit authority is pending")
    if (authority === "rejected") invalid("Local edit authority rejected the mutation")
    if (authority.actorId !== localActorId || authority.actorId !== authority.signerAuthority.actorId) invalid("Local authority actor binding mismatches")
    const artifacts = parseValidationArtifactSetV2(authority.validationArtifacts)
    assertRequiredProtocolArtifacts(artifacts, this.options.authority, this.options.historicalAuthority)
    const validationArtifactSetDigest = validationArtifactSetDigestV2(artifacts)
    const baseStateVector = encodeStateVectorV2(this.replicaDoc)
    const baseCanonicalStateDigest = assertOwnerCanonical(this.options.owner.protocolPort, this.replicaDoc, this.head.canonicalStateDigest)
    const baseState = requireOwnerState(this.options.owner.protocolPort.validateBase(this.replicaDoc), "Current replicaDoc violates the owner schema")
    const lamport = nextLamportV2(this.head.frontier)
    validateActorSuccessorV3(previousActorHead, authority.actorId, authority.actorSequence, authority.predecessorFrameDigest, authority.dependencies)
    const constructionContext: OwnerIntentConstructionContextV2 = Object.freeze({
      scope: this.options.scope,
      actorId: authority.actorId,
      actorSequence: authority.actorSequence,
      operationId,
      lamport,
      baseFrontierDigest: this.head.frontierDigest,
      protocolDigest: this.codec.protocolDigest,
      ownerSchemaDigest: this.options.owner.protocolPort.schemaDigest,
      validationArtifactSetDigest,
    })
    const prepared = requirePreparedLocalIntent(await request.prepare({
      base: baseState,
      context: constructionContext,
      signal: request.signal,
    }))
    console.error("V3 kernel debug: prepared", request.operationId ?? null)
    assertNotAborted(request.signal)
    assertOwnerExternalFactPortV2(prepared.externalFacts, this.options.owner)
    claimOwnerFactPort(prepared.externalFacts)
    const typedIntentJcs = encodeRestrictedJcsV2(prepared.typedIntent)
    const exactTypedIntent = decodeRestrictedJcsV2(typedIntentJcs)
    const intentKind = requireTypedIntentKind(exactTypedIntent)
    const intent = requireDecodedIntent(this.options.owner.protocolPort.decodeIntent(cloneBytesV2(typedIntentJcs, "typed-intent JCS")))
    const intentDigest = this.codec.typedIntentDigest(typedIntentJcs)
    const context: CausalContextV3 = this.codec.parseCausalContext({
      format: "convax.causal-context/3",
      scope: this.options.scope,
      baseFrontier: this.head.frontier,
      baseFrontierDigest: this.head.frontierDigest,
      baseStateVectorDigest: stateVectorDigestV2(baseStateVector),
      baseCanonicalStateDigest,
      signerAuthority: authority.signerAuthority,
      dependencies: authority.dependencies,
      validationArtifactSetDigest,
    })
    const causalContextJcs = encodeRestrictedJcsV2(context)
    const fullBaseUpdate = encodeFullUpdateV2(this.replicaDoc)
    const candidate = cloneExactBaseDocumentV2(this.options.ports, fullBaseUpdate, baseStateVector, authority.signerAuthority.replicaId)
    try {
      const ownerContext = {
        scope: this.options.scope,
        actorId: authority.actorId,
        actorSequence: authority.actorSequence,
        operationId,
        lamport,
        intentDigest,
        baseFrontierDigest: this.head.frontierDigest,
        protocolDigest: this.codec.protocolDigest,
        ownerSchemaDigest: this.options.owner.protocolPort.schemaDigest,
        validationArtifactSetDigest,
      } as const
      const declaredDependencies = requireOwnerDependencies(
        this.options.owner.closurePort.discoverDependencies({ context: ownerContext, intent }),
        "Local owner dependency discovery failed",
      )
      console.error("V3 kernel debug: dependencies", operationId)
      const applyResult = applyOwnerIntent(
        this.options.owner.protocolPort,
        candidate,
        ownerContext,
        intent,
        prepared.externalFacts,
      )
      console.error("V3 kernel debug: applied", operationId)
      assertConsumedDependencies(prepared.externalFacts, declaredDependencies)
      requireOwnerState(this.options.owner.protocolPort.validatePost(baseState, candidate, applyResult), "Candidate post-state violates owner invariants")
      let evidence: ActualWriteEvidenceV2
      try {
        evidence = this.codec.parseActualWriteEvidence(this.options.owner.protocolPort.deriveActualWriteEvidence(applyResult))
      } catch (error) {
        console.error("V3 kernel evidence failure", error)
        throw error
      }
      console.error("V3 kernel debug: evidence", operationId)
      assertEvidenceClosure(evidence, this.options.scope, this.options.owner.protocolPort.schemaDigest, intentDigest)
      const actualWriteEvidenceJcs = encodeRestrictedJcsV2(evidence)
      const yjsUpdate = encodeCandidateDeltaV2(candidate, baseStateVector)
      const canonical = validateCanonicalDeltaV2(this.options.ports, fullBaseUpdate, baseStateVector, yjsUpdate, authority.signerAuthority.replicaId)
      try {
        const postStateVector = canonical.postStateVector
        const postCanonicalStateDigest = ownerCanonicalDigest(this.options.owner.protocolPort, canonical.document)
        const core: CausalEditCoreV3 = Object.freeze({
          format: "convax.causal-edit-core/3",
          scope: this.options.scope,
          actorId: authority.actorId,
          actorSequence: authority.actorSequence,
          predecessorFrameDigest: authority.predecessorFrameDigest,
          operationId,
          lamport,
          intentKind,
          intentDigest,
          causalContextDigest: this.codec.causalContextDigest(context),
          baseFrontierDigest: this.head.frontierDigest,
          baseStateVectorDigest: stateVectorDigestV2(baseStateVector),
          baseCanonicalStateDigest,
          yjsUpdateDigest: yjsUpdateDigestV2(yjsUpdate),
          postStateVectorDigest: stateVectorDigestV2(postStateVector),
          postCanonicalStateDigest,
          actualWriteEvidenceDigest: actualWriteEvidenceDigestV3(evidence),
          typedIntentJcsByteLength: parseUint64V2(String(typedIntentJcs.byteLength)),
          causalContextJcsByteLength: parseUint64V2(String(causalContextJcs.byteLength)),
          baseStateVectorByteLength: parseUint64V2(String(baseStateVector.byteLength)),
          yjsUpdateByteLength: parseUint64V2(String(yjsUpdate.byteLength)),
          actualWriteEvidenceJcsByteLength: parseUint64V2(String(actualWriteEvidenceJcs.byteLength)),
          protocolDigest: this.codec.protocolDigest,
          ownerSchemaDigest: this.options.owner.protocolPort.schemaDigest,
          canonicalizerDigest: this.options.owner.protocolPort.canonicalizerDigest,
          validationArtifactSetDigest,
          signerAuthorityKind: authority.signerAuthority.kind,
          signerAuthorityDigest: causalSignerAuthorityDigestV3(authority.signerAuthority),
        })
        const header = await this.codec.signCore(core, authority.signer)
        const bytes = this.codec.encodeFrame({
          header,
          sections: { typedIntentJcs, causalContextJcs, baseStateVector, yjsUpdate, actualWriteEvidenceJcs },
        })
        const frame = this.codec.decodeFrame(bytes)
        const newHead = causalHeadRefFromDecodedFrameV3(frame)
        const durableHeadDigest = await this.persistLocal(frame, newHead, request.signal)
        try {
          applyUpdateV1V2(this.replicaDoc, yjsUpdate, ACCEPTED_FRAME_ORIGIN_V2)
          this.installHead(frame, [newHead], postCanonicalStateDigest, durableHeadDigest)
        } catch (error) {
          await this.rebuildAfterDurableApplyFailure(error)
        }
        this.finishUndo(applyResult, operationId, request.historyTransition)
        if (!request.signal?.aborted) this.options.projection?.publish({ scope: this.options.scope, frameDigest: frame.frameDigest })
        return Object.freeze({ status: "saved-locally", frame, acceptedFrontierDigest: this.head.frontierDigest })
      } finally {
        canonical.document.destroy()
      }
    } finally {
      candidate.destroy()
    }
  }

  private async receiveFrameExclusive(bytes: Uint8Array, signal?: AbortSignal): Promise<IncomingFrameResultV3> {
    this.requireLive()
    assertNotAborted(signal)
    const frame = this.codec.decodeFrame(bytes)
    assertSameScopeV2(frame.header.core.scope, this.options.scope, "Incoming frame scope")
    const core = frame.header.core
    assertDocumentOwnerBindingV2(this.options.owner.protocolPort)
    if (core.ownerSchemaDigest !== this.options.owner.protocolPort.schemaDigest || core.canonicalizerDigest !== this.options.owner.protocolPort.canonicalizerDigest) invalid("Incoming owner schema or canonicalizer digest mismatches")
    const lookup = await this.options.ports.persistence.lookupOperation(core.actorId, core.operationId)
    if (lookup.status === "accepted" || lookup.status === "same-frame-recovery" || lookup.status === "object-only-recovery") {
      const accepted = this.codec.decodeFrame(lookup.bytes)
      if (accepted.frameDigest !== frame.frameDigest) await this.quarantineEquivocation([accepted.frameDigest, frame.frameDigest])
      if (lookup.status === "accepted") {
        if (!await this.options.ports.persistence.isReachableFromAcceptedHead(lookup.ref)) throw new CollaborationKernelErrorV2("read-only-recovery-required", "Accepted incoming operation is below the durable head without reachability proof")
        await this.refreshAcceptedHead()
      }
      return Object.freeze({ status: "duplicate", frame: accepted })
    }
    if (lookup.status === "equivocation") await this.quarantineEquivocation([...lookup.frameDigests, frame.frameDigest])
    const authority = await this.options.ports.incomingAuthority.verifyFrameAuthority(frame)
    if (authority === "pending") return this.retainPending(frame, "missing-proof")
    if (authority === "rejected") invalid("Incoming frame authority is rejected")
    const signatureOk = await verifyExactEd25519V2(this.options.signatureVerifier, authority.replicaPublicKey, frame.header.replicaSignature, this.codec.causalEditSignatureDigest(frame.header.coreDigest))
    if (!signatureOk) invalid("Incoming replica signature is invalid")
    const currentActorHead = actorHeadFor(this.head.actorHeads, core.actorId)
    if (currentActorHead === null && core.actorSequence !== "1") return this.retainPending(frame, "missing-predecessor")
    try {
      validateActorSuccessorV3(currentActorHead, core.actorId, core.actorSequence, core.predecessorFrameDigest, frame.context.dependencies)
    } catch {
      await this.quarantineEquivocation([...(currentActorHead ? [currentActorHead.frameDigest] : []), frame.frameDigest])
    }
    const base = await this.options.ports.exactBaseResolver.reconstructExactBase(frame)
    if (base === "pending") return this.retainPending(frame, "missing-base")
    if (base === "rejected") invalid("Incoming exact base reconstruction is rejected")
    if (base.canonicalStateDigest !== core.baseCanonicalStateDigest || !sameBytes(base.stateVector, frame.sections.baseStateVector)) invalid("Incoming frame exact base bytes mismatch its signed core")
    const baseActorHeads = parseReplicaActorHeadSetV2(base.actorHeads)
    assertSameScopeV2(baseActorHeads.scope, this.options.scope, "Incoming exact-base actor-head scope")
    if (structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.causalFrontier, parseCausalFrontierV2(base.frontier)) !== core.baseFrontierDigest) invalid("Incoming exact base frontier mismatches")
    const baseDoc = cloneExactBaseDocumentV2(this.options.ports, base.fullUpdate, base.stateVector)
    const authored = validateCanonicalDeltaV2(this.options.ports, base.fullUpdate, base.stateVector, frame.sections.yjsUpdate, frame.context.signerAuthority.replicaId)
    try {
      const baseState = requireOwnerState(this.options.owner.protocolPort.validateBase(baseDoc), "Incoming exact base violates owner schema")
      assertOwnerCanonical(this.options.owner.protocolPort, baseDoc, core.baseCanonicalStateDigest)
      const intent = requireDecodedIntent(this.options.owner.protocolPort.decodeIntent(frame.sections.typedIntentJcs))
      const ownerContext = {
        scope: this.options.scope,
        actorId: core.actorId,
        actorSequence: core.actorSequence,
        operationId: core.operationId,
        lamport: core.lamport,
        intentDigest: core.intentDigest,
        baseFrontierDigest: core.baseFrontierDigest,
        protocolDigest: core.protocolDigest,
        ownerSchemaDigest: core.ownerSchemaDigest,
        validationArtifactSetDigest: core.validationArtifactSetDigest,
      } as const
      const declaredDependencies = requireOwnerDependencies(
        this.options.owner.closurePort.discoverDependencies({ context: ownerContext, intent }),
        "Incoming owner dependency discovery failed",
      )
      assertNotAborted(signal)
      const facts = await this.options.ports.incomingFacts.resolve({ frame, declaredDependencies, signal })
      assertNotAborted(signal)
      if (facts.status !== "resolved") {
        if (facts.status === "rejected") invalid("Incoming owner fact resolution is rejected")
        return this.retainPending(frame, "missing-artifact")
      }
      assertOwnerExternalFactPortV2(facts.port, this.options.owner)
      claimOwnerFactPort(facts.port)
      const rerun = cloneExactBaseDocumentV2(this.options.ports, base.fullUpdate, base.stateVector, frame.context.signerAuthority.replicaId)
      try {
        const result = applyOwnerIntent(this.options.owner.protocolPort, rerun, ownerContext, intent, facts.port)
        assertConsumedDependencies(facts.port, declaredDependencies)
        requireOwnerState(this.options.owner.protocolPort.validatePost(baseState, rerun, result), "Incoming rerun violates owner post invariants")
        const rerunDelta = encodeCandidateDeltaV2(rerun, base.stateVector)
        if (!sameBytes(rerunDelta, frame.sections.yjsUpdate)) invalid("Incoming owner rerun does not reproduce byte-identical Yjs delta")
        const rerunEvidence = encodeRestrictedJcsV2(this.codec.parseActualWriteEvidence(this.options.owner.protocolPort.deriveActualWriteEvidence(result)))
        if (!sameBytes(rerunEvidence, frame.sections.actualWriteEvidenceJcs)) invalid("Incoming owner rerun does not reproduce exact write evidence")
      } finally {
        rerun.destroy()
      }
      if (stateVectorDigestV2(authored.postStateVector) !== core.postStateVectorDigest || ownerCanonicalDigest(this.options.owner.protocolPort, authored.document) !== core.postCanonicalStateDigest) {
        invalid("Incoming signed post-state digests mismatch the exact authored candidate")
      }
      const merged = cloneExactBaseDocumentV2(this.options.ports, encodeFullUpdateV2(this.replicaDoc), encodeStateVectorV2(this.replicaDoc))
      try {
        applyUpdateV1V2(merged, frame.sections.yjsUpdate, ACCEPTED_FRAME_ORIGIN_V2)
        encodeStateVectorV2(merged)
        requireOwnerState(this.options.owner.protocolPort.validateBase(merged), "Merged incoming state violates closed-schema or I-confluence invariants")
        const mergedCanonical = ownerCanonicalDigest(this.options.owner.protocolPort, merged)
        const newHead = causalHeadRefFromDecodedFrameV3(frame)
        const frontier = maxCausalFrontierV2([...this.head.frontier.heads, newHead], incomingFrameClosureV3(frame, this.options.ports.causalClosure))
        if (frontier === "pending") return this.retainPending(frame, "missing-base")
        const durableHeadDigest = await this.persistIncoming(frame, newHead, frontier)
        try {
          applyUpdateV1V2(this.replicaDoc, frame.sections.yjsUpdate, ACCEPTED_FRAME_ORIGIN_V2)
          this.installHead(frame, frontier.heads, mergedCanonical, durableHeadDigest)
        } catch (error) {
          await this.rebuildAfterDurableApplyFailure(error)
        }
        this.options.projection?.publish({ scope: this.options.scope, frameDigest: frame.frameDigest })
        return Object.freeze({ status: "accepted", frame })
      } finally {
        merged.destroy()
      }
    } finally {
      baseDoc.destroy()
      authored.document.destroy()
    }
  }

  private async recoverFinalLocalFrame(
    bytes: Uint8Array,
    actorId: string,
    operationId: Id128V2,
    signal?: AbortSignal,
  ): Promise<LocalCommitResultV3> {
    const frame = this.codec.decodeFrame(bytes)
    const core = frame.header.core
    assertDocumentOwnerBindingV2(this.options.owner.protocolPort)
    if (core.ownerSchemaDigest !== this.options.owner.protocolPort.schemaDigest || core.canonicalizerDigest !== this.options.owner.protocolPort.canonicalizerDigest) invalid("Recovery owner schema or canonicalizer digest mismatches")
    if (core.actorId !== actorId || core.operationId !== operationId) await this.quarantineEquivocation([frame.frameDigest])
    assertSameScopeV2(core.scope, this.options.scope, "Recovery frame scope")
    const baseStateVector = encodeStateVectorV2(this.replicaDoc)
    if (core.baseFrontierDigest !== this.head.frontierDigest || core.baseStateVectorDigest !== stateVectorDigestV2(baseStateVector) || core.baseCanonicalStateDigest !== this.head.canonicalStateDigest) {
      throw new CollaborationKernelErrorV2("read-only-recovery-required", "Original final frame is no longer directly above the accepted head")
    }
    const authority = await this.options.ports.incomingAuthority.verifyFrameAuthority(frame)
    if (authority === "pending") pending("Recovery frame authority is pending")
    if (authority === "rejected") invalid("Recovery frame authority is rejected")
    if (!await verifyExactEd25519V2(this.options.signatureVerifier, authority.replicaPublicKey, frame.header.replicaSignature, this.codec.causalEditSignatureDigest(frame.header.coreDigest))) {
      invalid("Recovery frame signature is invalid")
    }
    const fullBaseUpdate = encodeFullUpdateV2(this.replicaDoc)
    const baseState = requireOwnerState(this.options.owner.protocolPort.validateBase(this.replicaDoc), "Recovery base violates owner schema")
    const rerun = cloneExactBaseDocumentV2(this.options.ports, fullBaseUpdate, baseStateVector, frame.context.signerAuthority.replicaId)
    const authored = validateCanonicalDeltaV2(this.options.ports, fullBaseUpdate, baseStateVector, frame.sections.yjsUpdate, frame.context.signerAuthority.replicaId)
    try {
      const intent = requireDecodedIntent(this.options.owner.protocolPort.decodeIntent(frame.sections.typedIntentJcs))
      const ownerContext = {
        scope: this.options.scope,
        actorId: core.actorId,
        actorSequence: core.actorSequence,
        operationId: core.operationId,
        lamport: core.lamport,
        intentDigest: core.intentDigest,
        baseFrontierDigest: core.baseFrontierDigest,
        protocolDigest: core.protocolDigest,
        ownerSchemaDigest: core.ownerSchemaDigest,
        validationArtifactSetDigest: core.validationArtifactSetDigest,
      } as const
      const declaredDependencies = requireOwnerDependencies(
        this.options.owner.closurePort.discoverDependencies({ context: ownerContext, intent }),
        "Recovery owner dependency discovery failed",
      )
      assertNotAborted(signal)
      const facts = await this.options.ports.incomingFacts.resolve({ frame, declaredDependencies, signal })
      assertNotAborted(signal)
      if (facts.status !== "resolved") {
        if (facts.status === "rejected") invalid("Recovery owner fact resolution is rejected")
        pending("Recovery owner facts are pending")
      }
      assertOwnerExternalFactPortV2(facts.port, this.options.owner)
      claimOwnerFactPort(facts.port)
      const result = applyOwnerIntent(this.options.owner.protocolPort, rerun, ownerContext, intent, facts.port)
      assertConsumedDependencies(facts.port, declaredDependencies)
      requireOwnerState(this.options.owner.protocolPort.validatePost(baseState, rerun, result), "Recovery rerun violates owner invariants")
      if (!sameBytes(encodeCandidateDeltaV2(rerun, baseStateVector), frame.sections.yjsUpdate)) invalid("Recovery rerun delta differs from original final bytes")
      if (!sameBytes(encodeRestrictedJcsV2(this.codec.parseActualWriteEvidence(this.options.owner.protocolPort.deriveActualWriteEvidence(result))), frame.sections.actualWriteEvidenceJcs)) invalid("Recovery evidence differs from original final bytes")
      const postCanonical = ownerCanonicalDigest(this.options.owner.protocolPort, authored.document)
      if (stateVectorDigestV2(authored.postStateVector) !== core.postStateVectorDigest || postCanonical !== core.postCanonicalStateDigest) invalid("Recovery post-state differs from signed core")
      const newHead = causalHeadRefFromDecodedFrameV3(frame)
      const durableHeadDigest = await this.persistLocal(frame, newHead, signal)
      try {
        applyUpdateV1V2(this.replicaDoc, frame.sections.yjsUpdate, ACCEPTED_FRAME_ORIGIN_V2)
        this.installHead(frame, [newHead], postCanonical, durableHeadDigest)
      } catch (error) {
        await this.rebuildAfterDurableApplyFailure(error)
      }
      if (!signal?.aborted) this.options.projection?.publish({ scope: this.options.scope, frameDigest: frame.frameDigest })
      return Object.freeze({ status: "recovered-final-frame", frame, acceptedFrontierDigest: this.head.frontierDigest })
    } finally {
      rerun.destroy()
      authored.document.destroy()
    }
  }

  private async refreshAcceptedHead(): Promise<void> {
    assertDocumentOwnerBindingV2(this.options.owner.protocolPort)
    const head = normalizeAcceptedHead(await this.options.ports.persistence.loadReplicaHead(this.options.scope), this.options.scope)
    if (head.headDigest === this.head.headDigest) return
    const replica = cloneExactBaseDocumentV2(this.options.ports, head.fullUpdate, head.stateVector)
    try {
      assertOwnerCanonical(this.options.owner.protocolPort, replica, head.canonicalStateDigest)
      requireOwnerState(this.options.owner.protocolPort.validateBase(replica), "Reloaded accepted head violates owner schema")
      const previous = this.replicaDoc
      this.replicaDoc = replica
      this.head = head
      this.options.undo?.clear("rebuild")
      previous.destroy()
    } catch (error) {
      replica.destroy()
      throw error
    }
  }

  private async persistLocal(frame: DecodedCausalEditFrameV3, head: CausalHeadRefV2, signal?: AbortSignal): Promise<DigestV2> {
    const ref = frameObjectRefFromDecodedFrameV3(frame)
    assertNotAborted(signal)
    await this.options.ports.persistence.putImmutableFrame(ref, frame.bytes)
    assertNotAborted(signal)
    await this.options.ports.persistence.putReplicationOutboxRef(ref)
    assertNotAborted(signal)
    const journal = await this.options.ports.persistence.appendFrameJournal(ref)
    assertFrameRefMirror(journal.ref, ref, "Journal append")
    parseDigestV2(journal.journalRecordDigest)
    assertNotAborted(signal)
    const frontierDigest = structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.causalFrontier, { format: "convax.causal-frontier/2", heads: [head] })
    return this.commitReplicaHead(ref, journal, frontierDigest)
  }

  private async persistIncoming(frame: DecodedCausalEditFrameV3, _head: CausalHeadRefV2, frontier: CausalFrontierV2): Promise<DigestV2> {
    const ref = frameObjectRefFromDecodedFrameV3(frame)
    await this.options.ports.persistence.putImmutableFrame(ref, frame.bytes)
    await this.options.ports.persistence.putReplicationOutboxRef(ref)
    const journal = await this.options.ports.persistence.appendFrameJournal(ref)
    assertFrameRefMirror(journal.ref, ref, "Journal append")
    parseDigestV2(journal.journalRecordDigest)
    return this.commitReplicaHead(ref, journal, structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.causalFrontier, frontier))
  }

  private async commitReplicaHead(
    ref: FrameObjectRefV2,
    journal: import("./ports").JournalAppendPortEvidenceV2,
    resultingFrontierDigest: DigestV2,
  ): Promise<DigestV2> {
    const expectedReplicaHeadRecordDigest = this.head.headDigest
    const result = await this.options.ports.persistence.compareAndCommitReplicaHead({
      ref,
      journal,
      expectedReplicaHeadRecordDigest,
      resultingFrontierDigest,
    })
    if (result.status === "rejected") {
      throw new CollaborationKernelErrorV2("read-only-recovery-required", `Replica-head durability rejected: ${result.code}`)
    }
    if (result.status === "quarantined") {
      const evidence = result.evidence
      assertFrameRefMirror(evidence.ref, ref, "Quarantine")
      if (
        evidence.journalRecordDigest !== journal.journalRecordDigest
        || evidence.expectedReplicaHeadRecordDigest !== expectedReplicaHeadRecordDigest
      ) invalid("Quarantine evidence mirrors do not match the commit request")
      parseDigestV2(evidence.observedReplicaHeadRecordDigest)
      parseDigestV2(evidence.quarantineCommitRecordDigest)
      parseDigestV2(evidence.shardDispositionHeadRecordDigest)
      const reloaded = normalizeAcceptedHead(await this.options.ports.persistence.loadReplicaHead(this.options.scope), this.options.scope)
      if (reloaded.headDigest !== evidence.shardDispositionHeadRecordDigest) invalid("Quarantine disposition head was not durably published")
      throw new CollaborationKernelErrorV2("equivocation-quarantine", "Replica-head compare-and-commit quarantined the frame")
    }
    const evidence = result.evidence
    assertFrameRefMirror(evidence.ref, ref, "Head commit")
    if (
      evidence.journalRecordDigest !== journal.journalRecordDigest
      || evidence.expectedReplicaHeadRecordDigest !== expectedReplicaHeadRecordDigest
      || evidence.resultingFrontierDigest !== resultingFrontierDigest
    ) invalid("Head commit evidence mirrors do not match the commit request")
    parseDigestV2(evidence.resultingReplicaHeadRecordDigest)
    const reloaded = normalizeAcceptedHead(await this.options.ports.persistence.loadReplicaHead(this.options.scope), this.options.scope)
    if (
      reloaded.headDigest !== evidence.resultingReplicaHeadRecordDigest
      || reloaded.frontierDigest !== resultingFrontierDigest
    ) invalid("Reloaded replica head does not match committed durability evidence")
    return evidence.resultingReplicaHeadRecordDigest
  }

  private async rebuildAfterDurableApplyFailure(cause: unknown): Promise<never> {
    try {
      await this.refreshAcceptedHead()
    } catch {
      // The durable closure remains authoritative even when immediate rebuild fails.
    }
    throw new CollaborationKernelErrorV2(
      "read-only-recovery-required",
      "Durable replica head committed but authoritative in-memory application failed",
      { cause },
    )
  }

  private installHead(
    frame: DecodedCausalEditFrameV3,
    frontierHeads: readonly CausalHeadRefV2[],
    canonicalStateDigest: DigestV2,
    durableHeadDigest: DigestV2,
  ): void {
    const frontier = parseCausalFrontierV2({ format: "convax.causal-frontier/2", heads: frontierHeads })
    const actorHeads = replaceReplicaActorHeadV2(this.head.actorHeads, causalHeadRefFromDecodedFrameV3(frame))
    this.head = Object.freeze({
      scope: this.options.scope,
      headDigest: durableHeadDigest,
      frontier,
      frontierDigest: structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.causalFrontier, frontier),
      actorHeads,
      fullUpdate: encodeFullUpdateV2(this.replicaDoc),
      stateVector: encodeStateVectorV2(this.replicaDoc),
      canonicalStateDigest,
    })
  }

  private async retainPending(frame: DecodedCausalEditFrameV3, reason: PendingFrameReasonV2): Promise<IncomingFrameResultV3> {
    const retained = await this.options.ports.pendingInbox.retainExactFrame(frame, reason)
    if (retained === "capacity-exceeded") throw new CollaborationKernelErrorV2("read-only-recovery-required", "Pending inbox capacity is exhausted; exact bytes cannot be discarded")
    return Object.freeze({ status: "dependency-pending", frame, reason })
  }

  private finishUndo(_result: OwnerApplyResultV2, operationId: Id128V2, transition?: LocalIntentRequestV3["historyTransition"]): void {
    if (!this.options.undo) return
    try {
      if (transition?.direction === "undo") this.options.undo.commitUndo(transition.cursorToken, operationId)
      else if (transition?.direction === "redo") this.options.undo.commitRedo(transition.cursorToken, operationId)
      else this.options.undo.recordDurableRoot(operationId)
    } catch (error) {
      this.options.undo.clear("post-commit-cursor-failure")
      throw new CollaborationKernelErrorV2("history-reset-after-commit", "Domain commit succeeded but the transient undo cursor failed", { cause: error })
    }
  }

  private async quarantineEquivocation(digests: readonly DigestV2[]): Promise<never> {
    for (const digest of new Set(digests)) await this.options.ports.persistence.quarantineExactObject(digest, "equivocation")
    throw new CollaborationKernelErrorV2("equivocation-quarantine", "Actor operation identity has conflicting signed frames")
  }

  private requireLive(): void {
    if (this.disposed) throw new CollaborationKernelErrorV2("disposed", "Collaboration kernel is disposed")
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

}

function applyOwnerIntent(
  owner: DocumentOwnerProtocolPortV2,
  candidate: Y.Doc,
  context: Parameters<DocumentOwnerProtocolPortV2["applyIntent"]>[1],
  intent: unknown,
  facts: Parameters<DocumentOwnerProtocolPortV2["applyIntent"]>[3],
): OwnerApplyResultV2 {
  const outcome: { value: OwnerApplyResultV2 | "pending" | "rejected" } = { value: "rejected" }
  candidate.transact(() => {
    outcome.value = owner.applyIntent(candidate, context, intent, facts)
  }, LOCAL_CANDIDATE_ORIGIN_V2)
  const result = outcome.value
  if (result === "pending") pending("Owner dependency is pending")
  if (result === "rejected") invalid("Owner rejected the typed intent")
  return result
}

function requireDecodedIntent(value: unknown | "rejected"): unknown {
  if (value === "rejected") invalid("Owner rejected the typed intent encoding")
  return value
}

function requireOwnerState<T>(value: T | "pending" | "rejected", message: string): T {
  if (value === "pending") pending(message)
  if (value === "rejected") invalid(message)
  return value
}

function ownerCanonicalDigest(owner: DocumentOwnerProtocolPortV2, document: Y.Doc): DigestV2 {
  const descriptor = assertDocumentOwnerBindingV2(owner)
  const first = owner.canonicalStateBytes(document)
  const second = owner.canonicalStateBytes(document)
  if (first === "rejected" || second === "rejected") invalid("Owner rejected canonical-state encoding")
  if (first === second) invalid("Owner canonical-state port reused a mutable byte instance")
  const exactFirst = validateOwnerCanonicalStateBytesV2(descriptor, first)
  const exactSecond = validateOwnerCanonicalStateBytesV2(descriptor, second)
  if (!sameJcsBytes(exactFirst, exactSecond)) invalid("Owner canonical-state bytes are not stable")
  return canonicalStateDigestV2(owner.schemaDigest, exactFirst)
}

function assertOwnerCanonical(owner: DocumentOwnerProtocolPortV2, document: Y.Doc, expected: DigestV2): DigestV2 {
  const actual = ownerCanonicalDigest(owner, document)
  if (actual !== expected) invalid("Owner canonical-state digest mismatches accepted durable evidence")
  return actual
}

function validationArtifactSetDigestV2(value: ValidationArtifactSetV2): DigestV2 {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.validationArtifactSet, value)
}

function assertRequiredProtocolArtifacts(
  value: ValidationArtifactSetV2,
  authority: CollaborationKernelOptionsV3["authority"],
  historicalAuthority: VerifiedProtocolAuthorityV2,
): void {
  const required = selectedSuccessorValidationArtifactSetV3(authority, historicalAuthority)
  if (!sameJcsBytes(encodeRestrictedJcsV2(value), encodeRestrictedJcsV2(required))) {
    invalid("Validation artifact set differs from the exact V11 plus historical R5 closure")
  }
}

function requireTypedIntentKind(value: unknown): string {
  if (!isPlainDataObject(value) || typeof value.kind !== "string" || value.kind.length < 1 || value.kind.length > 128 || !/^[\x20-\x7e]+$/u.test(value.kind)) {
    invalid("Typed intent has no valid exact kind")
  }
  return value.kind
}

function requirePreparedLocalIntent(value: unknown): PreparedLocalIntentV3 {
  if (!isPlainDataObject(value)) invalid("Local intent prepare callback returned a non-object")
  assertExactKeysV2(value, ["externalFacts", "typedIntent"], "PreparedLocalIntentV3")
  return value as unknown as PreparedLocalIntentV3
}

function requireOwnerDependencies(
  value: OwnerIntentDependenciesV2<DocumentScopeV2["docKind"]> | "pending" | "rejected",
  message: string,
): OwnerIntentDependenciesV2<DocumentScopeV2["docKind"]> {
  if (value === "pending") pending(message)
  if (value === "rejected") invalid(message)
  return value
}

function assertConsumedDependencies(
  facts: OwnerExternalFactPortV2,
  declared: OwnerIntentDependenciesV2<DocumentScopeV2["docKind"]>,
): void {
  if (!sameJcsBytes(encodeRestrictedJcsV2(dependencyIdentity(facts.consumedDependencies())), encodeRestrictedJcsV2(dependencyIdentity(declared)))) {
    invalid("Owner fact port did not consume the exact declared dependency closure")
  }
}

function dependencyIdentity(value: OwnerIntentDependenciesV2<DocumentScopeV2["docKind"]>): unknown {
  return {
    validationArtifacts: value.validationArtifacts,
    externalFacts: value.externalFacts.map((fact) => ({
      owner: fact.owner,
      kind: fact.kind,
      factDigest: fact.factDigest,
      requestSha256: fact.request.sha256,
    })),
  }
}

function claimOwnerFactPort(facts: OwnerExternalFactPortV2): void {
  if (claimedOwnerFactPortsV2.has(facts)) invalid("Owner fact port was reused across collaboration attempts")
  claimedOwnerFactPortsV2.add(facts)
}

function assertEvidenceClosure(evidence: ActualWriteEvidenceV2, scope: DocumentScopeV2, schemaDigest: DigestV2, intentDigest: DigestV2): void {
  assertSameScopeV2(evidence.scope, scope, "Owner evidence scope")
  if (evidence.owner !== scope.docKind || evidence.ownerSchemaDigest !== schemaDigest || evidence.intentDigest !== intentDigest) invalid("Owner evidence duplicate fields mismatch")
}

function actorHeadFor(set: ReplicaActorHeadSetV2, actorId: string): CausalHeadRefV2 | null {
  return set.heads.find((head) => head.actorId === actorId) ?? null
}

function validateActorSuccessorV3(
  previous: CausalHeadRefV2 | null,
  actorId: CausalHeadRefV2["actorId"],
  actorSequence: CausalHeadRefV2["actorSequence"],
  predecessorFrameDigest: DigestV2,
  dependencies: readonly CausalDependencyRefV3[],
): void {
  const sequence = BigInt(actorSequence)
  if (previous === null) {
    if (sequence !== 1n) invalid("First V3 actor frame must use sequence one")
    const bridges = dependencies.filter((dependency) => dependency.kind === "protocol-promotion-bridge")
    if (bridges.length !== 1 || bridges[0]!.digest !== predecessorFrameDigest) {
      invalid("First V3 actor frame must name its exact signed promotion bridge")
    }
    return
  }
  if (
    previous.actorId !== actorId ||
    sequence !== BigInt(previous.actorSequence) + 1n ||
    predecessorFrameDigest !== previous.frameDigest ||
    dependencies.some((dependency) => dependency.kind === "protocol-promotion-bridge")
  ) invalid("V3 actor successor is not exact +1 with its immediate predecessor")
}

function normalizeAcceptedHead(value: unknown, scope: DocumentScopeV2): AcceptedHeadViewV2 {
  if (!isPlainDataObject(value)) invalid("Replica head port returned a non-object value")
  assertExactKeysV2(value, [
    "scope",
    "headDigest",
    "frontier",
    "frontierDigest",
    "actorHeads",
    "fullUpdate",
    "stateVector",
    "canonicalStateDigest",
  ], "AcceptedHeadViewV2")
  const head = value as unknown as AcceptedHeadViewV2
  const parsedScope = parseDocumentScopeV2(head.scope)
  assertSameScopeV2(parsedScope, scope, "Accepted head scope")
  const frontier = parseCausalFrontierV2(head.frontier)
  const actorHeads = parseReplicaActorHeadSetV2(head.actorHeads)
  assertSameScopeV2(actorHeads.scope, scope, "Accepted actor-head scope")
  const frontierDigest = parseDigestV2(head.frontierDigest)
  if (structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.causalFrontier, frontier) !== frontierDigest) invalid("Accepted head frontier digest mismatches")
  return Object.freeze({
    scope: parsedScope,
    headDigest: parseDigestV2(head.headDigest),
    frontier,
    frontierDigest,
    actorHeads,
    fullUpdate: cloneBytesV2(head.fullUpdate, "accepted-head full update"),
    stateVector: parseStateVectorV2(head.stateVector),
    canonicalStateDigest: parseDigestV2(head.canonicalStateDigest),
  })
}

function assertFrameRefMirror(actual: FrameObjectRefV2, expected: FrameObjectRefV2, label: string): void {
  if (!sameJcsBytes(encodeRestrictedJcsV2(actual), encodeRestrictedJcsV2(expected))) {
    invalid(`${label} frame reference mirror mismatches`)
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CollaborationKernelErrorV2("cancelled", "Local collaboration commit was cancelled before durable head acceptance")
}

function stale(): never {
  throw new CollaborationKernelErrorV2("stale-local-head", "The durable accepted head changed while constructing the candidate")
}

function pending(message: string): never {
  throw new CollaborationKernelErrorV2("dependency-pending", message)
}

function invalid(message: string): never {
  throw new CollaborationKernelErrorV2("invalid-owner-result", message)
}
