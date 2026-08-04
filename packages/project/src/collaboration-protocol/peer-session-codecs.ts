import {
  assertExactKeysV2,
  parseDigestV2,
  parseId128V2,
  parsePeerIdV2,
  parseProjectIdV2,
  parseSignatureV2,
  structuredDigestV2,
  type DigestV2,
} from "@convax/collaboration"

import { PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2 } from "./kernel-integration"
import type {
  PeerChannelOpenCoreV2,
  PeerChannelOpenV2,
  PeerChannelV2,
  PeerHandshakeCoreV2,
  PeerHandshakeV2,
} from "./peer-session-contracts"

export function peerHandshakeCoreDigestV2(core: PeerHandshakeCoreV2): DigestV2 {
  return structuredDigestV2("convax.peer-handshake-core/2", parsePeerHandshakeCoreV2(core))
}

export function peerChannelOpenCoreDigestV2(core: PeerChannelOpenCoreV2): DigestV2 {
  return structuredDigestV2("convax.peer-channel-open-core/2", parsePeerChannelOpenCoreV2(core))
}

export function parsePeerHandshakeCoreV2(value: unknown): PeerHandshakeCoreV2 {
  assertExactKeysV2(value, [
    "format", "connectionId", "projectId", "projectEpoch", "membershipEpoch", "freshnessTicketDigest",
    "initiatorCredentialDigest", "responderCredentialDigest", "initiatorPeerId", "responderPeerId",
    "initiatorNonce", "responderNonce", "channelContractDigest", "protocolDigest",
  ], "PeerHandshakeCoreV2")
  if (value.format !== "convax.peer-handshake-core/2") invalid("Peer handshake core format is invalid")
  const initiatorPeerId = parsePeerIdV2(value.initiatorPeerId)
  const responderPeerId = parsePeerIdV2(value.responderPeerId)
  if (initiatorPeerId === responderPeerId) invalid("Peer handshake endpoints must differ")
  return Object.freeze({
    format: value.format,
    connectionId: parseId128V2(value.connectionId),
    projectId: parseProjectIdV2(value.projectId),
    projectEpoch: parseId128V2(value.projectEpoch),
    membershipEpoch: parseId128V2(value.membershipEpoch),
    freshnessTicketDigest: parseDigestV2(value.freshnessTicketDigest),
    initiatorCredentialDigest: parseDigestV2(value.initiatorCredentialDigest),
    responderCredentialDigest: parseDigestV2(value.responderCredentialDigest),
    initiatorPeerId,
    responderPeerId,
    initiatorNonce: parseId128V2(value.initiatorNonce),
    responderNonce: parseId128V2(value.responderNonce),
    channelContractDigest: parseDigestV2(value.channelContractDigest),
    protocolDigest: protocolDigest(value.protocolDigest),
  })
}

export function parsePeerHandshakeV2(value: unknown): PeerHandshakeV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "initiatorSessionSignature", "responderSessionSignature"], "PeerHandshakeV2")
  if (value.format !== "convax.peer-handshake/2") invalid("Peer handshake format is invalid")
  const core = parsePeerHandshakeCoreV2(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== peerHandshakeCoreDigestV2(core)) invalid("Peer handshake core digest mismatches")
  return Object.freeze({
    format: value.format,
    core,
    coreDigest,
    initiatorSessionSignature: parseSignatureV2(value.initiatorSessionSignature),
    responderSessionSignature: parseSignatureV2(value.responderSessionSignature),
  })
}

export function parsePeerChannelOpenCoreV2(value: unknown): PeerChannelOpenCoreV2 {
  assertExactKeysV2(value, [
    "format", "connectionId", "handshakeDigest", "channel", "channelOpenId", "initiatorCredentialDigest",
    "responderCredentialDigest", "initiatorChannelNonce", "responderChannelNonce", "channelContractDigest", "protocolDigest",
  ], "PeerChannelOpenCoreV2")
  if (value.format !== "convax.peer-channel-open-core/2") invalid("Peer channel-open core format is invalid")
  return Object.freeze({
    format: value.format,
    connectionId: parseId128V2(value.connectionId),
    handshakeDigest: parseDigestV2(value.handshakeDigest),
    channel: parsePeerChannelV2(value.channel),
    channelOpenId: parseId128V2(value.channelOpenId),
    initiatorCredentialDigest: parseDigestV2(value.initiatorCredentialDigest),
    responderCredentialDigest: parseDigestV2(value.responderCredentialDigest),
    initiatorChannelNonce: parseId128V2(value.initiatorChannelNonce),
    responderChannelNonce: parseId128V2(value.responderChannelNonce),
    channelContractDigest: parseDigestV2(value.channelContractDigest),
    protocolDigest: protocolDigest(value.protocolDigest),
  })
}

export function parsePeerChannelOpenV2(value: unknown): PeerChannelOpenV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "initiatorSessionSignature", "responderSessionSignature"], "PeerChannelOpenV2")
  if (value.format !== "convax.peer-channel-open/2") invalid("Peer channel-open format is invalid")
  const core = parsePeerChannelOpenCoreV2(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== peerChannelOpenCoreDigestV2(core)) invalid("Peer channel-open core digest mismatches")
  return Object.freeze({
    format: value.format,
    core,
    coreDigest,
    initiatorSessionSignature: parseSignatureV2(value.initiatorSessionSignature),
    responderSessionSignature: parseSignatureV2(value.responderSessionSignature),
  })
}

export function parsePeerChannelV2(value: unknown): PeerChannelV2 {
  if (value !== "control" && value !== "update" && value !== "blob" && value !== "awareness") {
    invalid("Peer channel is invalid")
  }
  return value
}

function protocolDigest(value: unknown): DigestV2 {
  const digest = parseDigestV2(value)
  if (digest !== PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2.requiredProtocolDigest) {
    invalid("Peer session protocol digest is not the selected R5 digest")
  }
  return digest
}

function invalid(message: string): never {
  throw new TypeError(message)
}
