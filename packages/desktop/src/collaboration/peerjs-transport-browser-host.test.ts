import { describe, expect, mock, test } from "bun:test"

import {
  bindPeerJsTransportBrowserHostV1,
  type PeerJsTransportBrowserMessagePortV1,
  type PeerJsTransportBrowserPhysicalPortV1,
} from "./peerjs-transport-browser-host"
import {
  peerJsTransportHostBindChannelV1,
  peerJsTransportHostPortProtocolV1,
} from "./peerjs-transport-host-protocol"

const initialize = {
  protocol: peerJsTransportHostPortProtocolV1,
  type: "initialize",
  localPeerId: "local",
  sessionScope: { credentialEpoch: "credential-1", documentEpoch: "project-epoch-1" },
  server: { host: "peer.example.com", port: 443, path: "/convax/", secure: true, iceServers: [] },
} as const

class FakePort implements PeerJsTransportBrowserMessagePortV1 {
  readonly sent: unknown[] = []
  readonly close = mock(() => undefined)
  readonly start = mock(() => undefined)
  onmessage: MessagePort["onmessage"] = null
  postMessage(value: unknown) { this.sent.push(value) }
  receive(data: unknown) { this.onmessage?.call(this as never, { data } as MessageEvent) }
}

function setup(hasRtcPeerConnection = true) {
  let bind: ((event: { ports: readonly PeerJsTransportBrowserMessagePortV1[] }) => void) | undefined
  const transport: PeerJsTransportBrowserPhysicalPortV1 = {
    connect: mock(() => undefined),
    sendHandshakeWireBytes: mock(() => true),
    sendPeerWireBytes: mock(() => true),
    markHandshakeComplete: mock(() => true),
    setSessionScope: mock(() => undefined),
    setOnline: mock(() => undefined),
    closePeer: mock(() => undefined),
    dispose: mock(() => undefined),
  }
  let callbacks: any
  bindPeerJsTransportBrowserHostV1({
    ipc: {
      once(channel, listener) {
        expect(channel).toBe(peerJsTransportHostBindChannelV1)
        bind = listener
      },
    },
    hasRtcPeerConnection: () => hasRtcPeerConnection,
    createTransport(input) {
      callbacks = input
      return transport
    },
  })
  const port = new FakePort()
  bind!({ ports: [port] })
  return { callbacks: () => callbacks, port, transport }
}

describe("sandboxed PeerJS browser host", () => {
  test("initializes one peer-wire-only physical transport and relays bounded events", () => {
    const harness = setup()
    expect(harness.port.start).toHaveBeenCalledTimes(1)
    harness.port.receive(initialize)
    expect(harness.port.sent).toContainEqual({ protocol: peerJsTransportHostPortProtocolV1, type: "ready" })

    harness.port.receive({ protocol: peerJsTransportHostPortProtocolV1, type: "connect", peerId: "remote" })
    expect(harness.transport.connect).toHaveBeenCalledWith("remote")
    harness.callbacks().onRouteReady("remote")
    expect(harness.port.sent).toContainEqual({ protocol: peerJsTransportHostPortProtocolV1, type: "route-ready", peerId: "remote" })

    const wireBytes = new Uint8Array([1, 2])
    harness.callbacks().peerWireIngress.receivePeerWireBytes({ peerId: "remote", channel: "update", purpose: "message", wireBytes })
    const relayed = harness.port.sent.find((value: any) => value.type === "wireBytes") as any
    expect(relayed).toEqual(expect.objectContaining({ peerId: "remote", channel: "update", purpose: "message", wireBytes }))
    expect(relayed.wireBytes).not.toBe(wireBytes)
    expect(relayed).not.toHaveProperty("credential")
  })

  test("reports send admission and awaits explicit dispose command", () => {
    const harness = setup()
    harness.port.receive(initialize)
    harness.port.receive({
      protocol: peerJsTransportHostPortProtocolV1,
      type: "send",
      requestId: 1,
      peerId: "remote",
      channel: "control",
      purpose: "handshake",
      wireBytes: new Uint8Array([7]),
    })
    expect(harness.transport.sendHandshakeWireBytes).toHaveBeenCalledWith("remote", new Uint8Array([7]))
    expect(harness.port.sent).toContainEqual({
      protocol: peerJsTransportHostPortProtocolV1,
      type: "send-result",
      requestId: 1,
      peerId: "remote",
      accepted: true,
    })
    harness.port.receive({ protocol: peerJsTransportHostPortProtocolV1, type: "dispose" })
    expect(harness.transport.dispose).toHaveBeenCalledTimes(1)
    expect(harness.port.sent.at(-1)).toEqual({ protocol: peerJsTransportHostPortProtocolV1, type: "disposed" })
    expect(harness.port.close).toHaveBeenCalledTimes(1)
  })

  test("fails closed when the dedicated Chromium context has no WebRTC", () => {
    const harness = setup(false)
    harness.port.receive(initialize)
    expect(harness.port.sent).toContainEqual({
      protocol: peerJsTransportHostPortProtocolV1,
      type: "fatal",
      reason: "webrtc-unavailable",
    })
    expect(harness.transport.dispose).not.toHaveBeenCalled()
    expect(harness.port.close).toHaveBeenCalledTimes(1)
  })

  test("closes the port on a duplicate initialize or an unknown field", () => {
    for (const command of [initialize, { ...initialize, credential: "forbidden" }]) {
      const harness = setup()
      harness.port.receive(initialize)
      harness.port.receive(command)
      expect(harness.port.sent).toContainEqual({
        protocol: peerJsTransportHostPortProtocolV1,
        type: "fatal",
        reason: "protocol-invalid",
      })
      expect(harness.port.close).toHaveBeenCalledTimes(1)
    }
  })
})
