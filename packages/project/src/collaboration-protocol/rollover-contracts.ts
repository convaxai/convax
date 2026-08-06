import type {
  Digest,
  DocumentScope,
  Id128,
  MemberId,
  ProjectId,
  Signature,
  Uint64,
} from "@convax/collaboration"
import type { ProjectResetReasonV2 } from "./project-reset"

export interface ProjectResetApprovalCoreV2 {
  readonly format: "convax.project-reset-approval-core/2"
  readonly resetId: Id128
  readonly approvalId: Id128
  readonly confirmationCoreDigest: Digest
  readonly projectId: ProjectId
  readonly oldProjectEpoch: Id128
  readonly reason: ProjectResetReasonV2
  readonly observedOldPrivateTreeDigest: Digest
  readonly unsupportedInventoryDigest: Digest
  readonly privateDeletionSetDigest: Digest
  readonly requestedProtocolDigest: Digest
  readonly requestedSchemaDigest: Digest
  readonly requestedUriProtocolDigest: Digest
  readonly adminMemberId: MemberId
  readonly adminMemberAuthorizationEpoch: Id128
  readonly adminCapabilityCoreDigest: Digest
  readonly approvalStatement: "approve-exact-team-project-reset"
  readonly protocolDigest: Digest
}

export interface ProjectResetApprovalV2 {
  readonly format: "convax.project-reset-approval/2"
  readonly core: ProjectResetApprovalCoreV2
  readonly coreDigest: Digest
  readonly adminMemberSignature: Signature
}

export interface TeamEpochRolloverChallengeCoreV2 {
  readonly format: "convax.team-epoch-rollover-challenge-core/2"
  readonly challengeId: Id128
  readonly resetId: Id128
  readonly projectId: ProjectId
  readonly oldProjectEpoch: Id128
  readonly expectedProjectResetCounter: Uint64
  readonly projectResetConfirmationCoreDigest: Digest
  readonly projectResetApprovalCoreDigest: Digest
  readonly observedOldMembershipSnapshotDigest: Digest
  readonly observedOldRegistryRootDigest: Digest
  readonly observedOldPrivateTreeDigest: Digest
  readonly newProjectEpoch: Id128
  readonly newMembershipEpoch: Id128
  readonly newProjectIndexShardEpoch: Id128
  readonly preparedNewMembershipSnapshotCoreDigest: Digest
  readonly serverNonce: Id128
  readonly issuedAtUnixMs: Uint64
  readonly expiresAtUnixMs: Uint64
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface TeamEpochRolloverChallengeV2 {
  readonly format: "convax.team-epoch-rollover-challenge/2"
  readonly core: TeamEpochRolloverChallengeCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface TeamEpochRolloverProofCoreV2 {
  readonly format: "convax.team-epoch-rollover-proof-core/2"
  readonly challengeDigest: Digest
  readonly resetId: Id128
  readonly projectId: ProjectId
  readonly oldProjectEpoch: Id128
  readonly newProjectEpoch: Id128
  readonly newMembershipEpoch: Id128
  readonly newProjectIndexShardEpoch: Id128
  readonly expectedProjectResetCounter: Uint64
  readonly projectResetConfirmationCoreDigest: Digest
  readonly projectResetApprovalCoreDigest: Digest
  readonly serverNonce: Id128
  readonly requesterMemberId: MemberId
  readonly requesterMemberAuthorizationEpoch: Id128
  readonly requesterAdminCapabilityCoreDigest: Digest
  readonly stagedEmptyProjectIndexCheckpointDigest: Digest
  readonly stagedEmptyProjectIndexFullUpdateDigest: Digest
  readonly stagedEmptyProjectIndexStateVectorDigest: Digest
  readonly stagedEmptyProjectIndexCanonicalStateDigest: Digest
  readonly protocolDigest: Digest
  readonly schemaDigest: Digest
  readonly uriProtocolDigest: Digest
}

export interface TeamEpochRolloverProofV2 {
  readonly format: "convax.team-epoch-rollover-proof/2"
  readonly core: TeamEpochRolloverProofCoreV2
  readonly requestDigest: Digest
  readonly requesterAdminMemberSignature: Signature
}

export interface EmptyProjectIndexGenesisAttestationCoreV2 {
  readonly format: "convax.empty-project-index-genesis-attestation-core/2"
  readonly projectId: ProjectId
  readonly newProjectEpoch: Id128
  readonly newMembershipEpoch: Id128
  readonly newProjectIndexScope: DocumentScope
  readonly teamEpochRolloverProofCoreDigest: Digest
  readonly checkpointDigest: Digest
  readonly fullUpdateDigest: Digest
  readonly stateVectorDigest: Digest
  readonly canonicalStateDigest: Digest
  readonly emptyCatalog: true
  readonly protocolDigest: Digest
  readonly schemaDigest: Digest
  readonly uriProtocolDigest: Digest
  readonly validationArtifactSetDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "content-attestation"
  readonly serviceKeyId: string
}

export interface EmptyProjectIndexGenesisAttestationV2 {
  readonly format: "convax.empty-project-index-genesis-attestation/2"
  readonly core: EmptyProjectIndexGenesisAttestationCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface TeamEpochRolloverReceiptCoreV2 {
  readonly format: "convax.team-epoch-rollover-receipt-core/2"
  readonly resetId: Id128
  readonly requestDigest: Digest
  readonly projectId: ProjectId
  readonly oldProjectEpoch: Id128
  readonly newProjectEpoch: Id128
  readonly newMembershipEpoch: Id128
  readonly newProjectIndexShardEpoch: Id128
  readonly projectResetConfirmationCoreDigest: Digest
  readonly projectResetApprovalCoreDigest: Digest
  readonly newMembershipSnapshotDigest: Digest
  readonly newRequesterMemberCredentialCoreDigest: Digest
  readonly newRequesterAdminCapabilityCoreDigest: Digest
  readonly newProjectIndexScope: DocumentScope
  readonly emptyProjectIndexGenesisAttestationCoreDigest: Digest
  readonly emptyProjectIndexCheckpointDigest: Digest
  readonly emptyProjectIndexFullUpdateDigest: Digest
  readonly emptyProjectIndexStateVectorDigest: Digest
  readonly emptyProjectIndexCanonicalStateDigest: Digest
  readonly closedSessionCredentialDigests: readonly Digest[]
  readonly retiredOldEpochState: "permanently-fenced-recovery-only"
  readonly committedProjectResetCounter: Uint64
  readonly protocolDigest: Digest
  readonly schemaDigest: Digest
  readonly uriProtocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface TeamEpochRolloverReceiptV2 {
  readonly format: "convax.team-epoch-rollover-receipt/2"
  readonly core: TeamEpochRolloverReceiptCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}
