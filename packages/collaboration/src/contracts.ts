import type * as Y from "yjs"
import type { CanonicalJcsEvidence, CanonicalJcsEvidenceIssuer } from "./canonical-jcs-evidence"
import type {
  OwnerStateCommitment,
  OwnerStateCommitmentDescriptor,
  OwnerStateCommitmentIssuer,
} from "./owner-state-commitment"
import type {
  ActorId,
  CanvasId,
  Digest,
  Id128,
  MemberId,
  ProjectId,
  ReplicaId,
  Signature,
  StateVector,
  Uint32,
  Uint64,
} from "./codecs"

export interface ProtocolSchemaArtifact {
  readonly artifactDigest: Digest
  readonly format:
    | "convax.canvas-protocol-schema"
    | "convax.collaboration-kernel-protocol-schema"
    | "convax.control-plane-protocol-schema"
    | "convax.project-persistence-protocol-schema"
  readonly name: "canvas-schema" | "collaboration-kernel" | "control-plane" | "project-persistence"
}

export type ProtocolSchemaArtifactManifest = readonly [
  ProtocolSchemaArtifact & { readonly name: "canvas-schema"; readonly format: "convax.canvas-protocol-schema" },
  ProtocolSchemaArtifact & { readonly name: "collaboration-kernel"; readonly format: "convax.collaboration-kernel-protocol-schema" },
  ProtocolSchemaArtifact & { readonly name: "control-plane"; readonly format: "convax.control-plane-protocol-schema" },
  ProtocolSchemaArtifact & { readonly name: "project-persistence"; readonly format: "convax.project-persistence-protocol-schema" },
]

export interface ProtocolTypeNamespace {
  readonly imports: readonly ("canvas-schema" | "collaboration-kernel" | "control-plane" | "global-uri" | "project-persistence")[]
  readonly namespace: "canvas-schema" | "collaboration-kernel" | "control-plane" | "global-uri" | "project-persistence"
}

export type ProtocolTypeNamespaceManifest = readonly [
  { readonly namespace: "canvas-schema"; readonly imports: readonly ["collaboration-kernel", "control-plane", "global-uri"] },
  { readonly namespace: "collaboration-kernel"; readonly imports: readonly ["global-uri"] },
  { readonly namespace: "control-plane"; readonly imports: readonly ["collaboration-kernel", "global-uri", "project-persistence"] },
  { readonly namespace: "global-uri"; readonly imports: readonly [] },
  { readonly namespace: "project-persistence"; readonly imports: readonly ["canvas-schema", "collaboration-kernel", "control-plane", "global-uri"] },
]

export interface YjsWireCodec {
  readonly applyCodec: "Y.applyUpdate"
  readonly format: "convax.yjs-wire-codec"
  readonly package: "yjs"
  readonly packageIntegrity: "sha512-Eq+5BRfbeGyqGVrTJL3bEcr8gKkxPuyuoHmAwpk52fDb8kOVMrfVSTRPd6yiGgX5Fskb96qCRjzjbRjrL4YEnw=="
  readonly stateVectorCodec: "Y.encodeStateVector"
  readonly updateCodec: "Y.Doc.update-event"
  readonly updateVersion: "v1"
  readonly version: "13.6.31"
}

export interface ProtocolSchemaBundleCore {
  readonly artifacts: ProtocolSchemaArtifactManifest
  readonly channelContractDigest: Digest
  readonly domainRegistry: readonly string[]
  readonly format: "convax.protocol-schema-bundle-core"
  readonly limitsDigest: Digest
  readonly protocolMajor: "current"
  readonly typeNamespaces: ProtocolTypeNamespaceManifest
  readonly uriProtocolDigest: Digest
  readonly yjsWireCodec: YjsWireCodec
}

export interface ProtocolSchemaBundle {
  readonly core: ProtocolSchemaBundleCore
  readonly coreDigest: Digest
  readonly format: "convax.protocol-schema-bundle"
  readonly protocolDigest: Digest
}

export interface DocumentScope {
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly docKind: "project-index" | "canvas"
  readonly docId: "project-index" | CanvasId
  readonly shardEpoch: Id128
}

export type DocumentScopeDigest = Digest

export interface PortableStamp {
  readonly format: "convax.portable-stamp"
  readonly lamport: Uint64
  readonly actorId: ActorId
  readonly operationId: Id128
  readonly writeOrdinal: Uint32
}

export interface CausalHeadRef {
  readonly format: "convax.causal-head-ref"
  readonly actorId: ActorId
  readonly actorSequence: Uint64
  readonly frameDigest: Digest
  readonly lamport: Uint64
}

export interface CausalFrontier {
  readonly format: "convax.causal-frontier"
  readonly heads: readonly CausalHeadRef[]
}

export interface ReplicaActorHeadSet {
  readonly format: "convax.replica-actor-head-set"
  readonly scope: DocumentScope
  readonly heads: readonly CausalHeadRef[]
}

export type CausalDependencyKind =
  | "local-owner-binding"
  | "local-owner-edit-authorization"
  | "membership-snapshot"
  | "replica-actor-credential"
  | "replica-edit-authorization"
  | "authorization-mutation"
  | "cutoff-coverage-root"
  | "checkpoint-content-certificate"
  | "project-index-proof"
  | "project-resource-proof"
  | "plugin-validation-artifact"
  | "generation-external-fact"
  | "reset-authorization"

export interface CausalDependencyRef {
  readonly kind: CausalDependencyKind
  readonly digest: Digest
}

export interface LocalProjectOwnerSignerAuthority {
  readonly kind: "local-project-owner"
  readonly replicaId: ReplicaId
  readonly actorId: ActorId
  readonly ownerBindingDigest: Digest
  readonly ownerEditAuthorizationCoreDigest: Digest
}

/**
 * Scope-exact authorization derived from the durable local Project owner
 * binding. The frame signature by the bound owner key is the authorization
 * signature; this core prevents that authority from being replayed across a
 * Project epoch, shard, owner schema, or protocol.
 */
export interface LocalOwnerEditAuthorizationCore {
  readonly format: "convax.local-owner-edit-authorization-core"
  readonly scope: DocumentScope
  readonly replicaId: ReplicaId
  readonly actorId: ActorId
  readonly ownerBindingDigest: Digest
  readonly protocolDigest: Digest
  readonly ownerSchemaDigest: Digest
  readonly expiryPolicy: "none"
}

export interface TeamReplicaSignerAuthority {
  readonly kind: "team-replica"
  readonly memberId: MemberId
  readonly replicaId: ReplicaId
  readonly actorId: ActorId
  readonly memberAuthorizationEpoch: Id128
  readonly replicaAuthorizationEpoch: Id128
  readonly membershipSnapshotDigest: Digest
  readonly replicaActorCredentialCoreDigest: Digest
  readonly replicaEditAuthorizationCoreDigest: Digest
}

export type CausalSignerAuthority =
  | LocalProjectOwnerSignerAuthority
  | TeamReplicaSignerAuthority

export interface CausalContext {
  readonly format: "convax.causal-context"
  readonly scope: DocumentScope
  readonly baseFrontier: CausalFrontier
  readonly baseFrontierDigest: Digest
  readonly baseStateVectorDigest: Digest
  readonly baseCanonicalStateDigest: Digest
  readonly signerAuthority: CausalSignerAuthority
  readonly dependencies: readonly CausalDependencyRef[]
  readonly validationArtifactSetDigest: Digest
}

export type DocumentOwnerKind = "project-index" | "canvas"

export type OwnerCanonicalStateCodec = "restricted-jcs-utf8"

export interface OwnerCanonicalizerDescriptor {
  readonly format: "convax.owner-canonicalizer-descriptor"
  readonly owner: DocumentOwnerKind
  readonly ownerSchemaDigest: Digest
  readonly canonicalStateFormat: string
  readonly canonicalStateCodec: OwnerCanonicalStateCodec
  readonly exactBytePolicy: "parse-reencode-byte-equal"
  readonly unknownStatePolicy: "reject"
  readonly stateCommitment: OwnerStateCommitmentDescriptor
}

export interface ActualWrite {
  readonly entityKind: string
  readonly entityId: string
  readonly field: string
  readonly valueDigest: Digest
}

export interface ActualWriteEvidence {
  readonly format: "convax.actual-write-evidence"
  readonly scope: DocumentScope
  readonly owner: DocumentOwnerKind
  readonly ownerSchemaDigest: Digest
  readonly intentDigest: Digest
  readonly changedPaths: readonly string[]
  readonly writes: readonly ActualWrite[]
}

export type ValidationArtifactOwner = "kernel" | "project-index" | "canvas" | "control-plane" | "plugin"

export interface ValidationArtifactRef {
  readonly owner: ValidationArtifactOwner
  readonly format: string
  readonly artifactDigest: Digest
}

export interface ValidationArtifactSet {
  readonly format: "convax.validation-artifact-set"
  readonly artifacts: readonly ValidationArtifactRef[]
}

export interface CausalEditCore {
  readonly format: "convax.causal-edit-core"
  readonly scope: DocumentScope
  readonly actorId: ActorId
  readonly actorSequence: Uint64
  readonly predecessorFrameDigest: Digest | null
  readonly operationId: Id128
  readonly lamport: Uint64
  readonly intentKind: string
  readonly intentDigest: Digest
  readonly causalContextDigest: Digest
  readonly baseFrontierDigest: Digest
  readonly baseStateVectorDigest: Digest
  readonly baseCanonicalStateDigest: Digest
  readonly yjsUpdateDigest: Digest
  readonly postStateVectorDigest: Digest
  readonly postCanonicalStateDigest: Digest
  readonly actualWriteEvidenceDigest: Digest
  readonly typedIntentJcsByteLength: Uint64
  readonly causalContextJcsByteLength: Uint64
  readonly baseStateVectorByteLength: Uint64
  readonly yjsUpdateByteLength: Uint64
  readonly actualWriteEvidenceJcsByteLength: Uint64
  readonly protocolDigest: Digest
  readonly ownerSchemaDigest: Digest
  readonly canonicalizerDigest: Digest
  readonly validationArtifactSetDigest: Digest
  readonly signerAuthorityKind: CausalSignerAuthority["kind"]
  readonly signerAuthorityDigest: Digest
}

export interface CausalEditFrameHeader {
  readonly format: "convax.causal-edit-frame"
  readonly core: CausalEditCore
  readonly coreDigest: Digest
  readonly replicaSignature: Signature
}

export interface CausalEditFrameSections {
  readonly typedIntentJcs: Uint8Array
  readonly causalContextJcs: Uint8Array
  readonly baseStateVector: StateVector
  readonly yjsUpdate: Uint8Array
  readonly actualWriteEvidenceJcs: Uint8Array
}

export interface DecodedCausalEditFrame {
  readonly bytes: Uint8Array
  readonly frameDigest: Digest
  readonly header: CausalEditFrameHeader
  readonly headerJcs: Uint8Array
  readonly payload: Uint8Array
  readonly context: CausalContext
  readonly evidence: ActualWriteEvidence
  readonly sections: CausalEditFrameSections
}

declare const ownerValidatedStateBrand: unique symbol
declare const ownerApplyResultBrand: unique symbol
declare const ownerProcessValueFactoryBrand: unique symbol
declare const ownerExternalFactPortBrand: unique symbol
declare const ownerExternalFactPortFactoryBrand: unique symbol
declare const ownerHistoryMaterializationPortBrand: unique symbol
declare const ownerIntentClosurePortBrand: unique symbol
declare const documentOwnerProtocolPortBrand: unique symbol
declare const documentOwnerRuntimeBrand: unique symbol
declare const selectedDocumentOwnerArtifactFactoryBrand: unique symbol

export interface OwnerIntentConstructionContext {
  readonly scope: DocumentScope
  readonly actorId: ActorId
  readonly actorSequence: Uint64
  readonly operationId: Id128
  readonly lamport: Uint64
  readonly baseFrontierDigest: Digest
  readonly protocolDigest: Digest
  readonly ownerSchemaDigest: Digest
  readonly validationArtifactSetDigest: Digest
}

export interface OwnerIntentDependencyContext extends OwnerIntentConstructionContext {
  readonly intentDigest: Digest
}

export type OwnerIntentValidationContext = OwnerIntentDependencyContext

export interface OwnerValidatedState<K extends DocumentOwnerKind = DocumentOwnerKind> {
  readonly owner: K
  readonly value: unknown
  readonly [ownerValidatedStateBrand]: true
}

export interface OwnerApplyResult<K extends DocumentOwnerKind = DocumentOwnerKind> {
  readonly owner: K
  readonly value: unknown
  readonly [ownerApplyResultBrand]: true
}

export interface OwnerProcessValueFactory<K extends DocumentOwnerKind> {
  wrapValidatedState(value: unknown): OwnerValidatedState<K>
  wrapApplyResult(value: unknown): OwnerApplyResult<K>
  readonly canonicalJcs: CanonicalJcsEvidenceIssuer
  bindCanonicalJcsEvidence(
    document: Y.Doc,
    state: OwnerValidatedState<K>,
    evidence: CanonicalJcsEvidence,
  ): OwnerValidatedState<K>
  readonly stateCommitment: OwnerStateCommitmentIssuer
  bindStateCommitment(
    document: Y.Doc,
    state: OwnerValidatedState<K>,
    commitment: OwnerStateCommitment,
  ): OwnerValidatedState<K>
  readonly [ownerProcessValueFactoryBrand]: true
}

export interface OwnerExternalFactRequirement<K extends DocumentOwnerKind> {
  readonly owner: K
  readonly kind: string
  readonly factDigest: Digest
  readonly request: Readonly<{
    readonly sha256: Digest
    readonly exactJcs: Readonly<Uint8Array>
  }>
}

export interface OwnerIntentDependencies<K extends DocumentOwnerKind> {
  readonly validationArtifacts: readonly ValidationArtifactRef[]
  readonly externalFacts: readonly OwnerExternalFactRequirement<K>[]
}

export type OwnerValidationArtifactResolveResult =
  | Readonly<{ status: "resolved"; ref: ValidationArtifactRef; exactBytes: Readonly<Uint8Array> }>
  | Readonly<{ status: "pending"; ref: ValidationArtifactRef }>
  | Readonly<{ status: "rejected"; code: "artifact-not-declared" | "artifact-invalid" }>

export type OwnerExternalFactResolveResult<K extends DocumentOwnerKind> =
  | Readonly<{ status: "resolved"; requirement: OwnerExternalFactRequirement<K>; value: unknown }>
  | Readonly<{ status: "pending"; requirement: OwnerExternalFactRequirement<K> }>
  | Readonly<{ status: "rejected"; code: "fact-not-declared" | "fact-invalid" }>

export interface OwnerExternalFactResolverDefinition<K extends DocumentOwnerKind> {
  readonly owner: K
  resolveArtifact(ref: ValidationArtifactRef): OwnerValidationArtifactResolveResult
  resolveFact(requirement: OwnerExternalFactRequirement<K>): OwnerExternalFactResolveResult<K>
}

export interface OwnerExternalFactPort<K extends DocumentOwnerKind = DocumentOwnerKind> {
  resolveArtifact(ref: ValidationArtifactRef): OwnerValidationArtifactResolveResult
  resolveFact(requirement: OwnerExternalFactRequirement<K>): OwnerExternalFactResolveResult<K>
  consumedDependencies(): OwnerIntentDependencies<K>
  readonly [ownerExternalFactPortBrand]: true
}

export type CreateOwnerExternalFactAttemptPortResult<K extends DocumentOwnerKind> =
  | Readonly<{ status: "created"; port: OwnerExternalFactPort<K> }>
  | Readonly<{
      status: "rejected"
      code: "wrong-owner" | "dependency-cap-exceeded" | "dependency-order-invalid" | "dependency-duplicate" | "dependency-invalid"
    }>

export interface OwnerExternalFactPortFactory<K extends DocumentOwnerKind> {
  createAttemptPort(input: {
    readonly declared: OwnerIntentDependencies<K>
    readonly resolver: OwnerExternalFactResolverDefinition<K>
  }): CreateOwnerExternalFactAttemptPortResult<K>
  readonly [ownerExternalFactPortFactoryBrand]: true
}

export type InspectedOwnerIntent =
  | Readonly<{ kind: "ordinary" }>
  | Readonly<{ kind: "history"; direction: "undo" | "redo"; rootOperationId: Id128 }>

export interface OwnerHistoryMaterializationDefinition<K extends DocumentOwnerKind> {
  discoverDependencies(input: {
    readonly direction: "undo" | "redo"
    readonly rootOperationId: Id128
    readonly base: OwnerValidatedState<K>
    readonly context: OwnerIntentConstructionContext
  }): OwnerIntentDependencies<K> | "pending" | "rejected"
  materialize(input: {
    readonly direction: "undo" | "redo"
    readonly rootOperationId: Id128
    readonly base: OwnerValidatedState<K>
    readonly context: OwnerIntentConstructionContext
    readonly externalFacts: OwnerExternalFactPort<K>
  }): unknown | "pending" | "rejected"
}

export interface OwnerHistoryMaterializationPort<K extends DocumentOwnerKind>
  extends OwnerHistoryMaterializationDefinition<K> {
  readonly [ownerHistoryMaterializationPortBrand]: true
}

export interface OwnerIntentClosureDefinition<K extends DocumentOwnerKind> {
  inspectIntent(intent: unknown): InspectedOwnerIntent | "rejected"
  discoverDependencies(input: {
    readonly context: OwnerIntentDependencyContext
    readonly intent: unknown
  }): OwnerIntentDependencies<K> | "pending" | "rejected"
  readonly history: OwnerHistoryMaterializationDefinition<K> | null
}

export interface OwnerIntentClosurePort<K extends DocumentOwnerKind> {
  readonly protocolPort: DocumentOwnerProtocolPort<K>
  inspectIntent(intent: unknown): InspectedOwnerIntent | "rejected"
  discoverDependencies(input: {
    readonly context: OwnerIntentDependencyContext
    readonly intent: unknown
  }): OwnerIntentDependencies<K> | "pending" | "rejected"
  readonly history: OwnerHistoryMaterializationPort<K> | null
  readonly [ownerIntentClosurePortBrand]: true
}

export interface DocumentOwnerProtocolDefinition<K extends DocumentOwnerKind> {
  readonly owner: K
  readonly schemaDigest: Digest
  readonly canonicalizerDescriptor: OwnerCanonicalizerDescriptor
  readonly canonicalizerDigest: Digest
  decodeIntent(exactJcs: Uint8Array): unknown | "rejected"
  validateBase(document: Y.Doc): OwnerValidatedState<K> | "pending" | "rejected"
  applyIntent(
    base: OwnerValidatedState<K>,
    candidate: Y.Doc,
    context: OwnerIntentValidationContext,
    intent: unknown,
    externalFacts: OwnerExternalFactPort<K>,
  ): OwnerApplyResult<K> | "pending" | "rejected"
  validatePost(
    base: OwnerValidatedState<K>,
    candidate: Y.Doc,
    result: OwnerApplyResult<K>,
  ): OwnerValidatedState<K> | "pending" | "rejected"
  canonicalStateBytes(document: Y.Doc): Uint8Array | "rejected"
  deriveActualWriteEvidence(result: OwnerApplyResult<K>): ActualWriteEvidence
}

export interface DocumentOwnerProtocolPort<K extends DocumentOwnerKind = DocumentOwnerKind>
  extends DocumentOwnerProtocolDefinition<K> {
  readonly [documentOwnerProtocolPortBrand]: true
}

export interface SelectedDocumentOwnerArtifactDefinition<K extends DocumentOwnerKind> {
  readonly owner: K
  armCandidateTransactionCapture?(input: Readonly<{
    readonly base: OwnerValidatedState<K>
    readonly candidate: Y.Doc
    readonly context: OwnerIntentValidationContext
    readonly baseCanonicalProof?: Readonly<{
      readonly canonicalStateDigest: Digest
      readonly durableHeadDigest: Digest
    }>
  }>): void
  installValidatedPostCache?(input: Readonly<{
    readonly scope: DocumentScope
    readonly source: Y.Doc
    readonly target: Y.Doc
    readonly state: OwnerValidatedState<K>
    readonly canonicalStateDigest: Digest
    readonly durableHeadDigest: Digest
  }>): void
  readCertifiedCanonicalDigest?(input: Readonly<{
    readonly scope: DocumentScope
    readonly document: Y.Doc
    readonly durableHeadDigest: Digest
    readonly expectedCanonicalStateDigest: Digest
  }>): Digest | null
  createDefinitions(processValues: OwnerProcessValueFactory<K>): Readonly<{
    protocol: DocumentOwnerProtocolDefinition<K>
    closure: OwnerIntentClosureDefinition<K>
  }>
}

export interface DocumentOwnerRuntime<K extends DocumentOwnerKind = DocumentOwnerKind> {
  readonly artifactDigest: Digest
  readonly protocolPort: DocumentOwnerProtocolPort<K>
  readonly closurePort: OwnerIntentClosurePort<K>
  readonly externalFactPortFactory: OwnerExternalFactPortFactory<K>
  readonly [documentOwnerRuntimeBrand]: true
}

export interface SelectedDocumentOwnerArtifactFactory<K extends DocumentOwnerKind> {
  createRuntime(definition: SelectedDocumentOwnerArtifactDefinition<K>):
    | DocumentOwnerRuntime<K>
    | Readonly<{
        status: "rejected"
        code: "owner-definition-mismatch" | "owner-artifact-mismatch" | "owner-runtime-invalid"
      }>
  readonly [selectedDocumentOwnerArtifactFactoryBrand]: true
}

export interface FrameObjectRef {
  readonly scope: DocumentScope
  readonly frameDigest: Digest
  readonly actorId: ActorId
  readonly actorSequence: Uint64
  readonly operationId: Id128
}

export type OrdinarySha256 = Digest

declare const remoteIngressReservationReceiptBrand: unique symbol
declare const completedRemoteUpdateIngressBrand: unique symbol
declare const remoteIngressByteCursorBrand: unique symbol
declare const fullyValidatedRemoteIngressStagingBrand: unique symbol
declare const remoteImmutableIngressObjectReceiptBrand: unique symbol
declare const remoteTransferAttemptBindingBrand: unique symbol
declare const remoteTransferAttemptBindingFactoryBrand: unique symbol
declare const remoteIngressEvidenceAdmissionReceiptBrand: unique symbol

export interface StableRemoteTransferKey {
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly sourceMemberId: MemberId
  readonly transferId: Id128
}

export type RemoteIngressKind = string
export type RemoteIngressAckAuthority = string

export interface RemoteIngressEvidenceMissingObject {
  readonly objectDigest: Digest
  readonly byteLength: Uint64
}

export interface BeginRemoteIngressEvidenceAdmissionCommand {
  readonly transition: "reserve"
  readonly stableKey: StableRemoteTransferKey
  readonly sourceMemberId: MemberId
  readonly authenticatedSourceMemberId: MemberId
  readonly expectedPriorEpochHeadRecordDigest: Digest
  readonly expectedPriorStableKeyStateRecordDigest: Digest | null
  readonly expectedPriorMemberQuotaRecordDigest: Digest | null
  readonly exactManifestCoreJcs: Readonly<Uint8Array>
  readonly prospectiveClosureRecordExactJcs: Readonly<Uint8Array>
  readonly admissionStartMissingObjects: readonly RemoteIngressEvidenceMissingObject[]
}

export interface SettleRemoteIngressEvidenceAdmissionCommand {
  readonly transition: "settle"
  readonly stableKey: StableRemoteTransferKey
  readonly sourceMemberId: MemberId
  readonly authenticatedSourceMemberId: MemberId
  readonly manifestCoreDigest: Digest
  readonly prospectiveClosureRecordDigest: Digest
  readonly signedOfferEvidenceClosureObjectDigest: Digest
  readonly expectedPriorEpochHeadRecordDigest: Digest
  readonly expectedPriorStableKeyStateRecordDigest: Digest
  readonly expectedPriorMemberQuotaRecordDigest: Digest
}

export interface AbandonRemoteIngressEvidenceAdmissionCommand {
  readonly transition: "abandon-release"
  readonly stableKey: StableRemoteTransferKey
  readonly sourceMemberId: MemberId
  readonly authenticatedSourceMemberId: MemberId
  readonly manifestCoreDigest: Digest
  readonly prospectiveClosureRecordDigest: Digest
  readonly expectedPriorEpochHeadRecordDigest: Digest
  readonly expectedPriorStableKeyStateRecordDigest: Digest
  readonly expectedPriorMemberQuotaRecordDigest: Digest
  readonly abandonmentReason: "authorization-closed" | "caller-cancelled" | "evidence-capacity-exceeded"
}

export interface TransferRemoteIngressEvidenceAdmissionChargeCommand {
  readonly transition: "transfer-release"
  readonly stableKey: StableRemoteTransferKey
  readonly sourceMemberId: MemberId
  readonly authenticatedSourceMemberId: MemberId
  readonly manifestCoreDigest: Digest
  readonly prospectiveClosureRecordDigest: Digest
  readonly signedOfferEvidenceClosureObjectDigest: Digest
  readonly chargeTransferBindingRecordDigest: Digest
  readonly expectedPriorEpochHeadRecordDigest: Digest
  readonly expectedPriorStableKeyStateRecordDigest: Digest
  readonly expectedPriorMemberQuotaRecordDigest: Digest
}

export type AdvanceRemoteIngressEvidenceAdmissionCommand =
  | SettleRemoteIngressEvidenceAdmissionCommand
  | AbandonRemoteIngressEvidenceAdmissionCommand
  | TransferRemoteIngressEvidenceAdmissionChargeCommand

export type RemoteIngressEvidenceAdmissionTransition =
  | "reserve"
  | "settle"
  | "abandon-release"
  | "transfer-release"

export interface RemoteIngressEvidenceAdmissionTransitionPortEvidence {
  readonly transition: RemoteIngressEvidenceAdmissionTransition
  readonly idempotent: boolean
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly stableKey: StableRemoteTransferKey
  readonly sourceMemberId: MemberId
  readonly manifestCoreDigest: Digest
  readonly prospectiveClosureRecordDigest: Digest
  readonly transitionRecordDigest: Digest
  readonly epochHeadRecordDigest: Digest
  readonly stableKeyStateRecordDigest: Digest
  readonly memberQuotaRecordDigest: Digest
  readonly stableKeyMonotonicAttemptCount: Uint32
  readonly memberMonotonicAttemptCount: Uint32
  readonly projectMonotonicAttemptCount: Uint32
  readonly stableKeyChargedClosureCount: Uint32
  readonly memberChargedClosureCount: Uint32
  readonly projectChargedClosureCount: Uint32
  readonly memberAccountedAdmissionByteLength: Uint64
  readonly projectAccountedAdmissionByteLength: Uint64
}

export interface RemoteIngressEvidenceAdmissionReceipt {
  readonly transition: RemoteIngressEvidenceAdmissionTransition
  readonly epochHeadRecordDigest: Digest
  readonly stableKeyStateRecordDigest: Digest
  readonly memberQuotaRecordDigest: Digest
  readonly [remoteIngressEvidenceAdmissionReceiptBrand]: true
}

export type RemoteIngressEvidenceAdmissionPortResult =
  | Readonly<{ status: "committed"; evidence: RemoteIngressEvidenceAdmissionTransitionPortEvidence }>
  | Readonly<{
      status: "rejected"
      code: "head-stale" | "identity-mismatch" | "quota-exceeded" | "transition-invalid" |
        "durability-failed" | "store-corrupt"
    }>

export interface RemoteIngressEvidenceAdmissionPersistencePort {
  begin(command: BeginRemoteIngressEvidenceAdmissionCommand): Promise<RemoteIngressEvidenceAdmissionPortResult>
  advance(command: AdvanceRemoteIngressEvidenceAdmissionCommand): Promise<RemoteIngressEvidenceAdmissionPortResult>
  loadCurrentEpochHeadDigest(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
  }): Promise<Digest>
}

export type UpdateIngressChunkBytes = "4096" | "8192" | "16384" | "32768" | "65536" | "131072" | "262144"

export interface RemoteIngressQuotaReservationPortEvidence {
  readonly limitsDigest: Digest
  readonly stableKey: StableRemoteTransferKey
  readonly exactManifestDigest: Digest
  readonly kind: RemoteIngressKind
  readonly sourceMemberId: MemberId
  readonly chargedClosureCount: "1"
  readonly accountedAdmissionByteLength: Uint64
  readonly resultingProjectChargedClosureCount: Uint32
  readonly resultingProjectAccountedAdmissionByteLength: Uint64
  readonly resultingSourceMemberChargedClosureCount: Uint32
  readonly resultingSourceMemberAccountedAdmissionByteLength: Uint64
  readonly admissionEpochHeadRecordDigest: Digest
  readonly admissionTransitionRecordDigest: Digest
  readonly memberQuotaRecordDigest: Digest
}

/**
 * Plain Project/node evidence for the one-time reservation-to-owner charge
 * transfer. The Kernel compares every mirror before minting an install receipt;
 * this structural carrier is deliberately unbranded and grants no authority.
 */
export interface RemoteIngressQuotaTransferPortEvidence<K extends RemoteIngressKind> {
  readonly limitsDigest: Digest
  readonly stableKey: StableRemoteTransferKey
  readonly exactManifestDigest: Digest
  readonly kind: K
  readonly sourceMemberId: MemberId
  readonly chargedClosureCount: "1"
  readonly accountedAdmissionByteLength: Uint64
  readonly resultingProjectChargedClosureCount: Uint32
  readonly resultingProjectAccountedAdmissionByteLength: Uint64
  readonly resultingSourceMemberChargedClosureCount: Uint32
  readonly resultingSourceMemberAccountedAdmissionByteLength: Uint64
  readonly priorAdmissionEpochHeadRecordDigest: Digest
  readonly resultingAdmissionEpochHeadRecordDigest: Digest
  readonly chargeTransferBindingRecordDigest: Digest
  readonly replacementKind: "owner-install"
  readonly replacementRootRecordDigest: Digest
  readonly replacementRootHeadRecordDigest: Digest
}

export interface RemoteIngressReservationPortEvidence {
  readonly stableKey: StableRemoteTransferKey
  readonly exactManifestDigest: Digest
  readonly signedOfferEvidenceClosureRecordDigest: Digest
  readonly reservationRecordDigest: Digest
  readonly currentChunkSetHeadRecordDigest: Digest
  readonly kind: RemoteIngressKind
  readonly scope: DocumentScope | null
  readonly subjectDigest: Digest
  readonly ordinarySha256: OrdinarySha256
  readonly declaredByteLength: Uint64
  readonly chunkBytes: UpdateIngressChunkBytes
  readonly chunkCount: Uint32
  readonly quota: RemoteIngressQuotaReservationPortEvidence
}

export interface RemoteIngressReservationReceipt extends RemoteIngressReservationPortEvidence {
  readonly [remoteIngressReservationReceiptBrand]: true
}

export interface ReserveRemoteIngressRequest {
  readonly stableKey: StableRemoteTransferKey
  readonly exactManifestDigest: Digest
  readonly signedOfferEvidenceClosureRecordDigest: Digest
  readonly kind: RemoteIngressKind
  readonly scope: DocumentScope | null
  readonly subjectDigest: Digest
  readonly ordinarySha256: OrdinarySha256
  readonly declaredByteLength: Uint64
  readonly accountedAdmissionByteLength: Uint64
  readonly chunkBytes: UpdateIngressChunkBytes
  readonly chunkCount: Uint32
}

export interface RemoteIngressCompletedStagingEvidence {
  readonly stableKey: StableRemoteTransferKey
  readonly exactManifestDigest: Digest
  readonly signedOfferEvidenceClosureRecordDigest: Digest
  readonly reservationRecordDigest: Digest
  readonly finalChunkSetHeadRecordDigest: Digest
  readonly durableChunkSetDigest: Digest
  readonly kind: RemoteIngressKind
  readonly scope: DocumentScope | null
  readonly subjectDigest: Digest
  readonly ordinarySha256: OrdinarySha256
  readonly exactByteLength: Uint64
  readonly chunkBytes: UpdateIngressChunkBytes
  readonly chunkCount: Uint32
  readonly quota: RemoteIngressQuotaReservationPortEvidence
}

export interface CompletedRemoteUpdateIngress<K extends RemoteIngressKind = RemoteIngressKind> {
  readonly evidence: RemoteIngressCompletedStagingEvidence & { readonly kind: K }
  openSequentialCursor(): Promise<RemoteIngressByteCursor>
  readonly [completedRemoteUpdateIngressBrand]: true
}

export type ReserveRemoteIngressPortResult =
  | Readonly<{ status: "reserved"; evidence: RemoteIngressReservationPortEvidence }>
  | Readonly<{
      status: "rejected"
      code: "manifest-mismatch" | "authorization-closed" | "capacity-exceeded" | "durability-failed" | "store-corrupt"
    }>

export type CompleteRemoteIngressStagingPortResult =
  | Readonly<{ status: "complete"; evidence: RemoteIngressCompletedStagingEvidence }>
  | Readonly<{
      status: "rejected"
      code: "stale-receipt" | "transfer-incomplete" | "length-mismatch" | "hash-mismatch" | "durability-failed" | "store-corrupt"
    }>

export interface RemoteIngressStagingPersistencePort {
  reserveRemoteIngress(request: ReserveRemoteIngressRequest): Promise<ReserveRemoteIngressPortResult>
  completeRemoteIngressStaging(reservation: RemoteIngressReservationReceipt): Promise<CompleteRemoteIngressStagingPortResult>
  openRemoteIngressSequentialCursor(
    evidence: RemoteIngressCompletedStagingEvidence,
  ): Promise<OpenRemoteIngressSequentialCursorPortResult>
}

export type RemoteIngressByteCursorRead =
  | Readonly<{
      status: "chunk"
      chunkIndex: Uint32
      byteOffset: Uint64
      exactByteLength: Uint32
      exactChunkSha256: OrdinarySha256
      exactChunkBytes: Readonly<Uint8Array>
    }>
  | Readonly<{ status: "complete"; exactByteLength: Uint64; ordinarySha256: OrdinarySha256 }>

export interface RemoteIngressSequentialCursorPortHandle {
  nextPersistedChunk(): Promise<RemoteIngressByteCursorRead>
  closePersistedCursor(): void
}

export type OpenRemoteIngressSequentialCursorPortResult =
  | Readonly<{ status: "opened"; handle: RemoteIngressSequentialCursorPortHandle }>
  | Readonly<{
      status: "rejected"
      code: "staging-not-complete" | "staging-head-stale" | "cursor-already-open" | "store-corrupt"
    }>

export interface RemoteIngressByteCursor {
  next(): Promise<RemoteIngressByteCursorRead>
  close(): void
  readonly [remoteIngressByteCursorBrand]: true
}

export interface RemoteIngressOwnerValidationEvidence<K extends RemoteIngressKind> {
  readonly kind: K
  readonly scope: DocumentScope | null
  readonly subjectDigest: Digest
  readonly ordinarySha256: OrdinarySha256
  readonly exactByteLength: Uint64
  readonly protocolDigest: Digest
  readonly ownerArtifactDigest: Digest
}

export interface FullyValidatedRemoteIngressStaging<K extends RemoteIngressKind> {
  readonly completed: CompletedRemoteUpdateIngress<K>
  readonly ownerArtifactDigest: Digest
  readonly [fullyValidatedRemoteIngressStagingBrand]: true
}

export interface RemoteImmutableIngressObjectPortEvidence<K extends RemoteIngressKind> {
  readonly stableKey: StableRemoteTransferKey
  readonly exactManifestDigest: Digest
  readonly signedOfferEvidenceClosureRecordDigest: Digest
  readonly reservationRecordDigest: Digest
  readonly finalChunkSetHeadRecordDigest: Digest
  readonly durableChunkSetDigest: Digest
  readonly kind: K
  readonly scope: DocumentScope | null
  readonly subjectDigest: Digest
  readonly ordinarySha256: OrdinarySha256
  readonly exactByteLength: Uint64
  readonly immutableObjectDigest: Digest
  readonly quota: RemoteIngressQuotaReservationPortEvidence
}

export interface RemoteImmutableIngressObjectReceipt<K extends RemoteIngressKind>
  extends RemoteImmutableIngressObjectPortEvidence<K> {
  readonly [remoteImmutableIngressObjectReceiptBrand]: true
}

export type PutImmutableCompletedRemoteIngressPortResult<K extends RemoteIngressKind> =
  | Readonly<{ status: "durable"; evidence: RemoteImmutableIngressObjectPortEvidence<K> }>
  | Readonly<{
      status: "rejected"
      code: "stale-completed-staging" | "mirror-mismatch" | "durability-failed" | "store-corrupt"
    }>

export interface RemoteIngressImmutableObjectPersistencePort {
  putImmutableCompletedRemoteIngress<K extends RemoteIngressKind>(
    validated: FullyValidatedRemoteIngressStaging<K>,
  ): Promise<PutImmutableCompletedRemoteIngressPortResult<K>>
}

export interface RemoteTransferAttemptBinding<K extends RemoteIngressKind> {
  readonly kind: K
  readonly stableKey: StableRemoteTransferKey
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly sourceMemberId: MemberId
  readonly exactManifestDigest: Digest
  readonly subjectDigest: Digest
  readonly [remoteTransferAttemptBindingBrand]: true
}

export interface RemoteTransferAttemptBindingFactory {
  bind<K extends RemoteIngressKind>(input: {
    readonly kind: K
    readonly stableKey: StableRemoteTransferKey
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
    readonly sourceMemberId: MemberId
    readonly exactManifestDigest: Digest
    readonly subjectDigest: Digest
  }): RemoteTransferAttemptBinding<K>
  readonly [remoteTransferAttemptBindingFactoryBrand]: true
}

export interface ReplicaCheckpointCore {
  readonly format: "convax.replica-checkpoint-core"
  readonly scope: DocumentScope
  readonly checkpointId: Id128
  readonly authorMemberId: MemberId
  readonly authorReplicaId: ReplicaId
  readonly authorActorId: ActorId
  readonly authorAuthorizationDigest: Digest
  readonly directParentCheckpointDigests: readonly Digest[]
  readonly baseFrontierDigest: Digest
  readonly computedFrontierDigest: Digest
  readonly actorHeadBoundaryDigest: Digest
  readonly stateVectorDigest: Digest
  readonly canonicalStateDigest: Digest
  readonly fullUpdateDigest: Digest
  readonly fullUpdateByteLength: Uint64
  readonly protocolDigest: Digest
  readonly schemaDigest: Digest
  readonly canonicalizerDigest: Digest
  readonly validationArtifactSetDigest: Digest
}

export interface ReplicaCheckpoint {
  readonly format: "convax.replica-checkpoint"
  readonly core: ReplicaCheckpointCore
  readonly coreDigest: Digest
  readonly replicaSignature: Signature
}

export interface CheckpointContentCertificateCore {
  readonly format: "convax.checkpoint-content-certificate-core"
  readonly scope: DocumentScope
  readonly checkpointDigest: Digest
  readonly parentCertificateDigests: readonly Digest[]
  readonly computedFrontierDigest: Digest
  readonly actorHeadBoundaryDigest: Digest
  readonly stateVectorDigest: Digest
  readonly canonicalStateDigest: Digest
  readonly fullUpdateDigest: Digest
  readonly protocolDigest: Digest
  readonly schemaDigest: Digest
  readonly canonicalizerDigest: Digest
  readonly validationArtifactSetDigest: Digest
  readonly trustBundleDigest: Digest
  readonly contentStatus: "service-validated-causal-closure"
  readonly serviceKeyPurpose: "content-attestation"
  readonly serviceKeyId: string
}

export interface CheckpointContentCertificate {
  readonly format: "convax.checkpoint-content-certificate"
  readonly core: CheckpointContentCertificateCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface StableCheckpointSetCore {
  readonly format: "convax.stable-checkpoint-set-core"
  readonly scope: DocumentScope
  readonly priorSetDigest: Digest | null
  readonly contentCertificateDigests: readonly Digest[]
  readonly mergedFrontierDigest: Digest
  readonly actorHeadBoundaryDigest: Digest
  readonly membershipSnapshotDigest: Digest
  readonly protocolDigest: Digest
  readonly validationArtifactSetDigest: Digest
}

export interface ReplicaCausalFloorAckCore {
  readonly format: "convax.replica-causal-floor-ack-core"
  readonly stableSetCoreDigest: Digest
  readonly replicaId: ReplicaId
  readonly actorId: ActorId
  readonly replicaActorCredentialDigest: Digest
  readonly actorHeadAtAck: CausalHeadRef | null
  readonly durableCheckpoint: true
  readonly validatedExactClosure: true
  readonly installedMonotonicFloor: true
}

export interface ReplicaCausalFloorAck {
  readonly format: "convax.replica-causal-floor-ack"
  readonly core: ReplicaCausalFloorAckCore
  readonly coreDigest: Digest
  readonly replicaSignature: Signature
}

export interface PrunableCheckpointSetCertificateCore {
  readonly format: "convax.prunable-checkpoint-set-certificate-core"
  readonly stableSetCore: StableCheckpointSetCore
  readonly floorAckDigests: readonly Digest[]
  readonly contentStatus: "service-validated-and-all-editors-acknowledged"
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "checkpoint-stability"
  readonly serviceKeyId: string
}

export interface PrunableCheckpointSetCertificate {
  readonly format: "convax.prunable-checkpoint-set-certificate"
  readonly core: PrunableCheckpointSetCertificateCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}
