import type {
  DigestV2,
  Id128V2,
  PeerIdV2,
  ProjectIdV2,
  SignatureV2,
} from "@convax/collaboration"

export type PeerChannelV2 = "control" | "update" | "blob" | "awareness"

export interface PeerHandshakeCoreV2 {
  readonly format: "convax.peer-handshake-core/2"
  readonly connectionId: Id128V2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly freshnessTicketDigest: DigestV2
  readonly initiatorCredentialDigest: DigestV2
  readonly responderCredentialDigest: DigestV2
  readonly initiatorPeerId: PeerIdV2
  readonly responderPeerId: PeerIdV2
  readonly initiatorNonce: Id128V2
  readonly responderNonce: Id128V2
  readonly channelContractDigest: DigestV2
  readonly protocolDigest: DigestV2
}

export interface PeerHandshakeV2 {
  readonly format: "convax.peer-handshake/2"
  readonly core: PeerHandshakeCoreV2
  readonly coreDigest: DigestV2
  readonly initiatorSessionSignature: SignatureV2
  readonly responderSessionSignature: SignatureV2
}

export interface PeerChannelOpenCoreV2 {
  readonly format: "convax.peer-channel-open-core/2"
  readonly connectionId: Id128V2
  readonly handshakeDigest: DigestV2
  readonly channel: PeerChannelV2
  readonly channelOpenId: Id128V2
  readonly initiatorCredentialDigest: DigestV2
  readonly responderCredentialDigest: DigestV2
  readonly initiatorChannelNonce: Id128V2
  readonly responderChannelNonce: Id128V2
  readonly channelContractDigest: DigestV2
  readonly protocolDigest: DigestV2
}

export interface PeerChannelOpenV2 {
  readonly format: "convax.peer-channel-open/2"
  readonly core: PeerChannelOpenCoreV2
  readonly coreDigest: DigestV2
  readonly initiatorSessionSignature: SignatureV2
  readonly responderSessionSignature: SignatureV2
}
