import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { BrowserWindow, MessageChannelMain, session } from "electron"

import type { CollaborationSessionDataPlane, CollaborationSessionDataPlaneLifecycle } from "../collaboration/session-orchestrator"
import type { CollaborationPeerWireIngress, CollaborationPeerChannel, CollaborationPeerSessionScope } from "../collaboration/peerjs-transport"
import {
  parsePeerJsTransportHostEventV1,
  parsePeerJsTransportServerConfigV1,
  peerJsTransportHostBindChannelV1,
  peerJsTransportHostLimitsV1,
  peerJsTransportHostPortProtocolV1,
  type PeerJsTransportServerConfigV1,
} from "../collaboration/peerjs-transport-host-protocol"

const peerJsTransportPreload = join(import.meta.dirname, "../preload/peerjs-transport-host.js")
const peerJsTransportPage = `data:text/html;charset=UTF-8,${encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src https: wss:"></head><body></body></html>`)}`

interface HostMessagePortMain {
  close(): void
  on(event: "close", listener: () => void): unknown
  on(event: "message", listener: (event: { data: unknown }) => void): unknown
  postMessage(value: unknown): void
  start(): void
}

interface HostMessageChannelMain {
  port1: HostMessagePortMain
  port2: unknown
}

interface PeerJsHostWebContentsV1 {
  isDestroyed(): boolean
  once(event: "did-finish-load", listener: () => void): unknown
  on(event: "will-navigate", listener: (event: { preventDefault(): void }) => void): unknown
  postMessage(channel: string, value: unknown, transfer: readonly unknown[]): void
  setWindowOpenHandler(handler: () => { action: "deny" }): void
}

interface PeerJsHostWindowV1 {
  readonly webContents: PeerJsHostWebContentsV1
  destroy(): void
  isDestroyed(): boolean
  loadURL(url: string): Promise<void>
  once(event: "closed", listener: () => void): unknown
}

export interface ElectronPeerJsTransportDataPlaneV1 extends CollaborationSessionDataPlane {
  readonly whenReady: Promise<void>
  quiesce(): Promise<void>
}

/**
 * Main retains authority and signs/verifies outside this adapter. The hidden
 * sandbox receives only route ids, physical config and already-opaque wire bytes.
 */
export function createElectronPeerJsTransportDataPlaneV1(input: {
  readonly localPeerId: string
  readonly sessionScope: CollaborationPeerSessionScope
  readonly server: PeerJsTransportServerConfigV1
  readonly ingress: CollaborationPeerWireIngress
  readonly lifecycle: CollaborationSessionDataPlaneLifecycle
  readonly onFatal?: (reason: "webrtc-unavailable" | "initialization-failed" | "protocol-invalid" | "host-closed") => void
  readonly preloadPath?: string
  readonly createMessageChannel?: () => HostMessageChannelMain
  readonly createWindow?: (options: Electron.BrowserWindowConstructorOptions) => PeerJsHostWindowV1
  readonly createSession?: () => Electron.Session
  readonly setTimeout?: (callback: () => void, delayMs: number) => unknown
  readonly clearTimeout?: (handle: unknown) => void
}): ElectronPeerJsTransportDataPlaneV1 {
  const server = parsePeerJsTransportServerConfigV1(input.server)
  const createMessageChannel = input.createMessageChannel ?? (() => new MessageChannelMain())
  const hiddenSession = input.createSession?.() ?? session.fromPartition(`convax-peerjs-${randomUUID()}`, { cache: false })
  hiddenSession.setPermissionCheckHandler(() => false)
  hiddenSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  hiddenSession.on("will-download", (event) => event.preventDefault())
  const createWindow = input.createWindow ?? ((options) => new BrowserWindow(options))
  const window = createWindow({
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      preload: input.preloadPath ?? peerJsTransportPreload,
      safeDialogs: true,
      sandbox: true,
      session: hiddenSession,
      webSecurity: true,
      webviewTag: false,
    },
  })
  const { port1, port2 } = createMessageChannel()
  const peers = new Set<string>()
  const pendingSends = new Map<number, string>()
  let nextRequestId = 1
  let ready = false
  let bound = false
  let closing = false
  let closed = false
  let closeTimer: unknown
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  let resolveQuiesce!: () => void
  const whenReady = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // A caller may rely only on events and never await readiness.
  void whenReady.catch(() => undefined)
  const quiesced = new Promise<void>((resolve) => { resolveQuiesce = resolve })
  const schedule = input.setTimeout ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs))
  const cancel = input.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as number))

  const resetRoutes = () => {
    for (const peerId of peers) input.lifecycle.onRouteReset(peerId)
    pendingSends.clear()
  }
  const finalize = (reason?: "webrtc-unavailable" | "initialization-failed" | "protocol-invalid" | "host-closed") => {
    if (closed) return
    closed = true
    ready = false
    if (closeTimer !== undefined) cancel(closeTimer)
    closeTimer = undefined
    resetRoutes()
    try { port1.close() } catch {}
    if (!window.isDestroyed()) window.destroy()
    if (reason) {
      rejectReady(new Error(`PeerJS transport host failed: ${reason}`))
      input.onFatal?.(reason)
    }
    resolveQuiesce()
  }
  const post = (command: Record<string, unknown>) => {
    if (closed) return false
    try {
      port1.postMessage({ protocol: peerJsTransportHostPortProtocolV1, ...command })
      return true
    } catch {
      finalize("host-closed")
      return false
    }
  }
  const failEvent = () => {
    if (!closing) finalize("protocol-invalid")
    else finalize()
  }

  port1.on("message", ({ data }) => {
    if (closed) return
    let event
    try { event = parsePeerJsTransportHostEventV1(data) } catch {
      failEvent()
      return
    }
    switch (event.type) {
      case "ready":
        if (ready || closing) return failEvent()
        ready = true
        resolveReady()
        return
      case "wireBytes":
        if (!ready || closing) return failEvent()
        try { input.ingress.receivePeerWireBytes(event) } catch {
          input.lifecycle.onRouteReset(event.peerId)
        }
        return
      case "route-ready":
        if (!ready || closing || !peers.has(event.peerId)) return
        input.lifecycle.onRouteReady(event.peerId)
        return
      case "route-reset":
        if (!closing && peers.has(event.peerId)) input.lifecycle.onRouteReset(event.peerId)
        return
      case "send-result": {
        const expectedPeer = pendingSends.get(event.requestId)
        if (expectedPeer === undefined || expectedPeer !== event.peerId) return failEvent()
        pendingSends.delete(event.requestId)
        if (!event.accepted && peers.has(event.peerId)) input.lifecycle.onRouteReset(event.peerId)
        return
      }
      case "transport-error":
        if (event.peerId !== null && peers.has(event.peerId)) input.lifecycle.onRouteReset(event.peerId)
        else if (event.reason === "peer-error") resetRoutes()
        return
      case "fatal":
        finalize(event.reason)
        return
      case "disposed":
        if (!closing) return failEvent()
        finalize()
    }
  })
  port1.on("close", () => {
    if (!closed) finalize(closing ? undefined : "host-closed")
  })
  port1.start()

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event) => event.preventDefault())
  window.webContents.once("did-finish-load", () => {
    if (closed || window.webContents.isDestroyed()) return
    bound = true
    window.webContents.postMessage(
      peerJsTransportHostBindChannelV1,
      { protocol: peerJsTransportHostPortProtocolV1 },
      [port2 as Electron.MessagePortMain],
    )
  })
  window.once("closed", () => {
    if (!closed) finalize(closing ? undefined : "host-closed")
  })
  void window.loadURL(peerJsTransportPage).catch(() => finalize("host-closed"))

  post({
    type: "initialize",
    localPeerId: input.localPeerId,
    sessionScope: input.sessionScope,
    server,
  })

  const send = (peerId: string, channel: CollaborationPeerChannel, purpose: "handshake" | "message", wireBytes: Uint8Array) => {
    if (!ready || closing || closed || !peers.has(peerId) || pendingSends.size >= peerJsTransportHostLimitsV1.maxPendingSends) return false
    const requestId = nextRequestId
    nextRequestId = nextRequestId === 0xffff_ffff ? 1 : nextRequestId + 1
    if (pendingSends.has(requestId)) return false
    pendingSends.set(requestId, peerId)
    if (!post({ type: "send", requestId, peerId, channel, purpose, wireBytes: new Uint8Array(wireBytes) })) {
      pendingSends.delete(requestId)
      return false
    }
    return true
  }

  const dataPlane: ElectronPeerJsTransportDataPlaneV1 = {
    whenReady,
    connect(peerId) {
      if (closing || closed || peers.has(peerId) || peers.size >= peerJsTransportHostLimitsV1.maxPeers) return
      peers.add(peerId)
      post({ type: "connect", peerId })
    },
    sendHandshakeWireBytes: (peerId, exactHandshakeBytes) => send(peerId, "control", "handshake", exactHandshakeBytes),
    sendPeerWireBytes: (peerId, channel, exactPeerWireBytes) => send(peerId, channel, "message", exactPeerWireBytes),
    markHandshakeComplete(peerId) {
      return ready && !closing && peers.has(peerId) && post({ type: "mark-handshake-complete", peerId })
    },
    setOnline(online) {
      if (!closing && !closed) post({ type: "set-online", online })
    },
    closePeer(peerId) {
      if (!peers.delete(peerId) || closing || closed) return
      for (const [requestId, pendingPeer] of pendingSends) if (pendingPeer === peerId) pendingSends.delete(requestId)
      post({ type: "close-peer", peerId })
    },
    dispose() { void dataPlane.quiesce() },
    async quiesce() {
      if (closed) return
      if (!closing) {
        closing = true
        if (!bound || !post({ type: "dispose" })) {
          finalize()
        } else {
          closeTimer = schedule(() => finalize("host-closed"), 2_000)
        }
      }
      await quiesced
    },
  }
  return Object.freeze(dataPlane)
}
