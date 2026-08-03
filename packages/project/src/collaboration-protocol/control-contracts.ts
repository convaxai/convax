import type {
  ActorIdV2,
  DigestV2,
  Id128V2,
  MemberIdV2,
  PeerIdV2,
  ProjectIdV2,
  PublicKeyV2,
  ReplicaIdV2,
  SessionIdV2,
  SignatureV2,
  Uint64V2,
} from "@convax/collaboration"

/** Browser-safe R5 control-plane DTOs. These types carry metadata only. */
export type CollaborationRoleV2 = "viewer" | "editor"
export type CollaborationEditStateV2 = "none" | "pending-editor" | "active-editor"
export type CollaborationServiceKeyPurposeV2 = "membership" | "rendezvous"

export interface SessionChallengeCoreV2 {
  readonly format: "convax.session-challenge-core/2"
  readonly challengeId: Id128V2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly membershipSnapshotDigest: DigestV2
  readonly memberId: MemberIdV2
  readonly replicaId: ReplicaIdV2
  readonly actorId: ActorIdV2
  readonly expectedReplicaSessionCounter: Uint64V2
  readonly serverNonce: Id128V2
  readonly sessionId: SessionIdV2
  readonly leaseId: Id128V2
  readonly peerId: PeerIdV2
  readonly issuedAtUnixMs: Uint64V2
  readonly expiresAtUnixMs: Uint64V2
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface SessionChallengeV2 {
  readonly format: "convax.session-challenge/2"
  readonly core: SessionChallengeCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export interface SessionProofCoreV2 {
  readonly format: "convax.session-proof-core/2"
  readonly challengeDigest: DigestV2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly membershipSnapshotDigest: DigestV2
  readonly memberId: MemberIdV2
  readonly memberAuthorizationEpoch: Id128V2
  readonly replicaId: ReplicaIdV2
  readonly actorId: ActorIdV2
  readonly replicaAuthorizationEpoch: Id128V2
  readonly replicaSessionCounter: Uint64V2
  readonly serverNonce: Id128V2
  readonly sessionId: SessionIdV2
  readonly leaseId: Id128V2
  readonly peerId: PeerIdV2
  readonly sessionSigningPublicKey: PublicKeyV2
  readonly requestedExpiresAtUnixMs: Uint64V2
  readonly protocolDigest: DigestV2
}

export interface SessionProofV2 {
  readonly format: "convax.session-proof/2"
  readonly core: SessionProofCoreV2
  readonly coreDigest: DigestV2
  readonly replicaSignature: SignatureV2
}

export interface SessionCredentialCoreV2 {
  readonly format: "convax.session-credential-core/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly membershipSequence: Uint64V2
  readonly membershipSnapshotDigest: DigestV2
  readonly registrySequence: Uint64V2
  readonly registryRootDigest: DigestV2
  readonly memberId: MemberIdV2
  readonly memberAuthorizationEpoch: Id128V2
  readonly role: CollaborationRoleV2
  readonly replicaId: ReplicaIdV2
  readonly actorId: ActorIdV2
  readonly replicaAuthorizationEpoch: Id128V2
  readonly replicaSigningPublicKey: PublicKeyV2
  readonly editState: CollaborationEditStateV2
  readonly sessionId: SessionIdV2
  readonly leaseId: Id128V2
  readonly peerId: PeerIdV2
  readonly sessionSigningPublicKey: PublicKeyV2
  readonly sessionChallengeDigest: DigestV2
  readonly sessionProofDigest: DigestV2
  readonly issuedAtUnixMs: Uint64V2
  readonly expiresAtUnixMs: Uint64V2
  readonly protocolDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "membership"
  readonly serviceKeyId: string
}

export interface SessionCredentialV2 {
  readonly format: "convax.session-credential/2"
  readonly core: SessionCredentialCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export interface ActivePeerDirectoryEntryV2 {
  readonly credentialDigest: DigestV2
  readonly memberId: MemberIdV2
  readonly replicaId: ReplicaIdV2
  readonly actorId: ActorIdV2
  readonly role: CollaborationRoleV2
  readonly editState: CollaborationEditStateV2
  readonly peerId: PeerIdV2
  readonly leaseId: Id128V2
}

export interface ActivePeerDirectoryCoreV2 {
  readonly format: "convax.active-peer-directory-core/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly membershipSnapshotDigest: DigestV2
  readonly directorySequence: Uint64V2
  readonly peers: readonly ActivePeerDirectoryEntryV2[]
  readonly issuedAtUnixMs: Uint64V2
  readonly expiresAtUnixMs: Uint64V2
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "rendezvous"
  readonly serviceKeyId: string
}

export interface ActivePeerDirectoryV2 {
  readonly format: "convax.active-peer-directory/2"
  readonly core: ActivePeerDirectoryCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export interface PeerTicketRequestCoreV2 {
  readonly format: "convax.peer-ticket-request-core/2"
  readonly requestId: Id128V2
  readonly connectionId: Id128V2
  readonly requesterCredentialDigest: DigestV2
  readonly responderCredentialDigest: DigestV2
  readonly requesterPeerId: PeerIdV2
  readonly responderPeerId: PeerIdV2
  readonly requesterNonce: Id128V2
  readonly protocolDigest: DigestV2
}

export interface PeerTicketRequestV2 {
  readonly format: "convax.peer-ticket-request/2"
  readonly core: PeerTicketRequestCoreV2
  readonly coreDigest: DigestV2
  readonly requesterSessionSignature: SignatureV2
}

export interface PeerFreshnessTicketCoreV2 {
  readonly format: "convax.peer-freshness-ticket-core/2"
  readonly ticketId: Id128V2
  readonly requestDigest: DigestV2
  readonly connectionId: Id128V2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly membershipSnapshotDigest: DigestV2
  readonly requesterCredentialDigest: DigestV2
  readonly responderCredentialDigest: DigestV2
  readonly requesterPeerId: PeerIdV2
  readonly responderPeerId: PeerIdV2
  readonly issuedAtUnixMs: Uint64V2
  readonly expiresAtUnixMs: Uint64V2
  readonly channelContractDigest: DigestV2
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "rendezvous"
  readonly serviceKeyId: string
}

export interface PeerFreshnessTicketV2 {
  readonly format: "convax.peer-freshness-ticket/2"
  readonly core: PeerFreshnessTicketCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}
