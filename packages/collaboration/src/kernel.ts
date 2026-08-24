import * as Y from "yjs"
import { assertCurrentProtocolAuthority, type CurrentProtocolAuthority } from "./authority"
import {
  causalHeadRefFromDecodedFrame,
  createAcceptedHeadMaterializationEvidence,
  createLocalAcceptedHeadMaterializationEvidence,
  frameObjectRefFromDecodedFrame,
  incomingFrameClosure,
  validateAcceptedHeadMaterializationEvidence,
} from "./accepted-head"
import { cloneBytes, sameBytes } from "./binary"
import { documentScopeDigest, maxCausalFrontier, nextLamport, validateActorSequenceStep } from "./causal"
import { assertDocumentOwnerBinding } from "./canonicalizer"
import type { Digest, Id128, ReplicaId, StateVector } from "./codecs"
import { parseDigest, parseId128, parseUint64, replicaIdToYjsClientId } from "./codecs"
import { KERNEL_DIGEST_DOMAINS, CURRENT_PROTOCOL_IDENTITIES, PROTOCOL_SCHEMA_ARTIFACTS } from "./constants"
import {
  actualWriteEvidenceDigest,
  causalContextDigest,
  causalEditSignatureDigest,
  decodeCausalEditFrame,
  encodeCausalEditFrame,
  signCausalEditCore,
  typedIntentDigest,
} from "./frame"
import type {
  ActualWriteEvidence,
  CausalContext,
  CausalEditCore,
  CausalEditFrameHeader,
  CausalFrontier,
  CausalHeadRef,
  DecodedCausalEditFrame,
  DocumentOwnerRuntime,
  DocumentOwnerProtocolPort,
  DocumentScope,
  FrameObjectRef,
  OwnerExternalFactPort,
  OwnerIntentConstructionContext,
  OwnerIntentDependencies,
  OwnerValidatedState,
  OwnerApplyResult,
  ReplicaActorHeadSet,
  ValidationArtifactSet,
} from "./contracts"
import { ordinarySha256, structuredDigest } from "./digest"
import { CollaborationKernelError } from "./errors"
import {
  collaborationLatencyStages,
  type CollaborationLatencyDiagnostic,
  type CollaborationLatencyDiagnosticsPort,
  type CollaborationLatencySample,
  type CollaborationLatencyStage,
} from "./latency-diagnostics"
import { verifyExactEd25519, type Ed25519VerifierPort } from "./crypto"
import {
  assertExactKeys,
  decodeRestrictedJcs,
  encodeRestrictedJcs,
  isPlainDataObject,
  sameBytes as sameJcsBytes,
} from "./jcs"
import {
  assertSameScope,
  parseActualWriteEvidence,
  parseCausalContext,
  causalSignerAuthorityDigest,
  parseCausalFrontier,
  parseDocumentScope,
  parseReplicaActorHeadSet,
  parseValidationArtifactSet,
} from "./parse"
import type {
  AcceptedHeadIdentityView,
  AcceptedHeadMaterializationEvidence,
  AcceptedHeadTransitionView,
  AcceptedHeadView,
  CollaborationKernelPorts,
  PendingFrameReason,
} from "./ports"
import { ACCEPTED_FRAME_OUTBOX_REQUIREMENT } from "./ports"
import type { SessionUndoCoordinator } from "./undo"
import {
  armOwnerCandidateTransactionCapture,
  assertDocumentOwnerRuntime,
  assertOwnerExternalFactPort,
  consumeOwnerStateCommitmentDigest,
  installOwnerValidatedPostCache,
  issueAcceptedReplicaApplyEvidence,
  ownerUsesValidatedPostCache,
} from "./owner-runtime"
import {
  ACCEPTED_FRAME_ORIGIN,
  LOCAL_CANDIDATE_ORIGIN,
  applyYjsUpdate,
  assertUpdateAuthoredByReplica,
  cloneExactBaseDocument,
  encodeFullUpdate,
  encodeStateVector,
  parseStateVector,
  stateVectorDigest,
  validateCanonicalDelta,
  yjsUpdateDigest,
} from "./yjs-codec"

const claimedOwnerFactPorts = new WeakSet<object>()

/**
 * The one protocol-dependent byte closure the kernel may use. Keeping it closed
 * and module-private prevents a caller from supplying an unverified codec while
 * making every byte-producing dependency explicit.
 */
interface CurrentCausalProtocolCodec {
  readonly authority: CurrentProtocolAuthority
  readonly protocolDigest: Digest
  parseCausalContext(value: unknown): CausalContext
  parseActualWriteEvidence(value: unknown): ActualWriteEvidence
  causalContextDigest(value: CausalContext): Digest
  actualWriteEvidenceDigest(value: ActualWriteEvidence): Digest
  typedIntentDigest(bytes: Uint8Array): Digest
  causalEditSignatureDigest(coreDigest: Digest | string): Uint8Array
  signCore(core: CausalEditCore, signer: Parameters<typeof signCausalEditCore>[2]): Promise<CausalEditFrameHeader>
  encodeFrame(input: Parameters<typeof encodeCausalEditFrame>[1]): Uint8Array
  decodeFrame(bytes: Uint8Array): DecodedCausalEditFrame
}

function currentCausalProtocolCodec(authority: CurrentProtocolAuthority): CurrentCausalProtocolCodec {
  return Object.freeze({
    authority,
    protocolDigest: parseDigest(CURRENT_PROTOCOL_IDENTITIES.protocolDigest),
    actualWriteEvidenceDigest: actualWriteEvidenceDigest,
    causalContextDigest: causalContextDigest,
    causalEditSignatureDigest: causalEditSignatureDigest,
    decodeFrame: (bytes: Uint8Array) => decodeCausalEditFrame(authority, bytes),
    encodeFrame: (input: Parameters<typeof encodeCausalEditFrame>[1]) => encodeCausalEditFrame(authority, input),
    parseActualWriteEvidence: parseActualWriteEvidence,
    parseCausalContext: parseCausalContext,
    signCore: (core: CausalEditCore, signer: Parameters<typeof signCausalEditCore>[2]) =>
      signCausalEditCore(authority, core, signer),
    typedIntentDigest: typedIntentDigest,
  })
}

export interface CollaborationKernelOptions {
  readonly authority: CurrentProtocolAuthority
  readonly scope: DocumentScope
  readonly owner: DocumentOwnerRuntime
  readonly ports: CollaborationKernelPorts
  readonly signatureVerifier: Ed25519VerifierPort
  readonly projection?: { publish(input: { readonly scope: DocumentScope; readonly frameDigest: Digest }): void }
  readonly undo?: SessionUndoCoordinator
  readonly diagnostics?: CollaborationLatencyDiagnosticsPort
}

export interface LocalIntentRequest {
  readonly operationId: Id128
  readonly prepare: (input: {
    readonly base: OwnerValidatedState
    readonly context: OwnerIntentConstructionContext
    readonly signal?: AbortSignal
  }) => Promise<PreparedLocalIntent> | PreparedLocalIntent
  readonly signal?: AbortSignal
  readonly historyTransition?: Readonly<{ direction: "undo" | "redo"; cursorToken: Id128 }>
}

export interface PreparedLocalIntent {
  readonly typedIntent: unknown
  readonly externalFacts: OwnerExternalFactPort
}

export type LocalCommitResult =
  | {
      readonly status: "saved-locally"
      readonly frame: DecodedCausalEditFrame
      readonly acceptedFrontierDigest: Digest
    }
  | { readonly status: "duplicate"; readonly frame: DecodedCausalEditFrame; readonly acceptedFrontierDigest: Digest }
  | {
      readonly status: "recovered-final-frame"
      readonly frame: DecodedCausalEditFrame
      readonly acceptedFrontierDigest: Digest
    }

export type IncomingFrameResult =
  | { readonly status: "accepted"; readonly frame: DecodedCausalEditFrame }
  | { readonly status: "duplicate"; readonly frame: DecodedCausalEditFrame }
  | {
      readonly status: "dependency-pending"
      readonly frame: DecodedCausalEditFrame
      readonly reason: PendingFrameReason
    }

export interface ReplicaProjectionSnapshot {
  readonly scope: DocumentScope
  readonly acceptedHeadDigest: Digest
  readonly frontier: CausalFrontier
  readonly stateVector: StateVector
  readonly fullUpdate: Readonly<Uint8Array>
  readonly canonicalStateDigest: Digest
}

export class CollaborationKernel {
  private readonly codec: CurrentCausalProtocolCodec
  private disposed = false
  private head: AcceptedHeadView
  private replicaDoc: Y.Doc
  private headFullUpdateBytes: Uint8Array
  private headMaterialized = true
  private headStateVectorDigest: Digest
  private documentGeneration = 0
  private standbyCandidate: StandbyExactBaseCandidate | null = null
  private queue: Promise<void> = Promise.resolve()

  private constructor(
    private readonly options: CollaborationKernelOptions,
    head: AcceptedHeadView,
    replicaDoc: Y.Doc,
  ) {
    this.codec = currentCausalProtocolCodec(options.authority)
    this.head = head
    this.replicaDoc = replicaDoc
    this.headFullUpdateBytes = new Uint8Array(head.fullUpdate)
    this.headStateVectorDigest = stateVectorDigest(head.stateVector)
  }

  static async open(options: CollaborationKernelOptions): Promise<CollaborationKernel> {
    assertCurrentProtocolAuthority(options.authority)
    assertDocumentOwnerRuntime(options.owner, options.authority)
    const owner = options.owner.protocolPort
    const scope = parseDocumentScope(options.scope)
    if (owner.owner !== scope.docKind) invalid("Document owner kind differs from the shard scope")
    assertDocumentOwnerBinding(owner)
    const head = normalizeAcceptedHead(await options.ports.persistence.loadReplicaHead(scope), scope)
    const replicaDoc = cloneExactBaseDocument(options.ports, head.fullUpdate, head.stateVector)
    let standbyDoc: Y.Doc | undefined
    try {
      const state = requireOwnerState(owner.validateBase(replicaDoc), "Accepted head does not satisfy the owner schema")
      assertOwnerCanonical(options.owner, replicaDoc, state, head.canonicalStateDigest)
      const kernel = new CollaborationKernel({ ...options, scope }, head, replicaDoc)
      // Building the private candidate belongs to cold open. Once open resolves,
      // the first fixed-size local mutation must not clone retained document
      // history merely because no earlier local commit produced a standby.
      standbyDoc = cloneExactBaseDocument(options.ports, head.fullUpdate, head.stateVector)
      kernel.installCommittedCandidateStandby(standbyDoc)
      standbyDoc = undefined
      return kernel
    } catch (error) {
      standbyDoc?.destroy()
      replicaDoc.destroy()
      throw error
    }
  }

  commitLocalIntent(request: LocalIntentRequest): Promise<LocalCommitResult> {
    const trace = new LocalCommitLatencyTrace(this.options.owner.protocolPort.owner, this.options.diagnostics)
    return this.exclusive(async () => {
      trace.finishQueue()
      try {
        const result = await this.commitLocalIntentExclusive(request, trace)
        trace.publish("succeeded")
        return result
      } catch (error) {
        trace.publish("failed")
        throw error
      }
    })
  }

  receiveFrame(exactBytes: Uint8Array, signal?: AbortSignal): Promise<IncomingFrameResult> {
    const retained = cloneBytes(exactBytes, "incoming causal frame")
    return this.exclusive(async () => {
      try {
        return await this.receiveFrameExclusive(retained, signal)
      } catch (error) {
        if (error instanceof CollaborationKernelError && error.code === "dependency-pending") {
          return this.retainPending(this.codec.decodeFrame(retained), "missing-artifact")
        }
        throw error
      }
    })
  }

  getProjectionSnapshot(): ReplicaProjectionSnapshot {
    this.requireLive()
    return Object.freeze({
      scope: this.options.scope,
      acceptedHeadDigest: this.head.headDigest,
      frontier: this.head.frontier,
      stateVector: encodeStateVector(this.replicaDoc),
      fullUpdate: encodeFullUpdate(this.replicaDoc),
      canonicalStateDigest: this.head.canonicalStateDigest,
    })
  }

  queryOwnerState<T>(project: (state: OwnerValidatedState) => T): Promise<T> {
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
    this.invalidateStandbyCandidate()
    this.options.undo?.clear("unmount")
    this.replicaDoc.destroy()
  }

  private async commitLocalIntentExclusive(
    request: LocalIntentRequest,
    trace: LocalCommitLatencyTrace,
  ): Promise<LocalCommitResult> {
    this.requireLive()
    assertDocumentOwnerBinding(this.options.owner.protocolPort)
    if (typeof request.prepare !== "function") invalid("Local intent prepare callback is required")
    const operationId = parseId128(request.operationId)
    const localActorId = this.options.ports.localAuthority.actorId
    const lookup = await trace.measure("operation-lookup", () =>
      this.options.ports.persistence.lookupOperation(localActorId, operationId),
    )
    if (lookup.status === "accepted") {
      if (!(await this.options.ports.persistence.isReachableFromAcceptedHead(lookup.ref)))
        throw new CollaborationKernelError(
          "read-only-recovery-required",
          "Accepted operation is not reachable from the sole durable head",
        )
      await this.refreshAcceptedHead()
      return Object.freeze({
        status: "duplicate",
        frame: this.codec.decodeFrame(lookup.bytes),
        acceptedFrontierDigest: this.head.frontierDigest,
      })
    }
    if (lookup.status === "same-frame-recovery" || lookup.status === "object-only-recovery") {
      return this.recoverFinalLocalFrame(lookup.bytes, localActorId, operationId, request.signal)
    }
    if (lookup.status === "equivocation") await this.quarantineEquivocation(lookup.frameDigests)
    assertNotAborted(request.signal)
    const durableHead = await trace.measure("head-check", async () => {
      const verification = await this.options.ports.persistence.verifyReplicaHeadCurrent?.({
        scope: this.options.scope,
        expectedHeadDigest: this.head.headDigest,
        expectedFrontierDigest: this.head.frontierDigest,
      })
      if (verification === "verified") return this.head
      return normalizeAcceptedHead(
        await this.options.ports.persistence.loadReplicaHead(this.options.scope),
        this.options.scope,
      )
    })
    if (durableHead.headDigest !== this.head.headDigest) stale()
    const previousActorHead = actorHeadFor(this.head.actorHeads, localActorId)
    const authority = await trace.measure("authority-prepare", () =>
      this.options.ports.localAuthority.prepareFinalFrameAuthority({
        scope: this.options.scope,
        operationId,
        baseFrontier: this.head.frontier,
        previousActorHead,
        ownerSchemaDigest: this.options.owner.protocolPort.schemaDigest,
      }),
    )
    if (authority === "pending") pending("Local edit authority is pending")
    if (authority === "rejected") invalid("Local edit authority rejected the mutation")
    if (authority.actorId !== localActorId || authority.actorId !== authority.signerAuthority.actorId)
      invalid("Local authority actor binding mismatches")
    const artifacts = parseValidationArtifactSet(authority.validationArtifacts)
    assertRequiredProtocolArtifacts(artifacts)
    const validationArtifactSetDigest = computeValidationArtifactSetDigest(artifacts)
    const baseStateVector = trace.measureSync("base-state-encode", () => {
      const current = encodeStateVector(this.replicaDoc)
      if (
        !sameBytes(current, this.head.stateVector) ||
        stateVectorDigest(current) !== this.headStateVectorDigest ||
        stateVectorDigest(this.head.stateVector) !== this.headStateVectorDigest
      )
        invalid("Current replica state vector mismatches the exact accepted head")
      return cloneBytes(this.head.stateVector, "accepted-head base state vector") as StateVector
    })
    const { baseCanonicalStateDigest, baseCanonicalProof, baseState } = trace.measureSync("base-validation", () => {
      const state = requireOwnerState(
        this.options.owner.protocolPort.validateBase(this.replicaDoc),
        "Current replicaDoc violates the owner schema",
      )
      const digest = assertOwnerCanonical(
        this.options.owner,
        this.replicaDoc,
        state,
        this.head.canonicalStateDigest,
      )
      return {
        baseCanonicalStateDigest: digest,
        baseCanonicalProof: Object.freeze({
          canonicalStateDigest: digest,
          durableHeadDigest: durableHead.headDigest,
        }),
        baseState: state,
      }
    })
    const lamport = nextLamport(this.head.frontier)
    validateActorSequenceStep(
      previousActorHead,
      authority.actorId,
      authority.actorSequence,
      authority.predecessorFrameDigest,
    )
    const constructionContext: OwnerIntentConstructionContext = Object.freeze({
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
    const prepared = await trace.measure("owner-prepare", async () =>
      requirePreparedLocalIntent(
        await request.prepare({
          base: baseState,
          context: constructionContext,
          signal: request.signal,
        }),
      ),
    )
    assertNotAborted(request.signal)
    assertOwnerExternalFactPort(prepared.externalFacts, this.options.owner)
    claimOwnerFactPort(prepared.externalFacts)
    const typedIntentJcs = encodeRestrictedJcs(prepared.typedIntent)
    const exactTypedIntent = decodeRestrictedJcs(typedIntentJcs)
    const intentKind = requireTypedIntentKind(exactTypedIntent)
    const intent = requireDecodedIntent(
      this.options.owner.protocolPort.decodeIntent(cloneBytes(typedIntentJcs, "typed-intent JCS")),
    )
    const intentDigest = this.codec.typedIntentDigest(typedIntentJcs)
    const context: CausalContext = this.codec.parseCausalContext({
      format: "convax.causal-context",
      scope: this.options.scope,
      baseFrontier: this.head.frontier,
      baseFrontierDigest: this.head.frontierDigest,
      baseStateVectorDigest: stateVectorDigest(baseStateVector),
      baseCanonicalStateDigest,
      signerAuthority: authority.signerAuthority,
      dependencies: authority.dependencies,
      validationArtifactSetDigest,
    })
    const causalContextJcs = encodeRestrictedJcs(context)
    let fullBaseUpdate: Uint8Array | undefined
    const requireFullBaseUpdate = () => {
      if (fullBaseUpdate !== undefined) return fullBaseUpdate
      fullBaseUpdate = trace.measureSync("base-state-encode", () => {
      if (!this.headMaterialized) invalid("Accepted head requires cold materialization before a full-base clone")
      const cached = cloneBytes(this.headFullUpdateBytes, "accepted-head base full update")
        return cached
      })
      return fullBaseUpdate
    }
    let standby = this.consumeStandbyCandidate(authority.signerAuthority.replicaId, baseStateVector)
    if (standby === null && !this.headMaterialized) {
      await trace.measure("base-state-encode", () => this.reloadCurrentHeadMaterialization())
    }
    const candidateFullClones = standby === null ? 1 as const : 0 as const
    const { candidate, candidateProof } = trace.measureSync(
      "candidate-clone",
      () =>
        standby ??
        createLocalCandidateExactBaseProof({
          factory: this.options.ports,
          fullBaseUpdate: requireFullBaseUpdate(),
          baseStateVector,
          replicaId: authority.signerAuthority.replicaId,
        }),
    )
    let candidateTransferred = false
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
      let validatedPostState: OwnerValidatedState
      const applyResult = trace.measureSync("reducer", () => {
        const result = applyOwnerIntent(
          this.options.owner,
          baseState,
          candidate,
          ownerContext,
          intent,
          prepared.externalFacts,
          baseCanonicalProof,
        )
        assertConsumedDependencies(prepared.externalFacts, declaredDependencies)
        validatedPostState = requireOwnerState(
          this.options.owner.protocolPort.validatePost(baseState, candidate, result),
          "Candidate post-state violates owner invariants",
        )
        return result
      })
      const evidence = this.codec.parseActualWriteEvidence(
        this.options.owner.protocolPort.deriveActualWriteEvidence(applyResult),
      )
      assertEvidenceClosure(evidence, this.options.scope, this.options.owner.protocolPort.schemaDigest, intentDigest)
      const actualWriteEvidenceJcs = encodeRestrictedJcs(evidence)
      const capturedCandidate = finalizeLocalCandidateExactBaseProof(candidateProof)
      const yjsUpdate = trace.measureSync("delta-encode", () => capturedCandidate.exactUpdate)
      const canonical = Object.freeze({
        document: candidate,
        postStateVector: capturedCandidate.postStateVector,
        ownsDocument: false,
      })
      try {
        const postStateVector = canonical.postStateVector
        const postCanonicalStateDigest = await trace.measure("canonical-state-digest", async () =>
          ownerRuntimeCanonicalDigest(this.options.owner, candidate, validatedPostState!),
        )
        consumeLocalCandidateExactBaseProof(candidateProof)
        const core: CausalEditCore = Object.freeze({
          format: "convax.causal-edit-core",
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
          baseStateVectorDigest: stateVectorDigest(baseStateVector),
          baseCanonicalStateDigest,
          yjsUpdateDigest: yjsUpdateDigest(yjsUpdate),
          postStateVectorDigest: stateVectorDigest(postStateVector),
          postCanonicalStateDigest,
          actualWriteEvidenceDigest: structuredDigest(KERNEL_DIGEST_DOMAINS.actualWriteEvidence, evidence),
          typedIntentJcsByteLength: parseUint64(String(typedIntentJcs.byteLength)),
          causalContextJcsByteLength: parseUint64(String(causalContextJcs.byteLength)),
          baseStateVectorByteLength: parseUint64(String(baseStateVector.byteLength)),
          yjsUpdateByteLength: parseUint64(String(yjsUpdate.byteLength)),
          actualWriteEvidenceJcsByteLength: parseUint64(String(actualWriteEvidenceJcs.byteLength)),
          protocolDigest: this.codec.protocolDigest,
          ownerSchemaDigest: this.options.owner.protocolPort.schemaDigest,
          canonicalizerDigest: this.options.owner.protocolPort.canonicalizerDigest,
          validationArtifactSetDigest,
          signerAuthorityKind: authority.signerAuthority.kind,
          signerAuthorityDigest: causalSignerAuthorityDigest(authority.signerAuthority),
        })
        const header = await trace.measure("sign", () => this.codec.signCore(core, authority.signer))
        const bytes = trace.measureSync("frame-encode", () =>
          this.codec.encodeFrame({
            header,
            sections: { typedIntentJcs, causalContextJcs, baseStateVector, yjsUpdate, actualWriteEvidenceJcs },
          }),
        )
        const frame = trace.measureSync("frame-decode", () => this.codec.decodeFrame(bytes))
        const newHead = causalHeadRefFromDecodedFrame(frame)
        const resultingFrontier = parseCausalFrontier({ format: "convax.causal-frontier", heads: [newHead] })
        const materialization = trace.measureSync("base-state-encode", () =>
          createLocalAcceptedHeadMaterializationEvidence({
            previous: this.head,
            ref: frameObjectRefFromDecodedFrame(frame),
            nextHead: newHead,
            resultingFrontier,
            postStateVector,
            yjsUpdateDigest: yjsUpdateDigest(yjsUpdate),
            canonicalStateDigest: postCanonicalStateDigest,
            candidateFullClones,
          }),
        )
        const materializationStateVectorDigest = materialization.stateVectorDigest
        const persisted = await this.persistLocal(frame, materialization, request.signal, trace)
        let applyEvidence: object | undefined
        try {
          trace.measureSync("replica-apply", () => {
            if (ownerUsesValidatedPostCache(this.options.owner)) {
              const generation = observeExactAcceptedReplicaApply(this.replicaDoc, yjsUpdate, () =>
                applyYjsUpdate(this.replicaDoc, yjsUpdate, ACCEPTED_FRAME_ORIGIN),
              )
              applyEvidence = issueAcceptedReplicaApplyEvidence(this.options.owner, {
                scopeDigest: documentScopeDigest(this.options.scope),
                target: this.replicaDoc,
                state: validatedPostState!,
                canonicalStateDigest: postCanonicalStateDigest,
                materializationDigest: materialization.resultingMaterializationDigest,
                postStateVectorDigest: materializationStateVectorDigest,
                yjsUpdateDigest: yjsUpdateDigest(yjsUpdate),
                generation,
              })
            } else applyYjsUpdate(this.replicaDoc, yjsUpdate, ACCEPTED_FRAME_ORIGIN)
            this.installHeadView(persisted.safeMaterialization, persisted.durableHeadDigest, {
              stateVectorDigest: materializationStateVectorDigest,
            })
          })
        } catch (error) {
          await this.rebuildAfterDurableApplyFailure(error)
        }
        try {
          if (applyEvidence !== undefined)
            installOwnerValidatedPostCache(this.options.owner, {
              scope: this.options.scope,
              source: candidate,
              target: this.replicaDoc,
              state: validatedPostState!,
              canonicalStateDigest: postCanonicalStateDigest,
              durableHeadDigest: persisted.durableHeadDigest,
              applyEvidence,
              scopeDigest: documentScopeDigest(this.options.scope),
              materializationDigest: materialization.resultingMaterializationDigest,
              postStateVectorDigest: materializationStateVectorDigest,
              yjsUpdateDigest: yjsUpdateDigest(yjsUpdate),
            })
        } catch {
          // A process-local acceleration must never change an already durable result.
        }
        this.finishUndo(applyResult, operationId, request.historyTransition)
        if (!request.signal?.aborted) {
          trace.measureSync("projection", () =>
            this.options.projection?.publish({ scope: this.options.scope, frameDigest: frame.frameDigest }),
          )
        }
        this.installCommittedCandidateStandby(candidate)
        candidateTransferred = true
        return Object.freeze({ status: "saved-locally", frame, acceptedFrontierDigest: this.head.frontierDigest })
      } finally {
        if (canonical.ownsDocument) canonical.document.destroy()
      }
    } finally {
      if (!candidateTransferred) candidate.destroy()
    }
  }

  private async receiveFrameExclusive(bytes: Uint8Array, signal?: AbortSignal): Promise<IncomingFrameResult> {
    this.requireLive()
    assertNotAborted(signal)
    const frame = this.codec.decodeFrame(bytes)
    assertSameScope(frame.header.core.scope, this.options.scope, "Incoming frame scope")
    const core = frame.header.core
    assertDocumentOwnerBinding(this.options.owner.protocolPort)
    if (
      core.ownerSchemaDigest !== this.options.owner.protocolPort.schemaDigest ||
      core.canonicalizerDigest !== this.options.owner.protocolPort.canonicalizerDigest
    )
      invalid("Incoming owner schema or canonicalizer digest mismatches")
    const lookup = await this.options.ports.persistence.lookupOperation(core.actorId, core.operationId)
    if (
      lookup.status === "accepted" ||
      lookup.status === "same-frame-recovery" ||
      lookup.status === "object-only-recovery"
    ) {
      const accepted = this.codec.decodeFrame(lookup.bytes)
      if (accepted.frameDigest !== frame.frameDigest)
        await this.quarantineEquivocation([accepted.frameDigest, frame.frameDigest])
      if (lookup.status === "accepted") {
        if (!(await this.options.ports.persistence.isReachableFromAcceptedHead(lookup.ref)))
          throw new CollaborationKernelError(
            "read-only-recovery-required",
            "Accepted incoming operation is below the durable head without reachability proof",
          )
        await this.refreshAcceptedHead()
      }
      return Object.freeze({ status: "duplicate", frame: accepted })
    }
    if (lookup.status === "equivocation") await this.quarantineEquivocation([...lookup.frameDigests, frame.frameDigest])
    const authority = await this.options.ports.incomingAuthority.verifyFrameAuthority(frame)
    if (authority === "pending") return this.retainPending(frame, "missing-proof")
    if (authority === "rejected") invalid("Incoming frame authority is rejected")
    const signatureOk = await verifyExactEd25519(
      this.options.signatureVerifier,
      authority.replicaPublicKey,
      frame.header.replicaSignature,
      this.codec.causalEditSignatureDigest(frame.header.coreDigest),
    )
    if (!signatureOk) invalid("Incoming replica signature is invalid")
    const currentActorHead = actorHeadFor(this.head.actorHeads, core.actorId)
    if (currentActorHead === null && core.actorSequence !== "1") return this.retainPending(frame, "missing-predecessor")
    try {
      validateActorSequenceStep(currentActorHead, core.actorId, core.actorSequence, core.predecessorFrameDigest)
    } catch {
      await this.quarantineEquivocation([
        ...(currentActorHead ? [currentActorHead.frameDigest] : []),
        frame.frameDigest,
      ])
    }
    const base = await this.options.ports.exactBaseResolver.reconstructExactBase(frame)
    if (base === "pending") return this.retainPending(frame, "missing-base")
    if (base === "rejected") invalid("Incoming exact base reconstruction is rejected")
    if (
      base.canonicalStateDigest !== core.baseCanonicalStateDigest ||
      !sameBytes(base.stateVector, frame.sections.baseStateVector)
    )
      invalid("Incoming frame exact base bytes mismatch its signed core")
    const baseActorHeads = parseReplicaActorHeadSet(base.actorHeads)
    assertSameScope(baseActorHeads.scope, this.options.scope, "Incoming exact-base actor-head scope")
    if (
      structuredDigest(KERNEL_DIGEST_DOMAINS.causalFrontier, parseCausalFrontier(base.frontier)) !==
      core.baseFrontierDigest
    )
      invalid("Incoming exact base frontier mismatches")
    const baseDoc = cloneExactBaseDocument(this.options.ports, base.fullUpdate, base.stateVector)
    const authored = validateCanonicalDelta(
      this.options.ports,
      base.fullUpdate,
      base.stateVector,
      frame.sections.yjsUpdate,
      frame.context.signerAuthority.replicaId,
    )
    try {
      const baseState = requireOwnerState(
        this.options.owner.protocolPort.validateBase(baseDoc),
        "Incoming exact base violates owner schema",
      )
      assertOwnerCanonical(this.options.owner, baseDoc, baseState, core.baseCanonicalStateDigest)
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
      assertOwnerExternalFactPort(facts.port, this.options.owner)
      claimOwnerFactPort(facts.port)
      const { candidate: rerun, candidateProof: rerunProof } = createLocalCandidateExactBaseProof({
        factory: this.options.ports,
        fullBaseUpdate: base.fullUpdate,
        baseStateVector: base.stateVector,
        replicaId: frame.context.signerAuthority.replicaId,
      })
      try {
        const result = applyOwnerIntent(this.options.owner, baseState, rerun, ownerContext, intent, facts.port)
        assertConsumedDependencies(facts.port, declaredDependencies)
        requireOwnerState(
          this.options.owner.protocolPort.validatePost(baseState, rerun, result),
          "Incoming rerun violates owner post invariants",
        )
        const rerunDelta = finalizeLocalCandidateExactBaseProof(rerunProof)
        if (!sameBytes(rerunDelta.exactUpdate, frame.sections.yjsUpdate))
          invalid("Incoming owner rerun does not reproduce byte-identical Yjs delta")
        consumeLocalCandidateExactBaseProof(rerunProof)
        const rerunEvidence = encodeRestrictedJcs(
          this.codec.parseActualWriteEvidence(this.options.owner.protocolPort.deriveActualWriteEvidence(result)),
        )
        if (!sameBytes(rerunEvidence, frame.sections.actualWriteEvidenceJcs))
          invalid("Incoming owner rerun does not reproduce exact write evidence")
      } finally {
        rerun.destroy()
      }
      const authoredState = requireOwnerState(
        this.options.owner.protocolPort.validateBase(authored.document),
        "Incoming authored post-state violates owner schema",
      )
      if (
        stateVectorDigest(authored.postStateVector) !== core.postStateVectorDigest ||
        ownerRuntimeCanonicalDigest(this.options.owner, authored.document, authoredState) !== core.postCanonicalStateDigest
      ) {
        invalid("Incoming signed post-state digests mismatch the exact authored candidate")
      }
      const merged = cloneExactBaseDocument(
        this.options.ports,
        encodeFullUpdate(this.replicaDoc),
        encodeStateVector(this.replicaDoc),
      )
      let mergedTransferred = false
      try {
        applyYjsUpdate(merged, frame.sections.yjsUpdate, ACCEPTED_FRAME_ORIGIN)
        encodeStateVector(merged)
        const mergedState = requireOwnerState(
          this.options.owner.protocolPort.validateBase(merged),
          "Merged incoming state violates closed-schema or I-confluence invariants",
        )
        const mergedCanonical = ownerRuntimeCanonicalDigest(this.options.owner, merged, mergedState)
        const newHead = causalHeadRefFromDecodedFrame(frame)
        const frontier = maxCausalFrontier(
          [...this.head.frontier.heads, newHead],
          incomingFrameClosure(frame, this.options.ports.causalClosure),
        )
        if (frontier === "pending") return this.retainPending(frame, "missing-base")
        const materialization = createAcceptedHeadMaterializationEvidence({
          previous: this.head,
          ref: frameObjectRefFromDecodedFrame(frame),
          nextHead: newHead,
          resultingFrontier: frontier,
          postStateVector: encodeStateVector(merged),
          yjsUpdateDigest: yjsUpdateDigest(frame.sections.yjsUpdate),
          canonicalStateDigest: mergedCanonical,
        })
        const persisted = await this.persistIncoming(frame, materialization)
        try {
          applyYjsUpdate(this.replicaDoc, frame.sections.yjsUpdate, ACCEPTED_FRAME_ORIGIN)
          this.installHeadView(persisted.safeMaterialization, persisted.durableHeadDigest)
        } catch (error) {
          await this.rebuildAfterDurableApplyFailure(error)
        }
        this.installCommittedCandidateStandby(merged)
        mergedTransferred = true
        this.options.projection?.publish({ scope: this.options.scope, frameDigest: frame.frameDigest })
        return Object.freeze({ status: "accepted", frame })
      } finally {
        if (!mergedTransferred) merged.destroy()
      }
    } finally {
      baseDoc.destroy()
      authored.document.destroy()
    }
  }

  private async recoverFinalLocalFrame(
    bytes: Uint8Array,
    actorId: string,
    operationId: Id128,
    signal?: AbortSignal,
  ): Promise<LocalCommitResult> {
    const frame = this.codec.decodeFrame(bytes)
    const core = frame.header.core
    assertDocumentOwnerBinding(this.options.owner.protocolPort)
    if (
      core.ownerSchemaDigest !== this.options.owner.protocolPort.schemaDigest ||
      core.canonicalizerDigest !== this.options.owner.protocolPort.canonicalizerDigest
    )
      invalid("Recovery owner schema or canonicalizer digest mismatches")
    if (core.actorId !== actorId || core.operationId !== operationId)
      await this.quarantineEquivocation([frame.frameDigest])
    assertSameScope(core.scope, this.options.scope, "Recovery frame scope")
    const baseStateVector = encodeStateVector(this.replicaDoc)
    if (
      core.baseFrontierDigest !== this.head.frontierDigest ||
      core.baseStateVectorDigest !== stateVectorDigest(baseStateVector) ||
      core.baseCanonicalStateDigest !== this.head.canonicalStateDigest
    ) {
      throw new CollaborationKernelError(
        "read-only-recovery-required",
        "Original final frame is no longer directly above the accepted head",
      )
    }
    const authority = await this.options.ports.incomingAuthority.verifyFrameAuthority(frame)
    if (authority === "pending") pending("Recovery frame authority is pending")
    if (authority === "rejected") invalid("Recovery frame authority is rejected")
    if (
      !(await verifyExactEd25519(
        this.options.signatureVerifier,
        authority.replicaPublicKey,
        frame.header.replicaSignature,
        this.codec.causalEditSignatureDigest(frame.header.coreDigest),
      ))
    ) {
      invalid("Recovery frame signature is invalid")
    }
    const fullBaseUpdate = encodeFullUpdate(this.replicaDoc)
    const baseState = requireOwnerState(
      this.options.owner.protocolPort.validateBase(this.replicaDoc),
      "Recovery base violates owner schema",
    )
    assertOwnerCanonical(this.options.owner, this.replicaDoc, baseState, this.head.canonicalStateDigest)
    const { candidate: rerun, candidateProof: rerunProof } = createLocalCandidateExactBaseProof({
      factory: this.options.ports,
      fullBaseUpdate,
      baseStateVector,
      replicaId: frame.context.signerAuthority.replicaId,
    })
    const authored = validateCanonicalDelta(
      this.options.ports,
      fullBaseUpdate,
      baseStateVector,
      frame.sections.yjsUpdate,
      frame.context.signerAuthority.replicaId,
    )
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
      assertOwnerExternalFactPort(facts.port, this.options.owner)
      claimOwnerFactPort(facts.port)
      const result = applyOwnerIntent(this.options.owner, baseState, rerun, ownerContext, intent, facts.port)
      assertConsumedDependencies(facts.port, declaredDependencies)
      requireOwnerState(
        this.options.owner.protocolPort.validatePost(baseState, rerun, result),
        "Recovery rerun violates owner invariants",
      )
      const rerunDelta = finalizeLocalCandidateExactBaseProof(rerunProof)
      if (!sameBytes(rerunDelta.exactUpdate, frame.sections.yjsUpdate))
        invalid("Recovery rerun delta differs from original final bytes")
      consumeLocalCandidateExactBaseProof(rerunProof)
      if (
        !sameBytes(
          encodeRestrictedJcs(
            this.codec.parseActualWriteEvidence(this.options.owner.protocolPort.deriveActualWriteEvidence(result)),
          ),
          frame.sections.actualWriteEvidenceJcs,
        )
      )
        invalid("Recovery evidence differs from original final bytes")
      const authoredState = requireOwnerState(
        this.options.owner.protocolPort.validateBase(authored.document),
        "Recovery authored post-state violates owner schema",
      )
      const postCanonical = ownerRuntimeCanonicalDigest(this.options.owner, authored.document, authoredState)
      if (
        stateVectorDigest(authored.postStateVector) !== core.postStateVectorDigest ||
        postCanonical !== core.postCanonicalStateDigest
      )
        invalid("Recovery post-state differs from signed core")
      const newHead = causalHeadRefFromDecodedFrame(frame)
      const resultingFrontier = parseCausalFrontier({ format: "convax.causal-frontier", heads: [newHead] })
      const materialization = createAcceptedHeadMaterializationEvidence({
        previous: this.head,
        ref: frameObjectRefFromDecodedFrame(frame),
        nextHead: newHead,
        resultingFrontier,
        postStateVector: authored.postStateVector,
        yjsUpdateDigest: yjsUpdateDigest(frame.sections.yjsUpdate),
        canonicalStateDigest: postCanonical,
      })
      const persisted = await this.persistLocal(frame, materialization, signal)
      try {
        applyYjsUpdate(this.replicaDoc, frame.sections.yjsUpdate, ACCEPTED_FRAME_ORIGIN)
        this.installHeadView(persisted.safeMaterialization, persisted.durableHeadDigest)
      } catch (error) {
        await this.rebuildAfterDurableApplyFailure(error)
      }
      if (!signal?.aborted)
        this.options.projection?.publish({ scope: this.options.scope, frameDigest: frame.frameDigest })
      return Object.freeze({ status: "recovered-final-frame", frame, acceptedFrontierDigest: this.head.frontierDigest })
    } finally {
      rerun.destroy()
      authored.document.destroy()
    }
  }

  private async refreshAcceptedHead(): Promise<void> {
    assertDocumentOwnerBinding(this.options.owner.protocolPort)
    const head = normalizeAcceptedHead(
      await this.options.ports.persistence.loadReplicaHead(this.options.scope),
      this.options.scope,
    )
    if (head.headDigest === this.head.headDigest && this.headMaterialized) return
    const replica = cloneExactBaseDocument(this.options.ports, head.fullUpdate, head.stateVector)
    try {
      const state = requireOwnerState(
        this.options.owner.protocolPort.validateBase(replica),
        "Reloaded accepted head violates owner schema",
      )
      assertOwnerCanonical(this.options.owner, replica, state, head.canonicalStateDigest)
      const previous = this.replicaDoc
      this.invalidateStandbyCandidate()
      this.replicaDoc = replica
      this.head = head
      this.headFullUpdateBytes = new Uint8Array(head.fullUpdate)
      this.headMaterialized = true
      this.headStateVectorDigest = stateVectorDigest(head.stateVector)
      this.documentGeneration += 1
      this.options.undo?.clear("rebuild")
      previous.destroy()
    } catch (error) {
      replica.destroy()
      throw error
    }
  }

  private async persistLocal(
    frame: DecodedCausalEditFrame,
    materialization: AcceptedHeadMaterializationEvidence,
    signal: AbortSignal | undefined,
    trace?: LocalCommitLatencyTrace,
  ): Promise<Readonly<{ durableHeadDigest: Digest; safeMaterialization: AcceptedHeadTransitionView }>> {
    assertNotAborted(signal)
    return this.persistAcceptedFrame(frame, materialization, trace)
  }

  private async persistIncoming(
    frame: DecodedCausalEditFrame,
    materialization: AcceptedHeadMaterializationEvidence,
  ): Promise<Readonly<{ durableHeadDigest: Digest; safeMaterialization: AcceptedHeadTransitionView }>> {
    return this.persistAcceptedFrame(frame, materialization)
  }

  private async persistAcceptedFrame(
    frame: DecodedCausalEditFrame,
    materialization: AcceptedHeadMaterializationEvidence,
    trace?: LocalCommitLatencyTrace,
  ): Promise<Readonly<{ durableHeadDigest: Digest; safeMaterialization: AcceptedHeadTransitionView }>> {
    const ref = frameObjectRefFromDecodedFrame(frame)
    const previous = this.head
    const validated = validateAcceptedHeadMaterializationEvidence({ previous, ref, evidence: materialization })
    if (validated === "rejected") invalid("Accepted-head materialization evidence was invalidated")
    const expectedHead = cloneAcceptedHeadIdentity(previous)
    const request = Object.freeze({
      ref,
      exactFrameBytes: new Uint8Array(frame.bytes),
      expectedHead,
      accepted: materialization,
      outboxRequirement: ACCEPTED_FRAME_OUTBOX_REQUIREMENT,
    })
    const result = await measureOptional(trace, "atomic-accepted-frame-commit", async () => {
      try {
        return await this.options.ports.persistence.commitAcceptedFrame(request)
      } catch {
        // The first call may have committed and lost only its response. Reuse the
        // byte- and brand-identical request; the mandatory port must recover the
        // exact atomic record or fail closed.
        return this.options.ports.persistence.commitAcceptedFrame(request)
      }
    })
    if (!isPlainDataObject(result)) invalid("Atomic accepted-frame port returned a non-object value")
    if (result.status === "rejected") {
      assertExactKeys(result, ["status", "code"], "CommitAcceptedFrame rejected result")
      throw new CollaborationKernelError(
        "read-only-recovery-required",
        `Replica-head durability rejected: ${result.code}`,
      )
    }
    if (result.status === "quarantined") {
      assertExactKeys(result, ["status", "evidence"], "CommitAcceptedFrame quarantined result")
      const evidence = result.evidence
      if (!isPlainDataObject(evidence)) invalid("Atomic quarantine evidence is not an object")
      assertExactKeys(evidence, [
        "format",
        "ref",
        "expectedReplicaHeadRecordDigest",
        "observedReplicaHeadRecordDigest",
        "quarantinedFrameRecordDigest",
        "quarantineCommitRecordDigest",
        "shardDispositionHeadRecordDigest",
        "atomicCommitRecordDigest",
      ], "AcceptedFrameAtomicQuarantinePortEvidence")
      if (evidence.format !== "convax.accepted-frame-atomic-quarantine-evidence") {
        invalid("Atomic quarantine evidence format is invalid")
      }
      assertFrameRefMirror(evidence.ref, ref, "Atomic quarantine")
      if (
        evidence.expectedReplicaHeadRecordDigest !== expectedHead.headDigest
      )
        invalid("Atomic quarantine evidence mirrors do not match the commit request")
      parseDigest(evidence.observedReplicaHeadRecordDigest)
      parseDigest(evidence.quarantinedFrameRecordDigest)
      parseDigest(evidence.quarantineCommitRecordDigest)
      parseDigest(evidence.shardDispositionHeadRecordDigest)
      parseDigest(evidence.atomicCommitRecordDigest)
      const reloaded = normalizeAcceptedHead(
        await this.options.ports.persistence.loadReplicaHead(this.options.scope),
        this.options.scope,
      )
      if (reloaded.headDigest !== evidence.shardDispositionHeadRecordDigest)
        invalid("Quarantine disposition head was not durably published")
      throw new CollaborationKernelError(
        "equivocation-quarantine",
        "Replica-head compare-and-commit quarantined the frame",
      )
    }
    if (result.status !== "committed") invalid("Atomic accepted-frame port returned an unknown status")
    assertExactKeys(result, ["status", "evidence"], "CommitAcceptedFrame committed result")
    const evidence = result.evidence
    if (!isPlainDataObject(evidence)) invalid("Atomic commit evidence is not an object")
    assertExactKeys(evidence, [
      "format",
      "ref",
      "frameRecordDigest",
      "outboxRecordDigest",
      "journalRecordDigest",
      "expectedReplicaHeadRecordDigest",
      "resultingReplicaHeadRecordDigest",
      "resultingFrontierDigest",
      "resultingMaterializationDigest",
      "atomicCommitRecordDigest",
    ], "AcceptedFrameAtomicCommitPortEvidence")
    if (evidence.format !== "convax.accepted-frame-atomic-commit-evidence") {
      invalid("Atomic commit evidence format is invalid")
    }
    assertFrameRefMirror(evidence.ref, ref, "Atomic commit")
    if (
      evidence.expectedReplicaHeadRecordDigest !== expectedHead.headDigest ||
      evidence.resultingFrontierDigest !== validated.transition.frontierDigest ||
      evidence.resultingMaterializationDigest !== validated.transition.materializationDigest
    )
      invalid("Atomic commit evidence mirrors do not match the commit request")
    parseDigest(evidence.frameRecordDigest)
    parseDigest(evidence.outboxRecordDigest)
    parseDigest(evidence.journalRecordDigest)
    parseDigest(evidence.resultingReplicaHeadRecordDigest)
    parseDigest(evidence.atomicCommitRecordDigest)
    const afterCommit = validateAcceptedHeadMaterializationEvidence({ previous, ref, evidence: materialization })
    if (afterCommit === "rejected") {
      invalid("Accepted-head materialization evidence was invalidated after atomic durability")
    }
    if (
      afterCommit.durableDelta.resultingMaterializationDigest !== validated.durableDelta.resultingMaterializationDigest ||
      afterCommit.transition.frontierDigest !== validated.transition.frontierDigest
    ) {
      invalid("Accepted-head transition changed across atomic durability")
    }
    return Object.freeze({
      durableHeadDigest: evidence.resultingReplicaHeadRecordDigest,
      safeMaterialization: afterCommit.transition,
    })
  }

  private async rebuildAfterDurableApplyFailure(cause: unknown): Promise<never> {
    try {
      await this.refreshAcceptedHead()
    } catch {
      // The durable closure remains authoritative even when immediate rebuild fails.
    }
    throw new CollaborationKernelError(
      "read-only-recovery-required",
      "Durable replica head committed but authoritative in-memory application failed",
      { cause },
    )
  }

  private installHeadView(
    materialization: AcceptedHeadTransitionView,
    durableHeadDigest: Digest,
    certifiedDigests?: Readonly<{ stateVectorDigest: Digest }>,
  ): void {
    this.invalidateStandbyCandidate()
    this.head = Object.freeze({
      ...materialization,
      headDigest: durableHeadDigest,
      fullUpdate: this.head.fullUpdate,
      stateVector: parseStateVector(materialization.stateVector),
    })
    this.headMaterialized = false
    this.headStateVectorDigest = certifiedDigests?.stateVectorDigest ?? stateVectorDigest(this.head.stateVector)
    this.documentGeneration += 1
  }

  private installCommittedCandidateStandby(document: Y.Doc): void {
    this.invalidateStandbyCandidate()
    if (this.disposed) {
      document.destroy()
      return
    }
    const binding = Object.freeze({
      scopeDigest: documentScopeDigest(this.options.scope),
      durableHeadDigest: this.head.headDigest,
      frontierDigest: this.head.frontierDigest,
      materializationDigest: this.head.materializationDigest,
      stateVectorDigest: this.headStateVectorDigest,
      documentGeneration: this.documentGeneration,
    })
    this.standbyCandidate = createStandbyExactBaseCandidate(document, binding)
  }

  private consumeStandbyCandidate(
    replicaId: ReplicaId,
    expectedStateVector: StateVector,
  ): Readonly<{ candidate: Y.Doc; candidateProof: LocalCandidateExactBaseProof }> | null {
    const standby = this.standbyCandidate
    this.standbyCandidate = null
    if (standby === null) return null
    detachStandbyExactBaseCandidate(standby)
    const eligible =
      this.matchesStandbyBinding(standby) &&
      standby.transactions === 0 &&
      standby.updates === 0 &&
      standby.document.clientID === standby.clientId &&
      sameBytes(encodeStateVector(standby.document), expectedStateVector)
    if (!eligible) {
      standby.document.destroy()
      return null
    }
    standby.document.clientID = replicaIdToYjsClientId(replicaId)
    return createLocalCandidateProofForExistingDocument(standby.document, replicaId)
  }

  private matchesStandbyBinding(binding: StandbyExactBaseBinding): boolean {
    return (
      !this.disposed &&
      binding.scopeDigest === documentScopeDigest(this.options.scope) &&
      binding.durableHeadDigest === this.head.headDigest &&
      binding.frontierDigest === this.head.frontierDigest &&
      binding.materializationDigest === this.head.materializationDigest &&
      binding.stateVectorDigest === this.headStateVectorDigest &&
      binding.documentGeneration === this.documentGeneration
    )
  }

  private invalidateStandbyCandidate(): void {
    if (this.standbyCandidate !== null) {
      detachStandbyExactBaseCandidate(this.standbyCandidate)
      this.standbyCandidate.document.destroy()
      this.standbyCandidate = null
    }
  }

  private async reloadCurrentHeadMaterialization(): Promise<void> {
    const loaded = normalizeAcceptedHead(
      await this.options.ports.persistence.loadReplicaHead(this.options.scope),
      this.options.scope,
    )
    if (
      loaded.headDigest !== this.head.headDigest ||
      loaded.frontierDigest !== this.head.frontierDigest ||
      loaded.canonicalStateDigest !== this.head.canonicalStateDigest ||
      loaded.materializationDigest !== this.head.materializationDigest ||
      !sameBytes(loaded.stateVector, this.head.stateVector)
    ) stale()
    const exact = cloneExactBaseDocument(this.options.ports, loaded.fullUpdate, loaded.stateVector)
    try {
      const state = requireOwnerState(
        this.options.owner.protocolPort.validateBase(exact),
        "Cold-loaded accepted head violates owner schema",
      )
      assertOwnerCanonical(this.options.owner, exact, state, loaded.canonicalStateDigest)
      this.head = loaded
      this.headFullUpdateBytes = new Uint8Array(loaded.fullUpdate)
      this.headStateVectorDigest = stateVectorDigest(loaded.stateVector)
      this.headMaterialized = true
    } finally {
      exact.destroy()
    }
  }

  private async retainPending(frame: DecodedCausalEditFrame, reason: PendingFrameReason): Promise<IncomingFrameResult> {
    const retained = await this.options.ports.pendingInbox.retainExactFrame(frame, reason)
    if (retained === "capacity-exceeded")
      throw new CollaborationKernelError(
        "read-only-recovery-required",
        "Pending inbox capacity is exhausted; exact bytes cannot be discarded",
      )
    return Object.freeze({ status: "dependency-pending", frame, reason })
  }

  private finishUndo(
    _result: OwnerApplyResult,
    operationId: Id128,
    transition?: LocalIntentRequest["historyTransition"],
  ): void {
    if (!this.options.undo) return
    try {
      if (transition?.direction === "undo") this.options.undo.commitUndo(transition.cursorToken, operationId)
      else if (transition?.direction === "redo") this.options.undo.commitRedo(transition.cursorToken, operationId)
      else this.options.undo.recordDurableRoot(operationId)
    } catch (error) {
      this.options.undo.clear("post-commit-cursor-failure")
      throw new CollaborationKernelError(
        "history-reset-after-commit",
        "Domain commit succeeded but the transient undo cursor failed",
        { cause: error },
      )
    }
  }

  private async quarantineEquivocation(digests: readonly Digest[]): Promise<never> {
    for (const digest of new Set(digests))
      await this.options.ports.persistence.quarantineExactObject(digest, "equivocation")
    throw new CollaborationKernelError(
      "equivocation-quarantine",
      "Actor operation identity has conflicting signed frames",
    )
  }

  private requireLive(): void {
    if (this.disposed) throw new CollaborationKernelError("disposed", "Collaboration kernel is disposed")
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task)
    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}

class LocalCommitLatencyTrace {
  private readonly startedAt = monotonicNow()
  private readonly stages = Object.fromEntries(
    collaborationLatencyStages.map((stage) => [stage, { durationMs: 0, callCount: 0 }]),
  ) as Record<CollaborationLatencyStage, { durationMs: number; callCount: number }>
  private published = false

  constructor(
    private readonly ownerKind: CollaborationLatencyDiagnostic["ownerKind"],
    private readonly port: CollaborationLatencyDiagnosticsPort | undefined,
  ) {}

  finishQueue(): void {
    this.record("queue", monotonicNow() - this.startedAt)
  }

  async measure<T>(stage: CollaborationLatencyStage, operation: () => Promise<T>): Promise<T> {
    const startedAt = monotonicNow()
    try {
      return await operation()
    } finally {
      this.record(stage, monotonicNow() - startedAt)
    }
  }

  measureSync<T>(stage: CollaborationLatencyStage, operation: () => T): T {
    const startedAt = monotonicNow()
    try {
      return operation()
    } finally {
      this.record(stage, monotonicNow() - startedAt)
    }
  }

  publish(outcome: CollaborationLatencyDiagnostic["outcome"]): void {
    if (!this.port || this.published) return
    this.published = true
    const totalDurationMs = monotonicNow() - this.startedAt
    const stages = Object.freeze(
      Object.fromEntries(collaborationLatencyStages.map((stage) => [stage, Object.freeze({ ...this.stages[stage] })])),
    ) as CollaborationLatencyDiagnostic["stages"]
    const port = this.port
    const baseDiagnostic: CollaborationLatencyDiagnostic = Object.freeze({
      format: "convax.collaboration-latency-diagnostic",
      version: 2,
      ownerKind: this.ownerKind,
      outcome,
      totalDurationMs,
      apiObservedDurationMs: monotonicNow() - this.startedAt,
      stages,
    })
    let shouldSample = true
    try {
      shouldSample = port.shouldSample?.(baseDiagnostic) ?? true
    } catch {
      shouldSample = false
    }
    if (!shouldSample) return

    const sampleStartedAt = monotonicNow()
    let pendingSample: CollaborationLatencySample | Promise<CollaborationLatencySample> | undefined
    try {
      pendingSample = port.sample?.()
    } catch {
      pendingSample = undefined
    }
    const apiObservedDurationMs = monotonicNow() - this.startedAt
    void Promise.resolve(pendingSample)
      .then((sample) => {
        const diagnostic: CollaborationLatencyDiagnostic = Object.freeze({
          ...baseDiagnostic,
          apiObservedDurationMs,
          sampleDurationMs: monotonicNow() - sampleStartedAt,
          ...(sample ? { sample: Object.freeze({ ...sample }) } : {}),
        })
        return port.record(diagnostic)
      })
      .catch(() => undefined)
  }

  private record(stage: CollaborationLatencyStage, durationMs: number): void {
    const measurement = this.stages[stage]
    measurement.durationMs += durationMs
    measurement.callCount += 1
  }
}

function measureOptional<T>(
  trace: LocalCommitLatencyTrace | undefined,
  stage: CollaborationLatencyStage,
  operation: () => Promise<T>,
): Promise<T> {
  return trace ? trace.measure(stage, operation) : operation()
}

function monotonicNow(): number {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now()
}

interface LocalCandidateExactBaseProof {
  readonly candidate: Y.Doc
  readonly replicaId: ReplicaId
  readonly clientId: number
  transactions: number
  updates: number
  originsExact: boolean
  exactUpdate?: Uint8Array
  postValidationTransactions?: number
  postValidationUpdates?: number
  postValidationClientId?: number
  state: "armed" | "encoded" | "consumed"
  readonly beforeTransaction: (transaction: Y.Transaction) => void
  readonly update: (bytes: Uint8Array, origin: unknown) => void
}

interface StandbyExactBaseBinding {
  readonly scopeDigest: Digest
  readonly durableHeadDigest: Digest
  readonly frontierDigest: Digest
  readonly materializationDigest: Digest
  readonly stateVectorDigest: Digest
  readonly documentGeneration: number
}

interface StandbyExactBaseCandidate extends StandbyExactBaseBinding {
  readonly document: Y.Doc
  readonly clientId: number
  transactions: number
  updates: number
  readonly beforeTransaction: () => void
  readonly update: () => void
}

function createLocalCandidateExactBaseProof(input: {
  readonly factory: CollaborationKernelPorts
  readonly fullBaseUpdate: Uint8Array
  readonly baseStateVector: StateVector
  readonly replicaId: ReplicaId
}): Readonly<{ candidate: Y.Doc; candidateProof: LocalCandidateExactBaseProof }> {
  const candidate = cloneExactBaseDocument(input.factory, input.fullBaseUpdate, input.baseStateVector, input.replicaId)
  return createLocalCandidateProofForExistingDocument(candidate, input.replicaId)
}

function createLocalCandidateProofForExistingDocument(
  candidate: Y.Doc,
  replicaId: ReplicaId,
): Readonly<{ candidate: Y.Doc; candidateProof: LocalCandidateExactBaseProof }> {
  const proof = {} as LocalCandidateExactBaseProof
  Object.assign(proof, {
    candidate,
    replicaId,
    clientId: candidate.clientID,
    transactions: 0,
    updates: 0,
    originsExact: true,
    state: "armed",
    beforeTransaction: (transaction: Y.Transaction) => {
      proof.transactions += 1
      if (transaction.origin !== LOCAL_CANDIDATE_ORIGIN) proof.originsExact = false
    },
    update: (bytes: Uint8Array, origin: unknown) => {
      proof.updates += 1
      proof.exactUpdate = proof.updates === 1 ? cloneBytes(bytes, "local candidate exact update") : undefined
      if (origin !== LOCAL_CANDIDATE_ORIGIN) proof.originsExact = false
    },
  } satisfies LocalCandidateExactBaseProof)
  candidate.on("beforeTransaction", proof.beforeTransaction)
  candidate.on("update", proof.update)
  return Object.freeze({ candidate, candidateProof: proof })
}

function createStandbyExactBaseCandidate(
  document: Y.Doc,
  binding: StandbyExactBaseBinding,
): StandbyExactBaseCandidate {
  const standby = {} as StandbyExactBaseCandidate
  Object.assign(standby, {
    ...binding,
    document,
    clientId: document.clientID,
    transactions: 0,
    updates: 0,
    beforeTransaction: () => {
      standby.transactions += 1
    },
    update: () => {
      standby.updates += 1
    },
  } satisfies StandbyExactBaseCandidate)
  document.on("beforeTransaction", standby.beforeTransaction)
  document.on("update", standby.update)
  return standby
}

function detachStandbyExactBaseCandidate(standby: StandbyExactBaseCandidate): void {
  standby.document.off("beforeTransaction", standby.beforeTransaction)
  standby.document.off("update", standby.update)
}

function finalizeLocalCandidateExactBaseProof(
  proof: LocalCandidateExactBaseProof,
): Readonly<{ exactUpdate: Uint8Array; postStateVector: StateVector }> {
  proof.postValidationTransactions = proof.transactions
  proof.postValidationUpdates = proof.updates
  proof.postValidationClientId = proof.candidate.clientID
  const fastEligible =
    proof.state === "armed" &&
    proof.candidate.clientID === proof.clientId &&
    proof.transactions === 1 &&
    proof.updates === 1 &&
    proof.exactUpdate !== undefined &&
    proof.originsExact
  if (!fastEligible) {
    invalid("Local owner mutation must produce exactly one sealed transaction update")
  }
  try {
    assertUpdateAuthoredByReplica(proof.exactUpdate!, proof.replicaId)
    const postStateVector = encodeStateVector(proof.candidate)
    proof.state = "encoded"
    return Object.freeze({ exactUpdate: proof.exactUpdate!, postStateVector })
  } catch {
    invalid("Local owner transaction update is not authored by the selected replica")
  }
}

function consumeLocalCandidateExactBaseProof(proof: LocalCandidateExactBaseProof): void {
  if (
    proof.state !== "encoded" ||
    proof.postValidationTransactions === undefined ||
    proof.postValidationUpdates === undefined ||
    proof.postValidationClientId === undefined ||
    proof.candidate.clientID !== proof.postValidationClientId ||
    proof.transactions !== proof.postValidationTransactions ||
    proof.updates !== proof.postValidationUpdates
  ) {
    detachLocalCandidateExactBaseProof(proof)
    invalid("Local candidate changed after owner post-validation")
  }
  detachLocalCandidateExactBaseProof(proof)
  proof.state = "consumed"
}

function detachLocalCandidateExactBaseProof(proof: LocalCandidateExactBaseProof): void {
  proof.candidate.off("beforeTransaction", proof.beforeTransaction)
  proof.candidate.off("update", proof.update)
}

function observeExactAcceptedReplicaApply(
  document: Y.Doc,
  exactUpdate: Uint8Array,
  apply: () => void,
): number {
  let transactions = 0
  let updates = 0
  let exactOrigins = true
  let observedUpdate: Uint8Array | undefined
  const before = (transaction: Y.Transaction) => {
    transactions += 1
    if (transaction.origin !== ACCEPTED_FRAME_ORIGIN) exactOrigins = false
  }
  const update = (bytes: Uint8Array, origin: unknown) => {
    updates += 1
    observedUpdate = updates === 1 ? cloneBytes(bytes, "accepted replica exact update") : undefined
    if (origin !== ACCEPTED_FRAME_ORIGIN) exactOrigins = false
  }
  document.on("beforeTransaction", before)
  document.on("update", update)
  try {
    apply()
  } finally {
    document.off("beforeTransaction", before)
    document.off("update", update)
  }
  if (
    transactions !== 1 ||
    updates !== 1 ||
    !exactOrigins ||
    observedUpdate === undefined ||
    !sameBytes(observedUpdate, exactUpdate)
  ) {
    invalid("Accepted replica apply was widened by an observer transaction")
  }
  return transactions
}

function applyOwnerIntent(
  runtime: DocumentOwnerRuntime,
  base: OwnerValidatedState,
  candidate: Y.Doc,
  context: Parameters<DocumentOwnerProtocolPort["applyIntent"]>[2],
  intent: unknown,
  facts: Parameters<DocumentOwnerProtocolPort["applyIntent"]>[4],
  baseCanonicalProof?: Readonly<{ readonly canonicalStateDigest: Digest; readonly durableHeadDigest: Digest }>,
): OwnerApplyResult {
  const outcome: { value: OwnerApplyResult | "pending" | "rejected" } = { value: "rejected" }
  try {
    armOwnerCandidateTransactionCapture(runtime, { base, candidate, context, baseCanonicalProof })
  } catch {
    // Optional owner acceleration must never change admission.
  }
  candidate.transact(() => {
    outcome.value = runtime.protocolPort.applyIntent(base, candidate, context, intent, facts)
  }, LOCAL_CANDIDATE_ORIGIN)
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

function ownerRuntimeCanonicalDigest(
  owner: DocumentOwnerRuntime,
  document: Y.Doc,
  state: OwnerValidatedState,
): Digest {
  const digest = consumeOwnerStateCommitmentDigest(owner, document, state)
  if (digest === null) invalid("Owner validated state omitted its exact issuer-bound state commitment")
  return digest
}

function assertOwnerCanonical(
  owner: DocumentOwnerRuntime,
  document: Y.Doc,
  state: OwnerValidatedState,
  expected: Digest,
): Digest {
  const actual = ownerRuntimeCanonicalDigest(owner, document, state)
  if (actual !== expected) invalid("Owner canonical-state digest mismatches accepted durable evidence")
  return actual
}

function computeValidationArtifactSetDigest(value: ValidationArtifactSet): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.validationArtifactSet, value)
}

function assertRequiredProtocolArtifacts(value: ValidationArtifactSet): void {
  const required = [
    { owner: "canvas", ...PROTOCOL_SCHEMA_ARTIFACTS[0] },
    { owner: "kernel", ...PROTOCOL_SCHEMA_ARTIFACTS[1] },
    { owner: "control-plane", ...PROTOCOL_SCHEMA_ARTIFACTS[2] },
    { owner: "project-index", ...PROTOCOL_SCHEMA_ARTIFACTS[3] },
  ].map(({ owner, format, artifactDigest }) => ({ owner, format, artifactDigest }))
  for (const artifact of required) {
    if (
      !value.artifacts.some(
        (candidate) =>
          candidate.owner === artifact.owner &&
          candidate.format === artifact.format &&
          candidate.artifactDigest === artifact.artifactDigest,
      )
    ) {
      invalid("Validation artifact set omits a frozen protocol owner artifact")
    }
  }
}

function requireTypedIntentKind(value: unknown): string {
  if (
    !isPlainDataObject(value) ||
    typeof value.kind !== "string" ||
    value.kind.length < 1 ||
    value.kind.length > 128 ||
    !/^[\x20-\x7e]+$/u.test(value.kind)
  ) {
    invalid("Typed intent has no valid exact kind")
  }
  return value.kind
}

function requirePreparedLocalIntent(value: unknown): PreparedLocalIntent {
  if (!isPlainDataObject(value)) invalid("Local intent prepare callback returned a non-object")
  assertExactKeys(value, ["externalFacts", "typedIntent"], "PreparedLocalIntent")
  return value as unknown as PreparedLocalIntent
}

function requireOwnerDependencies(
  value: OwnerIntentDependencies<DocumentScope["docKind"]> | "pending" | "rejected",
  message: string,
): OwnerIntentDependencies<DocumentScope["docKind"]> {
  if (value === "pending") pending(message)
  if (value === "rejected") invalid(message)
  return value
}

function assertConsumedDependencies(
  facts: OwnerExternalFactPort,
  declared: OwnerIntentDependencies<DocumentScope["docKind"]>,
): void {
  if (
    !sameJcsBytes(
      encodeRestrictedJcs(dependencyIdentity(facts.consumedDependencies())),
      encodeRestrictedJcs(dependencyIdentity(declared)),
    )
  ) {
    invalid("Owner fact port did not consume the exact declared dependency closure")
  }
}

function dependencyIdentity(value: OwnerIntentDependencies<DocumentScope["docKind"]>): unknown {
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

function claimOwnerFactPort(facts: OwnerExternalFactPort): void {
  if (claimedOwnerFactPorts.has(facts)) invalid("Owner fact port was reused across collaboration attempts")
  claimedOwnerFactPorts.add(facts)
}

function assertEvidenceClosure(
  evidence: ActualWriteEvidence,
  scope: DocumentScope,
  schemaDigest: Digest,
  intentDigest: Digest,
): void {
  assertSameScope(evidence.scope, scope, "Owner evidence scope")
  if (
    evidence.owner !== scope.docKind ||
    evidence.ownerSchemaDigest !== schemaDigest ||
    evidence.intentDigest !== intentDigest
  )
    invalid("Owner evidence duplicate fields mismatch")
}

function actorHeadFor(set: ReplicaActorHeadSet, actorId: string): CausalHeadRef | null {
  return set.heads.find((head) => head.actorId === actorId) ?? null
}

function normalizeAcceptedHead(value: unknown, scope: DocumentScope): AcceptedHeadView {
  if (!isPlainDataObject(value)) invalid("Replica head port returned a non-object value")
  assertExactKeys(
    value,
    [
      "scope",
      "headDigest",
      "frontier",
      "frontierDigest",
      "actorHeads",
      "fullUpdate",
      "stateVector",
      "canonicalStateDigest",
      "materializationDigest",
    ],
    "AcceptedHeadView",
  )
  const head = value as unknown as AcceptedHeadView
  const parsedScope = parseDocumentScope(head.scope)
  assertSameScope(parsedScope, scope, "Accepted head scope")
  const frontier = parseCausalFrontier(head.frontier)
  const actorHeads = parseReplicaActorHeadSet(head.actorHeads)
  assertSameScope(actorHeads.scope, scope, "Accepted actor-head scope")
  const frontierDigest = parseDigest(head.frontierDigest)
  if (structuredDigest(KERNEL_DIGEST_DOMAINS.causalFrontier, frontier) !== frontierDigest)
    invalid("Accepted head frontier digest mismatches")
  return Object.freeze({
    scope: parsedScope,
    headDigest: parseDigest(head.headDigest),
    frontier,
    frontierDigest,
    actorHeads,
    fullUpdate: cloneBytes(head.fullUpdate, "accepted-head full update"),
    stateVector: parseStateVector(head.stateVector),
    canonicalStateDigest: parseDigest(head.canonicalStateDigest),
    materializationDigest: parseDigest(head.materializationDigest),
  })
}

function cloneAcceptedHeadIdentity(head: AcceptedHeadIdentityView): AcceptedHeadIdentityView {
  const scope = parseDocumentScope(head.scope)
  const actorHeads = parseReplicaActorHeadSet(head.actorHeads)
  assertSameScope(actorHeads.scope, scope, "Accepted-head identity actor-head scope")
  return Object.freeze({
    scope,
    headDigest: parseDigest(head.headDigest),
    frontier: parseCausalFrontier(head.frontier),
    frontierDigest: parseDigest(head.frontierDigest),
    actorHeads,
    stateVector: parseStateVector(head.stateVector),
    canonicalStateDigest: parseDigest(head.canonicalStateDigest),
    materializationDigest: parseDigest(head.materializationDigest),
  })
}

function assertFrameRefMirror(actual: FrameObjectRef, expected: FrameObjectRef, label: string): void {
  if (!sameJcsBytes(encodeRestrictedJcs(actual), encodeRestrictedJcs(expected))) {
    invalid(`${label} frame reference mirror mismatches`)
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new CollaborationKernelError(
      "cancelled",
      "Local collaboration commit was cancelled before durable head acceptance",
    )
}

function stale(): never {
  throw new CollaborationKernelError(
    "stale-local-head",
    "The durable accepted head changed while constructing the candidate",
  )
}

function pending(message: string): never {
  throw new CollaborationKernelError("dependency-pending", message)
}

function invalid(message: string): never {
  throw new CollaborationKernelError("invalid-owner-result", message)
}
