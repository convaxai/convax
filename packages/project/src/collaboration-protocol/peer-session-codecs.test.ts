import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  parseDigest,
  parseId128,
  parsePeerId,
  parseProjectId,
  parseSignature,
} from "@convax/collaboration"

import { PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2 } from "./kernel-integration"
import {
  parsePeerChannelOpenV2,
  parsePeerHandshakeV2,
  peerChannelOpenCoreDigestV2,
  peerHandshakeCoreDigestV2,
} from "./peer-session-codecs"

const id = (fill: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(fill)))
const digest = (fill: string) => parseDigest(fill.repeat(64))
const signature = parseSignature(encodeBase64url(new Uint8Array(64).fill(7)))

describe("R5 peer session codecs", () => {
  const handshakeCore = {
    format: "convax.peer-handshake-core/2" as const,
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
    protocolDigest: parseDigest(PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2.requiredProtocolDigest),
  }

  test("closes and digest-binds the exact R5 handshake", () => {
    const value = {
      format: "convax.peer-handshake/2" as const,
      core: handshakeCore,
      coreDigest: peerHandshakeCoreDigestV2(handshakeCore),
      initiatorSessionSignature: signature,
      responderSessionSignature: signature,
    }
    expect(parsePeerHandshakeV2(value)).toEqual(value)
    expect(() => parsePeerHandshakeV2({ ...value, peerId: "metadata-is-not-identity" })).toThrow()
    expect(() => parsePeerHandshakeV2({ ...value, core: { ...handshakeCore, responderPeerId: handshakeCore.initiatorPeerId } })).toThrow("differ")
    expect(() => parsePeerHandshakeV2({ ...value, coreDigest: digest("e") })).toThrow("digest")
  })

  test("binds every channel-open to one handshake, credential pair and selected protocol", () => {
    const core = {
      format: "convax.peer-channel-open-core/2" as const,
      connectionId: handshakeCore.connectionId,
      handshakeDigest: peerHandshakeCoreDigestV2(handshakeCore),
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
      format: "convax.peer-channel-open/2" as const,
      core,
      coreDigest: peerChannelOpenCoreDigestV2(core),
      initiatorSessionSignature: signature,
      responderSessionSignature: signature,
    }
    expect(parsePeerChannelOpenV2(value)).toEqual(value)
    expect(() => parsePeerChannelOpenV2({ ...value, core: { ...core, channel: "inventory" } })).toThrow("channel")
    expect(() => parsePeerChannelOpenV2({ ...value, core: { ...core, protocolDigest: digest("f") } })).toThrow("selected R5")
  })
})
