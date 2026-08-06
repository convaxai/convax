import type {
  Digest,
  DocumentScope,
  Id128,
  MemberId,
  ProjectId,
  Signature,
  Uint64,
} from "@convax/collaboration"
import type { ProjectResetReason } from "./project-reset"

export interface ProjectResetApprovalCore {
  readonly format: "convax.project-reset-approval-core"
  readonly resetId: Id128
  readonly approvalId: Id128
  readonly confirmationCoreDigest: Digest
  readonly projectId: ProjectId
  readonly oldProjectEpoch: Id128
  readonly reason: ProjectResetReason
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

export interface ProjectResetApproval {
  readonly format: "convax.project-reset-approval"
  readonly core: ProjectResetApprovalCore
  readonly coreDigest: Digest
  readonly adminMemberSignature: Signature
}

export interface TeamEpochRolloverChallengeCore {
  readonly format: "convax.team-epoch-rollover-challenge-core"
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

export interface TeamEpochRolloverChallenge {
  readonly format: "convax.team-epoch-rollover-challenge"
  readonly core: TeamEpochRolloverChallengeCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface TeamEpochRolloverProofCore {
  readonly format: "convax.team-epoch-rollover-proof-core"
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

export interface TeamEpochRolloverProof {
  readonly format: "convax.team-epoch-rollover-proof"
  readonly core: TeamEpochRolloverProofCore
  readonly requestDigest: Digest
  readonly requesterAdminMemberSignature: Signature
}

export interface EmptyProjectIndexGenesisAttestationCore {
  readonly format: "convax.empty-project-index-genesis-attestation-core"
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

export interface EmptyProjectIndexGenesisAttestation {
  readonly format: "convax.empty-project-index-genesis-attestation"
  readonly core: EmptyProjectIndexGenesisAttestationCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface TeamEpochRolloverReceiptCore {
  readonly format: "convax.team-epoch-rollover-receipt-core"
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

export interface TeamEpochRolloverReceipt {
  readonly format: "convax.team-epoch-rollover-receipt"
  readonly core: TeamEpochRolloverReceiptCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}
