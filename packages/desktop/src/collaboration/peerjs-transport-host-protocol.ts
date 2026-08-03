import {
  collaborationPeerChannels,
  type CollaborationPeerChannel,
  type CollaborationPeerSessionScope,
} from "./peerjs-transport"

export const peerJsTransportHostBindChannelV1 = "collaboration:peerjs-transport-host-bind"
export const peerJsTransportHostPortProtocolV1 = "desktop.peerjs-transport-host/1" as const

export const peerJsTransportHostLimitsV1 = Object.freeze({
  maxPeerWireBytes: 16 * 1024 * 1024,
  maxIceServers: 16,
  maxIceUrlsPerServer: 8,
  maxPendingSends: 128,
  maxPeers: 512,
})

export interface PeerJsIceServerV1 {
  readonly urls: readonly string[]
  readonly username?: string
  readonly credential?: string
}

/** Desktop-owned physical transport config; never accepted from product renderer IPC. */
export interface PeerJsTransportServerConfigV1 {
  readonly host: string
  readonly port: number
  readonly path: string
  readonly secure: boolean
  readonly key?: string
  readonly iceServers: readonly PeerJsIceServerV1[]
}

type HostCommandBaseV1 = Readonly<{ protocol: typeof peerJsTransportHostPortProtocolV1 }>

export type PeerJsTransportHostCommandV1 = HostCommandBaseV1 & (
  | Readonly<{
      type: "initialize"
      localPeerId: string
      sessionScope: CollaborationPeerSessionScope
      server: PeerJsTransportServerConfigV1
    }>
  | Readonly<{ type: "connect"; peerId: string }>
  | Readonly<{
      type: "send"
      requestId: number
      peerId: string
      channel: CollaborationPeerChannel
      purpose: "handshake" | "message"
      wireBytes: Uint8Array
    }>
  | Readonly<{ type: "mark-handshake-complete"; peerId: string }>
  | Readonly<{ type: "set-session-scope"; sessionScope: CollaborationPeerSessionScope }>
  | Readonly<{ type: "set-online"; online: boolean }>
  | Readonly<{ type: "close-peer"; peerId: string }>
  | Readonly<{ type: "dispose" }>
)

export type PeerJsTransportHostErrorReasonV1 =
  | "connection-error"
  | "connection-open-timeout"
  | "peer-error"
  | "queue-limit"
  | "wire-invalid"
  | "reassembly-limit"
  | "ingress-error"

type HostEventBaseV1 = Readonly<{ protocol: typeof peerJsTransportHostPortProtocolV1 }>

export type PeerJsTransportHostEventV1 = HostEventBaseV1 & (
  | Readonly<{ type: "ready" }>
  | Readonly<{
      type: "wireBytes"
      peerId: string
      channel: CollaborationPeerChannel
      purpose: "handshake" | "message"
      wireBytes: Uint8Array
    }>
  | Readonly<{ type: "route-ready"; peerId: string }>
  | Readonly<{ type: "route-reset"; peerId: string }>
  | Readonly<{ type: "send-result"; requestId: number; peerId: string; accepted: boolean }>
  | Readonly<{
      type: "transport-error"
      peerId: string | null
      channel: CollaborationPeerChannel | null
      reason: PeerJsTransportHostErrorReasonV1
    }>
  | Readonly<{ type: "fatal"; reason: "webrtc-unavailable" | "initialization-failed" | "protocol-invalid" }>
  | Readonly<{ type: "disposed" }>
)

export function parsePeerJsTransportServerConfigV1(value: unknown): PeerJsTransportServerConfigV1 {
  const record = exactRecord(value, ["host", "iceServers", "path", "port", "secure"], ["key"], "PeerJS server config")
  if (typeof record.host !== "string" || record.host.length < 1 || record.host.length > 253 || /[\s/:?#@]/u.test(record.host)) {
    throw new TypeError("PeerJS server host is invalid")
  }
  if (!Number.isSafeInteger(record.port) || (record.port as number) < 1 || (record.port as number) > 65_535) {
    throw new TypeError("PeerJS server port is invalid")
  }
  if (typeof record.path !== "string" || record.path.length < 1 || record.path.length > 256 ||
    !record.path.startsWith("/") || !record.path.endsWith("/") || /[?#\0]/u.test(record.path)) {
    throw new TypeError("PeerJS server path is invalid")
  }
  if (typeof record.secure !== "boolean") throw new TypeError("PeerJS secure flag is invalid")
  if ("key" in record && (typeof record.key !== "string" || record.key.length < 1 || record.key.length > 128 || /\s|\0/u.test(record.key))) {
    throw new TypeError("PeerJS server key is invalid")
  }
  if (!Array.isArray(record.iceServers) || record.iceServers.length > peerJsTransportHostLimitsV1.maxIceServers) {
    throw new TypeError("PeerJS ICE server list is invalid")
  }
  const iceServers = record.iceServers.map((server) => parseIceServer(server))
  return Object.freeze({
    host: record.host,
    port: record.port as number,
    path: record.path,
    secure: record.secure,
    ...(typeof record.key === "string" ? { key: record.key } : {}),
    iceServers: Object.freeze(iceServers),
  })
}

export function parsePeerJsTransportHostCommandV1(value: unknown): PeerJsTransportHostCommandV1 {
  const base = requireBase(value, "PeerJS host command")
  switch (base.type) {
    case "initialize": {
      const record = exactRecord(base, ["localPeerId", "protocol", "server", "sessionScope", "type"], [], "PeerJS initialize command")
      return Object.freeze({
        protocol: peerJsTransportHostPortProtocolV1,
        type: "initialize",
        localPeerId: parseRouteId(record.localPeerId, "local Peer id"),
        sessionScope: parseSessionScope(record.sessionScope),
        server: parsePeerJsTransportServerConfigV1(record.server),
      })
    }
    case "connect":
    case "mark-handshake-complete":
    case "close-peer": {
      const record = exactRecord(base, ["peerId", "protocol", "type"], [], `PeerJS ${base.type} command`)
      return Object.freeze({ protocol: peerJsTransportHostPortProtocolV1, type: base.type, peerId: parseRouteId(record.peerId, "Peer id") })
    }
    case "send": {
      const record = exactRecord(base, ["channel", "wireBytes", "peerId", "protocol", "purpose", "requestId", "type"], [], "PeerJS send command")
      const channel = parseChannel(record.channel)
      if (record.purpose !== "handshake" && record.purpose !== "message") throw new TypeError("PeerJS send purpose is invalid")
      if (record.purpose === "handshake" && channel !== "control") throw new TypeError("PeerJS handshake must use control")
      return Object.freeze({
        protocol: peerJsTransportHostPortProtocolV1,
        type: "send",
        requestId: parseRequestId(record.requestId),
        peerId: parseRouteId(record.peerId, "Peer id"),
        channel,
        purpose: record.purpose,
        wireBytes: parsePeerWireBytes(record.wireBytes),
      })
    }
    case "set-session-scope": {
      const record = exactRecord(base, ["protocol", "sessionScope", "type"], [], "PeerJS scope command")
      return Object.freeze({ protocol: peerJsTransportHostPortProtocolV1, type: "set-session-scope", sessionScope: parseSessionScope(record.sessionScope) })
    }
    case "set-online": {
      const record = exactRecord(base, ["online", "protocol", "type"], [], "PeerJS online command")
      if (typeof record.online !== "boolean") throw new TypeError("PeerJS online state is invalid")
      return Object.freeze({ protocol: peerJsTransportHostPortProtocolV1, type: "set-online", online: record.online })
    }
    case "dispose":
      exactRecord(base, ["protocol", "type"], [], "PeerJS dispose command")
      return Object.freeze({ protocol: peerJsTransportHostPortProtocolV1, type: "dispose" })
    default:
      throw new TypeError("PeerJS host command type is invalid")
  }
}

export function parsePeerJsTransportHostEventV1(value: unknown): PeerJsTransportHostEventV1 {
  const base = requireBase(value, "PeerJS host event")
  switch (base.type) {
    case "ready":
    case "disposed":
      exactRecord(base, ["protocol", "type"], [], `PeerJS ${base.type} event`)
      return Object.freeze({ protocol: peerJsTransportHostPortProtocolV1, type: base.type })
    case "route-ready":
    case "route-reset": {
      const record = exactRecord(base, ["peerId", "protocol", "type"], [], `PeerJS ${base.type} event`)
      return Object.freeze({ protocol: peerJsTransportHostPortProtocolV1, type: base.type, peerId: parseRouteId(record.peerId, "Peer id") })
    }
    case "wireBytes": {
      const record = exactRecord(base, ["channel", "wireBytes", "peerId", "protocol", "purpose", "type"], [], "PeerJS wire-bytes event")
      const channel = parseChannel(record.channel)
      if (record.purpose !== "handshake" && record.purpose !== "message") throw new TypeError("PeerJS wire-bytes purpose is invalid")
      if (record.purpose === "handshake" && channel !== "control") throw new TypeError("PeerJS handshake must use control")
      return Object.freeze({
        protocol: peerJsTransportHostPortProtocolV1,
        type: "wireBytes",
        peerId: parseRouteId(record.peerId, "Peer id"),
        channel,
        purpose: record.purpose,
        wireBytes: parsePeerWireBytes(record.wireBytes),
      })
    }
    case "send-result": {
      const record = exactRecord(base, ["accepted", "peerId", "protocol", "requestId", "type"], [], "PeerJS send result")
      if (typeof record.accepted !== "boolean") throw new TypeError("PeerJS send result is invalid")
      return Object.freeze({
        protocol: peerJsTransportHostPortProtocolV1,
        type: "send-result",
        requestId: parseRequestId(record.requestId),
        peerId: parseRouteId(record.peerId, "Peer id"),
        accepted: record.accepted,
      })
    }
    case "transport-error": {
      const record = exactRecord(base, ["channel", "peerId", "protocol", "reason", "type"], [], "PeerJS transport error")
      if (!isTransportErrorReason(record.reason)) throw new TypeError("PeerJS transport error reason is invalid")
      return Object.freeze({
        protocol: peerJsTransportHostPortProtocolV1,
        type: "transport-error",
        peerId: record.peerId === null ? null : parseRouteId(record.peerId, "Peer id"),
        channel: record.channel === null ? null : parseChannel(record.channel),
        reason: record.reason,
      })
    }
    case "fatal": {
      const record = exactRecord(base, ["protocol", "reason", "type"], [], "PeerJS fatal event")
      if (record.reason !== "webrtc-unavailable" && record.reason !== "initialization-failed" && record.reason !== "protocol-invalid") {
        throw new TypeError("PeerJS fatal reason is invalid")
      }
      return Object.freeze({ protocol: peerJsTransportHostPortProtocolV1, type: "fatal", reason: record.reason })
    }
    default:
      throw new TypeError("PeerJS host event type is invalid")
  }
}

function parseIceServer(value: unknown): PeerJsIceServerV1 {
  const record = exactRecord(value, ["urls"], ["credential", "username"], "PeerJS ICE server")
  if (!Array.isArray(record.urls) || record.urls.length < 1 || record.urls.length > peerJsTransportHostLimitsV1.maxIceUrlsPerServer ||
    record.urls.some((url) => typeof url !== "string" || url.length < 1 || url.length > 2_048 || !/^(?:stun|stuns|turn|turns):/u.test(url))) {
    throw new TypeError("PeerJS ICE URLs are invalid")
  }
  for (const field of ["username", "credential"] as const) {
    const fieldValue = record[field]
    if (fieldValue !== undefined && (typeof fieldValue !== "string" || fieldValue.length > 1_024 || fieldValue.includes("\0"))) {
      throw new TypeError(`PeerJS ICE ${field} is invalid`)
    }
  }
  return Object.freeze({
    urls: Object.freeze([...record.urls] as string[]),
    ...(typeof record.username === "string" ? { username: record.username } : {}),
    ...(typeof record.credential === "string" ? { credential: record.credential } : {}),
  })
}

function requireBase(value: unknown, label: string): Record<string, unknown> & { type: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is invalid`)
  const record = value as Record<string, unknown>
  if (record.protocol !== peerJsTransportHostPortProtocolV1 || typeof record.type !== "string") throw new TypeError(`${label} protocol is invalid`)
  return record as Record<string, unknown> & { type: string }
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is invalid`)
  const record = value as Record<string, unknown>
  const allowed = new Set([...required, ...optional])
  if (required.some((key) => !(key in record)) || Object.keys(record).some((key) => !allowed.has(key))) {
    throw new TypeError(`${label} has unknown or missing fields`)
  }
  return record
}

function parseRouteId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || value.includes("\0")) throw new TypeError(`${label} is invalid`)
  return value
}

function parseRequestId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 0xffff_ffff) throw new TypeError("PeerJS request id is invalid")
  return value as number
}

function parseSessionScope(value: unknown): CollaborationPeerSessionScope {
  const record = exactRecord(value, ["credentialEpoch", "documentEpoch"], [], "PeerJS session scope")
  return Object.freeze({
    credentialEpoch: parseRouteId(record.credentialEpoch, "credential epoch"),
    documentEpoch: parseRouteId(record.documentEpoch, "document epoch"),
  })
}

function parseChannel(value: unknown): CollaborationPeerChannel {
  if (!collaborationPeerChannels.includes(value as CollaborationPeerChannel)) throw new TypeError("PeerJS channel is invalid")
  return value as CollaborationPeerChannel
}

function parsePeerWireBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > peerJsTransportHostLimitsV1.maxPeerWireBytes) {
    throw new TypeError("PeerJS wire bytes are invalid")
  }
  return new Uint8Array(value)
}

function isTransportErrorReason(value: unknown): value is PeerJsTransportHostErrorReasonV1 {
  return value === "connection-error" || value === "connection-open-timeout" || value === "peer-error" ||
    value === "queue-limit" || value === "wire-invalid" || value === "reassembly-limit" || value === "ingress-error"
}
