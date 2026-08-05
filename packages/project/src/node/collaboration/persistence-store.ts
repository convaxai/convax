import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import type {
  ActorIdV2,
  CausalFrontierV2,
  CollaborationPersistencePortV2,
  CompareAndCommitReplicaHeadPortResultV2,
  DecodedCausalEditFrameV2,
  DecodedCausalEditFrameV3,
  DigestV2,
  DocumentScopeV2,
  FrameObjectRefV2,
  Id128V2,
  JournalAppendPortEvidenceV2,
  KernelQuarantineReasonV2,
  MemberIdV2,
  OperationLookupV2,
  PendingFrameReasonV2,
  PendingInboxPortV2,
  ReplicaActorHeadSetV2,
  ReplicaIdV2,
  StateVectorV2,
} from "@convax/collaboration"
import {
  frameObjectRefFromDecodedFrameV2,
  frameObjectRefFromDecodedFrameV3,
  parseActorIdV2,
  parseDigestV2,
  parseMemberIdV2,
  parseReplicaIdV2,
  parseUint64V2,
} from "@convax/collaboration"
import {
  deriveDocumentNativeKeyV2,
  deriveJournalSegmentNativeKeyV2,
  deriveObjectNativeKeyV2,
} from "./native-store-keys"
import { fsyncProjectDirectoryV2 } from "./directory-durability"

const LOCAL_RECORD_DOMAIN = Buffer.from("convax.local-project-store-record-digest/2\0", "utf8")
const OPERATION_INDEX_DOMAIN = Buffer.from("convax.local-operation-index-key/2\0", "utf8")
const ORDINARY_SHA256 = /^[0-9a-f]{64}$/u
const MAX_FRAME_BYTES = 2 * 1024 * 1024
const MAX_GENESIS_PROOF_BYTES = 335_544_320
const MAX_OUTBOX_FRAMES = 4_096
const MAX_OUTBOX_BYTES = 512 * 1024 * 1024
const BASE_MAGIC = Buffer.from("CVXBASE2", "ascii")
const BASE_PREFIX_BYTES = 60
const PENDING_MAGIC = Buffer.from("CVXPEND2", "ascii")
const PENDING_PREFIX_BYTES = 44
const MAX_PENDING_DOCUMENT_FRAMES = 4_096
const MAX_PENDING_DOCUMENT_BYTES = 256 * 1024 * 1024
const MAX_PENDING_ACTOR_FRAMES = 512
const MAX_PENDING_ACTOR_BYTES = 32 * 1024 * 1024

export interface NodeAcceptedReplicaHeadV2 {
  readonly scope: DocumentScopeV2
  readonly headDigest: DigestV2
  readonly frontier: CausalFrontierV2
  readonly frontierDigest: DigestV2
  readonly actorHeads: ReplicaActorHeadSetV2
  readonly fullUpdate: Uint8Array
  readonly stateVector: StateVectorV2
  readonly canonicalStateDigest: DigestV2
}

export interface NodeInspectedFrameV2 {
  readonly ref: FrameObjectRefV2
  readonly requiredBlobDigests: readonly DigestV2[]
}

export interface NodeDurableReplicationOutboxEntryV2 {
  readonly ref: FrameObjectRefV2
  readonly exactFrameBytes: Uint8Array
  readonly requiredBlobDigests: readonly DigestV2[]
}

export interface NodeAcceptedFrameObjectV2 {
  readonly ref: FrameObjectRefV2
  readonly exactFrameBytes: Uint8Array
}

export interface NodeVerifiedReplicaDurableAckV2 {
  readonly scope: DocumentScopeV2
  readonly frameDigest: DigestV2
  readonly receiverMemberId: MemberIdV2
  readonly receiverReplicaId: ReplicaIdV2
  readonly receiverActorId: ActorIdV2
  readonly receiverAuthorizationDigest: DigestV2
  readonly ackCoreDigest: DigestV2
  readonly exactAckBytes: Readonly<Uint8Array>
}

export interface NodeReplicaDurableAckVerifierV2 {
  /** Verifies the exact long-lived replica signature and current credential binding. */
  verifyCurrent(input: NodeVerifiedReplicaDurableAckV2): Promise<boolean>
}

/**
 * Portable frame parsing, causal frontier construction and owner projection remain
 * in @convax/collaboration. Project/node receives this explicit headless port and
 * owns only native durability/recovery.
 */
export interface NodeReplicaHeadMaterializerV2 {
  inspectFrame(ref: FrameObjectRefV2, exactBytes: Readonly<Uint8Array>): Promise<NodeInspectedFrameV2>
  applyAcceptedFrame(input: {
    readonly previous: NodeAcceptedReplicaHeadV2
    readonly ref: FrameObjectRefV2
    readonly exactBytes: Readonly<Uint8Array>
  }): Promise<NodeAcceptedReplicaHeadV2>
  /** Updates disposable causal lookup state only after the frame is reachable from the durable head. */
  observeAcceptedFrame?(ref: FrameObjectRefV2, exactBytes: Readonly<Uint8Array>): void
  /** Reconstructs the exact portable checkpoint payload without consulting native metadata order. */
  materializeCheckpoint?(input: {
    readonly scope: DocumentScopeV2
    readonly checkpointObjectDigest: DigestV2
    readonly exactCheckpointBytes: Readonly<Uint8Array>
  }): Promise<Omit<NodeAcceptedReplicaHeadV2, "headDigest">>
  actorHeadsDigest(actorHeads: ReplicaActorHeadSetV2): DigestV2
}

export interface NodeImmutableCheckpointObjectV2 {
  readonly objectDigest: DigestV2
  readonly exactBytes: Readonly<Uint8Array>
}

export interface NodeCheckpointInstallationVerifierV2 {
  /**
   * Verifies current content/prunable certificates, schema/artifact bindings,
   * parents and the complete local causal closure. Native persistence never
   * interprets portable certificate bytes on its own.
   */
  verifyCurrent(input: {
    readonly scope: DocumentScopeV2
    readonly currentAcceptedHead: NodeAcceptedReplicaHeadV2
    readonly bootstrapCheckpointObjectDigest: DigestV2
    readonly checkpointObjects: readonly NodeImmutableCheckpointObjectV2[]
    readonly contentCertificateObjects: readonly NodeImmutableCheckpointObjectV2[]
    readonly prunableSetCertificateObjects: readonly NodeImmutableCheckpointObjectV2[]
  }): Promise<boolean>
}

export interface InstallNativeCheckpointSetV2 {
  readonly scope: DocumentScopeV2
  readonly expectedReplicaHeadRecordDigest: DigestV2
  readonly bootstrapCheckpointObjectDigest: DigestV2
  readonly checkpointObjects: readonly NodeImmutableCheckpointObjectV2[]
  readonly contentCertificateObjects: readonly NodeImmutableCheckpointObjectV2[]
  readonly prunableSetCertificateObjects: readonly NodeImmutableCheckpointObjectV2[]
}

export type InstallNativeCheckpointSetResultV2 =
  | Readonly<{
      status: "committed"
      installedCheckpointSetDigest: DigestV2
      journalRecordDigest: DigestV2
      resultingReplicaHeadRecordDigest: DigestV2
    }>
  | Readonly<{ status: "rejected"; code: "head-stale" | "verification-failed" | "durability-failed" | "store-corrupt" }>

export type NodePrunableObjectKindV2 = "frame" | "checkpoint"

export interface NodePrunableObjectV2 {
  readonly kind: NodePrunableObjectKindV2
  readonly objectDigest: DigestV2
  readonly exactByteLength: string
}

export interface NodeCheckpointPruneRootScanV2 {
  readonly complete: boolean
  readonly rootSetDigest: DigestV2
  readonly retainedObjectDigests: readonly DigestV2[]
}

export interface NodeCheckpointPruneRootScannerV2 {
  scanComplete(input: {
    readonly scope: DocumentScopeV2
    readonly durableHeadRecordDigest: DigestV2
    readonly installedCheckpointSetDigest: DigestV2
  }): Promise<NodeCheckpointPruneRootScanV2>
}

export interface NodeCheckpointPruneAuthorityV2 {
  verifyCurrent(input: {
    readonly scope: DocumentScopeV2
    readonly durableHeadRecordDigest: DigestV2
    readonly installedCheckpointSetDigest: DigestV2
    readonly prunableSetCertificateObjectDigest: DigestV2
    readonly causalFloorObjectDigest: DigestV2
    readonly causalFloorExactBytes: Readonly<Uint8Array>
    readonly retainedRootSetDigest: DigestV2
    readonly candidateDeleteObjects: readonly NodePrunableObjectV2[]
  }): Promise<Readonly<{ verified: false }> | Readonly<{
    verified: true
    expectedPostBarrierRootSetDigest: DigestV2
  }>>
}

export interface PruneNativeCheckpointHistoryV2 {
  readonly scope: DocumentScopeV2
  readonly expectedReplicaHeadRecordDigest: DigestV2
  readonly prunableSetCertificateObjectDigest: DigestV2
  readonly causalFloorObjectDigest: DigestV2
  readonly causalFloorExactBytes: Readonly<Uint8Array>
  readonly candidateDeleteObjects: readonly NodePrunableObjectV2[]
}

export type PruneNativeCheckpointHistoryResultV2 = Readonly<{
  status: "deleted" | "postponed" | "rejected"
  code?: "head-stale" | "roots-changed" | "verification-failed" | "capacity-exceeded" | "durability-failed" | "store-corrupt"
  deletedObjectCount: number
  prunePlanDigest?: DigestV2
}>

export interface InitializeNativeCollaborationShardV2 {
  readonly scope: DocumentScopeV2
  readonly checkpointObjectDigest: DigestV2
  readonly checkpointExactBytes: Readonly<Uint8Array>
  readonly acceptedBase: Omit<NodeAcceptedReplicaHeadV2, "headDigest">
}

export interface InitializeNativeCollaborationShardWithGenesisProofV2
  extends InitializeNativeCollaborationShardV2 {
  /** Exact verified CVXCGP02 carrier, keyed locally by the checkpoint object digest G. */
  readonly proofCarrierExactBytes: Readonly<Uint8Array>
}

export interface NodeCollaborationPersistenceFaultHooksV2 {
  afterGenesisStagingFsync?(): Promise<void>
  afterFrameFileFsync?(): Promise<void>
  afterOutboxFileFsync?(): Promise<void>
  afterJournalFileFsync?(): Promise<void>
  afterHeadTempFsync?(): Promise<void>
  afterHeadRename?(): Promise<void>
  afterHeadDirectoryFsync?(): Promise<void>
}

export type NodeCollaborationPersistenceErrorCodeV2 =
  | "aborted"
  | "document-already-exists"
  | "document-not-found"
  | "durability-failed"
  | "invalid-input"
  | "outbox-backpressure"
  | "project-writer-already-open"
  | "read-only-recovery-required"
  | "store-corrupt"

export class NodeCollaborationPersistenceErrorV2 extends Error {
  constructor(
    readonly code: NodeCollaborationPersistenceErrorCodeV2,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "NodeCollaborationPersistenceErrorV2"
  }
}

interface LocalReplicationOutboxRefV2 {
  readonly format: "convax.local-replication-outbox-ref/2"
  readonly scope: DocumentScopeV2
  readonly frameDigest: DigestV2
  readonly actorId: ActorIdV2
  readonly actorSequence: string
  readonly operationId: Id128V2
  readonly requiredBlobDigests: readonly DigestV2[]
}

interface LocalJournalRecordV2 {
  readonly format: "convax.local-journal-record/2"
  readonly scope: DocumentScopeV2
  readonly localRecordSequence: string
  readonly priorJournalRecordDigest: DigestV2 | null
  readonly transition: "accept-local-frame" | "accept-remote-frame" | "install-checkpoint-set" | "record-durable-ack" | "start-prunable-journal-base"
  readonly objectDigests: readonly DigestV2[]
  readonly outboxRefDigest: DigestV2 | null
  readonly resultingFrontierDigest: DigestV2
  readonly operationRef: { readonly actorId: ActorIdV2; readonly operationId: Id128V2 } | null
}

interface LocalReplicaDurableAckRecordV2 {
  readonly format: "convax.local-replica-durable-ack/2"
  readonly scope: DocumentScopeV2
  readonly frameDigest: DigestV2
  readonly receiverMemberId: MemberIdV2
  readonly receiverReplicaId: ReplicaIdV2
  readonly receiverActorId: ActorIdV2
  readonly receiverAuthorizationDigest: DigestV2
  readonly ackCoreDigest: DigestV2
  readonly exactAckSha256: DigestV2
  readonly exactAckByteLength: string
  readonly exactAckBase64: string
}

interface LocalDurableHeadV2 {
  readonly format: "convax.local-durable-head/2"
  readonly scope: DocumentScopeV2
  readonly localHeadGeneration: string
  readonly priorHeadDigest: DigestV2 | null
  readonly journalBaseDigest: DigestV2
  readonly journalTailDigest: DigestV2
  readonly installedCheckpointSetDigest: DigestV2
  readonly acceptedFrontierDigest: DigestV2
  readonly acceptedActorHeadsDigest: DigestV2
}

interface LocalInstalledCheckpointSetV2 {
  readonly format: "convax.local-installed-checkpoint-set/2"
  readonly scope: DocumentScopeV2
  readonly checkpointObjectDigests: readonly DigestV2[]
  readonly bootstrapCheckpointObjectDigest: DigestV2
  readonly contentCertificateObjectDigests: readonly DigestV2[]
  readonly prunableSetCertificateObjectDigests: readonly DigestV2[]
}

interface LocalJournalBaseRecordV2 {
  readonly format: "convax.local-journal-base/2"
  readonly scope: DocumentScopeV2
  readonly baseLocalRecordSequence: string
  readonly checkpointObjectDigest: DigestV2
  readonly installedCheckpointSetDigest: DigestV2
  readonly frontier: CausalFrontierV2
  readonly frontierDigest: DigestV2
  readonly actorHeads: ReplicaActorHeadSetV2
  readonly actorHeadsDigest: DigestV2
  readonly canonicalStateDigest: DigestV2
  readonly fullUpdateDigest: DigestV2
  readonly fullUpdateByteLength: string
  readonly stateVectorDigest: DigestV2
  readonly stateVectorByteLength: string
}

interface LocalPrunePlanV2 {
  readonly format: "convax.local-prune-plan/2"
  readonly scope: DocumentScopeV2
  readonly expectedDurableHeadRecordDigest: DigestV2
  readonly installedCheckpointSetDigest: DigestV2
  readonly prunableSetCertificateObjectDigest: DigestV2
  readonly causalFloorObjectDigest: DigestV2
  readonly retainedRootSetDigest: DigestV2
  readonly expectedPostBarrierRootSetDigest: DigestV2
  readonly candidateDeleteObjects: readonly NodePrunableObjectV2[]
  readonly newJournalBaseDigest: DigestV2
  readonly startJournalRecordDigest: DigestV2
  readonly candidateDurableHeadRecordDigest: DigestV2
}

interface LocalActivePrunePlanV2 {
  readonly format: "convax.local-active-prune-plan/2"
  readonly scope: DocumentScopeV2
  readonly prunePlanDigest: DigestV2
  readonly phase: "prepared" | "head-published" | "deleted" | "abandoned"
}

interface LocalOperationObjectRefV2 {
  readonly format: "convax.local-operation-object-ref/2"
  readonly ref: FrameObjectRefV2
}

interface LocalPendingFrameRecordV2 {
  readonly format: "convax.local-pending-frame/2"
  readonly ref: FrameObjectRefV2
  readonly reason: PendingFrameReasonV2
  readonly frameByteLength: string
}

interface LocalQuarantineCommitV2 {
  readonly format: "convax.local-quarantine-commit/2"
  readonly scope: DocumentScopeV2
  readonly frameDigest: DigestV2
  readonly reason: KernelQuarantineReasonV2 | "stale-replica-head"
  readonly observedReplicaHeadRecordDigest: DigestV2
  readonly journalRecordDigest: DigestV2 | null
}

interface LocalShardDispositionHeadV2 {
  readonly format: "convax.local-shard-disposition-head/2"
  readonly scope: DocumentScopeV2
  readonly state: "read-only-quarantine"
  readonly quarantineCommitRecordDigest: DigestV2
}

interface DocumentLayoutV2 {
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

interface LoadedJournalBaseV2 {
  readonly digest: DigestV2
  readonly record: LocalJournalBaseRecordV2
  readonly fullUpdate: Uint8Array
  readonly stateVector: StateVectorV2
}

interface LoadedJournalV2 {
  readonly digest: DigestV2
  readonly record: LocalJournalRecordV2
}

interface LoadedPendingFrameV2 {
  readonly record: LocalPendingFrameRecordV2
  readonly exactFrameBytes: Uint8Array
}

const rootWriterLeases = new Set<string>()

/**
 * R5 native object/outbox/journal/head adapter. One instance is the sole Main
 * writer for one already-bound Project collaboration directory; it serves the
 * ProjectIndex shard and every per-Canvas shard through opaque document keys.
 */
export class NodeCollaborationPersistenceV2 implements CollaborationPersistencePortV2, PendingInboxPortV2 {
  private readonly queues = new Map<string, Promise<void>>()
  private disposed = false

  private constructor(
    private readonly collaborationDirectory: string,
    private readonly localActorId: ActorIdV2,
    private readonly materializer: NodeReplicaHeadMaterializerV2,
    private readonly replicaDurableAckVerifier: NodeReplicaDurableAckVerifierV2 | undefined,
    private readonly checkpointInstallationVerifier: NodeCheckpointInstallationVerifierV2 | undefined,
    private readonly checkpointPruneAuthority: NodeCheckpointPruneAuthorityV2 | undefined,
    private readonly checkpointPruneRootScanner: NodeCheckpointPruneRootScannerV2 | undefined,
    private readonly hooks: NodeCollaborationPersistenceFaultHooksV2,
    private readonly ownsRootWriterLease = true,
  ) {}

  static async open(input: {
    readonly collaborationDirectory: string
    readonly localActorId: ActorIdV2
    readonly materializer: NodeReplicaHeadMaterializerV2
    readonly replicaDurableAckVerifier?: NodeReplicaDurableAckVerifierV2
    readonly checkpointInstallationVerifier?: NodeCheckpointInstallationVerifierV2
    readonly checkpointPruneAuthority?: NodeCheckpointPruneAuthorityV2
    readonly checkpointPruneRootScanner?: NodeCheckpointPruneRootScannerV2
    readonly hooks?: NodeCollaborationPersistenceFaultHooksV2
  }): Promise<NodeCollaborationPersistenceV2> {
    if (!path.isAbsolute(input.collaborationDirectory)) invalid("Collaboration directory must be absolute")
    await ensureTrustedDirectory(input.collaborationDirectory)
    const real = await fs.realpath(input.collaborationDirectory)
    if (rootWriterLeases.has(real)) {
      throw new NodeCollaborationPersistenceErrorV2(
        "project-writer-already-open",
        "This process already owns the Project collaboration writer",
      )
    }
    rootWriterLeases.add(real)
    return new NodeCollaborationPersistenceV2(
      real,
      input.localActorId,
      input.materializer,
      input.replicaDurableAckVerifier,
      input.checkpointInstallationVerifier,
      input.checkpointPruneAuthority,
      input.checkpointPruneRootScanner,
      input.hooks ?? {},
      true,
    )
  }

  static async openReadOnly(input: Parameters<typeof NodeCollaborationPersistenceV2.open>[0]): Promise<NodeCollaborationPersistenceV2> {
    if (!path.isAbsolute(input.collaborationDirectory)) invalid("Collaboration directory must be absolute")
    await ensureTrustedDirectory(input.collaborationDirectory)
    const real = await fs.realpath(input.collaborationDirectory)
    return new NodeCollaborationPersistenceV2(
      real,
      input.localActorId,
      input.materializer,
      input.replicaDurableAckVerifier,
      input.checkpointInstallationVerifier,
      input.checkpointPruneAuthority,
      input.checkpointPruneRootScanner,
      input.hooks ?? {},
      false,
    )
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.ownsRootWriterLease) rootWriterLeases.delete(this.collaborationDirectory)
  }

  async initializeShard(input: InitializeNativeCollaborationShardV2): Promise<NodeAcceptedReplicaHeadV2> {
    return this.initializeShardInternal(input)
  }

  async initializeShardWithGenesisProof(
    input: InitializeNativeCollaborationShardWithGenesisProofV2,
  ): Promise<NodeAcceptedReplicaHeadV2> {
    if (
      !(input.proofCarrierExactBytes instanceof Uint8Array) ||
      input.proofCarrierExactBytes.byteLength < 1 ||
      input.proofCarrierExactBytes.byteLength > MAX_GENESIS_PROOF_BYTES
    ) {
      invalid("Canvas genesis proof carrier must be non-empty and within 335,544,320 bytes")
    }
    return this.initializeShardWithGenesisProofInternal(input, new Uint8Array(input.proofCarrierExactBytes))
  }

  async readGenesisProof(scope: DocumentScopeV2, checkpointObjectDigest: DigestV2): Promise<Uint8Array> {
    this.requireLive()
    validateDigest(checkpointObjectDigest, "Canvas genesis checkpoint digest")
    const layout = this.layout(scope)
    return this.serial(layout.directory, async () => {
      await this.assertReadableDocument(layout)
      const target = path.join(
        layout.genesisProofs,
        `${deriveObjectNativeKeyV2("genesis-proof", checkpointObjectDigest)}.bin`,
      )
      const bytes = await fs.readFile(target).catch((error) => {
        throw new NodeCollaborationPersistenceErrorV2(
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
    input: InitializeNativeCollaborationShardV2,
    proofCarrierExactBytes?: Readonly<Uint8Array>,
  ): Promise<NodeAcceptedReplicaHeadV2> {
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
        const checkpointSet: LocalInstalledCheckpointSetV2 = {
          format: "convax.local-installed-checkpoint-set/2",
          scope: input.scope,
          checkpointObjectDigests: [input.checkpointObjectDigest],
          bootstrapCheckpointObjectDigest: input.checkpointObjectDigest,
          contentCertificateObjectDigests: [],
          prunableSetCertificateObjectDigests: [],
        }
        const checkpointSetDigest = localRecordDigest(checkpointSet)
        await putImmutableRecord(layout.checkpointSets, "checkpoint-set", checkpointSetDigest, checkpointSet)
        const baseRecord: LocalJournalBaseRecordV2 = {
          format: "convax.local-journal-base/2",
          scope: input.scope,
          baseLocalRecordSequence: "0",
          checkpointObjectDigest: input.checkpointObjectDigest,
          installedCheckpointSetDigest: checkpointSetDigest,
          frontier: input.acceptedBase.frontier,
          frontierDigest: input.acceptedBase.frontierDigest,
          actorHeads: input.acceptedBase.actorHeads,
          actorHeadsDigest: this.materializer.actorHeadsDigest(input.acceptedBase.actorHeads),
          canonicalStateDigest: input.acceptedBase.canonicalStateDigest,
          fullUpdateDigest: ordinaryDigest(input.acceptedBase.fullUpdate),
          fullUpdateByteLength: String(input.acceptedBase.fullUpdate.byteLength),
          stateVectorDigest: ordinaryDigest(input.acceptedBase.stateVector),
          stateVectorByteLength: String(input.acceptedBase.stateVector.byteLength),
        }
        const baseDigest = localRecordDigest(baseRecord)
        await writeJournalBase(layout.journalBases, baseDigest, baseRecord, input.acceptedBase.fullUpdate, input.acceptedBase.stateVector)
        const head: LocalDurableHeadV2 = {
          format: "convax.local-durable-head/2",
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
        await fsyncProjectDirectoryV2(layout.directory)
        return freezeHead(input.acceptedBase, localRecordDigest(head))
      } catch (error) {
        throw classifyNativeFailure(error)
      }
    })
  }

  private async initializeShardWithGenesisProofInternal(
    input: InitializeNativeCollaborationShardWithGenesisProofV2,
    proofCarrierExactBytes: Readonly<Uint8Array>,
  ): Promise<NodeAcceptedReplicaHeadV2> {
    this.requireLive()
    validateDigest(input.checkpointObjectDigest, "Checkpoint object digest")
    validateAcceptedBase(input.acceptedBase, input.scope)
    const layout = this.layout(input.scope)
    return this.serial(layout.directory, async () => {
      if (await directoryExists(layout.directory)) {
        return this.verifyInstalledGenesis(layout, input, proofCarrierExactBytes)
      }
      const stagingDirectory = `${layout.directory}.genesis-${deriveObjectNativeKeyV2("genesis-proof", input.checkpointObjectDigest)}`
      const staging = this.layoutFromDirectory(stagingDirectory)
      const stagedStat = await fs.lstat(stagingDirectory).catch(() => null)
      if (stagedStat) {
        if (!stagedStat.isDirectory() || stagedStat.isSymbolicLink()) corrupt("Canvas genesis staging path is untrusted")
        await fs.rm(stagingDirectory, { recursive: true })
        await fsyncProjectDirectoryV2(path.dirname(stagingDirectory))
      }
      await this.createDocumentLayout(staging)
      try {
        const head = await this.populateInitialShard(staging, input, proofCarrierExactBytes)
        await this.hooks.afterGenesisStagingFsync?.()
        await fs.rename(stagingDirectory, layout.directory)
        await fsyncProjectDirectoryV2(path.dirname(layout.directory))
        return head
      } catch (error) {
        throw classifyNativeFailure(error)
      }
    })
  }

  private async populateInitialShard(
    layout: DocumentLayoutV2,
    input: InitializeNativeCollaborationShardV2,
    proofCarrierExactBytes: Readonly<Uint8Array>,
  ): Promise<NodeAcceptedReplicaHeadV2> {
    await putImmutableExact(layout.checkpoints, "checkpoint", input.checkpointObjectDigest, input.checkpointExactBytes)
    await putImmutableExact(layout.genesisProofs, "genesis-proof", input.checkpointObjectDigest, proofCarrierExactBytes)
    const checkpointSet: LocalInstalledCheckpointSetV2 = {
      format: "convax.local-installed-checkpoint-set/2",
      scope: input.scope,
      checkpointObjectDigests: [input.checkpointObjectDigest],
      bootstrapCheckpointObjectDigest: input.checkpointObjectDigest,
      contentCertificateObjectDigests: [],
      prunableSetCertificateObjectDigests: [],
    }
    const checkpointSetDigest = localRecordDigest(checkpointSet)
    await putImmutableRecord(layout.checkpointSets, "checkpoint-set", checkpointSetDigest, checkpointSet)
    const baseRecord: LocalJournalBaseRecordV2 = {
      format: "convax.local-journal-base/2",
      scope: input.scope,
      baseLocalRecordSequence: "0",
      checkpointObjectDigest: input.checkpointObjectDigest,
      installedCheckpointSetDigest: checkpointSetDigest,
      frontier: input.acceptedBase.frontier,
      frontierDigest: input.acceptedBase.frontierDigest,
      actorHeads: input.acceptedBase.actorHeads,
      actorHeadsDigest: this.materializer.actorHeadsDigest(input.acceptedBase.actorHeads),
      canonicalStateDigest: input.acceptedBase.canonicalStateDigest,
      fullUpdateDigest: ordinaryDigest(input.acceptedBase.fullUpdate),
      fullUpdateByteLength: String(input.acceptedBase.fullUpdate.byteLength),
      stateVectorDigest: ordinaryDigest(input.acceptedBase.stateVector),
      stateVectorByteLength: String(input.acceptedBase.stateVector.byteLength),
    }
    const baseDigest = localRecordDigest(baseRecord)
    await writeJournalBase(layout.journalBases, baseDigest, baseRecord, input.acceptedBase.fullUpdate, input.acceptedBase.stateVector)
    const head: LocalDurableHeadV2 = {
      format: "convax.local-durable-head/2",
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
    await fsyncProjectDirectoryV2(layout.directory)
    return freezeHead(input.acceptedBase, localRecordDigest(head))
  }

  private async verifyInstalledGenesis(
    layout: DocumentLayoutV2,
    input: InitializeNativeCollaborationShardWithGenesisProofV2,
    proofCarrierExactBytes: Readonly<Uint8Array>,
  ): Promise<NodeAcceptedReplicaHeadV2> {
    await this.assertReadableDocument(layout)
    const durable = await this.readDurableHead(layout, input.scope)
    if (durable.record.localHeadGeneration !== "0" || durable.record.priorHeadDigest !== null) {
      throw new NodeCollaborationPersistenceErrorV2("document-already-exists", "Canvas genesis retry found an edited shard")
    }
    const base = await readJournalBase(
      layout.journalBases,
      durable.record.journalBaseDigest,
      input.scope,
    )
    if (base.record.checkpointObjectDigest !== input.checkpointObjectDigest) {
      throw new NodeCollaborationPersistenceErrorV2("document-already-exists", "Canvas genesis retry names another checkpoint")
    }
    const checkpoint = await fs.readFile(path.join(
      layout.checkpoints,
      `${deriveObjectNativeKeyV2("checkpoint", input.checkpointObjectDigest)}.bin`,
    ))
    const carrier = await fs.readFile(path.join(
      layout.genesisProofs,
      `${deriveObjectNativeKeyV2("genesis-proof", input.checkpointObjectDigest)}.bin`,
    ))
    if (
      !sameExactBytes(checkpoint, input.checkpointExactBytes) ||
      !sameExactBytes(carrier, proofCarrierExactBytes) ||
      base.record.frontierDigest !== input.acceptedBase.frontierDigest ||
      base.record.canonicalStateDigest !== input.acceptedBase.canonicalStateDigest ||
      !sameExactBytes(base.fullUpdate, input.acceptedBase.fullUpdate) ||
      !sameExactBytes(base.stateVector, input.acceptedBase.stateVector) ||
      base.record.actorHeadsDigest !== this.materializer.actorHeadsDigest(input.acceptedBase.actorHeads)
    ) {
      throw new NodeCollaborationPersistenceErrorV2("store-corrupt", "Canvas genesis retry bytes do not match the durable shard")
    }
    return freezeHead(input.acceptedBase, durable.digest)
  }

  async loadReplicaHead(scope: DocumentScopeV2): Promise<unknown> {
    this.requireLive()
    const layout = this.layout(scope)
    return this.serial(layout.directory, async () => this.loadAcceptedHeadInternal(layout, scope, true))
  }

  /** Exact installed checkpoint base; no accepted suffix frame is applied. */
  async loadInstalledBase(scope: DocumentScopeV2): Promise<NodeAcceptedReplicaHeadV2> {
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
      }, base.digest)
    })
  }

  /**
   * Installs a verified portable checkpoint set through immutable-object,
   * journal and sole-head barriers. It never advances the journal base and
   * therefore grants no prune authority.
   */
  async installCheckpointSet(input: InstallNativeCheckpointSetV2): Promise<InstallNativeCheckpointSetResultV2> {
    this.requireLive()
    validateDigest(input.expectedReplicaHeadRecordDigest, "Expected replica head digest")
    const checkpointObjects = normalizePortableObjects(input.checkpointObjects, 1, 8, "checkpoint")
    const contentCertificates = normalizePortableObjects(input.contentCertificateObjects, 1, 8, "content certificate")
    const prunableCertificates = normalizePortableObjects(input.prunableSetCertificateObjects, 0, 8, "prunable-set certificate")
    const bootstrapDigest = parseDigestV2(input.bootstrapCheckpointObjectDigest)
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
        const installedSet: LocalInstalledCheckpointSetV2 = {
          format: "convax.local-installed-checkpoint-set/2",
          scope: input.scope,
          checkpointObjectDigests: checkpointObjects.map((entry) => entry.objectDigest),
          bootstrapCheckpointObjectDigest: bootstrapDigest,
          contentCertificateObjectDigests: contentCertificates.map((entry) => entry.objectDigest),
          prunableSetCertificateObjectDigests: prunableCertificates.map((entry) => entry.objectDigest),
        }
        const installedSetDigest = localRecordDigest(installedSet)
        await putImmutableRecord(layout.checkpointSets, "checkpoint-set", installedSetDigest, installedSet)

        const nextSequence = incrementUint64(current.record.localHeadGeneration)
        const journalRecord: LocalJournalRecordV2 = {
          format: "convax.local-journal-record/2",
          scope: input.scope,
          localRecordSequence: nextSequence,
          priorJournalRecordDigest: current.record.journalTailDigest,
          transition: "install-checkpoint-set",
          objectDigests: [installedSetDigest],
          outboxRefDigest: null,
          resultingFrontierDigest: current.record.acceptedFrontierDigest,
          operationRef: null,
        }
        const journalDigest = localRecordDigest(journalRecord)
        const journalPath = path.join(layout.journalSegments, deriveJournalSegmentNativeKeyV2(nextSequence))
        if (await fileExists(journalPath)) {
          const existing = await readJournalRecord(journalPath, input.scope)
          if (existing.digest !== journalDigest) corrupt("Checkpoint journal sequence is occupied by another transition")
        } else {
          await writeDurableNewFile(journalPath, encodeRecord(journalRecord))
          await fsyncProjectDirectoryV2(layout.journalSegments)
          await this.hooks.afterJournalFileFsync?.()
        }
        const head: LocalDurableHeadV2 = {
          ...current.record,
          localHeadGeneration: nextSequence,
          priorHeadDigest: current.digest,
          journalTailDigest: journalDigest,
          installedCheckpointSetDigest: installedSetDigest,
        }
        await replaceDurableRecord(layout.durableHead, head, this.hooks)
        const resultingHeadDigest = localRecordDigest(head)
        const exposed = await this.materializeInstalledCheckpointBase(layout, input.scope, installedSet)
        assertSameAcceptedState(exposed, currentAcceptedHead, this.materializer)
        return {
          status: "committed",
          installedCheckpointSetDigest: installedSetDigest,
          journalRecordDigest: journalDigest,
          resultingReplicaHeadRecordDigest: resultingHeadDigest,
        }
      } catch (error) {
        if (error instanceof NodeCollaborationPersistenceErrorV2 && error.code === "store-corrupt") {
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
  async pruneCheckpointHistory(input: PruneNativeCheckpointHistoryV2): Promise<PruneNativeCheckpointHistoryResultV2> {
    this.requireLive()
    validateDigest(input.expectedReplicaHeadRecordDigest, "Expected replica head digest")
    const certificateDigest = parseDigestV2(input.prunableSetCertificateObjectDigest)
    const floorDigest = parseDigestV2(input.causalFloorObjectDigest)
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
        const expectedPostBarrierRootSetDigest = parseDigestV2(proof.expectedPostBarrierRootSetDigest)
        const nextSequence = incrementUint64(current.record.localHeadGeneration)
        const baseRecord: LocalJournalBaseRecordV2 = {
          format: "convax.local-journal-base/2",
          scope: input.scope,
          baseLocalRecordSequence: nextSequence,
          checkpointObjectDigest: installed.bootstrapCheckpointObjectDigest,
          installedCheckpointSetDigest: current.record.installedCheckpointSetDigest,
          frontier: installedBase.frontier,
          frontierDigest: installedBase.frontierDigest,
          actorHeads: installedBase.actorHeads,
          actorHeadsDigest: this.materializer.actorHeadsDigest(installedBase.actorHeads),
          canonicalStateDigest: installedBase.canonicalStateDigest,
          fullUpdateDigest: ordinaryDigest(installedBase.fullUpdate),
          fullUpdateByteLength: String(installedBase.fullUpdate.byteLength),
          stateVectorDigest: ordinaryDigest(installedBase.stateVector),
          stateVectorByteLength: String(installedBase.stateVector.byteLength),
        }
        const baseDigest = localRecordDigest(baseRecord)
        const journalRecord: LocalJournalRecordV2 = {
          format: "convax.local-journal-record/2",
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
        const candidateHead: LocalDurableHeadV2 = {
          ...current.record,
          localHeadGeneration: nextSequence,
          priorHeadDigest: current.digest,
          journalBaseDigest: baseDigest,
          journalTailDigest: baseDigest,
        }
        const candidateHeadDigest = localRecordDigest(candidateHead)
        const plan: LocalPrunePlanV2 = {
          format: "convax.local-prune-plan/2",
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
        await putImmutableExact(layout.floors, "causal-floor", floorDigest, floorExactBytes)
        await writeJournalBase(layout.journalBases, baseDigest, baseRecord, installedBase.fullUpdate, installedBase.stateVector)
        await putImmutableRecord(layout.prunePlans, "prune-plan", planDigest, plan)
        const journalPath = path.join(layout.journalSegments, deriveJournalSegmentNativeKeyV2(nextSequence))
        await writeDurableNewOrVerify(journalPath, encodeRecord(journalRecord))
        await replaceDurableRecord(layout.activePrunePlan, activePrunePlan(input.scope, planDigest, "prepared"))
        await replaceDurableRecord(layout.durableHead, candidateHead, this.hooks)
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
        if (error instanceof NodeCollaborationPersistenceErrorV2 && error.code === "store-corrupt") {
          return { status: "rejected", code: "store-corrupt", deletedObjectCount: 0 }
        }
        return { status: "rejected", code: "durability-failed", deletedObjectCount: 0 }
      }
    })
  }

  /** Returns bytes only when the frame is in the sole durable accepted journal closure. */
  async readAcceptedFrame(scope: DocumentScopeV2, frameDigest: DigestV2): Promise<Uint8Array | null> {
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
      return Uint8Array.from(exact)
    })
  }

  /** Journal order is recovery metadata only; callers build causal closure from exact frame contexts. */
  async listAcceptedFrames(scope: DocumentScopeV2): Promise<readonly NodeAcceptedFrameObjectV2[]> {
    this.requireLive()
    const layout = this.layout(scope)
    return this.serial(layout.directory, async () => {
      await this.assertReadableDocument(layout)
      const head = await this.readDurableHead(layout, scope)
      const journals = await this.readReachableJournals(layout, scope, head.record)
      const result: NodeAcceptedFrameObjectV2[] = []
      for (const journal of journals) {
        if (!isFrameJournal(journal.record)) continue
        const ref = await this.refForJournal(layout, journal.record)
        const exactFrameBytes = await this.readFrame(layout, ref)
        const inspected = await this.materializer.inspectFrame(ref, exactFrameBytes)
        assertSameFrameRef(inspected.ref, ref)
        result.push(Object.freeze({ ref, exactFrameBytes: Uint8Array.from(exactFrameBytes) }))
      }
      return Object.freeze(result)
    })
  }

  async retainExactFrame(
    frame: DecodedCausalEditFrameV2 | DecodedCausalEditFrameV3,
    reason: PendingFrameReasonV2,
  ): Promise<"retained" | "capacity-exceeded"> {
    this.requireLive()
    if (!isPendingReason(reason)) invalid("Pending frame reason is invalid")
    const ref = frame.header.format === "convax.causal-edit-frame/3"
      ? frameObjectRefFromDecodedFrameV3(frame as DecodedCausalEditFrameV3)
      : frameObjectRefFromDecodedFrameV2(frame as DecodedCausalEditFrameV2)
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
      const record: LocalPendingFrameRecordV2 = {
        format: "convax.local-pending-frame/2",
        ref,
        reason,
        frameByteLength: String(frame.bytes.byteLength),
      }
      await writeDurableNewOrVerify(target, encodePendingFrame(record, frame.bytes))
      return "retained"
    })
  }

  async putImmutableFrame(ref: FrameObjectRefV2, exactBytes: Readonly<Uint8Array>): Promise<void> {
    this.requireLive()
    validateFrameRef(ref)
    if (!(exactBytes instanceof Uint8Array) || exactBytes.byteLength < 1 || exactBytes.byteLength > MAX_FRAME_BYTES) {
      invalid("Frame bytes must be a non-empty causal envelope within 2 MiB")
    }
    const layout = this.layout(ref.scope)
    await this.serial(layout.directory, async () => {
      await this.assertWritableDocument(layout)
      const inspected = await this.materializer.inspectFrame(ref, exactBytes)
      assertSameFrameRef(inspected.ref, ref)
      await putImmutableExact(layout.frames, "frame", ref.frameDigest, exactBytes)
      const operationDirectory = path.join(layout.operationRefs, operationIndexKey(ref.actorId, ref.operationId))
      await ensureTrustedDirectory(operationDirectory, this.collaborationDirectory)
      const operationRef: LocalOperationObjectRefV2 = { format: "convax.local-operation-object-ref/2", ref }
      await putImmutableRecord(operationDirectory, "operation-ref", ref.frameDigest, operationRef)
      // The operation sidecar is part of the immutable-object durability barrier:
      // recovery must be able to rediscover opaque frame paths by actor/operation.
      await this.hooks.afterFrameFileFsync?.()
    })
  }

  async putReplicationOutboxRef(ref: FrameObjectRefV2): Promise<void> {
    this.requireLive()
    validateFrameRef(ref)
    const layout = this.layout(ref.scope)
    await this.serial(layout.directory, async () => {
      await this.assertWritableDocument(layout)
      const frame = await this.readFrame(layout, ref)
      const inspected = await this.materializer.inspectFrame(ref, frame)
      assertSameFrameRef(inspected.ref, ref)
      const requiredBlobDigests = normalizeDigestSet(inspected.requiredBlobDigests, 256)
      const record: LocalReplicationOutboxRefV2 = {
        format: "convax.local-replication-outbox-ref/2",
        scope: ref.scope,
        frameDigest: ref.frameDigest,
        actorId: ref.actorId,
        actorSequence: ref.actorSequence,
        operationId: ref.operationId,
        requiredBlobDigests,
      }
      const target = path.join(layout.outboxFrames, `${deriveObjectNativeKeyV2("outbox-ref", ref.frameDigest)}.ref`)
      if (!(await fileExists(target))) await this.assertOutboxCapacity(layout, frame.byteLength)
      await writeDurableNewOrVerify(target, encodeRecord(record))
      await this.hooks.afterOutboxFileFsync?.()
    })
  }

  async appendFrameJournal(ref: FrameObjectRefV2): Promise<JournalAppendPortEvidenceV2> {
    this.requireLive()
    validateFrameRef(ref)
    const layout = this.layout(ref.scope)
    return this.serial(layout.directory, async () => {
      await this.assertWritableDocument(layout)
      const head = await this.readDurableHead(layout, ref.scope)
      const nextSequence = incrementUint64(head.record.localHeadGeneration)
      const target = path.join(layout.journalSegments, deriveJournalSegmentNativeKeyV2(nextSequence))
      if (await fileExists(target)) {
        const existing = await readJournalRecord(target, ref.scope)
        assertJournalRef(existing.record, ref)
        return Object.freeze({ ref, journalRecordDigest: existing.digest })
      }
      const frame = await this.readFrame(layout, ref)
      const outbox = await this.readOutbox(layout, ref)
      const previous = await this.reconstructHead(layout, ref.scope, head.record, head.digest)
      const next = await this.materializer.applyAcceptedFrame({ previous, ref, exactBytes: frame })
      validateAcceptedBase(next, ref.scope)
      const record: LocalJournalRecordV2 = {
        format: "convax.local-journal-record/2",
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
      await writeDurableNewFile(target, encodeRecord(record))
      await fsyncProjectDirectoryV2(layout.journalSegments)
      await this.hooks.afterJournalFileFsync?.()
      return Object.freeze({ ref, journalRecordDigest })
    })
  }

  async compareAndCommitReplicaHead(input: {
    readonly ref: FrameObjectRefV2
    readonly journal: JournalAppendPortEvidenceV2
    readonly expectedReplicaHeadRecordDigest: DigestV2
    readonly resultingFrontierDigest: DigestV2
  }): Promise<CompareAndCommitReplicaHeadPortResultV2> {
    this.requireLive()
    validateFrameRef(input.ref)
    assertSameFrameRef(input.journal.ref, input.ref)
    validateDigest(input.journal.journalRecordDigest, "Journal record digest")
    validateDigest(input.expectedReplicaHeadRecordDigest, "Expected replica head digest")
    validateDigest(input.resultingFrontierDigest, "Resulting frontier digest")
    const layout = this.layout(input.ref.scope)
    return this.serial(layout.directory, async () => {
      try {
        await this.assertWritableDocument(layout)
        const current = await this.readDurableHead(layout, input.ref.scope)
        if (current.digest !== input.expectedReplicaHeadRecordDigest) {
          if (
            current.record.priorHeadDigest === input.expectedReplicaHeadRecordDigest &&
            current.record.journalTailDigest === input.journal.journalRecordDigest &&
            current.record.acceptedFrontierDigest === input.resultingFrontierDigest
          ) {
            return committedEvidence(input, current.digest)
          }
          return await this.quarantineStaleHead(layout, input, current.digest)
        }
        const sequence = incrementUint64(current.record.localHeadGeneration)
        const journal = await readJournalRecord(
          path.join(layout.journalSegments, deriveJournalSegmentNativeKeyV2(sequence)),
          input.ref.scope,
        )
        if (journal.digest !== input.journal.journalRecordDigest) corrupt("Journal evidence does not name the next durable record")
        assertJournalRef(journal.record, input.ref)
        if (journal.record.priorJournalRecordDigest !== current.record.journalTailDigest) corrupt("Journal predecessor differs from the sole durable head")
        if (journal.record.resultingFrontierDigest !== input.resultingFrontierDigest) corrupt("Journal frontier differs from the Kernel result")
        await this.readFrame(layout, input.ref)
        await this.readOutbox(layout, input.ref)
        const previous = await this.reconstructHead(layout, input.ref.scope, current.record, current.digest)
        const frame = await this.readFrame(layout, input.ref)
        const next = await this.materializer.applyAcceptedFrame({ previous, ref: input.ref, exactBytes: frame })
        validateAcceptedBase(next, input.ref.scope)
        if (next.frontierDigest !== input.resultingFrontierDigest) corrupt("Materialized frontier differs from journal and Kernel")
        const head: LocalDurableHeadV2 = {
          format: "convax.local-durable-head/2",
          scope: input.ref.scope,
          localHeadGeneration: sequence,
          priorHeadDigest: current.digest,
          journalBaseDigest: current.record.journalBaseDigest,
          journalTailDigest: journal.digest,
          installedCheckpointSetDigest: current.record.installedCheckpointSetDigest,
          acceptedFrontierDigest: next.frontierDigest,
          acceptedActorHeadsDigest: this.materializer.actorHeadsDigest(next.actorHeads),
        }
        await replaceDurableRecord(layout.durableHead, head, this.hooks)
        this.materializer.observeAcceptedFrame?.(input.ref, frame)
        return committedEvidence(input, localRecordDigest(head))
      } catch (error) {
        if (error instanceof NodeCollaborationPersistenceErrorV2 && error.code === "store-corrupt") {
          return { status: "rejected", code: "store-corrupt" }
        }
        return { status: "rejected", code: "durability-failed" }
      }
    })
  }

  async isReachableFromAcceptedHead(ref: FrameObjectRefV2): Promise<boolean> {
    this.requireLive()
    const layout = this.layout(ref.scope)
    return this.serial(layout.directory, async () => {
      const head = await this.readDurableHead(layout, ref.scope)
      const records = await this.readReachableJournals(layout, ref.scope, head.record)
      return records.some((entry) => isFrameJournal(entry.record) && entry.record.objectDigests.includes(ref.frameDigest))
    })
  }

  async lookupOperation(actorId: ActorIdV2, operationId: Id128V2): Promise<OperationLookupV2> {
    this.requireLive()
    const matches: Array<{ ref: FrameObjectRefV2; bytes: Uint8Array; layout: DocumentLayoutV2 }> = []
    const documents = path.join(this.collaborationDirectory, "documents")
    for (const documentName of await readDirectoryNames(documents)) {
      const layout = this.layoutFromDirectory(path.join(documents, documentName))
      const operationDirectory = path.join(layout.operationRefs, operationIndexKey(actorId, operationId))
      for (const name of await readDirectoryNames(operationDirectory)) {
        if (!name.endsWith(".bin")) continue
        const parsed = decodeRecord(await fs.readFile(path.join(operationDirectory, name)))
        const operationRef = parseOperationRef(parsed)
        if (operationRef.ref.actorId !== actorId || operationRef.ref.operationId !== operationId) corrupt("Operation index key/value mismatch")
        matches.push({ ref: operationRef.ref, bytes: await this.readFrame(layout, operationRef.ref), layout })
      }
    }
    const unique = new Map(matches.map((entry) => [entry.ref.frameDigest, entry]))
    if (unique.size === 0) return { status: "absent" }
    if (unique.size > 1) return { status: "equivocation", frameDigests: [...unique.keys()].sort() }
    const entry = [...unique.values()][0]
    if (!entry) corrupt("Operation index lost its only frame")
    const reachable = await this.isReachableFromAcceptedHead(entry.ref)
    if (reachable) return { status: "accepted", ref: entry.ref, bytes: entry.bytes }
    const hasOutbox = await fileExists(this.outboxPath(entry.layout, entry.ref))
    const hasJournal = await this.findJournalForFrame(entry.layout, entry.ref.frameDigest)
    return {
      status: hasOutbox && hasJournal ? "same-frame-recovery" : "object-only-recovery",
      ref: entry.ref,
      bytes: entry.bytes,
    }
  }

  async scanDurableReferences(frameDigest: DigestV2): Promise<{ readonly complete: boolean; readonly reachable: boolean }> {
    this.requireLive()
    validateDigest(frameDigest, "Frame digest")
    const documents = path.join(this.collaborationDirectory, "documents")
    let reachable = false
    try {
      for (const documentName of await readDirectoryNames(documents)) {
        const layout = this.layoutFromDirectory(path.join(documents, documentName))
        for (const name of await readDirectoryNames(layout.journalSegments)) {
          const loaded = await readJournalRecord(path.join(layout.journalSegments, name))
          if (isFrameJournal(loaded.record) && loaded.record.objectDigests.includes(frameDigest)) reachable = true
        }
        for (const name of await readDirectoryNames(layout.outboxFrames)) {
          const record = parseOutbox(decodeRecord(await fs.readFile(path.join(layout.outboxFrames, name))))
          if (record.frameDigest === frameDigest) reachable = true
        }
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

  async quarantineExactObject(frameDigest: DigestV2, reason: KernelQuarantineReasonV2): Promise<void> {
    this.requireLive()
    validateDigest(frameDigest, "Frame digest")
    const documents = path.join(this.collaborationDirectory, "documents")
    let found = false
    for (const documentName of await readDirectoryNames(documents)) {
      const layout = this.layoutFromDirectory(path.join(documents, documentName))
      const framePath = path.join(layout.frames, `${deriveObjectNativeKeyV2("frame", frameDigest)}.bin`)
      if (!(await fileExists(framePath))) continue
      found = true
      await this.serial(layout.directory, async () => {
        const head = await this.readDurableHead(layout)
        await this.writeQuarantine(layout, head.record.scope, frameDigest, reason, head.digest, null)
      })
    }
    if (!found) corrupt("Cannot quarantine an unknown frame object")
  }

  async isFrameDurableForAck(ref: FrameObjectRefV2): Promise<boolean> {
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
  async listDurableReplicationOutbox(scope: DocumentScopeV2): Promise<readonly NodeDurableReplicationOutboxEntryV2[]> {
    this.requireLive()
    const layout = this.layout(scope)
    return this.serial(layout.directory, async () => {
      await this.assertReadableDocument(layout)
      if (await fileExists(layout.dispositionHead)) {
        recoverRequired("Cannot advertise frames from a quarantined collaboration shard")
      }
      const names = [...await readDirectoryNames(layout.outboxFrames)].sort()
      if (names.length > MAX_OUTBOX_FRAMES) corrupt("Local frame outbox exceeds 4,096 refs")
      const durable = await this.readDurableHead(layout, scope)
      const journals = await this.readReachableJournals(layout, scope, durable.record)
      const reachableFrameDigests = new Set(journals
        .filter((entry) => isFrameJournal(entry.record))
        .flatMap((entry) => entry.record.objectDigests))
      await this.reconstructHead(layout, scope, durable.record, durable.digest)
      const entries: NodeDurableReplicationOutboxEntryV2[] = []
      let totalBytes = 0
      for (const name of names) {
        const record = parseOutbox(decodeRecord(await fs.readFile(path.join(layout.outboxFrames, name))))
        assertSameScope(record.scope, scope)
        const ref: FrameObjectRefV2 = Object.freeze({
          scope: record.scope,
          frameDigest: record.frameDigest,
          actorId: record.actorId,
          actorSequence: parseUint64V2(record.actorSequence),
          operationId: record.operationId,
        })
        validateFrameRef(ref)
        if (path.basename(this.outboxPath(layout, ref)) !== name) corrupt("Outbox filename and frame digest differ")
        assertOutboxRef(record, ref)
        if (!reachableFrameDigests.has(ref.frameDigest)) {
          recoverRequired("Replication outbox references a frame outside the sole durable head")
        }
        const exactFrameBytes = await this.readFrame(layout, ref)
        totalBytes += exactFrameBytes.byteLength
        if (totalBytes > MAX_OUTBOX_BYTES) corrupt("Local frame outbox exceeds 512 MiB")
        entries.push(Object.freeze({
          ref,
          exactFrameBytes,
          requiredBlobDigests: Object.freeze([...record.requiredBlobDigests]),
        }))
      }
      return Object.freeze(entries)
    })
  }

  /**
   * Persists a protocol-verified long-lived replica ACK through the same
   * journal/head barrier as document metadata. The frame outbox is retired only
   * after the durable head references the ACK journal.
   */
  async recordVerifiedReplicaDurableAck(input: NodeVerifiedReplicaDurableAckV2): Promise<DigestV2> {
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
      await putImmutableRecord(layout.acks, "ack", normalized.ackCoreDigest, record)
      const accepted = journals.find((entry) => entry.record.transition === "record-durable-ack" && entry.record.objectDigests[0] === normalized.ackCoreDigest)
      if (accepted) {
        assertSameReplicaDurableAck(await this.readAckRecord(layout, normalized.ackCoreDigest), normalized)
        await this.retireFrameOutbox(layout, normalized.frameDigest)
        return accepted.digest
      }
      const nextSequence = incrementUint64(current.record.localHeadGeneration)
      const journalPath = path.join(layout.journalSegments, deriveJournalSegmentNativeKeyV2(nextSequence))
      const journalRecord: LocalJournalRecordV2 = {
        format: "convax.local-journal-record/2",
        scope: normalized.scope,
        localRecordSequence: nextSequence,
        priorJournalRecordDigest: current.record.journalTailDigest,
        transition: "record-durable-ack",
        objectDigests: [normalized.ackCoreDigest],
        outboxRefDigest: null,
        resultingFrontierDigest: current.record.acceptedFrontierDigest,
        operationRef: null,
      }
      const journalDigest = localRecordDigest(journalRecord)
      if (await fileExists(journalPath)) {
        const existing = await readJournalRecord(journalPath, normalized.scope)
        if (existing.digest !== journalDigest) corrupt("ACK journal sequence is occupied by another transition")
      } else {
        await writeDurableNewFile(journalPath, encodeRecord(journalRecord))
        await fsyncProjectDirectoryV2(layout.journalSegments)
        await this.hooks.afterJournalFileFsync?.()
      }
      const head: LocalDurableHeadV2 = {
        ...current.record,
        localHeadGeneration: nextSequence,
        priorHeadDigest: current.digest,
        journalTailDigest: journalDigest,
      }
      await replaceDurableRecord(layout.durableHead, head, this.hooks)
      current = { record: head, digest: localRecordDigest(head) }
      journals = await this.readReachableJournals(layout, normalized.scope, current.record)
      if (!journals.some((entry) => entry.digest === journalDigest)) corrupt("ACK journal is absent after head commit")
      await this.retireFrameOutbox(layout, normalized.frameDigest)
      return journalDigest
    })
  }

  async listDurableReplicaAcks(scope: DocumentScopeV2): Promise<readonly NodeVerifiedReplicaDurableAckV2[]> {
    this.requireLive()
    const verifier = this.replicaDurableAckVerifier
    if (!verifier) invalid("Replica durable ACK verifier is unavailable")
    const layout = this.layout(scope)
    return this.serial(layout.directory, async () => {
      await this.assertReadableDocument(layout)
      const head = await this.readDurableHead(layout, scope)
      const journals = await this.readReachableJournals(layout, scope, head.record)
      const result: NodeVerifiedReplicaDurableAckV2[] = []
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
    layout: DocumentLayoutV2,
    scope: DocumentScopeV2,
    reconcileJournalBelowHead: boolean,
  ): Promise<NodeAcceptedReplicaHeadV2> {
    await this.assertReadableDocument(layout)
    let durable = await this.readDurableHead(layout, scope)
    let result = await this.reconstructHead(layout, scope, durable.record, durable.digest)
    if (!reconcileJournalBelowHead) return this.applyDispositionHead(layout, scope, result)
    const nextSequence = incrementUint64(durable.record.localHeadGeneration)
    const nextPath = path.join(layout.journalSegments, deriveJournalSegmentNativeKeyV2(nextSequence))
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
    layout: DocumentLayoutV2,
    scope: DocumentScopeV2,
    accepted: NodeAcceptedReplicaHeadV2,
  ): Promise<NodeAcceptedReplicaHeadV2> {
    if (!(await fileExists(layout.dispositionHead))) return accepted
    const record = parseDispositionHead(decodeRecord(await fs.readFile(layout.dispositionHead)))
    assertSameScope(record.scope, scope)
    const quarantinePath = path.join(
      layout.quarantine,
      `${deriveObjectNativeKeyV2("quarantine", record.quarantineCommitRecordDigest)}.bin`,
    )
    const quarantine = parseQuarantine(decodeRecord(await fs.readFile(quarantinePath).catch((error) => {
      throw new NodeCollaborationPersistenceErrorV2("store-corrupt", "Disposition references a missing quarantine commit", { cause: error })
    })))
    if (localRecordDigest(quarantine) !== record.quarantineCommitRecordDigest) {
      corrupt("Disposition quarantine digest mismatches its immutable record")
    }
    assertSameScope(quarantine.scope, scope)
    return freezeHead(accepted, localRecordDigest(record))
  }

  private async commitRecoveredJournal(
    layout: DocumentLayoutV2,
    current: { readonly record: LocalDurableHeadV2; readonly digest: DigestV2 },
    journal: LoadedJournalV2,
    ref: FrameObjectRefV2,
  ): Promise<void> {
    assertJournalRef(journal.record, ref)
    await this.readOutbox(layout, ref)
    const frame = await this.readFrame(layout, ref)
    const previous = await this.reconstructHead(layout, ref.scope, current.record, current.digest)
    const next = await this.materializer.applyAcceptedFrame({ previous, ref, exactBytes: frame })
    validateAcceptedBase(next, ref.scope)
    if (next.frontierDigest !== journal.record.resultingFrontierDigest) {
      recoverRequired("Journal-below-head materialization differs from its durable frontier")
    }
    const head: LocalDurableHeadV2 = {
      format: "convax.local-durable-head/2",
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
    this.materializer.observeAcceptedFrame?.(ref, frame)
  }

  private async reconstructHead(
    layout: DocumentLayoutV2,
    scope: DocumentScopeV2,
    head: LocalDurableHeadV2,
    headDigest: DigestV2,
  ): Promise<NodeAcceptedReplicaHeadV2> {
    await this.readInstalledCheckpointSet(layout, head.installedCheckpointSetDigest, scope)
    const base = await readJournalBase(layout.journalBases, head.journalBaseDigest, scope)
    let current: NodeAcceptedReplicaHeadV2 = freezeHead(
      {
        scope,
        frontier: base.record.frontier,
        frontierDigest: base.record.frontierDigest,
        actorHeads: base.record.actorHeads,
        fullUpdate: base.fullUpdate,
        stateVector: base.stateVector,
        canonicalStateDigest: base.record.canonicalStateDigest,
      },
      base.digest,
    )
    const records = await this.readReachableJournals(layout, scope, head)
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
      current = freezeHead(await this.materializer.applyAcceptedFrame({ previous: current, ref, exactBytes: frame }), journal.digest)
      if (current.frontierDigest !== journal.record.resultingFrontierDigest) corrupt("Reopened frame produces a different frontier")
      this.materializer.observeAcceptedFrame?.(ref, frame)
    }
    if (current.frontierDigest !== head.acceptedFrontierDigest) corrupt("Reopened frontier differs from durable head")
    if (this.materializer.actorHeadsDigest(current.actorHeads) !== head.acceptedActorHeadsDigest) corrupt("Reopened actor heads differ from durable head")
    return freezeHead(current, headDigest)
  }

  private async readReachableJournals(
    layout: DocumentLayoutV2,
    scope: DocumentScopeV2,
    head: LocalDurableHeadV2,
  ): Promise<readonly LoadedJournalV2[]> {
    const base = await readJournalBase(layout.journalBases, head.journalBaseDigest, scope)
    const first = BigInt(base.record.baseLocalRecordSequence) + 1n
    const last = BigInt(head.localHeadGeneration)
    const records: LoadedJournalV2[] = []
    let prior: DigestV2 = base.digest
    for (let sequence = first; sequence <= last; sequence += 1n) {
      const loaded = await readJournalRecord(
        path.join(layout.journalSegments, deriveJournalSegmentNativeKeyV2(sequence.toString())),
        scope,
      )
      if (loaded.record.localRecordSequence !== sequence.toString()) corrupt("Journal filename and sequence differ")
      if (loaded.record.priorJournalRecordDigest !== prior) corrupt("Journal chain is gapped or forked")
      records.push(loaded)
      prior = loaded.digest
    }
    if (prior !== head.journalTailDigest) corrupt("Journal tail differs from durable head")
    return records
  }

  private async refForJournal(layout: DocumentLayoutV2, journal: LocalJournalRecordV2): Promise<FrameObjectRefV2> {
    if (!isFrameJournal(journal)) return corrupt("Metadata journal has no frame reference")
    const frameDigest = journal.objectDigests[0]
    if (!frameDigest) corrupt("Frame journal is empty")
    const operationDirectory = path.join(layout.operationRefs, operationIndexKey(journal.operationRef.actorId, journal.operationRef.operationId))
    for (const name of await readDirectoryNames(operationDirectory)) {
      const record = parseOperationRef(decodeRecord(await fs.readFile(path.join(operationDirectory, name))))
      if (record.ref.frameDigest === frameDigest) return record.ref
    }
    return corrupt("Journal operation reference is missing")
  }

  private async readFrame(layout: DocumentLayoutV2, ref: FrameObjectRefV2): Promise<Uint8Array> {
    const target = path.join(layout.frames, `${deriveObjectNativeKeyV2("frame", ref.frameDigest)}.bin`)
    const bytes = Uint8Array.from(await fs.readFile(target).catch((error) => {
      throw new NodeCollaborationPersistenceErrorV2("store-corrupt", "Referenced frame object is missing", { cause: error })
    }))
    const inspected = await this.materializer.inspectFrame(ref, bytes)
    assertSameFrameRef(inspected.ref, ref)
    return bytes
  }

  private async readOutbox(layout: DocumentLayoutV2, ref: FrameObjectRefV2): Promise<LocalReplicationOutboxRefV2> {
    const record = parseOutbox(decodeRecord(await fs.readFile(this.outboxPath(layout, ref)).catch((error) => {
      throw new NodeCollaborationPersistenceErrorV2("store-corrupt", "Referenced outbox record is missing", { cause: error })
    })))
    assertOutboxRef(record, ref)
    return record
  }

  private outboxPath(layout: DocumentLayoutV2, ref: FrameObjectRefV2): string {
    return path.join(layout.outboxFrames, `${deriveObjectNativeKeyV2("outbox-ref", ref.frameDigest)}.ref`)
  }

  private async commitRecoveredMetadataJournal(
    layout: DocumentLayoutV2,
    current: { readonly record: LocalDurableHeadV2; readonly digest: DigestV2 },
    journal: LoadedJournalV2,
  ): Promise<void> {
    if (journal.record.resultingFrontierDigest !== current.record.acceptedFrontierDigest) corrupt("Metadata journal changes the accepted frontier")
    let installedCheckpointSetDigest = current.record.installedCheckpointSetDigest
    let ack: LocalReplicaDurableAckRecordV2 | null = null
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
      }, accepted, this.materializer)
      const head: LocalDurableHeadV2 = {
        ...current.record,
        localHeadGeneration: journal.record.localRecordSequence,
        priorHeadDigest: current.digest,
        journalBaseDigest: baseDigest,
        journalTailDigest: baseDigest,
      }
      await replaceDurableRecord(layout.durableHead, head)
      return
    } else corrupt("Unsupported metadata journal transition")
    const head: LocalDurableHeadV2 = {
      ...current.record,
      localHeadGeneration: journal.record.localRecordSequence,
      priorHeadDigest: current.digest,
      journalTailDigest: journal.digest,
      installedCheckpointSetDigest,
    }
    await replaceDurableRecord(layout.durableHead, head)
    if (ack) await this.retireFrameOutbox(layout, ack.frameDigest)
  }

  private async readAckRecord(layout: DocumentLayoutV2, digest: DigestV2): Promise<LocalReplicaDurableAckRecordV2> {
    const target = path.join(layout.acks, `${deriveObjectNativeKeyV2("ack", digest)}.bin`)
    const record = parseAckRecord(decodeRecord(await fs.readFile(target).catch((error) => {
      throw new NodeCollaborationPersistenceErrorV2("store-corrupt", "ACK journal references a missing ACK object", { cause: error })
    })))
    if (record.ackCoreDigest !== digest) corrupt("ACK object key mismatches its core digest")
    return record
  }

  private async readInstalledCheckpointSet(
    layout: DocumentLayoutV2,
    digest: DigestV2,
    scope: DocumentScopeV2,
  ): Promise<LocalInstalledCheckpointSetV2> {
    const target = path.join(layout.checkpointSets, `${deriveObjectNativeKeyV2("checkpoint-set", digest)}.bin`)
    const record = parseInstalledCheckpointSet(decodeRecord(await fs.readFile(target).catch((error) => {
      throw new NodeCollaborationPersistenceErrorV2("store-corrupt", "Durable head references a missing checkpoint set", { cause: error })
    })))
    assertSameScope(record.scope, scope)
    if (localRecordDigest(record) !== digest) corrupt("Installed checkpoint-set digest mismatches its pointer")
    for (const checkpointDigest of record.checkpointObjectDigests) {
      const checkpointPath = path.join(layout.checkpoints, `${deriveObjectNativeKeyV2("checkpoint", checkpointDigest)}.bin`)
      const stat = await fs.lstat(checkpointPath).catch((error) => {
        throw new NodeCollaborationPersistenceErrorV2("store-corrupt", "Installed checkpoint payload is missing", { cause: error })
      })
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) corrupt("Installed checkpoint payload shape is invalid")
    }
    for (const certificateDigest of [
      ...record.contentCertificateObjectDigests,
      ...record.prunableSetCertificateObjectDigests,
    ]) {
      const certificatePath = path.join(layout.certificates, `${deriveObjectNativeKeyV2("certificate", certificateDigest)}.bin`)
      const stat = await fs.lstat(certificatePath).catch((error) => {
        throw new NodeCollaborationPersistenceErrorV2("store-corrupt", "Installed checkpoint certificate is missing", { cause: error })
      })
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) corrupt("Installed checkpoint certificate shape is invalid")
    }
    return record
  }

  private async materializeInstalledCheckpointBase(
    layout: DocumentLayoutV2,
    scope: DocumentScopeV2,
    installed: LocalInstalledCheckpointSetV2,
  ): Promise<NodeAcceptedReplicaHeadV2> {
    const materialize = this.materializer.materializeCheckpoint
    if (!materialize) recoverRequired("Installed checkpoint materializer is unavailable")
    const checkpointPath = path.join(
      layout.checkpoints,
      `${deriveObjectNativeKeyV2("checkpoint", installed.bootstrapCheckpointObjectDigest)}.bin`,
    )
    const exactCheckpointBytes = Uint8Array.from(await fs.readFile(checkpointPath).catch((error) => {
      throw new NodeCollaborationPersistenceErrorV2("store-corrupt", "Bootstrap checkpoint payload is missing", { cause: error })
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
    layout: DocumentLayoutV2,
    candidates: readonly NodePrunableObjectV2[],
  ): Promise<number> {
    let deleted = 0
    await ensureTrustedDirectory(layout.pruneTrash, this.collaborationDirectory)
    for (const candidate of candidates) {
      const directory = candidate.kind === "frame" ? layout.frames : layout.checkpoints
      const source = path.join(directory, `${deriveObjectNativeKeyV2(candidate.kind, candidate.objectDigest)}.bin`)
      const trash = path.join(layout.pruneTrash, `${deriveObjectNativeKeyV2(`prune-${candidate.kind}`, candidate.objectDigest)}.bin`)
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
        await fsyncProjectDirectoryV2(directory)
        await fsyncProjectDirectoryV2(layout.pruneTrash)
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
      await fsyncProjectDirectoryV2(layout.pruneTrash)
      deleted += 1
    }
    return deleted
  }

  private async retireFrameOutbox(layout: DocumentLayoutV2, frameDigest: DigestV2): Promise<void> {
    const target = path.join(layout.outboxFrames, `${deriveObjectNativeKeyV2("outbox-ref", frameDigest)}.ref`)
    await fs.unlink(target).catch((error) => {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error
    })
    await fsyncProjectDirectoryV2(layout.outboxFrames)
  }

  private async findJournalForFrame(layout: DocumentLayoutV2, frameDigest: DigestV2): Promise<boolean> {
    for (const name of await readDirectoryNames(layout.journalSegments)) {
      const record = await readJournalRecord(path.join(layout.journalSegments, name))
      if (record.record.objectDigests.includes(frameDigest)) return true
    }
    return false
  }

  private async quarantineStaleHead(
    layout: DocumentLayoutV2,
    input: Parameters<NodeCollaborationPersistenceV2["compareAndCommitReplicaHead"]>[0],
    observedHeadDigest: DigestV2,
  ): Promise<CompareAndCommitReplicaHeadPortResultV2> {
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
    layout: DocumentLayoutV2,
    scope: DocumentScopeV2,
    frameDigest: DigestV2,
    reason: LocalQuarantineCommitV2["reason"],
    observedHeadDigest: DigestV2,
    journalRecordDigest: DigestV2 | null,
  ): Promise<{ quarantineDigest: DigestV2; dispositionDigest: DigestV2 }> {
    const record: LocalQuarantineCommitV2 = {
      format: "convax.local-quarantine-commit/2",
      scope,
      frameDigest,
      reason,
      observedReplicaHeadRecordDigest: observedHeadDigest,
      journalRecordDigest,
    }
    const quarantineDigest = localRecordDigest(record)
    await putImmutableRecord(layout.quarantine, "quarantine", quarantineDigest, record)
    const disposition: LocalShardDispositionHeadV2 = {
      format: "convax.local-shard-disposition-head/2",
      scope,
      state: "read-only-quarantine",
      quarantineCommitRecordDigest: quarantineDigest,
    }
    await replaceDurableRecord(layout.dispositionHead, disposition)
    return { quarantineDigest, dispositionDigest: localRecordDigest(disposition) }
  }

  private async readDurableHead(layout: DocumentLayoutV2, scope?: DocumentScopeV2) {
    const value = decodeRecord(await fs.readFile(layout.durableHead).catch((error) => {
      throw new NodeCollaborationPersistenceErrorV2("document-not-found", "Durable replica head is missing", { cause: error })
    }))
    const record = parseDurableHead(value)
    if (scope) assertSameScope(record.scope, scope)
    return { record, digest: localRecordDigest(record) }
  }

  private async assertReadableDocument(layout: DocumentLayoutV2): Promise<void> {
    const stat = await fs.lstat(layout.directory).catch((error) => {
      throw new NodeCollaborationPersistenceErrorV2("document-not-found", "Collaboration shard does not exist", { cause: error })
    })
    if (!stat.isDirectory() || stat.isSymbolicLink()) corrupt("Collaboration shard is not a trusted directory")
  }

  private async assertWritableDocument(layout: DocumentLayoutV2): Promise<void> {
    await this.assertReadableDocument(layout)
    if (await fileExists(layout.dispositionHead)) recoverRequired("Collaboration shard is quarantined read-only")
  }

  private async assertOutboxCapacity(layout: DocumentLayoutV2, incomingBytes: number): Promise<void> {
    const refs = await readDirectoryNames(layout.outboxFrames)
    if (refs.length >= MAX_OUTBOX_FRAMES) {
      throw new NodeCollaborationPersistenceErrorV2("outbox-backpressure", "Local frame outbox reached 4,096 refs")
    }
    let total = incomingBytes
    for (const name of refs) {
      const record = parseOutbox(decodeRecord(await fs.readFile(path.join(layout.outboxFrames, name))))
      const framePath = path.join(layout.frames, `${deriveObjectNativeKeyV2("frame", record.frameDigest)}.bin`)
      total += (await fs.stat(framePath)).size
      if (total > MAX_OUTBOX_BYTES) {
        throw new NodeCollaborationPersistenceErrorV2("outbox-backpressure", "Local frame outbox reached 512 MiB")
      }
    }
  }

  private async pendingInboxCapacity(
    layout: DocumentLayoutV2,
    incomingActorId: ActorIdV2,
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

  private pendingFramePath(layout: DocumentLayoutV2, frameDigest: DigestV2): string {
    return path.join(layout.pendingInbox, `${deriveObjectNativeKeyV2("pending-frame", frameDigest)}.bin`)
  }

  private async createDocumentLayout(layout: DocumentLayoutV2): Promise<void> {
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
    await fsyncProjectDirectoryV2(layout.directory)
    await fsyncProjectDirectoryV2(path.dirname(layout.directory))
  }

  private layout(scope: DocumentScopeV2): DocumentLayoutV2 {
    return this.layoutFromDirectory(path.join(this.collaborationDirectory, "documents", deriveDocumentNativeKeyV2(scope)))
  }

  private layoutFromDirectory(directory: string): DocumentLayoutV2 {
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
  input: Parameters<NodeCollaborationPersistenceV2["compareAndCommitReplicaHead"]>[0],
  resultingReplicaHeadRecordDigest: DigestV2,
): CompareAndCommitReplicaHeadPortResultV2 {
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

function freezeHead(
  input: Omit<NodeAcceptedReplicaHeadV2, "headDigest"> | NodeAcceptedReplicaHeadV2,
  headDigest: DigestV2,
): NodeAcceptedReplicaHeadV2 {
  return Object.freeze({
    scope: input.scope,
    headDigest,
    frontier: input.frontier,
    frontierDigest: input.frontierDigest,
    actorHeads: input.actorHeads,
    fullUpdate: Uint8Array.from(input.fullUpdate),
    stateVector: Uint8Array.from(input.stateVector) as StateVectorV2,
    canonicalStateDigest: input.canonicalStateDigest,
  })
}

function validateAcceptedBase(input: Omit<NodeAcceptedReplicaHeadV2, "headDigest"> | NodeAcceptedReplicaHeadV2, scope: DocumentScopeV2): void {
  assertSameScope(input.scope, scope)
  if (!(input.fullUpdate instanceof Uint8Array) || !(input.stateVector instanceof Uint8Array)) invalid("Accepted head binary values are invalid")
  validateDigest(input.frontierDigest, "Frontier digest")
  validateDigest(input.canonicalStateDigest, "Canonical state digest")
  if (!isPlainObject(input.frontier) || input.frontier.format !== "convax.causal-frontier/2" || !Array.isArray(input.frontier.heads)) invalid("Accepted frontier is invalid")
  if (!isPlainObject(input.actorHeads) || input.actorHeads.format !== "convax.replica-actor-head-set/2" || !Array.isArray(input.actorHeads.heads)) invalid("Accepted actor-head set is invalid")
  assertSameScope(input.actorHeads.scope, scope)
}

function assertSameAcceptedState(
  left: Omit<NodeAcceptedReplicaHeadV2, "headDigest"> | NodeAcceptedReplicaHeadV2,
  right: Omit<NodeAcceptedReplicaHeadV2, "headDigest"> | NodeAcceptedReplicaHeadV2,
  materializer: NodeReplicaHeadMaterializerV2,
): void {
  if (
    left.frontierDigest !== right.frontierDigest ||
    left.canonicalStateDigest !== right.canonicalStateDigest ||
    materializer.actorHeadsDigest(left.actorHeads) !== materializer.actorHeadsDigest(right.actorHeads) ||
    !sameExactBytes(left.fullUpdate, right.fullUpdate) ||
    !sameExactBytes(left.stateVector, right.stateVector)
  ) invalid("Checkpoint materialization differs from the current accepted state")
}

function normalizePortableObjects(
  input: readonly NodeImmutableCheckpointObjectV2[],
  minimum: number,
  maximum: number,
  label: string,
): readonly NodeImmutableCheckpointObjectV2[] {
  if (!Array.isArray(input) || input.length < minimum || input.length > maximum) {
    invalid(`${label} object count is outside ${minimum}..${maximum}`)
  }
  const normalized = input.map((object) => {
    if (!isPlainObject(object)) invalid(`${label} object is invalid`)
    const objectDigest = parseDigestV2(object.objectDigest)
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

function normalizePrunableObjects(input: readonly NodePrunableObjectV2[]): readonly NodePrunableObjectV2[] {
  if (!Array.isArray(input)) invalid("Prune candidate set is invalid")
  const normalized = input.map((object) => {
    if (!isPlainObject(object) || (object.kind !== "frame" && object.kind !== "checkpoint")) invalid("Prune candidate kind is invalid")
    const objectDigest = parseDigestV2(object.objectDigest)
    validateUint64(object.exactByteLength, "Prune candidate exact byte length")
    if (BigInt(object.exactByteLength) < 1n) invalid("Prune candidate cannot be empty")
    return Object.freeze({ kind: object.kind, objectDigest, exactByteLength: object.exactByteLength })
  }).sort((left, right) => left.objectDigest.localeCompare(right.objectDigest) || left.kind.localeCompare(right.kind))
  if (new Set(normalized.map((object) => `${object.kind}:${object.objectDigest}`)).size !== normalized.length) {
    invalid("Prune candidates are not unique")
  }
  return Object.freeze(normalized)
}

function normalizePruneRootScan(input: NodeCheckpointPruneRootScanV2): NodeCheckpointPruneRootScanV2 {
  if (!isPlainObject(input) || typeof input.complete !== "boolean") invalid("Prune root scan result is invalid")
  const rootSetDigest = parseDigestV2(input.rootSetDigest)
  const retainedObjectDigests = parseSortedDigestArray(input.retainedObjectDigests, 0, 65_536, "Prune retained root set")
  return Object.freeze({ complete: input.complete, rootSetDigest, retainedObjectDigests })
}

function activePrunePlan(
  scope: DocumentScopeV2,
  prunePlanDigest: DigestV2,
  phase: LocalActivePrunePlanV2["phase"],
): LocalActivePrunePlanV2 {
  return Object.freeze({ format: "convax.local-active-prune-plan/2", scope, prunePlanDigest, phase })
}

function parseSortedDigestArray(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): readonly DigestV2[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) corrupt(`${label} count is outside ${minimum}..${maximum}`)
  const parsed = value.map((digest) => parseDigestV2(digest))
  const sorted = [...parsed].sort()
  if (parsed.some((digest, index) => digest !== sorted[index]) || new Set(parsed).size !== parsed.length) {
    corrupt(`${label} is not sorted and unique`)
  }
  return Object.freeze(parsed)
}

async function writeJournalBase(
  directory: string,
  digest: DigestV2,
  record: LocalJournalBaseRecordV2,
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
  record: LocalPendingFrameRecordV2,
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
  expectedScope?: DocumentScopeV2,
): Promise<LoadedPendingFrameV2> {
  const envelope = Uint8Array.from(await fs.readFile(target).catch((error) => {
    throw new NodeCollaborationPersistenceErrorV2("store-corrupt", "Pending frame object is missing", { cause: error })
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

async function readJournalBase(directory: string, digest: DigestV2, expectedScope: DocumentScopeV2): Promise<LoadedJournalBaseV2> {
  const target = path.join(directory, `${deriveObjectNativeKeyV2("journal-base", digest)}.bin`)
  const envelope = Uint8Array.from(await fs.readFile(target).catch((error) => {
    throw new NodeCollaborationPersistenceErrorV2("store-corrupt", "Journal base is missing", { cause: error })
  }))
  if (envelope.byteLength < BASE_PREFIX_BYTES || !Buffer.from(envelope.subarray(0, 8)).equals(BASE_MAGIC)) corrupt("Journal base envelope magic is invalid")
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength)
  const headerLength = view.getUint32(8, false)
  const fullUpdateLength = Number(view.getBigUint64(12, false))
  const stateVectorLength = Number(view.getBigUint64(20, false))
  if (BASE_PREFIX_BYTES + headerLength + fullUpdateLength + stateVectorLength !== envelope.byteLength) corrupt("Journal base envelope length is invalid")
  const headerBytes = envelope.subarray(BASE_PREFIX_BYTES, BASE_PREFIX_BYTES + headerLength)
  if (!Buffer.from(ordinaryDigest(headerBytes), "hex").equals(Buffer.from(envelope.subarray(28, 60)))) corrupt("Journal base header digest mismatches")
  const record = parseJournalBase(decodeRecord(headerBytes))
  assertSameScope(record.scope, expectedScope)
  if (localRecordDigest(record) !== digest) corrupt("Journal base record digest mismatches its pointer")
  const fullUpdate = Uint8Array.from(envelope.subarray(BASE_PREFIX_BYTES + headerLength, BASE_PREFIX_BYTES + headerLength + fullUpdateLength))
  const stateVector = Uint8Array.from(envelope.subarray(BASE_PREFIX_BYTES + headerLength + fullUpdateLength)) as StateVectorV2
  if (ordinaryDigest(fullUpdate) !== record.fullUpdateDigest || String(fullUpdate.byteLength) !== record.fullUpdateByteLength) corrupt("Journal base full update mismatches")
  if (ordinaryDigest(stateVector) !== record.stateVectorDigest || String(stateVector.byteLength) !== record.stateVectorByteLength) corrupt("Journal base state vector mismatches")
  return { digest, record, fullUpdate, stateVector }
}

async function readJournalRecord(target: string, expectedScope?: DocumentScopeV2): Promise<LoadedJournalV2> {
  const record = parseJournal(decodeRecord(await fs.readFile(target).catch((error) => {
    throw new NodeCollaborationPersistenceErrorV2("store-corrupt", "Journal record is missing", { cause: error })
  })))
  if (expectedScope) assertSameScope(record.scope, expectedScope)
  return { record, digest: localRecordDigest(record) }
}

function parseDurableHead(value: unknown): LocalDurableHeadV2 {
  requireFormat(value, "convax.local-durable-head/2", [
    "acceptedActorHeadsDigest", "acceptedFrontierDigest", "format", "installedCheckpointSetDigest",
    "journalBaseDigest", "journalTailDigest", "localHeadGeneration", "priorHeadDigest", "scope",
  ])
  const record = value as unknown as LocalDurableHeadV2
  validateUint64(record.localHeadGeneration, "Local head generation")
  for (const [label, digest] of [
    ["Journal base digest", record.journalBaseDigest], ["Journal tail digest", record.journalTailDigest],
    ["Installed checkpoint set digest", record.installedCheckpointSetDigest], ["Accepted frontier digest", record.acceptedFrontierDigest],
    ["Accepted actor heads digest", record.acceptedActorHeadsDigest],
  ] as const) validateDigest(digest, label)
  if (record.priorHeadDigest !== null) validateDigest(record.priorHeadDigest, "Prior head digest")
  deriveDocumentNativeKeyV2(record.scope)
  return record
}

function parseInstalledCheckpointSet(value: unknown): LocalInstalledCheckpointSetV2 {
  requireFormat(value, "convax.local-installed-checkpoint-set/2", [
    "bootstrapCheckpointObjectDigest", "checkpointObjectDigests", "contentCertificateObjectDigests",
    "format", "prunableSetCertificateObjectDigests", "scope",
  ])
  const record = value as unknown as LocalInstalledCheckpointSetV2
  deriveDocumentNativeKeyV2(record.scope)
  const checkpointObjectDigests = parseSortedDigestArray(record.checkpointObjectDigests, 1, 8, "Installed checkpoint set")
  const contentCertificateObjectDigests = parseSortedDigestArray(record.contentCertificateObjectDigests, 0, 8, "Content certificate set")
  const prunableSetCertificateObjectDigests = parseSortedDigestArray(record.prunableSetCertificateObjectDigests, 0, 8, "Prunable certificate set")
  const bootstrapCheckpointObjectDigest = parseDigestV2(record.bootstrapCheckpointObjectDigest)
  if (!checkpointObjectDigests.includes(bootstrapCheckpointObjectDigest)) corrupt("Bootstrap checkpoint is absent from installed set")
  return Object.freeze({
    ...record,
    bootstrapCheckpointObjectDigest,
    checkpointObjectDigests,
    contentCertificateObjectDigests,
    prunableSetCertificateObjectDigests,
  })
}

function parseJournal(value: unknown): LocalJournalRecordV2 {
  requireFormat(value, "convax.local-journal-record/2", [
    "format", "localRecordSequence", "objectDigests", "operationRef", "outboxRefDigest",
    "priorJournalRecordDigest", "resultingFrontierDigest", "scope", "transition",
  ])
  const record = value as unknown as LocalJournalRecordV2
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
  deriveDocumentNativeKeyV2(record.scope)
  return record
}

function isFrameJournal(record: LocalJournalRecordV2): record is LocalJournalRecordV2 & {
  readonly transition: "accept-local-frame" | "accept-remote-frame"
  readonly outboxRefDigest: DigestV2
  readonly operationRef: { readonly actorId: ActorIdV2; readonly operationId: Id128V2 }
} {
  return record.transition === "accept-local-frame" || record.transition === "accept-remote-frame"
}

function normalizeReplicaDurableAckInput(input: NodeVerifiedReplicaDurableAckV2): NodeVerifiedReplicaDurableAckV2 {
  deriveDocumentNativeKeyV2(input.scope)
  const bytes = new Uint8Array(input.exactAckBytes)
  if (bytes.byteLength < 1 || bytes.byteLength > 64 * 1024) invalid("Replica durable ACK bytes exceed bounds")
  return Object.freeze({
    scope: input.scope,
    frameDigest: parseDigestV2(input.frameDigest),
    receiverMemberId: parseMemberIdV2(input.receiverMemberId),
    receiverReplicaId: parseReplicaIdV2(input.receiverReplicaId),
    receiverActorId: parseActorIdV2(input.receiverActorId),
    receiverAuthorizationDigest: parseDigestV2(input.receiverAuthorizationDigest),
    ackCoreDigest: parseDigestV2(input.ackCoreDigest),
    exactAckBytes: bytes,
  })
}

function ackRecord(input: NodeVerifiedReplicaDurableAckV2): LocalReplicaDurableAckRecordV2 {
  const exact = new Uint8Array(input.exactAckBytes)
  return Object.freeze({
    format: "convax.local-replica-durable-ack/2",
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

function parseAckRecord(value: unknown): LocalReplicaDurableAckRecordV2 {
  requireFormat(value, "convax.local-replica-durable-ack/2", [
    "ackCoreDigest", "exactAckBase64", "exactAckByteLength", "exactAckSha256", "format",
    "frameDigest", "receiverActorId", "receiverAuthorizationDigest", "receiverMemberId",
    "receiverReplicaId", "scope",
  ])
  const record = value as unknown as LocalReplicaDurableAckRecordV2
  deriveDocumentNativeKeyV2(record.scope)
  parseDigestV2(record.frameDigest)
  parseMemberIdV2(record.receiverMemberId)
  parseReplicaIdV2(record.receiverReplicaId)
  parseActorIdV2(record.receiverActorId)
  parseDigestV2(record.receiverAuthorizationDigest)
  parseDigestV2(record.ackCoreDigest)
  parseDigestV2(record.exactAckSha256)
  validateUint64(record.exactAckByteLength, "ACK byte length")
  if (BigInt(record.exactAckByteLength) < 1n || BigInt(record.exactAckByteLength) > 64n * 1024n) corrupt("ACK byte length exceeds bounds")
  const exact = Buffer.from(record.exactAckBase64, "base64url")
  if (exact.toString("base64url") !== record.exactAckBase64 || String(exact.byteLength) !== record.exactAckByteLength || ordinaryDigest(exact) !== record.exactAckSha256) corrupt("ACK exact bytes mismatch their record")
  return record
}

function ackInput(record: LocalReplicaDurableAckRecordV2): NodeVerifiedReplicaDurableAckV2 {
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
  record: LocalReplicaDurableAckRecordV2,
  expected: NodeVerifiedReplicaDurableAckV2,
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

function parseJournalBase(value: unknown): LocalJournalBaseRecordV2 {
  requireFormat(value, "convax.local-journal-base/2", [
    "actorHeads", "actorHeadsDigest", "baseLocalRecordSequence", "canonicalStateDigest",
    "checkpointObjectDigest", "format", "frontier", "frontierDigest", "fullUpdateByteLength",
    "fullUpdateDigest", "installedCheckpointSetDigest", "scope", "stateVectorByteLength", "stateVectorDigest",
  ])
  const record = value as unknown as LocalJournalBaseRecordV2
  validateUint64(record.baseLocalRecordSequence, "Journal base sequence")
  validateDigest(record.checkpointObjectDigest, "Checkpoint object digest")
  validateDigest(record.installedCheckpointSetDigest, "Installed checkpoint set digest")
  validateDigest(record.frontierDigest, "Base frontier digest")
  validateDigest(record.actorHeadsDigest, "Base actor-head digest")
  validateDigest(record.canonicalStateDigest, "Base canonical-state digest")
  validateDigest(record.fullUpdateDigest, "Base full-update digest")
  validateDigest(record.stateVectorDigest, "Base state-vector digest")
  validateUint64(record.fullUpdateByteLength, "Base full-update length")
  validateUint64(record.stateVectorByteLength, "Base state-vector length")
  deriveDocumentNativeKeyV2(record.scope)
  return record
}

function parseOutbox(value: unknown): LocalReplicationOutboxRefV2 {
  requireFormat(value, "convax.local-replication-outbox-ref/2", [
    "actorId", "actorSequence", "format", "frameDigest", "operationId", "requiredBlobDigests", "scope",
  ])
  const record = value as unknown as LocalReplicationOutboxRefV2
  validateDigest(record.frameDigest, "Outbox frame digest")
  normalizeDigestSet(record.requiredBlobDigests, 256)
  deriveDocumentNativeKeyV2(record.scope)
  return record
}

function parseOperationRef(value: unknown): LocalOperationObjectRefV2 {
  requireFormat(value, "convax.local-operation-object-ref/2", ["format", "ref"])
  const record = value as unknown as LocalOperationObjectRefV2
  validateFrameRef(record.ref)
  return record
}

function parsePendingFrameRecord(value: unknown): LocalPendingFrameRecordV2 {
  requireFormat(value, "convax.local-pending-frame/2", ["format", "frameByteLength", "reason", "ref"])
  const record = value as unknown as LocalPendingFrameRecordV2
  validateFrameRef(record.ref)
  validateUint64(record.frameByteLength, "Pending frame byte length")
  const byteLength = BigInt(record.frameByteLength)
  if (byteLength < 1n || byteLength > BigInt(MAX_FRAME_BYTES)) corrupt("Pending frame byte length is outside the v2 cap")
  if (!isPendingReason(record.reason)) corrupt("Pending frame reason is invalid")
  return record
}

function parseQuarantine(value: unknown): LocalQuarantineCommitV2 {
  requireFormat(value, "convax.local-quarantine-commit/2", [
    "format", "frameDigest", "journalRecordDigest", "observedReplicaHeadRecordDigest", "reason", "scope",
  ])
  const record = value as unknown as LocalQuarantineCommitV2
  validateDigest(record.frameDigest, "Quarantine frame digest")
  validateDigest(record.observedReplicaHeadRecordDigest, "Quarantine observed head digest")
  if (record.journalRecordDigest !== null) validateDigest(record.journalRecordDigest, "Quarantine journal digest")
  deriveDocumentNativeKeyV2(record.scope)
  return record
}

function parseDispositionHead(value: unknown): LocalShardDispositionHeadV2 {
  requireFormat(value, "convax.local-shard-disposition-head/2", [
    "format", "quarantineCommitRecordDigest", "scope", "state",
  ])
  const record = value as unknown as LocalShardDispositionHeadV2
  if (record.state !== "read-only-quarantine") corrupt("Shard disposition state is invalid")
  validateDigest(record.quarantineCommitRecordDigest, "Disposition quarantine digest")
  deriveDocumentNativeKeyV2(record.scope)
  return record
}

function requireFormat(value: unknown, format: string, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!isPlainObject(value) || value.format !== format || !hasExactKeys(value, keys)) corrupt(`Invalid ${format} record`)
}

function localRecordDigest(record: { readonly format: string }): DigestV2 {
  return createHash("sha256")
    .update(LOCAL_RECORD_DOMAIN)
    .update(Buffer.from(record.format, "utf8"))
    .update(Buffer.from("\0", "utf8"))
    .update(encodeRecord(record))
    .digest("hex") as DigestV2
}

function ordinaryDigest(bytes: Readonly<Uint8Array>): DigestV2 {
  return createHash("sha256").update(bytes).digest("hex") as DigestV2
}

function sameExactBytes(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function operationIndexKey(actorId: ActorIdV2, operationId: Id128V2): string {
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
    if (error instanceof NodeCollaborationPersistenceErrorV2) throw error
    throw new NodeCollaborationPersistenceErrorV2("store-corrupt", "Local record cannot be decoded", { cause: error })
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

async function putImmutableRecord(directory: string, kind: string, digest: DigestV2, record: unknown): Promise<void> {
  await putImmutableExact(directory, kind, digest, encodeRecord(record))
}

async function putImmutableExact(
  directory: string,
  kind: string,
  digest: DigestV2,
  exactBytes: Readonly<Uint8Array>,
): Promise<void> {
  await ensureTrustedDirectory(directory)
  const target = path.join(directory, `${deriveObjectNativeKeyV2(kind, digest)}.bin`)
  await writeDurableNewOrVerify(target, exactBytes)
}

async function writeDurableNewOrVerify(target: string, exactBytes: Readonly<Uint8Array>): Promise<void> {
  try {
    await writeDurableNewFile(target, exactBytes)
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error
    const existing = await fs.readFile(target)
    if (!Buffer.from(existing).equals(Buffer.from(exactBytes))) corrupt("Immutable object digest aliases different bytes")
  }
}

async function writeDurableNewFile(target: string, exactBytes: Readonly<Uint8Array>): Promise<void> {
  await assertTrustedParent(target)
  const handle = await fs.open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await handle.writeFile(exactBytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fsyncProjectDirectoryV2(path.dirname(target))
}

async function replaceDurableRecord(
  target: string,
  record: unknown,
  hooks: NodeCollaborationPersistenceFaultHooksV2 = {},
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
      await handle.sync()
    } finally {
      await handle.close()
    }
    await hooks.afterHeadTempFsync?.()
    const destination = await fs.lstat(target).catch(() => null)
    if (destination?.isSymbolicLink()) corrupt("Durable pointer destination is a symbolic link")
    await fs.rename(temporary, target)
    await hooks.afterHeadRename?.()
    await fsyncProjectDirectoryV2(directory)
    await hooks.afterHeadDirectoryFsync?.()
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
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
  throw new NodeCollaborationPersistenceErrorV2("document-already-exists", "Collaboration shard already exists")
}

async function readDirectoryNames(directory: string): Promise<readonly string[]> {
  try {
    return (await fs.readdir(directory)).sort()
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

function normalizeDigestSet(values: readonly DigestV2[], maximum: number): readonly DigestV2[] {
  if (!Array.isArray(values) || values.length > maximum) invalid("Digest set exceeds its bound")
  const result = [...values]
  for (const value of result) validateDigest(value, "Digest set value")
  result.sort((left, right) => left.localeCompare(right))
  for (let index = 1; index < result.length; index += 1) {
    if (result[index - 1] === result[index]) invalid("Digest set contains a duplicate")
  }
  return Object.freeze(result)
}

function assertJournalRef(record: LocalJournalRecordV2, ref: FrameObjectRefV2): void {
  if (!isFrameJournal(record) || record.operationRef === null) corrupt("Metadata journal cannot bind a frame")
  assertSameScope(record.scope, ref.scope)
  if (
    record.objectDigests.length !== 1 || record.objectDigests[0] !== ref.frameDigest ||
    record.operationRef.actorId !== ref.actorId || record.operationRef.operationId !== ref.operationId
  ) corrupt("Journal record does not bind the exact frame ref")
}

function assertOutboxRef(record: LocalReplicationOutboxRefV2, ref: FrameObjectRefV2): void {
  assertSameScope(record.scope, ref.scope)
  if (
    record.frameDigest !== ref.frameDigest || record.actorId !== ref.actorId ||
    record.actorSequence !== ref.actorSequence || record.operationId !== ref.operationId
  ) corrupt("Outbox record does not bind the exact frame ref")
}

function assertSameFrameRef(left: FrameObjectRefV2, right: FrameObjectRefV2): void {
  assertSameScope(left.scope, right.scope)
  if (
    left.frameDigest !== right.frameDigest || left.actorId !== right.actorId ||
    left.actorSequence !== right.actorSequence || left.operationId !== right.operationId
  ) corrupt("Frame bytes and persistence ref differ")
}

function validateFrameRef(ref: FrameObjectRefV2): void {
  if (!isPlainObject(ref) || !hasExactKeys(ref, ["actorId", "actorSequence", "frameDigest", "operationId", "scope"])) invalid("Frame ref has unsupported fields")
  deriveDocumentNativeKeyV2(ref.scope)
  validateDigest(ref.frameDigest, "Frame digest")
  validateUint64(ref.actorSequence, "Actor sequence")
  if (BigInt(ref.actorSequence) < 1n) invalid("Actor sequence zero is forbidden")
  if (typeof ref.actorId !== "string" || typeof ref.operationId !== "string") invalid("Frame actor/operation identity is invalid")
}

function assertSameScope(left: DocumentScopeV2, right: DocumentScopeV2): void {
  if (restrictedJcs(left) !== restrictedJcs(right)) corrupt("Document scope mismatch")
}

function validateDigest(value: unknown, label: string): asserts value is DigestV2 {
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

function isPendingReason(value: unknown): value is PendingFrameReasonV2 {
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
  throw new NodeCollaborationPersistenceErrorV2("invalid-input", message)
}

function corrupt(message: string): never {
  throw new NodeCollaborationPersistenceErrorV2("store-corrupt", message)
}

function recoverRequired(message: string): never {
  throw new NodeCollaborationPersistenceErrorV2("read-only-recovery-required", message)
}

function classifyNativeFailure(error: unknown): NodeCollaborationPersistenceErrorV2 {
  if (error instanceof NodeCollaborationPersistenceErrorV2) return error
  return new NodeCollaborationPersistenceErrorV2("durability-failed", "Native collaboration durability failed", { cause: error })
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
