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
export type CollaborationRole = "viewer" | "editor"
export type CollaborationEditState = "none" | "pending-editor" | "active-editor"
export type CollaborationServiceKeyPurpose = "membership" | "rendezvous"

export interface SessionChallengeCore {
  readonly format: "convax.session-challenge-core"
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

export interface SessionChallenge {
  readonly format: "convax.session-challenge"
  readonly core: SessionChallengeCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface SessionProofCore {
  readonly format: "convax.session-proof-core"
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

export interface SessionProof {
  readonly format: "convax.session-proof"
  readonly core: SessionProofCore
  readonly coreDigest: Digest
  readonly replicaSignature: Signature
}

export interface SessionCredentialCore {
  readonly format: "convax.session-credential-core"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly membershipSequence: Uint64
  readonly membershipSnapshotDigest: Digest
  readonly registrySequence: Uint64
  readonly registryRootDigest: Digest
  readonly memberId: MemberId
  readonly memberAuthorizationEpoch: Id128
  readonly role: CollaborationRole
  readonly replicaId: ReplicaId
  readonly actorId: ActorId
  readonly replicaAuthorizationEpoch: Id128
  readonly replicaSigningPublicKey: PublicKey
  readonly editState: CollaborationEditState
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

export interface SessionCredential {
  readonly format: "convax.session-credential"
  readonly core: SessionCredentialCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface ActivePeerDirectoryEntry {
  readonly credentialDigest: Digest
  readonly memberId: MemberId
  readonly replicaId: ReplicaId
  readonly actorId: ActorId
  readonly role: CollaborationRole
  readonly editState: CollaborationEditState
  readonly peerId: PeerId
  readonly leaseId: Id128
}

export interface ActivePeerDirectoryCore {
  readonly format: "convax.active-peer-directory-core"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly membershipSnapshotDigest: Digest
  readonly directorySequence: Uint64
  readonly peers: readonly ActivePeerDirectoryEntry[]
  readonly issuedAtUnixMs: Uint64
  readonly expiresAtUnixMs: Uint64
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "rendezvous"
  readonly serviceKeyId: string
}

export interface ActivePeerDirectory {
  readonly format: "convax.active-peer-directory"
  readonly core: ActivePeerDirectoryCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface PeerTicketRequestCore {
  readonly format: "convax.peer-ticket-request-core"
  readonly requestId: Id128
  readonly connectionId: Id128
  readonly requesterCredentialDigest: Digest
  readonly responderCredentialDigest: Digest
  readonly requesterPeerId: PeerId
  readonly responderPeerId: PeerId
  readonly requesterNonce: Id128
  readonly protocolDigest: Digest
}

export interface PeerTicketRequest {
  readonly format: "convax.peer-ticket-request"
  readonly core: PeerTicketRequestCore
  readonly coreDigest: Digest
  readonly requesterSessionSignature: Signature
}

export interface PeerFreshnessTicketCore {
  readonly format: "convax.peer-freshness-ticket-core"
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

export interface PeerFreshnessTicket {
  readonly format: "convax.peer-freshness-ticket"
  readonly core: PeerFreshnessTicketCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}
