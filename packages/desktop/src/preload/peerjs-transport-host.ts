import { ipcRenderer } from "electron"
import { Peer } from "peerjs"

import { bindPeerJsTransportBrowserHostV1 } from "../collaboration/peerjs-transport-browser-host"
import { CollaborationPeerJsTransport, createPeerJsLikeFactory } from "../collaboration/peerjs-transport"

bindPeerJsTransportBrowserHostV1({
  ipc: ipcRenderer,
  hasRtcPeerConnection: () => typeof globalThis.RTCPeerConnection === "function",
  createTransport(input) {
    return new CollaborationPeerJsTransport({
      factory: createPeerJsLikeFactory((localPeerId) => new Peer(localPeerId, {
        host: input.server.host,
        port: input.server.port,
        path: input.server.path,
        secure: input.server.secure,
        ...(input.server.key ? { key: input.server.key } : {}),
        config: {
          iceServers: input.server.iceServers.map((server) => ({
            urls: [...server.urls],
            ...(server.username !== undefined ? { username: server.username } : {}),
            ...(server.credential !== undefined ? { credential: server.credential } : {}),
          })),
        },
      })),
      localPeerId: input.localPeerId,
      sessionScope: input.sessionScope,
      peerWireIngress: input.peerWireIngress,
      connectivity: {
        isOnline: () => globalThis.navigator.onLine,
        subscribe(handlers) {
          const online = () => handlers.onOnline()
          const offline = () => handlers.onOffline()
          globalThis.addEventListener("online", online)
          globalThis.addEventListener("offline", offline)
          return () => {
            globalThis.removeEventListener("online", online)
            globalThis.removeEventListener("offline", offline)
          }
        },
      },
      onRouteReady: input.onRouteReady,
      onRouteReset: input.onRouteReset,
      onTransportError: input.onTransportError,
    })
  },
})
