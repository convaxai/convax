import type {
  ActorIdV2,
  CanvasIdV2,
  DigestV2,
  DocumentScopeV2,
  Id128V2,
  MemberIdV2,
  ProjectIdV2,
  ReplicaIdV2,
  SignatureV2,
} from "@convax/collaboration"

export type DocumentShardResetReasonV2 =
  | "incompatible-canvas-schema"
  | "document-lamport-exhaustion"
  | "unrecoverable-certified-history-corruption"

export type CanvasDocumentScopeV2 = DocumentScopeV2 & {
  readonly docKind: "canvas"
  readonly docId: CanvasIdV2
}

export type ProjectIndexDocumentScopeV2 = DocumentScopeV2 & {
  readonly docKind: "project-index"
  readonly docId: "project-index"
}

export interface DocumentShardResetRouteCasCoreV2 {
  readonly format: "convax.document-shard-reset-route-cas-core/2"
  readonly operationId: Id128V2
  readonly canvasId: CanvasIdV2
  readonly oldScope: CanvasDocumentScopeV2
  readonly newScope: CanvasDocumentScopeV2
  readonly predecessorActivationDigest: DigestV2
  readonly stagedGenesisCheckpointObjectDigest: DigestV2
  readonly stagedGenesisFullUpdateDigest: DigestV2
  readonly stagedGenesisStateVectorDigest: DigestV2
}

export interface DocumentShardResetClaimCoreV2 {
  readonly format: "convax.document-shard-reset-claim-core/2"
  readonly projectIndexScope: ProjectIndexDocumentScopeV2
  readonly oldScope: CanvasDocumentScopeV2
  readonly newScope: CanvasDocumentScopeV2
  readonly reason: DocumentShardResetReasonV2
  readonly oldProtocolDigest: DigestV2
  readonly newProtocolDigest: DigestV2
  readonly oldSchemaDigest: DigestV2
  readonly newSchemaDigest: DigestV2
  readonly stagedGenesisCheckpointObjectDigest: DigestV2
  readonly stagedGenesisFullUpdateDigest: DigestV2
  readonly stagedGenesisStateVectorDigest: DigestV2
  readonly routeCasCoreDigest: DigestV2
  readonly initiatorMemberId: MemberIdV2
  readonly initiatorReplicaId: ReplicaIdV2
  readonly initiatorActorId: ActorIdV2
  readonly adminMemberId: MemberIdV2
  readonly adminAuthorizationDigest: DigestV2
  readonly explicitConfirmationReceiptDigest: DigestV2
}

export interface DocumentShardResetClaimV2 {
  readonly format: "convax.document-shard-reset-claim/2"
  readonly core: DocumentShardResetClaimCoreV2
  readonly coreDigest: DigestV2
  readonly initiatorSignature: SignatureV2
  readonly adminApprovalDigest: DigestV2
}

export interface DocumentShardResetConfirmationCoreV2 {
  readonly format: "convax.document-shard-reset-confirmation-core/2"
  readonly confirmationId: Id128V2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly oldScope: CanvasDocumentScopeV2
  readonly newScope: CanvasDocumentScopeV2
  readonly reason: DocumentShardResetReasonV2
  readonly routeCasCoreDigest: DigestV2
  readonly predecessorActivationDigest: DigestV2
  readonly stagedGenesisCheckpointObjectDigest: DigestV2
  readonly stagedGenesisFullUpdateDigest: DigestV2
  readonly stagedGenesisStateVectorDigest: DigestV2
  readonly initiatorMemberId: MemberIdV2
  readonly initiatorReplicaId: ReplicaIdV2
  readonly initiatorActorId: ActorIdV2
  readonly initiatorActorCredentialCoreDigest: DigestV2
  readonly confirmationStatement: "replace-one-canvas-shard-and-retain-old-recovery-bytes"
  readonly protocolDigest: DigestV2
}

export interface DocumentShardResetConfirmationV2 {
  readonly format: "convax.document-shard-reset-confirmation/2"
  readonly core: DocumentShardResetConfirmationCoreV2
  readonly coreDigest: DigestV2
  readonly initiatorReplicaSignature: SignatureV2
}

export interface DocumentShardResetApprovalCoreV2 {
  readonly format: "convax.document-shard-reset-approval-core/2"
  readonly approvalId: Id128V2
  readonly resetClaimCoreDigest: DigestV2
  readonly confirmationCoreDigest: DigestV2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly oldScope: CanvasDocumentScopeV2
  readonly newScope: CanvasDocumentScopeV2
  readonly reason: DocumentShardResetReasonV2
  readonly routeCasCoreDigest: DigestV2
  readonly adminMemberId: MemberIdV2
  readonly adminMemberAuthorizationEpoch: Id128V2
  readonly adminCapabilityCoreDigest: DigestV2
  readonly approvalStatement: "approve-exact-canvas-shard-reset"
  readonly protocolDigest: DigestV2
}

export interface DocumentShardResetApprovalV2 {
  readonly format: "convax.document-shard-reset-approval/2"
  readonly core: DocumentShardResetApprovalCoreV2
  readonly coreDigest: DigestV2
  readonly adminMemberSignature: SignatureV2
}
