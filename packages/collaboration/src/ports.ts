import type { ActorIdV2, DigestV2, Id128V2, PublicKeyV2, StateVectorV2, Uint64V2 } from "./codecs"
import type {
  CausalDependencyRefV2,
  CausalFrontierV2,
  CausalHeadRefV2,
  CausalSignerAuthorityV2,
  DecodedCausalEditFrameV2,
  DocumentScopeV2,
  FrameObjectRefV2,
  OwnerExternalFactPortV2,
  OwnerIntentDependenciesV2,
  ReplicaActorHeadSetV2,
  ValidationArtifactSetV2,
} from "./contracts"
import type { ReplicaSignerPortV2 } from "./crypto"
import type { YjsDocumentFactoryV2 } from "./yjs-codec"
import type { CausalClosurePortV2 } from "./causal"
import type { CausalDependencyRefV3, DecodedCausalEditFrameV3 } from "./successor-frame"
import type { CausalSignerAuthorityV3 } from "./successor-authority"

export interface JournalAppendPortEvidenceV2 {
  readonly ref: FrameObjectRefV2
  readonly journalRecordDigest: DigestV2
}

export interface HeadCommitPortEvidenceV2 {
  readonly ref: FrameObjectRefV2
  readonly journalRecordDigest: DigestV2
  readonly expectedReplicaHeadRecordDigest: DigestV2
  readonly resultingReplicaHeadRecordDigest: DigestV2
  readonly resultingFrontierDigest: DigestV2
}

export interface HeadCommitQuarantinePortEvidenceV2 {
  readonly ref: FrameObjectRefV2
  readonly journalRecordDigest: DigestV2
  readonly expectedReplicaHeadRecordDigest: DigestV2
  readonly observedReplicaHeadRecordDigest: DigestV2
  readonly quarantineCommitRecordDigest: DigestV2
  readonly shardDispositionHeadRecordDigest: DigestV2
}

export type CompareAndCommitReplicaHeadPortResultV2 =
  | Readonly<{ status: "committed"; evidence: HeadCommitPortEvidenceV2 }>
  | Readonly<{ status: "quarantined"; evidence: HeadCommitQuarantinePortEvidenceV2 }>
  | Readonly<{ status: "rejected"; code: "durability-failed" | "store-corrupt" }>

export interface AcceptedHeadViewV2 {
  readonly scope: DocumentScopeV2
  readonly headDigest: DigestV2
  readonly frontier: CausalFrontierV2
  readonly frontierDigest: DigestV2
  readonly actorHeads: ReplicaActorHeadSetV2
  readonly fullUpdate: Uint8Array
  readonly stateVector: StateVectorV2
  readonly canonicalStateDigest: DigestV2
}

export type OperationLookupV2 =
  | { readonly status: "absent" }
  | { readonly status: "accepted"; readonly ref: FrameObjectRefV2; readonly bytes: Uint8Array }
  | { readonly status: "same-frame-recovery"; readonly ref: FrameObjectRefV2; readonly bytes: Uint8Array }
  | { readonly status: "object-only-recovery"; readonly ref: FrameObjectRefV2; readonly bytes: Uint8Array }
  | { readonly status: "equivocation"; readonly frameDigests: readonly DigestV2[] }

export interface ReferenceScanResultV2 {
  readonly complete: boolean
  readonly reachable: boolean
}

export type KernelQuarantineReasonV2 = "equivocation" | "invalid-object" | "incomplete-durable-closure" | "below-head-unrecoverable"

export interface CollaborationPersistencePortV2 {
  loadReplicaHead(scope: DocumentScopeV2): Promise<unknown>
  putImmutableFrame(ref: FrameObjectRefV2, bytes: Readonly<Uint8Array>): Promise<void>
  putReplicationOutboxRef(ref: FrameObjectRefV2): Promise<void>
  appendFrameJournal(ref: FrameObjectRefV2): Promise<JournalAppendPortEvidenceV2>
  compareAndCommitReplicaHead(input: {
    readonly ref: FrameObjectRefV2
    readonly journal: JournalAppendPortEvidenceV2
    readonly expectedReplicaHeadRecordDigest: DigestV2
    readonly resultingFrontierDigest: DigestV2
  }): Promise<CompareAndCommitReplicaHeadPortResultV2>
  isReachableFromAcceptedHead(ref: FrameObjectRefV2): Promise<boolean>
  lookupOperation(actorId: ActorIdV2, operationId: Id128V2): Promise<OperationLookupV2>
  scanDurableReferences(frameDigest: DigestV2): Promise<ReferenceScanResultV2>
  quarantineExactObject(frameDigest: DigestV2, reason: KernelQuarantineReasonV2): Promise<void>
}

export interface LocalFrameAuthorityV2 {
  readonly actorId: ActorIdV2
  readonly actorSequence: Uint64V2
  readonly predecessorFrameDigest: DigestV2 | null
  readonly signerAuthority: CausalSignerAuthorityV2
  readonly dependencies: readonly CausalDependencyRefV2[]
  readonly validationArtifacts: ValidationArtifactSetV2
  readonly signer: ReplicaSignerPortV2
}

export interface LocalAuthorityPortV2 {
  readonly actorId: ActorIdV2
  prepareFinalFrameAuthority(input: {
    readonly scope: DocumentScopeV2
    readonly operationId: Id128V2
    readonly baseFrontier: CausalFrontierV2
    /** Exact accepted head for this local actor; sequence is never allocated from wall time or Peer state. */
    readonly previousActorHead: CausalHeadRefV2 | null
    readonly ownerSchemaDigest: DigestV2
  }): Promise<LocalFrameAuthorityV2 | "pending" | "rejected">
}

export interface IncomingAuthorityVerificationPortV2 {
  verifyFrameAuthority(frame: DecodedCausalEditFrameV2): Promise<
    | { readonly replicaPublicKey: PublicKeyV2 }
    | "pending"
    | "rejected"
  >
}

export type IncomingOwnerFactResolutionV2 =
  | Readonly<{ status: "resolved"; port: OwnerExternalFactPortV2 }>
  | Readonly<{ status: "pending" | "stale" }>
  | Readonly<{ status: "rejected" }>

/** Host-owned, attempt-scoped fact resolution after frame authority/base validation. */
export interface IncomingOwnerFactResolverPortV2 {
  resolve(input: {
    readonly frame: DecodedCausalEditFrameV2
    readonly declaredDependencies: OwnerIntentDependenciesV2<DocumentScopeV2["docKind"]>
    readonly signal?: AbortSignal
  }): Promise<IncomingOwnerFactResolutionV2>
}

export interface ExactReconstructedBaseV2 {
  readonly fullUpdate: Uint8Array
  readonly stateVector: StateVectorV2
  readonly frontier: CausalFrontierV2
  readonly actorHeads: ReplicaActorHeadSetV2
  readonly canonicalStateDigest: DigestV2
}

export interface ExactBaseResolverPortV2 {
  reconstructExactBase(frame: DecodedCausalEditFrameV2): Promise<ExactReconstructedBaseV2 | "pending" | "rejected">
}

export type PendingFrameReasonV2 = "missing-predecessor" | "missing-base" | "missing-proof" | "missing-artifact"

export interface PendingInboxPortV2 {
  retainExactFrame(frame: DecodedCausalEditFrameV2, reason: PendingFrameReasonV2): Promise<"retained" | "capacity-exceeded">
}

export interface CollaborationKernelPortsV2 extends YjsDocumentFactoryV2 {
  readonly persistence: CollaborationPersistencePortV2
  readonly localAuthority: LocalAuthorityPortV2
  readonly incomingAuthority: IncomingAuthorityVerificationPortV2
  readonly incomingFacts: IncomingOwnerFactResolverPortV2
  readonly exactBaseResolver: ExactBaseResolverPortV2
  readonly causalClosure: CausalClosurePortV2
  readonly pendingInbox: PendingInboxPortV2
}

export interface ProjectionInvalidationPortV2 {
  publish(input: { readonly scope: DocumentScopeV2; readonly frameDigest: DigestV2 }): void
}

/**
 * Successor ports deliberately reuse the stable Project-native durability shapes
 * while keeping V3 frames and signer evidence out of the V2 kernel surface.
 * These interfaces are non-activating until a verified V11 release selects them.
 */
export interface LocalFrameAuthorityV3 {
  readonly actorId: ActorIdV2
  readonly actorSequence: Uint64V2
  /** The first V3 frame names an installed signed bridge; it is never null. */
  readonly predecessorFrameDigest: DigestV2
  readonly signerAuthority: CausalSignerAuthorityV3
  readonly dependencies: readonly CausalDependencyRefV3[]
  readonly validationArtifacts: ValidationArtifactSetV2
  readonly signer: ReplicaSignerPortV2
}

export interface LocalAuthorityPortV3 {
  readonly actorId: ActorIdV2
  prepareFinalFrameAuthority(input: {
    readonly scope: DocumentScopeV2
    readonly operationId: Id128V2
    readonly baseFrontier: CausalFrontierV2
    readonly previousActorHead: CausalHeadRefV2 | null
    readonly ownerSchemaDigest: DigestV2
  }): Promise<LocalFrameAuthorityV3 | "pending" | "rejected">
}

export interface IncomingAuthorityVerificationPortV3 {
  verifyFrameAuthority(frame: DecodedCausalEditFrameV3): Promise<
    | { readonly replicaPublicKey: PublicKeyV2 }
    | "pending"
    | "rejected"
  >
}

export interface IncomingOwnerFactResolverPortV3 {
  resolve(input: {
    readonly frame: DecodedCausalEditFrameV3
    readonly declaredDependencies: OwnerIntentDependenciesV2<DocumentScopeV2["docKind"]>
    readonly signal?: AbortSignal
  }): Promise<IncomingOwnerFactResolutionV2>
}

export interface ExactBaseResolverPortV3 {
  reconstructExactBase(frame: DecodedCausalEditFrameV3): Promise<ExactReconstructedBaseV2 | "pending" | "rejected">
}

export interface PendingInboxPortV3 {
  retainExactFrame(frame: DecodedCausalEditFrameV3, reason: PendingFrameReasonV2): Promise<"retained" | "capacity-exceeded">
}

export interface CollaborationKernelPortsV3 extends YjsDocumentFactoryV2 {
  readonly persistence: CollaborationPersistencePortV2
  readonly localAuthority: LocalAuthorityPortV3
  readonly incomingAuthority: IncomingAuthorityVerificationPortV3
  readonly incomingFacts: IncomingOwnerFactResolverPortV3
  readonly exactBaseResolver: ExactBaseResolverPortV3
  readonly causalClosure: CausalClosurePortV2
  readonly pendingInbox: PendingInboxPortV3
}
