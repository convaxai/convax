import type {
  ActorIdV2,
  DigestV2,
  Id128V2,
  MemberIdV2,
  ProjectIdV2,
  PublicKeyV2,
  ReplicaIdV2,
  SignatureV2,
  Uint64V2,
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
  readonly memberId: MemberIdV2
  readonly memberSigningPublicKey: PublicKeyV2
  readonly role: CollaborationRoleV2
  readonly state: MembershipMemberStateV2
  readonly memberAuthorizationEpoch: Id128V2
  readonly memberMutationCounter: Uint64V2
}

export interface MembershipReplicaV2 {
  readonly replicaId: ReplicaIdV2
  readonly replicaIdReservationReceiptDigest: DigestV2
  readonly memberId: MemberIdV2
  readonly actorId: ActorIdV2
  readonly replicaSigningPublicKey: PublicKeyV2
  readonly state: MembershipReplicaStateV2
  readonly editState: MembershipReplicaEditStateV2
  readonly replicaAuthorizationEpoch: Id128V2
  readonly enrolledAtMembershipSequence: Uint64V2
  readonly revokedAtMembershipSequence: Uint64V2 | null
  readonly replacesReplicaId: ReplicaIdV2 | null
}

export interface MembershipSnapshotCoreV2 {
  readonly format: "convax.membership-snapshot-core/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly membershipSequence: Uint64V2
  readonly registrySequence: Uint64V2
  readonly registryRootDigest: DigestV2
  readonly members: readonly MembershipMemberV2[]
  readonly replicas: readonly MembershipReplicaV2[]
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface MembershipSnapshotV2 {
  readonly format: "convax.membership-snapshot/2"
  readonly core: MembershipSnapshotCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export interface MemberCredentialCoreV2 {
  readonly format: "convax.member-credential-core/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly membershipSnapshotDigest: DigestV2
  readonly memberId: MemberIdV2
  readonly memberSigningPublicKey: PublicKeyV2
  readonly role: CollaborationRoleV2
  readonly memberAuthorizationEpoch: Id128V2
  readonly adminCapabilityDigest: DigestV2 | null
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface MemberCredentialV2 {
  readonly format: "convax.member-credential/2"
  readonly core: MemberCredentialCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export interface ProjectAdminCapabilityCoreV2 {
  readonly format: "convax.project-admin-capability-core/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly membershipSnapshotDigest: DigestV2
  readonly adminMemberId: MemberIdV2
  readonly adminMemberAuthorizationEpoch: Id128V2
  readonly grants: readonly ["membership-admin"]
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface ProjectAdminCapabilityV2 {
  readonly format: "convax.project-admin-capability/2"
  readonly core: ProjectAdminCapabilityCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export interface ReplicaIdReservationRequestCoreV2 {
  readonly format: "convax.replica-id-reservation-request-core/2"
  readonly allocationRequestId: Id128V2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly purpose: ReplicaIdReservationPurposeV2
  readonly expectedMembershipSequence: Uint64V2
  readonly requesterMemberId: MemberIdV2
  readonly targetMemberId: MemberIdV2
  readonly expectedTargetMemberMutationCounter: Uint64V2
  readonly requesterCredentialDigest: DigestV2
  readonly currentReplicaId: ReplicaIdV2 | null
  readonly newReplicaSigningPublicKey: PublicKeyV2
  readonly requestedEditState: "none" | "pending-editor"
  readonly protocolDigest: DigestV2
}

export interface ReplicaIdReservationRequestV2 {
  readonly format: "convax.replica-id-reservation-request/2"
  readonly core: ReplicaIdReservationRequestCoreV2
  readonly coreDigest: DigestV2
  readonly memberSignature: SignatureV2
}

export interface ReplicaIdReservationReceiptCoreV2 {
  readonly format: "convax.replica-id-reservation-receipt-core/2"
  readonly allocationRequestId: Id128V2
  readonly reservationRequestCoreDigest: DigestV2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly purpose: ReplicaIdReservationPurposeV2
  readonly expectedMembershipSequence: Uint64V2
  readonly targetMemberId: MemberIdV2
  readonly expectedTargetMemberMutationCounter: Uint64V2
  readonly requesterCredentialDigest: DigestV2
  readonly currentReplicaId: ReplicaIdV2 | null
  readonly assignedReplicaId: ReplicaIdV2
  readonly newReplicaSigningPublicKey: PublicKeyV2
  readonly requestedEditState: "none" | "pending-editor"
  readonly issuedAtUnixMs: Uint64V2
  readonly expiresAtUnixMs: Uint64V2
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface ReplicaIdReservationReceiptV2 {
  readonly format: "convax.replica-id-reservation-receipt/2"
  readonly core: ReplicaIdReservationReceiptCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export interface ReplicaActorCredentialCoreV2 {
  readonly format: "convax.replica-actor-credential-core/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly memberId: MemberIdV2
  readonly replicaId: ReplicaIdV2
  readonly replicaIdReservationReceiptDigest: DigestV2
  readonly actorId: ActorIdV2
  readonly replicaSigningPublicKey: PublicKeyV2
  readonly replicaAuthorizationEpoch: Id128V2
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface ReplicaActorCredentialV2 {
  readonly format: "convax.replica-actor-credential/2"
  readonly core: ReplicaActorCredentialCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export interface ReplicaEditAuthorizationCoreV2 {
  readonly format: "convax.replica-edit-authorization-core/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly membershipSnapshotDigest: DigestV2
  readonly membershipSequence: Uint64V2
  readonly memberId: MemberIdV2
  readonly memberAuthorizationEpoch: Id128V2
  readonly replicaId: ReplicaIdV2
  readonly replicaIdReservationReceiptDigest: DigestV2
  readonly actorId: ActorIdV2
  readonly replicaAuthorizationEpoch: Id128V2
  readonly role: "editor"
  readonly editState: "active-editor"
  readonly installedFloorSetDigest: DigestV2
  readonly protocolDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface ReplicaEditAuthorizationV2 {
  readonly format: "convax.replica-edit-authorization/2"
  readonly core: ReplicaEditAuthorizationCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export interface MutationChallengeCoreV2 {
  readonly format: "convax.mutation-challenge-core/2"
  readonly purpose: MutationPurposeV2
  readonly challengeId: Id128V2
  readonly mutationId: Id128V2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly expectedMembershipSequence: Uint64V2
  readonly requesterMemberId: MemberIdV2
  readonly targetMemberId: MemberIdV2
  readonly expectedTargetMemberMutationCounter: Uint64V2
  readonly requesterCredentialDigest: DigestV2
  readonly replicaIdReservationReceiptDigest: DigestV2 | null
  readonly requiredFloorSetDigest: DigestV2 | null
  readonly preparedAfterMembershipSnapshotCoreDigest: DigestV2
  readonly preparedCutoffCoverageRootCoreDigest: DigestV2 | null
  readonly serverNonce: Id128V2
  readonly issuedAtUnixMs: Uint64V2
  readonly expiresAtUnixMs: Uint64V2
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface MutationChallengeV2 {
  readonly format: "convax.mutation-challenge/2"
  readonly core: MutationChallengeCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

interface MutationProofBaseCoreV2 {
  readonly format: "convax.mutation-proof-core/2"
  readonly mutationId: Id128V2
  readonly challengeDigest: DigestV2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly expectedMembershipSequence: Uint64V2
  readonly requesterMemberId: MemberIdV2
  readonly targetMemberId: MemberIdV2
  readonly targetMemberMutationCounter: Uint64V2
  readonly serverNonce: Id128V2
}

export type MembershipMutationProofCoreV2 =
  | (MutationProofBaseCoreV2 & {
      readonly purpose: "member-add"
      readonly targetMemberSigningPublicKey: PublicKeyV2
      readonly initialRole: CollaborationRoleV2
      readonly adminCapabilityDigest: DigestV2
    })
  | (MutationProofBaseCoreV2 & {
      readonly purpose: "replica-enroll"
      readonly currentReplicaId: null
      readonly newReplicaId: ReplicaIdV2
      readonly replicaIdReservationReceiptDigest: DigestV2
      readonly newReplicaSigningPublicKey: PublicKeyV2
      readonly requestedEditState: "none" | "pending-editor"
      readonly cutoffCoverageRootCoreDigest: null
    })
  | (MutationProofBaseCoreV2 & {
      readonly purpose: "replica-activate-editor"
      readonly currentReplicaId: ReplicaIdV2
      readonly installedFloorSetDigest: DigestV2
      readonly cutoffCoverageRootCoreDigest: null
    })
  | (MutationProofBaseCoreV2 & {
      readonly purpose: "replica-rotate"
      readonly currentReplicaId: ReplicaIdV2
      readonly newReplicaId: ReplicaIdV2
      readonly replicaIdReservationReceiptDigest: DigestV2
      readonly newReplicaSigningPublicKey: PublicKeyV2
      readonly requestedEditState: "none" | "pending-editor"
      readonly cutoffCoverageRootCoreDigest: DigestV2
    })
  | (MutationProofBaseCoreV2 & {
      readonly purpose: "replica-revoke"
      readonly currentReplicaId: ReplicaIdV2
      readonly newReplicaId: null
      readonly newReplicaSigningPublicKey: null
      readonly requestedEditState: null
      readonly cutoffCoverageRootCoreDigest: DigestV2
    })
  | (MutationProofBaseCoreV2 & {
      readonly purpose: "member-role-change"
      readonly nextRole: CollaborationRoleV2
      readonly cutoffCoverageRootCoreDigest: DigestV2 | null
      readonly adminCapabilityDigest: DigestV2
    })
  | (MutationProofBaseCoreV2 & {
      readonly purpose: "member-revoke"
      readonly cutoffCoverageRootCoreDigest: DigestV2
      readonly adminCapabilityDigest: DigestV2
    })

export type MutationProofSignaturesV2 =
  | { readonly purpose: "member-add"; readonly adminSignature: SignatureV2; readonly targetMemberPossessionSignature: SignatureV2 }
  | { readonly purpose: "replica-enroll" | "replica-activate-editor" | "replica-rotate" | "replica-revoke"; readonly memberSignature: SignatureV2 }
  | { readonly purpose: "member-role-change" | "member-revoke"; readonly adminSignature: SignatureV2 }

export interface MembershipMutationProofV2 {
  readonly format: "convax.mutation-proof/2"
  readonly core: MembershipMutationProofCoreV2
  readonly requestDigest: DigestV2
  readonly signatures: MutationProofSignaturesV2
}

export interface MutationReceiptCoreV2 {
  readonly format: "convax.mutation-receipt-core/2"
  readonly mutationId: Id128V2
  readonly requestDigest: DigestV2
  readonly purpose: MutationPurposeV2
  readonly beforeMembershipSnapshotDigest: DigestV2
  readonly afterMembershipSnapshotDigest: DigestV2
  readonly consumedReplicaIdReservationReceiptDigest: DigestV2 | null
  readonly issuedReplicaActorCredentialDigest: DigestV2 | null
  readonly issuedReplicaEditAuthorizationDigest: DigestV2 | null
  readonly authorizationMutationDigest: DigestV2 | null
  readonly cutoffCoverageRootCoreDigest: DigestV2 | null
  readonly closedSessionCredentialDigests: readonly DigestV2[]
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface MutationReceiptV2 {
  readonly format: "convax.mutation-receipt/2"
  readonly core: MutationReceiptCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}
