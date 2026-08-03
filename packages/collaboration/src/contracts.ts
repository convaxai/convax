import type * as Y from "yjs"
import type {
  ActorIdV2,
  CanvasIdV2,
  DigestV2,
  Id128V2,
  MemberIdV2,
  ProjectIdV2,
  ReplicaIdV2,
  SignatureV2,
  StateVectorV2,
  Uint32V2,
  Uint64V2,
} from "./codecs"

export interface ProtocolSchemaArtifactV2 {
  readonly artifactDigest: DigestV2
  readonly format:
    | "convax.canvas-protocol-schema/2"
    | "convax.collaboration-kernel-protocol-schema/2"
    | "convax.control-plane-protocol-schema/2"
    | "convax.project-persistence-protocol-schema/2"
  readonly name: "canvas-schema" | "collaboration-kernel" | "control-plane" | "project-persistence"
}

export type ProtocolSchemaArtifactManifestV2 = readonly [
  ProtocolSchemaArtifactV2 & { readonly name: "canvas-schema"; readonly format: "convax.canvas-protocol-schema/2" },
  ProtocolSchemaArtifactV2 & { readonly name: "collaboration-kernel"; readonly format: "convax.collaboration-kernel-protocol-schema/2" },
  ProtocolSchemaArtifactV2 & { readonly name: "control-plane"; readonly format: "convax.control-plane-protocol-schema/2" },
  ProtocolSchemaArtifactV2 & { readonly name: "project-persistence"; readonly format: "convax.project-persistence-protocol-schema/2" },
]

export interface ProtocolTypeNamespaceV2 {
  readonly imports: readonly ("canvas-schema" | "collaboration-kernel" | "control-plane" | "global-uri" | "project-persistence")[]
  readonly namespace: "canvas-schema" | "collaboration-kernel" | "control-plane" | "global-uri" | "project-persistence"
}

export type ProtocolTypeNamespaceManifestV2 = readonly [
  { readonly namespace: "canvas-schema"; readonly imports: readonly ["collaboration-kernel", "control-plane", "global-uri"] },
  { readonly namespace: "collaboration-kernel"; readonly imports: readonly ["global-uri"] },
  { readonly namespace: "control-plane"; readonly imports: readonly ["collaboration-kernel", "global-uri", "project-persistence"] },
  { readonly namespace: "global-uri"; readonly imports: readonly [] },
  { readonly namespace: "project-persistence"; readonly imports: readonly ["canvas-schema", "collaboration-kernel", "control-plane", "global-uri"] },
]

export interface YjsWireCodecV2 {
  readonly applyCodec: "Y.applyUpdate"
  readonly format: "convax.yjs-wire-codec/2"
  readonly package: "yjs"
  readonly packageIntegrity: "sha512-Eq+5BRfbeGyqGVrTJL3bEcr8gKkxPuyuoHmAwpk52fDb8kOVMrfVSTRPd6yiGgX5Fskb96qCRjzjbRjrL4YEnw=="
  readonly stateVectorCodec: "Y.encodeStateVector"
  readonly updateCodec: "Y.encodeStateAsUpdate"
  readonly updateVersion: "v1"
  readonly version: "13.6.31"
}

export interface ProtocolSchemaBundleCoreV2 {
  readonly artifacts: ProtocolSchemaArtifactManifestV2
  readonly channelContractDigest: DigestV2
  readonly domainRegistry: readonly string[]
  readonly format: "convax.protocol-schema-bundle-core/2"
  readonly limitsDigest: DigestV2
  readonly protocolMajor: "2"
  readonly typeNamespaces: ProtocolTypeNamespaceManifestV2
  readonly uriProtocolDigest: DigestV2
  readonly yjsWireCodec: YjsWireCodecV2
}

export interface ProtocolSchemaBundleV2 {
  readonly core: ProtocolSchemaBundleCoreV2
  readonly coreDigest: DigestV2
  readonly format: "convax.protocol-schema-bundle/2"
  readonly protocolDigest: DigestV2
}

export interface DocumentScopeV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly docKind: "project-index" | "canvas"
  readonly docId: "project-index" | CanvasIdV2
  readonly shardEpoch: Id128V2
}

export type DocumentScopeDigestV2 = DigestV2

export interface PortableStampV2 {
  readonly format: "convax.portable-stamp/2"
  readonly lamport: Uint64V2
  readonly actorId: ActorIdV2
  readonly operationId: Id128V2
  readonly writeOrdinal: Uint32V2
}

export interface CausalHeadRefV2 {
  readonly format: "convax.causal-head-ref/2"
  readonly actorId: ActorIdV2
  readonly actorSequence: Uint64V2
  readonly frameDigest: DigestV2
  readonly lamport: Uint64V2
}

export interface CausalFrontierV2 {
  readonly format: "convax.causal-frontier/2"
  readonly heads: readonly CausalHeadRefV2[]
}

export interface ReplicaActorHeadSetV2 {
  readonly format: "convax.replica-actor-head-set/2"
  readonly scope: DocumentScopeV2
  readonly heads: readonly CausalHeadRefV2[]
}

export type CausalDependencyKindV2 =
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

export interface CausalDependencyRefV2 {
  readonly kind: CausalDependencyKindV2
  readonly digest: DigestV2
}

export interface CausalSignerAuthorityV2 {
  readonly memberId: MemberIdV2
  readonly replicaId: ReplicaIdV2
  readonly actorId: ActorIdV2
  readonly memberAuthorizationEpoch: Id128V2
  readonly replicaAuthorizationEpoch: Id128V2
  readonly membershipSnapshotDigest: DigestV2
  readonly replicaActorCredentialCoreDigest: DigestV2
  readonly replicaEditAuthorizationCoreDigest: DigestV2
}

export interface CausalContextV2 {
  readonly format: "convax.causal-context/2"
  readonly scope: DocumentScopeV2
  readonly baseFrontier: CausalFrontierV2
  readonly baseFrontierDigest: DigestV2
  readonly baseStateVectorDigest: DigestV2
  readonly baseCanonicalStateDigest: DigestV2
  readonly signerAuthority: CausalSignerAuthorityV2
  readonly dependencies: readonly CausalDependencyRefV2[]
  readonly validationArtifactSetDigest: DigestV2
}

export type DocumentOwnerKindV2 = "project-index" | "canvas"

export type OwnerCanonicalStateCodecV2 = "restricted-jcs-utf8"

export interface OwnerCanonicalizerDescriptorV2 {
  readonly format: "convax.owner-canonicalizer-descriptor/2"
  readonly owner: DocumentOwnerKindV2
  readonly ownerSchemaDigest: DigestV2
  readonly canonicalStateFormat: string
  readonly canonicalStateCodec: OwnerCanonicalStateCodecV2
  readonly exactBytePolicy: "parse-reencode-byte-equal"
  readonly unknownStatePolicy: "reject"
}

export interface ActualWriteV2 {
  readonly entityKind: string
  readonly entityId: string
  readonly field: string
  readonly valueDigest: DigestV2
}

export interface ActualWriteEvidenceV2 {
  readonly format: "convax.actual-write-evidence/2"
  readonly scope: DocumentScopeV2
  readonly owner: DocumentOwnerKindV2
  readonly ownerSchemaDigest: DigestV2
  readonly intentDigest: DigestV2
  readonly changedPaths: readonly string[]
  readonly writes: readonly ActualWriteV2[]
}

export type ValidationArtifactOwnerV2 = "kernel" | "project-index" | "canvas" | "control-plane" | "plugin"

export interface ValidationArtifactRefV2 {
  readonly owner: ValidationArtifactOwnerV2
  readonly format: string
  readonly artifactDigest: DigestV2
}

export interface ValidationArtifactSetV2 {
  readonly format: "convax.validation-artifact-set/2"
  readonly artifacts: readonly ValidationArtifactRefV2[]
}

export interface CausalEditCoreV2 {
  readonly format: "convax.causal-edit-core/2"
  readonly scope: DocumentScopeV2
  readonly actorId: ActorIdV2
  readonly actorSequence: Uint64V2
  readonly predecessorFrameDigest: DigestV2 | null
  readonly operationId: Id128V2
  readonly lamport: Uint64V2
  readonly intentKind: string
  readonly intentDigest: DigestV2
  readonly causalContextDigest: DigestV2
  readonly baseFrontierDigest: DigestV2
  readonly baseStateVectorDigest: DigestV2
  readonly baseCanonicalStateDigest: DigestV2
  readonly yjsUpdateDigest: DigestV2
  readonly postStateVectorDigest: DigestV2
  readonly postCanonicalStateDigest: DigestV2
  readonly actualWriteEvidenceDigest: DigestV2
  readonly typedIntentJcsByteLength: Uint64V2
  readonly causalContextJcsByteLength: Uint64V2
  readonly baseStateVectorByteLength: Uint64V2
  readonly yjsUpdateByteLength: Uint64V2
  readonly actualWriteEvidenceJcsByteLength: Uint64V2
  readonly protocolDigest: DigestV2
  readonly ownerSchemaDigest: DigestV2
  readonly canonicalizerDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly membershipSnapshotDigest: DigestV2
  readonly replicaActorCredentialCoreDigest: DigestV2
  readonly replicaEditAuthorizationCoreDigest: DigestV2
}

export interface CausalEditFrameHeaderV2 {
  readonly format: "convax.causal-edit-frame/2"
  readonly core: CausalEditCoreV2
  readonly coreDigest: DigestV2
  readonly replicaSignature: SignatureV2
}

export interface CausalEditFrameSectionsV2 {
  readonly typedIntentJcs: Uint8Array
  readonly causalContextJcs: Uint8Array
  readonly baseStateVector: StateVectorV2
  readonly yjsUpdate: Uint8Array
  readonly actualWriteEvidenceJcs: Uint8Array
}

export interface DecodedCausalEditFrameV2 {
  readonly bytes: Uint8Array
  readonly frameDigest: DigestV2
  readonly header: CausalEditFrameHeaderV2
  readonly headerJcs: Uint8Array
  readonly payload: Uint8Array
  readonly context: CausalContextV2
  readonly evidence: ActualWriteEvidenceV2
  readonly sections: CausalEditFrameSectionsV2
}

declare const ownerValidatedStateBrandV2: unique symbol
declare const ownerApplyResultBrandV2: unique symbol
declare const ownerProcessValueFactoryBrandV2: unique symbol
declare const ownerExternalFactPortBrandV2: unique symbol
declare const ownerExternalFactPortFactoryBrandV2: unique symbol
declare const ownerHistoryMaterializationPortBrandV2: unique symbol
declare const ownerIntentClosurePortBrandV2: unique symbol
declare const documentOwnerProtocolPortBrandV2: unique symbol
declare const documentOwnerRuntimeBrandV2: unique symbol
declare const selectedDocumentOwnerArtifactFactoryBrandV2: unique symbol

export interface OwnerIntentConstructionContextV2 {
  readonly scope: DocumentScopeV2
  readonly actorId: ActorIdV2
  readonly actorSequence: Uint64V2
  readonly operationId: Id128V2
  readonly lamport: Uint64V2
  readonly baseFrontierDigest: DigestV2
  readonly protocolDigest: DigestV2
  readonly ownerSchemaDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
}

export interface OwnerIntentDependencyContextV2 extends OwnerIntentConstructionContextV2 {
  readonly intentDigest: DigestV2
}

export type OwnerIntentValidationContextV2 = OwnerIntentDependencyContextV2

export interface OwnerValidatedStateV2<K extends DocumentOwnerKindV2 = DocumentOwnerKindV2> {
  readonly owner: K
  readonly value: unknown
  readonly [ownerValidatedStateBrandV2]: true
}

export interface OwnerApplyResultV2<K extends DocumentOwnerKindV2 = DocumentOwnerKindV2> {
  readonly owner: K
  readonly value: unknown
  readonly [ownerApplyResultBrandV2]: true
}

export interface OwnerProcessValueFactoryV2<K extends DocumentOwnerKindV2> {
  wrapValidatedState(value: unknown): OwnerValidatedStateV2<K>
  wrapApplyResult(value: unknown): OwnerApplyResultV2<K>
  readonly [ownerProcessValueFactoryBrandV2]: true
}

export interface OwnerExternalFactRequirementV2<K extends DocumentOwnerKindV2> {
  readonly owner: K
  readonly kind: string
  readonly factDigest: DigestV2
  readonly request: Readonly<{
    readonly sha256: DigestV2
    readonly exactJcs: Readonly<Uint8Array>
  }>
}

export interface OwnerIntentDependenciesV2<K extends DocumentOwnerKindV2> {
  readonly validationArtifacts: readonly ValidationArtifactRefV2[]
  readonly externalFacts: readonly OwnerExternalFactRequirementV2<K>[]
}

export type OwnerValidationArtifactResolveResultV2 =
  | Readonly<{ status: "resolved"; ref: ValidationArtifactRefV2; exactBytes: Readonly<Uint8Array> }>
  | Readonly<{ status: "pending"; ref: ValidationArtifactRefV2 }>
  | Readonly<{ status: "rejected"; code: "artifact-not-declared" | "artifact-invalid" }>

export type OwnerExternalFactResolveResultV2<K extends DocumentOwnerKindV2> =
  | Readonly<{ status: "resolved"; requirement: OwnerExternalFactRequirementV2<K>; value: unknown }>
  | Readonly<{ status: "pending"; requirement: OwnerExternalFactRequirementV2<K> }>
  | Readonly<{ status: "rejected"; code: "fact-not-declared" | "fact-invalid" }>

export interface OwnerExternalFactResolverDefinitionV2<K extends DocumentOwnerKindV2> {
  readonly owner: K
  resolveArtifact(ref: ValidationArtifactRefV2): OwnerValidationArtifactResolveResultV2
  resolveFact(requirement: OwnerExternalFactRequirementV2<K>): OwnerExternalFactResolveResultV2<K>
}

export interface OwnerExternalFactPortV2<K extends DocumentOwnerKindV2 = DocumentOwnerKindV2> {
  resolveArtifact(ref: ValidationArtifactRefV2): OwnerValidationArtifactResolveResultV2
  resolveFact(requirement: OwnerExternalFactRequirementV2<K>): OwnerExternalFactResolveResultV2<K>
  consumedDependencies(): OwnerIntentDependenciesV2<K>
  readonly [ownerExternalFactPortBrandV2]: true
}

export type CreateOwnerExternalFactAttemptPortResultV2<K extends DocumentOwnerKindV2> =
  | Readonly<{ status: "created"; port: OwnerExternalFactPortV2<K> }>
  | Readonly<{
      status: "rejected"
      code: "wrong-owner" | "dependency-cap-exceeded" | "dependency-order-invalid" | "dependency-duplicate" | "dependency-invalid"
    }>

export interface OwnerExternalFactPortFactoryV2<K extends DocumentOwnerKindV2> {
  createAttemptPort(input: {
    readonly declared: OwnerIntentDependenciesV2<K>
    readonly resolver: OwnerExternalFactResolverDefinitionV2<K>
  }): CreateOwnerExternalFactAttemptPortResultV2<K>
  readonly [ownerExternalFactPortFactoryBrandV2]: true
}

export type InspectedOwnerIntentV2 =
  | Readonly<{ kind: "ordinary" }>
  | Readonly<{ kind: "history"; direction: "undo" | "redo"; rootOperationId: Id128V2 }>

export interface OwnerHistoryMaterializationDefinitionV2<K extends DocumentOwnerKindV2> {
  discoverDependencies(input: {
    readonly direction: "undo" | "redo"
    readonly rootOperationId: Id128V2
    readonly base: OwnerValidatedStateV2<K>
    readonly context: OwnerIntentConstructionContextV2
  }): OwnerIntentDependenciesV2<K> | "pending" | "rejected"
  materialize(input: {
    readonly direction: "undo" | "redo"
    readonly rootOperationId: Id128V2
    readonly base: OwnerValidatedStateV2<K>
    readonly context: OwnerIntentConstructionContextV2
    readonly externalFacts: OwnerExternalFactPortV2<K>
  }): unknown | "pending" | "rejected"
}

export interface OwnerHistoryMaterializationPortV2<K extends DocumentOwnerKindV2>
  extends OwnerHistoryMaterializationDefinitionV2<K> {
  readonly [ownerHistoryMaterializationPortBrandV2]: true
}

export interface OwnerIntentClosureDefinitionV2<K extends DocumentOwnerKindV2> {
  inspectIntent(intent: unknown): InspectedOwnerIntentV2 | "rejected"
  discoverDependencies(input: {
    readonly context: OwnerIntentDependencyContextV2
    readonly intent: unknown
  }): OwnerIntentDependenciesV2<K> | "pending" | "rejected"
  readonly history: OwnerHistoryMaterializationDefinitionV2<K> | null
}

export interface OwnerIntentClosurePortV2<K extends DocumentOwnerKindV2> {
  readonly protocolPort: DocumentOwnerProtocolPortV2<K>
  inspectIntent(intent: unknown): InspectedOwnerIntentV2 | "rejected"
  discoverDependencies(input: {
    readonly context: OwnerIntentDependencyContextV2
    readonly intent: unknown
  }): OwnerIntentDependenciesV2<K> | "pending" | "rejected"
  readonly history: OwnerHistoryMaterializationPortV2<K> | null
  readonly [ownerIntentClosurePortBrandV2]: true
}

export interface DocumentOwnerProtocolDefinitionV2<K extends DocumentOwnerKindV2> {
  readonly owner: K
  readonly schemaDigest: DigestV2
  readonly canonicalizerDescriptor: OwnerCanonicalizerDescriptorV2
  readonly canonicalizerDigest: DigestV2
  decodeIntent(exactJcs: Uint8Array): unknown | "rejected"
  validateBase(document: Y.Doc): OwnerValidatedStateV2<K> | "pending" | "rejected"
  applyIntent(
    candidate: Y.Doc,
    context: OwnerIntentValidationContextV2,
    intent: unknown,
    externalFacts: OwnerExternalFactPortV2<K>,
  ): OwnerApplyResultV2<K> | "pending" | "rejected"
  validatePost(
    base: OwnerValidatedStateV2<K>,
    candidate: Y.Doc,
    result: OwnerApplyResultV2<K>,
  ): OwnerValidatedStateV2<K> | "pending" | "rejected"
  canonicalStateBytes(document: Y.Doc): Uint8Array | "rejected"
  deriveActualWriteEvidence(result: OwnerApplyResultV2<K>): ActualWriteEvidenceV2
}

export interface DocumentOwnerProtocolPortV2<K extends DocumentOwnerKindV2 = DocumentOwnerKindV2>
  extends DocumentOwnerProtocolDefinitionV2<K> {
  readonly [documentOwnerProtocolPortBrandV2]: true
}

export interface SelectedDocumentOwnerArtifactDefinitionV2<K extends DocumentOwnerKindV2> {
  readonly owner: K
  createDefinitions(processValues: OwnerProcessValueFactoryV2<K>): Readonly<{
    protocol: DocumentOwnerProtocolDefinitionV2<K>
    closure: OwnerIntentClosureDefinitionV2<K>
  }>
}

export interface DocumentOwnerRuntimeV2<K extends DocumentOwnerKindV2 = DocumentOwnerKindV2> {
  readonly artifactDigest: DigestV2
  readonly protocolPort: DocumentOwnerProtocolPortV2<K>
  readonly closurePort: OwnerIntentClosurePortV2<K>
  readonly externalFactPortFactory: OwnerExternalFactPortFactoryV2<K>
  readonly [documentOwnerRuntimeBrandV2]: true
}

export interface SelectedDocumentOwnerArtifactFactoryV2<K extends DocumentOwnerKindV2> {
  createRuntime(definition: SelectedDocumentOwnerArtifactDefinitionV2<K>):
    | DocumentOwnerRuntimeV2<K>
    | Readonly<{
        status: "rejected"
        code: "owner-definition-mismatch" | "owner-artifact-mismatch" | "owner-runtime-invalid"
      }>
  readonly [selectedDocumentOwnerArtifactFactoryBrandV2]: true
}

export interface FrameObjectRefV2 {
  readonly scope: DocumentScopeV2
  readonly frameDigest: DigestV2
  readonly actorId: ActorIdV2
  readonly actorSequence: Uint64V2
  readonly operationId: Id128V2
}

export type OrdinarySha256V2 = DigestV2

declare const remoteIngressReservationReceiptBrandV2: unique symbol
declare const completedRemoteUpdateIngressBrandV2: unique symbol
declare const remoteIngressByteCursorBrandV2: unique symbol
declare const fullyValidatedRemoteIngressStagingBrandV2: unique symbol
declare const remoteImmutableIngressObjectReceiptBrandV2: unique symbol
declare const remoteTransferAttemptBindingBrandV2: unique symbol
declare const remoteTransferAttemptBindingFactoryBrandV2: unique symbol
declare const remoteIngressEvidenceAdmissionReceiptBrandV2: unique symbol

export interface StableRemoteTransferKeyV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly sourceMemberId: MemberIdV2
  readonly transferId: Id128V2
}

export type RemoteIngressKindV2 = string
export type RemoteIngressAckAuthorityV2 = string

export interface RemoteIngressEvidenceMissingObjectV2 {
  readonly objectDigest: DigestV2
  readonly byteLength: Uint64V2
}

export interface BeginRemoteIngressEvidenceAdmissionCommandV2 {
  readonly transition: "reserve"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly authenticatedSourceMemberId: MemberIdV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly expectedPriorStableKeyStateRecordDigest: DigestV2 | null
  readonly expectedPriorMemberQuotaRecordDigest: DigestV2 | null
  readonly exactManifestCoreJcs: Readonly<Uint8Array>
  readonly prospectiveClosureRecordExactJcs: Readonly<Uint8Array>
  readonly admissionStartMissingObjects: readonly RemoteIngressEvidenceMissingObjectV2[]
}

export interface SettleRemoteIngressEvidenceAdmissionCommandV2 {
  readonly transition: "settle"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly authenticatedSourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly expectedPriorStableKeyStateRecordDigest: DigestV2
  readonly expectedPriorMemberQuotaRecordDigest: DigestV2
}

export interface AbandonRemoteIngressEvidenceAdmissionCommandV2 {
  readonly transition: "abandon-release"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly authenticatedSourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly expectedPriorStableKeyStateRecordDigest: DigestV2
  readonly expectedPriorMemberQuotaRecordDigest: DigestV2
  readonly abandonmentReason: "authorization-closed" | "caller-cancelled" | "evidence-capacity-exceeded"
}

export interface TransferRemoteIngressEvidenceAdmissionChargeCommandV2 {
  readonly transition: "transfer-release"
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly authenticatedSourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly signedOfferEvidenceClosureObjectDigest: DigestV2
  readonly chargeTransferBindingRecordDigest: DigestV2
  readonly expectedPriorEpochHeadRecordDigest: DigestV2
  readonly expectedPriorStableKeyStateRecordDigest: DigestV2
  readonly expectedPriorMemberQuotaRecordDigest: DigestV2
}

export type AdvanceRemoteIngressEvidenceAdmissionCommandV2 =
  | SettleRemoteIngressEvidenceAdmissionCommandV2
  | AbandonRemoteIngressEvidenceAdmissionCommandV2
  | TransferRemoteIngressEvidenceAdmissionChargeCommandV2

export type RemoteIngressEvidenceAdmissionTransitionV2 =
  | "reserve"
  | "settle"
  | "abandon-release"
  | "transfer-release"

export interface RemoteIngressEvidenceAdmissionTransitionPortEvidenceV2 {
  readonly transition: RemoteIngressEvidenceAdmissionTransitionV2
  readonly idempotent: boolean
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly sourceMemberId: MemberIdV2
  readonly manifestCoreDigest: DigestV2
  readonly prospectiveClosureRecordDigest: DigestV2
  readonly transitionRecordDigest: DigestV2
  readonly epochHeadRecordDigest: DigestV2
  readonly stableKeyStateRecordDigest: DigestV2
  readonly memberQuotaRecordDigest: DigestV2
  readonly stableKeyMonotonicAttemptCount: Uint32V2
  readonly memberMonotonicAttemptCount: Uint32V2
  readonly projectMonotonicAttemptCount: Uint32V2
  readonly stableKeyChargedClosureCount: Uint32V2
  readonly memberChargedClosureCount: Uint32V2
  readonly projectChargedClosureCount: Uint32V2
  readonly memberAccountedAdmissionByteLength: Uint64V2
  readonly projectAccountedAdmissionByteLength: Uint64V2
}

export interface RemoteIngressEvidenceAdmissionReceiptV2 {
  readonly transition: RemoteIngressEvidenceAdmissionTransitionV2
  readonly epochHeadRecordDigest: DigestV2
  readonly stableKeyStateRecordDigest: DigestV2
  readonly memberQuotaRecordDigest: DigestV2
  readonly [remoteIngressEvidenceAdmissionReceiptBrandV2]: true
}

export type RemoteIngressEvidenceAdmissionPortResultV2 =
  | Readonly<{ status: "committed"; evidence: RemoteIngressEvidenceAdmissionTransitionPortEvidenceV2 }>
  | Readonly<{
      status: "rejected"
      code: "head-stale" | "identity-mismatch" | "quota-exceeded" | "transition-invalid" |
        "durability-failed" | "store-corrupt"
    }>

export interface RemoteIngressEvidenceAdmissionPersistencePortV2 {
  begin(command: BeginRemoteIngressEvidenceAdmissionCommandV2): Promise<RemoteIngressEvidenceAdmissionPortResultV2>
  advance(command: AdvanceRemoteIngressEvidenceAdmissionCommandV2): Promise<RemoteIngressEvidenceAdmissionPortResultV2>
  loadCurrentEpochHeadDigest(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
  }): Promise<DigestV2>
}

export type UpdateIngressChunkBytesV2 = "4096" | "8192" | "16384" | "32768" | "65536" | "131072" | "262144"

export interface RemoteIngressQuotaReservationPortEvidenceV2 {
  readonly limitsDigest: DigestV2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly kind: RemoteIngressKindV2
  readonly sourceMemberId: MemberIdV2
  readonly chargedClosureCount: "1"
  readonly accountedAdmissionByteLength: Uint64V2
  readonly resultingProjectChargedClosureCount: Uint32V2
  readonly resultingProjectAccountedAdmissionByteLength: Uint64V2
  readonly resultingSourceMemberChargedClosureCount: Uint32V2
  readonly resultingSourceMemberAccountedAdmissionByteLength: Uint64V2
  readonly admissionEpochHeadRecordDigest: DigestV2
  readonly admissionTransitionRecordDigest: DigestV2
  readonly memberQuotaRecordDigest: DigestV2
}

/**
 * Plain Project/node evidence for the one-time reservation-to-owner charge
 * transfer. The Kernel compares every mirror before minting an install receipt;
 * this structural carrier is deliberately unbranded and grants no authority.
 */
export interface RemoteIngressQuotaTransferPortEvidenceV2<K extends RemoteIngressKindV2> {
  readonly limitsDigest: DigestV2
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly kind: K
  readonly sourceMemberId: MemberIdV2
  readonly chargedClosureCount: "1"
  readonly accountedAdmissionByteLength: Uint64V2
  readonly resultingProjectChargedClosureCount: Uint32V2
  readonly resultingProjectAccountedAdmissionByteLength: Uint64V2
  readonly resultingSourceMemberChargedClosureCount: Uint32V2
  readonly resultingSourceMemberAccountedAdmissionByteLength: Uint64V2
  readonly priorAdmissionEpochHeadRecordDigest: DigestV2
  readonly resultingAdmissionEpochHeadRecordDigest: DigestV2
  readonly chargeTransferBindingRecordDigest: DigestV2
  readonly replacementKind: "owner-install"
  readonly replacementRootRecordDigest: DigestV2
  readonly replacementRootHeadRecordDigest: DigestV2
}

export interface RemoteIngressReservationPortEvidenceV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly reservationRecordDigest: DigestV2
  readonly currentChunkSetHeadRecordDigest: DigestV2
  readonly kind: RemoteIngressKindV2
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly declaredByteLength: Uint64V2
  readonly chunkBytes: UpdateIngressChunkBytesV2
  readonly chunkCount: Uint32V2
  readonly quota: RemoteIngressQuotaReservationPortEvidenceV2
}

export interface RemoteIngressReservationReceiptV2 extends RemoteIngressReservationPortEvidenceV2 {
  readonly [remoteIngressReservationReceiptBrandV2]: true
}

export interface ReserveRemoteIngressRequestV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly kind: RemoteIngressKindV2
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly declaredByteLength: Uint64V2
  readonly accountedAdmissionByteLength: Uint64V2
  readonly chunkBytes: UpdateIngressChunkBytesV2
  readonly chunkCount: Uint32V2
}

export interface RemoteIngressCompletedStagingEvidenceV2 {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly reservationRecordDigest: DigestV2
  readonly finalChunkSetHeadRecordDigest: DigestV2
  readonly durableChunkSetDigest: DigestV2
  readonly kind: RemoteIngressKindV2
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly chunkBytes: UpdateIngressChunkBytesV2
  readonly chunkCount: Uint32V2
  readonly quota: RemoteIngressQuotaReservationPortEvidenceV2
}

export interface CompletedRemoteUpdateIngressV2<K extends RemoteIngressKindV2 = RemoteIngressKindV2> {
  readonly evidence: RemoteIngressCompletedStagingEvidenceV2 & { readonly kind: K }
  openSequentialCursor(): Promise<RemoteIngressByteCursorV2>
  readonly [completedRemoteUpdateIngressBrandV2]: true
}

export type ReserveRemoteIngressPortResultV2 =
  | Readonly<{ status: "reserved"; evidence: RemoteIngressReservationPortEvidenceV2 }>
  | Readonly<{
      status: "rejected"
      code: "manifest-mismatch" | "authorization-closed" | "capacity-exceeded" | "durability-failed" | "store-corrupt"
    }>

export type CompleteRemoteIngressStagingPortResultV2 =
  | Readonly<{ status: "complete"; evidence: RemoteIngressCompletedStagingEvidenceV2 }>
  | Readonly<{
      status: "rejected"
      code: "stale-receipt" | "transfer-incomplete" | "length-mismatch" | "hash-mismatch" | "durability-failed" | "store-corrupt"
    }>

export interface RemoteIngressStagingPersistencePortV2 {
  reserveRemoteIngress(request: ReserveRemoteIngressRequestV2): Promise<ReserveRemoteIngressPortResultV2>
  completeRemoteIngressStaging(reservation: RemoteIngressReservationReceiptV2): Promise<CompleteRemoteIngressStagingPortResultV2>
  openRemoteIngressSequentialCursor(
    evidence: RemoteIngressCompletedStagingEvidenceV2,
  ): Promise<OpenRemoteIngressSequentialCursorPortResultV2>
}

export type RemoteIngressByteCursorReadV2 =
  | Readonly<{
      status: "chunk"
      chunkIndex: Uint32V2
      byteOffset: Uint64V2
      exactByteLength: Uint32V2
      exactChunkSha256: OrdinarySha256V2
      exactChunkBytes: Readonly<Uint8Array>
    }>
  | Readonly<{ status: "complete"; exactByteLength: Uint64V2; ordinarySha256: OrdinarySha256V2 }>

export interface RemoteIngressSequentialCursorPortHandleV2 {
  nextPersistedChunk(): Promise<RemoteIngressByteCursorReadV2>
  closePersistedCursor(): void
}

export type OpenRemoteIngressSequentialCursorPortResultV2 =
  | Readonly<{ status: "opened"; handle: RemoteIngressSequentialCursorPortHandleV2 }>
  | Readonly<{
      status: "rejected"
      code: "staging-not-complete" | "staging-head-stale" | "cursor-already-open" | "store-corrupt"
    }>

export interface RemoteIngressByteCursorV2 {
  next(): Promise<RemoteIngressByteCursorReadV2>
  close(): void
  readonly [remoteIngressByteCursorBrandV2]: true
}

export interface RemoteIngressOwnerValidationEvidenceV2<K extends RemoteIngressKindV2> {
  readonly kind: K
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly protocolDigest: DigestV2
  readonly ownerArtifactDigest: DigestV2
}

export interface FullyValidatedRemoteIngressStagingV2<K extends RemoteIngressKindV2> {
  readonly completed: CompletedRemoteUpdateIngressV2<K>
  readonly ownerArtifactDigest: DigestV2
  readonly [fullyValidatedRemoteIngressStagingBrandV2]: true
}

export interface RemoteImmutableIngressObjectPortEvidenceV2<K extends RemoteIngressKindV2> {
  readonly stableKey: StableRemoteTransferKeyV2
  readonly exactManifestDigest: DigestV2
  readonly signedOfferEvidenceClosureRecordDigest: DigestV2
  readonly reservationRecordDigest: DigestV2
  readonly finalChunkSetHeadRecordDigest: DigestV2
  readonly durableChunkSetDigest: DigestV2
  readonly kind: K
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly ordinarySha256: OrdinarySha256V2
  readonly exactByteLength: Uint64V2
  readonly immutableObjectDigest: DigestV2
  readonly quota: RemoteIngressQuotaReservationPortEvidenceV2
}

export interface RemoteImmutableIngressObjectReceiptV2<K extends RemoteIngressKindV2>
  extends RemoteImmutableIngressObjectPortEvidenceV2<K> {
  readonly [remoteImmutableIngressObjectReceiptBrandV2]: true
}

export type PutImmutableCompletedRemoteIngressPortResultV2<K extends RemoteIngressKindV2> =
  | Readonly<{ status: "durable"; evidence: RemoteImmutableIngressObjectPortEvidenceV2<K> }>
  | Readonly<{
      status: "rejected"
      code: "stale-completed-staging" | "mirror-mismatch" | "durability-failed" | "store-corrupt"
    }>

export interface RemoteIngressImmutableObjectPersistencePortV2 {
  putImmutableCompletedRemoteIngress<K extends RemoteIngressKindV2>(
    validated: FullyValidatedRemoteIngressStagingV2<K>,
  ): Promise<PutImmutableCompletedRemoteIngressPortResultV2<K>>
}

export interface RemoteTransferAttemptBindingV2<K extends RemoteIngressKindV2> {
  readonly kind: K
  readonly stableKey: StableRemoteTransferKeyV2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly sourceMemberId: MemberIdV2
  readonly exactManifestDigest: DigestV2
  readonly subjectDigest: DigestV2
  readonly [remoteTransferAttemptBindingBrandV2]: true
}

export interface RemoteTransferAttemptBindingFactoryV2 {
  bind<K extends RemoteIngressKindV2>(input: {
    readonly kind: K
    readonly stableKey: StableRemoteTransferKeyV2
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly sourceMemberId: MemberIdV2
    readonly exactManifestDigest: DigestV2
    readonly subjectDigest: DigestV2
  }): RemoteTransferAttemptBindingV2<K>
  readonly [remoteTransferAttemptBindingFactoryBrandV2]: true
}

export interface ReplicaCheckpointCoreV2 {
  readonly format: "convax.replica-checkpoint-core/2"
  readonly scope: DocumentScopeV2
  readonly checkpointId: Id128V2
  readonly authorMemberId: MemberIdV2
  readonly authorReplicaId: ReplicaIdV2
  readonly authorActorId: ActorIdV2
  readonly authorAuthorizationDigest: DigestV2
  readonly directParentCheckpointDigests: readonly DigestV2[]
  readonly baseFrontierDigest: DigestV2
  readonly computedFrontierDigest: DigestV2
  readonly actorHeadBoundaryDigest: DigestV2
  readonly stateVectorDigest: DigestV2
  readonly canonicalStateDigest: DigestV2
  readonly fullUpdateDigest: DigestV2
  readonly fullUpdateByteLength: Uint64V2
  readonly protocolDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly canonicalizerDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
}

export interface ReplicaCheckpointV2 {
  readonly format: "convax.replica-checkpoint/2"
  readonly core: ReplicaCheckpointCoreV2
  readonly coreDigest: DigestV2
  readonly replicaSignature: SignatureV2
}

export interface CheckpointContentCertificateCoreV2 {
  readonly format: "convax.checkpoint-content-certificate-core/2"
  readonly scope: DocumentScopeV2
  readonly checkpointDigest: DigestV2
  readonly parentCertificateDigests: readonly DigestV2[]
  readonly computedFrontierDigest: DigestV2
  readonly actorHeadBoundaryDigest: DigestV2
  readonly stateVectorDigest: DigestV2
  readonly canonicalStateDigest: DigestV2
  readonly fullUpdateDigest: DigestV2
  readonly protocolDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly canonicalizerDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly contentStatus: "service-validated-causal-closure"
  readonly serviceKeyPurpose: "content-attestation"
  readonly serviceKeyId: string
}

export interface CheckpointContentCertificateV2 {
  readonly format: "convax.checkpoint-content-certificate/2"
  readonly core: CheckpointContentCertificateCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export interface StableCheckpointSetCoreV2 {
  readonly format: "convax.stable-checkpoint-set-core/2"
  readonly scope: DocumentScopeV2
  readonly priorSetDigest: DigestV2 | null
  readonly contentCertificateDigests: readonly DigestV2[]
  readonly mergedFrontierDigest: DigestV2
  readonly actorHeadBoundaryDigest: DigestV2
  readonly membershipSnapshotDigest: DigestV2
  readonly protocolDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
}

export interface ReplicaCausalFloorAckCoreV2 {
  readonly format: "convax.replica-causal-floor-ack-core/2"
  readonly stableSetCoreDigest: DigestV2
  readonly replicaId: ReplicaIdV2
  readonly actorId: ActorIdV2
  readonly replicaActorCredentialDigest: DigestV2
  readonly actorHeadAtAck: CausalHeadRefV2 | null
  readonly durableCheckpoint: true
  readonly validatedExactClosure: true
  readonly installedMonotonicFloor: true
}

export interface ReplicaCausalFloorAckV2 {
  readonly format: "convax.replica-causal-floor-ack/2"
  readonly core: ReplicaCausalFloorAckCoreV2
  readonly coreDigest: DigestV2
  readonly replicaSignature: SignatureV2
}

export interface PrunableCheckpointSetCertificateCoreV2 {
  readonly format: "convax.prunable-checkpoint-set-certificate-core/2"
  readonly stableSetCore: StableCheckpointSetCoreV2
  readonly floorAckDigests: readonly DigestV2[]
  readonly contentStatus: "service-validated-and-all-editors-acknowledged"
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "checkpoint-stability"
  readonly serviceKeyId: string
}

export interface PrunableCheckpointSetCertificateV2 {
  readonly format: "convax.prunable-checkpoint-set-certificate/2"
  readonly core: PrunableCheckpointSetCertificateCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}
