import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import type {
  ActorId,
  AcceptedHeadDurableDeltaMetadata,
  AcceptedHeadMaterializationEvidence,
  AcceptedHeadIdentityView,
  AcceptedHeadTransitionView,
  CommitAcceptedFramePortRequest,
  CommitAcceptedFramePortResult,
  CausalFrontier,
  CollaborationPersistencePort,
  DecodedCausalEditFrame,
  Digest,
  DocumentScope,
  FrameObjectRef,
  Id128,
  KernelQuarantineReason,
  MemberId,
  OperationLookup,
  PendingFrameReason,
  PendingInboxPort,
  ReplicaActorHeadSet,
  ReplicaId,
  StateVector,
} from "@convax/collaboration"
import {
  ACCEPTED_FRAME_OUTBOX_REQUIREMENT,
  frameObjectRefFromDecodedFrame,
  parseAcceptedHeadDurableDeltaMetadata,
  parseActorId,
  parseDigest,
  parseMemberId,
  parseReplicaId,
  parseUint64,
  validateAcceptedHeadMaterializationEvidence,
} from "@convax/collaboration"
import {
  assertImmediatePredecessorCheckpointMaterializesHead,
  createImmediatePredecessorReplaySession,
  verifyImmediatePredecessorCheckpoint,
  type ImmediatePredecessorCheckpointSignatureVerifier,
  type ImmediatePredecessorOwnerProjectionPort,
  type ImmediatePredecessorSignatureVerifier,
} from "@convax/collaboration/migration"
import {
  appendAcceptedFrameWalRecord,
  createAcceptedFrameWalFile,
  describeAcceptedFrameWalRecord,
  encodeAcceptedFrameWalHeader,
  encodeAcceptedFrameWalRecord,
  readAcceptedFrameWalBytes,
  scanAcceptedFrameWalFile,
  type AcceptedFrameWalFileEntry,
} from "./accepted-frame-wal-file"
import {
  deriveDocumentNativeKey,
  deriveJournalSegmentNativeKey,
  deriveObjectNativeKey,
} from "./native-store-keys"
import { fsyncProjectDirectory } from "./directory-durability"

const LOCAL_RECORD_DOMAIN = Buffer.from("convax.local-project-store-record-digest\0", "utf8")
const OPERATION_INDEX_DOMAIN = Buffer.from("convax.local-operation-index-key\0", "utf8")
const ORDINARY_SHA256 = /^[0-9a-f]{64}$/u
const MAX_FRAME_BYTES = 2 * 1024 * 1024
const MAX_GENESIS_PROOF_BYTES = 335_544_320
const MAX_OUTBOX_FRAMES = 4_096
const MAX_OUTBOX_BYTES = 512 * 1024 * 1024
const BASE_MAGIC = Buffer.from("CVXBASE3", "ascii")
const BASE_PREFIX_BYTES = 60
const PENDING_MAGIC = Buffer.from("CVXPEND2", "ascii")
const IMMEDIATE_PREDECESSOR_BASE_MAGIC = Buffer.from("CVXBASE2", "ascii")
const PENDING_PREFIX_BYTES = 44
const MAX_PENDING_DOCUMENT_FRAMES = 4_096
const MAX_PENDING_DOCUMENT_BYTES = 256 * 1024 * 1024
const MAX_PENDING_ACTOR_FRAMES = 512
const MAX_PENDING_ACTOR_BYTES = 32 * 1024 * 1024

interface JournalAppendPortEvidence {
  readonly ref: FrameObjectRef
  readonly journalRecordDigest: Digest
}

type CompareAndCommitReplicaHeadPortResult =
  | Readonly<{ status: "committed"; evidence: Readonly<{
      ref: FrameObjectRef
      journalRecordDigest: Digest
      expectedReplicaHeadRecordDigest: Digest
      resultingReplicaHeadRecordDigest: Digest
      resultingFrontierDigest: Digest
    }> }>
  | Readonly<{ status: "quarantined"; evidence: Readonly<{
      ref: FrameObjectRef
      journalRecordDigest: Digest
      expectedReplicaHeadRecordDigest: Digest
      observedReplicaHeadRecordDigest: Digest
      quarantineCommitRecordDigest: Digest
      shardDispositionHeadRecordDigest: Digest
    }> }>
  | Readonly<{ status: "rejected"; code: "durability-failed" | "store-corrupt" }>

export interface NodeAcceptedReplicaHead {
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

export interface NodeInspectedFrame {
  readonly ref: FrameObjectRef
  readonly requiredBlobDigests: readonly Digest[]
}

export interface NodeDurableReplicationOutboxEntry {
  readonly ref: FrameObjectRef
  readonly exactFrameBytes: Uint8Array
  readonly requiredBlobDigests: readonly Digest[]
}

export interface NodeAcceptedFrameObject {
  readonly ref: FrameObjectRef
  readonly exactFrameBytes: Uint8Array
  /** Persisted Collaboration-owned delta metadata; current WAL frames always provide it. */
  readonly durableDelta: unknown
}

export interface NodeVerifiedReplicaDurableAck {
  readonly scope: DocumentScope
  readonly frameDigest: Digest
  readonly receiverMemberId: MemberId
  readonly receiverReplicaId: ReplicaId
  readonly receiverActorId: ActorId
  readonly receiverAuthorizationDigest: Digest
  readonly ackCoreDigest: Digest
  readonly exactAckBytes: Readonly<Uint8Array>
}

export interface NodeReplicaDurableAckVerifier {
  /** Verifies the exact long-lived replica signature and current credential binding. */
  verifyCurrent(input: NodeVerifiedReplicaDurableAck): Promise<boolean>
}

/**
 * Portable frame parsing, causal frontier construction and owner projection remain
 * in @convax/collaboration. Project/node receives this explicit headless port and
 * owns only native durability/recovery.
 */
export interface NodeReplicaHeadMaterializer {
  inspectFrame(ref: FrameObjectRef, exactBytes: Readonly<Uint8Array>): Promise<NodeInspectedFrame>
  applyAcceptedFrame(input: {
    readonly previous: NodeAcceptedReplicaHead
    readonly ref: FrameObjectRef
    readonly exactBytes: Readonly<Uint8Array>
    readonly durableDelta: unknown
  }): Promise<NodeAcceptedReplicaHead>
  /** Updates disposable causal lookup state only after the frame is reachable from the durable head. */
  observeAcceptedFrame?(
    ref: FrameObjectRef,
    exactBytes: Readonly<Uint8Array>,
    durableDelta: unknown,
  ): void
  /** Reconstructs the exact portable checkpoint payload without consulting native metadata order. */
  materializeCheckpoint?(input: {
    readonly scope: DocumentScope
    readonly checkpointObjectDigest: Digest
    readonly exactCheckpointBytes: Readonly<Uint8Array>
  }): Promise<Omit<NodeAcceptedReplicaHead, "headDigest">>
  actorHeadsDigest(actorHeads: ReplicaActorHeadSet): Digest
}

export interface NodeImmutableCheckpointObject {
  readonly objectDigest: Digest
  readonly exactBytes: Readonly<Uint8Array>
}

export interface NodeCheckpointInstallationVerifier {
  /**
   * Verifies current content/prunable certificates, schema/artifact bindings,
   * parents and the complete local causal closure. Native persistence never
   * interprets portable certificate bytes on its own.
   */
  verifyCurrent(input: {
    readonly scope: DocumentScope
    readonly currentAcceptedHead: NodeAcceptedReplicaHead
    readonly bootstrapCheckpointObjectDigest: Digest
    readonly checkpointObjects: readonly NodeImmutableCheckpointObject[]
    readonly contentCertificateObjects: readonly NodeImmutableCheckpointObject[]
    readonly prunableSetCertificateObjects: readonly NodeImmutableCheckpointObject[]
  }): Promise<boolean>
}

export interface InstallNativeCheckpointSet {
  readonly scope: DocumentScope
  readonly expectedReplicaHeadRecordDigest: Digest
  readonly bootstrapCheckpointObjectDigest: Digest
  readonly checkpointObjects: readonly NodeImmutableCheckpointObject[]
  readonly contentCertificateObjects: readonly NodeImmutableCheckpointObject[]
  readonly prunableSetCertificateObjects: readonly NodeImmutableCheckpointObject[]
}

export type InstallNativeCheckpointSetResult =
  | Readonly<{
      status: "committed"
      installedCheckpointSetDigest: Digest
      journalRecordDigest: Digest
      resultingReplicaHeadRecordDigest: Digest
    }>
  | Readonly<{ status: "rejected"; code: "head-stale" | "verification-failed" | "durability-failed" | "store-corrupt" }>

export type NodePrunableObjectKind = "frame" | "checkpoint"

export interface NodePrunableObject {
  readonly kind: NodePrunableObjectKind
  readonly objectDigest: Digest
  readonly exactByteLength: string
}

export interface NodeCheckpointPruneRootScan {
  readonly complete: boolean
  readonly rootSetDigest: Digest
  readonly retainedObjectDigests: readonly Digest[]
}

export interface NodeCheckpointPruneRootScanner {
  scanComplete(input: {
    readonly scope: DocumentScope
    readonly durableHeadRecordDigest: Digest
    readonly installedCheckpointSetDigest: Digest
  }): Promise<NodeCheckpointPruneRootScan>
}

export interface NodeCheckpointPruneAuthority {
  verifyCurrent(input: {
    readonly scope: DocumentScope
    readonly durableHeadRecordDigest: Digest
    readonly installedCheckpointSetDigest: Digest
    readonly prunableSetCertificateObjectDigest: Digest
    readonly causalFloorObjectDigest: Digest
    readonly causalFloorExactBytes: Readonly<Uint8Array>
    readonly retainedRootSetDigest: Digest
    readonly candidateDeleteObjects: readonly NodePrunableObject[]
  }): Promise<Readonly<{ verified: false }> | Readonly<{
    verified: true
    expectedPostBarrierRootSetDigest: Digest
  }>>
}

export interface PruneNativeCheckpointHistory {
  readonly scope: DocumentScope
  readonly expectedReplicaHeadRecordDigest: Digest
  readonly prunableSetCertificateObjectDigest: Digest
  readonly causalFloorObjectDigest: Digest
  readonly causalFloorExactBytes: Readonly<Uint8Array>
  readonly candidateDeleteObjects: readonly NodePrunableObject[]
}

export type PruneNativeCheckpointHistoryResult = Readonly<{
  status: "deleted" | "postponed" | "rejected"
  code?: "head-stale" | "roots-changed" | "verification-failed" | "capacity-exceeded" | "durability-failed" | "store-corrupt"
  deletedObjectCount: number
  prunePlanDigest?: Digest
}>

export interface InitializeNativeCollaborationShard {
  readonly scope: DocumentScope
  readonly checkpointObjectDigest: Digest
  readonly checkpointExactBytes: Readonly<Uint8Array>
  readonly acceptedBase: Omit<NodeAcceptedReplicaHead, "headDigest">
}

export interface InitializeNativeCollaborationShardWithGenesisProof
  extends InitializeNativeCollaborationShard {
  /** Exact verified current Canvas genesis carrier, keyed locally by checkpoint object digest G. */
  readonly proofCarrierExactBytes: Readonly<Uint8Array>
}

export interface NodeCollaborationPersistenceFaultHooks {
  afterGenesisStagingFsync?(): Promise<void>
  afterFrameFileFsync?(): Promise<void>
  afterOutboxFileFsync?(): Promise<void>
  afterJournalFileFsync?(): Promise<void>
  afterHeadTempFsync?(): Promise<void>
  afterHeadRename?(): Promise<void>
  afterHeadDirectoryFsync?(): Promise<void>
  beforeHeadCacheInstall?(): Promise<void>
  beforeAcceptedFrameWalSync?(): Promise<void>
  afterAcceptedFrameWalSync?(): Promise<void>
  beforeAtomicOperationIndexInstall?(): Promise<void>
  beforeAtomicHeadCacheInstall?(): Promise<void>
}

export interface NodeImmediatePredecessorReadOnlyStore {
  listDocumentScopes(): Promise<readonly DocumentScope[]>
  loadReplicaHead(scope: DocumentScope): Promise<NodeAcceptedReplicaHead>
  dispose(): void
}

interface ImmediatePredecessorNodeReplicaHeadMaterializer extends NodeReplicaHeadMaterializer {
  validateImmediatePredecessorBase(input: {
    readonly head: NodeAcceptedReplicaHead
    readonly checkpointObjectDigest: Digest
    readonly exactCheckpointBytes: Uint8Array
  }): Promise<void>
  verifyImmediatePredecessorCheckpoint(input: {
    readonly scope: DocumentScope
    readonly checkpointObjectDigest: Digest
    readonly exactCheckpointBytes: Uint8Array
  }): Promise<void>
}

const IMMEDIATE_PREDECESSOR_READER_CAPABILITY = Object.freeze({})

/**
 * Sealed package-owned entrypoint for the one public predecessor. It exposes
 * only verified materialized heads and never the old native codec or a writer.
 */
export async function openImmediatePredecessorCollaborationStoreReadOnly(input: {
  readonly collaborationDirectory: string
  readonly localActorId: ActorId
  readonly signatures: ImmediatePredecessorSignatureVerifier & ImmediatePredecessorCheckpointSignatureVerifier
  readonly owner: ImmediatePredecessorOwnerProjectionPort
}): Promise<NodeImmediatePredecessorReadOnlyStore> {
  const replay = createImmediatePredecessorReplaySession({
    signatures: input.signatures,
    owner: input.owner,
  })
  const materializer: ImmediatePredecessorNodeReplicaHeadMaterializer = Object.freeze({
    async inspectFrame(ref: FrameObjectRef, exactBytes: Readonly<Uint8Array>) {
      await replay.inspectFrame(ref, new Uint8Array(exactBytes))
      return Object.freeze({ ref, requiredBlobDigests: Object.freeze([]) })
    },
    async applyAcceptedFrame({ previous, ref, exactBytes }: Parameters<NodeReplicaHeadMaterializer["applyAcceptedFrame"]>[0]) {
      return replay.applyFrame({ previous, ref, exactBytes: new Uint8Array(exactBytes) })
    },
    actorHeadsDigest: replay.actorHeadsDigest,
    async validateImmediatePredecessorBase(value: Parameters<ImmediatePredecessorNodeReplicaHeadMaterializer["validateImmediatePredecessorBase"]>[0]) {
      const verified = await verifyImmediatePredecessorCheckpoint(
        value.exactCheckpointBytes,
        input.signatures,
      )
      if (verified.checkpointObjectDigest !== value.checkpointObjectDigest) {
        corrupt("Immediate-predecessor bootstrap checkpoint object digest mismatches")
      }
      assertImmediatePredecessorCheckpointMaterializesHead(verified, value.head)
      replay.validateBase(value.head)
    },
    async verifyImmediatePredecessorCheckpoint(value: Parameters<ImmediatePredecessorNodeReplicaHeadMaterializer["verifyImmediatePredecessorCheckpoint"]>[0]) {
      const verified = await verifyImmediatePredecessorCheckpoint(
        value.exactCheckpointBytes,
        input.signatures,
      )
      if (
        verified.checkpointObjectDigest !== value.checkpointObjectDigest ||
        restrictedJcs(verified.checkpoint.core.scope) !== restrictedJcs(value.scope)
      ) corrupt("Immediate-predecessor checkpoint object binding mismatches")
    },
  })
  const store = await NodeCollaborationPersistence.openImmediatePredecessorReadOnly({
    collaborationDirectory: input.collaborationDirectory,
    localActorId: input.localActorId,
    materializer,
  }, IMMEDIATE_PREDECESSOR_READER_CAPABILITY)
  return Object.freeze({
    listDocumentScopes: () => store.listImmediatePredecessorDocumentScopes(),
    async loadReplicaHead(scope: DocumentScope) {
      return store.loadReplicaHead(scope) as Promise<NodeAcceptedReplicaHead>
    },
    dispose: () => store.dispose(),
  })
}

export type NodeDurabilityBarrierKind = "directory-sync" | "file-sync"
export type NodeLocalCommitDurabilityStage = "accepted-frame-wal" | "head" | "journal" | "object-frame" | "object-operation-sidecar" | "outbox"

export interface NodeLocalCommitDurabilityMeasurement {
  readonly attemptId: string
  readonly barrierKind: NodeDurabilityBarrierKind
  readonly callCount: number
  readonly durationNanoseconds: bigint
  readonly operationId: Id128
  readonly outcome: "failed" | "succeeded"
  readonly stage: NodeLocalCommitDurabilityStage
}

export interface NodeLocalCommitDurabilityDiagnostics {
  /** Returns the benchmark-owned root attempt. Undefined excludes this call from sampling. */
  readonly currentAttemptId: (ref: FrameObjectRef) => string | undefined
  readonly observe: (measurement: Readonly<NodeLocalCommitDurabilityMeasurement>) => void
  /** Optional local-only profiling. Values contain timing and bounded enum labels only. */
  readonly observeLocalStep?: (measurement: Readonly<NodeLocalCommitStepMeasurement>) => void
}

export type NodeLocalCommitStep =
  | "trust"
  | "lstat"
  | "open-write-close"
  | "read"
  | "decode-JCS"
  | "inspect"
  | "capacity"
  | "encode"
  | "rename"
  | "cache"

export interface NodeLocalCommitStepMeasurement {
  readonly attemptId: string
  readonly durationNanoseconds: bigint
  readonly operationId: Id128
  readonly outcome: "failed" | "succeeded"
  readonly stage: "atomic" | "object" | "outbox" | "journal" | "head"
  readonly step: NodeLocalCommitStep
}

interface DurabilityMeasurementContext {
  readonly attemptId: string
  readonly operationId: Id128
  readonly stage: NodeLocalCommitDurabilityStage
}

export type NodeCollaborationPersistenceErrorCode =
  | "aborted"
  | "document-already-exists"
  | "document-not-found"
  | "durability-failed"
  | "invalid-input"
  | "outbox-backpressure"
  | "project-writer-already-open"
  | "read-only-recovery-required"
  | "store-corrupt"

export class NodeCollaborationPersistenceError extends Error {
  constructor(
    readonly code: NodeCollaborationPersistenceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "NodeCollaborationPersistenceError"
  }
}

interface LocalReplicationOutboxRef {
  readonly format: "convax.local-replication-outbox-ref"
  readonly scope: DocumentScope
  readonly frameDigest: Digest
  readonly actorId: ActorId
  readonly actorSequence: string
  readonly operationId: Id128
  readonly requiredBlobDigests: readonly Digest[]
}

interface LocalJournalRecord {
  readonly format: "convax.local-journal-record"
  readonly scope: DocumentScope
  readonly localRecordSequence: string
  readonly priorJournalRecordDigest: Digest | null
  readonly transition: "accept-local-frame" | "accept-remote-frame" | "install-checkpoint-set" | "record-durable-ack" | "start-prunable-journal-base"
  readonly objectDigests: readonly Digest[]
  readonly outboxRefDigest: Digest | null
  readonly resultingFrontierDigest: Digest
  readonly operationRef: { readonly actorId: ActorId; readonly operationId: Id128 } | null
}

interface LocalReplicaDurableAckRecord {
  readonly format: "convax.local-replica-durable-ack"
  readonly scope: DocumentScope
  readonly frameDigest: Digest
  readonly receiverMemberId: MemberId
  readonly receiverReplicaId: ReplicaId
  readonly receiverActorId: ActorId
  readonly receiverAuthorizationDigest: Digest
  readonly ackCoreDigest: Digest
  readonly exactAckSha256: Digest
  readonly exactAckByteLength: string
  readonly exactAckBase64: string
}

interface LocalDurableHead {
  readonly format: "convax.local-durable-head"
  readonly scope: DocumentScope
  readonly localHeadGeneration: string
  readonly priorHeadDigest: Digest | null
  readonly journalBaseDigest: Digest
  readonly journalTailDigest: Digest
  readonly installedCheckpointSetDigest: Digest
  readonly acceptedFrontierDigest: Digest
  readonly acceptedActorHeadsDigest: Digest
}

interface LocalInstalledCheckpointSet {
  readonly format: "convax.local-installed-checkpoint-set"
  readonly scope: DocumentScope
  readonly checkpointObjectDigests: readonly Digest[]
  readonly bootstrapCheckpointObjectDigest: Digest
  readonly contentCertificateObjectDigests: readonly Digest[]
  readonly prunableSetCertificateObjectDigests: readonly Digest[]
}

interface LocalJournalBaseRecord {
  readonly format: "convax.local-journal-base"
  readonly scope: DocumentScope
  readonly baseLocalRecordSequence: string
  readonly checkpointObjectDigest: Digest
  readonly installedCheckpointSetDigest: Digest
  readonly frontier: CausalFrontier
  readonly frontierDigest: Digest
  readonly actorHeads: ReplicaActorHeadSet
  readonly actorHeadsDigest: Digest
  readonly canonicalStateDigest: Digest
  readonly materializationDigest: Digest
  readonly fullUpdateDigest: Digest
  readonly fullUpdateByteLength: string
  readonly stateVectorDigest: Digest
  readonly stateVectorByteLength: string
}

type ImmediatePredecessorLocalJournalBaseRecord = Omit<LocalJournalBaseRecord, "materializationDigest">

interface LocalAcceptedFrameWalHeader {
  readonly format: "convax.local-accepted-frame-wal-header"
  readonly layout: "single-file-accepted-frame-log-v1"
  readonly scope: DocumentScope
  readonly baseReplicaHeadRecordDigest: Digest
  readonly baseLocalHeadGeneration: string
  readonly baseJournalTailDigest: Digest
  readonly baseMaterializationDigest: Digest
  readonly outboxRequirement: typeof ACCEPTED_FRAME_OUTBOX_REQUIREMENT
}

interface LocalAcceptedFrameWalDurableDelta {
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
  readonly stateVectorDigest: Digest
  readonly stateVectorByteLength: string
  readonly canonicalStateDigest: Digest
  readonly resultingMaterializationDigest: Digest
}

interface LocalAcceptedFrameWalRecordCore {
  readonly format: "convax.local-accepted-frame-wal-record-core"
  readonly scope: DocumentScope
  readonly sequence: string
  readonly priorAtomicCommitRecordDigest: Digest | null
  readonly ref: FrameObjectRef
  readonly exactFrameSha256: Digest
  readonly exactFrameByteLength: string
  readonly durableDelta: LocalAcceptedFrameWalDurableDelta
  readonly frameRecordDigest: Digest
  readonly outboxRecord: LocalReplicationOutboxRef
  readonly outboxRecordDigest: Digest
  readonly journalRecord: LocalJournalRecord
  readonly journalRecordDigest: Digest
  readonly expectedReplicaHeadRecordDigest: Digest
  readonly resultingHeadRecord: LocalDurableHead
  readonly resultingReplicaHeadRecordDigest: Digest
}

interface LocalAcceptedFrameWalRecord {
  readonly format: "convax.local-accepted-frame-wal-record"
  readonly core: LocalAcceptedFrameWalRecordCore
  readonly atomicCommitRecordDigest: Digest
}

interface LocalAcceptedFrameWalAckRecordCore {
  readonly format: "convax.local-accepted-frame-wal-ack-record-core"
  readonly scope: DocumentScope
  readonly sequence: string
  readonly priorAtomicCommitRecordDigest: Digest | null
  readonly ackRecord: LocalReplicaDurableAckRecord
  readonly journalRecord: LocalJournalRecord
  readonly journalRecordDigest: Digest
  readonly expectedReplicaHeadRecordDigest: Digest
  readonly resultingHeadRecord: LocalDurableHead
  readonly resultingReplicaHeadRecordDigest: Digest
}

interface LocalAcceptedFrameWalAckRecord {
  readonly format: "convax.local-accepted-frame-wal-ack-record"
  readonly core: LocalAcceptedFrameWalAckRecordCore
  readonly atomicCommitRecordDigest: Digest
}

interface LocalAcceptedFrameWalCheckpointRecordCore {
  readonly format: "convax.local-accepted-frame-wal-checkpoint-record-core"
  readonly scope: DocumentScope
  readonly sequence: string
  readonly priorAtomicCommitRecordDigest: Digest | null
  readonly installedCheckpointSetDigest: Digest
  readonly journalRecord: LocalJournalRecord
  readonly journalRecordDigest: Digest
  readonly expectedReplicaHeadRecordDigest: Digest
  readonly resultingHeadRecord: LocalDurableHead
  readonly resultingReplicaHeadRecordDigest: Digest
}

interface LocalAcceptedFrameWalCheckpointRecord {
  readonly format: "convax.local-accepted-frame-wal-checkpoint-record"
  readonly core: LocalAcceptedFrameWalCheckpointRecordCore
  readonly atomicCommitRecordDigest: Digest
}

interface LocalAcceptedFrameWalPruneRecordCore {
  readonly format: "convax.local-accepted-frame-wal-prune-record-core"
  readonly scope: DocumentScope
  readonly sequence: string
  readonly priorAtomicCommitRecordDigest: Digest | null
  readonly prunePlanDigest: Digest
  readonly journalBaseDigest: Digest
  readonly journalRecord: LocalJournalRecord
  readonly journalRecordDigest: Digest
  readonly expectedReplicaHeadRecordDigest: Digest
  readonly resultingHeadRecord: LocalDurableHead
  readonly resultingReplicaHeadRecordDigest: Digest
}

interface LocalAcceptedFrameWalPruneRecord {
  readonly format: "convax.local-accepted-frame-wal-prune-record"
  readonly core: LocalAcceptedFrameWalPruneRecordCore
  readonly atomicCommitRecordDigest: Digest
}

interface AcceptedFrameWalEntry {
  readonly file: AcceptedFrameWalFileEntry
  readonly record: LocalAcceptedFrameWalRecord
  readonly durableDelta: AcceptedHeadDurableDeltaMetadata
}

interface AcceptedFrameWalAckEntry {
  readonly file: AcceptedFrameWalFileEntry
  readonly record: LocalAcceptedFrameWalAckRecord
}

interface AcceptedFrameWalCheckpointEntry {
  readonly file: AcceptedFrameWalFileEntry
  readonly record: LocalAcceptedFrameWalCheckpointRecord
}

interface AcceptedFrameWalPruneEntry {
  readonly file: AcceptedFrameWalFileEntry
  readonly record: LocalAcceptedFrameWalPruneRecord
}

type AcceptedFrameWalLogEntry =
  | AcceptedFrameWalEntry
  | AcceptedFrameWalAckEntry
  | AcceptedFrameWalCheckpointEntry
  | AcceptedFrameWalPruneEntry

interface AcceptedFrameWalIndex {
  readonly header: LocalAcceptedFrameWalHeader
  readonly headerByteLength: number
  readonly baseHead: Readonly<{ record: LocalDurableHead; digest: Digest }>
  readonly entries: AcceptedFrameWalLogEntry[]
  readonly byFrameDigest: Map<Digest, AcceptedFrameWalEntry>
  readonly byJournalDigest: Map<Digest, AcceptedFrameWalEntry>
  readonly byAckCoreDigest: Map<Digest, AcceptedFrameWalAckEntry>
  readonly byOperation: Map<string, Map<Digest, AcceptedFrameWalEntry>>
  readonly activeOutboxByFrameDigest: Map<Digest, AcceptedFrameWalEntry>
  readonly reachableFrameDigests: InternallyOwnedReachableFrameDigests
  headerDurablyCurrent: boolean
  currentHead: Readonly<{ record: LocalDurableHead; digest: Digest }>
  validByteLength: number
  tailAtomicCommitRecordDigest: Digest | null
}

interface LocalPrunePlan {
  readonly format: "convax.local-prune-plan"
  readonly scope: DocumentScope
  readonly expectedDurableHeadRecordDigest: Digest
  readonly installedCheckpointSetDigest: Digest
  readonly prunableSetCertificateObjectDigest: Digest
  readonly causalFloorObjectDigest: Digest
  readonly retainedRootSetDigest: Digest
  readonly expectedPostBarrierRootSetDigest: Digest
  readonly candidateDeleteObjects: readonly NodePrunableObject[]
  readonly newJournalBaseDigest: Digest
  readonly startJournalRecordDigest: Digest
  readonly candidateDurableHeadRecordDigest: Digest
}

interface LocalActivePrunePlan {
  readonly format: "convax.local-active-prune-plan"
  readonly scope: DocumentScope
  readonly prunePlanDigest: Digest
  readonly phase: "prepared" | "head-published" | "deleted" | "abandoned"
}

interface LocalOperationObjectRef {
  readonly format: "convax.local-operation-object-ref"
  readonly ref: FrameObjectRef
}

interface LocalPendingFrameRecord {
  readonly format: "convax.local-pending-frame"
  readonly ref: FrameObjectRef
  readonly reason: PendingFrameReason
  readonly frameByteLength: string
}

interface LocalQuarantineCommit {
  readonly format: "convax.local-quarantine-commit"
  readonly scope: DocumentScope
  readonly frameDigest: Digest
  readonly reason: KernelQuarantineReason | "stale-replica-head"
  readonly observedReplicaHeadRecordDigest: Digest
  readonly journalRecordDigest: Digest | null
}

interface LocalShardDispositionHead {
  readonly format: "convax.local-shard-disposition-head"
  readonly scope: DocumentScope
  readonly state: "read-only-quarantine"
  readonly quarantineCommitRecordDigest: Digest
}

interface DocumentLayout {
  readonly directory: string
  readonly frames: string
  readonly genesisProofs: string
  readonly checkpoints: string
  readonly certificates: string
  readonly floors: string
  readonly acks: string
  readonly checkpointSets: string
  readonly journalBases: string
  readonly journalSegments: string
  readonly acceptedFrameWal: string
  readonly durableHead: string
  readonly outboxFrames: string
  readonly pendingInbox: string
  readonly operationRefs: string
  readonly quarantine: string
  readonly dispositionHead: string
  readonly prunePlans: string
  readonly activePrunePlan: string
  readonly pruneTrash: string
}

interface LoadedJournalBase {
  readonly digest: Digest
  readonly record: LocalJournalBaseRecord
  readonly fullUpdate: Uint8Array
  readonly stateVector: StateVector
}

interface LoadedJournal {
  readonly digest: Digest
  readonly record: LocalJournalRecord
}

interface LoadedPendingFrame {
  readonly record: LocalPendingFrameRecord
  readonly exactFrameBytes: Uint8Array
}

interface AcceptedHeadDeltaRefNode {
  readonly previous: AcceptedHeadDeltaRefNode | null
  readonly ref: FrameObjectRef
  readonly identity: InternallyOwnedAcceptedHeadIdentity
  readonly durableDelta: AcceptedHeadDurableDeltaMetadata | undefined
}

interface VerifiedMaterializedHeadCache {
  readonly durableHeadDigest: Digest
  readonly localHeadGeneration: string
  readonly journalBaseDigest: Digest
  readonly journalTailDigest: Digest
  readonly installedCheckpointSetDigest: Digest
  readonly acceptedIdentity: InternallyOwnedAcceptedHeadIdentity
  readonly materializedBase: InternallyOwnedAcceptedHead
  readonly deltaTail: AcceptedHeadDeltaRefNode | null
  readonly deltaLength: number
  readonly reachableFrameDigests: InternallyOwnedReachableFrameDigests
}

const INTERNALLY_OWNED_HEAD = Symbol("convax.project.node.internally-owned-head")

type InternallyOwnedAcceptedHead = NodeAcceptedReplicaHead & {
  readonly [INTERNALLY_OWNED_HEAD]: true
}

const INTERNALLY_OWNED_HEAD_IDENTITY = Symbol("convax.project.node.internally-owned-head-identity")

type NodeAcceptedReplicaHeadIdentity = Omit<NodeAcceptedReplicaHead, "fullUpdate">

type InternallyOwnedAcceptedHeadIdentity = NodeAcceptedReplicaHeadIdentity & {
  readonly [INTERNALLY_OWNED_HEAD_IDENTITY]: true
}

const INTERNALLY_OWNED_REACHABLE_FRAME_DIGESTS = Symbol("convax.project.node.internally-owned-reachable-frame-digests")

type InternallyOwnedReachableFrameDigests = Set<Digest> & {
  readonly [INTERNALLY_OWNED_REACHABLE_FRAME_DIGESTS]: true
}

interface PendingHeadTransitionBase {
  readonly expectedHeadDigest: Digest
  readonly priorJournalTailDigest: Digest
  readonly journalRecordDigest: Digest
  readonly frameDigest: Digest
  readonly resultingFrontierDigest: Digest
  /** The prior durable head's private set. The pending frame is added only after the head barrier. */
  readonly reachableFrameDigests: InternallyOwnedReachableFrameDigests
}

type PendingHeadTransition =
  | PendingHeadTransitionBase & Readonly<{
      readonly kind: "metadata-delta"
      readonly transition: AcceptedHeadTransitionView
      readonly durableDelta: AcceptedHeadDurableDeltaMetadata
      readonly previousCache: VerifiedMaterializedHeadCache
    }>
  | PendingHeadTransitionBase & Readonly<{
      readonly kind: "materialized"
      readonly acceptedHead: InternallyOwnedAcceptedHead
    }>

let persistenceColdHeadMaterializations = 0
let persistenceAcceptedFrameMaterializations = 0
let persistenceMetadataEvidenceTransitions = 0
let persistenceDeltaRefAppends = 0
let persistenceDeltaHistoryVisits = 0
let persistenceFullUpdateClones = 0
let persistenceFullUpdateBytesCloned = 0
let persistenceWalColdScans = 0
let persistenceWalRecordsVisited = 0
let persistenceAtomicAppends = 0
let persistenceAtomicFileSyncs = 0
let persistenceAtomicDirectorySyncs = 0
let persistenceOutboxUsageHistoryVisits = 0

/** Package-private structural evidence; values never enter durable records. */
export function nodeCollaborationPersistenceStructuralCounts() {
  return Object.freeze({
    coldHeadMaterializations: persistenceColdHeadMaterializations,
    acceptedFrameMaterializations: persistenceAcceptedFrameMaterializations,
    metadataEvidenceTransitions: persistenceMetadataEvidenceTransitions,
    deltaRefAppends: persistenceDeltaRefAppends,
    deltaHistoryVisits: persistenceDeltaHistoryVisits,
    fullUpdateClones: persistenceFullUpdateClones,
    fullUpdateBytesCloned: persistenceFullUpdateBytesCloned,
    walColdScans: persistenceWalColdScans,
    walRecordsVisited: persistenceWalRecordsVisited,
    atomicAppends: persistenceAtomicAppends,
    atomicFileSyncs: persistenceAtomicFileSyncs,
    atomicDirectorySyncs: persistenceAtomicDirectorySyncs,
    outboxUsageHistoryVisits: persistenceOutboxUsageHistoryVisits,
  })
}

interface IndexedOperationFrame {
  readonly ref: FrameObjectRef
  readonly layout: DocumentLayout
}

interface OutboxUsageCache {
  readonly frameBytes: Map<Digest, number>
  totalBytes: number
}

const rootWriterLeases = new Set<string>()

/**
 * Native object/outbox/journal/head adapter. One instance is the sole Main
 * writer for one already-bound Project collaboration directory; it serves the
 * ProjectIndex shard and every per-Canvas shard through opaque document keys.
 */
export class NodeCollaborationPersistence implements CollaborationPersistencePort, PendingInboxPort {
  private readonly queues = new Map<string, Promise<void>>()
  private readonly materializedHeadCaches = new Map<string, VerifiedMaterializedHeadCache>()
  private readonly pendingHeadTransitions = new Map<string, PendingHeadTransition>()
  private readonly outboxUsageCaches = new Map<string, OutboxUsageCache>()
  private readonly acceptedFrameWalIndexes = new Map<string, AcceptedFrameWalIndex>()
  private operationRecoveryIndex: Map<string, Map<Digest, IndexedOperationFrame>> | null = null
  private operationRecoveryIndexWarmup: Promise<void> | null = null
  private disposed = false

  private constructor(
    private readonly collaborationDirectory: string,
    private readonly localActorId: ActorId,
    private readonly materializer: NodeReplicaHeadMaterializer,
    private readonly replicaDurableAckVerifier: NodeReplicaDurableAckVerifier | undefined,
    private readonly checkpointInstallationVerifier: NodeCheckpointInstallationVerifier | undefined,
    private readonly checkpointPruneAuthority: NodeCheckpointPruneAuthority | undefined,
    private readonly checkpointPruneRootScanner: NodeCheckpointPruneRootScanner | undefined,
    private readonly hooks: NodeCollaborationPersistenceFaultHooks,
    private readonly durabilityDiagnostics: NodeLocalCommitDurabilityDiagnostics | undefined,
    private readonly ownsRootWriterLease = true,
    private readonly readProtocol: "current" | "immediate-predecessor" = "current",
  ) {}

  static async open(input: {
    readonly collaborationDirectory: string
    readonly localActorId: ActorId
    readonly materializer: NodeReplicaHeadMaterializer
    readonly replicaDurableAckVerifier?: NodeReplicaDurableAckVerifier
    readonly checkpointInstallationVerifier?: NodeCheckpointInstallationVerifier
    readonly checkpointPruneAuthority?: NodeCheckpointPruneAuthority
    readonly checkpointPruneRootScanner?: NodeCheckpointPruneRootScanner
    readonly hooks?: NodeCollaborationPersistenceFaultHooks
    readonly durabilityDiagnostics?: NodeLocalCommitDurabilityDiagnostics
  }): Promise<NodeCollaborationPersistence> {
    if (!path.isAbsolute(input.collaborationDirectory)) invalid("Collaboration directory must be absolute")
    await ensureTrustedDirectory(input.collaborationDirectory)
    const real = await fs.realpath(input.collaborationDirectory)
    if (rootWriterLeases.has(real)) {
      throw new NodeCollaborationPersistenceError(
        "project-writer-already-open",
        "This process already owns the Project collaboration writer",
      )
    }
    rootWriterLeases.add(real)
    const store = new NodeCollaborationPersistence(
      real,
      input.localActorId,
      input.materializer,
      input.replicaDurableAckVerifier,
      input.checkpointInstallationVerifier,
      input.checkpointPruneAuthority,
      input.checkpointPruneRootScanner,
      input.hooks ?? {},
      input.durabilityDiagnostics,
      true,
      "current",
    )
    try {
      await store.ensureOperationRecoveryIndex()
      return store
    } catch (error) {
      store.dispose()
      throw error
    }
  }

  static async openReadOnly(input: Parameters<typeof NodeCollaborationPersistence.open>[0]): Promise<NodeCollaborationPersistence> {
    if (!path.isAbsolute(input.collaborationDirectory)) invalid("Collaboration directory must be absolute")
    await ensureTrustedDirectory(input.collaborationDirectory)
    const real = await fs.realpath(input.collaborationDirectory)
    return new NodeCollaborationPersistence(
      real,
      input.localActorId,
      input.materializer,
      input.replicaDurableAckVerifier,
      input.checkpointInstallationVerifier,
      input.checkpointPruneAuthority,
      input.checkpointPruneRootScanner,
      input.hooks ?? {},
      input.durabilityDiagnostics,
      false,
      "current",
    )
  }

  /** @internal Called only through `openImmediatePredecessorCollaborationStoreReadOnly`. */
  static async openImmediatePredecessorReadOnly(
    input: Parameters<typeof NodeCollaborationPersistence.open>[0],
    capability: object,
  ): Promise<NodeCollaborationPersistence> {
    if (capability !== IMMEDIATE_PREDECESSOR_READER_CAPABILITY) {
      throw new NodeCollaborationPersistenceError("invalid-input", "Immediate-predecessor reader capability is sealed")
    }
    if (!path.isAbsolute(input.collaborationDirectory)) invalid("Collaboration directory must be absolute")
    await ensureTrustedDirectory(input.collaborationDirectory)
    const real = await fs.realpath(input.collaborationDirectory)
    return new NodeCollaborationPersistence(
      real,
      input.localActorId,
      input.materializer,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      undefined,
      false,
      "immediate-predecessor",
    )
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.materializedHeadCaches.clear()
    this.pendingHeadTransitions.clear()
    this.outboxUsageCaches.clear()
    this.acceptedFrameWalIndexes.clear()
    this.operationRecoveryIndex = null
    this.operationRecoveryIndexWarmup = null
    if (this.ownsRootWriterLease) rootWriterLeases.delete(this.collaborationDirectory)
  }

  async initializeShard(input: InitializeNativeCollaborationShard): Promise<NodeAcceptedReplicaHead> {
    return this.initializeShardInternal(input)
  }

  async initializeShardWithGenesisProof(
    input: InitializeNativeCollaborationShardWithGenesisProof,
  ): Promise<NodeAcceptedReplicaHead> {
    if (
      !(input.proofCarrierExactBytes instanceof Uint8Array) ||
      input.proofCarrierExactBytes.byteLength < 1 ||
      input.proofCarrierExactBytes.byteLength > MAX_GENESIS_PROOF_BYTES
    ) {
      invalid("Canvas genesis proof carrier must be non-empty and within 335,544,320 bytes")
    }
    return this.initializeShardWithGenesisProofInternal(input, new Uint8Array(input.proofCarrierExactBytes))
  }

  async readGenesisProof(scope: DocumentScope, checkpointObjectDigest: Digest): Promise<Uint8Array> {
    this.requireLive()
    validateDigest(checkpointObjectDigest, "Canvas genesis checkpoint digest")
    const layout = this.layout(scope)
    return this.serial(layout.directory, async () => {
      await this.assertReadableDocument(layout)
      const target = path.join(
        layout.genesisProofs,
        `${deriveObjectNativeKey("genesis-proof", checkpointObjectDigest)}.bin`,
      )
      const bytes = await fs.readFile(target).catch((error) => {
        throw new NodeCollaborationPersistenceError(
          "document-not-found",
          "Canvas genesis proof carrier is unavailable",
          { cause: error },
        )
      })
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_GENESIS_PROOF_BYTES) corrupt("Canvas genesis proof size is invalid")
      return Uint8Array.from(bytes)
    })
  }

  private async initializeShardInternal(
    input: InitializeNativeCollaborationShard,
    proofCarrierExactBytes?: Readonly<Uint8Array>,
  ): Promise<NodeAcceptedReplicaHead> {
    this.requireLive()
    const layout = this.layout(input.scope)
    return this.serial(layout.directory, async () => {
      await assertMissing(layout.directory)
      validateDigest(input.checkpointObjectDigest, "Checkpoint object digest")
      validateAcceptedBase(input.acceptedBase, input.scope)
      await this.createDocumentLayout(layout)
      try {
        await putImmutableExact(layout.checkpoints, "checkpoint", input.checkpointObjectDigest, input.checkpointExactBytes)
        if (proofCarrierExactBytes !== undefined) {
          await putImmutableExact(
            layout.genesisProofs,
            "genesis-proof",
            input.checkpointObjectDigest,
            proofCarrierExactBytes,
          )
        }
        const checkpointSet: LocalInstalledCheckpointSet = {
          format: "convax.local-installed-checkpoint-set",
          scope: input.scope,
          checkpointObjectDigests: [input.checkpointObjectDigest],
          bootstrapCheckpointObjectDigest: input.checkpointObjectDigest,
          contentCertificateObjectDigests: [],
          prunableSetCertificateObjectDigests: [],
        }
        const checkpointSetDigest = localRecordDigest(checkpointSet)
        await putImmutableRecord(layout.checkpointSets, "checkpoint-set", checkpointSetDigest, checkpointSet)
        const baseRecord: LocalJournalBaseRecord = {
          format: "convax.local-journal-base",
          scope: input.scope,
          baseLocalRecordSequence: "0",
          checkpointObjectDigest: input.checkpointObjectDigest,
          installedCheckpointSetDigest: checkpointSetDigest,
          frontier: input.acceptedBase.frontier,
          frontierDigest: input.acceptedBase.frontierDigest,
          actorHeads: input.acceptedBase.actorHeads,
          actorHeadsDigest: this.materializer.actorHeadsDigest(input.acceptedBase.actorHeads),
          canonicalStateDigest: input.acceptedBase.canonicalStateDigest,
          materializationDigest: input.acceptedBase.materializationDigest,
          fullUpdateDigest: ordinaryDigest(input.acceptedBase.fullUpdate),
          fullUpdateByteLength: String(input.acceptedBase.fullUpdate.byteLength),
          stateVectorDigest: ordinaryDigest(input.acceptedBase.stateVector),
          stateVectorByteLength: String(input.acceptedBase.stateVector.byteLength),
        }
        const baseDigest = localRecordDigest(baseRecord)
        await writeJournalBase(layout.journalBases, baseDigest, baseRecord, input.acceptedBase.fullUpdate, input.acceptedBase.stateVector)
        const head: LocalDurableHead = {
          format: "convax.local-durable-head",
          scope: input.scope,
          localHeadGeneration: "0",
          priorHeadDigest: null,
          journalBaseDigest: baseDigest,
          journalTailDigest: baseDigest,
          installedCheckpointSetDigest: checkpointSetDigest,
          acceptedFrontierDigest: input.acceptedBase.frontierDigest,
          acceptedActorHeadsDigest: baseRecord.actorHeadsDigest,
        }
        await replaceDurableRecord(layout.durableHead, head)
        const headDigest = localRecordDigest(head)
        await this.initializeAcceptedFrameWal(layout, head, headDigest, input.acceptedBase.materializationDigest)
        await fsyncProjectDirectory(layout.directory)
        const accepted = freezeHead(input.acceptedBase, headDigest)
        this.storeMaterializedHeadCache(layout, head, headDigest, accepted, createOwnedReachableFrameDigests())
        return freezeHead(accepted, headDigest)
      } catch (error) {
        throw classifyNativeFailure(error)
      }
    })
  }

  private async initializeShardWithGenesisProofInternal(
    input: InitializeNativeCollaborationShardWithGenesisProof,
    proofCarrierExactBytes: Readonly<Uint8Array>,
  ): Promise<NodeAcceptedReplicaHead> {
    this.requireLive()
    validateDigest(input.checkpointObjectDigest, "Checkpoint object digest")
    validateAcceptedBase(input.acceptedBase, input.scope)
    const layout = this.layout(input.scope)
    return this.serial(layout.directory, async () => {
      if (await directoryExists(layout.directory)) {
        return this.verifyInstalledGenesis(layout, input, proofCarrierExactBytes)
      }
      const stagingDirectory = `${layout.directory}.genesis-${deriveObjectNativeKey("genesis-proof", input.checkpointObjectDigest)}`
      const staging = this.layoutFromDirectory(stagingDirectory)
      const stagedStat = await fs.lstat(stagingDirectory).catch(() => null)
      if (stagedStat) {
        if (!stagedStat.isDirectory() || stagedStat.isSymbolicLink()) corrupt("Canvas genesis staging path is untrusted")
        await fs.rm(stagingDirectory, { recursive: true })
        await fsyncProjectDirectory(path.dirname(stagingDirectory))
      }
      await this.createDocumentLayout(staging)
      try {
        const head = await this.populateInitialShard(staging, input, proofCarrierExactBytes)
        await this.hooks.afterGenesisStagingFsync?.()
        await fs.rename(stagingDirectory, layout.directory)
        await fsyncProjectDirectory(path.dirname(layout.directory))
        return head
      } catch (error) {
        throw classifyNativeFailure(error)
      }
    })
  }

  private async populateInitialShard(
    layout: DocumentLayout,
    input: InitializeNativeCollaborationShard,
    proofCarrierExactBytes: Readonly<Uint8Array>,
  ): Promise<NodeAcceptedReplicaHead> {
    await putImmutableExact(layout.checkpoints, "checkpoint", input.checkpointObjectDigest, input.checkpointExactBytes)
    await putImmutableExact(layout.genesisProofs, "genesis-proof", input.checkpointObjectDigest, proofCarrierExactBytes)
    const checkpointSet: LocalInstalledCheckpointSet = {
      format: "convax.local-installed-checkpoint-set",
      scope: input.scope,
      checkpointObjectDigests: [input.checkpointObjectDigest],
      bootstrapCheckpointObjectDigest: input.checkpointObjectDigest,
      contentCertificateObjectDigests: [],
      prunableSetCertificateObjectDigests: [],
    }
    const checkpointSetDigest = localRecordDigest(checkpointSet)
    await putImmutableRecord(layout.checkpointSets, "checkpoint-set", checkpointSetDigest, checkpointSet)
    const baseRecord: LocalJournalBaseRecord = {
      format: "convax.local-journal-base",
      scope: input.scope,
      baseLocalRecordSequence: "0",
      checkpointObjectDigest: input.checkpointObjectDigest,
      installedCheckpointSetDigest: checkpointSetDigest,
      frontier: input.acceptedBase.frontier,
      frontierDigest: input.acceptedBase.frontierDigest,
      actorHeads: input.acceptedBase.actorHeads,
      actorHeadsDigest: this.materializer.actorHeadsDigest(input.acceptedBase.actorHeads),
      canonicalStateDigest: input.acceptedBase.canonicalStateDigest,
      materializationDigest: input.acceptedBase.materializationDigest,
      fullUpdateDigest: ordinaryDigest(input.acceptedBase.fullUpdate),
      fullUpdateByteLength: String(input.acceptedBase.fullUpdate.byteLength),
      stateVectorDigest: ordinaryDigest(input.acceptedBase.stateVector),
      stateVectorByteLength: String(input.acceptedBase.stateVector.byteLength),
    }
    const baseDigest = localRecordDigest(baseRecord)
    await writeJournalBase(layout.journalBases, baseDigest, baseRecord, input.acceptedBase.fullUpdate, input.acceptedBase.stateVector)
    const head: LocalDurableHead = {
      format: "convax.local-durable-head",
      scope: input.scope,
      localHeadGeneration: "0",
      priorHeadDigest: null,
      journalBaseDigest: baseDigest,
      journalTailDigest: baseDigest,
      installedCheckpointSetDigest: checkpointSetDigest,
      acceptedFrontierDigest: input.acceptedBase.frontierDigest,
      acceptedActorHeadsDigest: baseRecord.actorHeadsDigest,
    }
    await replaceDurableRecord(layout.durableHead, head)
    const headDigest = localRecordDigest(head)
    await this.initializeAcceptedFrameWal(layout, head, headDigest, input.acceptedBase.materializationDigest)
    await fsyncProjectDirectory(layout.directory)
    return freezeHead(input.acceptedBase, headDigest)
  }

  private async initializeAcceptedFrameWal(
    layout: DocumentLayout,
    head: LocalDurableHead,
    headDigest: Digest,
    materializationDigest: Digest,
  ): Promise<void> {
    const header = acceptedFrameWalHeader(head, headDigest, materializationDigest)
    const headerBytes = encodeRecord(header)
    await createAcceptedFrameWalFile(layout.acceptedFrameWal, headerBytes)
    this.acceptedFrameWalIndexes.set(
      layout.directory,
      emptyAcceptedFrameWalIndex(header, encodeAcceptedFrameWalHeader(headerBytes).byteLength, head, headDigest),
    )
    this.outboxUsageCaches.set(layout.directory, { frameBytes: new Map(), totalBytes: 0 })
  }

  private async ensureAcceptedFrameWalHeaderCurrent(
    layout: DocumentLayout,
    index: AcceptedFrameWalIndex,
    materializationDigest: Digest,
  ): Promise<AcceptedFrameWalIndex> {
    if (index.entries.length !== 0) {
      if (!index.headerDurablyCurrent) corrupt("Accepted-frame WAL non-empty header is not durable")
      // A non-empty log stays anchored to its immutable base. Its current head
      // and materialization advance in records, never by rewriting the header.
      return index
    }
    if (
      index.headerDurablyCurrent &&
      index.header.baseReplicaHeadRecordDigest === index.currentHead.digest &&
      index.header.baseMaterializationDigest === materializationDigest
    ) return index
    const header = acceptedFrameWalHeader(index.currentHead.record, index.currentHead.digest, materializationDigest)
    const headerBytes = encodeRecord(header)
    const temporary = path.join(path.dirname(layout.acceptedFrameWal), `.accepted-frames-${randomUUID()}.wal`)
    try {
      await createAcceptedFrameWalFile(temporary, headerBytes)
      await fs.rename(temporary, layout.acceptedFrameWal)
      await fsyncProjectDirectory(path.dirname(layout.acceptedFrameWal))
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined)
    }
    const rebound = emptyAcceptedFrameWalIndex(
      header,
      encodeAcceptedFrameWalHeader(headerBytes).byteLength,
      index.currentHead.record,
      index.currentHead.digest,
    )
    this.acceptedFrameWalIndexes.set(layout.directory, rebound)
    return rebound
  }

  private adoptLegacyDurableHead(
    layout: DocumentLayout,
    head: LocalDurableHead,
    headDigest: Digest,
    materializationDigest?: Digest,
  ): void {
    const current = this.acceptedFrameWalIndexes.get(layout.directory)
    if (!current) return
    if (current.entries.length !== 0) {
      corrupt("Legacy maintenance cannot advance a head above an uncheckpointed accepted-frame WAL")
    }
    const rebound = emptyAcceptedFrameWalIndex(
      acceptedFrameWalHeader(
        head,
        headDigest,
        materializationDigest ?? current.header.baseMaterializationDigest,
      ),
      current.headerByteLength,
      head,
      headDigest,
      false,
    )
    this.acceptedFrameWalIndexes.set(layout.directory, rebound)
  }

  private async verifyInstalledGenesis(
    layout: DocumentLayout,
    input: InitializeNativeCollaborationShardWithGenesisProof,
    proofCarrierExactBytes: Readonly<Uint8Array>,
  ): Promise<NodeAcceptedReplicaHead> {
    await this.assertReadableDocument(layout)
    const durable = await this.readDurableHead(layout, input.scope)
    if (durable.record.localHeadGeneration !== "0" || durable.record.priorHeadDigest !== null) {
      throw new NodeCollaborationPersistenceError("document-already-exists", "Canvas genesis retry found an edited shard")
    }
    const base = await readJournalBase(
      layout.journalBases,
      durable.record.journalBaseDigest,
      input.scope,
    )
    if (base.record.checkpointObjectDigest !== input.checkpointObjectDigest) {
      throw new NodeCollaborationPersistenceError("document-already-exists", "Canvas genesis retry names another checkpoint")
    }
    const checkpoint = await fs.readFile(path.join(
      layout.checkpoints,
      `${deriveObjectNativeKey("checkpoint", input.checkpointObjectDigest)}.bin`,
    ))
    const carrier = await fs.readFile(path.join(
      layout.genesisProofs,
      `${deriveObjectNativeKey("genesis-proof", input.checkpointObjectDigest)}.bin`,
    ))
    if (
      !sameExactBytes(checkpoint, input.checkpointExactBytes) ||
      !sameExactBytes(carrier, proofCarrierExactBytes) ||
      base.record.frontierDigest !== input.acceptedBase.frontierDigest ||
      base.record.canonicalStateDigest !== input.acceptedBase.canonicalStateDigest ||
      base.record.materializationDigest !== input.acceptedBase.materializationDigest ||
      !sameExactBytes(base.fullUpdate, input.acceptedBase.fullUpdate) ||
      !sameExactBytes(base.stateVector, input.acceptedBase.stateVector) ||
      base.record.actorHeadsDigest !== this.materializer.actorHeadsDigest(input.acceptedBase.actorHeads)
    ) {
      throw new NodeCollaborationPersistenceError("store-corrupt", "Canvas genesis retry bytes do not match the durable shard")
    }
    const accepted = freezeHead(input.acceptedBase, durable.digest)
    this.storeMaterializedHeadCache(
      layout,
      durable.record,
      durable.digest,
      accepted,
      createOwnedReachableFrameDigests(),
    )
    return freezeHead(accepted, durable.digest)
  }

  async loadReplicaHead(scope: DocumentScope): Promise<unknown> {
    this.requireLive()
    const layout = this.layout(scope)
    return this.serial(layout.directory, async () => this.readProtocol === "immediate-predecessor"
      ? this.reconstructImmediatePredecessorHead(layout, scope)
      : this.loadAcceptedHeadInternal(layout, scope, true))
  }

  async listImmediatePredecessorDocumentScopes(): Promise<readonly DocumentScope[]> {
    this.requireLive()
    if (this.readProtocol !== "immediate-predecessor") invalid("Immediate-predecessor scope inventory is unavailable")
    const documents = path.join(this.collaborationDirectory, "documents")
    const entries = await fs.readdir(documents, { withFileTypes: true })
    const scopes: DocumentScope[] = []
    for (const entry of entries.sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) corrupt("Immediate-predecessor document inventory contains a non-directory")
      const layout = this.layoutFromDirectory(path.join(documents, entry.name))
      await this.assertReadableDocument(layout)
      const durable = await this.readBaseDurableHead(layout)
      if (deriveDocumentNativeKey(durable.record.scope) !== entry.name) corrupt("Immediate-predecessor document directory does not match its scope")
      scopes.push(durable.record.scope)
    }
    return Object.freeze(scopes)
  }

  async verifyReplicaHeadCurrent(input: {
    readonly scope: DocumentScope
    readonly expectedHeadDigest: Digest
    readonly expectedFrontierDigest: Digest
  }): Promise<"verified" | "reload-required"> {
    this.requireLive()
    validateDigest(input.expectedHeadDigest, "Expected replica head digest")
    validateDigest(input.expectedFrontierDigest, "Expected replica frontier digest")
    const layout = this.layout(input.scope)
    return this.serial(layout.directory, async () => {
      await this.assertReadableDocument(layout)
      const durable = await this.readDurableHead(layout, input.scope)
      if (
        durable.digest !== input.expectedHeadDigest ||
        durable.record.acceptedFrontierDigest !== input.expectedFrontierDigest
      ) return "reload-required"
      if (await fileExists(layout.dispositionHead)) return "reload-required"
      const nextSequence = incrementUint64(durable.record.localHeadGeneration)
      const nextPath = path.join(layout.journalSegments, deriveJournalSegmentNativeKey(nextSequence))
      if (await fileExists(nextPath)) return "reload-required"
      return "verified"
    })
  }

  /** Process-local, identity-free counters for optional slow-command diagnostics. */
  async sampleLatencyDiagnostics(scope: DocumentScope): Promise<Readonly<{
    historyCount: number
    outboxCount: number
    cacheHit: boolean
  }>> {
    this.requireLive()
    const layout = this.layout(scope)
    return this.serial(layout.directory, async () => {
      await this.assertReadableDocument(layout)
      const durable = await this.readDurableHead(layout, scope)
      const cache = this.materializedHeadCaches.get(layout.directory)
      const cacheHit = Boolean(cache && this.materializedHeadCacheMatches(cache, durable.record, durable.digest))
      const base = await readJournalBase(layout.journalBases, durable.record.journalBaseDigest, scope)
      const history = BigInt(durable.record.localHeadGeneration) - BigInt(base.record.baseLocalRecordSequence)
      const usage = await this.loadOutboxUsage(layout)
      return Object.freeze({
        historyCount: Number(history > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : history),
        outboxCount: usage.frameBytes.size,
        cacheHit,
      })
    })
  }

  /** Exact installed checkpoint base; no accepted suffix frame is applied. */
  async loadInstalledBase(scope: DocumentScope): Promise<NodeAcceptedReplicaHead> {
    this.requireLive()
    const layout = this.layout(scope)
    return this.serial(layout.directory, async () => {
      await this.assertReadableDocument(layout)
      const head = await this.readDurableHead(layout, scope)
      const base = await readJournalBase(layout.journalBases, head.record.journalBaseDigest, scope)
      const installed = await this.readInstalledCheckpointSet(layout, head.record.installedCheckpointSetDigest, scope)
      if (base.record.installedCheckpointSetDigest !== head.record.installedCheckpointSetDigest) {
        return this.materializeInstalledCheckpointBase(layout, scope, installed)
      }
      return freezeHead({
        scope,
        frontier: base.record.frontier,
        frontierDigest: base.record.frontierDigest,
        actorHeads: base.record.actorHeads,
        fullUpdate: base.fullUpdate,
        stateVector: base.stateVector,
        canonicalStateDigest: base.record.canonicalStateDigest,
        materializationDigest: base.record.materializationDigest,
      }, base.digest)
    })
  }

  /**
   * Installs a verified portable checkpoint set through immutable-object,
   * journal and sole-head barriers. It never advances the journal base and
   * therefore grants no prune authority.
   */
  async installCheckpointSet(input: InstallNativeCheckpointSet): Promise<InstallNativeCheckpointSetResult> {
    this.requireLive()
    validateDigest(input.expectedReplicaHeadRecordDigest, "Expected replica head digest")
    const checkpointObjects = normalizePortableObjects(input.checkpointObjects, 1, 8, "checkpoint")
    const contentCertificates = normalizePortableObjects(input.contentCertificateObjects, 1, 8, "content certificate")
    const prunableCertificates = normalizePortableObjects(input.prunableSetCertificateObjects, 0, 8, "prunable-set certificate")
    const bootstrapDigest = parseDigest(input.bootstrapCheckpointObjectDigest)
    if (!checkpointObjects.some((entry) => entry.objectDigest === bootstrapDigest)) {
      invalid("Bootstrap checkpoint is absent from the installed set")
    }
    const verifier = this.checkpointInstallationVerifier
    const checkpointMaterializer = this.materializer.materializeCheckpoint
    if (!verifier || !checkpointMaterializer) invalid("Checkpoint installation authority is unavailable")
    const layout = this.layout(input.scope)
    return this.serial(layout.directory, async () => {
      try {
        await this.assertWritableDocument(layout)
        const current = await this.readDurableHead(layout, input.scope)
        if (current.digest !== input.expectedReplicaHeadRecordDigest) return { status: "rejected", code: "head-stale" }
        const currentAcceptedHead = await this.reconstructHead(layout, input.scope, current.record, current.digest)
        if (!(await verifier.verifyCurrent({
          scope: input.scope,
          currentAcceptedHead,
          bootstrapCheckpointObjectDigest: bootstrapDigest,
          checkpointObjects,
          contentCertificateObjects: contentCertificates,
          prunableSetCertificateObjects: prunableCertificates,
        }))) return { status: "rejected", code: "verification-failed" }

        const bootstrap = checkpointObjects.find((entry) => entry.objectDigest === bootstrapDigest)!
        const materialized = await checkpointMaterializer.call(this.materializer, {
          scope: input.scope,
          checkpointObjectDigest: bootstrapDigest,
          exactCheckpointBytes: bootstrap.exactBytes,
        })
        validateAcceptedBase(materialized, input.scope)
        assertSameAcceptedState(materialized, currentAcceptedHead, this.materializer)

        for (const object of checkpointObjects) {
          await putImmutableExact(layout.checkpoints, "checkpoint", object.objectDigest, object.exactBytes)
        }
        for (const object of [...contentCertificates, ...prunableCertificates]) {
          await putImmutableExact(layout.certificates, "certificate", object.objectDigest, object.exactBytes)
        }
        const installedSet: LocalInstalledCheckpointSet = {
          format: "convax.local-installed-checkpoint-set",
          scope: input.scope,
          checkpointObjectDigests: checkpointObjects.map((entry) => entry.objectDigest),
          bootstrapCheckpointObjectDigest: bootstrapDigest,
          contentCertificateObjectDigests: contentCertificates.map((entry) => entry.objectDigest),
          prunableSetCertificateObjectDigests: prunableCertificates.map((entry) => entry.objectDigest),
        }
        const installedSetDigest = localRecordDigest(installedSet)
        await putImmutableRecord(layout.checkpointSets, "checkpoint-set", installedSetDigest, installedSet)

        const nextSequence = incrementUint64(current.record.localHeadGeneration)
        const journalRecord: LocalJournalRecord = Object.freeze({
          format: "convax.local-journal-record",
          scope: input.scope,
          localRecordSequence: nextSequence,
          priorJournalRecordDigest: current.record.journalTailDigest,
          transition: "install-checkpoint-set",
          objectDigests: [installedSetDigest],
          outboxRefDigest: null,
          resultingFrontierDigest: current.record.acceptedFrontierDigest,
          operationRef: null,
        })
        const journalDigest = localRecordDigest(journalRecord)
        const head: LocalDurableHead = Object.freeze({
          ...current.record,
          localHeadGeneration: nextSequence,
          priorHeadDigest: current.digest,
          journalTailDigest: journalDigest,
          installedCheckpointSetDigest: installedSetDigest,
        })
        const resultingHeadDigest = localRecordDigest(head)
        const exposed = await this.materializeInstalledCheckpointBase(layout, input.scope, installedSet)
        assertSameAcceptedState(exposed, currentAcceptedHead, this.materializer)
        let wal = await this.loadAcceptedFrameWalIndex(
          layout,
          await this.readBaseDurableHead(layout, input.scope),
          true,
        )
        if (wal.currentHead.digest !== current.digest) corrupt("Checkpoint WAL head changed during verification")
        wal = await this.ensureAcceptedFrameWalHeaderCurrent(
          layout,
          wal,
          currentAcceptedHead.materializationDigest,
        )
        const core: LocalAcceptedFrameWalCheckpointRecordCore = Object.freeze({
          format: "convax.local-accepted-frame-wal-checkpoint-record-core",
          scope: input.scope,
          sequence: nextSequence,
          priorAtomicCommitRecordDigest: wal.tailAtomicCommitRecordDigest,
          installedCheckpointSetDigest: installedSetDigest,
          journalRecord,
          journalRecordDigest: journalDigest,
          expectedReplicaHeadRecordDigest: current.digest,
          resultingHeadRecord: head,
          resultingReplicaHeadRecordDigest: resultingHeadDigest,
        })
        const record: LocalAcceptedFrameWalCheckpointRecord = Object.freeze({
          format: "convax.local-accepted-frame-wal-checkpoint-record",
          core,
          atomicCommitRecordDigest: localRecordDigest(core),
        })
        const encoded = encodeAcceptedFrameWalRecord({
          headerBytes: encodeRecord(record),
          exactFrameBytes: new Uint8Array(),
          stateVectorBytes: new Uint8Array(),
        })
        const file = describeAcceptedFrameWalRecord(encoded, wal.validByteLength)
        const entry = Object.freeze({ file, record }) satisfies AcceptedFrameWalCheckpointEntry
        await appendAcceptedFrameWalRecord({
          target: layout.acceptedFrameWal,
          expectedByteOffset: wal.validByteLength,
          exactRecordBytes: encoded,
        })
        try {
          if (this.hooks.beforeHeadCacheInstall) await this.hooks.beforeHeadCacheInstall()
          wal.entries.push(entry)
          wal.currentHead = Object.freeze({ record: head, digest: resultingHeadDigest })
          wal.validByteLength = file.byteOffset + file.byteLength
          wal.tailAtomicCommitRecordDigest = record.atomicCommitRecordDigest
          this.invalidateMaterializedState(layout)
        } catch {
          this.acceptedFrameWalIndexes.delete(layout.directory)
          this.invalidateMaterializedState(layout)
        }
        return {
          status: "committed",
          installedCheckpointSetDigest: installedSetDigest,
          journalRecordDigest: journalDigest,
          resultingReplicaHeadRecordDigest: resultingHeadDigest,
        }
      } catch (error) {
        if (error instanceof NodeCollaborationPersistenceError && error.code === "store-corrupt") {
          return { status: "rejected", code: "store-corrupt" }
        }
        return { status: "rejected", code: "durability-failed" }
      }
    })
  }

  /**
   * Advances the journal base only after a complete root scan and an exact
   * dual-gated prune authority. Candidate bytes are removed only after the new
   * sole head is durable and a second complete root scan remains current.
   */
  async pruneCheckpointHistory(input: PruneNativeCheckpointHistory): Promise<PruneNativeCheckpointHistoryResult> {
    this.requireLive()
    validateDigest(input.expectedReplicaHeadRecordDigest, "Expected replica head digest")
    const certificateDigest = parseDigest(input.prunableSetCertificateObjectDigest)
    const floorDigest = parseDigest(input.causalFloorObjectDigest)
    if (!(input.causalFloorExactBytes instanceof Uint8Array) || input.causalFloorExactBytes.byteLength < 1 || input.causalFloorExactBytes.byteLength > 64 * 1024) {
      invalid("Causal floor object bytes are outside the 64 KiB bound")
    }
    const floorExactBytes = Uint8Array.from(input.causalFloorExactBytes)
    const candidates = normalizePrunableObjects(input.candidateDeleteObjects)
    if (candidates.length > 4_096) return { status: "postponed", code: "capacity-exceeded", deletedObjectCount: 0 }
    const deletedBytes = candidates.reduce((total, object) => total + BigInt(object.exactByteLength), 0n)
    if (deletedBytes > 512n * 1024n * 1024n) return { status: "postponed", code: "capacity-exceeded", deletedObjectCount: 0 }
    const authority = this.checkpointPruneAuthority
    const rootScanner = this.checkpointPruneRootScanner
    if (!authority || !rootScanner) invalid("Checkpoint prune authority is unavailable")
    const layout = this.layout(input.scope)
    return this.serial(layout.directory, async () => {
      try {
        await this.assertWritableDocument(layout)
        const current = await this.readDurableHead(layout, input.scope)
        if (current.digest !== input.expectedReplicaHeadRecordDigest) {
          return { status: "rejected", code: "head-stale", deletedObjectCount: 0 }
        }
        const installed = await this.readInstalledCheckpointSet(layout, current.record.installedCheckpointSetDigest, input.scope)
        if (!installed.prunableSetCertificateObjectDigests.includes(certificateDigest)) {
          return { status: "rejected", code: "verification-failed", deletedObjectCount: 0 }
        }
        const accepted = await this.reconstructHead(layout, input.scope, current.record, current.digest)
        const installedBase = await this.materializeInstalledCheckpointBase(layout, input.scope, installed)
        assertSameAcceptedState(installedBase, accepted, this.materializer)
        const firstScan = normalizePruneRootScan(await rootScanner.scanComplete({
          scope: input.scope,
          durableHeadRecordDigest: current.digest,
          installedCheckpointSetDigest: current.record.installedCheckpointSetDigest,
        }))
        if (!firstScan.complete) return { status: "postponed", code: "roots-changed", deletedObjectCount: 0 }
        const retained = new Set(firstScan.retainedObjectDigests)
        if (candidates.some((object) => retained.has(object.objectDigest))) {
          return { status: "postponed", code: "roots-changed", deletedObjectCount: 0 }
        }
        const proof = await authority.verifyCurrent({
          scope: input.scope,
          durableHeadRecordDigest: current.digest,
          installedCheckpointSetDigest: current.record.installedCheckpointSetDigest,
          prunableSetCertificateObjectDigest: certificateDigest,
          causalFloorObjectDigest: floorDigest,
          causalFloorExactBytes: floorExactBytes,
          retainedRootSetDigest: firstScan.rootSetDigest,
          candidateDeleteObjects: candidates,
        })
        if (!proof.verified) return { status: "rejected", code: "verification-failed", deletedObjectCount: 0 }
        const expectedPostBarrierRootSetDigest = parseDigest(proof.expectedPostBarrierRootSetDigest)
        const nextSequence = incrementUint64(current.record.localHeadGeneration)
        const baseRecord: LocalJournalBaseRecord = {
          format: "convax.local-journal-base",
          scope: input.scope,
          baseLocalRecordSequence: nextSequence,
          checkpointObjectDigest: installed.bootstrapCheckpointObjectDigest,
          installedCheckpointSetDigest: current.record.installedCheckpointSetDigest,
          frontier: installedBase.frontier,
          frontierDigest: installedBase.frontierDigest,
          actorHeads: installedBase.actorHeads,
          actorHeadsDigest: this.materializer.actorHeadsDigest(installedBase.actorHeads),
          canonicalStateDigest: installedBase.canonicalStateDigest,
          materializationDigest: installedBase.materializationDigest,
          fullUpdateDigest: ordinaryDigest(installedBase.fullUpdate),
          fullUpdateByteLength: String(installedBase.fullUpdate.byteLength),
          stateVectorDigest: ordinaryDigest(installedBase.stateVector),
          stateVectorByteLength: String(installedBase.stateVector.byteLength),
        }
        const baseDigest = localRecordDigest(baseRecord)
        const journalRecord: LocalJournalRecord = {
          format: "convax.local-journal-record",
          scope: input.scope,
          localRecordSequence: nextSequence,
          priorJournalRecordDigest: current.record.journalTailDigest,
          transition: "start-prunable-journal-base",
          objectDigests: [baseDigest],
          outboxRefDigest: null,
          resultingFrontierDigest: current.record.acceptedFrontierDigest,
          operationRef: null,
        }
        const journalDigest = localRecordDigest(journalRecord)
        const candidateHead: LocalDurableHead = {
          ...current.record,
          localHeadGeneration: nextSequence,
          priorHeadDigest: current.digest,
          journalBaseDigest: baseDigest,
          journalTailDigest: baseDigest,
        }
        const candidateHeadDigest = localRecordDigest(candidateHead)
        const plan: LocalPrunePlan = {
          format: "convax.local-prune-plan",
          scope: input.scope,
          expectedDurableHeadRecordDigest: current.digest,
          installedCheckpointSetDigest: current.record.installedCheckpointSetDigest,
          prunableSetCertificateObjectDigest: certificateDigest,
          causalFloorObjectDigest: floorDigest,
          retainedRootSetDigest: firstScan.rootSetDigest,
          expectedPostBarrierRootSetDigest,
          candidateDeleteObjects: candidates,
          newJournalBaseDigest: baseDigest,
          startJournalRecordDigest: journalDigest,
          candidateDurableHeadRecordDigest: candidateHeadDigest,
        }
        const planBytes = encodeRecord(plan)
        if (planBytes.byteLength > 16 * 1024 * 1024) return { status: "postponed", code: "capacity-exceeded", deletedObjectCount: 0 }
        const planDigest = localRecordDigest(plan)
        let wal = await this.loadAcceptedFrameWalIndex(
          layout,
          await this.readBaseDurableHead(layout, input.scope),
          true,
        )
        if (wal.currentHead.digest !== current.digest) corrupt("Prune WAL head changed during verification")
        if (wal.activeOutboxByFrameDigest.size !== 0) {
          return { status: "postponed", code: "roots-changed", deletedObjectCount: 0 }
        }
        wal = await this.ensureAcceptedFrameWalHeaderCurrent(
          layout,
          wal,
          accepted.materializationDigest,
        )
        const walCore: LocalAcceptedFrameWalPruneRecordCore = Object.freeze({
          format: "convax.local-accepted-frame-wal-prune-record-core",
          scope: input.scope,
          sequence: nextSequence,
          priorAtomicCommitRecordDigest: wal.tailAtomicCommitRecordDigest,
          prunePlanDigest: planDigest,
          journalBaseDigest: baseDigest,
          journalRecord,
          journalRecordDigest: journalDigest,
          expectedReplicaHeadRecordDigest: current.digest,
          resultingHeadRecord: candidateHead,
          resultingReplicaHeadRecordDigest: candidateHeadDigest,
        })
        const walRecord: LocalAcceptedFrameWalPruneRecord = Object.freeze({
          format: "convax.local-accepted-frame-wal-prune-record",
          core: walCore,
          atomicCommitRecordDigest: localRecordDigest(walCore),
        })
        const encodedWalRecord = encodeAcceptedFrameWalRecord({
          headerBytes: encodeRecord(walRecord),
          exactFrameBytes: new Uint8Array(),
          stateVectorBytes: new Uint8Array(),
        })
        const walFile = describeAcceptedFrameWalRecord(encodedWalRecord, wal.validByteLength)
        const walEntry = Object.freeze({ file: walFile, record: walRecord }) satisfies AcceptedFrameWalPruneEntry
        await putImmutableExact(layout.floors, "causal-floor", floorDigest, floorExactBytes)
        await writeJournalBase(layout.journalBases, baseDigest, baseRecord, installedBase.fullUpdate, installedBase.stateVector)
        await putImmutableRecord(layout.prunePlans, "prune-plan", planDigest, plan)
        await replaceDurableRecord(layout.activePrunePlan, activePrunePlan(input.scope, planDigest, "prepared"))
        await appendAcceptedFrameWalRecord({
          target: layout.acceptedFrameWal,
          expectedByteOffset: wal.validByteLength,
          exactRecordBytes: encodedWalRecord,
          beforeSync: this.hooks.beforeAcceptedFrameWalSync,
          afterSync: this.hooks.afterAcceptedFrameWalSync,
        })
        try {
          wal.entries.push(walEntry)
          wal.byFrameDigest.clear()
          wal.byJournalDigest.clear()
          wal.byOperation.clear()
          wal.reachableFrameDigests.clear()
          wal.currentHead = Object.freeze({ record: candidateHead, digest: candidateHeadDigest })
          wal.validByteLength = walFile.byteOffset + walFile.byteLength
          wal.tailAtomicCommitRecordDigest = walRecord.atomicCommitRecordDigest
          this.storeMaterializedHeadCache(
            layout,
            candidateHead,
            candidateHeadDigest,
            installedBase,
            createOwnedReachableFrameDigests(),
          )
        } catch {
          this.acceptedFrameWalIndexes.delete(layout.directory)
          this.invalidateMaterializedState(layout)
        }
        await replaceDurableRecord(layout.activePrunePlan, activePrunePlan(input.scope, planDigest, "head-published"))
        const secondScan = normalizePruneRootScan(await rootScanner.scanComplete({
          scope: input.scope,
          durableHeadRecordDigest: candidateHeadDigest,
          installedCheckpointSetDigest: current.record.installedCheckpointSetDigest,
        }))
        if (
          !secondScan.complete ||
          secondScan.rootSetDigest !== expectedPostBarrierRootSetDigest ||
          candidates.some((object) => secondScan.retainedObjectDigests.includes(object.objectDigest))
        ) {
          await replaceDurableRecord(layout.activePrunePlan, activePrunePlan(input.scope, planDigest, "abandoned"))
          return { status: "postponed", code: "roots-changed", deletedObjectCount: 0, prunePlanDigest: planDigest }
        }
        const deletedObjectCount = await this.deletePruneCandidates(layout, candidates)
        await replaceDurableRecord(layout.activePrunePlan, activePrunePlan(input.scope, planDigest, "deleted"))
        return { status: "deleted", deletedObjectCount, prunePlanDigest: planDigest }
      } catch (error) {
        if (error instanceof NodeCollaborationPersistenceError && error.code === "store-corrupt") {
          return { status: "rejected", code: "store-corrupt", deletedObjectCount: 0 }
        }
        return { status: "rejected", code: "durability-failed", deletedObjectCount: 0 }
      }
    })
  }

  /** Returns exact bytes and persisted delta only inside the sole durable accepted journal closure. */
  async readAcceptedFrame(scope: DocumentScope, frameDigest: Digest): Promise<NodeAcceptedFrameObject | null> {
    this.requireLive()
    validateDigest(frameDigest, "Accepted frame digest")
    const layout = this.layout(scope)
    return this.serial(layout.directory, async () => {
      await this.assertReadableDocument(layout)
      const head = await this.readDurableHead(layout, scope)
      const journals = await this.readReachableJournals(layout, scope, head.record)
      const journal = journals.find((entry) => isFrameJournal(entry.record) && entry.record.objectDigests[0] === frameDigest)
      if (!journal) return null
      const ref = await this.refForJournal(layout, journal.record)
      const exact = await this.readFrame(layout, ref)
      await this.materializer.inspectFrame(ref, exact)
      const wal = this.acceptedFrameWalIndexes.get(layout.directory) ??
        await this.loadAcceptedFrameWalIndex(layout, await this.readBaseDurableHead(layout, scope), false)
      return Object.freeze({
        ref,
        exactFrameBytes: Uint8Array.from(exact),
        durableDelta: wal.byJournalDigest.get(journal.digest)?.durableDelta,
      })
    })
  }

  /** Journal order is recovery metadata only; callers build causal closure from exact frame contexts. */
  async listAcceptedFrames(scope: DocumentScope): Promise<readonly NodeAcceptedFrameObject[]> {
    this.requireLive()
    const layout = this.layout(scope)
    return this.serial(layout.directory, async () => {
      await this.assertReadableDocument(layout)
      const head = await this.readDurableHead(layout, scope)
      const journals = await this.readReachableJournals(layout, scope, head.record)
      const wal = this.acceptedFrameWalIndexes.get(layout.directory) ??
        await this.loadAcceptedFrameWalIndex(layout, await this.readBaseDurableHead(layout, scope), false)
      const result: NodeAcceptedFrameObject[] = []
      for (const journal of journals) {
        if (!isFrameJournal(journal.record)) continue
        const ref = await this.refForJournal(layout, journal.record)
        const exactFrameBytes = await this.readFrame(layout, ref)
        const inspected = await this.materializer.inspectFrame(ref, exactFrameBytes)
        assertSameFrameRef(inspected.ref, ref)
        result.push(Object.freeze({
          ref,
          exactFrameBytes: Uint8Array.from(exactFrameBytes),
          durableDelta: wal.byJournalDigest.get(journal.digest)?.durableDelta,
        }))
      }
      return Object.freeze(result)
    })
  }

  async retainExactFrame(
    frame: DecodedCausalEditFrame,
    reason: PendingFrameReason,
  ): Promise<"retained" | "capacity-exceeded"> {
    this.requireLive()
    if (!isPendingReason(reason)) invalid("Pending frame reason is invalid")
    const ref = frameObjectRefFromDecodedFrame(frame)
    validateFrameRef(ref)
    if (!(frame.bytes instanceof Uint8Array) || frame.bytes.byteLength < 1 || frame.bytes.byteLength > MAX_FRAME_BYTES) {
      invalid("Pending frame bytes must be a non-empty causal envelope within 2 MiB")
    }
    const inspected = await this.materializer.inspectFrame(ref, frame.bytes)
    assertSameFrameRef(inspected.ref, ref)
    const layout = this.layout(ref.scope)
    return this.serial(layout.directory, async () => {
      await this.assertWritableDocument(layout)
      const target = this.pendingFramePath(layout, ref.frameDigest)
      if (await fileExists(target)) {
        const existing = await readPendingFrame(target, ref.scope)
        assertSameFrameRef(existing.record.ref, ref)
        if (!sameExactBytes(existing.exactFrameBytes, frame.bytes)) corrupt("Pending frame digest aliases different exact bytes")
        return "retained"
      }
      const capacity = await this.pendingInboxCapacity(layout, ref.actorId, frame.bytes.byteLength)
      if (!capacity) return "capacity-exceeded"
      const record: LocalPendingFrameRecord = {
        format: "convax.local-pending-frame",
        ref,
        reason,
        frameByteLength: String(frame.bytes.byteLength),
      }
      await writeDurableNewOrVerify(target, encodePendingFrame(record, frame.bytes))
      return "retained"
    })
  }

  async commitAcceptedFrame(request: CommitAcceptedFramePortRequest): Promise<CommitAcceptedFramePortResult> {
    const validated = validateAcceptedHeadMaterializationEvidence({
      previous: request.expectedHead,
      ref: request.ref,
      evidence: request.accepted,
    })
    if (validated === "rejected") return Object.freeze({ status: "rejected", code: "store-corrupt" })
    persistenceMetadataEvidenceTransitions += 1
    this.requireLive()
    if (request.outboxRequirement !== ACCEPTED_FRAME_OUTBOX_REQUIREMENT) {
      return Object.freeze({ status: "rejected", code: "store-corrupt" })
    }
    try {
      validateFrameRef(request.ref)
      validateAcceptedIdentity(request.expectedHead, request.ref.scope)
      validateDigest(request.expectedHead.headDigest, "Expected accepted-head digest")
    } catch {
      return Object.freeze({ status: "rejected", code: "store-corrupt" })
    }
    if (
      !(request.exactFrameBytes instanceof Uint8Array) ||
      request.exactFrameBytes.byteLength < 1 ||
      request.exactFrameBytes.byteLength > MAX_FRAME_BYTES
    ) return Object.freeze({ status: "rejected", code: "store-corrupt" })
    const exactFrameBytes = Uint8Array.from(request.exactFrameBytes)
    const layout = this.layout(request.ref.scope)
    const attemptId = this.currentDurabilityAttemptId(request.ref)
    return this.serial(layout.directory, async () => {
      try {
        await this.profileLocalStep(attemptId, request.ref, "atomic", "trust", () => this.assertWritableDocument(layout))
        const inspected = await this.profileLocalStep(attemptId, request.ref, "atomic", "inspect", () =>
          this.materializer.inspectFrame(request.ref, exactFrameBytes),
        )
        assertSameFrameRef(inspected.ref, request.ref)
        const requiredBlobDigests = normalizeDigestSet(inspected.requiredBlobDigests, 256)
        let wal = this.acceptedFrameWalIndexes.get(layout.directory)
        if (!wal) {
          const base = await this.profileLocalStep(attemptId, request.ref, "atomic", "read", () =>
            this.readBaseDurableHead(layout, request.ref.scope),
          )
          wal = await this.loadAcceptedFrameWalIndex(layout, base, true)
        }
        const existing = wal.byFrameDigest.get(request.ref.frameDigest)
        if (existing) {
          await this.assertAcceptedFrameWalRetry(layout, existing, request, validated.durableDelta, exactFrameBytes)
          return acceptedFrameAtomicCommitEvidence(existing)
        }
        const operationKey = operationRecoveryKey(request.ref.actorId, request.ref.operationId)
        const existingOperation = wal.byOperation.get(operationKey)
        if (existingOperation && !existingOperation.has(request.ref.frameDigest)) {
          return this.quarantineAtomicFrame(layout, request, exactFrameBytes, wal.currentHead.digest)
        }
        if (wal.currentHead.digest !== request.expectedHead.headDigest) {
          return this.quarantineAtomicFrame(layout, request, exactFrameBytes, wal.currentHead.digest)
        }
        const previousCache = await this.ensureAcceptedHeadCache(
          layout,
          request.ref.scope,
          wal.currentHead.record,
          wal.currentHead.digest,
        )
        wal = await this.ensureAcceptedFrameWalHeaderCurrent(
          layout,
          wal,
          previousCache.acceptedIdentity.materializationDigest,
        )
        assertSameAcceptedIdentity(previousCache.acceptedIdentity, request.expectedHead, this.materializer)
        const delta = validated.durableDelta
        if (
          delta.baseDurableHeadRecordDigest !== wal.currentHead.digest ||
          delta.baseMaterializationDigest !== previousCache.acceptedIdentity.materializationDigest ||
          delta.frameDigest !== request.ref.frameDigest
        ) corrupt("Accepted-frame durable delta is not bound to the current exact head")
        validateAcceptedIdentity(validated.transition, request.ref.scope)
        if (!sameAcceptedTransitionAndDelta(validated.transition, delta, this.materializer)) {
          corrupt("Accepted-frame transition differs from its durable delta")
        }
        await this.profileLocalStep(attemptId, request.ref, "atomic", "capacity", () =>
          this.assertOutboxCapacity(layout, exactFrameBytes.byteLength),
        )
        const outboxRecord: LocalReplicationOutboxRef = Object.freeze({
          format: "convax.local-replication-outbox-ref",
          scope: request.ref.scope,
          frameDigest: request.ref.frameDigest,
          actorId: request.ref.actorId,
          actorSequence: request.ref.actorSequence,
          operationId: request.ref.operationId,
          requiredBlobDigests,
        })
        const exactFrameSha256 = ordinaryDigest(exactFrameBytes)
        const exactFrameByteLength = String(exactFrameBytes.byteLength)
        const frameRecordDigest = acceptedFrameRecordDigest(request.ref, exactFrameSha256, exactFrameByteLength)
        const outboxRecordDigest = localRecordDigest(outboxRecord)
        const sequence = incrementUint64(wal.currentHead.record.localHeadGeneration)
        const journalRecord: LocalJournalRecord = Object.freeze({
          format: "convax.local-journal-record",
          scope: request.ref.scope,
          localRecordSequence: sequence,
          priorJournalRecordDigest: wal.currentHead.record.journalTailDigest,
          transition: request.ref.actorId === this.localActorId ? "accept-local-frame" : "accept-remote-frame",
          objectDigests: [request.ref.frameDigest],
          outboxRefDigest: outboxRecordDigest,
          resultingFrontierDigest: delta.resultingFrontierDigest,
          operationRef: { actorId: request.ref.actorId, operationId: request.ref.operationId },
        })
        const journalRecordDigest = localRecordDigest(journalRecord)
        const resultingHeadRecord: LocalDurableHead = Object.freeze({
          format: "convax.local-durable-head",
          scope: request.ref.scope,
          localHeadGeneration: sequence,
          priorHeadDigest: wal.currentHead.digest,
          journalBaseDigest: wal.currentHead.record.journalBaseDigest,
          journalTailDigest: journalRecordDigest,
          installedCheckpointSetDigest: wal.currentHead.record.installedCheckpointSetDigest,
          acceptedFrontierDigest: delta.resultingFrontierDigest,
          acceptedActorHeadsDigest: delta.resultingActorHeadsDigest,
        })
        const resultingReplicaHeadRecordDigest = localRecordDigest(resultingHeadRecord)
        const core: LocalAcceptedFrameWalRecordCore = Object.freeze({
          format: "convax.local-accepted-frame-wal-record-core",
          scope: request.ref.scope,
          sequence,
          priorAtomicCommitRecordDigest: wal.tailAtomicCommitRecordDigest,
          ref: request.ref,
          exactFrameSha256,
          exactFrameByteLength,
          durableDelta: serializeAcceptedFrameWalDurableDelta(delta),
          frameRecordDigest,
          outboxRecord,
          outboxRecordDigest,
          journalRecord,
          journalRecordDigest,
          expectedReplicaHeadRecordDigest: wal.currentHead.digest,
          resultingHeadRecord,
          resultingReplicaHeadRecordDigest,
        })
        const record: LocalAcceptedFrameWalRecord = Object.freeze({
          format: "convax.local-accepted-frame-wal-record",
          core,
          atomicCommitRecordDigest: localRecordDigest(core),
        })
        const recordHeaderBytes = await this.profileLocalStep(attemptId, request.ref, "atomic", "encode", () =>
          encodeRecord(record),
        )
        const encoded = encodeAcceptedFrameWalRecord({
          headerBytes: recordHeaderBytes,
          exactFrameBytes,
          stateVectorBytes: delta.stateVector,
        })
        const expectedByteOffset = wal.validByteLength
        const file = describeAcceptedFrameWalRecord(encoded, expectedByteOffset)
        const entry = Object.freeze({ file, record, durableDelta: delta }) satisfies AcceptedFrameWalEntry
        const committed = acceptedFrameAtomicCommitEvidence(entry)
        const identity = freezeOwnedHeadIdentity(validated.transition, resultingReplicaHeadRecordDigest)
        const preparedDeltaTail: AcceptedHeadDeltaRefNode = Object.freeze({
          previous: previousCache.deltaTail,
          ref: Object.freeze({ ...request.ref, scope: request.ref.scope }),
          identity,
          durableDelta: delta,
        })
        await this.ensureOperationRecoveryIndex()
        persistenceAtomicAppends += 1
        try {
          await appendAcceptedFrameWalRecord({
            target: layout.acceptedFrameWal,
            expectedByteOffset,
            exactRecordBytes: encoded,
            beforeSync: this.hooks.beforeAcceptedFrameWalSync,
            afterSync: this.hooks.afterAcceptedFrameWalSync,
            sync: async (operation) => {
              persistenceAtomicFileSyncs += 1
              await measureSync(
                operation,
                "file-sync",
                this.measurement(attemptId, request.ref, "accepted-frame-wal"),
                this.durabilityDiagnostics,
              )
            },
          })
        } catch (error) {
          this.acceptedFrameWalIndexes.delete(layout.directory)
          this.operationRecoveryIndex = null
          this.operationRecoveryIndexWarmup = null
          this.invalidateMaterializedState(layout)
          this.outboxUsageCaches.delete(layout.directory)
          wal = await this.loadAcceptedFrameWalIndex(layout, wal.baseHead, true)
          const recovered = wal.byFrameDigest.get(request.ref.frameDigest)
          if (recovered) {
            await this.assertAcceptedFrameWalRetry(layout, recovered, request, delta, exactFrameBytes)
            return acceptedFrameAtomicCommitEvidence(recovered)
          }
          throw error
        }
        try {
          this.appendAcceptedFrameWalIndexEntry(wal, entry)
          await this.hooks.beforeAtomicOperationIndexInstall?.()
          this.addOperationRecoveryIndexEntry({ ref: request.ref, layout })
          this.recordOutboxPut(layout, request.ref.frameDigest, exactFrameBytes.byteLength)
          previousCache.reachableFrameDigests.add(request.ref.frameDigest)
          persistenceDeltaRefAppends += 1
          await this.hooks.beforeAtomicHeadCacheInstall?.()
          this.installTransferredDeltaHeadCache(
            layout,
            resultingHeadRecord,
            resultingReplicaHeadRecordDigest,
            identity,
            previousCache.materializedBase,
            preparedDeltaTail,
            previousCache.deltaLength + 1,
            previousCache.reachableFrameDigests,
          )
          this.observeAcceptedFrame(request.ref, exactFrameBytes, delta)
        } catch {
          // The one file barrier is the commit point. Every structure below is a
          // disposable acceleration and can only be invalidated after success.
          this.acceptedFrameWalIndexes.delete(layout.directory)
          this.operationRecoveryIndex = null
          this.operationRecoveryIndexWarmup = null
          this.invalidateMaterializedState(layout)
          this.outboxUsageCaches.delete(layout.directory)
        }
        return committed
      } catch (error) {
        if (error instanceof NodeCollaborationPersistenceError && error.code === "store-corrupt") {
          return Object.freeze({ status: "rejected", code: "store-corrupt" })
        }
        return Object.freeze({ status: "rejected", code: "durability-failed" })
      }
    })
  }

  private async assertAcceptedFrameWalRetry(
    layout: DocumentLayout,
    entry: AcceptedFrameWalEntry,
    request: CommitAcceptedFramePortRequest,
    durableDelta: AcceptedHeadDurableDeltaMetadata,
    exactFrameBytes: Readonly<Uint8Array>,
  ): Promise<void> {
    const core = entry.record.core
    assertSameFrameRef(core.ref, request.ref)
    if (
      core.expectedReplicaHeadRecordDigest !== request.expectedHead.headDigest ||
      request.outboxRequirement !== ACCEPTED_FRAME_OUTBOX_REQUIREMENT ||
      !sameAcceptedHeadDurableDelta(entry.durableDelta, durableDelta, this.materializer)
    ) corrupt("Accepted-frame retry differs from the committed atomic request")
    const committedBytes = await readAcceptedFrameWalBytes(
      layout.acceptedFrameWal,
      entry.file.exactFrameByteOffset,
      entry.file.exactFrameByteLength,
    )
    if (!sameExactBytes(committedBytes, exactFrameBytes)) {
      corrupt("Accepted-frame retry exact bytes differ from the committed atomic request")
    }
  }

  private appendAcceptedFrameWalIndexEntry(
    index: AcceptedFrameWalIndex,
    entry: AcceptedFrameWalEntry,
  ): void {
    const core = entry.record.core
    index.entries.push(entry)
    index.byFrameDigest.set(core.ref.frameDigest, entry)
    index.byJournalDigest.set(core.journalRecordDigest, entry)
    const operationKey = operationRecoveryKey(core.ref.actorId, core.ref.operationId)
    let operation = index.byOperation.get(operationKey)
    if (!operation) {
      operation = new Map()
      index.byOperation.set(operationKey, operation)
    }
    operation.set(core.ref.frameDigest, entry)
    index.activeOutboxByFrameDigest.set(core.ref.frameDigest, entry)
    index.reachableFrameDigests.add(core.ref.frameDigest)
    index.currentHead = Object.freeze({
      record: core.resultingHeadRecord,
      digest: core.resultingReplicaHeadRecordDigest,
    })
    index.validByteLength = entry.file.byteOffset + entry.file.byteLength
    index.tailAtomicCommitRecordDigest = entry.record.atomicCommitRecordDigest
  }

  private async quarantineAtomicFrame(
    layout: DocumentLayout,
    request: CommitAcceptedFramePortRequest,
    exactFrameBytes: Readonly<Uint8Array>,
    observedHeadDigest: Digest,
  ): Promise<CommitAcceptedFramePortResult> {
    const exactFrameSha256 = ordinaryDigest(exactFrameBytes)
    const quarantinedFrameRecordDigest = acceptedFrameRecordDigest(
      request.ref,
      exactFrameSha256,
      String(exactFrameBytes.byteLength),
    )
    await putImmutableExact(
      layout.quarantine,
      "quarantined-frame",
      quarantinedFrameRecordDigest,
      exactFrameBytes,
    )
    const quarantine = await this.writeQuarantine(
      layout,
      request.ref.scope,
      request.ref.frameDigest,
      "stale-replica-head",
      observedHeadDigest,
      null,
    )
    const atomicCommitRecordDigest = localRecordDigest({
      format: "convax.local-atomic-quarantine-record",
      ref: request.ref,
      expectedReplicaHeadRecordDigest: request.expectedHead.headDigest,
      observedReplicaHeadRecordDigest: observedHeadDigest,
      quarantinedFrameRecordDigest,
      quarantineCommitRecordDigest: quarantine.quarantineDigest,
      shardDispositionHeadRecordDigest: quarantine.dispositionDigest,
    })
    return Object.freeze({
      status: "quarantined",
      evidence: Object.freeze({
        format: "convax.accepted-frame-atomic-quarantine-evidence",
        ref: request.ref,
        expectedReplicaHeadRecordDigest: request.expectedHead.headDigest,
        observedReplicaHeadRecordDigest: observedHeadDigest,
        quarantinedFrameRecordDigest,
        quarantineCommitRecordDigest: quarantine.quarantineDigest,
        shardDispositionHeadRecordDigest: quarantine.dispositionDigest,
        atomicCommitRecordDigest,
      }),
    })
  }

  async putImmutableFrame(ref: FrameObjectRef, exactBytes: Readonly<Uint8Array>): Promise<void> {
    this.requireLive()
    validateFrameRef(ref)
    if (!(exactBytes instanceof Uint8Array) || exactBytes.byteLength < 1 || exactBytes.byteLength > MAX_FRAME_BYTES) {
      invalid("Frame bytes must be a non-empty causal envelope within 2 MiB")
    }
    const layout = this.layout(ref.scope)
    const attemptId = this.currentDurabilityAttemptId(ref)
    await this.serial(layout.directory, async () => {
      await this.profileLocalStep(attemptId, ref, "object", "trust", () => this.assertWritableDocument(layout))
      const inspected = await this.profileLocalStep(attemptId, ref, "object", "inspect", () =>
        this.materializer.inspectFrame(ref, exactBytes),
      )
      assertSameFrameRef(inspected.ref, ref)
      await putImmutableExact(
        layout.frames,
        "frame",
        ref.frameDigest,
        exactBytes,
        this.measurement(attemptId, ref, "object-frame"),
        this.durabilityDiagnostics,
      )
      const operationDirectory = path.join(layout.operationRefs, operationIndexKey(ref.actorId, ref.operationId))
      await ensureTrustedDirectory(operationDirectory, this.collaborationDirectory)
      const operationRef: LocalOperationObjectRef = { format: "convax.local-operation-object-ref", ref }
      await putImmutableRecord(
        operationDirectory,
        "operation-ref",
        ref.frameDigest,
        operationRef,
        this.measurement(attemptId, ref, "object-operation-sidecar"),
        this.durabilityDiagnostics,
      )
      await this.profileLocalStep(attemptId, ref, "object", "cache", async () => {
        await this.ensureOperationRecoveryIndex()
        this.addOperationRecoveryIndexEntry({ ref, layout })
      })
      // The operation sidecar is part of the immutable-object durability barrier:
      // recovery must be able to rediscover opaque frame paths by actor/operation.
      await this.hooks.afterFrameFileFsync?.()
    })
  }

  async putReplicationOutboxRef(ref: FrameObjectRef): Promise<void> {
    this.requireLive()
    validateFrameRef(ref)
    const layout = this.layout(ref.scope)
    const attemptId = this.currentDurabilityAttemptId(ref)
    await this.serial(layout.directory, async () => {
      await this.profileLocalStep(attemptId, ref, "outbox", "trust", () => this.assertWritableDocument(layout))
      const { bytes: frame, inspected } = await this.profileLocalStep(attemptId, ref, "outbox", "read", () =>
        this.readInspectedFrame(layout, ref),
      )
      const requiredBlobDigests = normalizeDigestSet(inspected.requiredBlobDigests, 256)
      const record: LocalReplicationOutboxRef = {
        format: "convax.local-replication-outbox-ref",
        scope: ref.scope,
        frameDigest: ref.frameDigest,
        actorId: ref.actorId,
        actorSequence: ref.actorSequence,
        operationId: ref.operationId,
        requiredBlobDigests,
      }
      const target = path.join(layout.outboxFrames, `${deriveObjectNativeKey("outbox-ref", ref.frameDigest)}.ref`)
      const exists = await fileExists(target)
      if (!exists) await this.profileLocalStep(attemptId, ref, "outbox", "capacity", () =>
        this.assertOutboxCapacity(layout, frame.byteLength),
      )
      const encodedRecord = await this.profileLocalStep(attemptId, ref, "outbox", "encode", () => encodeRecord(record))
      await writeDurableNewOrVerify(
        target,
        encodedRecord,
        this.measurement(attemptId, ref, "outbox"),
        this.durabilityDiagnostics,
      )
      if (!exists) this.recordOutboxPut(layout, ref.frameDigest, frame.byteLength)
      await this.hooks.afterOutboxFileFsync?.()
    })
  }

  async appendFrameJournal(
    ref: FrameObjectRef,
    materialization?: AcceptedHeadMaterializationEvidence,
  ): Promise<JournalAppendPortEvidence> {
    this.requireLive()
    validateFrameRef(ref)
    const layout = this.layout(ref.scope)
    const attemptId = this.currentDurabilityAttemptId(ref)
    return this.serial(layout.directory, async () => {
      await this.profileLocalStep(attemptId, ref, "journal", "trust", () => this.assertWritableDocument(layout))
      const head = await this.profileLocalStep(attemptId, ref, "journal", "read", () =>
        this.readDurableHead(layout, ref.scope),
      )
      const nextSequence = incrementUint64(head.record.localHeadGeneration)
      const target = path.join(layout.journalSegments, deriveJournalSegmentNativeKey(nextSequence))
      if (await fileExists(target)) {
        const existing = await readJournalRecord(target, ref.scope)
        assertJournalRef(existing.record, ref)
        return Object.freeze({ ref, journalRecordDigest: existing.digest })
      }
      const frame = await this.profileLocalStep(attemptId, ref, "journal", "read", () => this.readFrame(layout, ref))
      const outbox = await this.profileLocalStep(attemptId, ref, "journal", "read", () => this.readOutbox(layout, ref))
      const previousCache = await this.profileLocalStep(attemptId, ref, "journal", "cache", () =>
        this.ensureAcceptedHeadCache(layout, ref.scope, head.record, head.digest),
      )
      const validated = materialization
        ? validateAcceptedHeadMaterializationEvidence({ previous: previousCache.acceptedIdentity, ref, evidence: materialization })
        : "rejected"
      const prepared = validated === "rejected" ? "rejected" : validated.transition
      const durableDelta = validated === "rejected" ? undefined : validated.durableDelta
      let next: AcceptedHeadTransitionView | NodeAcceptedReplicaHead
      let materializedNext: NodeAcceptedReplicaHead | undefined
      if (prepared === "rejected") {
        const previous = await this.reconstructHead(layout, ref.scope, head.record, head.digest)
        materializedNext = await this.materializeAcceptedFrame({ previous, ref, exactBytes: frame })
        validateAcceptedBase(materializedNext, ref.scope)
        next = materializedNext
      } else {
        next = prepared
        validateAcceptedIdentity(next, ref.scope)
        persistenceMetadataEvidenceTransitions += 1
      }
      const record: LocalJournalRecord = {
        format: "convax.local-journal-record",
        scope: ref.scope,
        localRecordSequence: nextSequence,
        priorJournalRecordDigest: head.record.journalTailDigest,
        transition: ref.actorId === this.localActorId ? "accept-local-frame" : "accept-remote-frame",
        objectDigests: [ref.frameDigest],
        outboxRefDigest: localRecordDigest(outbox),
        resultingFrontierDigest: next.frontierDigest,
        operationRef: { actorId: ref.actorId, operationId: ref.operationId },
      }
      const journalRecordDigest = localRecordDigest(record)
      const measurement = this.measurement(attemptId, ref, "journal")
      const encodedRecord = await this.profileLocalStep(attemptId, ref, "journal", "encode", () => encodeRecord(record))
      await writeDurableNewFile(target, encodedRecord, measurement, this.durabilityDiagnostics)
      await this.hooks.afterJournalFileFsync?.()
      const pendingBase = {
        expectedHeadDigest: head.digest,
        priorJournalTailDigest: head.record.journalTailDigest,
        journalRecordDigest,
        frameDigest: ref.frameDigest,
        resultingFrontierDigest: next.frontierDigest,
        reachableFrameDigests: previousCache.reachableFrameDigests,
      }
      this.pendingHeadTransitions.set(
        layout.directory,
        prepared === "rejected"
          ? Object.freeze({ ...pendingBase, kind: "materialized" as const, acceptedHead: freezeOwnedHead(materializedNext!, head.digest) })
          : Object.freeze({
              ...pendingBase,
              kind: "metadata-delta" as const,
              transition: prepared,
              durableDelta: durableDelta!,
              previousCache,
            }),
      )
      return Object.freeze({ ref, journalRecordDigest })
    })
  }

  async compareAndCommitReplicaHead(input: {
    readonly ref: FrameObjectRef
    readonly journal: JournalAppendPortEvidence
    readonly expectedReplicaHeadRecordDigest: Digest
    readonly resultingFrontierDigest: Digest
  }): Promise<CompareAndCommitReplicaHeadPortResult> {
    this.requireLive()
    validateFrameRef(input.ref)
    assertSameFrameRef(input.journal.ref, input.ref)
    validateDigest(input.journal.journalRecordDigest, "Journal record digest")
    validateDigest(input.expectedReplicaHeadRecordDigest, "Expected replica head digest")
    validateDigest(input.resultingFrontierDigest, "Resulting frontier digest")
    const layout = this.layout(input.ref.scope)
    const attemptId = this.currentDurabilityAttemptId(input.ref)
    return this.serial(layout.directory, async () => {
      try {
        await this.profileLocalStep(attemptId, input.ref, "head", "trust", () => this.assertWritableDocument(layout))
        const current = await this.profileLocalStep(attemptId, input.ref, "head", "read", () =>
          this.readDurableHead(layout, input.ref.scope),
        )
        if (current.digest !== input.expectedReplicaHeadRecordDigest) {
          if (
            current.record.priorHeadDigest === input.expectedReplicaHeadRecordDigest &&
            current.record.journalTailDigest === input.journal.journalRecordDigest &&
            current.record.acceptedFrontierDigest === input.resultingFrontierDigest
          ) {
            this.pendingHeadTransitions.delete(layout.directory)
            return committedEvidence(input, current.digest)
          }
          this.pendingHeadTransitions.delete(layout.directory)
          return await this.quarantineStaleHead(layout, input, current.digest)
        }
        const sequence = incrementUint64(current.record.localHeadGeneration)
        const journal = await this.profileLocalStep(attemptId, input.ref, "head", "read", () =>
          readJournalRecord(
            path.join(layout.journalSegments, deriveJournalSegmentNativeKey(sequence)),
            input.ref.scope,
          ),
        )
        if (journal.digest !== input.journal.journalRecordDigest) corrupt("Journal evidence does not name the next durable record")
        assertJournalRef(journal.record, input.ref)
        if (journal.record.priorJournalRecordDigest !== current.record.journalTailDigest) corrupt("Journal predecessor differs from the sole durable head")
        if (journal.record.resultingFrontierDigest !== input.resultingFrontierDigest) corrupt("Journal frontier differs from the Kernel result")
        const frame = await this.profileLocalStep(attemptId, input.ref, "head", "read", () =>
          this.readFrame(layout, input.ref),
        )
        await this.profileLocalStep(attemptId, input.ref, "head", "read", () => this.readOutbox(layout, input.ref))
        const pending = this.pendingHeadTransitions.get(layout.directory)
        let nextIdentity: AcceptedHeadIdentityView | AcceptedHeadTransitionView
        let transferredNext: InternallyOwnedAcceptedHead | undefined
        let transferredDelta: Readonly<{
          previousCache: VerifiedMaterializedHeadCache
          transition: AcceptedHeadTransitionView
          durableDelta: AcceptedHeadDurableDeltaMetadata
        }> | undefined
        let reachableFrameDigests: InternallyOwnedReachableFrameDigests
        if (
          pending &&
          pending.expectedHeadDigest === current.digest &&
          pending.priorJournalTailDigest === current.record.journalTailDigest &&
          pending.journalRecordDigest === journal.digest &&
          pending.frameDigest === input.ref.frameDigest &&
          pending.resultingFrontierDigest === input.resultingFrontierDigest
        ) {
          if (pending.kind === "metadata-delta") {
            if (
              this.materializedHeadCaches.get(layout.directory) !== pending.previousCache ||
              !this.materializedHeadCacheMatches(pending.previousCache, current.record, current.digest)
            ) corrupt("Pending metadata transition lost its exact accepted base")
            transferredDelta = Object.freeze({
              previousCache: pending.previousCache,
              transition: pending.transition,
              durableDelta: pending.durableDelta,
            })
            nextIdentity = pending.transition
          } else {
            transferredNext = pending.acceptedHead
            nextIdentity = pending.acceptedHead
          }
          reachableFrameDigests = pending.reachableFrameDigests
        } else {
          this.pendingHeadTransitions.delete(layout.directory)
          const previous = await this.reconstructHead(layout, input.ref.scope, current.record, current.digest)
          const previousCache = this.requireMaterializedHeadCache(layout, current.record, current.digest)
          const next = await this.materializeAcceptedFrame({ previous, ref: input.ref, exactBytes: frame })
          transferredNext = freezeOwnedHead(next, current.digest)
          nextIdentity = transferredNext
          reachableFrameDigests = previousCache.reachableFrameDigests
        }
        validateAcceptedIdentity(nextIdentity, input.ref.scope)
        if (nextIdentity.frontierDigest !== input.resultingFrontierDigest) corrupt("Accepted frontier differs from journal and Kernel")
        const head: LocalDurableHead = {
          format: "convax.local-durable-head",
          scope: input.ref.scope,
          localHeadGeneration: sequence,
          priorHeadDigest: current.digest,
          journalBaseDigest: current.record.journalBaseDigest,
          journalTailDigest: journal.digest,
          installedCheckpointSetDigest: current.record.installedCheckpointSetDigest,
          acceptedFrontierDigest: nextIdentity.frontierDigest,
          acceptedActorHeadsDigest: this.materializer.actorHeadsDigest(nextIdentity.actorHeads),
        }
        const headDigest = localRecordDigest(head)
        const ownedNext = transferredNext === undefined ? undefined : rebindOwnedHead(transferredNext, headDigest)
        const ownedNextIdentity = transferredDelta === undefined
          ? undefined
          : freezeOwnedHeadIdentity(transferredDelta.transition, headDigest)
        if (ownedNext !== undefined) this.assertMaterializedHeadCacheMatches(head, ownedNext)
        if (ownedNextIdentity !== undefined) this.assertAcceptedHeadIdentityMatches(head, ownedNextIdentity)
        await replaceDurableRecord(
          layout.durableHead,
          head,
          this.hooks,
          this.measurement(attemptId, input.ref, "head"),
          this.durabilityDiagnostics,
        )
        this.adoptLegacyDurableHead(layout, head, headDigest, nextIdentity.materializationDigest)
        await this.profileLocalStep(attemptId, input.ref, "head", "cache", async () => {
          try {
            if (this.hooks.beforeHeadCacheInstall) await this.hooks.beforeHeadCacheInstall()
            reachableFrameDigests.add(input.ref.frameDigest)
            if (transferredDelta !== undefined && ownedNextIdentity !== undefined) {
              const deltaTail = appendAcceptedHeadDeltaRef(
                transferredDelta.previousCache.deltaTail,
                input.ref,
                ownedNextIdentity,
                transferredDelta.durableDelta,
              )
              this.installTransferredDeltaHeadCache(
                layout,
                head,
                headDigest,
                ownedNextIdentity,
                transferredDelta.previousCache.materializedBase,
                deltaTail,
                transferredDelta.previousCache.deltaLength + 1,
                reachableFrameDigests,
              )
            } else if (ownedNext !== undefined) {
              this.installTransferredMaterializedHeadCache(layout, head, headDigest, ownedNext, reachableFrameDigests)
            } else {
              corrupt("Accepted transition cache is absent")
            }
          } catch {
            this.invalidateMaterializedState(layout)
          }
          this.pendingHeadTransitions.delete(layout.directory)
          this.observeAcceptedFrame(input.ref, frame, transferredDelta?.durableDelta)
        })
        return committedEvidence(input, headDigest)
      } catch (error) {
        this.pendingHeadTransitions.delete(layout.directory)
        if (error instanceof NodeCollaborationPersistenceError && error.code === "store-corrupt") {
          return { status: "rejected", code: "store-corrupt" }
        }
        return { status: "rejected", code: "durability-failed" }
      }
    })
  }

  private measurement(
    attemptId: string | undefined,
    ref: FrameObjectRef,
    stage: NodeLocalCommitDurabilityStage,
  ): DurabilityMeasurementContext | undefined {
    return attemptId === undefined ? undefined : { attemptId, operationId: ref.operationId, stage }
  }

  private currentDurabilityAttemptId(ref: FrameObjectRef): string | undefined {
    try {
      return this.durabilityDiagnostics?.currentAttemptId(ref)
    } catch {
      return undefined
    }
  }

  private async profileLocalStep<T>(
    attemptId: string | undefined,
    ref: FrameObjectRef,
    stage: NodeLocalCommitStepMeasurement["stage"],
    step: NodeLocalCommitStep,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const started = process.hrtime.bigint()
    let outcome: NodeLocalCommitStepMeasurement["outcome"] = "succeeded"
    try {
      return await operation()
    } catch (error) {
      outcome = "failed"
      throw error
    } finally {
      if (attemptId !== undefined && this.durabilityDiagnostics?.observeLocalStep) {
        try {
          this.durabilityDiagnostics.observeLocalStep({
            attemptId,
            durationNanoseconds: process.hrtime.bigint() - started,
            operationId: ref.operationId,
            outcome,
            stage,
            step,
          })
        } catch { /* Diagnostics never affect a durable commit. */ }
      }
    }
  }

  async isReachableFromAcceptedHead(ref: FrameObjectRef): Promise<boolean> {
    this.requireLive()
    const layout = this.layout(ref.scope)
    return this.serial(layout.directory, async () => {
      const head = await this.readDurableHead(layout, ref.scope)
      const cached = this.materializedHeadCaches.get(layout.directory)
      if (cached && this.materializedHeadCacheMatches(cached, head.record, head.digest)) {
        return cached.reachableFrameDigests.has(ref.frameDigest)
      }
      await this.reconstructHead(layout, ref.scope, head.record, head.digest)
      return this.requireMaterializedHeadCache(layout, head.record, head.digest).reachableFrameDigests.has(ref.frameDigest)
    })
  }

  async lookupOperation(actorId: ActorId, operationId: Id128): Promise<OperationLookup> {
    this.requireLive()
    await this.ensureOperationRecoveryIndex()
    const unique = this.operationRecoveryIndex?.get(operationRecoveryKey(actorId, operationId))
    if (!unique || unique.size === 0) return { status: "absent" }
    if (unique.size > 1) return { status: "equivocation", frameDigests: [...unique.keys()].sort() }
    const entry = [...unique.values()][0]
    if (!entry) corrupt("Operation index lost its only frame")
    return this.serial(entry.layout.directory, async () => {
      const bytes = await this.readFrame(entry.layout, entry.ref)
      const durable = await this.readDurableHead(entry.layout, entry.ref.scope)
      let cache = this.materializedHeadCaches.get(entry.layout.directory)
      if (!cache || !this.materializedHeadCacheMatches(cache, durable.record, durable.digest)) {
        await this.reconstructHead(entry.layout, entry.ref.scope, durable.record, durable.digest)
        cache = this.requireMaterializedHeadCache(entry.layout, durable.record, durable.digest)
      }
      const reachable = cache.reachableFrameDigests.has(entry.ref.frameDigest)
      if (reachable) return { status: "accepted", ref: entry.ref, bytes }
      const wal = this.acceptedFrameWalIndexes.get(entry.layout.directory)
      const hasOutbox = Boolean(wal?.activeOutboxByFrameDigest.has(entry.ref.frameDigest)) ||
        await fileExists(this.outboxPath(entry.layout, entry.ref))
      const nextSequence = incrementUint64(durable.record.localHeadGeneration)
      const nextPath = path.join(entry.layout.journalSegments, deriveJournalSegmentNativeKey(nextSequence))
      let hasJournal = false
      if (await fileExists(nextPath)) {
        const journal = await readJournalRecord(nextPath, entry.ref.scope)
        hasJournal = isFrameJournal(journal.record) && journal.record.objectDigests[0] === entry.ref.frameDigest
      }
      return {
        status: hasOutbox && hasJournal ? "same-frame-recovery" : "object-only-recovery",
        ref: entry.ref,
        bytes,
      }
    })
  }

  async scanDurableReferences(frameDigest: Digest): Promise<{ readonly complete: boolean; readonly reachable: boolean }> {
    this.requireLive()
    validateDigest(frameDigest, "Frame digest")
    const documents = path.join(this.collaborationDirectory, "documents")
    let reachable = false
    try {
      for (const documentName of await readDocumentDirectoryNames(documents)) {
        const layout = this.layoutFromDirectory(path.join(documents, documentName))
        for (const name of await readDirectoryNames(layout.journalSegments)) {
          const loaded = await readJournalRecord(path.join(layout.journalSegments, name))
          if (isFrameJournal(loaded.record) && loaded.record.objectDigests.includes(frameDigest)) reachable = true
        }
        for (const name of await readDirectoryNames(layout.outboxFrames)) {
          const record = parseOutbox(decodeRecord(await fs.readFile(path.join(layout.outboxFrames, name))))
          if (record.frameDigest === frameDigest) reachable = true
        }
        const wal = this.acceptedFrameWalIndexes.get(layout.directory) ??
          await this.loadAcceptedFrameWalIndex(layout, await this.readBaseDurableHead(layout), false)
        if (
          wal.byFrameDigest.has(frameDigest) ||
          wal.activeOutboxByFrameDigest.has(frameDigest)
        ) reachable = true
        for (const name of await readDirectoryNames(layout.quarantine)) {
          const record = parseQuarantine(decodeRecord(await fs.readFile(path.join(layout.quarantine, name))))
          if (record.frameDigest === frameDigest) reachable = true
        }
      }
      return { complete: true, reachable }
    } catch {
      return { complete: false, reachable: true }
    }
  }

  async quarantineExactObject(frameDigest: Digest, reason: KernelQuarantineReason): Promise<void> {
    this.requireLive()
    validateDigest(frameDigest, "Frame digest")
    const documents = path.join(this.collaborationDirectory, "documents")
    let found = false
    for (const documentName of await readDocumentDirectoryNames(documents)) {
      const layout = this.layoutFromDirectory(path.join(documents, documentName))
      const framePath = path.join(layout.frames, `${deriveObjectNativeKey("frame", frameDigest)}.bin`)
      const wal = this.acceptedFrameWalIndexes.get(layout.directory) ??
        await this.loadAcceptedFrameWalIndex(layout, await this.readBaseDurableHead(layout), false)
      if (!(await fileExists(framePath)) && !wal.byFrameDigest.has(frameDigest)) continue
      found = true
      await this.serial(layout.directory, async () => {
        const head = await this.readDurableHead(layout)
        await this.writeQuarantine(layout, head.record.scope, frameDigest, reason, head.digest, null)
      })
    }
    if (!found) corrupt("Cannot quarantine an unknown frame object")
  }

  async isFrameDurableForAck(ref: FrameObjectRef): Promise<boolean> {
    this.requireLive()
    validateFrameRef(ref)
    const layout = this.layout(ref.scope)
    return this.serial(layout.directory, async () => {
      if (await fileExists(layout.dispositionHead)) return false
      const durable = await this.readDurableHead(layout, ref.scope)
      const records = await this.readReachableJournals(layout, ref.scope, durable.record)
      if (!records.some((entry) => isFrameJournal(entry.record) && entry.record.objectDigests.includes(ref.frameDigest))) return false
      const loaded = await this.reconstructHead(layout, ref.scope, durable.record, durable.digest)
      return loaded.headDigest === durable.digest
    })
  }

  /**
   * Enumerates only locally accepted, durable frame objects that remain in the
   * replication outbox. ACK retirement is a separate policy; this reader never
   * mutates or silently skips malformed, orphaned, or over-capacity entries.
   */
  async listDurableReplicationOutbox(scope: DocumentScope): Promise<readonly NodeDurableReplicationOutboxEntry[]> {
    this.requireLive()
    const layout = this.layout(scope)
    return this.serial(layout.directory, async () => {
      await this.assertReadableDocument(layout)
      if (await fileExists(layout.dispositionHead)) {
        recoverRequired("Cannot advertise frames from a quarantined collaboration shard")
      }
      const names = [...await readDirectoryNames(layout.outboxFrames)].sort()
      const wal = this.acceptedFrameWalIndexes.get(layout.directory) ??
        await this.loadAcceptedFrameWalIndex(layout, await this.readBaseDurableHead(layout, scope), false)
      if (names.length + wal.activeOutboxByFrameDigest.size > MAX_OUTBOX_FRAMES) {
        corrupt("Local frame outbox exceeds 4,096 refs")
      }
      const durable = await this.readDurableHead(layout, scope)
      await this.reconstructHead(layout, scope, durable.record, durable.digest)
      const reachableFrameDigests = this.requireMaterializedHeadCache(layout, durable.record, durable.digest)
        .reachableFrameDigests
      const usage = await this.loadOutboxUsage(layout)
      if (usage.frameBytes.size !== names.length + wal.activeOutboxByFrameDigest.size || usage.totalBytes > MAX_OUTBOX_BYTES) {
        corrupt("Local frame outbox usage cache disagrees with durable refs")
      }
      const entries = await mapWithConcurrency(names, 8, async (name): Promise<NodeDurableReplicationOutboxEntry> => {
        const record = parseOutbox(decodeRecord(await fs.readFile(path.join(layout.outboxFrames, name))))
        assertSameScope(record.scope, scope)
        const ref: FrameObjectRef = Object.freeze({
          scope: record.scope,
          frameDigest: record.frameDigest,
          actorId: record.actorId,
          actorSequence: parseUint64(record.actorSequence),
          operationId: record.operationId,
        })
        validateFrameRef(ref)
        if (path.basename(this.outboxPath(layout, ref)) !== name) corrupt("Outbox filename and frame digest differ")
        assertOutboxRef(record, ref)
        if (!reachableFrameDigests.has(ref.frameDigest)) {
          recoverRequired("Replication outbox references a frame outside the sole durable head")
        }
        const exactFrameBytes = await this.readFrame(layout, ref)
        if (usage.frameBytes.get(ref.frameDigest) !== exactFrameBytes.byteLength) {
          corrupt("Local frame outbox usage changed after validation")
        }
        return Object.freeze({
          ref,
          exactFrameBytes,
          requiredBlobDigests: Object.freeze([...record.requiredBlobDigests]),
        })
      })
      const walEntries: NodeDurableReplicationOutboxEntry[] = []
      for (const walEntry of wal.activeOutboxByFrameDigest.values()) {
        const record = walEntry.record.core.outboxRecord
        const ref = walEntry.record.core.ref
        if (!reachableFrameDigests.has(ref.frameDigest)) {
          recoverRequired("Accepted-frame WAL outbox references a frame outside the sole durable head")
        }
        const exactFrameBytes = await readAcceptedFrameWalBytes(
          layout.acceptedFrameWal,
          walEntry.file.exactFrameByteOffset,
          walEntry.file.exactFrameByteLength,
        )
        if (ordinaryDigest(exactFrameBytes) !== walEntry.record.core.exactFrameSha256) {
          corrupt("Accepted-frame WAL outbox exact frame changed")
        }
        walEntries.push(Object.freeze({
          ref,
          exactFrameBytes,
          requiredBlobDigests: Object.freeze([...record.requiredBlobDigests]),
        }))
      }
      return Object.freeze([...entries, ...walEntries])
    })
  }

  /**
   * Persists a protocol-verified long-lived replica ACK through the same
   * journal/head barrier as document metadata. The frame outbox is retired only
   * after the durable head references the ACK journal.
   */
  async recordVerifiedReplicaDurableAck(input: NodeVerifiedReplicaDurableAck): Promise<Digest> {
    this.requireLive()
    const normalized = normalizeReplicaDurableAckInput(input)
    const verifier = this.replicaDurableAckVerifier
    if (!verifier) invalid("Replica durable ACK verifier is unavailable")
    const layout = this.layout(normalized.scope)
    return this.serial(layout.directory, async () => {
      await this.assertWritableDocument(layout)
      if (!(await verifier.verifyCurrent(normalized))) invalid("Replica durable ACK is not current and verified")
      let current = await this.readDurableHead(layout, normalized.scope)
      let journals = await this.readReachableJournals(layout, normalized.scope, current.record)
      if (!journals.some((entry) => isFrameJournal(entry.record) && entry.record.objectDigests[0] === normalized.frameDigest)) {
        invalid("Replica durable ACK names a frame outside the sole durable head")
      }
      const record = ackRecord(normalized)
      const accepted = journals.find((entry) => entry.record.transition === "record-durable-ack" && entry.record.objectDigests[0] === normalized.ackCoreDigest)
      if (accepted) {
        assertSameReplicaDurableAck(await this.readAckRecord(layout, normalized.ackCoreDigest), normalized)
        await this.retireFrameOutbox(layout, normalized.frameDigest)
        return accepted.digest
      }
      const base = await this.readBaseDurableHead(layout, normalized.scope)
      let wal = await this.loadAcceptedFrameWalIndex(layout, base, true)
      const acceptedCache = await this.ensureAcceptedHeadCache(
        layout,
        normalized.scope,
        wal.currentHead.record,
        wal.currentHead.digest,
      )
      wal = await this.ensureAcceptedFrameWalHeaderCurrent(
        layout,
        wal,
        acceptedCache.acceptedIdentity.materializationDigest,
      )
      current = wal.currentHead
      const nextSequence = incrementUint64(current.record.localHeadGeneration)
      const journalRecord: LocalJournalRecord = Object.freeze({
        format: "convax.local-journal-record",
        scope: normalized.scope,
        localRecordSequence: nextSequence,
        priorJournalRecordDigest: current.record.journalTailDigest,
        transition: "record-durable-ack",
        objectDigests: [normalized.ackCoreDigest],
        outboxRefDigest: null,
        resultingFrontierDigest: current.record.acceptedFrontierDigest,
        operationRef: null,
      })
      const journalDigest = localRecordDigest(journalRecord)
      const head: LocalDurableHead = Object.freeze({
        ...current.record,
        localHeadGeneration: nextSequence,
        priorHeadDigest: current.digest,
        journalTailDigest: journalDigest,
      })
      const headDigest = localRecordDigest(head)
      const core: LocalAcceptedFrameWalAckRecordCore = Object.freeze({
        format: "convax.local-accepted-frame-wal-ack-record-core",
        scope: normalized.scope,
        sequence: nextSequence,
        priorAtomicCommitRecordDigest: wal.tailAtomicCommitRecordDigest,
        ackRecord: record,
        journalRecord,
        journalRecordDigest: journalDigest,
        expectedReplicaHeadRecordDigest: current.digest,
        resultingHeadRecord: head,
        resultingReplicaHeadRecordDigest: headDigest,
      })
      const walRecord: LocalAcceptedFrameWalAckRecord = Object.freeze({
        format: "convax.local-accepted-frame-wal-ack-record",
        core,
        atomicCommitRecordDigest: localRecordDigest(core),
      })
      const encoded = encodeAcceptedFrameWalRecord({
        headerBytes: encodeRecord(walRecord),
        exactFrameBytes: new Uint8Array(),
        stateVectorBytes: new Uint8Array(),
      })
      const file = describeAcceptedFrameWalRecord(encoded, wal.validByteLength)
      const walEntry = Object.freeze({ file, record: walRecord }) satisfies AcceptedFrameWalAckEntry
      try {
        await appendAcceptedFrameWalRecord({
          target: layout.acceptedFrameWal,
          expectedByteOffset: wal.validByteLength,
          exactRecordBytes: encoded,
          beforeSync: this.hooks.beforeAcceptedFrameWalSync,
          afterSync: this.hooks.afterAcceptedFrameWalSync,
        })
      } catch (error) {
        this.acceptedFrameWalIndexes.delete(layout.directory)
        this.outboxUsageCaches.delete(layout.directory)
        this.invalidateMaterializedState(layout)
        wal = await this.loadAcceptedFrameWalIndex(layout, base, true)
        const recovered = wal.byAckCoreDigest.get(normalized.ackCoreDigest)
        if (recovered) {
          assertSameReplicaDurableAck(recovered.record.core.ackRecord, normalized)
          await this.retireFrameOutbox(layout, normalized.frameDigest)
          return recovered.record.core.journalRecordDigest
        }
        throw error
      }
      try {
        wal.entries.push(walEntry)
        wal.byAckCoreDigest.set(normalized.ackCoreDigest, walEntry)
        wal.activeOutboxByFrameDigest.delete(normalized.frameDigest)
        wal.currentHead = Object.freeze({ record: head, digest: headDigest })
        wal.validByteLength = file.byteOffset + file.byteLength
        wal.tailAtomicCommitRecordDigest = walRecord.atomicCommitRecordDigest
        await this.retireFrameOutbox(layout, normalized.frameDigest)
        // Metadata changes the native head identity while preserving the exact
        // owner materialization. Rebuild that disposable identity on demand.
        this.invalidateMaterializedState(layout)
      } catch {
        this.acceptedFrameWalIndexes.delete(layout.directory)
        this.outboxUsageCaches.delete(layout.directory)
        this.invalidateMaterializedState(layout)
      }
      return journalDigest
    })
  }

  async listDurableReplicaAcks(scope: DocumentScope): Promise<readonly NodeVerifiedReplicaDurableAck[]> {
    this.requireLive()
    const verifier = this.replicaDurableAckVerifier
    if (!verifier) invalid("Replica durable ACK verifier is unavailable")
    const layout = this.layout(scope)
    return this.serial(layout.directory, async () => {
      await this.assertReadableDocument(layout)
      const head = await this.readDurableHead(layout, scope)
      const journals = await this.readReachableJournals(layout, scope, head.record)
      const result: NodeVerifiedReplicaDurableAck[] = []
      for (const journal of journals) {
        if (journal.record.transition !== "record-durable-ack") continue
        const digest = journal.record.objectDigests[0]!
        const record = await this.readAckRecord(layout, digest)
        assertSameScope(record.scope, scope)
        const value = ackInput(record)
        if (!(await verifier.verifyCurrent(value))) continue
        result.push(value)
      }
      return Object.freeze(result)
    })
  }

  private async loadAcceptedHeadInternal(
    layout: DocumentLayout,
    scope: DocumentScope,
    reconcileJournalBelowHead: boolean,
  ): Promise<NodeAcceptedReplicaHead> {
    await this.assertReadableDocument(layout)
    let durable = await this.readDurableHead(layout, scope)
    let result = await this.reconstructHead(layout, scope, durable.record, durable.digest)
    if (!reconcileJournalBelowHead) return this.applyDispositionHead(layout, scope, result)
    const nextSequence = incrementUint64(durable.record.localHeadGeneration)
    const nextPath = path.join(layout.journalSegments, deriveJournalSegmentNativeKey(nextSequence))
    if (!(await fileExists(nextPath))) return this.applyDispositionHead(layout, scope, result)
    const pending = await readJournalRecord(nextPath, scope)
    if (pending.record.priorJournalRecordDigest !== durable.record.journalTailDigest) corrupt("Below-head journal does not extend the current tail")
    if (isFrameJournal(pending.record)) {
      const ref = await this.refForJournal(layout, pending.record)
      await this.commitRecoveredJournal(layout, durable, pending, ref)
    } else {
      await this.commitRecoveredMetadataJournal(layout, durable, pending)
    }
    durable = await this.readDurableHead(layout, scope)
    result = await this.reconstructHead(layout, scope, durable.record, durable.digest)
    return this.applyDispositionHead(layout, scope, result)
  }

  private async applyDispositionHead(
    layout: DocumentLayout,
    scope: DocumentScope,
    accepted: NodeAcceptedReplicaHead,
  ): Promise<NodeAcceptedReplicaHead> {
    if (!(await fileExists(layout.dispositionHead))) return accepted
    const record = parseDispositionHead(decodeRecord(await fs.readFile(layout.dispositionHead)))
    assertSameScope(record.scope, scope)
    const quarantinePath = path.join(
      layout.quarantine,
      `${deriveObjectNativeKey("quarantine", record.quarantineCommitRecordDigest)}.bin`,
    )
    const quarantine = parseQuarantine(decodeRecord(await fs.readFile(quarantinePath).catch((error) => {
      throw new NodeCollaborationPersistenceError("store-corrupt", "Disposition references a missing quarantine commit", { cause: error })
    })))
    if (localRecordDigest(quarantine) !== record.quarantineCommitRecordDigest) {
      corrupt("Disposition quarantine digest mismatches its immutable record")
    }
    assertSameScope(quarantine.scope, scope)
    return freezeHead(accepted, localRecordDigest(record))
  }

  private async commitRecoveredJournal(
    layout: DocumentLayout,
    current: { readonly record: LocalDurableHead; readonly digest: Digest },
    journal: LoadedJournal,
    ref: FrameObjectRef,
  ): Promise<void> {
    assertJournalRef(journal.record, ref)
    await this.readOutbox(layout, ref)
    const frame = await this.readFrame(layout, ref)
    const previous = await this.reconstructHead(layout, ref.scope, current.record, current.digest)
    const next = await this.materializeAcceptedFrame({ previous, ref, exactBytes: frame })
    validateAcceptedBase(next, ref.scope)
    if (next.frontierDigest !== journal.record.resultingFrontierDigest) {
      recoverRequired("Journal-below-head materialization differs from its durable frontier")
    }
    const head: LocalDurableHead = {
      format: "convax.local-durable-head",
      scope: ref.scope,
      localHeadGeneration: journal.record.localRecordSequence,
      priorHeadDigest: current.digest,
      journalBaseDigest: current.record.journalBaseDigest,
      journalTailDigest: journal.digest,
      installedCheckpointSetDigest: current.record.installedCheckpointSetDigest,
      acceptedFrontierDigest: next.frontierDigest,
      acceptedActorHeadsDigest: this.materializer.actorHeadsDigest(next.actorHeads),
    }
    await replaceDurableRecord(layout.durableHead, head)
    const headDigest = localRecordDigest(head)
    this.adoptLegacyDurableHead(layout, head, headDigest, next.materializationDigest)
    const priorCache = this.requireMaterializedHeadCache(layout, current.record, current.digest)
    priorCache.reachableFrameDigests.add(ref.frameDigest)
    try {
      this.storeMaterializedHeadCache(layout, head, headDigest, next, priorCache.reachableFrameDigests)
    } catch {
      this.invalidateMaterializedState(layout)
    }
    this.pendingHeadTransitions.delete(layout.directory)
    this.observeAcceptedFrame(ref, frame, undefined)
  }

  private async reconstructHead(
    layout: DocumentLayout,
    scope: DocumentScope,
    head: LocalDurableHead,
    headDigest: Digest,
  ): Promise<NodeAcceptedReplicaHead> {
    const cached = this.materializedHeadCaches.get(layout.directory)
    if (cached && this.materializedHeadCacheMatches(cached, head, headDigest)) {
      if (cached.deltaTail === null) return freezeHead(cached.materializedBase, headDigest)
      persistenceColdHeadMaterializations += 1
      const nodes: AcceptedHeadDeltaRefNode[] = []
      let cursor: AcceptedHeadDeltaRefNode | null = cached.deltaTail
      while (cursor !== null) {
        persistenceDeltaHistoryVisits += 1
        nodes.push(cursor)
        cursor = cursor.previous
      }
      if (nodes.length !== cached.deltaLength) corrupt("Accepted delta cache length is invalid")
      nodes.reverse()
      let materialized = freezeHead(cached.materializedBase, cached.materializedBase.headDigest)
      for (const node of nodes) {
        const frame = await this.readFrame(layout, node.ref)
        materialized = freezeHead(
          await this.materializeAcceptedFrame({
            previous: materialized,
            ref: node.ref,
            exactBytes: frame,
            durableDelta: node.durableDelta,
          }),
          node.identity.headDigest,
        )
        assertSameAcceptedIdentity(materialized, node.identity, this.materializer)
      }
      assertSameAcceptedIdentity(materialized, cached.acceptedIdentity, this.materializer)
      this.storeMaterializedHeadCache(layout, head, headDigest, materialized, cached.reachableFrameDigests)
      return freezeHead(materialized, headDigest)
    }
    if (cached) this.invalidateMaterializedState(layout)
    persistenceColdHeadMaterializations += 1
    await this.readInstalledCheckpointSet(layout, head.installedCheckpointSetDigest, scope)
    const base = await readJournalBase(layout.journalBases, head.journalBaseDigest, scope)
    const durableBase = await this.readBaseDurableHead(layout, scope)
    const wal = await this.loadAcceptedFrameWalIndex(layout, durableBase, false)
    const initialHeadDigest = durableBase.record.localHeadGeneration === base.record.baseLocalRecordSequence
      ? durableBase.digest
      : base.digest
    let current: NodeAcceptedReplicaHead = freezeHead(
      {
        scope,
        frontier: base.record.frontier,
        frontierDigest: base.record.frontierDigest,
        actorHeads: base.record.actorHeads,
        fullUpdate: base.fullUpdate,
        stateVector: base.stateVector,
        canonicalStateDigest: base.record.canonicalStateDigest,
        materializationDigest: base.record.materializationDigest,
      },
      initialHeadDigest,
    )
    const records = await this.readReachableJournals(layout, scope, head)
    const reachableFrameDigests = createOwnedReachableFrameDigests()
    for (const journal of records) {
      if (!isFrameJournal(journal.record)) {
        if (journal.record.resultingFrontierDigest !== current.frontierDigest) corrupt("Metadata journal changes the accepted frontier")
        if (journal.record.transition === "record-durable-ack") {
          const ack = await this.readAckRecord(layout, journal.record.objectDigests[0]!)
          assertSameScope(ack.scope, scope)
        } else if (journal.record.transition === "install-checkpoint-set") {
          await this.readInstalledCheckpointSet(layout, journal.record.objectDigests[0]!, scope)
        } else corrupt("Unsupported metadata journal transition")
        continue
      }
      const ref = await this.refForJournal(layout, journal.record)
      const frame = await this.readFrame(layout, ref)
      const walEntry = wal.byJournalDigest.get(journal.digest)
      const nextHeadDigest = walEntry?.record.core.resultingReplicaHeadRecordDigest ?? journal.digest
      current = freezeHead(await this.materializeAcceptedFrame({
        previous: current,
        ref,
        exactBytes: frame,
        durableDelta: walEntry?.durableDelta,
      }), nextHeadDigest)
      reachableFrameDigests.add(ref.frameDigest)
      if (current.frontierDigest !== journal.record.resultingFrontierDigest) corrupt("Reopened frame produces a different frontier")
      this.observeAcceptedFrame(ref, frame, walEntry?.durableDelta)
    }
    if (current.frontierDigest !== head.acceptedFrontierDigest) corrupt("Reopened frontier differs from durable head")
    if (this.materializer.actorHeadsDigest(current.actorHeads) !== head.acceptedActorHeadsDigest) corrupt("Reopened actor heads differ from durable head")
    const accepted = freezeHead(current, headDigest)
    this.storeMaterializedHeadCache(layout, head, headDigest, accepted, reachableFrameDigests)
    return freezeHead(accepted, headDigest)
  }

  private async reconstructImmediatePredecessorHead(
    layout: DocumentLayout,
    scope: DocumentScope,
  ): Promise<NodeAcceptedReplicaHead> {
    if (this.readProtocol !== "immediate-predecessor") invalid("Predecessor reconstruction crossed the current reader")
    const migrationMaterializer = requireImmediatePredecessorMaterializer(this.materializer)
    await this.assertReadableDocument(layout)
    // The sealed db8b264aa predecessor predates the accepted-frame WAL. Its
    // durable head + journal/base/object closure is authoritative; current
    // stores continue to require and scan their WAL through readDurableHead.
    const durable = await this.readBaseDurableHead(layout, scope)
    const installed = await this.readInstalledCheckpointSet(layout, durable.record.installedCheckpointSetDigest, scope)
    await this.verifyImmediatePredecessorCheckpointSet(layout, scope, installed, migrationMaterializer)
    const base = await readJournalBase(
      layout.journalBases,
      durable.record.journalBaseDigest,
      scope,
      "immediate-predecessor",
    )
    const baseInstalled = base.record.installedCheckpointSetDigest === durable.record.installedCheckpointSetDigest
      ? installed
      : await this.readInstalledCheckpointSet(layout, base.record.installedCheckpointSetDigest, scope)
    if (baseInstalled !== installed) {
      await this.verifyImmediatePredecessorCheckpointSet(layout, scope, baseInstalled, migrationMaterializer)
    }
    if (!baseInstalled.checkpointObjectDigests.includes(base.record.checkpointObjectDigest)) {
      corrupt("Immediate-predecessor journal base checkpoint is absent from its installed set")
    }
    let current: NodeAcceptedReplicaHead = freezeHead({
      scope,
      frontier: base.record.frontier,
      frontierDigest: base.record.frontierDigest,
      actorHeads: base.record.actorHeads,
      fullUpdate: base.fullUpdate,
      stateVector: base.stateVector,
      canonicalStateDigest: base.record.canonicalStateDigest,
      materializationDigest: base.digest,
    }, base.digest)
    await migrationMaterializer.validateImmediatePredecessorBase({
      head: current,
      checkpointObjectDigest: base.record.checkpointObjectDigest,
      exactCheckpointBytes: await this.readImmediatePredecessorCheckpoint(
        layout,
        base.record.checkpointObjectDigest,
      ),
    })
    const records = await this.readImmediatePredecessorReachableJournals(layout, scope, durable.record)
    for (const journal of records) {
      if (!isFrameJournal(journal.record)) {
        if (journal.record.resultingFrontierDigest !== current.frontierDigest) corrupt("Predecessor metadata journal changes the accepted frontier")
        if (journal.record.transition === "record-durable-ack") {
          const ack = await this.readImmediatePredecessorAckRecord(layout, journal.record.objectDigests[0]!)
          assertSameScope(ack.scope, scope)
        } else if (journal.record.transition === "install-checkpoint-set") {
          const nextInstalled = await this.readInstalledCheckpointSet(layout, journal.record.objectDigests[0]!, scope)
          await this.verifyImmediatePredecessorCheckpointSet(layout, scope, nextInstalled, migrationMaterializer)
        } else corrupt("Unsupported predecessor metadata journal transition")
        continue
      }
      const ref = await this.refForImmediatePredecessorJournal(layout, journal.record)
      const frame = await this.readImmediatePredecessorFrame(layout, ref)
      current = freezeHead(await this.materializeAcceptedFrame({
        previous: current,
        ref,
        exactBytes: frame,
        durableDelta: undefined,
      }), journal.digest)
      if (current.frontierDigest !== journal.record.resultingFrontierDigest) corrupt("Predecessor frame produces a different frontier")
    }
    if (current.frontierDigest !== durable.record.acceptedFrontierDigest) corrupt("Predecessor frontier differs from durable head")
    if (this.materializer.actorHeadsDigest(current.actorHeads) !== durable.record.acceptedActorHeadsDigest) {
      corrupt("Predecessor actor heads differ from durable head")
    }
    return freezeHead(current, durable.digest)
  }

  /** Exact db8b264aa operation sidecar lookup; the predecessor has no accepted-frame WAL. */
  private async refForImmediatePredecessorJournal(
    layout: DocumentLayout,
    journal: LocalJournalRecord,
  ): Promise<FrameObjectRef> {
    if (!isFrameJournal(journal)) return corrupt("Predecessor metadata journal has no frame reference")
    const frameDigest = journal.objectDigests[0]
    if (!frameDigest) corrupt("Predecessor frame journal is empty")
    const operationDirectory = path.join(
      layout.operationRefs,
      operationIndexKey(journal.operationRef.actorId, journal.operationRef.operationId),
    )
    for (const name of await readDirectoryNames(operationDirectory)) {
      const record = parseOperationRef(decodeRecord(await fs.readFile(path.join(operationDirectory, name))))
      if (record.ref.frameDigest === frameDigest) return record.ref
    }
    return corrupt("Predecessor journal operation reference is missing")
  }

  /** Exact db8b264aa immutable frame lookup; current WAL state is deliberately unreachable. */
  private async readImmediatePredecessorFrame(
    layout: DocumentLayout,
    ref: FrameObjectRef,
  ): Promise<Uint8Array> {
    const target = path.join(layout.frames, `${deriveObjectNativeKey("frame", ref.frameDigest)}.bin`)
    const bytes = Uint8Array.from(await fs.readFile(target).catch((error) => {
      throw new NodeCollaborationPersistenceError(
        "store-corrupt",
        "Predecessor journal references a missing frame object",
        { cause: error },
      )
    }))
    const inspected = await this.materializer.inspectFrame(ref, bytes)
    assertSameFrameRef(inspected.ref, ref)
    return bytes
  }

  /** Exact db8b264aa immutable ACK lookup; current WAL state is deliberately unreachable. */
  private async readImmediatePredecessorAckRecord(
    layout: DocumentLayout,
    digest: Digest,
  ): Promise<LocalReplicaDurableAckRecord> {
    const target = path.join(layout.acks, `${deriveObjectNativeKey("ack", digest)}.bin`)
    const record = parseAckRecord(decodeRecord(await fs.readFile(target).catch((error) => {
      throw new NodeCollaborationPersistenceError(
        "store-corrupt",
        "Predecessor ACK journal references a missing ACK object",
        { cause: error },
      )
    })))
    if (record.ackCoreDigest !== digest) corrupt("Predecessor ACK object key mismatches its core digest")
    return record
  }

  private async verifyImmediatePredecessorCheckpointSet(
    layout: DocumentLayout,
    scope: DocumentScope,
    installed: LocalInstalledCheckpointSet,
    materializer: ImmediatePredecessorNodeReplicaHeadMaterializer,
  ): Promise<void> {
    for (const checkpointObjectDigest of installed.checkpointObjectDigests) {
      await materializer.verifyImmediatePredecessorCheckpoint({
        scope,
        checkpointObjectDigest,
        exactCheckpointBytes: await this.readImmediatePredecessorCheckpoint(layout, checkpointObjectDigest),
      })
    }
  }

  private async readImmediatePredecessorCheckpoint(
    layout: DocumentLayout,
    checkpointObjectDigest: Digest,
  ): Promise<Uint8Array> {
    const target = path.join(
      layout.checkpoints,
      `${deriveObjectNativeKey("checkpoint", checkpointObjectDigest)}.bin`,
    )
    const stat = await fs.lstat(target).catch((error) => {
      throw new NodeCollaborationPersistenceError(
        "store-corrupt",
        "Immediate-predecessor checkpoint payload is missing",
        { cause: error },
      )
    })
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_GENESIS_PROOF_BYTES) {
      corrupt("Immediate-predecessor checkpoint payload shape is invalid")
    }
    return Uint8Array.from(await fs.readFile(target))
  }

  private async readImmediatePredecessorReachableJournals(
    layout: DocumentLayout,
    scope: DocumentScope,
    head: LocalDurableHead,
  ): Promise<readonly LoadedJournal[]> {
    const base = await readJournalBase(
      layout.journalBases,
      head.journalBaseDigest,
      scope,
      "immediate-predecessor",
    )
    const records: LoadedJournal[] = []
    let prior: Digest = base.digest
    for (
      let sequence = BigInt(base.record.baseLocalRecordSequence) + 1n;
      sequence <= BigInt(head.localHeadGeneration);
      sequence += 1n
    ) {
      const loaded = await readJournalRecord(
        path.join(layout.journalSegments, deriveJournalSegmentNativeKey(sequence.toString())),
        scope,
      )
      if (loaded.record.localRecordSequence !== sequence.toString()) corrupt("Predecessor journal filename and sequence differ")
      if (loaded.record.priorJournalRecordDigest !== prior) corrupt("Predecessor journal chain is gapped or forked")
      records.push(loaded)
      prior = loaded.digest
    }
    if (prior !== head.journalTailDigest) corrupt("Predecessor journal tail differs from durable head")
    return Object.freeze(records)
  }

  private async readReachableJournals(
    layout: DocumentLayout,
    scope: DocumentScope,
    head: LocalDurableHead,
  ): Promise<readonly LoadedJournal[]> {
    const base = await readJournalBase(layout.journalBases, head.journalBaseDigest, scope)
    const durableBase = await this.readBaseDurableHead(layout, scope)
    const wal = await this.loadAcceptedFrameWalIndex(layout, durableBase, false)
    const first = BigInt(base.record.baseLocalRecordSequence) + 1n
    const legacyLast = BigInt(durableBase.record.localHeadGeneration)
    const requestedLast = BigInt(head.localHeadGeneration)
    if (requestedLast > BigInt(wal.currentHead.record.localHeadGeneration)) {
      corrupt("Requested journal head extends beyond the accepted-frame WAL")
    }
    const records: LoadedJournal[] = []
    let prior: Digest = base.digest
    const baseSequence = BigInt(base.record.baseLocalRecordSequence)
    for (let sequence = first; sequence <= legacyLast && sequence <= requestedLast; sequence += 1n) {
      const loaded = await readJournalRecord(
        path.join(layout.journalSegments, deriveJournalSegmentNativeKey(sequence.toString())),
        scope,
      )
      if (loaded.record.localRecordSequence !== sequence.toString()) corrupt("Journal filename and sequence differ")
      if (loaded.record.priorJournalRecordDigest !== prior) corrupt("Journal chain is gapped or forked")
      records.push(loaded)
      prior = loaded.digest
    }
    for (const entry of wal.entries) {
      const sequence = BigInt(entry.record.core.sequence)
      if (sequence <= baseSequence) continue
      if (sequence > requestedLast) break
      if (entry.record.core.journalRecord.priorJournalRecordDigest !== prior) {
        corrupt("Accepted-frame WAL journal chain is gapped or forked")
      }
      records.push(Object.freeze({
        digest: entry.record.core.journalRecordDigest,
        record: entry.record.core.journalRecord,
      }))
      prior = entry.record.core.journalRecordDigest
    }
    if (prior !== head.journalTailDigest) corrupt("Journal tail differs from durable head")
    return records
  }

  private async refForJournal(layout: DocumentLayout, journal: LocalJournalRecord): Promise<FrameObjectRef> {
    if (!isFrameJournal(journal)) return corrupt("Metadata journal has no frame reference")
    const frameDigest = journal.objectDigests[0]
    if (!frameDigest) corrupt("Frame journal is empty")
    const wal = this.acceptedFrameWalIndexes.get(layout.directory) ??
      await this.loadAcceptedFrameWalIndex(layout, await this.readBaseDurableHead(layout, journal.scope), false)
    const walEntry = wal.byJournalDigest.get(
      localRecordDigest(journal),
    )
    if (walEntry) return walEntry.record.core.ref
    const operationDirectory = path.join(layout.operationRefs, operationIndexKey(journal.operationRef.actorId, journal.operationRef.operationId))
    for (const name of await readDirectoryNames(operationDirectory)) {
      const record = parseOperationRef(decodeRecord(await fs.readFile(path.join(operationDirectory, name))))
      if (record.ref.frameDigest === frameDigest) return record.ref
    }
    return corrupt("Journal operation reference is missing")
  }

  private async readFrame(layout: DocumentLayout, ref: FrameObjectRef): Promise<Uint8Array> {
    return (await this.readInspectedFrame(layout, ref)).bytes
  }

  private async readInspectedFrame(
    layout: DocumentLayout,
    ref: FrameObjectRef,
  ): Promise<Readonly<{ bytes: Uint8Array; inspected: NodeInspectedFrame }>> {
    const wal = this.acceptedFrameWalIndexes.get(layout.directory) ??
      await this.loadAcceptedFrameWalIndex(layout, await this.readBaseDurableHead(layout, ref.scope), false)
    const walEntry = wal.byFrameDigest.get(ref.frameDigest)
    if (walEntry) {
      assertSameFrameRef(walEntry.record.core.ref, ref)
      const bytes = await readAcceptedFrameWalBytes(
        layout.acceptedFrameWal,
        walEntry.file.exactFrameByteOffset,
        walEntry.file.exactFrameByteLength,
      )
      if (ordinaryDigest(bytes) !== walEntry.record.core.exactFrameSha256) {
        corrupt("Accepted-frame WAL exact frame changed after validation")
      }
      const inspected = await this.materializer.inspectFrame(ref, bytes)
      assertSameFrameRef(inspected.ref, ref)
      return Object.freeze({ bytes, inspected })
    }
    const target = path.join(layout.frames, `${deriveObjectNativeKey("frame", ref.frameDigest)}.bin`)
    const bytes = Uint8Array.from(await fs.readFile(target).catch((error) => {
      throw new NodeCollaborationPersistenceError("store-corrupt", "Referenced frame object is missing", { cause: error })
    }))
    const inspected = await this.materializer.inspectFrame(ref, bytes)
    assertSameFrameRef(inspected.ref, ref)
    return Object.freeze({ bytes, inspected })
  }

  private async readOutbox(layout: DocumentLayout, ref: FrameObjectRef): Promise<LocalReplicationOutboxRef> {
    const wal = this.acceptedFrameWalIndexes.get(layout.directory) ??
      await this.loadAcceptedFrameWalIndex(layout, await this.readBaseDurableHead(layout, ref.scope), false)
    const walEntry = wal.activeOutboxByFrameDigest.get(ref.frameDigest)
    if (walEntry) {
      assertOutboxRef(walEntry.record.core.outboxRecord, ref)
      return walEntry.record.core.outboxRecord
    }
    const record = parseOutbox(decodeRecord(await fs.readFile(this.outboxPath(layout, ref)).catch((error) => {
      throw new NodeCollaborationPersistenceError("store-corrupt", "Referenced outbox record is missing", { cause: error })
    })))
    assertOutboxRef(record, ref)
    return record
  }

  private outboxPath(layout: DocumentLayout, ref: FrameObjectRef): string {
    return path.join(layout.outboxFrames, `${deriveObjectNativeKey("outbox-ref", ref.frameDigest)}.ref`)
  }

  private async commitRecoveredMetadataJournal(
    layout: DocumentLayout,
    current: { readonly record: LocalDurableHead; readonly digest: Digest },
    journal: LoadedJournal,
  ): Promise<void> {
    if (journal.record.resultingFrontierDigest !== current.record.acceptedFrontierDigest) corrupt("Metadata journal changes the accepted frontier")
    let installedCheckpointSetDigest = current.record.installedCheckpointSetDigest
    let ack: LocalReplicaDurableAckRecord | null = null
    if (journal.record.transition === "record-durable-ack") {
      const ackDigest = journal.record.objectDigests[0]!
      ack = await this.readAckRecord(layout, ackDigest)
      assertSameScope(ack.scope, journal.record.scope)
      const verifier = this.replicaDurableAckVerifier
      if (!verifier || !(await verifier.verifyCurrent(ackInput(ack)))) recoverRequired("ACK recovery cannot prove current replica authority")
    } else if (journal.record.transition === "install-checkpoint-set") {
      installedCheckpointSetDigest = journal.record.objectDigests[0]!
      const installed = await this.readInstalledCheckpointSet(layout, installedCheckpointSetDigest, journal.record.scope)
      await this.materializeInstalledCheckpointBase(layout, journal.record.scope, installed)
    } else if (journal.record.transition === "start-prunable-journal-base") {
      const baseDigest = journal.record.objectDigests[0]!
      const base = await readJournalBase(layout.journalBases, baseDigest, journal.record.scope)
      if (
        base.record.baseLocalRecordSequence !== journal.record.localRecordSequence ||
        base.record.installedCheckpointSetDigest !== current.record.installedCheckpointSetDigest
      ) corrupt("Prunable journal base does not match its start transition")
      const accepted = await this.reconstructHead(layout, journal.record.scope, current.record, current.digest)
      assertSameAcceptedState({
        scope: base.record.scope,
        frontier: base.record.frontier,
        frontierDigest: base.record.frontierDigest,
        actorHeads: base.record.actorHeads,
        fullUpdate: base.fullUpdate,
        stateVector: base.stateVector,
        canonicalStateDigest: base.record.canonicalStateDigest,
        materializationDigest: base.record.materializationDigest,
      }, accepted, this.materializer)
      const head: LocalDurableHead = {
        ...current.record,
        localHeadGeneration: journal.record.localRecordSequence,
        priorHeadDigest: current.digest,
        journalBaseDigest: baseDigest,
        journalTailDigest: baseDigest,
      }
      await replaceDurableRecord(layout.durableHead, head)
      this.adoptLegacyDurableHead(layout, head, localRecordDigest(head), base.record.materializationDigest)
      this.invalidateMaterializedState(layout)
      return
    } else corrupt("Unsupported metadata journal transition")
    const head: LocalDurableHead = {
      ...current.record,
      localHeadGeneration: journal.record.localRecordSequence,
      priorHeadDigest: current.digest,
      journalTailDigest: journal.digest,
      installedCheckpointSetDigest,
    }
    await replaceDurableRecord(layout.durableHead, head)
    this.adoptLegacyDurableHead(layout, head, localRecordDigest(head))
    this.invalidateMaterializedState(layout)
    if (ack) await this.retireFrameOutbox(layout, ack.frameDigest)
  }

  private async readAckRecord(layout: DocumentLayout, digest: Digest): Promise<LocalReplicaDurableAckRecord> {
    const wal = this.acceptedFrameWalIndexes.get(layout.directory) ??
      await this.loadAcceptedFrameWalIndex(layout, await this.readBaseDurableHead(layout), false)
    const walEntry = wal.byAckCoreDigest.get(digest)
    if (walEntry) return walEntry.record.core.ackRecord
    const target = path.join(layout.acks, `${deriveObjectNativeKey("ack", digest)}.bin`)
    const record = parseAckRecord(decodeRecord(await fs.readFile(target).catch((error) => {
      throw new NodeCollaborationPersistenceError("store-corrupt", "ACK journal references a missing ACK object", { cause: error })
    })))
    if (record.ackCoreDigest !== digest) corrupt("ACK object key mismatches its core digest")
    return record
  }

  private async readInstalledCheckpointSet(
    layout: DocumentLayout,
    digest: Digest,
    scope: DocumentScope,
  ): Promise<LocalInstalledCheckpointSet> {
    const target = path.join(layout.checkpointSets, `${deriveObjectNativeKey("checkpoint-set", digest)}.bin`)
    const record = parseInstalledCheckpointSet(decodeRecord(await fs.readFile(target).catch((error) => {
      throw new NodeCollaborationPersistenceError("store-corrupt", "Durable head references a missing checkpoint set", { cause: error })
    })))
    assertSameScope(record.scope, scope)
    if (localRecordDigest(record) !== digest) corrupt("Installed checkpoint-set digest mismatches its pointer")
    for (const checkpointDigest of record.checkpointObjectDigests) {
      const checkpointPath = path.join(layout.checkpoints, `${deriveObjectNativeKey("checkpoint", checkpointDigest)}.bin`)
      const stat = await fs.lstat(checkpointPath).catch((error) => {
        throw new NodeCollaborationPersistenceError("store-corrupt", "Installed checkpoint payload is missing", { cause: error })
      })
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) corrupt("Installed checkpoint payload shape is invalid")
    }
    for (const certificateDigest of [
      ...record.contentCertificateObjectDigests,
      ...record.prunableSetCertificateObjectDigests,
    ]) {
      const certificatePath = path.join(layout.certificates, `${deriveObjectNativeKey("certificate", certificateDigest)}.bin`)
      const stat = await fs.lstat(certificatePath).catch((error) => {
        throw new NodeCollaborationPersistenceError("store-corrupt", "Installed checkpoint certificate is missing", { cause: error })
      })
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) corrupt("Installed checkpoint certificate shape is invalid")
    }
    return record
  }

  private materializedHeadCacheMatches(
    cache: VerifiedMaterializedHeadCache,
    head: LocalDurableHead,
    headDigest: Digest,
  ): boolean {
    return cache.durableHeadDigest === headDigest &&
      cache.localHeadGeneration === head.localHeadGeneration &&
      cache.journalBaseDigest === head.journalBaseDigest &&
      cache.journalTailDigest === head.journalTailDigest &&
      cache.installedCheckpointSetDigest === head.installedCheckpointSetDigest &&
      cache.acceptedIdentity.frontierDigest === head.acceptedFrontierDigest &&
      this.materializer.actorHeadsDigest(cache.acceptedIdentity.actorHeads) === head.acceptedActorHeadsDigest
  }

  private storeMaterializedHeadCache(
    layout: DocumentLayout,
    head: LocalDurableHead,
    headDigest: Digest,
    acceptedHead: NodeAcceptedReplicaHead,
    reachableFrameDigests: InternallyOwnedReachableFrameDigests,
  ): void {
    const defensiveHead = freezeOwnedHead(acceptedHead, headDigest)
    this.assertMaterializedHeadCacheMatches(head, defensiveHead)
    this.installTransferredMaterializedHeadCache(
      layout,
      head,
      headDigest,
      defensiveHead,
      reachableFrameDigests,
    )
  }

  /**
   * Transfers a module-private head whose binary fields have already been cloned
   * away from every caller-visible value. This is intentionally not a general
   * no-copy option: only freezeOwnedHead/rebindOwnedHead can construct its brand.
   */
  private assertMaterializedHeadCacheMatches(
    head: LocalDurableHead,
    defensiveHead: InternallyOwnedAcceptedHead,
  ): void {
    if (
      defensiveHead.frontierDigest !== head.acceptedFrontierDigest ||
      this.materializer.actorHeadsDigest(defensiveHead.actorHeads) !== head.acceptedActorHeadsDigest
    ) {
      corrupt("Materialized cache differs from the exact durable head")
    }
  }

  private installTransferredMaterializedHeadCache(
    layout: DocumentLayout,
    head: LocalDurableHead,
    headDigest: Digest,
    defensiveHead: InternallyOwnedAcceptedHead,
    reachableFrameDigests: InternallyOwnedReachableFrameDigests,
  ): void {
    this.materializedHeadCaches.set(layout.directory, {
      durableHeadDigest: headDigest,
      localHeadGeneration: head.localHeadGeneration,
      journalBaseDigest: head.journalBaseDigest,
      journalTailDigest: head.journalTailDigest,
      installedCheckpointSetDigest: head.installedCheckpointSetDigest,
      acceptedIdentity: identityFromOwnedHead(defensiveHead),
      materializedBase: defensiveHead,
      deltaTail: null,
      deltaLength: 0,
      reachableFrameDigests,
    })
  }

  private installTransferredDeltaHeadCache(
    layout: DocumentLayout,
    head: LocalDurableHead,
    headDigest: Digest,
    identity: InternallyOwnedAcceptedHeadIdentity,
    materializedBase: InternallyOwnedAcceptedHead,
    deltaTail: AcceptedHeadDeltaRefNode,
    deltaLength: number,
    reachableFrameDigests: InternallyOwnedReachableFrameDigests,
  ): void {
    this.assertAcceptedHeadIdentityMatches(head, identity)
    this.materializedHeadCaches.set(layout.directory, {
      durableHeadDigest: headDigest,
      localHeadGeneration: head.localHeadGeneration,
      journalBaseDigest: head.journalBaseDigest,
      journalTailDigest: head.journalTailDigest,
      installedCheckpointSetDigest: head.installedCheckpointSetDigest,
      acceptedIdentity: identity,
      materializedBase,
      deltaTail,
      deltaLength,
      reachableFrameDigests,
    })
  }

  private assertAcceptedHeadIdentityMatches(
    head: LocalDurableHead,
    identity: AcceptedHeadIdentityView,
  ): void {
    if (
      identity.frontierDigest !== head.acceptedFrontierDigest ||
      this.materializer.actorHeadsDigest(identity.actorHeads) !== head.acceptedActorHeadsDigest
    ) {
      corrupt("Accepted identity cache differs from the exact durable head")
    }
  }

  private observeAcceptedFrame(
    ref: FrameObjectRef,
    exactBytes: Readonly<Uint8Array>,
    durableDelta: unknown,
  ): void {
    try {
      this.materializer.observeAcceptedFrame?.(ref, exactBytes, durableDelta)
    } catch {
      // This observer accelerates causal-closure lookups; it cannot negate an accepted durable head.
    }
  }

  private requireMaterializedHeadCache(
    layout: DocumentLayout,
    head: LocalDurableHead,
    headDigest: Digest,
  ): VerifiedMaterializedHeadCache {
    const cache = this.materializedHeadCaches.get(layout.directory)
    if (!cache || !this.materializedHeadCacheMatches(cache, head, headDigest)) {
      corrupt("Verified materialized head cache is unavailable")
    }
    return cache
  }

  private async ensureAcceptedHeadCache(
    layout: DocumentLayout,
    scope: DocumentScope,
    head: LocalDurableHead,
    headDigest: Digest,
  ): Promise<VerifiedMaterializedHeadCache> {
    const cached = this.materializedHeadCaches.get(layout.directory)
    if (cached && this.materializedHeadCacheMatches(cached, head, headDigest)) return cached
    await this.reconstructHead(layout, scope, head, headDigest)
    return this.requireMaterializedHeadCache(layout, head, headDigest)
  }

  private async materializeAcceptedFrame(input: Readonly<{
    previous: NodeAcceptedReplicaHead
    ref: FrameObjectRef
    exactBytes: Readonly<Uint8Array>
    durableDelta?: unknown
  }>): Promise<NodeAcceptedReplicaHead> {
    persistenceAcceptedFrameMaterializations += 1
    return this.materializer.applyAcceptedFrame({ ...input, durableDelta: input.durableDelta })
  }

  private invalidateMaterializedState(layout: DocumentLayout): void {
    this.materializedHeadCaches.delete(layout.directory)
    this.pendingHeadTransitions.delete(layout.directory)
  }

  private async ensureOperationRecoveryIndex(): Promise<void> {
    if (this.operationRecoveryIndex) return
    if (!this.operationRecoveryIndexWarmup) {
      this.operationRecoveryIndexWarmup = this.buildOperationRecoveryIndex()
    }
    try {
      await this.operationRecoveryIndexWarmup
    } finally {
      this.operationRecoveryIndexWarmup = null
    }
  }

  private async buildOperationRecoveryIndex(): Promise<void> {
    const index = new Map<string, Map<Digest, IndexedOperationFrame>>()
    const documents = path.join(this.collaborationDirectory, "documents")
    for (const documentName of await readDocumentDirectoryNames(documents)) {
      const layout = this.layoutFromDirectory(path.join(documents, documentName))
      for (const operationDirectoryName of await readDirectoryNames(layout.operationRefs)) {
        const operationDirectory = path.join(layout.operationRefs, operationDirectoryName)
        for (const name of await readDirectoryNames(operationDirectory)) {
          if (!name.endsWith(".bin")) continue
          const record = parseOperationRef(decodeRecord(await fs.readFile(path.join(operationDirectory, name))))
          validateFrameRef(record.ref)
          if (deriveDocumentNativeKey(record.ref.scope) !== documentName) {
            corrupt("Operation sidecar scope differs from its document shard")
          }
          if (operationIndexKey(record.ref.actorId, record.ref.operationId) !== operationDirectoryName) {
            corrupt("Operation sidecar directory differs from its actor and operation")
          }
          const expectedName = `${deriveObjectNativeKey("operation-ref", record.ref.frameDigest)}.bin`
          if (name !== expectedName) corrupt("Operation sidecar filename differs from its frame")
          addOperationRecoveryIndexEntry(index, { ref: record.ref, layout })
        }
      }
      const base = await this.readBaseDurableHead(layout)
      if (deriveDocumentNativeKey(base.record.scope) !== documentName) {
        corrupt("Accepted-frame WAL base scope differs from its document shard")
      }
      const wal = await this.loadAcceptedFrameWalIndex(layout, base, this.ownsRootWriterLease)
      for (const entry of wal.byFrameDigest.values()) {
        addOperationRecoveryIndexEntry(index, { ref: entry.record.core.ref, layout })
      }
      // Opening the Project writer is the explicit cold boundary. Warm every
      // bounded-capacity cache while the WAL is already indexed so the first
      // user commit never pays an O(history) outbox reconstruction.
      await this.loadOutboxUsage(layout)
    }
    this.operationRecoveryIndex = index
  }

  private addOperationRecoveryIndexEntry(entry: IndexedOperationFrame): void {
    const index = this.operationRecoveryIndex
    if (!index) corrupt("Operation recovery index is not warm")
    addOperationRecoveryIndexEntry(index, entry)
  }

  private async loadOutboxUsage(layout: DocumentLayout): Promise<OutboxUsageCache> {
    const cached = this.outboxUsageCaches.get(layout.directory)
    if (cached) return cached
    const frameBytes = new Map<Digest, number>()
    let totalBytes = 0
    const names = await readDirectoryNames(layout.outboxFrames)
    if (names.length > MAX_OUTBOX_FRAMES) corrupt("Local frame outbox exceeds 4,096 refs")
    for (const name of names) {
      persistenceOutboxUsageHistoryVisits += 1
      const record = parseOutbox(decodeRecord(await fs.readFile(path.join(layout.outboxFrames, name))))
      const expectedName = `${deriveObjectNativeKey("outbox-ref", record.frameDigest)}.ref`
      if (name !== expectedName) corrupt("Outbox filename and frame digest differ")
      const framePath = path.join(layout.frames, `${deriveObjectNativeKey("frame", record.frameDigest)}.bin`)
      const stat = await fs.lstat(framePath).catch((error) => {
        throw new NodeCollaborationPersistenceError("store-corrupt", "Outbox frame object is missing", { cause: error })
      })
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_FRAME_BYTES) {
        corrupt("Outbox frame object shape is invalid")
      }
      if (frameBytes.has(record.frameDigest)) corrupt("Outbox contains a duplicate frame digest")
      frameBytes.set(record.frameDigest, stat.size)
      totalBytes += stat.size
      if (totalBytes > MAX_OUTBOX_BYTES) corrupt("Local frame outbox exceeds 512 MiB")
    }
    const wal = this.acceptedFrameWalIndexes.get(layout.directory) ??
      await this.loadAcceptedFrameWalIndex(layout, await this.readBaseDurableHead(layout), false)
    for (const entry of wal.activeOutboxByFrameDigest.values()) {
      persistenceOutboxUsageHistoryVisits += 1
      const digest = entry.record.core.ref.frameDigest
      if (frameBytes.has(digest)) corrupt("Accepted-frame WAL duplicates a legacy outbox ref")
      frameBytes.set(digest, entry.file.exactFrameByteLength)
      totalBytes += entry.file.exactFrameByteLength
      if (frameBytes.size > MAX_OUTBOX_FRAMES || totalBytes > MAX_OUTBOX_BYTES) {
        corrupt("Combined local frame outbox exceeds its bounded capacity")
      }
    }
    const usage = { frameBytes, totalBytes }
    this.outboxUsageCaches.set(layout.directory, usage)
    return usage
  }

  private recordOutboxPut(layout: DocumentLayout, frameDigest: Digest, byteLength: number): void {
    const usage = this.outboxUsageCaches.get(layout.directory)
    if (!usage || usage.frameBytes.has(frameDigest)) return
    usage.frameBytes.set(frameDigest, byteLength)
    usage.totalBytes += byteLength
  }

  private async materializeInstalledCheckpointBase(
    layout: DocumentLayout,
    scope: DocumentScope,
    installed: LocalInstalledCheckpointSet,
  ): Promise<NodeAcceptedReplicaHead> {
    const materialize = this.materializer.materializeCheckpoint
    if (!materialize) recoverRequired("Installed checkpoint materializer is unavailable")
    const checkpointPath = path.join(
      layout.checkpoints,
      `${deriveObjectNativeKey("checkpoint", installed.bootstrapCheckpointObjectDigest)}.bin`,
    )
    const exactCheckpointBytes = Uint8Array.from(await fs.readFile(checkpointPath).catch((error) => {
      throw new NodeCollaborationPersistenceError("store-corrupt", "Bootstrap checkpoint payload is missing", { cause: error })
    }))
    const base = await materialize.call(this.materializer, {
      scope,
      checkpointObjectDigest: installed.bootstrapCheckpointObjectDigest,
      exactCheckpointBytes,
    })
    validateAcceptedBase(base, scope)
    return freezeHead(base, installed.bootstrapCheckpointObjectDigest)
  }

  private async deletePruneCandidates(
    layout: DocumentLayout,
    candidates: readonly NodePrunableObject[],
  ): Promise<number> {
    let deleted = 0
    await ensureTrustedDirectory(layout.pruneTrash, this.collaborationDirectory)
    for (const candidate of candidates) {
      const directory = candidate.kind === "frame" ? layout.frames : layout.checkpoints
      const source = path.join(directory, `${deriveObjectNativeKey(candidate.kind, candidate.objectDigest)}.bin`)
      const trash = path.join(layout.pruneTrash, `${deriveObjectNativeKey(`prune-${candidate.kind}`, candidate.objectDigest)}.bin`)
      const sourceStat = await fs.lstat(source).catch((error) => {
        if (isNodeError(error) && error.code === "ENOENT") return null
        throw error
      })
      if (sourceStat) {
        if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || String(sourceStat.size) !== candidate.exactByteLength) {
          corrupt("Prune candidate native identity or exact byte length changed")
        }
        if (await fileExists(trash)) corrupt("Prune trash already contains a conflicting candidate")
        await fs.rename(source, trash)
        await fsyncProjectDirectory(directory)
        await fsyncProjectDirectory(layout.pruneTrash)
      }
      const trashStat = await fs.lstat(trash).catch((error) => {
        if (isNodeError(error) && error.code === "ENOENT") return null
        throw error
      })
      if (!trashStat) continue
      if (!trashStat.isFile() || trashStat.isSymbolicLink() || String(trashStat.size) !== candidate.exactByteLength) {
        corrupt("Prune trash candidate identity changed")
      }
      await fs.unlink(trash)
      await fsyncProjectDirectory(layout.pruneTrash)
      deleted += 1
    }
    return deleted
  }

  private async retireFrameOutbox(layout: DocumentLayout, frameDigest: Digest): Promise<void> {
    const wal = this.acceptedFrameWalIndexes.get(layout.directory)
    const walEntry = wal?.activeOutboxByFrameDigest.get(frameDigest)
    if (walEntry) wal!.activeOutboxByFrameDigest.delete(frameDigest)
    const target = path.join(layout.outboxFrames, `${deriveObjectNativeKey("outbox-ref", frameDigest)}.ref`)
    const usage = this.outboxUsageCaches.get(layout.directory)
    const retiredBytes = usage?.frameBytes.get(frameDigest)
    const legacyOutboxExists = await fileExists(target)
    if (legacyOutboxExists) {
      await fs.unlink(target)
      await fsyncProjectDirectory(layout.outboxFrames)
    }
    if (usage && retiredBytes !== undefined) {
      usage.frameBytes.delete(frameDigest)
      usage.totalBytes -= retiredBytes
    }
  }

  private async findJournalForFrame(layout: DocumentLayout, frameDigest: Digest): Promise<boolean> {
    const wal = this.acceptedFrameWalIndexes.get(layout.directory) ??
      await this.loadAcceptedFrameWalIndex(layout, await this.readBaseDurableHead(layout), false)
    if (wal.byFrameDigest.has(frameDigest)) return true
    for (const name of await readDirectoryNames(layout.journalSegments)) {
      const record = await readJournalRecord(path.join(layout.journalSegments, name))
      if (record.record.objectDigests.includes(frameDigest)) return true
    }
    return false
  }

  private async quarantineStaleHead(
    layout: DocumentLayout,
    input: Parameters<NodeCollaborationPersistence["compareAndCommitReplicaHead"]>[0],
    observedHeadDigest: Digest,
  ): Promise<CompareAndCommitReplicaHeadPortResult> {
    const quarantine = await this.writeQuarantine(
      layout,
      input.ref.scope,
      input.ref.frameDigest,
      "stale-replica-head",
      observedHeadDigest,
      input.journal.journalRecordDigest,
    )
    return {
      status: "quarantined",
      evidence: {
        ref: input.ref,
        journalRecordDigest: input.journal.journalRecordDigest,
        expectedReplicaHeadRecordDigest: input.expectedReplicaHeadRecordDigest,
        observedReplicaHeadRecordDigest: observedHeadDigest,
        quarantineCommitRecordDigest: quarantine.quarantineDigest,
        shardDispositionHeadRecordDigest: quarantine.dispositionDigest,
      },
    }
  }

  private async writeQuarantine(
    layout: DocumentLayout,
    scope: DocumentScope,
    frameDigest: Digest,
    reason: LocalQuarantineCommit["reason"],
    observedHeadDigest: Digest,
    journalRecordDigest: Digest | null,
  ): Promise<{ quarantineDigest: Digest; dispositionDigest: Digest }> {
    const record: LocalQuarantineCommit = {
      format: "convax.local-quarantine-commit",
      scope,
      frameDigest,
      reason,
      observedReplicaHeadRecordDigest: observedHeadDigest,
      journalRecordDigest,
    }
    const quarantineDigest = localRecordDigest(record)
    await putImmutableRecord(layout.quarantine, "quarantine", quarantineDigest, record)
    const disposition: LocalShardDispositionHead = {
      format: "convax.local-shard-disposition-head",
      scope,
      state: "read-only-quarantine",
      quarantineCommitRecordDigest: quarantineDigest,
    }
    await replaceDurableRecord(layout.dispositionHead, disposition)
    this.invalidateMaterializedState(layout)
    return { quarantineDigest, dispositionDigest: localRecordDigest(disposition) }
  }

  private async readBaseDurableHead(layout: DocumentLayout, scope?: DocumentScope) {
    const value = decodeRecord(await fs.readFile(layout.durableHead).catch((error) => {
      throw new NodeCollaborationPersistenceError("document-not-found", "Durable replica head is missing", { cause: error })
    }))
    const record = parseDurableHead(value)
    if (scope) assertSameScope(record.scope, scope)
    return { record, digest: localRecordDigest(record) }
  }

  private async readDurableHead(layout: DocumentLayout, scope?: DocumentScope) {
    const cached = this.acceptedFrameWalIndexes.get(layout.directory)
    if (cached) {
      if (scope) assertSameScope(cached.currentHead.record.scope, scope)
      return cached.currentHead
    }
    const base = await this.readBaseDurableHead(layout, scope)
    return (await this.loadAcceptedFrameWalIndex(layout, base, false)).currentHead
  }

  private async loadAcceptedFrameWalIndex(
    layout: DocumentLayout,
    base: Readonly<{ readonly record: LocalDurableHead; readonly digest: Digest }>,
    repairTruncatedTail: boolean,
  ): Promise<AcceptedFrameWalIndex> {
    const cached = this.acceptedFrameWalIndexes.get(layout.directory)
    if (cached) {
      if (cached.header.baseReplicaHeadRecordDigest !== base.digest) {
        if (cached.entries.length !== 0) corrupt("Accepted-frame WAL cache is bound to another base head")
        const headCache = this.materializedHeadCaches.get(layout.directory)
        const materializationDigest = headCache && this.materializedHeadCacheMatches(headCache, base.record, base.digest)
          ? headCache.acceptedIdentity.materializationDigest
          : cached.header.baseMaterializationDigest
        const rebound = emptyAcceptedFrameWalIndex(
          acceptedFrameWalHeader(base.record, base.digest, materializationDigest),
          cached.headerByteLength,
          base.record,
          base.digest,
          false,
        )
        this.acceptedFrameWalIndexes.set(layout.directory, rebound)
        return rebound
      }
      return cached
    }
    let scan: Awaited<ReturnType<typeof scanAcceptedFrameWalFile>>
    try {
      scan = await scanAcceptedFrameWalFile(layout.acceptedFrameWal, { repairTruncatedTail })
    } catch (error) {
      throw new NodeCollaborationPersistenceError("store-corrupt", "Accepted-frame WAL cannot be scanned", { cause: error })
    }
    persistenceWalColdScans += 1
    const persistedHeader = parseAcceptedFrameWalHeader(decodeRecord(scan.headerBytes))
    assertSameScope(persistedHeader.scope, base.record.scope)
    const staleEmptyHeader =
      persistedHeader.baseReplicaHeadRecordDigest !== base.digest ||
      persistedHeader.baseLocalHeadGeneration !== base.record.localHeadGeneration ||
      persistedHeader.baseJournalTailDigest !== base.record.journalTailDigest
    if (staleEmptyHeader && scan.entries.length !== 0) {
      corrupt("Accepted-frame WAL base binding differs from the durable base head")
    }
    const header = staleEmptyHeader
      ? acceptedFrameWalHeader(base.record, base.digest, persistedHeader.baseMaterializationDigest)
      : persistedHeader
    const baseJournal = await readJournalBase(layout.journalBases, base.record.journalBaseDigest, base.record.scope)
    if (
      !staleEmptyHeader &&
      baseJournal.record.baseLocalRecordSequence === base.record.localHeadGeneration &&
      header.baseMaterializationDigest !== baseJournal.record.materializationDigest
    ) corrupt("Accepted-frame WAL base materialization differs from the installed journal base")
    const index = emptyAcceptedFrameWalIndex(
      header,
      scan.headerByteLength,
      base.record,
      base.digest,
      !staleEmptyHeader,
    )
    let currentMaterializationDigest = header.baseMaterializationDigest
    for (const file of scan.entries) {
      persistenceWalRecordsVisited += 1
      const decoded = decodeRecord(file.headerBytes)
      if ((decoded as { readonly format?: unknown }).format === "convax.local-accepted-frame-wal-ack-record") {
        const record = parseAcceptedFrameWalAckRecord(decoded)
        const entry = Object.freeze({ file, record }) satisfies AcceptedFrameWalAckEntry
        const core = record.core
        assertSameScope(core.scope, header.scope)
        if (
          core.sequence !== incrementUint64(index.currentHead.record.localHeadGeneration) ||
          core.priorAtomicCommitRecordDigest !== index.tailAtomicCommitRecordDigest ||
          core.expectedReplicaHeadRecordDigest !== index.currentHead.digest ||
          file.exactFrameByteLength !== 0 ||
          file.stateVectorBytes.byteLength !== 0
        ) corrupt("Accepted-frame WAL ACK sequence, predecessor, or payload is invalid")
        if (
          localRecordDigest(core.journalRecord) !== core.journalRecordDigest ||
          localRecordDigest(core.resultingHeadRecord) !== core.resultingReplicaHeadRecordDigest ||
          localRecordDigest(core) !== record.atomicCommitRecordDigest
        ) corrupt("Accepted-frame WAL ACK logical record digest is invalid")
        const ack = core.ackRecord
        const journal = core.journalRecord
        if (
          journal.transition !== "record-durable-ack" ||
          journal.localRecordSequence !== core.sequence ||
          journal.priorJournalRecordDigest !== index.currentHead.record.journalTailDigest ||
          journal.objectDigests.length !== 1 ||
          journal.objectDigests[0] !== ack.ackCoreDigest ||
          journal.outboxRefDigest !== null ||
          journal.operationRef !== null ||
          journal.resultingFrontierDigest !== index.currentHead.record.acceptedFrontierDigest
        ) corrupt("Accepted-frame WAL ACK journal closure is invalid")
        const resultingHead = core.resultingHeadRecord
        if (
          resultingHead.localHeadGeneration !== core.sequence ||
          resultingHead.priorHeadDigest !== index.currentHead.digest ||
          resultingHead.journalBaseDigest !== index.currentHead.record.journalBaseDigest ||
          resultingHead.journalTailDigest !== core.journalRecordDigest ||
          resultingHead.installedCheckpointSetDigest !== index.currentHead.record.installedCheckpointSetDigest ||
          resultingHead.acceptedFrontierDigest !== index.currentHead.record.acceptedFrontierDigest ||
          resultingHead.acceptedActorHeadsDigest !== index.currentHead.record.acceptedActorHeadsDigest
        ) corrupt("Accepted-frame WAL ACK resulting head closure is invalid")
        if (index.byAckCoreDigest.has(ack.ackCoreDigest)) {
          corrupt("Accepted-frame WAL contains a duplicate durable ACK")
        }
        index.entries.push(entry)
        index.byAckCoreDigest.set(ack.ackCoreDigest, entry)
        index.activeOutboxByFrameDigest.delete(ack.frameDigest)
        index.currentHead = Object.freeze({ record: resultingHead, digest: core.resultingReplicaHeadRecordDigest })
        index.validByteLength = file.byteOffset + file.byteLength
        index.tailAtomicCommitRecordDigest = record.atomicCommitRecordDigest
        continue
      }
      if ((decoded as { readonly format?: unknown }).format === "convax.local-accepted-frame-wal-checkpoint-record") {
        const record = parseAcceptedFrameWalCheckpointRecord(decoded)
        const entry = Object.freeze({ file, record }) satisfies AcceptedFrameWalCheckpointEntry
        const core = record.core
        assertSameScope(core.scope, header.scope)
        if (
          core.sequence !== incrementUint64(index.currentHead.record.localHeadGeneration) ||
          core.priorAtomicCommitRecordDigest !== index.tailAtomicCommitRecordDigest ||
          core.expectedReplicaHeadRecordDigest !== index.currentHead.digest ||
          file.exactFrameByteLength !== 0 ||
          file.stateVectorBytes.byteLength !== 0
        ) corrupt("Accepted-frame WAL checkpoint sequence, predecessor, or payload is invalid")
        if (
          localRecordDigest(core.journalRecord) !== core.journalRecordDigest ||
          localRecordDigest(core.resultingHeadRecord) !== core.resultingReplicaHeadRecordDigest ||
          localRecordDigest(core) !== record.atomicCommitRecordDigest
        ) corrupt("Accepted-frame WAL checkpoint logical record digest is invalid")
        const journal = core.journalRecord
        if (
          journal.transition !== "install-checkpoint-set" ||
          journal.localRecordSequence !== core.sequence ||
          journal.priorJournalRecordDigest !== index.currentHead.record.journalTailDigest ||
          journal.objectDigests.length !== 1 ||
          journal.objectDigests[0] !== core.installedCheckpointSetDigest ||
          journal.outboxRefDigest !== null ||
          journal.operationRef !== null ||
          journal.resultingFrontierDigest !== index.currentHead.record.acceptedFrontierDigest
        ) corrupt("Accepted-frame WAL checkpoint journal closure is invalid")
        const resultingHead = core.resultingHeadRecord
        if (
          resultingHead.localHeadGeneration !== core.sequence ||
          resultingHead.priorHeadDigest !== index.currentHead.digest ||
          resultingHead.journalBaseDigest !== index.currentHead.record.journalBaseDigest ||
          resultingHead.journalTailDigest !== core.journalRecordDigest ||
          resultingHead.installedCheckpointSetDigest !== core.installedCheckpointSetDigest ||
          resultingHead.acceptedFrontierDigest !== index.currentHead.record.acceptedFrontierDigest ||
          resultingHead.acceptedActorHeadsDigest !== index.currentHead.record.acceptedActorHeadsDigest
        ) corrupt("Accepted-frame WAL checkpoint resulting head closure is invalid")
        await this.readInstalledCheckpointSet(layout, core.installedCheckpointSetDigest, core.scope)
        index.entries.push(entry)
        index.currentHead = Object.freeze({ record: resultingHead, digest: core.resultingReplicaHeadRecordDigest })
        index.validByteLength = file.byteOffset + file.byteLength
        index.tailAtomicCommitRecordDigest = record.atomicCommitRecordDigest
        continue
      }
      if ((decoded as { readonly format?: unknown }).format === "convax.local-accepted-frame-wal-prune-record") {
        const record = parseAcceptedFrameWalPruneRecord(decoded)
        const entry = Object.freeze({ file, record }) satisfies AcceptedFrameWalPruneEntry
        const core = record.core
        assertSameScope(core.scope, header.scope)
        if (
          core.sequence !== incrementUint64(index.currentHead.record.localHeadGeneration) ||
          core.priorAtomicCommitRecordDigest !== index.tailAtomicCommitRecordDigest ||
          core.expectedReplicaHeadRecordDigest !== index.currentHead.digest ||
          file.exactFrameByteLength !== 0 ||
          file.stateVectorBytes.byteLength !== 0
        ) corrupt("Accepted-frame WAL prune sequence, predecessor, or payload is invalid")
        if (
          localRecordDigest(core.journalRecord) !== core.journalRecordDigest ||
          localRecordDigest(core.resultingHeadRecord) !== core.resultingReplicaHeadRecordDigest ||
          localRecordDigest(core) !== record.atomicCommitRecordDigest
        ) corrupt("Accepted-frame WAL prune logical record digest is invalid")
        const plan = await readPrunePlan(layout, core.prunePlanDigest, core.scope)
        if (
          plan.expectedDurableHeadRecordDigest !== index.currentHead.digest ||
          plan.newJournalBaseDigest !== core.journalBaseDigest ||
          plan.startJournalRecordDigest !== core.journalRecordDigest ||
          plan.candidateDurableHeadRecordDigest !== core.resultingReplicaHeadRecordDigest
        ) corrupt("Accepted-frame WAL prune plan closure is invalid")
        const pruneBase = await readJournalBase(layout.journalBases, core.journalBaseDigest, core.scope)
        const journal = core.journalRecord
        if (
          journal.transition !== "start-prunable-journal-base" ||
          journal.localRecordSequence !== core.sequence ||
          journal.priorJournalRecordDigest !== index.currentHead.record.journalTailDigest ||
          journal.objectDigests.length !== 1 ||
          journal.objectDigests[0] !== core.journalBaseDigest ||
          journal.outboxRefDigest !== null ||
          journal.operationRef !== null ||
          journal.resultingFrontierDigest !== index.currentHead.record.acceptedFrontierDigest ||
          pruneBase.record.baseLocalRecordSequence !== core.sequence
        ) corrupt("Accepted-frame WAL prune journal-base closure is invalid")
        const resultingHead = core.resultingHeadRecord
        if (
          resultingHead.localHeadGeneration !== core.sequence ||
          resultingHead.priorHeadDigest !== index.currentHead.digest ||
          resultingHead.journalBaseDigest !== core.journalBaseDigest ||
          resultingHead.journalTailDigest !== core.journalBaseDigest ||
          resultingHead.installedCheckpointSetDigest !== index.currentHead.record.installedCheckpointSetDigest ||
          resultingHead.acceptedFrontierDigest !== pruneBase.record.frontierDigest ||
          resultingHead.acceptedActorHeadsDigest !== pruneBase.record.actorHeadsDigest ||
          index.activeOutboxByFrameDigest.size !== 0
        ) corrupt("Accepted-frame WAL prune resulting head closure is invalid")
        index.entries.push(entry)
        index.byFrameDigest.clear()
        index.byJournalDigest.clear()
        index.byOperation.clear()
        index.reachableFrameDigests.clear()
        index.currentHead = Object.freeze({ record: resultingHead, digest: core.resultingReplicaHeadRecordDigest })
        index.validByteLength = file.byteOffset + file.byteLength
        index.tailAtomicCommitRecordDigest = record.atomicCommitRecordDigest
        currentMaterializationDigest = pruneBase.record.materializationDigest
        continue
      }
      const parsed = parseAcceptedFrameWalRecord(decoded, file.stateVectorBytes)
      const entry = Object.freeze({ file, ...parsed }) satisfies AcceptedFrameWalEntry
      const core = entry.record.core
      assertSameScope(core.scope, header.scope)
      if (
        core.sequence !== incrementUint64(index.currentHead.record.localHeadGeneration) ||
        core.priorAtomicCommitRecordDigest !== index.tailAtomicCommitRecordDigest ||
        core.expectedReplicaHeadRecordDigest !== index.currentHead.digest
      ) corrupt("Accepted-frame WAL sequence or predecessor chain is invalid")
      if (
        core.durableDelta.baseDurableHeadRecordDigest !== index.currentHead.digest ||
        core.durableDelta.baseMaterializationDigest !== currentMaterializationDigest ||
        core.durableDelta.frameDigest !== core.ref.frameDigest
      ) corrupt("Accepted-frame WAL durable delta base binding is invalid")
      if (
        String(file.exactFrameByteLength) !== core.exactFrameByteLength
      ) corrupt("Accepted-frame WAL exact-frame identity is invalid")
      const exactFrameBytes = await readAcceptedFrameWalBytes(
        layout.acceptedFrameWal,
        file.exactFrameByteOffset,
        file.exactFrameByteLength,
      )
      if (ordinaryDigest(exactFrameBytes) !== core.exactFrameSha256) {
        corrupt("Accepted-frame WAL exact frame mismatches its digest")
      }
      const inspected = await this.materializer.inspectFrame(core.ref, exactFrameBytes)
      assertSameFrameRef(inspected.ref, core.ref)
      const requiredBlobDigests = normalizeDigestSet(inspected.requiredBlobDigests, 256)
      assertOutboxRef(core.outboxRecord, core.ref)
      if (restrictedJcs(requiredBlobDigests) !== restrictedJcs(core.outboxRecord.requiredBlobDigests)) {
        corrupt("Accepted-frame WAL outbox blob closure differs from the exact frame")
      }
      if (
        acceptedFrameRecordDigest(core.ref, core.exactFrameSha256, core.exactFrameByteLength) !== core.frameRecordDigest ||
        localRecordDigest(core.outboxRecord) !== core.outboxRecordDigest ||
        localRecordDigest(core.journalRecord) !== core.journalRecordDigest ||
        localRecordDigest(core.resultingHeadRecord) !== core.resultingReplicaHeadRecordDigest ||
        localRecordDigest(core) !== entry.record.atomicCommitRecordDigest
      ) corrupt("Accepted-frame WAL logical record digest is invalid")
      assertJournalRef(core.journalRecord, core.ref)
      if (
        core.journalRecord.localRecordSequence !== core.sequence ||
        core.journalRecord.priorJournalRecordDigest !== index.currentHead.record.journalTailDigest ||
        core.journalRecord.outboxRefDigest !== core.outboxRecordDigest ||
        core.journalRecord.resultingFrontierDigest !== core.durableDelta.resultingFrontierDigest
      ) corrupt("Accepted-frame WAL journal closure is invalid")
      const resultingHead = core.resultingHeadRecord
      if (
        resultingHead.localHeadGeneration !== core.sequence ||
        resultingHead.priorHeadDigest !== index.currentHead.digest ||
        resultingHead.journalBaseDigest !== index.currentHead.record.journalBaseDigest ||
        resultingHead.journalTailDigest !== core.journalRecordDigest ||
        resultingHead.installedCheckpointSetDigest !== index.currentHead.record.installedCheckpointSetDigest ||
        resultingHead.acceptedFrontierDigest !== core.durableDelta.resultingFrontierDigest ||
        resultingHead.acceptedActorHeadsDigest !== core.durableDelta.resultingActorHeadsDigest
      ) corrupt("Accepted-frame WAL resulting head closure is invalid")
      if (index.byFrameDigest.has(core.ref.frameDigest)) {
        corrupt("Accepted-frame WAL contains a duplicate accepted frame")
      }
      const operationKey = operationRecoveryKey(core.ref.actorId, core.ref.operationId)
      let operation = index.byOperation.get(operationKey)
      if (!operation) {
        operation = new Map()
        index.byOperation.set(operationKey, operation)
      }
      if (operation.size > 0 && !operation.has(core.ref.frameDigest)) {
        corrupt("Accepted-frame WAL contains accepted operation equivocation")
      }
      operation.set(core.ref.frameDigest, entry)
      index.entries.push(entry)
      index.byFrameDigest.set(core.ref.frameDigest, entry)
      index.byJournalDigest.set(core.journalRecordDigest, entry)
      index.activeOutboxByFrameDigest.set(core.ref.frameDigest, entry)
      index.reachableFrameDigests.add(core.ref.frameDigest)
      index.currentHead = Object.freeze({ record: resultingHead, digest: core.resultingReplicaHeadRecordDigest })
      index.validByteLength = file.byteOffset + file.byteLength
      index.tailAtomicCommitRecordDigest = entry.record.atomicCommitRecordDigest
      currentMaterializationDigest = entry.durableDelta.resultingMaterializationDigest
    }
    if (index.validByteLength !== scan.validByteLength) {
      corrupt("Accepted-frame WAL valid tail differs from its parsed record chain")
    }
    this.acceptedFrameWalIndexes.set(layout.directory, index)
    return index
  }

  private async assertReadableDocument(layout: DocumentLayout): Promise<void> {
    const stat = await fs.lstat(layout.directory).catch((error) => {
      throw new NodeCollaborationPersistenceError("document-not-found", "Collaboration shard does not exist", { cause: error })
    })
    if (!stat.isDirectory() || stat.isSymbolicLink()) corrupt("Collaboration shard is not a trusted directory")
  }

  private async assertWritableDocument(layout: DocumentLayout): Promise<void> {
    await this.assertReadableDocument(layout)
    if (await fileExists(layout.dispositionHead)) recoverRequired("Collaboration shard is quarantined read-only")
  }

  private async assertOutboxCapacity(layout: DocumentLayout, incomingBytes: number): Promise<void> {
    const usage = await this.loadOutboxUsage(layout)
    if (usage.frameBytes.size >= MAX_OUTBOX_FRAMES) {
      throw new NodeCollaborationPersistenceError("outbox-backpressure", "Local frame outbox reached 4,096 refs")
    }
    if (usage.totalBytes + incomingBytes > MAX_OUTBOX_BYTES) {
      throw new NodeCollaborationPersistenceError("outbox-backpressure", "Local frame outbox reached 512 MiB")
    }
  }

  private async pendingInboxCapacity(
    layout: DocumentLayout,
    incomingActorId: ActorId,
    incomingBytes: number,
  ): Promise<boolean> {
    const names = await readDirectoryNames(layout.pendingInbox)
    if (names.length >= MAX_PENDING_DOCUMENT_FRAMES) return false
    let documentBytes = incomingBytes
    let actorFrames = 1
    let actorBytes = incomingBytes
    for (const name of names) {
      const loaded = await readPendingFrame(path.join(layout.pendingInbox, name))
      if (path.basename(this.pendingFramePath(layout, loaded.record.ref.frameDigest)) !== name) {
        corrupt("Pending frame filename and digest differ")
      }
      const byteLength = Number(loaded.record.frameByteLength)
      documentBytes += byteLength
      if (loaded.record.ref.actorId === incomingActorId) {
        actorFrames += 1
        actorBytes += byteLength
      }
      if (documentBytes > MAX_PENDING_DOCUMENT_BYTES || actorFrames > MAX_PENDING_ACTOR_FRAMES || actorBytes > MAX_PENDING_ACTOR_BYTES) {
        return false
      }
    }
    return true
  }

  private pendingFramePath(layout: DocumentLayout, frameDigest: Digest): string {
    return path.join(layout.pendingInbox, `${deriveObjectNativeKey("pending-frame", frameDigest)}.bin`)
  }

  private async createDocumentLayout(layout: DocumentLayout): Promise<void> {
    await ensureTrustedDirectory(path.dirname(layout.directory), this.collaborationDirectory)
    await fs.mkdir(layout.directory, { mode: 0o700 })
    for (const directory of [
      layout.frames,
      layout.acks,
      layout.checkpoints,
      layout.certificates,
      layout.floors,
      layout.certificates,
      layout.genesisProofs,
      layout.checkpointSets,
      layout.journalBases,
      layout.journalSegments,
      path.dirname(layout.durableHead),
      layout.outboxFrames,
      layout.pendingInbox,
      layout.operationRefs,
      layout.quarantine,
      path.dirname(layout.dispositionHead),
      layout.prunePlans,
      path.dirname(layout.activePrunePlan),
      layout.pruneTrash,
    ]) {
      await ensureTrustedDirectory(directory, this.collaborationDirectory)
    }
    await fsyncProjectDirectory(layout.directory)
    await fsyncProjectDirectory(path.dirname(layout.directory))
  }

  private layout(scope: DocumentScope): DocumentLayout {
    return this.layoutFromDirectory(path.join(this.collaborationDirectory, "documents", deriveDocumentNativeKey(scope)))
  }

  private layoutFromDirectory(directory: string): DocumentLayout {
    return {
      directory,
      frames: path.join(directory, "objects", "frames"),
      acks: path.join(directory, "objects", "acks"),
      checkpoints: path.join(directory, "objects", "checkpoints"),
      certificates: path.join(directory, "objects", "certificates"),
      floors: path.join(directory, "floors"),
      genesisProofs: path.join(directory, "objects", "genesis-proofs"),
      checkpointSets: path.join(directory, "snapshots", "sets"),
      journalBases: path.join(directory, "journals", "bases"),
      journalSegments: path.join(directory, "journals", "segments"),
      acceptedFrameWal: path.join(directory, "journals", "accepted-frames.wal"),
      durableHead: path.join(directory, "heads", "durable-head.bin"),
      outboxFrames: path.join(directory, "outbox", "frames"),
      pendingInbox: path.join(directory, "inbox", "pending-frames"),
      operationRefs: path.join(directory, "recovery", "operations"),
      quarantine: path.join(directory, "quarantine"),
      dispositionHead: path.join(directory, "recovery", "shard-disposition-head.bin"),
      prunePlans: path.join(directory, "prune", "plans"),
      activePrunePlan: path.join(directory, "prune", "active-plan.bin"),
      pruneTrash: path.join(directory, "prune", "trash"),
    }
  }

  private serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => current)
    this.queues.set(key, tail)
    return previous
      .catch(() => undefined)
      .then(operation)
      .finally(() => {
        release()
        if (this.queues.get(key) === tail) this.queues.delete(key)
      })
  }

  private requireLive(): void {
    if (this.disposed) recoverRequired("Project collaboration writer is disposed")
  }
}

function committedEvidence(
  input: Parameters<NodeCollaborationPersistence["compareAndCommitReplicaHead"]>[0],
  resultingReplicaHeadRecordDigest: Digest,
): CompareAndCommitReplicaHeadPortResult {
  return {
    status: "committed",
    evidence: {
      ref: input.ref,
      journalRecordDigest: input.journal.journalRecordDigest,
      expectedReplicaHeadRecordDigest: input.expectedReplicaHeadRecordDigest,
      resultingReplicaHeadRecordDigest,
      resultingFrontierDigest: input.resultingFrontierDigest,
    },
  }
}

function acceptedFrameWalHeader(
  head: LocalDurableHead,
  headDigest: Digest,
  materializationDigest: Digest,
): LocalAcceptedFrameWalHeader {
  return Object.freeze({
    format: "convax.local-accepted-frame-wal-header",
    layout: "single-file-accepted-frame-log-v1",
    scope: head.scope,
    baseReplicaHeadRecordDigest: headDigest,
    baseLocalHeadGeneration: head.localHeadGeneration,
    baseJournalTailDigest: head.journalTailDigest,
    baseMaterializationDigest: materializationDigest,
    outboxRequirement: ACCEPTED_FRAME_OUTBOX_REQUIREMENT,
  })
}

function emptyAcceptedFrameWalIndex(
  header: LocalAcceptedFrameWalHeader,
  headerByteLength: number,
  head: LocalDurableHead,
  headDigest: Digest,
  headerDurablyCurrent = true,
): AcceptedFrameWalIndex {
  return {
    header,
    headerByteLength,
    baseHead: Object.freeze({ record: head, digest: headDigest }),
    entries: [],
    byFrameDigest: new Map(),
    byJournalDigest: new Map(),
    byAckCoreDigest: new Map(),
    byOperation: new Map(),
    activeOutboxByFrameDigest: new Map(),
    reachableFrameDigests: createOwnedReachableFrameDigests(),
    headerDurablyCurrent,
    currentHead: Object.freeze({ record: head, digest: headDigest }),
    validByteLength: headerByteLength,
    tailAtomicCommitRecordDigest: null,
  }
}

function acceptedFrameRecordDigest(
  ref: FrameObjectRef,
  exactFrameSha256: Digest,
  exactFrameByteLength: string,
): Digest {
  return localRecordDigest({
    format: "convax.local-atomic-frame-record",
    ref,
    exactFrameSha256,
    exactFrameByteLength,
  })
}

function serializeAcceptedFrameWalDurableDelta(
  delta: AcceptedHeadDurableDeltaMetadata,
): LocalAcceptedFrameWalDurableDelta {
  return Object.freeze({
    format: delta.format,
    scope: delta.scope,
    protocolDigest: delta.protocolDigest,
    baseDurableHeadRecordDigest: delta.baseDurableHeadRecordDigest,
    baseMaterializationDigest: delta.baseMaterializationDigest,
    frameDigest: delta.frameDigest,
    yjsUpdateDigest: delta.yjsUpdateDigest,
    resultingFrontier: delta.resultingFrontier,
    resultingFrontierDigest: delta.resultingFrontierDigest,
    resultingActorHeads: delta.resultingActorHeads,
    resultingActorHeadsDigest: delta.resultingActorHeadsDigest,
    stateVectorDigest: delta.stateVectorDigest,
    stateVectorByteLength: String(delta.stateVector.byteLength),
    canonicalStateDigest: delta.canonicalStateDigest,
    resultingMaterializationDigest: delta.resultingMaterializationDigest,
  })
}

function parseAcceptedFrameWalHeader(value: unknown): LocalAcceptedFrameWalHeader {
  requireFormat(value, "convax.local-accepted-frame-wal-header", [
    "baseJournalTailDigest", "baseLocalHeadGeneration", "baseMaterializationDigest",
    "baseReplicaHeadRecordDigest", "format", "layout", "outboxRequirement", "scope",
  ])
  const header = value as unknown as LocalAcceptedFrameWalHeader
  if (
    header.layout !== "single-file-accepted-frame-log-v1" ||
    header.outboxRequirement !== ACCEPTED_FRAME_OUTBOX_REQUIREMENT
  ) corrupt("Accepted-frame WAL header contract is invalid")
  deriveDocumentNativeKey(header.scope)
  parseDigest(header.baseReplicaHeadRecordDigest)
  parseUint64(header.baseLocalHeadGeneration)
  parseDigest(header.baseJournalTailDigest)
  parseDigest(header.baseMaterializationDigest)
  return Object.freeze(header)
}

function parseAcceptedFrameWalDurableDelta(
  value: unknown,
  stateVector: Readonly<Uint8Array>,
): AcceptedHeadDurableDeltaMetadata {
  requireFormat(value, "convax.accepted-head-durable-delta-metadata", [
    "baseDurableHeadRecordDigest", "baseMaterializationDigest", "canonicalStateDigest", "format",
    "frameDigest", "protocolDigest", "resultingActorHeads", "resultingActorHeadsDigest",
    "resultingFrontier", "resultingFrontierDigest", "resultingMaterializationDigest", "scope",
    "stateVectorByteLength", "stateVectorDigest", "yjsUpdateDigest",
  ])
  const stored = value as unknown as LocalAcceptedFrameWalDurableDelta
  validateUint64(stored.stateVectorByteLength, "Accepted-frame WAL state-vector length")
  if (String(stateVector.byteLength) !== stored.stateVectorByteLength) {
    corrupt("Accepted-frame WAL state-vector length mismatches its record")
  }
  try {
    return parseAcceptedHeadDurableDeltaMetadata({
      format: stored.format,
      scope: stored.scope,
      protocolDigest: stored.protocolDigest,
      baseDurableHeadRecordDigest: stored.baseDurableHeadRecordDigest,
      baseMaterializationDigest: stored.baseMaterializationDigest,
      frameDigest: stored.frameDigest,
      yjsUpdateDigest: stored.yjsUpdateDigest,
      resultingFrontier: stored.resultingFrontier,
      resultingFrontierDigest: stored.resultingFrontierDigest,
      resultingActorHeads: stored.resultingActorHeads,
      resultingActorHeadsDigest: stored.resultingActorHeadsDigest,
      stateVector: Uint8Array.from(stateVector),
      stateVectorDigest: stored.stateVectorDigest,
      canonicalStateDigest: stored.canonicalStateDigest,
      resultingMaterializationDigest: stored.resultingMaterializationDigest,
    })
  } catch (error) {
    throw new NodeCollaborationPersistenceError(
      "store-corrupt",
      "Accepted-frame WAL durable delta is invalid",
      { cause: error },
    )
  }
}

function parseAcceptedFrameWalRecord(
  value: unknown,
  stateVector: Readonly<Uint8Array>,
): Readonly<{ record: LocalAcceptedFrameWalRecord; durableDelta: AcceptedHeadDurableDeltaMetadata }> {
  requireFormat(value, "convax.local-accepted-frame-wal-record", [
    "atomicCommitRecordDigest", "core", "format",
  ])
  const wrapper = value as unknown as LocalAcceptedFrameWalRecord
  requireFormat(wrapper.core, "convax.local-accepted-frame-wal-record-core", [
    "durableDelta", "exactFrameByteLength", "exactFrameSha256", "expectedReplicaHeadRecordDigest",
    "format", "frameRecordDigest", "journalRecord", "journalRecordDigest", "outboxRecord",
    "outboxRecordDigest", "priorAtomicCommitRecordDigest", "ref", "resultingHeadRecord",
    "resultingReplicaHeadRecordDigest", "scope", "sequence",
  ])
  const core = wrapper.core
  deriveDocumentNativeKey(core.scope)
  validateFrameRef(core.ref)
  assertSameScope(core.ref.scope, core.scope)
  validateUint64(core.sequence, "Accepted-frame WAL record sequence")
  validateUint64(core.exactFrameByteLength, "Accepted-frame WAL exact-frame length")
  if (BigInt(core.exactFrameByteLength) < 1n || BigInt(core.exactFrameByteLength) > BigInt(MAX_FRAME_BYTES)) {
    corrupt("Accepted-frame WAL exact-frame length is outside bounds")
  }
  for (const digest of [
    core.exactFrameSha256,
    core.frameRecordDigest,
    core.outboxRecordDigest,
    core.journalRecordDigest,
    core.expectedReplicaHeadRecordDigest,
    core.resultingReplicaHeadRecordDigest,
    wrapper.atomicCommitRecordDigest,
  ]) parseDigest(digest)
  if (core.priorAtomicCommitRecordDigest !== null) parseDigest(core.priorAtomicCommitRecordDigest)
  const durableDelta = parseAcceptedFrameWalDurableDelta(core.durableDelta, stateVector)
  const outboxRecord = parseOutbox(core.outboxRecord)
  const journalRecord = parseJournal(core.journalRecord)
  const resultingHeadRecord = parseDurableHead(core.resultingHeadRecord)
  const record: LocalAcceptedFrameWalRecord = Object.freeze({
    format: wrapper.format,
    core: Object.freeze({ ...core, durableDelta: serializeAcceptedFrameWalDurableDelta(durableDelta), outboxRecord, journalRecord, resultingHeadRecord }),
    atomicCommitRecordDigest: wrapper.atomicCommitRecordDigest,
  })
  return Object.freeze({ record, durableDelta })
}

function parseAcceptedFrameWalAckRecord(value: unknown): LocalAcceptedFrameWalAckRecord {
  requireFormat(value, "convax.local-accepted-frame-wal-ack-record", [
    "atomicCommitRecordDigest", "core", "format",
  ])
  const wrapper = value as unknown as LocalAcceptedFrameWalAckRecord
  requireFormat(wrapper.core, "convax.local-accepted-frame-wal-ack-record-core", [
    "ackRecord", "expectedReplicaHeadRecordDigest", "format", "journalRecord",
    "journalRecordDigest", "priorAtomicCommitRecordDigest", "resultingHeadRecord",
    "resultingReplicaHeadRecordDigest", "scope", "sequence",
  ])
  const core = wrapper.core
  deriveDocumentNativeKey(core.scope)
  validateUint64(core.sequence, "Accepted-frame WAL ACK sequence")
  for (const digest of [
    core.journalRecordDigest,
    core.expectedReplicaHeadRecordDigest,
    core.resultingReplicaHeadRecordDigest,
    wrapper.atomicCommitRecordDigest,
  ]) parseDigest(digest)
  if (core.priorAtomicCommitRecordDigest !== null) parseDigest(core.priorAtomicCommitRecordDigest)
  const ackRecord = parseAckRecord(core.ackRecord)
  const journalRecord = parseJournal(core.journalRecord)
  const resultingHeadRecord = parseDurableHead(core.resultingHeadRecord)
  assertSameScope(ackRecord.scope, core.scope)
  assertSameScope(journalRecord.scope, core.scope)
  assertSameScope(resultingHeadRecord.scope, core.scope)
  return Object.freeze({
    format: wrapper.format,
    core: Object.freeze({ ...core, ackRecord, journalRecord, resultingHeadRecord }),
    atomicCommitRecordDigest: wrapper.atomicCommitRecordDigest,
  })
}

function parseAcceptedFrameWalCheckpointRecord(value: unknown): LocalAcceptedFrameWalCheckpointRecord {
  requireFormat(value, "convax.local-accepted-frame-wal-checkpoint-record", [
    "atomicCommitRecordDigest", "core", "format",
  ])
  const wrapper = value as unknown as LocalAcceptedFrameWalCheckpointRecord
  requireFormat(wrapper.core, "convax.local-accepted-frame-wal-checkpoint-record-core", [
    "expectedReplicaHeadRecordDigest", "format", "installedCheckpointSetDigest",
    "journalRecord", "journalRecordDigest", "priorAtomicCommitRecordDigest",
    "resultingHeadRecord", "resultingReplicaHeadRecordDigest", "scope", "sequence",
  ])
  const core = wrapper.core
  deriveDocumentNativeKey(core.scope)
  validateUint64(core.sequence, "Accepted-frame WAL checkpoint sequence")
  for (const digest of [
    core.installedCheckpointSetDigest,
    core.journalRecordDigest,
    core.expectedReplicaHeadRecordDigest,
    core.resultingReplicaHeadRecordDigest,
    wrapper.atomicCommitRecordDigest,
  ]) parseDigest(digest)
  if (core.priorAtomicCommitRecordDigest !== null) parseDigest(core.priorAtomicCommitRecordDigest)
  const journalRecord = parseJournal(core.journalRecord)
  const resultingHeadRecord = parseDurableHead(core.resultingHeadRecord)
  assertSameScope(journalRecord.scope, core.scope)
  assertSameScope(resultingHeadRecord.scope, core.scope)
  return Object.freeze({
    format: wrapper.format,
    core: Object.freeze({ ...core, journalRecord, resultingHeadRecord }),
    atomicCommitRecordDigest: wrapper.atomicCommitRecordDigest,
  })
}

function parseAcceptedFrameWalPruneRecord(value: unknown): LocalAcceptedFrameWalPruneRecord {
  requireFormat(value, "convax.local-accepted-frame-wal-prune-record", [
    "atomicCommitRecordDigest", "core", "format",
  ])
  const wrapper = value as unknown as LocalAcceptedFrameWalPruneRecord
  requireFormat(wrapper.core, "convax.local-accepted-frame-wal-prune-record-core", [
    "expectedReplicaHeadRecordDigest", "format", "journalBaseDigest", "journalRecord",
    "journalRecordDigest", "priorAtomicCommitRecordDigest", "prunePlanDigest",
    "resultingHeadRecord", "resultingReplicaHeadRecordDigest", "scope", "sequence",
  ])
  const core = wrapper.core
  deriveDocumentNativeKey(core.scope)
  validateUint64(core.sequence, "Accepted-frame WAL prune sequence")
  for (const digest of [
    core.prunePlanDigest,
    core.journalBaseDigest,
    core.journalRecordDigest,
    core.expectedReplicaHeadRecordDigest,
    core.resultingReplicaHeadRecordDigest,
    wrapper.atomicCommitRecordDigest,
  ]) parseDigest(digest)
  if (core.priorAtomicCommitRecordDigest !== null) parseDigest(core.priorAtomicCommitRecordDigest)
  const journalRecord = parseJournal(core.journalRecord)
  const resultingHeadRecord = parseDurableHead(core.resultingHeadRecord)
  assertSameScope(journalRecord.scope, core.scope)
  assertSameScope(resultingHeadRecord.scope, core.scope)
  return Object.freeze({
    format: wrapper.format,
    core: Object.freeze({ ...core, journalRecord, resultingHeadRecord }),
    atomicCommitRecordDigest: wrapper.atomicCommitRecordDigest,
  })
}

function acceptedFrameAtomicCommitEvidence(entry: AcceptedFrameWalEntry): CommitAcceptedFramePortResult {
  const core = entry.record.core
  return Object.freeze({
    status: "committed" as const,
    evidence: Object.freeze({
      format: "convax.accepted-frame-atomic-commit-evidence" as const,
      ref: core.ref,
      frameRecordDigest: core.frameRecordDigest,
      outboxRecordDigest: core.outboxRecordDigest,
      journalRecordDigest: core.journalRecordDigest,
      expectedReplicaHeadRecordDigest: core.expectedReplicaHeadRecordDigest,
      resultingReplicaHeadRecordDigest: core.resultingReplicaHeadRecordDigest,
      resultingFrontierDigest: core.durableDelta.resultingFrontierDigest,
      resultingMaterializationDigest: core.durableDelta.resultingMaterializationDigest,
      atomicCommitRecordDigest: entry.record.atomicCommitRecordDigest,
    }),
  })
}

function operationRecoveryKey(actorId: ActorId, operationId: Id128): string {
  return `${actorId}\0${operationId}`
}

function addOperationRecoveryIndexEntry(
  index: Map<string, Map<Digest, IndexedOperationFrame>>,
  entry: IndexedOperationFrame,
): void {
  const key = operationRecoveryKey(entry.ref.actorId, entry.ref.operationId)
  let byDigest = index.get(key)
  if (!byDigest) {
    byDigest = new Map()
    index.set(key, byDigest)
  }
  const existing = byDigest.get(entry.ref.frameDigest)
  if (existing && restrictedJcs(existing.ref) !== restrictedJcs(entry.ref)) {
    corrupt("Operation recovery frame digest aliases another frame ref")
  }
  byDigest.set(entry.ref.frameDigest, entry)
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await operation(values[index]!, index)
    }
  })
  await Promise.all(workers)
  return results
}

function freezeHead(
  input: Omit<NodeAcceptedReplicaHead, "headDigest"> | NodeAcceptedReplicaHead,
  headDigest: Digest,
): NodeAcceptedReplicaHead {
  persistenceFullUpdateClones += 1
  persistenceFullUpdateBytesCloned += input.fullUpdate.byteLength
  return Object.freeze({
    scope: input.scope,
    headDigest,
    frontier: input.frontier,
    frontierDigest: input.frontierDigest,
    actorHeads: input.actorHeads,
    fullUpdate: Uint8Array.from(input.fullUpdate),
    stateVector: Uint8Array.from(input.stateVector) as StateVector,
    canonicalStateDigest: input.canonicalStateDigest,
    materializationDigest: input.materializationDigest,
  })
}

function freezeOwnedHead(
  input: Omit<NodeAcceptedReplicaHead, "headDigest"> | NodeAcceptedReplicaHead,
  headDigest: Digest,
): InternallyOwnedAcceptedHead {
  return Object.freeze({
    ...freezeHead(input, headDigest),
    [INTERNALLY_OWNED_HEAD]: true as const,
  })
}

function rebindOwnedHead(
  input: InternallyOwnedAcceptedHead,
  headDigest: Digest,
): InternallyOwnedAcceptedHead {
  return Object.freeze({
    scope: input.scope,
    headDigest,
    frontier: input.frontier,
    frontierDigest: input.frontierDigest,
    actorHeads: input.actorHeads,
    fullUpdate: input.fullUpdate,
    stateVector: input.stateVector,
    canonicalStateDigest: input.canonicalStateDigest,
    materializationDigest: input.materializationDigest,
    [INTERNALLY_OWNED_HEAD]: true as const,
  })
}

function freezeOwnedHeadIdentity(
  input: AcceptedHeadIdentityView | AcceptedHeadTransitionView,
  headDigest: Digest,
): InternallyOwnedAcceptedHeadIdentity {
  return Object.freeze({
    scope: input.scope,
    headDigest,
    frontier: input.frontier,
    frontierDigest: input.frontierDigest,
    actorHeads: input.actorHeads,
    stateVector: Uint8Array.from(input.stateVector) as StateVector,
    canonicalStateDigest: input.canonicalStateDigest,
    materializationDigest: input.materializationDigest,
    [INTERNALLY_OWNED_HEAD_IDENTITY]: true as const,
  })
}

function identityFromOwnedHead(input: InternallyOwnedAcceptedHead): InternallyOwnedAcceptedHeadIdentity {
  return Object.freeze({
    scope: input.scope,
    headDigest: input.headDigest,
    frontier: input.frontier,
    frontierDigest: input.frontierDigest,
    actorHeads: input.actorHeads,
    stateVector: input.stateVector,
    canonicalStateDigest: input.canonicalStateDigest,
    materializationDigest: input.materializationDigest,
    [INTERNALLY_OWNED_HEAD_IDENTITY]: true as const,
  })
}

function appendAcceptedHeadDeltaRef(
  previous: AcceptedHeadDeltaRefNode | null,
  ref: FrameObjectRef,
  identity: InternallyOwnedAcceptedHeadIdentity,
  durableDelta: AcceptedHeadDurableDeltaMetadata | undefined,
): AcceptedHeadDeltaRefNode {
  persistenceDeltaRefAppends += 1
  return Object.freeze({
    previous,
    ref: Object.freeze({ ...ref, scope: ref.scope }),
    identity,
    durableDelta,
  })
}

function createOwnedReachableFrameDigests(
  values: Iterable<Digest> = [],
): InternallyOwnedReachableFrameDigests {
  const result = new Set(values) as InternallyOwnedReachableFrameDigests
  Object.defineProperty(result, INTERNALLY_OWNED_REACHABLE_FRAME_DIGESTS, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return result
}

function validateAcceptedBase(input: Omit<NodeAcceptedReplicaHead, "headDigest"> | NodeAcceptedReplicaHead, scope: DocumentScope): void {
  validateAcceptedIdentity(input, scope)
  if (!(input.fullUpdate instanceof Uint8Array)) invalid("Accepted head full-update bytes are invalid")
}

function validateAcceptedIdentity(
  input: AcceptedHeadIdentityView | AcceptedHeadTransitionView,
  scope: DocumentScope,
): void {
  assertSameScope(input.scope, scope)
  if (!(input.stateVector instanceof Uint8Array)) invalid("Accepted head state vector is invalid")
  validateDigest(input.frontierDigest, "Frontier digest")
  validateDigest(input.canonicalStateDigest, "Canonical state digest")
  validateDigest(input.materializationDigest, "Accepted materialization digest")
  if (!isPlainObject(input.frontier) || input.frontier.format !== "convax.causal-frontier" || !Array.isArray(input.frontier.heads)) invalid("Accepted frontier is invalid")
  if (!isPlainObject(input.actorHeads) || input.actorHeads.format !== "convax.replica-actor-head-set" || !Array.isArray(input.actorHeads.heads)) invalid("Accepted actor-head set is invalid")
  assertSameScope(input.actorHeads.scope, scope)
}

function assertSameAcceptedState(
  left: Omit<NodeAcceptedReplicaHead, "headDigest"> | NodeAcceptedReplicaHead,
  right: Omit<NodeAcceptedReplicaHead, "headDigest"> | NodeAcceptedReplicaHead,
  materializer: NodeReplicaHeadMaterializer,
): void {
  if (
    left.frontierDigest !== right.frontierDigest ||
    left.canonicalStateDigest !== right.canonicalStateDigest ||
    left.materializationDigest !== right.materializationDigest ||
    materializer.actorHeadsDigest(left.actorHeads) !== materializer.actorHeadsDigest(right.actorHeads) ||
    !sameExactBytes(left.fullUpdate, right.fullUpdate) ||
    !sameExactBytes(left.stateVector, right.stateVector)
  ) invalid("Checkpoint materialization differs from the current accepted state")
}

function assertSameAcceptedIdentity(
  materialized: AcceptedHeadIdentityView,
  identity: AcceptedHeadIdentityView,
  materializer: NodeReplicaHeadMaterializer,
): void {
  if (
    materialized.headDigest !== identity.headDigest ||
    materialized.frontierDigest !== identity.frontierDigest ||
    materialized.canonicalStateDigest !== identity.canonicalStateDigest ||
    materialized.materializationDigest !== identity.materializationDigest ||
    materializer.actorHeadsDigest(materialized.actorHeads) !== materializer.actorHeadsDigest(identity.actorHeads) ||
    !sameExactBytes(materialized.stateVector, identity.stateVector)
  ) invalid("Cold accepted-head materialization differs from its exact metadata chain")
}

function sameAcceptedTransitionAndDelta(
  transition: AcceptedHeadTransitionView,
  delta: AcceptedHeadDurableDeltaMetadata,
  materializer: NodeReplicaHeadMaterializer,
): boolean {
  return restrictedJcs(transition.scope) === restrictedJcs(delta.scope) &&
    restrictedJcs(transition.frontier) === restrictedJcs(delta.resultingFrontier) &&
    transition.frontierDigest === delta.resultingFrontierDigest &&
    materializer.actorHeadsDigest(transition.actorHeads) === delta.resultingActorHeadsDigest &&
    restrictedJcs(transition.actorHeads) === restrictedJcs(delta.resultingActorHeads) &&
    sameExactBytes(transition.stateVector, delta.stateVector) &&
    transition.canonicalStateDigest === delta.canonicalStateDigest &&
    transition.materializationDigest === delta.resultingMaterializationDigest
}

function sameAcceptedHeadDurableDelta(
  left: AcceptedHeadDurableDeltaMetadata,
  right: AcceptedHeadDurableDeltaMetadata,
  materializer: NodeReplicaHeadMaterializer,
): boolean {
  return restrictedJcs(serializeAcceptedFrameWalDurableDelta(left)) ===
      restrictedJcs(serializeAcceptedFrameWalDurableDelta(right)) &&
    sameExactBytes(left.stateVector, right.stateVector) &&
    materializer.actorHeadsDigest(left.resultingActorHeads) ===
      materializer.actorHeadsDigest(right.resultingActorHeads)
}

function normalizePortableObjects(
  input: readonly NodeImmutableCheckpointObject[],
  minimum: number,
  maximum: number,
  label: string,
): readonly NodeImmutableCheckpointObject[] {
  if (!Array.isArray(input) || input.length < minimum || input.length > maximum) {
    invalid(`${label} object count is outside ${minimum}..${maximum}`)
  }
  const normalized = input.map((object) => {
    if (!isPlainObject(object)) invalid(`${label} object is invalid`)
    const objectDigest = parseDigest(object.objectDigest)
    if (!(object.exactBytes instanceof Uint8Array) || object.exactBytes.byteLength < 1 || object.exactBytes.byteLength > MAX_GENESIS_PROOF_BYTES) {
      invalid(`${label} object bytes are outside the native bound`)
    }
    return Object.freeze({ objectDigest, exactBytes: Uint8Array.from(object.exactBytes) })
  }).sort((left, right) => left.objectDigest.localeCompare(right.objectDigest))
  if (new Set(normalized.map((object) => object.objectDigest)).size !== normalized.length) {
    invalid(`${label} object digests are not unique`)
  }
  return Object.freeze(normalized)
}

function normalizePrunableObjects(input: readonly NodePrunableObject[]): readonly NodePrunableObject[] {
  if (!Array.isArray(input)) invalid("Prune candidate set is invalid")
  const normalized = input.map((object) => {
    if (!isPlainObject(object) || (object.kind !== "frame" && object.kind !== "checkpoint")) invalid("Prune candidate kind is invalid")
    const objectDigest = parseDigest(object.objectDigest)
    validateUint64(object.exactByteLength, "Prune candidate exact byte length")
    if (BigInt(object.exactByteLength) < 1n) invalid("Prune candidate cannot be empty")
    return Object.freeze({ kind: object.kind, objectDigest, exactByteLength: object.exactByteLength })
  }).sort((left, right) => left.objectDigest.localeCompare(right.objectDigest) || left.kind.localeCompare(right.kind))
  if (new Set(normalized.map((object) => `${object.kind}:${object.objectDigest}`)).size !== normalized.length) {
    invalid("Prune candidates are not unique")
  }
  return Object.freeze(normalized)
}

function normalizePruneRootScan(input: NodeCheckpointPruneRootScan): NodeCheckpointPruneRootScan {
  if (!isPlainObject(input) || typeof input.complete !== "boolean") invalid("Prune root scan result is invalid")
  const rootSetDigest = parseDigest(input.rootSetDigest)
  const retainedObjectDigests = parseSortedDigestArray(input.retainedObjectDigests, 0, 65_536, "Prune retained root set")
  return Object.freeze({ complete: input.complete, rootSetDigest, retainedObjectDigests })
}

async function readPrunePlan(
  layout: DocumentLayout,
  digest: Digest,
  expectedScope: DocumentScope,
): Promise<LocalPrunePlan> {
  const target = path.join(layout.prunePlans, `${deriveObjectNativeKey("prune-plan", digest)}.bin`)
  const bytes = await fs.readFile(target).catch((error) => {
    throw new NodeCollaborationPersistenceError(
      "store-corrupt",
      "Accepted-frame WAL prune record references a missing prune plan",
      { cause: error },
    )
  })
  const plan = parsePrunePlan(decodeRecord(bytes))
  assertSameScope(plan.scope, expectedScope)
  if (localRecordDigest(plan) !== digest) corrupt("Prune plan digest mismatches its pointer")
  return plan
}

function parsePrunePlan(value: unknown): LocalPrunePlan {
  requireFormat(value, "convax.local-prune-plan", [
    "candidateDeleteObjects", "candidateDurableHeadRecordDigest", "causalFloorObjectDigest",
    "expectedDurableHeadRecordDigest", "expectedPostBarrierRootSetDigest", "format",
    "installedCheckpointSetDigest", "newJournalBaseDigest", "prunableSetCertificateObjectDigest",
    "retainedRootSetDigest", "scope", "startJournalRecordDigest",
  ])
  const plan = value as unknown as LocalPrunePlan
  deriveDocumentNativeKey(plan.scope)
  for (const digest of [
    plan.expectedDurableHeadRecordDigest,
    plan.installedCheckpointSetDigest,
    plan.prunableSetCertificateObjectDigest,
    plan.causalFloorObjectDigest,
    plan.retainedRootSetDigest,
    plan.expectedPostBarrierRootSetDigest,
    plan.newJournalBaseDigest,
    plan.startJournalRecordDigest,
    plan.candidateDurableHeadRecordDigest,
  ]) parseDigest(digest)
  if (!Array.isArray(plan.candidateDeleteObjects) || plan.candidateDeleteObjects.length > 4_096) {
    corrupt("Prune plan candidate set exceeds its bound")
  }
  for (const candidate of plan.candidateDeleteObjects) {
    if (!isPlainObject(candidate) || !hasExactKeys(candidate, ["exactByteLength", "kind", "objectDigest"])) {
      corrupt("Prune plan candidate shape is invalid")
    }
  }
  let candidateDeleteObjects: readonly NodePrunableObject[]
  try {
    candidateDeleteObjects = normalizePrunableObjects(plan.candidateDeleteObjects)
  } catch (error) {
    throw new NodeCollaborationPersistenceError(
      "store-corrupt",
      "Prune plan candidate set is invalid",
      { cause: error },
    )
  }
  if (restrictedJcs(candidateDeleteObjects) !== restrictedJcs(plan.candidateDeleteObjects)) {
    corrupt("Prune plan candidate set is not canonically sorted")
  }
  const totalBytes = candidateDeleteObjects.reduce(
    (total, candidate) => total + BigInt(candidate.exactByteLength),
    0n,
  )
  if (totalBytes > 512n * 1024n * 1024n) corrupt("Prune plan candidate bytes exceed their bound")
  return Object.freeze({ ...plan, candidateDeleteObjects })
}

function activePrunePlan(
  scope: DocumentScope,
  prunePlanDigest: Digest,
  phase: LocalActivePrunePlan["phase"],
): LocalActivePrunePlan {
  return Object.freeze({ format: "convax.local-active-prune-plan", scope, prunePlanDigest, phase })
}

function parseSortedDigestArray(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): readonly Digest[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) corrupt(`${label} count is outside ${minimum}..${maximum}`)
  const parsed = value.map((digest) => parseDigest(digest))
  const sorted = [...parsed].sort()
  if (parsed.some((digest, index) => digest !== sorted[index]) || new Set(parsed).size !== parsed.length) {
    corrupt(`${label} is not sorted and unique`)
  }
  return Object.freeze(parsed)
}

async function writeJournalBase(
  directory: string,
  digest: Digest,
  record: LocalJournalBaseRecord,
  fullUpdate: Readonly<Uint8Array>,
  stateVector: Readonly<Uint8Array>,
): Promise<void> {
  const header = encodeRecord(record)
  const total = BASE_PREFIX_BYTES + header.byteLength + fullUpdate.byteLength + stateVector.byteLength
  const envelope = new Uint8Array(total)
  envelope.set(BASE_MAGIC, 0)
  const view = new DataView(envelope.buffer)
  view.setUint32(8, header.byteLength, false)
  view.setBigUint64(12, BigInt(fullUpdate.byteLength), false)
  view.setBigUint64(20, BigInt(stateVector.byteLength), false)
  envelope.set(Buffer.from(ordinaryDigest(header), "hex"), 28)
  envelope.set(header, BASE_PREFIX_BYTES)
  envelope.set(fullUpdate, BASE_PREFIX_BYTES + header.byteLength)
  envelope.set(stateVector, BASE_PREFIX_BYTES + header.byteLength + fullUpdate.byteLength)
  await putImmutableExact(directory, "journal-base", digest, envelope)
}

function encodePendingFrame(
  record: LocalPendingFrameRecord,
  exactFrameBytes: Readonly<Uint8Array>,
): Uint8Array {
  const header = encodeRecord(record)
  const envelope = new Uint8Array(PENDING_PREFIX_BYTES + header.byteLength + exactFrameBytes.byteLength)
  envelope.set(PENDING_MAGIC, 0)
  new DataView(envelope.buffer).setUint32(8, header.byteLength, false)
  envelope.set(Buffer.from(ordinaryDigest(header), "hex"), 12)
  envelope.set(header, PENDING_PREFIX_BYTES)
  envelope.set(exactFrameBytes, PENDING_PREFIX_BYTES + header.byteLength)
  return envelope
}

async function readPendingFrame(
  target: string,
  expectedScope?: DocumentScope,
): Promise<LoadedPendingFrame> {
  const envelope = Uint8Array.from(await fs.readFile(target).catch((error) => {
    throw new NodeCollaborationPersistenceError("store-corrupt", "Pending frame object is missing", { cause: error })
  }))
  if (envelope.byteLength < PENDING_PREFIX_BYTES || !Buffer.from(envelope.subarray(0, 8)).equals(PENDING_MAGIC)) {
    corrupt("Pending frame envelope magic is invalid")
  }
  const headerLength = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength).getUint32(8, false)
  if (headerLength < 1 || PENDING_PREFIX_BYTES + headerLength >= envelope.byteLength) corrupt("Pending frame envelope length is invalid")
  const header = envelope.subarray(PENDING_PREFIX_BYTES, PENDING_PREFIX_BYTES + headerLength)
  if (!Buffer.from(ordinaryDigest(header), "hex").equals(Buffer.from(envelope.subarray(12, 44)))) {
    corrupt("Pending frame header digest mismatches")
  }
  const record = parsePendingFrameRecord(decodeRecord(header))
  if (expectedScope) assertSameScope(record.ref.scope, expectedScope)
  const exactFrameBytes = Uint8Array.from(envelope.subarray(PENDING_PREFIX_BYTES + headerLength))
  if (exactFrameBytes.byteLength > MAX_FRAME_BYTES || String(exactFrameBytes.byteLength) !== record.frameByteLength) {
    corrupt("Pending frame exact byte length mismatches")
  }
  return Object.freeze({ record, exactFrameBytes })
}

async function readJournalBase(
  directory: string,
  digest: Digest,
  expectedScope: DocumentScope,
  protocol: "current" | "immediate-predecessor" = "current",
): Promise<LoadedJournalBase> {
  const target = path.join(directory, `${deriveObjectNativeKey("journal-base", digest)}.bin`)
  const envelope = Uint8Array.from(await fs.readFile(target).catch((error) => {
    throw new NodeCollaborationPersistenceError("store-corrupt", "Journal base is missing", { cause: error })
  }))
  const expectedMagic = protocol === "current" ? BASE_MAGIC : IMMEDIATE_PREDECESSOR_BASE_MAGIC
  if (envelope.byteLength < BASE_PREFIX_BYTES || !Buffer.from(envelope.subarray(0, 8)).equals(expectedMagic)) corrupt("Journal base envelope magic is invalid")
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength)
  const headerLength = view.getUint32(8, false)
  const fullUpdateLength = Number(view.getBigUint64(12, false))
  const stateVectorLength = Number(view.getBigUint64(20, false))
  if (BASE_PREFIX_BYTES + headerLength + fullUpdateLength + stateVectorLength !== envelope.byteLength) corrupt("Journal base envelope length is invalid")
  const headerBytes = envelope.subarray(BASE_PREFIX_BYTES, BASE_PREFIX_BYTES + headerLength)
  if (!Buffer.from(ordinaryDigest(headerBytes), "hex").equals(Buffer.from(envelope.subarray(28, 60)))) corrupt("Journal base header digest mismatches")
  const decodedRecord = protocol === "current"
    ? parseJournalBase(decodeRecord(headerBytes))
    : parseImmediatePredecessorJournalBase(decodeRecord(headerBytes))
  assertSameScope(decodedRecord.scope, expectedScope)
  if (localRecordDigest(decodedRecord) !== digest) corrupt("Journal base record digest mismatches its pointer")
  const record: LocalJournalBaseRecord = protocol === "current"
    ? decodedRecord as LocalJournalBaseRecord
    : Object.freeze({ ...decodedRecord, materializationDigest: digest })
  const fullUpdate = Uint8Array.from(envelope.subarray(BASE_PREFIX_BYTES + headerLength, BASE_PREFIX_BYTES + headerLength + fullUpdateLength))
  const stateVector = Uint8Array.from(envelope.subarray(BASE_PREFIX_BYTES + headerLength + fullUpdateLength)) as StateVector
  if (ordinaryDigest(fullUpdate) !== record.fullUpdateDigest || String(fullUpdate.byteLength) !== record.fullUpdateByteLength) corrupt("Journal base full update mismatches")
  if (ordinaryDigest(stateVector) !== record.stateVectorDigest || String(stateVector.byteLength) !== record.stateVectorByteLength) corrupt("Journal base state vector mismatches")
  return { digest, record, fullUpdate, stateVector }
}

async function readJournalRecord(target: string, expectedScope?: DocumentScope): Promise<LoadedJournal> {
  const record = parseJournal(decodeRecord(await fs.readFile(target).catch((error) => {
    throw new NodeCollaborationPersistenceError("store-corrupt", "Journal record is missing", { cause: error })
  })))
  if (expectedScope) assertSameScope(record.scope, expectedScope)
  return { record, digest: localRecordDigest(record) }
}

function parseDurableHead(value: unknown): LocalDurableHead {
  requireFormat(value, "convax.local-durable-head", [
    "acceptedActorHeadsDigest", "acceptedFrontierDigest", "format", "installedCheckpointSetDigest",
    "journalBaseDigest", "journalTailDigest", "localHeadGeneration", "priorHeadDigest", "scope",
  ])
  const record = value as unknown as LocalDurableHead
  validateUint64(record.localHeadGeneration, "Local head generation")
  for (const [label, digest] of [
    ["Journal base digest", record.journalBaseDigest], ["Journal tail digest", record.journalTailDigest],
    ["Installed checkpoint set digest", record.installedCheckpointSetDigest], ["Accepted frontier digest", record.acceptedFrontierDigest],
    ["Accepted actor heads digest", record.acceptedActorHeadsDigest],
  ] as const) validateDigest(digest, label)
  if (record.priorHeadDigest !== null) validateDigest(record.priorHeadDigest, "Prior head digest")
  deriveDocumentNativeKey(record.scope)
  return record
}

function parseInstalledCheckpointSet(value: unknown): LocalInstalledCheckpointSet {
  requireFormat(value, "convax.local-installed-checkpoint-set", [
    "bootstrapCheckpointObjectDigest", "checkpointObjectDigests", "contentCertificateObjectDigests",
    "format", "prunableSetCertificateObjectDigests", "scope",
  ])
  const record = value as unknown as LocalInstalledCheckpointSet
  deriveDocumentNativeKey(record.scope)
  const checkpointObjectDigests = parseSortedDigestArray(record.checkpointObjectDigests, 1, 8, "Installed checkpoint set")
  const contentCertificateObjectDigests = parseSortedDigestArray(record.contentCertificateObjectDigests, 0, 8, "Content certificate set")
  const prunableSetCertificateObjectDigests = parseSortedDigestArray(record.prunableSetCertificateObjectDigests, 0, 8, "Prunable certificate set")
  const bootstrapCheckpointObjectDigest = parseDigest(record.bootstrapCheckpointObjectDigest)
  if (!checkpointObjectDigests.includes(bootstrapCheckpointObjectDigest)) corrupt("Bootstrap checkpoint is absent from installed set")
  return Object.freeze({
    ...record,
    bootstrapCheckpointObjectDigest,
    checkpointObjectDigests,
    contentCertificateObjectDigests,
    prunableSetCertificateObjectDigests,
  })
}

function parseJournal(value: unknown): LocalJournalRecord {
  requireFormat(value, "convax.local-journal-record", [
    "format", "localRecordSequence", "objectDigests", "operationRef", "outboxRefDigest",
    "priorJournalRecordDigest", "resultingFrontierDigest", "scope", "transition",
  ])
  const record = value as unknown as LocalJournalRecord
  validateUint64(record.localRecordSequence, "Journal record sequence")
  if (BigInt(record.localRecordSequence) < 1n) corrupt("Journal record sequence zero is invalid")
  if (record.priorJournalRecordDigest !== null) validateDigest(record.priorJournalRecordDigest, "Prior journal record digest")
  if (!Array.isArray(record.objectDigests) || record.objectDigests.length !== 1) corrupt("Journal must name exactly one object")
  validateDigest(record.objectDigests[0], "Journal object digest")
  validateDigest(record.resultingFrontierDigest, "Journal frontier digest")
  if (isFrameJournal(record)) {
    validateDigest(record.outboxRefDigest, "Journal outbox digest")
    if (!isPlainObject(record.operationRef) || !hasExactKeys(record.operationRef, ["actorId", "operationId"])) corrupt("Journal operation ref is invalid")
  } else if (
    record.transition === "record-durable-ack" ||
    record.transition === "install-checkpoint-set" ||
    record.transition === "start-prunable-journal-base"
  ) {
    if (record.outboxRefDigest !== null || record.operationRef !== null) corrupt("Metadata journal carries frame-only references")
  } else corrupt("Journal transition is invalid")
  deriveDocumentNativeKey(record.scope)
  return record
}

function isFrameJournal(record: LocalJournalRecord): record is LocalJournalRecord & {
  readonly transition: "accept-local-frame" | "accept-remote-frame"
  readonly outboxRefDigest: Digest
  readonly operationRef: { readonly actorId: ActorId; readonly operationId: Id128 }
} {
  return record.transition === "accept-local-frame" || record.transition === "accept-remote-frame"
}

function normalizeReplicaDurableAckInput(input: NodeVerifiedReplicaDurableAck): NodeVerifiedReplicaDurableAck {
  deriveDocumentNativeKey(input.scope)
  const bytes = new Uint8Array(input.exactAckBytes)
  if (bytes.byteLength < 1 || bytes.byteLength > 64 * 1024) invalid("Replica durable ACK bytes exceed bounds")
  return Object.freeze({
    scope: input.scope,
    frameDigest: parseDigest(input.frameDigest),
    receiverMemberId: parseMemberId(input.receiverMemberId),
    receiverReplicaId: parseReplicaId(input.receiverReplicaId),
    receiverActorId: parseActorId(input.receiverActorId),
    receiverAuthorizationDigest: parseDigest(input.receiverAuthorizationDigest),
    ackCoreDigest: parseDigest(input.ackCoreDigest),
    exactAckBytes: bytes,
  })
}

function ackRecord(input: NodeVerifiedReplicaDurableAck): LocalReplicaDurableAckRecord {
  const exact = new Uint8Array(input.exactAckBytes)
  return Object.freeze({
    format: "convax.local-replica-durable-ack",
    scope: input.scope,
    frameDigest: input.frameDigest,
    receiverMemberId: input.receiverMemberId,
    receiverReplicaId: input.receiverReplicaId,
    receiverActorId: input.receiverActorId,
    receiverAuthorizationDigest: input.receiverAuthorizationDigest,
    ackCoreDigest: input.ackCoreDigest,
    exactAckSha256: ordinaryDigest(exact),
    exactAckByteLength: String(exact.byteLength),
    exactAckBase64: Buffer.from(exact).toString("base64url"),
  })
}

function parseAckRecord(value: unknown): LocalReplicaDurableAckRecord {
  requireFormat(value, "convax.local-replica-durable-ack", [
    "ackCoreDigest", "exactAckBase64", "exactAckByteLength", "exactAckSha256", "format",
    "frameDigest", "receiverActorId", "receiverAuthorizationDigest", "receiverMemberId",
    "receiverReplicaId", "scope",
  ])
  const record = value as unknown as LocalReplicaDurableAckRecord
  deriveDocumentNativeKey(record.scope)
  parseDigest(record.frameDigest)
  parseMemberId(record.receiverMemberId)
  parseReplicaId(record.receiverReplicaId)
  parseActorId(record.receiverActorId)
  parseDigest(record.receiverAuthorizationDigest)
  parseDigest(record.ackCoreDigest)
  parseDigest(record.exactAckSha256)
  validateUint64(record.exactAckByteLength, "ACK byte length")
  if (BigInt(record.exactAckByteLength) < 1n || BigInt(record.exactAckByteLength) > 64n * 1024n) corrupt("ACK byte length exceeds bounds")
  const exact = Buffer.from(record.exactAckBase64, "base64url")
  if (exact.toString("base64url") !== record.exactAckBase64 || String(exact.byteLength) !== record.exactAckByteLength || ordinaryDigest(exact) !== record.exactAckSha256) corrupt("ACK exact bytes mismatch their record")
  return record
}

function ackInput(record: LocalReplicaDurableAckRecord): NodeVerifiedReplicaDurableAck {
  return Object.freeze({
    scope: record.scope,
    frameDigest: record.frameDigest,
    receiverMemberId: record.receiverMemberId,
    receiverReplicaId: record.receiverReplicaId,
    receiverActorId: record.receiverActorId,
    receiverAuthorizationDigest: record.receiverAuthorizationDigest,
    ackCoreDigest: record.ackCoreDigest,
    exactAckBytes: Uint8Array.from(Buffer.from(record.exactAckBase64, "base64url")),
  })
}

function assertSameReplicaDurableAck(
  record: LocalReplicaDurableAckRecord,
  expected: NodeVerifiedReplicaDurableAck,
): void {
  const actual = ackInput(record)
  if (
    restrictedJcs(actual.scope) !== restrictedJcs(expected.scope) ||
    actual.frameDigest !== expected.frameDigest ||
    actual.receiverMemberId !== expected.receiverMemberId ||
    actual.receiverReplicaId !== expected.receiverReplicaId ||
    actual.receiverActorId !== expected.receiverActorId ||
    actual.receiverAuthorizationDigest !== expected.receiverAuthorizationDigest ||
    actual.ackCoreDigest !== expected.ackCoreDigest ||
    !Buffer.from(actual.exactAckBytes).equals(Buffer.from(expected.exactAckBytes))
  ) corrupt("Durable ACK retry does not match the accepted exact ACK")
}

function parseJournalBase(value: unknown): LocalJournalBaseRecord {
  requireFormat(value, "convax.local-journal-base", [
    "actorHeads", "actorHeadsDigest", "baseLocalRecordSequence", "canonicalStateDigest",
    "checkpointObjectDigest", "format", "frontier", "frontierDigest", "fullUpdateByteLength",
    "fullUpdateDigest", "installedCheckpointSetDigest", "materializationDigest", "scope", "stateVectorByteLength", "stateVectorDigest",
  ])
  const record = value as unknown as LocalJournalBaseRecord
  validateUint64(record.baseLocalRecordSequence, "Journal base sequence")
  validateDigest(record.checkpointObjectDigest, "Checkpoint object digest")
  validateDigest(record.installedCheckpointSetDigest, "Installed checkpoint set digest")
  validateDigest(record.frontierDigest, "Base frontier digest")
  validateDigest(record.actorHeadsDigest, "Base actor-head digest")
  validateDigest(record.canonicalStateDigest, "Base canonical-state digest")
  validateDigest(record.materializationDigest, "Base materialization digest")
  validateDigest(record.fullUpdateDigest, "Base full-update digest")
  validateDigest(record.stateVectorDigest, "Base state-vector digest")
  validateUint64(record.fullUpdateByteLength, "Base full-update length")
  validateUint64(record.stateVectorByteLength, "Base state-vector length")
  deriveDocumentNativeKey(record.scope)
  return record
}

function parseImmediatePredecessorJournalBase(value: unknown): ImmediatePredecessorLocalJournalBaseRecord {
  requireFormat(value, "convax.local-journal-base", [
    "actorHeads", "actorHeadsDigest", "baseLocalRecordSequence", "canonicalStateDigest",
    "checkpointObjectDigest", "format", "frontier", "frontierDigest", "fullUpdateByteLength",
    "fullUpdateDigest", "installedCheckpointSetDigest", "scope", "stateVectorByteLength", "stateVectorDigest",
  ])
  const record = value as unknown as ImmediatePredecessorLocalJournalBaseRecord
  validateUint64(record.baseLocalRecordSequence, "Predecessor journal base sequence")
  validateDigest(record.checkpointObjectDigest, "Predecessor checkpoint object digest")
  validateDigest(record.installedCheckpointSetDigest, "Predecessor installed checkpoint set digest")
  validateDigest(record.frontierDigest, "Predecessor base frontier digest")
  validateDigest(record.actorHeadsDigest, "Predecessor base actor-head digest")
  validateDigest(record.canonicalStateDigest, "Predecessor base canonical-state digest")
  validateDigest(record.fullUpdateDigest, "Predecessor base full-update digest")
  validateDigest(record.stateVectorDigest, "Predecessor base state-vector digest")
  validateUint64(record.fullUpdateByteLength, "Predecessor base full-update length")
  validateUint64(record.stateVectorByteLength, "Predecessor base state-vector length")
  deriveDocumentNativeKey(record.scope)
  return Object.freeze(record)
}

function requireImmediatePredecessorMaterializer(
  value: NodeReplicaHeadMaterializer,
): ImmediatePredecessorNodeReplicaHeadMaterializer {
  const candidate = value as Partial<ImmediatePredecessorNodeReplicaHeadMaterializer>
  if (
    typeof candidate.validateImmediatePredecessorBase !== "function" ||
    typeof candidate.verifyImmediatePredecessorCheckpoint !== "function"
  ) corrupt("Immediate-predecessor reader lacks its sealed portable verifier")
  return value as ImmediatePredecessorNodeReplicaHeadMaterializer
}

function parseOutbox(value: unknown): LocalReplicationOutboxRef {
  requireFormat(value, "convax.local-replication-outbox-ref", [
    "actorId", "actorSequence", "format", "frameDigest", "operationId", "requiredBlobDigests", "scope",
  ])
  const record = value as unknown as LocalReplicationOutboxRef
  validateDigest(record.frameDigest, "Outbox frame digest")
  normalizeDigestSet(record.requiredBlobDigests, 256)
  deriveDocumentNativeKey(record.scope)
  return record
}

function parseOperationRef(value: unknown): LocalOperationObjectRef {
  requireFormat(value, "convax.local-operation-object-ref", ["format", "ref"])
  const record = value as unknown as LocalOperationObjectRef
  validateFrameRef(record.ref)
  return record
}

function parsePendingFrameRecord(value: unknown): LocalPendingFrameRecord {
  requireFormat(value, "convax.local-pending-frame", ["format", "frameByteLength", "reason", "ref"])
  const record = value as unknown as LocalPendingFrameRecord
  validateFrameRef(record.ref)
  validateUint64(record.frameByteLength, "Pending frame byte length")
  const byteLength = BigInt(record.frameByteLength)
  if (byteLength < 1n || byteLength > BigInt(MAX_FRAME_BYTES)) corrupt("Pending frame byte length is outside the v2 cap")
  if (!isPendingReason(record.reason)) corrupt("Pending frame reason is invalid")
  return record
}

function parseQuarantine(value: unknown): LocalQuarantineCommit {
  requireFormat(value, "convax.local-quarantine-commit", [
    "format", "frameDigest", "journalRecordDigest", "observedReplicaHeadRecordDigest", "reason", "scope",
  ])
  const record = value as unknown as LocalQuarantineCommit
  validateDigest(record.frameDigest, "Quarantine frame digest")
  validateDigest(record.observedReplicaHeadRecordDigest, "Quarantine observed head digest")
  if (record.journalRecordDigest !== null) validateDigest(record.journalRecordDigest, "Quarantine journal digest")
  deriveDocumentNativeKey(record.scope)
  return record
}

function parseDispositionHead(value: unknown): LocalShardDispositionHead {
  requireFormat(value, "convax.local-shard-disposition-head", [
    "format", "quarantineCommitRecordDigest", "scope", "state",
  ])
  const record = value as unknown as LocalShardDispositionHead
  if (record.state !== "read-only-quarantine") corrupt("Shard disposition state is invalid")
  validateDigest(record.quarantineCommitRecordDigest, "Disposition quarantine digest")
  deriveDocumentNativeKey(record.scope)
  return record
}

function requireFormat(value: unknown, format: string, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!isPlainObject(value) || value.format !== format || !hasExactKeys(value, keys)) corrupt(`Invalid ${format} record`)
}

function localRecordDigest<T extends { readonly format: string }>(record: T): Digest {
  return createHash("sha256")
    .update(LOCAL_RECORD_DOMAIN)
    .update(Buffer.from(record.format, "utf8"))
    .update(Buffer.from("\0", "utf8"))
    .update(encodeRecord(record))
    .digest("hex") as Digest
}

function ordinaryDigest(bytes: Readonly<Uint8Array>): Digest {
  return createHash("sha256").update(bytes).digest("hex") as Digest
}

function sameExactBytes(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function operationIndexKey(actorId: ActorId, operationId: Id128): string {
  return createHash("sha256")
    .update(OPERATION_INDEX_DOMAIN)
    .update(Buffer.from(restrictedJcs({ actorId, operationId }), "utf8"))
    .digest("hex")
}

function encodeRecord(value: unknown): Uint8Array {
  return Buffer.from(restrictedJcs(value), "utf8")
}

function decodeRecord(bytes: Readonly<Uint8Array>): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    const value = JSON.parse(text) as unknown
    if (restrictedJcs(value) !== text) corrupt("Local record is not exact restricted JCS")
    return value
  } catch (error) {
    if (error instanceof NodeCollaborationPersistenceError) throw error
    throw new NodeCollaborationPersistenceError("store-corrupt", "Local record cannot be decoded", { cause: error })
  }
}

function restrictedJcs(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid("JCS number must be finite")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(restrictedJcs).join(",")}]`
  if (!isPlainObject(value)) invalid("JCS value must be plain data")
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${restrictedJcs(value[key])}`).join(",")}}`
}

async function putImmutableRecord(
  directory: string,
  kind: string,
  digest: Digest,
  record: unknown,
  measurement?: DurabilityMeasurementContext,
  diagnostics?: NodeLocalCommitDurabilityDiagnostics,
): Promise<void> {
  await putImmutableExact(directory, kind, digest, encodeRecord(record), measurement, diagnostics)
}

async function putImmutableExact(
  directory: string,
  kind: string,
  digest: Digest,
  exactBytes: Readonly<Uint8Array>,
  measurement?: DurabilityMeasurementContext,
  diagnostics?: NodeLocalCommitDurabilityDiagnostics,
): Promise<void> {
  await ensureTrustedDirectory(directory)
  const target = path.join(directory, `${deriveObjectNativeKey(kind, digest)}.bin`)
  await writeDurableNewOrVerify(target, exactBytes, measurement, diagnostics)
}

async function writeDurableNewOrVerify(
  target: string,
  exactBytes: Readonly<Uint8Array>,
  measurement?: DurabilityMeasurementContext,
  diagnostics?: NodeLocalCommitDurabilityDiagnostics,
): Promise<void> {
  try {
    await writeDurableNewFile(target, exactBytes, measurement, diagnostics)
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error
    const existing = await fs.readFile(target)
    if (!Buffer.from(existing).equals(Buffer.from(exactBytes))) corrupt("Immutable object digest aliases different bytes")
  }
}

async function writeDurableNewFile(
  target: string,
  exactBytes: Readonly<Uint8Array>,
  measurement?: DurabilityMeasurementContext,
  diagnostics?: NodeLocalCommitDurabilityDiagnostics,
): Promise<void> {
  await assertTrustedParent(target)
  const handle = await fs.open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await handle.writeFile(exactBytes)
    await measureSync(() => handle.sync(), "file-sync", measurement, diagnostics)
  } finally {
    await handle.close()
  }
  await syncDirectory(path.dirname(target), measurement, diagnostics)
}

async function replaceDurableRecord(
  target: string,
  record: unknown,
  hooks: NodeCollaborationPersistenceFaultHooks = {},
  measurement?: DurabilityMeasurementContext,
  diagnostics?: NodeLocalCommitDurabilityDiagnostics,
): Promise<void> {
  await assertTrustedParent(target)
  const directory = path.dirname(target)
  const temporary = path.join(directory, `.tmp-${randomUUID()}`)
  try {
    const handle = await fs.open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      await handle.writeFile(encodeRecord(record))
      await measureSync(() => handle.sync(), "file-sync", measurement, diagnostics)
    } finally {
      await handle.close()
    }
    await hooks.afterHeadTempFsync?.()
    const destination = await fs.lstat(target).catch(() => null)
    if (destination?.isSymbolicLink()) corrupt("Durable pointer destination is a symbolic link")
    await fs.rename(temporary, target)
    await hooks.afterHeadRename?.()
    await syncDirectory(directory, measurement, diagnostics)
    await hooks.afterHeadDirectoryFsync?.()
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function syncDirectory(
  directory: string,
  measurement?: DurabilityMeasurementContext,
  diagnostics?: NodeLocalCommitDurabilityDiagnostics,
): Promise<void> {
  await measureSync(() => fsyncProjectDirectory(directory), "directory-sync", measurement, diagnostics)
}

async function measureSync(
  sync: () => Promise<void>,
  barrierKind: NodeDurabilityBarrierKind,
  measurement?: DurabilityMeasurementContext,
  diagnostics?: NodeLocalCommitDurabilityDiagnostics,
): Promise<void> {
  if (measurement === undefined || diagnostics === undefined) {
    await sync()
    return
  }
  const startedAt = process.hrtime.bigint()
  let outcome: NodeLocalCommitDurabilityMeasurement["outcome"] = "succeeded"
  try {
    await sync()
  } catch (error) {
    outcome = "failed"
    throw error
  } finally {
    emitMeasurement(measurement, diagnostics, barrierKind, process.hrtime.bigint() - startedAt, outcome)
  }
}

function emitMeasurement(
  measurement: DurabilityMeasurementContext,
  diagnostics: NodeLocalCommitDurabilityDiagnostics,
  barrierKind: NodeDurabilityBarrierKind,
  durationNanoseconds: bigint,
  outcome: NodeLocalCommitDurabilityMeasurement["outcome"],
): void {
  try {
    diagnostics.observe(Object.freeze({ ...measurement, barrierKind, callCount: 1, durationNanoseconds, outcome }))
  } catch {
    // A diagnostic consumer cannot change persistence ordering or error propagation.
  }
}

async function ensureTrustedDirectory(directory: string, boundary = directory): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) corrupt("Private collaboration path is not a trusted directory")
  const realDirectory = await fs.realpath(directory)
  const realBoundary = await fs.realpath(boundary)
  if (realDirectory !== realBoundary && !realDirectory.startsWith(`${realBoundary}${path.sep}`)) corrupt("Private collaboration path escapes its root")
}

async function assertTrustedParent(target: string): Promise<void> {
  const parent = path.dirname(target)
  const stat = await fs.lstat(parent)
  if (!stat.isDirectory() || stat.isSymbolicLink()) corrupt("Native write parent is not a trusted directory")
}

async function assertMissing(target: string): Promise<void> {
  try {
    await fs.lstat(target)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return
    throw error
  }
  throw new NodeCollaborationPersistenceError("document-already-exists", "Collaboration shard already exists")
}

async function readDirectoryNames(directory: string): Promise<readonly string[]> {
  try {
    return (await fs.readdir(directory)).sort()
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return []
    throw error
  }
}

async function readDocumentDirectoryNames(documentsDirectory: string): Promise<readonly string[]> {
  try {
    const names: string[] = []
    for (const entry of await fs.readdir(documentsDirectory, { withFileTypes: true })) {
      if (entry.name === ".DS_Store" && entry.isFile()) continue
      if (!entry.isDirectory() || !/^[0-9a-f]{64}$/.test(entry.name)) {
        corrupt("Private collaboration document inventory contains an invalid entry")
      }
      names.push(entry.name)
    }
    return names.sort()
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return []
    throw error
  }
}

async function fileExists(target: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink()) corrupt("Private collaboration entry is a symbolic link")
    return stat.isFile()
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false
    throw error
  }
}


async function directoryExists(target: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink()) corrupt("Private collaboration entry is a symbolic link")
    if (!stat.isDirectory()) corrupt("Private collaboration document path is not a directory")
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false
    throw error
  }
}

function normalizeDigestSet(values: readonly Digest[], maximum: number): readonly Digest[] {
  if (!Array.isArray(values) || values.length > maximum) invalid("Digest set exceeds its bound")
  const result = [...values]
  for (const value of result) validateDigest(value, "Digest set value")
  result.sort((left, right) => left.localeCompare(right))
  for (let index = 1; index < result.length; index += 1) {
    if (result[index - 1] === result[index]) invalid("Digest set contains a duplicate")
  }
  return Object.freeze(result)
}

function assertJournalRef(record: LocalJournalRecord, ref: FrameObjectRef): void {
  if (!isFrameJournal(record) || record.operationRef === null) corrupt("Metadata journal cannot bind a frame")
  assertSameScope(record.scope, ref.scope)
  if (
    record.objectDigests.length !== 1 || record.objectDigests[0] !== ref.frameDigest ||
    record.operationRef.actorId !== ref.actorId || record.operationRef.operationId !== ref.operationId
  ) corrupt("Journal record does not bind the exact frame ref")
}

function assertOutboxRef(record: LocalReplicationOutboxRef, ref: FrameObjectRef): void {
  assertSameScope(record.scope, ref.scope)
  if (
    record.frameDigest !== ref.frameDigest || record.actorId !== ref.actorId ||
    record.actorSequence !== ref.actorSequence || record.operationId !== ref.operationId
  ) corrupt("Outbox record does not bind the exact frame ref")
}

function assertSameFrameRef(left: FrameObjectRef, right: FrameObjectRef): void {
  assertSameScope(left.scope, right.scope)
  if (
    left.frameDigest !== right.frameDigest || left.actorId !== right.actorId ||
    left.actorSequence !== right.actorSequence || left.operationId !== right.operationId
  ) corrupt("Frame bytes and persistence ref differ")
}

function validateFrameRef(ref: FrameObjectRef): void {
  if (!isPlainObject(ref) || !hasExactKeys(ref, ["actorId", "actorSequence", "frameDigest", "operationId", "scope"])) invalid("Frame ref has unsupported fields")
  deriveDocumentNativeKey(ref.scope)
  validateDigest(ref.frameDigest, "Frame digest")
  validateUint64(ref.actorSequence, "Actor sequence")
  if (BigInt(ref.actorSequence) < 1n) invalid("Actor sequence zero is forbidden")
  if (typeof ref.actorId !== "string" || typeof ref.operationId !== "string") invalid("Frame actor/operation identity is invalid")
}

function assertSameScope(left: DocumentScope, right: DocumentScope): void {
  if (restrictedJcs(left) !== restrictedJcs(right)) corrupt("Document scope mismatch")
}

function validateDigest(value: unknown, label: string): asserts value is Digest {
  if (typeof value !== "string" || !ORDINARY_SHA256.test(value)) invalid(`${label} must be lowercase SHA-256`)
}

function validateUint64(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value) || BigInt(value) > (1n << 64n) - 1n) invalid(`${label} is not canonical u64`)
}

function incrementUint64(value: string): string {
  validateUint64(value, "u64")
  const next = BigInt(value) + 1n
  if (next > (1n << 64n) - 1n) recoverRequired("Local recovery sequence is exhausted")
  return next.toString()
}

function isPendingReason(value: unknown): value is PendingFrameReason {
  return value === "missing-predecessor" || value === "missing-base" || value === "missing-proof" || value === "missing-artifact"
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0")
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function invalid(message: string): never {
  throw new NodeCollaborationPersistenceError("invalid-input", message)
}

function corrupt(message: string): never {
  throw new NodeCollaborationPersistenceError("store-corrupt", message)
}

function recoverRequired(message: string): never {
  throw new NodeCollaborationPersistenceError("read-only-recovery-required", message)
}

function classifyNativeFailure(error: unknown): NodeCollaborationPersistenceError {
  if (error instanceof NodeCollaborationPersistenceError) return error
  return new NodeCollaborationPersistenceError("durability-failed", "Native collaboration durability failed", { cause: error })
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
