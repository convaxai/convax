import type {
  DigestV2,
  DocumentScopeV2,
  Id128V2,
  MemberIdV2,
  ProjectIdV2,
  SignatureV2,
  Uint64V2,
} from "@convax/collaboration"
import type { ProjectResetReasonV2 } from "./project-reset"

export interface ProjectResetApprovalCoreV2 {
  readonly format: "convax.project-reset-approval-core/2"
  readonly resetId: Id128V2
  readonly approvalId: Id128V2
  readonly confirmationCoreDigest: DigestV2
  readonly projectId: ProjectIdV2
  readonly oldProjectEpoch: Id128V2
  readonly reason: ProjectResetReasonV2
  readonly observedOldPrivateTreeDigest: DigestV2
  readonly unsupportedInventoryDigest: DigestV2
  readonly privateDeletionSetDigest: DigestV2
  readonly requestedProtocolDigest: DigestV2
  readonly requestedSchemaDigest: DigestV2
  readonly requestedUriProtocolDigest: DigestV2
  readonly adminMemberId: MemberIdV2
  readonly adminMemberAuthorizationEpoch: Id128V2
  readonly adminCapabilityCoreDigest: DigestV2
  readonly approvalStatement: "approve-exact-team-project-reset"
  readonly protocolDigest: DigestV2
}

export interface ProjectResetApprovalV2 {
  readonly format: "convax.project-reset-approval/2"
  readonly core: ProjectResetApprovalCoreV2
  readonly coreDigest: DigestV2
  readonly adminMemberSignature: SignatureV2
}

export interface TeamEpochRolloverChallengeCoreV2 {
  readonly format: "convax.team-epoch-rollover-challenge-core/2"
  readonly challengeId: Id128V2
  readonly resetId: Id128V2
  readonly projectId: ProjectIdV2
  readonly oldProjectEpoch: Id128V2
  readonly expectedProjectResetCounter: Uint64V2
  readonly projectResetConfirmationCoreDigest: DigestV2
  readonly projectResetApprovalCoreDigest: DigestV2
  readonly observedOldMembershipSnapshotDigest: DigestV2
  readonly observedOldRegistryRootDigest: DigestV2
  readonly observedOldPrivateTreeDigest: DigestV2
  readonly newProjectEpoch: Id128V2
  readonly newMembershipEpoch: Id128V2
  readonly newProjectIndexShardEpoch: Id128V2
  readonly preparedNewMembershipSnapshotCoreDigest: DigestV2
  readonly serverNonce: Id128V2
  readonly issuedAtUnixMs: Uint64V2
  readonly expiresAtUnixMs: Uint64V2
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface TeamEpochRolloverChallengeV2 {
  readonly format: "convax.team-epoch-rollover-challenge/2"
  readonly core: TeamEpochRolloverChallengeCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export interface TeamEpochRolloverProofCoreV2 {
  readonly format: "convax.team-epoch-rollover-proof-core/2"
  readonly challengeDigest: DigestV2
  readonly resetId: Id128V2
  readonly projectId: ProjectIdV2
  readonly oldProjectEpoch: Id128V2
  readonly newProjectEpoch: Id128V2
  readonly newMembershipEpoch: Id128V2
  readonly newProjectIndexShardEpoch: Id128V2
  readonly expectedProjectResetCounter: Uint64V2
  readonly projectResetConfirmationCoreDigest: DigestV2
  readonly projectResetApprovalCoreDigest: DigestV2
  readonly serverNonce: Id128V2
  readonly requesterMemberId: MemberIdV2
  readonly requesterMemberAuthorizationEpoch: Id128V2
  readonly requesterAdminCapabilityCoreDigest: DigestV2
  readonly stagedEmptyProjectIndexCheckpointDigest: DigestV2
  readonly stagedEmptyProjectIndexFullUpdateDigest: DigestV2
  readonly stagedEmptyProjectIndexStateVectorDigest: DigestV2
  readonly stagedEmptyProjectIndexCanonicalStateDigest: DigestV2
  readonly protocolDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly uriProtocolDigest: DigestV2
}

export interface TeamEpochRolloverProofV2 {
  readonly format: "convax.team-epoch-rollover-proof/2"
  readonly core: TeamEpochRolloverProofCoreV2
  readonly requestDigest: DigestV2
  readonly requesterAdminMemberSignature: SignatureV2
}

export interface EmptyProjectIndexGenesisAttestationCoreV2 {
  readonly format: "convax.empty-project-index-genesis-attestation-core/2"
  readonly projectId: ProjectIdV2
  readonly newProjectEpoch: Id128V2
  readonly newMembershipEpoch: Id128V2
  readonly newProjectIndexScope: DocumentScopeV2
  readonly teamEpochRolloverProofCoreDigest: DigestV2
  readonly checkpointDigest: DigestV2
  readonly fullUpdateDigest: DigestV2
  readonly stateVectorDigest: DigestV2
  readonly canonicalStateDigest: DigestV2
  readonly emptyCatalog: true
  readonly protocolDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly uriProtocolDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "content-attestation"
  readonly serviceKeyId: string
}

export interface EmptyProjectIndexGenesisAttestationV2 {
  readonly format: "convax.empty-project-index-genesis-attestation/2"
  readonly core: EmptyProjectIndexGenesisAttestationCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export interface TeamEpochRolloverReceiptCoreV2 {
  readonly format: "convax.team-epoch-rollover-receipt-core/2"
  readonly resetId: Id128V2
  readonly requestDigest: DigestV2
  readonly projectId: ProjectIdV2
  readonly oldProjectEpoch: Id128V2
  readonly newProjectEpoch: Id128V2
  readonly newMembershipEpoch: Id128V2
  readonly newProjectIndexShardEpoch: Id128V2
  readonly projectResetConfirmationCoreDigest: DigestV2
  readonly projectResetApprovalCoreDigest: DigestV2
  readonly newMembershipSnapshotDigest: DigestV2
  readonly newRequesterMemberCredentialCoreDigest: DigestV2
  readonly newRequesterAdminCapabilityCoreDigest: DigestV2
  readonly newProjectIndexScope: DocumentScopeV2
  readonly emptyProjectIndexGenesisAttestationCoreDigest: DigestV2
  readonly emptyProjectIndexCheckpointDigest: DigestV2
  readonly emptyProjectIndexFullUpdateDigest: DigestV2
  readonly emptyProjectIndexStateVectorDigest: DigestV2
  readonly emptyProjectIndexCanonicalStateDigest: DigestV2
  readonly closedSessionCredentialDigests: readonly DigestV2[]
  readonly retiredOldEpochState: "permanently-fenced-recovery-only"
  readonly committedProjectResetCounter: Uint64V2
  readonly protocolDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly uriProtocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface TeamEpochRolloverReceiptV2 {
  readonly format: "convax.team-epoch-rollover-receipt/2"
  readonly core: TeamEpochRolloverReceiptCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}
