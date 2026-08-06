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

import type { CollaborationRole } from "./control-contracts"

export type MembershipMemberState = "active" | "revoked"
export type MembershipReplicaState = "active" | "revoked" | "replaced"
export type MembershipReplicaEditState = "none" | "pending-editor" | "active-editor"
export type ReplicaIdReservationPurpose = "replica-enroll" | "replica-rotate"
export type MutationPurpose =
  | "member-add"
  | "replica-enroll"
  | "replica-activate-editor"
  | "replica-rotate"
  | "replica-revoke"
  | "member-role-change"
  | "member-revoke"

export interface MembershipMember {
  readonly memberId: MemberId
  readonly memberSigningPublicKey: PublicKey
  readonly role: CollaborationRole
  readonly state: MembershipMemberState
  readonly memberAuthorizationEpoch: Id128
  readonly memberMutationCounter: Uint64
}

export interface MembershipReplica {
  readonly replicaId: ReplicaId
  readonly replicaIdReservationReceiptDigest: Digest
  readonly memberId: MemberId
  readonly actorId: ActorId
  readonly replicaSigningPublicKey: PublicKey
  readonly state: MembershipReplicaState
  readonly editState: MembershipReplicaEditState
  readonly replicaAuthorizationEpoch: Id128
  readonly enrolledAtMembershipSequence: Uint64
  readonly revokedAtMembershipSequence: Uint64 | null
  readonly replacesReplicaId: ReplicaId | null
}

export interface MembershipSnapshotCore {
  readonly format: "convax.membership-snapshot-core"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly membershipSequence: Uint64
  readonly registrySequence: Uint64
  readonly registryRootDigest: Digest
  readonly members: readonly MembershipMember[]
  readonly replicas: readonly MembershipReplica[]
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface MembershipSnapshot {
  readonly format: "convax.membership-snapshot"
  readonly core: MembershipSnapshotCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface MemberCredentialCore {
  readonly format: "convax.member-credential-core"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly membershipSnapshotDigest: Digest
  readonly memberId: MemberId
  readonly memberSigningPublicKey: PublicKey
  readonly role: CollaborationRole
  readonly memberAuthorizationEpoch: Id128
  readonly adminCapabilityDigest: Digest | null
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface MemberCredential {
  readonly format: "convax.member-credential"
  readonly core: MemberCredentialCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface ProjectAdminCapabilityCore {
  readonly format: "convax.project-admin-capability-core"
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

export interface ProjectAdminCapability {
  readonly format: "convax.project-admin-capability"
  readonly core: ProjectAdminCapabilityCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface ReplicaIdReservationRequestCore {
  readonly format: "convax.replica-id-reservation-request-core"
  readonly allocationRequestId: Id128
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly purpose: ReplicaIdReservationPurpose
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

export interface ReplicaIdReservationRequest {
  readonly format: "convax.replica-id-reservation-request"
  readonly core: ReplicaIdReservationRequestCore
  readonly coreDigest: Digest
  readonly memberSignature: Signature
}

export interface ReplicaIdReservationReceiptCore {
  readonly format: "convax.replica-id-reservation-receipt-core"
  readonly allocationRequestId: Id128
  readonly reservationRequestCoreDigest: Digest
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly purpose: ReplicaIdReservationPurpose
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

export interface ReplicaIdReservationReceipt {
  readonly format: "convax.replica-id-reservation-receipt"
  readonly core: ReplicaIdReservationReceiptCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface ReplicaActorCredentialCore {
  readonly format: "convax.replica-actor-credential-core"
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

export interface ReplicaActorCredential {
  readonly format: "convax.replica-actor-credential"
  readonly core: ReplicaActorCredentialCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface ReplicaEditAuthorizationCore {
  readonly format: "convax.replica-edit-authorization-core"
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

export interface ReplicaEditAuthorization {
  readonly format: "convax.replica-edit-authorization"
  readonly core: ReplicaEditAuthorizationCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface MutationChallengeCore {
  readonly format: "convax.mutation-challenge-core"
  readonly purpose: MutationPurpose
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

export interface MutationChallenge {
  readonly format: "convax.mutation-challenge"
  readonly core: MutationChallengeCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

interface MutationProofBaseCore {
  readonly format: "convax.mutation-proof-core"
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

export type MembershipMutationProofCore =
  | (MutationProofBaseCore & {
      readonly purpose: "member-add"
      readonly targetMemberSigningPublicKey: PublicKey
      readonly initialRole: CollaborationRole
      readonly adminCapabilityDigest: Digest
    })
  | (MutationProofBaseCore & {
      readonly purpose: "replica-enroll"
      readonly currentReplicaId: null
      readonly newReplicaId: ReplicaId
      readonly replicaIdReservationReceiptDigest: Digest
      readonly newReplicaSigningPublicKey: PublicKey
      readonly requestedEditState: "none" | "pending-editor"
      readonly cutoffCoverageRootCoreDigest: null
    })
  | (MutationProofBaseCore & {
      readonly purpose: "replica-activate-editor"
      readonly currentReplicaId: ReplicaId
      readonly installedFloorSetDigest: Digest
      readonly cutoffCoverageRootCoreDigest: null
    })
  | (MutationProofBaseCore & {
      readonly purpose: "replica-rotate"
      readonly currentReplicaId: ReplicaId
      readonly newReplicaId: ReplicaId
      readonly replicaIdReservationReceiptDigest: Digest
      readonly newReplicaSigningPublicKey: PublicKey
      readonly requestedEditState: "none" | "pending-editor"
      readonly cutoffCoverageRootCoreDigest: Digest
    })
  | (MutationProofBaseCore & {
      readonly purpose: "replica-revoke"
      readonly currentReplicaId: ReplicaId
      readonly newReplicaId: null
      readonly newReplicaSigningPublicKey: null
      readonly requestedEditState: null
      readonly cutoffCoverageRootCoreDigest: Digest
    })
  | (MutationProofBaseCore & {
      readonly purpose: "member-role-change"
      readonly nextRole: CollaborationRole
      readonly cutoffCoverageRootCoreDigest: Digest | null
      readonly adminCapabilityDigest: Digest
    })
  | (MutationProofBaseCore & {
      readonly purpose: "member-revoke"
      readonly cutoffCoverageRootCoreDigest: Digest
      readonly adminCapabilityDigest: Digest
    })

export type MutationProofSignatures =
  | { readonly purpose: "member-add"; readonly adminSignature: Signature; readonly targetMemberPossessionSignature: Signature }
  | { readonly purpose: "replica-enroll" | "replica-activate-editor" | "replica-rotate" | "replica-revoke"; readonly memberSignature: Signature }
  | { readonly purpose: "member-role-change" | "member-revoke"; readonly adminSignature: Signature }

export interface MembershipMutationProof {
  readonly format: "convax.mutation-proof"
  readonly core: MembershipMutationProofCore
  readonly requestDigest: Digest
  readonly signatures: MutationProofSignatures
}

export interface MutationReceiptCore {
  readonly format: "convax.mutation-receipt-core"
  readonly mutationId: Id128
  readonly requestDigest: Digest
  readonly purpose: MutationPurpose
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

export interface MutationReceipt {
  readonly format: "convax.mutation-receipt"
  readonly core: MutationReceiptCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}
