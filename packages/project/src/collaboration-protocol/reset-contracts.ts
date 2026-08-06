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

export type DocumentShardResetReason =
  | "incompatible-canvas-schema"
  | "document-lamport-exhaustion"
  | "unrecoverable-certified-history-corruption"

export type CanvasDocumentScope = DocumentScope & {
  readonly docKind: "canvas"
  readonly docId: CanvasId
}

export type ProjectIndexDocumentScope = DocumentScope & {
  readonly docKind: "project-index"
  readonly docId: "project-index"
}

export interface DocumentShardResetRouteCasCore {
  readonly format: "convax.document-shard-reset-route-cas-core"
  readonly operationId: Id128
  readonly canvasId: CanvasId
  readonly oldScope: CanvasDocumentScope
  readonly newScope: CanvasDocumentScope
  readonly predecessorActivationDigest: Digest
  readonly stagedGenesisCheckpointObjectDigest: Digest
  readonly stagedGenesisFullUpdateDigest: Digest
  readonly stagedGenesisStateVectorDigest: Digest
}

export interface DocumentShardResetClaimCore {
  readonly format: "convax.document-shard-reset-claim-core"
  readonly projectIndexScope: ProjectIndexDocumentScope
  readonly oldScope: CanvasDocumentScope
  readonly newScope: CanvasDocumentScope
  readonly reason: DocumentShardResetReason
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

export interface DocumentShardResetClaim {
  readonly format: "convax.document-shard-reset-claim"
  readonly core: DocumentShardResetClaimCore
  readonly coreDigest: Digest
  readonly initiatorSignature: Signature
  readonly adminApprovalDigest: Digest
}

export interface DocumentShardResetConfirmationCore {
  readonly format: "convax.document-shard-reset-confirmation-core"
  readonly confirmationId: Id128
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly oldScope: CanvasDocumentScope
  readonly newScope: CanvasDocumentScope
  readonly reason: DocumentShardResetReason
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

export interface DocumentShardResetConfirmation {
  readonly format: "convax.document-shard-reset-confirmation"
  readonly core: DocumentShardResetConfirmationCore
  readonly coreDigest: Digest
  readonly initiatorReplicaSignature: Signature
}

export interface DocumentShardResetApprovalCore {
  readonly format: "convax.document-shard-reset-approval-core"
  readonly approvalId: Id128
  readonly resetClaimCoreDigest: Digest
  readonly confirmationCoreDigest: Digest
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly oldScope: CanvasDocumentScope
  readonly newScope: CanvasDocumentScope
  readonly reason: DocumentShardResetReason
  readonly routeCasCoreDigest: Digest
  readonly adminMemberId: MemberId
  readonly adminMemberAuthorizationEpoch: Id128
  readonly adminCapabilityCoreDigest: Digest
  readonly approvalStatement: "approve-exact-canvas-shard-reset"
  readonly protocolDigest: Digest
}

export interface DocumentShardResetApproval {
  readonly format: "convax.document-shard-reset-approval"
  readonly core: DocumentShardResetApprovalCore
  readonly coreDigest: Digest
  readonly adminMemberSignature: Signature
}
