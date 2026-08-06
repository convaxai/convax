import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  parseDigest,
  parseId128,
  parsePeerId,
  parseProjectId,
  parseSignature,
} from "@convax/collaboration"

import { PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION } from "./kernel-integration"
import {
  parsePeerChannelOpen,
  parsePeerHandshake,
  peerChannelOpenCoreDigest,
  peerHandshakeCoreDigest,
} from "./peer-session-codecs"

const id = (fill: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(fill)))
const digest = (fill: string) => parseDigest(fill.repeat(64))
const signature = parseSignature(encodeBase64url(new Uint8Array(64).fill(7)))

describe("Peer session codecs", () => {
  const handshakeCore = {
    format: "convax.peer-handshake-core" as const,
    connectionId: id(1),
    projectId: parseProjectId("project-peer-session"),
    projectEpoch: id(2),
    membershipEpoch: id(3),
    freshnessTicketDigest: digest("a"),
    initiatorCredentialDigest: digest("b"),
    responderCredentialDigest: digest("c"),
    initiatorPeerId: parsePeerId(`peer_${"a".repeat(26)}`),
    responderPeerId: parsePeerId(`peer_${"b".repeat(25)}a`),
    initiatorNonce: id(4),
    responderNonce: id(5),
    channelContractDigest: digest("d"),
    protocolDigest: parseDigest(PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION.requiredProtocolDigest),
  }

  test("closes and digest-binds the exact current handshake", () => {
    const value = {
      format: "convax.peer-handshake" as const,
      core: handshakeCore,
      coreDigest: peerHandshakeCoreDigest(handshakeCore),
      initiatorSessionSignature: signature,
      responderSessionSignature: signature,
    }
    expect(parsePeerHandshake(value)).toEqual(value)
    expect(() => parsePeerHandshake({ ...value, peerId: "metadata-is-not-identity" })).toThrow()
    expect(() => parsePeerHandshake({ ...value, core: { ...handshakeCore, responderPeerId: handshakeCore.initiatorPeerId } })).toThrow("differ")
    expect(() => parsePeerHandshake({ ...value, coreDigest: digest("e") })).toThrow("digest")
  })

  test("binds every channel-open to one handshake, credential pair and selected protocol", () => {
    const core = {
      format: "convax.peer-channel-open-core" as const,
      connectionId: handshakeCore.connectionId,
      handshakeDigest: peerHandshakeCoreDigest(handshakeCore),
      channel: "update" as const,
      channelOpenId: id(6),
      initiatorCredentialDigest: handshakeCore.initiatorCredentialDigest,
      responderCredentialDigest: handshakeCore.responderCredentialDigest,
      initiatorChannelNonce: id(7),
      responderChannelNonce: id(8),
      channelContractDigest: handshakeCore.channelContractDigest,
      protocolDigest: handshakeCore.protocolDigest,
    }
    const value = {
      format: "convax.peer-channel-open" as const,
      core,
      coreDigest: peerChannelOpenCoreDigest(core),
      initiatorSessionSignature: signature,
      responderSessionSignature: signature,
    }
    expect(parsePeerChannelOpen(value)).toEqual(value)
    expect(() => parsePeerChannelOpen({ ...value, core: { ...core, channel: "inventory" } })).toThrow("channel")
    expect(() => parsePeerChannelOpen({ ...value, core: { ...core, protocolDigest: digest("f") } })).toThrow("current protocol digest")
  })
})
