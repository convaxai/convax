import type {
  ActorId,
  CanvasId,
  Digest,
  DocumentScope,
  Id128,
  MemberId,
  ProjectId,
  ReplicaId,
  Signature,
} from "@convax/collaboration"

export type DocumentShardResetReasonV2 =
  | "incompatible-canvas-schema"
  | "document-lamport-exhaustion"
  | "unrecoverable-certified-history-corruption"

export type CanvasDocumentScopeV2 = DocumentScope & {
  readonly docKind: "canvas"
  readonly docId: CanvasId
}

export type ProjectIndexDocumentScopeV2 = DocumentScope & {
  readonly docKind: "project-index"
  readonly docId: "project-index"
}

export interface DocumentShardResetRouteCasCoreV2 {
  readonly format: "convax.document-shard-reset-route-cas-core/2"
  readonly operationId: Id128
  readonly canvasId: CanvasId
  readonly oldScope: CanvasDocumentScopeV2
  readonly newScope: CanvasDocumentScopeV2
  readonly predecessorActivationDigest: Digest
  readonly stagedGenesisCheckpointObjectDigest: Digest
  readonly stagedGenesisFullUpdateDigest: Digest
  readonly stagedGenesisStateVectorDigest: Digest
}

export interface DocumentShardResetClaimCoreV2 {
  readonly format: "convax.document-shard-reset-claim-core/2"
  readonly projectIndexScope: ProjectIndexDocumentScopeV2
  readonly oldScope: CanvasDocumentScopeV2
  readonly newScope: CanvasDocumentScopeV2
  readonly reason: DocumentShardResetReasonV2
  readonly oldProtocolDigest: Digest
  readonly newProtocolDigest: Digest
  readonly oldSchemaDigest: Digest
  readonly newSchemaDigest: Digest
  readonly stagedGenesisCheckpointObjectDigest: Digest
  readonly stagedGenesisFullUpdateDigest: Digest
  readonly stagedGenesisStateVectorDigest: Digest
  readonly routeCasCoreDigest: Digest
  readonly initiatorMemberId: MemberId
  readonly initiatorReplicaId: ReplicaId
  readonly initiatorActorId: ActorId
  readonly adminMemberId: MemberId
  readonly adminAuthorizationDigest: Digest
  readonly explicitConfirmationReceiptDigest: Digest
}

export interface DocumentShardResetClaimV2 {
  readonly format: "convax.document-shard-reset-claim/2"
  readonly core: DocumentShardResetClaimCoreV2
  readonly coreDigest: Digest
  readonly initiatorSignature: Signature
  readonly adminApprovalDigest: Digest
}

export interface DocumentShardResetConfirmationCoreV2 {
  readonly format: "convax.document-shard-reset-confirmation-core/2"
  readonly confirmationId: Id128
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly oldScope: CanvasDocumentScopeV2
  readonly newScope: CanvasDocumentScopeV2
  readonly reason: DocumentShardResetReasonV2
  readonly routeCasCoreDigest: Digest
  readonly predecessorActivationDigest: Digest
  readonly stagedGenesisCheckpointObjectDigest: Digest
  readonly stagedGenesisFullUpdateDigest: Digest
  readonly stagedGenesisStateVectorDigest: Digest
  readonly initiatorMemberId: MemberId
  readonly initiatorReplicaId: ReplicaId
  readonly initiatorActorId: ActorId
  readonly initiatorActorCredentialCoreDigest: Digest
  readonly confirmationStatement: "replace-one-canvas-shard-and-retain-old-recovery-bytes"
  readonly protocolDigest: Digest
}

export interface DocumentShardResetConfirmationV2 {
  readonly format: "convax.document-shard-reset-confirmation/2"
  readonly core: DocumentShardResetConfirmationCoreV2
  readonly coreDigest: Digest
  readonly initiatorReplicaSignature: Signature
}

export interface DocumentShardResetApprovalCoreV2 {
  readonly format: "convax.document-shard-reset-approval-core/2"
  readonly approvalId: Id128
  readonly resetClaimCoreDigest: Digest
  readonly confirmationCoreDigest: Digest
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly oldScope: CanvasDocumentScopeV2
  readonly newScope: CanvasDocumentScopeV2
  readonly reason: DocumentShardResetReasonV2
  readonly routeCasCoreDigest: Digest
  readonly adminMemberId: MemberId
  readonly adminMemberAuthorizationEpoch: Id128
  readonly adminCapabilityCoreDigest: Digest
  readonly approvalStatement: "approve-exact-canvas-shard-reset"
  readonly protocolDigest: Digest
}

export interface DocumentShardResetApprovalV2 {
  readonly format: "convax.document-shard-reset-approval/2"
  readonly core: DocumentShardResetApprovalCoreV2
  readonly coreDigest: Digest
  readonly adminMemberSignature: Signature
}
