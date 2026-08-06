import type {
  Digest,
  Id128,
  PeerId,
  ProjectId,
  Signature,
} from "@convax/collaboration"

export type PeerChannelV2 = "control" | "update" | "blob" | "awareness"

export interface PeerHandshakeCoreV2 {
  readonly format: "convax.peer-handshake-core/2"
  readonly connectionId: Id128
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly freshnessTicketDigest: Digest
  readonly initiatorCredentialDigest: Digest
  readonly responderCredentialDigest: Digest
  readonly initiatorPeerId: PeerId
  readonly responderPeerId: PeerId
  readonly initiatorNonce: Id128
  readonly responderNonce: Id128
  readonly channelContractDigest: Digest
  readonly protocolDigest: Digest
}

export interface PeerHandshakeV2 {
  readonly format: "convax.peer-handshake/2"
  readonly core: PeerHandshakeCoreV2
  readonly coreDigest: Digest
  readonly initiatorSessionSignature: Signature
  readonly responderSessionSignature: Signature
}

export interface PeerChannelOpenCoreV2 {
  readonly format: "convax.peer-channel-open-core/2"
  readonly connectionId: Id128
  readonly handshakeDigest: Digest
  readonly channel: PeerChannelV2
  readonly channelOpenId: Id128
  readonly initiatorCredentialDigest: Digest
  readonly responderCredentialDigest: Digest
  readonly initiatorChannelNonce: Id128
  readonly responderChannelNonce: Id128
  readonly channelContractDigest: Digest
  readonly protocolDigest: Digest
}

export interface PeerChannelOpenV2 {
  readonly format: "convax.peer-channel-open/2"
  readonly core: PeerChannelOpenCoreV2
  readonly coreDigest: Digest
  readonly initiatorSessionSignature: Signature
  readonly responderSessionSignature: Signature
}
