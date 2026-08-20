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

export const ACCEPTED_FRAME_OUTBOX_REQUIREMENT = "replicate-exact-frame-until-acknowledged" as const

/** Exact logical head identity; it intentionally carries no checkpoint bytes. */
export interface AcceptedHeadIdentityView {
  readonly scope: DocumentScope
  readonly headDigest: Digest
  readonly frontier: CausalFrontier
  readonly frontierDigest: Digest
  readonly actorHeads: ReplicaActorHeadSet
  readonly stateVector: StateVector
  readonly canonicalStateDigest: Digest
  /** Logical delta-chain identity; checkpoint materialization never changes it. */
  readonly materializationDigest: Digest
}

/** Cold load/recovery view: logical identity plus one materialized checkpoint. */
export interface AcceptedHeadView extends AcceptedHeadIdentityView {
  readonly fullUpdate: Uint8Array
}

/**
 * Process-local proof that the Kernel already materialized and validated the
 * exact accepted state for one final frame. It is never encoded into a frame or
 * durable record, and persistence must discard it unless every binding matches
 * its currently verified durable base.
 */
declare const acceptedHeadMaterializationEvidenceBrand: unique symbol

export interface AcceptedHeadMaterializationEvidence {
  readonly format: "convax.accepted-head-durable-delta-metadata"
  readonly scope: DocumentScope
  readonly protocolDigest: Digest
  readonly baseDurableHeadRecordDigest: Digest
  readonly baseMaterializationDigest: Digest
  readonly frameDigest: Digest
  readonly yjsUpdateDigest: Digest
  readonly resultingFrontierDigest: Digest
  readonly resultingActorHeadsDigest: Digest
  readonly stateVectorDigest: Digest
  readonly canonicalStateDigest: Digest
  readonly resultingMaterializationDigest: Digest
  readonly work: Readonly<{
    readonly fullUpdateEncodes: 0
    readonly historicalBytesVisited: 0
    readonly candidateFullClones: 0 | 1
  }>
  readonly [acceptedHeadMaterializationEvidenceBrand]: true
}

/**
 * Closed serializable metadata projected from a live accepted-head proof. This
 * is the only accepted-head delta shape that a WAL/capsule may persist. It is
 * data, never authority: cold recovery must replay the exact signed frame and
 * compare every resulting field before admitting it.
 */
export interface AcceptedHeadDurableDeltaMetadata {
  readonly format: "convax.accepted-head-durable-delta-metadata"
  readonly scope: DocumentScope
  readonly protocolDigest: Digest
  readonly baseDurableHeadRecordDigest: Digest
  readonly baseMaterializationDigest: Digest
  readonly frameDigest: Digest
  readonly yjsUpdateDigest: Digest
  readonly resultingFrontier: CausalFrontier
  readonly resultingFrontierDigest: Digest
  readonly resultingActorHeads: ReplicaActorHeadSet
  readonly resultingActorHeadsDigest: Digest
  readonly stateVector: StateVector
  readonly stateVectorDigest: Digest
  readonly canonicalStateDigest: Digest
  readonly resultingMaterializationDigest: Digest
}

/** Metadata-only next head returned by private evidence validation. */
export interface AcceptedHeadTransitionView {
  readonly scope: DocumentScope
  readonly frontier: CausalFrontier
  readonly frontierDigest: Digest
  readonly actorHeads: ReplicaActorHeadSet
  readonly stateVector: StateVector
  readonly canonicalStateDigest: Digest
  readonly materializationDigest: Digest
}

/** Result of consuming a live issuer-bound proof against one exact base. */
export interface ValidatedAcceptedHeadTransition {
  readonly transition: AcceptedHeadTransitionView
  readonly durableDelta: AcceptedHeadDurableDeltaMetadata
}

export interface AcceptedHeadDeltaChainEntry {
  readonly ref: FrameObjectRef
  readonly exactFrameBytes: Readonly<Uint8Array>
  readonly durableDelta: AcceptedHeadDurableDeltaMetadata
}

export interface AcceptedHeadCheckpointMaterializationRequest {
  readonly scope: DocumentScope
  readonly baseDurableHeadRecordDigest: Digest
  readonly baseMaterializationDigest: Digest
  readonly baseFullUpdate: Readonly<Uint8Array>
  readonly entries: readonly AcceptedHeadDeltaChainEntry[]
  readonly targetMaterializationDigest: Digest
}

export type AcceptedHeadCheckpointMaterializationResult =
  | Readonly<{
      readonly status: "materialized"
      readonly fullUpdate: Readonly<Uint8Array>
      readonly stateVector: StateVector
      readonly canonicalStateDigest: Digest
      readonly materializationDigest: Digest
    }>
  | Readonly<{
      readonly status: "rejected"
      readonly code: "chain-invalid" | "owner-state-invalid" | "materialization-failed"
    }>

/** Project/native seam required before the current full-update head can become a delta chain. */
export interface AcceptedHeadCheckpointMaterializationPort {
  materializeAcceptedHeadCheckpoint(
    request: AcceptedHeadCheckpointMaterializationRequest,
  ): Promise<AcceptedHeadCheckpointMaterializationResult>
}

/** One owner-agnostic, single-shard durable acceptance request. */
export interface CommitAcceptedFramePortRequest {
  readonly ref: FrameObjectRef
  readonly exactFrameBytes: Readonly<Uint8Array>
  readonly expectedHead: AcceptedHeadIdentityView
  /** Process-local authorization; adapters must never encode or persist it. */
  readonly accepted: AcceptedHeadMaterializationEvidence
  readonly outboxRequirement: typeof ACCEPTED_FRAME_OUTBOX_REQUIREMENT
}

export interface AcceptedFrameAtomicCommitPortEvidence {
  readonly format: "convax.accepted-frame-atomic-commit-evidence"
  readonly ref: FrameObjectRef
  readonly frameRecordDigest: Digest
  readonly outboxRecordDigest: Digest
  readonly journalRecordDigest: Digest
  readonly expectedReplicaHeadRecordDigest: Digest
  readonly resultingReplicaHeadRecordDigest: Digest
  readonly resultingFrontierDigest: Digest
  readonly resultingMaterializationDigest: Digest
  readonly atomicCommitRecordDigest: Digest
}

export interface AcceptedFrameAtomicQuarantinePortEvidence {
  readonly format: "convax.accepted-frame-atomic-quarantine-evidence"
  readonly ref: FrameObjectRef
  readonly expectedReplicaHeadRecordDigest: Digest
  readonly observedReplicaHeadRecordDigest: Digest
  readonly quarantinedFrameRecordDigest: Digest
  readonly quarantineCommitRecordDigest: Digest
  readonly shardDispositionHeadRecordDigest: Digest
  readonly atomicCommitRecordDigest: Digest
}

export type CommitAcceptedFramePortResult =
  | Readonly<{ status: "committed"; evidence: AcceptedFrameAtomicCommitPortEvidence }>
  | Readonly<{ status: "quarantined"; evidence: AcceptedFrameAtomicQuarantinePortEvidence }>
  | Readonly<{ status: "rejected"; code: "durability-failed" | "store-corrupt" }>

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
  /**
   * Atomically installs the exact frame object, required replication outbox
   * entry, durable delta metadata, journal entry, and sole shard head.
   *
   * A committed record is idempotent by the exact request. Once its complete
   * record has been fsynced, response loss, cache loss, or observer failure must
   * still resolve the call/retry to the same committed evidence. `rejected`
   * means no partially successful accepted state is externally observable.
   */
  commitAcceptedFrame(request: CommitAcceptedFramePortRequest): Promise<CommitAcceptedFramePortResult>
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
