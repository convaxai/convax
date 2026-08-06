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

import { PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION } from "./kernel-integration"
import type {
  PeerChannelOpenCore,
  PeerChannelOpen,
  PeerChannel,
  PeerHandshakeCore,
  PeerHandshake,
} from "./peer-session-contracts"

export function peerHandshakeCoreDigest(core: PeerHandshakeCore): Digest {
  return structuredDigest("convax.peer-handshake-core", parsePeerHandshakeCore(core))
}

export function peerChannelOpenCoreDigest(core: PeerChannelOpenCore): Digest {
  return structuredDigest("convax.peer-channel-open-core", parsePeerChannelOpenCore(core))
}

export function parsePeerHandshakeCore(value: unknown): PeerHandshakeCore {
  assertExactKeys(value, [
    "format", "connectionId", "projectId", "projectEpoch", "membershipEpoch", "freshnessTicketDigest",
    "initiatorCredentialDigest", "responderCredentialDigest", "initiatorPeerId", "responderPeerId",
    "initiatorNonce", "responderNonce", "channelContractDigest", "protocolDigest",
  ], "PeerHandshakeCore")
  if (value.format !== "convax.peer-handshake-core") invalid("Peer handshake core format is invalid")
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

export function parsePeerHandshake(value: unknown): PeerHandshake {
  assertExactKeys(value, ["format", "core", "coreDigest", "initiatorSessionSignature", "responderSessionSignature"], "PeerHandshake")
  if (value.format !== "convax.peer-handshake") invalid("Peer handshake format is invalid")
  const core = parsePeerHandshakeCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== peerHandshakeCoreDigest(core)) invalid("Peer handshake core digest mismatches")
  return Object.freeze({
    format: value.format,
    core,
    coreDigest,
    initiatorSessionSignature: parseSignature(value.initiatorSessionSignature),
    responderSessionSignature: parseSignature(value.responderSessionSignature),
  })
}

export function parsePeerChannelOpenCore(value: unknown): PeerChannelOpenCore {
  assertExactKeys(value, [
    "format", "connectionId", "handshakeDigest", "channel", "channelOpenId", "initiatorCredentialDigest",
    "responderCredentialDigest", "initiatorChannelNonce", "responderChannelNonce", "channelContractDigest", "protocolDigest",
  ], "PeerChannelOpenCore")
  if (value.format !== "convax.peer-channel-open-core") invalid("Peer channel-open core format is invalid")
  return Object.freeze({
    format: value.format,
    connectionId: parseId128(value.connectionId),
    handshakeDigest: parseDigest(value.handshakeDigest),
    channel: parsePeerChannel(value.channel),
    channelOpenId: parseId128(value.channelOpenId),
    initiatorCredentialDigest: parseDigest(value.initiatorCredentialDigest),
    responderCredentialDigest: parseDigest(value.responderCredentialDigest),
    initiatorChannelNonce: parseId128(value.initiatorChannelNonce),
    responderChannelNonce: parseId128(value.responderChannelNonce),
    channelContractDigest: parseDigest(value.channelContractDigest),
    protocolDigest: protocolDigest(value.protocolDigest),
  })
}

export function parsePeerChannelOpen(value: unknown): PeerChannelOpen {
  assertExactKeys(value, ["format", "core", "coreDigest", "initiatorSessionSignature", "responderSessionSignature"], "PeerChannelOpen")
  if (value.format !== "convax.peer-channel-open") invalid("Peer channel-open format is invalid")
  const core = parsePeerChannelOpenCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== peerChannelOpenCoreDigest(core)) invalid("Peer channel-open core digest mismatches")
  return Object.freeze({
    format: value.format,
    core,
    coreDigest,
    initiatorSessionSignature: parseSignature(value.initiatorSessionSignature),
    responderSessionSignature: parseSignature(value.responderSessionSignature),
  })
}

export function parsePeerChannel(value: unknown): PeerChannel {
  if (value !== "control" && value !== "update" && value !== "blob" && value !== "awareness") {
    invalid("Peer channel is invalid")
  }
  return value
}

function protocolDigest(value: unknown): Digest {
  const digest = parseDigest(value)
  if (digest !== PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION.requiredProtocolDigest) {
    invalid("Peer session protocol digest is not the current protocol digest")
  }
  return digest
}

function invalid(message: string): never {
  throw new TypeError(message)
}
