import type {
  ActorId,
  Digest,
  Id128,
  MemberId,
  PeerId,
  ProjectId,
  PublicKey,
  ReplicaId,
  SessionId,
  Signature,
  Uint64,
} from "@convax/collaboration"

/** Browser-safe control-plane DTOs. These types carry metadata only. */
export type CollaborationRoleV2 = "viewer" | "editor"
export type CollaborationEditStateV2 = "none" | "pending-editor" | "active-editor"
export type CollaborationServiceKeyPurposeV2 = "membership" | "rendezvous"

export interface SessionChallengeCoreV2 {
  readonly format: "convax.session-challenge-core/2"
  readonly challengeId: Id128
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly membershipSnapshotDigest: Digest
  readonly memberId: MemberId
  readonly replicaId: ReplicaId
  readonly actorId: ActorId
  readonly expectedReplicaSessionCounter: Uint64
  readonly serverNonce: Id128
  readonly sessionId: SessionId
  readonly leaseId: Id128
  readonly peerId: PeerId
  readonly issuedAtUnixMs: Uint64
  readonly expiresAtUnixMs: Uint64
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface SessionChallengeV2 {
  readonly format: "convax.session-challenge/2"
  readonly core: SessionChallengeCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface SessionProofCoreV2 {
  readonly format: "convax.session-proof-core/2"
  readonly challengeDigest: Digest
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly membershipSnapshotDigest: Digest
  readonly memberId: MemberId
  readonly memberAuthorizationEpoch: Id128
  readonly replicaId: ReplicaId
  readonly actorId: ActorId
  readonly replicaAuthorizationEpoch: Id128
  readonly replicaSessionCounter: Uint64
  readonly serverNonce: Id128
  readonly sessionId: SessionId
  readonly leaseId: Id128
  readonly peerId: PeerId
  readonly sessionSigningPublicKey: PublicKey
  readonly requestedExpiresAtUnixMs: Uint64
  readonly protocolDigest: Digest
}

export interface SessionProofV2 {
  readonly format: "convax.session-proof/2"
  readonly core: SessionProofCoreV2
  readonly coreDigest: Digest
  readonly replicaSignature: Signature
}

export interface SessionCredentialCoreV2 {
  readonly format: "convax.session-credential-core/2"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly membershipSequence: Uint64
  readonly membershipSnapshotDigest: Digest
  readonly registrySequence: Uint64
  readonly registryRootDigest: Digest
  readonly memberId: MemberId
  readonly memberAuthorizationEpoch: Id128
  readonly role: CollaborationRoleV2
  readonly replicaId: ReplicaId
  readonly actorId: ActorId
  readonly replicaAuthorizationEpoch: Id128
  readonly replicaSigningPublicKey: PublicKey
  readonly editState: CollaborationEditStateV2
  readonly sessionId: SessionId
  readonly leaseId: Id128
  readonly peerId: PeerId
  readonly sessionSigningPublicKey: PublicKey
  readonly sessionChallengeDigest: Digest
  readonly sessionProofDigest: Digest
  readonly issuedAtUnixMs: Uint64
  readonly expiresAtUnixMs: Uint64
  readonly protocolDigest: Digest
  readonly schemaDigest: Digest
  readonly validationArtifactSetDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface SessionCredentialV2 {
  readonly format: "convax.session-credential/2"
  readonly core: SessionCredentialCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface ActivePeerDirectoryEntryV2 {
  readonly credentialDigest: Digest
  readonly memberId: MemberId
  readonly replicaId: ReplicaId
  readonly actorId: ActorId
  readonly role: CollaborationRoleV2
  readonly editState: CollaborationEditStateV2
  readonly peerId: PeerId
  readonly leaseId: Id128
}

export interface ActivePeerDirectoryCoreV2 {
  readonly format: "convax.active-peer-directory-core/2"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly membershipSnapshotDigest: Digest
  readonly directorySequence: Uint64
  readonly peers: readonly ActivePeerDirectoryEntryV2[]
  readonly issuedAtUnixMs: Uint64
  readonly expiresAtUnixMs: Uint64
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "rendezvous"
  readonly serviceKeyId: string
}

export interface ActivePeerDirectoryV2 {
  readonly format: "convax.active-peer-directory/2"
  readonly core: ActivePeerDirectoryCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface PeerTicketRequestCoreV2 {
  readonly format: "convax.peer-ticket-request-core/2"
  readonly requestId: Id128
  readonly connectionId: Id128
  readonly requesterCredentialDigest: Digest
  readonly responderCredentialDigest: Digest
  readonly requesterPeerId: PeerId
  readonly responderPeerId: PeerId
  readonly requesterNonce: Id128
  readonly protocolDigest: Digest
}

export interface PeerTicketRequestV2 {
  readonly format: "convax.peer-ticket-request/2"
  readonly core: PeerTicketRequestCoreV2
  readonly coreDigest: Digest
  readonly requesterSessionSignature: Signature
}

export interface PeerFreshnessTicketCoreV2 {
  readonly format: "convax.peer-freshness-ticket-core/2"
  readonly ticketId: Id128
  readonly requestDigest: Digest
  readonly connectionId: Id128
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly membershipSnapshotDigest: Digest
  readonly requesterCredentialDigest: Digest
  readonly responderCredentialDigest: Digest
  readonly requesterPeerId: PeerId
  readonly responderPeerId: PeerId
  readonly issuedAtUnixMs: Uint64
  readonly expiresAtUnixMs: Uint64
  readonly channelContractDigest: Digest
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "rendezvous"
  readonly serviceKeyId: string
}

export interface PeerFreshnessTicketV2 {
  readonly format: "convax.peer-freshness-ticket/2"
  readonly core: PeerFreshnessTicketCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}
