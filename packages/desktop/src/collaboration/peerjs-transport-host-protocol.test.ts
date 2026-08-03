import { describe, expect, test } from "bun:test"

import {
  parsePeerJsTransportHostCommandV1,
  parsePeerJsTransportHostEventV1,
  parsePeerJsTransportServerConfigV1,
  peerJsTransportHostPortProtocolV1,
} from "./peerjs-transport-host-protocol"

const server = {
  host: "peer.example.com",
  port: 443,
  path: "/convax/",
  secure: true,
  key: "desktop",
  iceServers: [{ urls: ["stun:stun.example.com:3478"] }],
} as const

describe("PeerJS hidden-host port protocol", () => {
  test("accepts only a closed Desktop-owned transport config", () => {
    expect(parsePeerJsTransportServerConfigV1(server)).toEqual(server)
    expect(() => parsePeerJsTransportServerConfigV1({ ...server, authorization: "renderer-secret" })).toThrow("unknown")
    expect(() => parsePeerJsTransportServerConfigV1({ ...server, host: "https://peer.example.com" })).toThrow("host")
    expect(() => parsePeerJsTransportServerConfigV1({ ...server, iceServers: [{ urls: ["https://tracker"] }] })).toThrow("ICE")
  })

  test("closes command shapes and bounds copied wire bytes", () => {
    const command = {
      protocol: peerJsTransportHostPortProtocolV1,
      type: "send",
      requestId: 1,
      peerId: "remote",
      channel: "control",
      purpose: "handshake",
      wireBytes: new Uint8Array([1, 2, 3]),
    } as const
    const parsed = parsePeerJsTransportHostCommandV1(command)
    expect(parsed).toEqual(command)
    if (parsed.type !== "send") throw new Error("expected send")
    expect(parsed.wireBytes).not.toBe(command.wireBytes)
    expect(() => parsePeerJsTransportHostCommandV1({ ...command, peerCredential: "forbidden" })).toThrow("unknown")
    expect(() => parsePeerJsTransportHostCommandV1({ ...command, channel: "blob", purpose: "handshake" })).toThrow("control")
    expect(() => parsePeerJsTransportHostCommandV1({ ...command, wireBytes: new Uint8Array() })).toThrow("wire bytes")
  })

  test("rejects credentials, raw DTOs and arbitrary host events", () => {
    expect(parsePeerJsTransportHostEventV1({
      protocol: peerJsTransportHostPortProtocolV1,
      type: "route-ready",
      peerId: "remote",
    })).toEqual({ protocol: peerJsTransportHostPortProtocolV1, type: "route-ready", peerId: "remote" })
    expect(() => parsePeerJsTransportHostEventV1({
      protocol: peerJsTransportHostPortProtocolV1,
      type: "route-ready",
      peerId: "remote",
      sessionCredential: {},
    })).toThrow("unknown")
  })
})
