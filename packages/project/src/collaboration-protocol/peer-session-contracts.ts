import type {
  Digest,
  Id128,
  PeerId,
  ProjectId,
  Signature,
} from "@convax/collaboration"

export type PeerChannel = "control" | "update" | "blob" | "awareness"

export interface PeerHandshakeCore {
  readonly format: "convax.peer-handshake-core"
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

export interface PeerHandshake {
  readonly format: "convax.peer-handshake"
  readonly core: PeerHandshakeCore
  readonly coreDigest: Digest
  readonly initiatorSessionSignature: Signature
  readonly responderSessionSignature: Signature
}

export interface PeerChannelOpenCore {
  readonly format: "convax.peer-channel-open-core"
  readonly connectionId: Id128
  readonly handshakeDigest: Digest
  readonly channel: PeerChannel
  readonly channelOpenId: Id128
  readonly initiatorCredentialDigest: Digest
  readonly responderCredentialDigest: Digest
  readonly initiatorChannelNonce: Id128
  readonly responderChannelNonce: Id128
  readonly channelContractDigest: Digest
  readonly protocolDigest: Digest
}

export interface PeerChannelOpen {
  readonly format: "convax.peer-channel-open"
  readonly core: PeerChannelOpenCore
  readonly coreDigest: Digest
  readonly initiatorSessionSignature: Signature
  readonly responderSessionSignature: Signature
}
