import type { ActorId, Digest, Id128, PublicKey, StateVector, Uint64 } from "./codecs"
import type {
  CausalDependencyRef,
  CausalFrontier,
  CausalHeadRef,
  CausalSignerAuthority,
  DecodedCausalEditFrame,
  DocumentScope,
  FrameObjectRef,
  OwnerExternalFactPort,
  OwnerIntentDependencies,
  ReplicaActorHeadSet,
  ValidationArtifactSet,
} from "./contracts"
import type { ReplicaSignerPort } from "./crypto"
import type { YjsDocumentFactory } from "./yjs-codec"
import type { CausalClosurePort } from "./causal"

export interface JournalAppendPortEvidence {
  readonly ref: FrameObjectRef
  readonly journalRecordDigest: Digest
}

export interface HeadCommitPortEvidence {
  readonly ref: FrameObjectRef
  readonly journalRecordDigest: Digest
  readonly expectedReplicaHeadRecordDigest: Digest
  readonly resultingReplicaHeadRecordDigest: Digest
  readonly resultingFrontierDigest: Digest
}

export interface HeadCommitQuarantinePortEvidence {
  readonly ref: FrameObjectRef
  readonly journalRecordDigest: Digest
  readonly expectedReplicaHeadRecordDigest: Digest
  readonly observedReplicaHeadRecordDigest: Digest
  readonly quarantineCommitRecordDigest: Digest
  readonly shardDispositionHeadRecordDigest: Digest
}

export type CompareAndCommitReplicaHeadPortResult =
  | Readonly<{ status: "committed"; evidence: HeadCommitPortEvidence }>
  | Readonly<{ status: "quarantined"; evidence: HeadCommitQuarantinePortEvidence }>
  | Readonly<{ status: "rejected"; code: "durability-failed" | "store-corrupt" }>

export interface AcceptedHeadView {
  readonly scope: DocumentScope
  readonly headDigest: Digest
  readonly frontier: CausalFrontier
  readonly frontierDigest: Digest
  readonly actorHeads: ReplicaActorHeadSet
  readonly fullUpdate: Uint8Array
  readonly stateVector: StateVector
  readonly canonicalStateDigest: Digest
}

/**
 * Process-local proof that the Kernel already materialized and validated the
 * exact accepted state for one final frame. It is never encoded into a frame or
 * durable record, and persistence must discard it unless every binding matches
 * its currently verified durable base.
 */
export interface AcceptedHeadMaterializationEvidence {
  readonly format: "convax.accepted-head-materialization-evidence"
  readonly scope: DocumentScope
  readonly baseDurableHeadRecordDigest: Digest
  readonly baseMaterializedStateDigest: Digest
  readonly frameDigest: Digest
  readonly resultingFrontier: CausalFrontier
  readonly resultingFrontierDigest: Digest
  readonly resultingActorHeads: ReplicaActorHeadSet
  readonly resultingActorHeadsDigest: Digest
  readonly fullUpdate: Uint8Array
  readonly fullUpdateDigest: Digest
  readonly stateVector: StateVector
  readonly stateVectorDigest: Digest
  readonly canonicalStateDigest: Digest
  readonly evidenceDigest: Digest
}

export type OperationLookup =
  | { readonly status: "absent" }
  | { readonly status: "accepted"; readonly ref: FrameObjectRef; readonly bytes: Uint8Array }
  | { readonly status: "same-frame-recovery"; readonly ref: FrameObjectRef; readonly bytes: Uint8Array }
  | { readonly status: "object-only-recovery"; readonly ref: FrameObjectRef; readonly bytes: Uint8Array }
  | { readonly status: "equivocation"; readonly frameDigests: readonly Digest[] }

export interface ReferenceScanResult {
  readonly complete: boolean
  readonly reachable: boolean
}

export type KernelQuarantineReason = "equivocation" | "invalid-object" | "incomplete-durable-closure" | "below-head-unrecoverable"

export interface CollaborationPersistencePort {
  loadReplicaHead(scope: DocumentScope): Promise<unknown>
  /**
   * Optional native fast verification of the sole durable head. `verified` may
   * be returned only after checking the authoritative durable-head record and
   * proving that no below-head recovery or read-only disposition is pending.
   * Any uncertainty must return `reload-required`; the Kernel then uses the
   * full `loadReplicaHead` recovery path.
   */
  verifyReplicaHeadCurrent?(input: {
    readonly scope: DocumentScope
    readonly expectedHeadDigest: Digest
    readonly expectedFrontierDigest: Digest
  }): Promise<"verified" | "reload-required">
  putImmutableFrame(ref: FrameObjectRef, bytes: Readonly<Uint8Array>): Promise<void>
  putReplicationOutboxRef(ref: FrameObjectRef): Promise<void>
  appendFrameJournal(
    ref: FrameObjectRef,
    materialization?: AcceptedHeadMaterializationEvidence,
  ): Promise<JournalAppendPortEvidence>
  compareAndCommitReplicaHead(input: {
    readonly ref: FrameObjectRef
    readonly journal: JournalAppendPortEvidence
    readonly expectedReplicaHeadRecordDigest: Digest
    readonly resultingFrontierDigest: Digest
  }): Promise<CompareAndCommitReplicaHeadPortResult>
  isReachableFromAcceptedHead(ref: FrameObjectRef): Promise<boolean>
  lookupOperation(actorId: ActorId, operationId: Id128): Promise<OperationLookup>
  scanDurableReferences(frameDigest: Digest): Promise<ReferenceScanResult>
  quarantineExactObject(frameDigest: Digest, reason: KernelQuarantineReason): Promise<void>
}

export interface LocalFrameAuthority {
  readonly actorId: ActorId
  readonly actorSequence: Uint64
  readonly predecessorFrameDigest: Digest | null
  readonly signerAuthority: CausalSignerAuthority
  readonly dependencies: readonly CausalDependencyRef[]
  readonly validationArtifacts: ValidationArtifactSet
  readonly signer: ReplicaSignerPort
}

export interface LocalAuthorityPort {
  readonly actorId: ActorId
  prepareFinalFrameAuthority(input: {
    readonly scope: DocumentScope
    readonly operationId: Id128
    readonly baseFrontier: CausalFrontier
    /** Exact accepted head for this local actor; sequence is never allocated from wall time or Peer state. */
    readonly previousActorHead: CausalHeadRef | null
    readonly ownerSchemaDigest: Digest
  }): Promise<LocalFrameAuthority | "pending" | "rejected">
}

export interface IncomingAuthorityVerificationPort {
  verifyFrameAuthority(frame: DecodedCausalEditFrame): Promise<
    | { readonly replicaPublicKey: PublicKey }
    | "pending"
    | "rejected"
  >
}

export type IncomingOwnerFactResolution =
  | Readonly<{ status: "resolved"; port: OwnerExternalFactPort }>
  | Readonly<{ status: "pending" | "stale" }>
  | Readonly<{ status: "rejected" }>

/** Host-owned, attempt-scoped fact resolution after frame authority/base validation. */
export interface IncomingOwnerFactResolverPort {
  resolve(input: {
    readonly frame: DecodedCausalEditFrame
    readonly declaredDependencies: OwnerIntentDependencies<DocumentScope["docKind"]>
    readonly signal?: AbortSignal
  }): Promise<IncomingOwnerFactResolution>
}

export interface ExactReconstructedBase {
  readonly fullUpdate: Uint8Array
  readonly stateVector: StateVector
  readonly frontier: CausalFrontier
  readonly actorHeads: ReplicaActorHeadSet
  readonly canonicalStateDigest: Digest
}

export interface ExactBaseResolverPort {
  reconstructExactBase(frame: DecodedCausalEditFrame): Promise<ExactReconstructedBase | "pending" | "rejected">
}

export type PendingFrameReason = "missing-predecessor" | "missing-base" | "missing-proof" | "missing-artifact"

export interface PendingInboxPort {
  retainExactFrame(frame: DecodedCausalEditFrame, reason: PendingFrameReason): Promise<"retained" | "capacity-exceeded">
}

export interface CollaborationKernelPorts extends YjsDocumentFactory {
  readonly persistence: CollaborationPersistencePort
  readonly localAuthority: LocalAuthorityPort
  readonly incomingAuthority: IncomingAuthorityVerificationPort
  readonly incomingFacts: IncomingOwnerFactResolverPort
  readonly exactBaseResolver: ExactBaseResolverPort
  readonly causalClosure: CausalClosurePort
  readonly pendingInbox: PendingInboxPort
}

export interface ProjectionInvalidationPort {
  publish(input: { readonly scope: DocumentScope; readonly frameDigest: Digest }): void
}
