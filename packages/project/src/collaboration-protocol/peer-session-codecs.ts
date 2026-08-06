import {
  assertExactKeys,
  parseDigest,
  parseId128,
  parsePeerId,
  parseProjectId,
  parseSignature,
  structuredDigest,
  type Digest,
} from "@convax/collaboration"

import { PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2 } from "./kernel-integration"
import type {
  PeerChannelOpenCoreV2,
  PeerChannelOpenV2,
  PeerChannelV2,
  PeerHandshakeCoreV2,
  PeerHandshakeV2,
} from "./peer-session-contracts"

export function peerHandshakeCoreDigestV2(core: PeerHandshakeCoreV2): Digest {
  return structuredDigest("convax.peer-handshake-core/2", parsePeerHandshakeCoreV2(core))
}

export function peerChannelOpenCoreDigestV2(core: PeerChannelOpenCoreV2): Digest {
  return structuredDigest("convax.peer-channel-open-core/2", parsePeerChannelOpenCoreV2(core))
}

export function parsePeerHandshakeCoreV2(value: unknown): PeerHandshakeCoreV2 {
  assertExactKeys(value, [
    "format", "connectionId", "projectId", "projectEpoch", "membershipEpoch", "freshnessTicketDigest",
    "initiatorCredentialDigest", "responderCredentialDigest", "initiatorPeerId", "responderPeerId",
    "initiatorNonce", "responderNonce", "channelContractDigest", "protocolDigest",
  ], "PeerHandshakeCoreV2")
  if (value.format !== "convax.peer-handshake-core/2") invalid("Peer handshake core format is invalid")
  const initiatorPeerId = parsePeerId(value.initiatorPeerId)
  const responderPeerId = parsePeerId(value.responderPeerId)
  if (initiatorPeerId === responderPeerId) invalid("Peer handshake endpoints must differ")
  return Object.freeze({
    format: value.format,
    connectionId: parseId128(value.connectionId),
    projectId: parseProjectId(value.projectId),
    projectEpoch: parseId128(value.projectEpoch),
    membershipEpoch: parseId128(value.membershipEpoch),
    freshnessTicketDigest: parseDigest(value.freshnessTicketDigest),
    initiatorCredentialDigest: parseDigest(value.initiatorCredentialDigest),
    responderCredentialDigest: parseDigest(value.responderCredentialDigest),
    initiatorPeerId,
    responderPeerId,
    initiatorNonce: parseId128(value.initiatorNonce),
    responderNonce: parseId128(value.responderNonce),
    channelContractDigest: parseDigest(value.channelContractDigest),
    protocolDigest: protocolDigest(value.protocolDigest),
  })
}

export function parsePeerHandshakeV2(value: unknown): PeerHandshakeV2 {
  assertExactKeys(value, ["format", "core", "coreDigest", "initiatorSessionSignature", "responderSessionSignature"], "PeerHandshakeV2")
  if (value.format !== "convax.peer-handshake/2") invalid("Peer handshake format is invalid")
  const core = parsePeerHandshakeCoreV2(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== peerHandshakeCoreDigestV2(core)) invalid("Peer handshake core digest mismatches")
  return Object.freeze({
    format: value.format,
    core,
    coreDigest,
    initiatorSessionSignature: parseSignature(value.initiatorSessionSignature),
    responderSessionSignature: parseSignature(value.responderSessionSignature),
  })
}

export function parsePeerChannelOpenCoreV2(value: unknown): PeerChannelOpenCoreV2 {
  assertExactKeys(value, [
    "format", "connectionId", "handshakeDigest", "channel", "channelOpenId", "initiatorCredentialDigest",
    "responderCredentialDigest", "initiatorChannelNonce", "responderChannelNonce", "channelContractDigest", "protocolDigest",
  ], "PeerChannelOpenCoreV2")
  if (value.format !== "convax.peer-channel-open-core/2") invalid("Peer channel-open core format is invalid")
  return Object.freeze({
    format: value.format,
    connectionId: parseId128(value.connectionId),
    handshakeDigest: parseDigest(value.handshakeDigest),
    channel: parsePeerChannelV2(value.channel),
    channelOpenId: parseId128(value.channelOpenId),
    initiatorCredentialDigest: parseDigest(value.initiatorCredentialDigest),
    responderCredentialDigest: parseDigest(value.responderCredentialDigest),
    initiatorChannelNonce: parseId128(value.initiatorChannelNonce),
    responderChannelNonce: parseId128(value.responderChannelNonce),
    channelContractDigest: parseDigest(value.channelContractDigest),
    protocolDigest: protocolDigest(value.protocolDigest),
  })
}

export function parsePeerChannelOpenV2(value: unknown): PeerChannelOpenV2 {
  assertExactKeys(value, ["format", "core", "coreDigest", "initiatorSessionSignature", "responderSessionSignature"], "PeerChannelOpenV2")
  if (value.format !== "convax.peer-channel-open/2") invalid("Peer channel-open format is invalid")
  const core = parsePeerChannelOpenCoreV2(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== peerChannelOpenCoreDigestV2(core)) invalid("Peer channel-open core digest mismatches")
  return Object.freeze({
    format: value.format,
    core,
    coreDigest,
    initiatorSessionSignature: parseSignature(value.initiatorSessionSignature),
    responderSessionSignature: parseSignature(value.responderSessionSignature),
  })
}

export function parsePeerChannelV2(value: unknown): PeerChannelV2 {
  if (value !== "control" && value !== "update" && value !== "blob" && value !== "awareness") {
    invalid("Peer channel is invalid")
  }
  return value
}

function protocolDigest(value: unknown): Digest {
  const digest = parseDigest(value)
  if (digest !== PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2.requiredProtocolDigest) {
    invalid("Peer session protocol digest is not the current protocol digest")
  }
  return digest
}

function invalid(message: string): never {
  throw new TypeError(message)
}
