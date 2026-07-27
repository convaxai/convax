import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { constants as fsConstants, type Stats } from "node:fs"
import fs from "node:fs/promises"
import { Readable } from "node:stream"
import type { CanvasDocumentClient } from "@convax/canvas/application"
import type { CanvasDocument, CanvasNode } from "@convax/canvas/core"

import {
  pluginConnectedMediaScheme,
  type PluginConnectedMediaCloseInput,
  type PluginConnectedMediaFrameRef,
  type PluginConnectedMediaOpenInput,
  type PluginConnectedMediaOpenResult,
  type PluginConnectedMediaProbe,
} from "../plugin-connected-media-contracts"
import { matchesWebPluginCanvasNodeIdentity } from "../plugin-canvas-node"
import { webPluginManifestSchemaV7 } from "../plugin-contracts"
import type { CanvasDocumentChangeBus } from "./canvas-document-change-bus"
import type {
  ManagedCanvasMediaFileIdentity,
  ManagedCanvasMediaResolutionPort,
  ResolvedManagedCanvasMedia,
} from "./managed-canvas-media-resolver"
import type { InstalledPluginCapabilityIdentitySource } from "./plugin-principal-resolver"

const maximumSessions = 128
const maximumSessionsPerFrame = 16
const maximumMediaBytes = 32 * 1024 * 1024 * 1024
const idleLifetimeMs = 15 * 60_000
const absoluteLifetimeMs = 4 * 60 * 60_000

interface ConnectedMediaSession {
  absoluteExpiresAt: number
  canvasId: string
  expectedRevision: number
  frameId: string
  identity: ManagedCanvasMediaFileIdentity
  idleExpiresAt: number
  kind: "audio" | "video"
  manifestDigest: string
  mimeType: string
  ownerNodeId: string
  path: string
  pluginId: string
  pluginVersion: string
  projectId: string
  resourcePath: string
  senderId: number
  sessionId: string
  size: number
  sourceNodeId: string
  token: string
}

type ConnectedMediaDocumentStore = Pick<CanvasDocumentClient, "load">

export class PluginConnectedMediaService {
  private readonly sessions = new Map<string, ConnectedMediaSession>()
  private readonly canvasSubscription

  constructor(
    private readonly input: {
      changes: Pick<CanvasDocumentChangeBus, "subscribeAll">
      documents: ConnectedMediaDocumentStore
      media: ManagedCanvasMediaResolutionPort
      plugins: InstalledPluginCapabilityIdentitySource
    },
  ) {
    this.canvasSubscription = input.changes.subscribeAll((event) => {
      for (const [sessionId, session] of this.sessions) {
        if (session.projectId === event.ref.projectId && session.canvasId === event.ref.canvasId) {
          this.sessions.delete(sessionId)
        }
      }
    })
  }

  async open(request: PluginConnectedMediaOpenInput, senderId: number): Promise<PluginConnectedMediaOpenResult> {
    validateOpenInput(request)
    validateSenderId(senderId)
    this.cleanupExpired()
    if (this.sessions.size >= maximumSessions) throw new Error("Connected-media session capacity is exhausted")
    const frameSessions = [...this.sessions.values()].filter(
      (session) => session.senderId === senderId && sameFrame(session, request),
    )
    if (frameSessions.length >= maximumSessionsPerFrame) {
      throw new Error(`Plugin frame exceeds ${maximumSessionsPerFrame} connected-media sessions`)
    }

    const principal = await this.requirePrincipal(request)
    const { document, source } = await this.requireLiveBinding(request)
    const [resolved] = await this.input.media.resolve(
      {
        canvasId: request.canvasId,
        expectedRevision: request.expectedRevision,
        nodeIds: [request.sourceNodeId],
        scopeId: request.projectId,
      },
      {
        allowedKinds: new Set(["audio", "video"]),
        allowedKindsDescription: "audio or video",
        operationLabel: "Plugin connected-media preview",
      },
    )
    if (!resolved || resolved.size > maximumMediaBytes) {
      throw new Error("Connected media exceeds the streaming size limit")
    }
    const currentPrincipal = await this.requirePrincipal(request)
    if (currentPrincipal.digest !== principal.digest) {
      throw new Error("Plugin changed while its connected-media session was opening")
    }
    await this.requireLiveBinding(request)

    const now = Date.now()
    const sessionId = randomUUID()
    const token = randomUUID().replaceAll("-", "")
    const session: ConnectedMediaSession = {
      absoluteExpiresAt: now + absoluteLifetimeMs,
      canvasId: request.canvasId,
      expectedRevision: document.revision,
      frameId: request.frameId,
      identity: { ...resolved.identity },
      idleExpiresAt: now + idleLifetimeMs,
      kind: resolved.kind as "audio" | "video",
      manifestDigest: principal.digest,
      mimeType: resolved.mimeType,
      ownerNodeId: request.nodeId,
      path: resolved.path,
      pluginId: request.pluginId,
      pluginVersion: request.pluginVersion,
      projectId: request.projectId,
      resourcePath: resolved.resourcePath,
      senderId,
      sessionId,
      size: resolved.size,
      sourceNodeId: request.sourceNodeId,
      token,
    }
    this.sessions.set(sessionId, session)
    return {
      probe: connectedMediaProbe(source, resolved),
      sessionId,
      url: `${pluginConnectedMediaScheme}://${sessionId}/${token}`,
    }
  }

  close(request: PluginConnectedMediaCloseInput, senderId: number) {
    validateFrameInput(request)
    validateIdentifier(request.sessionId, "sessionId", 128)
    validateSenderId(senderId)
    const session = this.sessions.get(request.sessionId)
    if (!session || session.senderId !== senderId || !sameFrame(session, request)) return false
    this.sessions.delete(request.sessionId)
    return true
  }

  revokeFrame(request: PluginConnectedMediaFrameRef, senderId: number) {
    validateFrameInput(request)
    validateSenderId(senderId)
    let revoked = 0
    for (const [sessionId, session] of this.sessions) {
      if (session.senderId === senderId && sameFrame(session, request)) {
        this.sessions.delete(sessionId)
        revoked += 1
      }
    }
    return revoked
  }

  revokePlugin(pluginId: string) {
    let revoked = 0
    for (const [sessionId, session] of this.sessions) {
      if (session.pluginId === pluginId) {
        this.sessions.delete(sessionId)
        revoked += 1
      }
    }
    return revoked
  }

  revokeSender(senderId: number) {
    let revoked = 0
    for (const [sessionId, session] of this.sessions) {
      if (session.senderId === senderId) {
        this.sessions.delete(sessionId)
        revoked += 1
      }
    }
    return revoked
  }

  async handle(request: Request): Promise<Response> {
    try {
      this.cleanupExpired()
      const parsed = parseConnectedMediaUrl(request.url)
      const session = this.sessions.get(parsed.sessionId)
      if (!session || !safeTokenEqual(session.token, parsed.token)) return missingResponse()
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { headers: { Allow: "GET, HEAD" }, status: 405 })
      }
      const resolved = await this.revalidate(session)
      const range = parseByteRange(request.headers.get("range"), resolved.size)
      if (range === "unsatisfiable") {
        return new Response(null, {
          headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${resolved.size}` },
          status: 416,
        })
      }
      const start = range?.start ?? 0
      const end = range?.end ?? resolved.size - 1
      const length = resolved.size === 0 ? 0 : end - start + 1
      const headers = connectedMediaHeaders(session.mimeType, length)
      if (range) headers.set("Content-Range", `bytes ${start}-${end}/${resolved.size}`)
      if (request.method === "HEAD" || resolved.size === 0) {
        return new Response(null, { headers, status: range ? 206 : 200 })
      }

      const handle = await fs.open(session.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
      try {
        const stat = await handle.stat()
        if (!matchesIdentity(session.identity, stat)) throw new Error("Connected media changed before streaming")
        const stream = handle.createReadStream({ autoClose: true, end, start })
        const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>
        return new Response(body, { headers, status: range ? 206 : 200 })
      } catch (error) {
        await handle.close().catch(() => undefined)
        throw error
      }
    } catch {
      return missingResponse()
    }
  }

  dispose() {
    this.canvasSubscription.close()
    this.sessions.clear()
  }

  private cleanupExpired(now = Date.now()) {
    for (const [sessionId, session] of this.sessions) {
      if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) this.sessions.delete(sessionId)
    }
  }

  private async requirePrincipal(request: PluginConnectedMediaFrameRef) {
    const identity = await this.input.plugins.resolveCapabilityIdentity(request.pluginId)
    if (
      !identity ||
      identity.plugin.schema !== webPluginManifestSchemaV7 ||
      identity.plugin.version !== request.pluginVersion ||
      !identity.plugin.entry ||
      !identity.plugin.capabilities.includes("canvas.connectedMedia.stream")
    ) {
      throw new Error("Plugin is not authorized for connected-media streaming")
    }
    return identity
  }

  private async requireLiveBinding(request: PluginConnectedMediaOpenInput) {
    const snapshot = await this.input.documents.load({ canvasId: request.canvasId, scopeId: request.projectId })
    const document = snapshot.document
    if (!document || document.id !== request.canvasId) throw new Error("Plugin Canvas was not found")
    if (document.revision !== request.expectedRevision) {
      throw new Error("Canvas changed before the connected-media session opened")
    }
    const owner = document.nodes.find((node) => node.id === request.nodeId)
    if (!owner || !matchesWebPluginCanvasNodeIdentity(request.pluginId, owner.data)) {
      throw new Error("Plugin frame no longer owns its Canvas node")
    }
    const source = requireDirectMediaSource(document, request.nodeId, request.sourceNodeId)
    return { document, source }
  }

  private async revalidate(session: ConnectedMediaSession) {
    const frame = sessionFrame(session)
    const principal = await this.requirePrincipal(frame)
    if (principal.digest !== session.manifestDigest) throw new Error("Plugin changed after the session opened")
    const { source } = await this.requireLiveBinding({
      ...frame,
      expectedRevision: session.expectedRevision,
      sourceNodeId: session.sourceNodeId,
    })
    if (source.data.kind !== session.kind) throw new Error("Connected media kind changed")
    const [resolved] = await this.input.media.resolve(
      {
        canvasId: session.canvasId,
        expectedRevision: session.expectedRevision,
        nodeIds: [session.sourceNodeId],
        scopeId: session.projectId,
      },
      {
        allowedKinds: new Set([session.kind]),
        allowedKindsDescription: session.kind,
        operationLabel: "Plugin connected-media stream",
      },
    )
    if (
      !resolved ||
      resolved.resourcePath !== session.resourcePath ||
      resolved.mimeType !== session.mimeType ||
      resolved.size !== session.size ||
      !sameIdentity(resolved.identity, session.identity)
    ) {
      throw new Error("Connected media source changed after the session opened")
    }
    session.idleExpiresAt = Math.min(Date.now() + idleLifetimeMs, session.absoluteExpiresAt)
    return resolved
  }
}

function requireDirectMediaSource(document: CanvasDocument, ownerNodeId: string, sourceNodeId: string) {
  if (!document.edges.some((edge) => edge.source === sourceNodeId && edge.target === ownerNodeId)) {
    throw new Error("Canvas media is not a direct input of this Plugin node")
  }
  const source = document.nodes.find((node) => node.id === sourceNodeId)
  if (!source || source.type !== "file" || (source.data.kind !== "video" && source.data.kind !== "audio")) {
    throw new Error("Connected input is not a streamable audio or video node")
  }
  return source
}

function connectedMediaProbe(source: CanvasNode, resolved: ResolvedManagedCanvasMedia): PluginConnectedMediaProbe {
  const durationMs = positiveFinite(source.data.durationMs)
  const width = positiveFinite(source.data.width)
  const height = positiveFinite(source.data.height)
  return {
    duration: { estimated: durationMs === undefined, milliseconds: durationMs ?? 0 },
    ...(height === undefined ? {} : { height }),
    kind: resolved.kind as "audio" | "video",
    mediaRevision: createHash("sha256")
      .update(JSON.stringify([resolved.identity, resolved.kind, resolved.mimeType]))
      .digest("hex"),
    mimeType: resolved.mimeType,
    size: resolved.size,
    ...(width === undefined ? {} : { width }),
  }
}

function positiveFinite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function sessionFrame(session: ConnectedMediaSession): PluginConnectedMediaFrameRef {
  return {
    canvasId: session.canvasId,
    frameId: session.frameId,
    nodeId: session.ownerNodeId,
    pluginId: session.pluginId,
    pluginVersion: session.pluginVersion,
    projectId: session.projectId,
  }
}

function sameFrame(session: ConnectedMediaSession, frame: PluginConnectedMediaFrameRef) {
  return (
    session.frameId === frame.frameId &&
    session.projectId === frame.projectId &&
    session.canvasId === frame.canvasId &&
    session.ownerNodeId === frame.nodeId &&
    session.pluginId === frame.pluginId &&
    session.pluginVersion === frame.pluginVersion
  )
}

function parseConnectedMediaUrl(value: string) {
  const url = new URL(value)
  if (
    url.protocol !== `${pluginConnectedMediaScheme}:` ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error("Connected-media URL is invalid")
  }
  const sessionId = url.hostname
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments.length !== 1) throw new Error("Connected-media URL is invalid")
  validateIdentifier(sessionId, "sessionId", 128)
  validateIdentifier(segments[0], "token", 128)
  return { sessionId, token: segments[0] }
}

function parseByteRange(value: string | null, size: number): { end: number; start: number } | "unsatisfiable" | null {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || (!match[1] && !match[2]) || size === 0) return "unsatisfiable"
  let start: number
  let end: number
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable"
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
      return "unsatisfiable"
    }
    end = Math.min(end, size - 1)
  }
  return { end, start }
}

function connectedMediaHeaders(mimeType: string, length: number) {
  return new Headers({
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Length": String(length),
    "Content-Type": mimeType,
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
  })
}

function missingResponse() {
  return new Response("Connected media is unavailable", {
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    status: 404,
  })
}

function safeTokenEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function sameIdentity(left: ManagedCanvasMediaFileIdentity, right: ManagedCanvasMediaFileIdentity) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function matchesIdentity(identity: ManagedCanvasMediaFileIdentity, stat: Stats) {
  return stat.isFile() && sameIdentity(identity, stat)
}

function validateSenderId(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Connected-media sender is invalid")
}

function validateIdentifier(value: unknown, label: string, maximum: number) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`Connected-media ${label} is invalid`)
  }
}

function validateFrameInput(input: PluginConnectedMediaFrameRef) {
  if (!input || typeof input !== "object") throw new Error("Connected-media frame is required")
  validateIdentifier(input.canvasId, "canvasId", 256)
  validateIdentifier(input.frameId, "frameId", 128)
  validateIdentifier(input.nodeId, "nodeId", 256)
  validateIdentifier(input.pluginId, "pluginId", 128)
  validateIdentifier(input.pluginVersion, "pluginVersion", 128)
  validateIdentifier(input.projectId, "projectId", 256)
}

function validateOpenInput(input: PluginConnectedMediaOpenInput) {
  validateFrameInput(input)
  validateIdentifier(input.sourceNodeId, "sourceNodeId", 256)
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error("Connected-media expectedRevision must be a non-negative integer")
  }
}
