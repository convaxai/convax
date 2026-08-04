import type {
  CollaborationPeerWireIngress,
  CollaborationPeerJsTransport,
  CollaborationPeerSessionScope,
} from "./peerjs-transport"
import {
  parsePeerJsTransportHostCommandV1,
  peerJsTransportHostBindChannelV1,
  peerJsTransportHostLimitsV1,
  peerJsTransportHostPortProtocolV1,
  type PeerJsTransportHostErrorReasonV1,
  type PeerJsTransportServerConfigV1,
} from "./peerjs-transport-host-protocol"

export interface PeerJsTransportBrowserMessagePortV1 {
  close(): void
  postMessage(value: unknown): void
  start(): void
  onmessage: MessagePort["onmessage"]
}

export interface PeerJsTransportBrowserIpcV1 {
  once(channel: string, listener: (event: { ports: readonly PeerJsTransportBrowserMessagePortV1[] }) => void): void
}

export interface PeerJsTransportBrowserPhysicalPortV1 {
  connect(peerId: string): void
  sendHandshakeWireBytes(peerId: string, wireBytes: Uint8Array): boolean
  sendPeerWireBytes(peerId: string, channel: "control" | "update" | "awareness" | "blob", wireBytes: Uint8Array): boolean
  markHandshakeComplete(peerId: string): boolean
  setSessionScope(scope: CollaborationPeerSessionScope): void
  setOnline(online: boolean): void
  closePeer(peerId: string): void
  dispose(): void
}

export interface PeerJsTransportBrowserHostFactoryInputV1 {
  readonly localPeerId: string
  readonly sessionScope: CollaborationPeerSessionScope
  readonly server: PeerJsTransportServerConfigV1
  readonly peerWireIngress: CollaborationPeerWireIngress
  readonly onRouteReady: (peerId: string) => void
  readonly onRouteReset: (peerId: string) => void
  readonly onTransportError: (input: {
    peerId?: string
    channel?: "control" | "update" | "awareness" | "blob"
    reason: PeerJsTransportHostErrorReasonV1
  }) => void
}

export type PeerJsTransportBrowserHostFactoryV1 = (
  input: PeerJsTransportBrowserHostFactoryInputV1,
) => PeerJsTransportBrowserPhysicalPortV1

/** Runs only inside the dedicated sandboxed hidden preload. */
export function bindPeerJsTransportBrowserHostV1(input: {
  readonly ipc: PeerJsTransportBrowserIpcV1
  readonly createTransport: PeerJsTransportBrowserHostFactoryV1
  readonly hasRtcPeerConnection: () => boolean
}): void {
  input.ipc.once(peerJsTransportHostBindChannelV1, (event) => {
    const port = event.ports.length === 1 ? event.ports[0] : undefined
    if (!port) {
      for (const candidate of event.ports) candidate.close()
      return
    }
    let transport: PeerJsTransportBrowserPhysicalPortV1 | null = null
    let disposed = false
    const peers = new Set<string>()

    const post = (value: Record<string, unknown>) => {
      if (disposed && value.type !== "disposed") return
      port.postMessage({ protocol: peerJsTransportHostPortProtocolV1, ...value })
    }
    const shutdown = (notify = true) => {
      if (disposed) return
      disposed = true
      try { transport?.dispose() } catch {}
      transport = null
      peers.clear()
      if (notify) {
        try { port.postMessage({ protocol: peerJsTransportHostPortProtocolV1, type: "disposed" }) } catch {}
      }
      try { port.close() } catch {}
    }
    const fatal = (reason: "webrtc-unavailable" | "initialization-failed" | "protocol-invalid") => {
      post({ type: "fatal", reason })
      shutdown()
    }

    port.onmessage = ({ data }) => {
      if (disposed) return
      let command
      try {
        command = parsePeerJsTransportHostCommandV1(data)
      } catch {
        fatal("protocol-invalid")
        return
      }
      if (command.type === "initialize") {
        if (transport !== null) {
          fatal("protocol-invalid")
          return
        }
        if (!input.hasRtcPeerConnection()) {
          fatal("webrtc-unavailable")
          return
        }
        try {
          transport = input.createTransport({
            localPeerId: command.localPeerId,
            sessionScope: command.sessionScope,
            server: command.server,
            peerWireIngress: {
              receivePeerWireBytes(message) {
                post({
                  type: "wireBytes",
                  peerId: message.peerId,
                  channel: message.channel,
                  purpose: message.purpose,
                  wireBytes: new Uint8Array(message.wireBytes),
                })
              },
            },
            onRouteReady: (peerId) => post({ type: "route-ready", peerId }),
            onRouteReset: (peerId) => post({ type: "route-reset", peerId }),
            onTransportError: (error) => post({
              type: "transport-error",
              peerId: error.peerId ?? null,
              channel: error.channel ?? null,
              reason: error.reason,
            }),
          })
          post({ type: "ready" })
        } catch {
          fatal("initialization-failed")
        }
        return
      }
      if (transport === null) {
        fatal("protocol-invalid")
        return
      }
      try {
        switch (command.type) {
          case "connect":
            if (!peers.has(command.peerId) && peers.size >= peerJsTransportHostLimitsV1.maxPeers) {
              post({ type: "transport-error", peerId: command.peerId, channel: null, reason: "queue-limit" })
              return
            }
            peers.add(command.peerId)
            transport.connect(command.peerId)
            return
          case "send": {
            const accepted = command.purpose === "handshake"
              ? transport.sendHandshakeWireBytes(command.peerId, command.wireBytes)
              : transport.sendPeerWireBytes(command.peerId, command.channel, command.wireBytes)
            post({ type: "send-result", requestId: command.requestId, peerId: command.peerId, accepted })
            return
          }
          case "mark-handshake-complete":
            if (!transport.markHandshakeComplete(command.peerId)) post({ type: "route-reset", peerId: command.peerId })
            return
          case "set-session-scope":
            transport.setSessionScope(command.sessionScope)
            return
          case "set-online":
            transport.setOnline(command.online)
            return
          case "close-peer":
            peers.delete(command.peerId)
            transport.closePeer(command.peerId)
            return
          case "dispose":
            shutdown()
            return
        }
      } catch {
        post({ type: "transport-error", peerId: "peerId" in command ? command.peerId : null, channel: null, reason: "peer-error" })
      }
    }
    port.start()
  })
}

// Compile-time proof that the production physical adapter satisfies the narrow host port.
const _physicalTransportShape: PeerJsTransportBrowserPhysicalPortV1 | undefined = undefined as CollaborationPeerJsTransport | undefined
void _physicalTransportShape
