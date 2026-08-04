import { describe, expect, mock, test } from "bun:test"

import {
  peerJsTransportHostBindChannelV1,
  peerJsTransportHostPortProtocolV1,
} from "../collaboration/peerjs-transport-host-protocol"

mock.module("electron", () => ({
  BrowserWindow: class {},
  MessageChannelMain: class {},
  session: { fromPartition: () => ({}) },
}))

const { createElectronPeerJsTransportDataPlaneV1 } = await import("./electron-peerjs-transport-host")

class FakeMainPort {
  readonly sent: unknown[] = []
  readonly listeners = new Map<string, Array<(event?: any) => void>>()
  readonly close = mock(() => this.emit("close"))
  readonly start = mock(() => undefined)
  postMessage(value: unknown) { this.sent.push(value) }
  on(event: "close" | "message", listener: (event: any) => void) {
    const values = this.listeners.get(event) ?? []
    values.push(listener)
    this.listeners.set(event, values)
  }
  emit(event: "close" | "message", value?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(event === "message" ? { data: value } : undefined)
  }
}

function setup() {
  const port1 = new FakeMainPort()
  const port2 = { transportSide: true }
  const webListeners = new Map<string, () => void>()
  const windowListeners = new Map<string, () => void>()
  const postMessage = mock(() => undefined)
  const webContents = {
    isDestroyed: () => false,
    once: (event: string, listener: () => void) => { webListeners.set(event, listener) },
    on: mock(() => undefined),
    postMessage,
    setWindowOpenHandler: mock(() => undefined),
  }
  let destroyed = false
  const window = {
    webContents,
    destroy: mock(() => { destroyed = true; windowListeners.get("closed")?.() }),
    isDestroyed: () => destroyed,
    loadURL: mock(async () => undefined),
    once: (event: string, listener: () => void) => { windowListeners.set(event, listener) },
  }
  let windowOptions: any
  const hiddenSession = {
    setPermissionCheckHandler: mock(() => undefined),
    setPermissionRequestHandler: mock(() => undefined),
    on: mock(() => undefined),
  }
  const routesReady: string[] = []
  const routesReset: string[] = []
  const ingress: any[] = []
  const fatal: string[] = []
  const plane = createElectronPeerJsTransportDataPlaneV1({
    localPeerId: "local",
    sessionScope: { credentialEpoch: "credential-1", documentEpoch: "document-1" },
    server: { host: "peer.example.com", port: 443, path: "/convax/", secure: true, iceServers: [] },
    ingress: { receivePeerWireBytes: (value) => ingress.push(value) },
    lifecycle: {
      onRouteReady: (peerId) => routesReady.push(peerId),
      onRouteReset: (peerId) => routesReset.push(peerId),
    },
    onFatal: (reason) => fatal.push(reason),
    createMessageChannel: () => ({ port1, port2 }),
    createSession: () => hiddenSession as never,
    createWindow: (options) => { windowOptions = options; return window as never },
    setTimeout: () => 1,
    clearTimeout: () => undefined,
  })
  const event = (value: unknown) => port1.emit("message", value)
  return {
    event,
    fatal,
    hiddenSession,
    ingress,
    plane,
    port1,
    port2,
    postMessage,
    routesReady,
    routesReset,
    webContents,
    webListeners,
    window,
    windowOptions: () => windowOptions,
  }
}

function ready(harness: ReturnType<typeof setup>) {
  harness.webListeners.get("did-finish-load")!()
  harness.event({ protocol: peerJsTransportHostPortProtocolV1, type: "ready" })
}

describe("Electron hidden PeerJS transport host", () => {
  test("creates a hidden sandbox with an ephemeral deny-all session and one private port", async () => {
    const harness = setup()
    const preferences = harness.windowOptions().webPreferences
    expect(harness.windowOptions().show).toBe(false)
    expect(preferences).toEqual(expect.objectContaining({
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    }))
    expect(preferences.preload).toEndWith("/preload/peerjs-transport-host.js")
    expect(harness.hiddenSession.setPermissionCheckHandler).toHaveBeenCalledTimes(1)
    expect(harness.hiddenSession.setPermissionRequestHandler).toHaveBeenCalledTimes(1)
    expect(harness.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1)

    harness.webListeners.get("did-finish-load")!()
    expect(harness.postMessage).toHaveBeenCalledWith(
      peerJsTransportHostBindChannelV1,
      { protocol: peerJsTransportHostPortProtocolV1 },
      [harness.port2],
    )
    expect((harness.port1.sent[0] as any).type).toBe("initialize")
    expect(harness.port1.sent[0]).not.toHaveProperty("credential")
    const quiescing = harness.plane.quiesce()
    harness.event({ protocol: peerJsTransportHostPortProtocolV1, type: "disposed" })
    await quiescing
  })

  test("bounds sends until ready and treats negative async admission as a route reset", async () => {
    const harness = setup()
    harness.plane.connect("remote")
    expect(harness.plane.sendHandshakeWireBytes("remote", new Uint8Array([1]))).toBe(false)
    ready(harness)
    await harness.plane.whenReady
    harness.event({ protocol: peerJsTransportHostPortProtocolV1, type: "route-ready", peerId: "remote" })
    expect(harness.routesReady).toEqual(["remote"])
    expect(harness.plane.sendHandshakeWireBytes("remote", new Uint8Array([1]))).toBe(true)
    const send = harness.port1.sent.find((value: any) => value.type === "send") as any
    expect(send).toEqual(expect.objectContaining({ peerId: "remote", channel: "control", purpose: "handshake" }))
    expect(send.wireBytes).toEqual(new Uint8Array([1]))
    harness.event({
      protocol: peerJsTransportHostPortProtocolV1,
      type: "send-result",
      requestId: send.requestId,
      peerId: "remote",
      accepted: false,
    })
    expect(harness.routesReset).toEqual(["remote"])
    harness.plane.dispose()
    harness.event({ protocol: peerJsTransportHostPortProtocolV1, type: "disposed" })
  })

  test("copies peer wire ingress without accepting authority DTOs", () => {
    const harness = setup()
    harness.plane.connect("remote")
    ready(harness)
    const bytes = new Uint8Array([4, 5])
    harness.event({
      protocol: peerJsTransportHostPortProtocolV1,
      type: "wireBytes",
      peerId: "remote",
      channel: "update",
      purpose: "message",
      wireBytes: bytes,
    })
    expect(harness.ingress).toEqual([expect.objectContaining({ peerId: "remote", channel: "update", wireBytes: bytes })])
    expect(harness.ingress[0].wireBytes).not.toBe(bytes)
    harness.event({
      protocol: peerJsTransportHostPortProtocolV1,
      type: "route-ready",
      peerId: "remote",
      sessionCredential: {},
    })
    expect(harness.fatal).toEqual(["protocol-invalid"])
  })

  test("quiesce waits for the hidden host disposal receipt before destroying the window", async () => {
    const harness = setup()
    ready(harness)
    let completed = false
    const quiescing = harness.plane.quiesce().then(() => { completed = true })
    await Promise.resolve()
    expect(completed).toBe(false)
    expect((harness.port1.sent.at(-1) as any).type).toBe("dispose")
    expect(harness.window.destroy).not.toHaveBeenCalled()
    harness.event({ protocol: peerJsTransportHostPortProtocolV1, type: "disposed" })
    await quiescing
    expect(harness.window.destroy).toHaveBeenCalledTimes(1)
    expect(completed).toBe(true)
  })
})
