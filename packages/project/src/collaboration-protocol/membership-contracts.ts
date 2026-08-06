import type {
  ActorId,
  Digest,
  Id128,
  MemberId,
  ProjectId,
  PublicKey,
  ReplicaId,
  Signature,
  Uint64,
} from "@convax/collaboration"

import type { CollaborationRoleV2 } from "./control-contracts"

export type MembershipMemberStateV2 = "active" | "revoked"
export type MembershipReplicaStateV2 = "active" | "revoked" | "replaced"
export type MembershipReplicaEditStateV2 = "none" | "pending-editor" | "active-editor"
export type ReplicaIdReservationPurposeV2 = "replica-enroll" | "replica-rotate"
export type MutationPurposeV2 =
  | "member-add"
  | "replica-enroll"
  | "replica-activate-editor"
  | "replica-rotate"
  | "replica-revoke"
  | "member-role-change"
  | "member-revoke"

export interface MembershipMemberV2 {
  readonly memberId: MemberId
  readonly memberSigningPublicKey: PublicKey
  readonly role: CollaborationRoleV2
  readonly state: MembershipMemberStateV2
  readonly memberAuthorizationEpoch: Id128
  readonly memberMutationCounter: Uint64
}

export interface MembershipReplicaV2 {
  readonly replicaId: ReplicaId
  readonly replicaIdReservationReceiptDigest: Digest
  readonly memberId: MemberId
  readonly actorId: ActorId
  readonly replicaSigningPublicKey: PublicKey
  readonly state: MembershipReplicaStateV2
  readonly editState: MembershipReplicaEditStateV2
  readonly replicaAuthorizationEpoch: Id128
  readonly enrolledAtMembershipSequence: Uint64
  readonly revokedAtMembershipSequence: Uint64 | null
  readonly replacesReplicaId: ReplicaId | null
}

export interface MembershipSnapshotCoreV2 {
  readonly format: "convax.membership-snapshot-core/2"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly membershipSequence: Uint64
  readonly registrySequence: Uint64
  readonly registryRootDigest: Digest
  readonly members: readonly MembershipMemberV2[]
  readonly replicas: readonly MembershipReplicaV2[]
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface MembershipSnapshotV2 {
  readonly format: "convax.membership-snapshot/2"
  readonly core: MembershipSnapshotCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface MemberCredentialCoreV2 {
  readonly format: "convax.member-credential-core/2"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly membershipSnapshotDigest: Digest
  readonly memberId: MemberId
  readonly memberSigningPublicKey: PublicKey
  readonly role: CollaborationRoleV2
  readonly memberAuthorizationEpoch: Id128
  readonly adminCapabilityDigest: Digest | null
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface MemberCredentialV2 {
  readonly format: "convax.member-credential/2"
  readonly core: MemberCredentialCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface ProjectAdminCapabilityCoreV2 {
  readonly format: "convax.project-admin-capability-core/2"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly membershipSnapshotDigest: Digest
  readonly adminMemberId: MemberId
  readonly adminMemberAuthorizationEpoch: Id128
  readonly grants: readonly ["membership-admin"]
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface ProjectAdminCapabilityV2 {
  readonly format: "convax.project-admin-capability/2"
  readonly core: ProjectAdminCapabilityCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface ReplicaIdReservationRequestCoreV2 {
  readonly format: "convax.replica-id-reservation-request-core/2"
  readonly allocationRequestId: Id128
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly purpose: ReplicaIdReservationPurposeV2
  readonly expectedMembershipSequence: Uint64
  readonly requesterMemberId: MemberId
  readonly targetMemberId: MemberId
  readonly expectedTargetMemberMutationCounter: Uint64
  readonly requesterCredentialDigest: Digest
  readonly currentReplicaId: ReplicaId | null
  readonly newReplicaSigningPublicKey: PublicKey
  readonly requestedEditState: "none" | "pending-editor"
  readonly protocolDigest: Digest
}

export interface ReplicaIdReservationRequestV2 {
  readonly format: "convax.replica-id-reservation-request/2"
  readonly core: ReplicaIdReservationRequestCoreV2
  readonly coreDigest: Digest
  readonly memberSignature: Signature
}

export interface ReplicaIdReservationReceiptCoreV2 {
  readonly format: "convax.replica-id-reservation-receipt-core/2"
  readonly allocationRequestId: Id128
  readonly reservationRequestCoreDigest: Digest
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly purpose: ReplicaIdReservationPurposeV2
  readonly expectedMembershipSequence: Uint64
  readonly targetMemberId: MemberId
  readonly expectedTargetMemberMutationCounter: Uint64
  readonly requesterCredentialDigest: Digest
  readonly currentReplicaId: ReplicaId | null
  readonly assignedReplicaId: ReplicaId
  readonly newReplicaSigningPublicKey: PublicKey
  readonly requestedEditState: "none" | "pending-editor"
  readonly issuedAtUnixMs: Uint64
  readonly expiresAtUnixMs: Uint64
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface ReplicaIdReservationReceiptV2 {
  readonly format: "convax.replica-id-reservation-receipt/2"
  readonly core: ReplicaIdReservationReceiptCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface ReplicaActorCredentialCoreV2 {
  readonly format: "convax.replica-actor-credential-core/2"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly memberId: MemberId
  readonly replicaId: ReplicaId
  readonly replicaIdReservationReceiptDigest: Digest
  readonly actorId: ActorId
  readonly replicaSigningPublicKey: PublicKey
  readonly replicaAuthorizationEpoch: Id128
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface ReplicaActorCredentialV2 {
  readonly format: "convax.replica-actor-credential/2"
  readonly core: ReplicaActorCredentialCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface ReplicaEditAuthorizationCoreV2 {
  readonly format: "convax.replica-edit-authorization-core/2"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly membershipSnapshotDigest: Digest
  readonly membershipSequence: Uint64
  readonly memberId: MemberId
  readonly memberAuthorizationEpoch: Id128
  readonly replicaId: ReplicaId
  readonly replicaIdReservationReceiptDigest: Digest
  readonly actorId: ActorId
  readonly replicaAuthorizationEpoch: Id128
  readonly role: "editor"
  readonly editState: "active-editor"
  readonly installedFloorSetDigest: Digest
  readonly protocolDigest: Digest
  readonly schemaDigest: Digest
  readonly validationArtifactSetDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface ReplicaEditAuthorizationV2 {
  readonly format: "convax.replica-edit-authorization/2"
  readonly core: ReplicaEditAuthorizationCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface MutationChallengeCoreV2 {
  readonly format: "convax.mutation-challenge-core/2"
  readonly purpose: MutationPurposeV2
  readonly challengeId: Id128
  readonly mutationId: Id128
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly expectedMembershipSequence: Uint64
  readonly requesterMemberId: MemberId
  readonly targetMemberId: MemberId
  readonly expectedTargetMemberMutationCounter: Uint64
  readonly requesterCredentialDigest: Digest
  readonly replicaIdReservationReceiptDigest: Digest | null
  readonly requiredFloorSetDigest: Digest | null
  readonly preparedAfterMembershipSnapshotCoreDigest: Digest
  readonly preparedCutoffCoverageRootCoreDigest: Digest | null
  readonly serverNonce: Id128
  readonly issuedAtUnixMs: Uint64
  readonly expiresAtUnixMs: Uint64
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface MutationChallengeV2 {
  readonly format: "convax.mutation-challenge/2"
  readonly core: MutationChallengeCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

interface MutationProofBaseCoreV2 {
  readonly format: "convax.mutation-proof-core/2"
  readonly mutationId: Id128
  readonly challengeDigest: Digest
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly expectedMembershipSequence: Uint64
  readonly requesterMemberId: MemberId
  readonly targetMemberId: MemberId
  readonly targetMemberMutationCounter: Uint64
  readonly serverNonce: Id128
}

export type MembershipMutationProofCoreV2 =
  | (MutationProofBaseCoreV2 & {
      readonly purpose: "member-add"
      readonly targetMemberSigningPublicKey: PublicKey
      readonly initialRole: CollaborationRoleV2
      readonly adminCapabilityDigest: Digest
    })
  | (MutationProofBaseCoreV2 & {
      readonly purpose: "replica-enroll"
      readonly currentReplicaId: null
      readonly newReplicaId: ReplicaId
      readonly replicaIdReservationReceiptDigest: Digest
      readonly newReplicaSigningPublicKey: PublicKey
      readonly requestedEditState: "none" | "pending-editor"
      readonly cutoffCoverageRootCoreDigest: null
    })
  | (MutationProofBaseCoreV2 & {
      readonly purpose: "replica-activate-editor"
      readonly currentReplicaId: ReplicaId
      readonly installedFloorSetDigest: Digest
      readonly cutoffCoverageRootCoreDigest: null
    })
  | (MutationProofBaseCoreV2 & {
      readonly purpose: "replica-rotate"
      readonly currentReplicaId: ReplicaId
      readonly newReplicaId: ReplicaId
      readonly replicaIdReservationReceiptDigest: Digest
      readonly newReplicaSigningPublicKey: PublicKey
      readonly requestedEditState: "none" | "pending-editor"
      readonly cutoffCoverageRootCoreDigest: Digest
    })
  | (MutationProofBaseCoreV2 & {
      readonly purpose: "replica-revoke"
      readonly currentReplicaId: ReplicaId
      readonly newReplicaId: null
      readonly newReplicaSigningPublicKey: null
      readonly requestedEditState: null
      readonly cutoffCoverageRootCoreDigest: Digest
    })
  | (MutationProofBaseCoreV2 & {
      readonly purpose: "member-role-change"
      readonly nextRole: CollaborationRoleV2
      readonly cutoffCoverageRootCoreDigest: Digest | null
      readonly adminCapabilityDigest: Digest
    })
  | (MutationProofBaseCoreV2 & {
      readonly purpose: "member-revoke"
      readonly cutoffCoverageRootCoreDigest: Digest
      readonly adminCapabilityDigest: Digest
    })

export type MutationProofSignaturesV2 =
  | { readonly purpose: "member-add"; readonly adminSignature: Signature; readonly targetMemberPossessionSignature: Signature }
  | { readonly purpose: "replica-enroll" | "replica-activate-editor" | "replica-rotate" | "replica-revoke"; readonly memberSignature: Signature }
  | { readonly purpose: "member-role-change" | "member-revoke"; readonly adminSignature: Signature }

export interface MembershipMutationProofV2 {
  readonly format: "convax.mutation-proof/2"
  readonly core: MembershipMutationProofCoreV2
  readonly requestDigest: Digest
  readonly signatures: MutationProofSignaturesV2
}

export interface MutationReceiptCoreV2 {
  readonly format: "convax.mutation-receipt-core/2"
  readonly mutationId: Id128
  readonly requestDigest: Digest
  readonly purpose: MutationPurposeV2
  readonly beforeMembershipSnapshotDigest: Digest
  readonly afterMembershipSnapshotDigest: Digest
  readonly consumedReplicaIdReservationReceiptDigest: Digest | null
  readonly issuedReplicaActorCredentialDigest: Digest | null
  readonly issuedReplicaEditAuthorizationDigest: Digest | null
  readonly authorizationMutationDigest: Digest | null
  readonly cutoffCoverageRootCoreDigest: Digest | null
  readonly closedSessionCredentialDigests: readonly Digest[]
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface MutationReceiptV2 {
  readonly format: "convax.mutation-receipt/2"
  readonly core: MutationReceiptCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}
