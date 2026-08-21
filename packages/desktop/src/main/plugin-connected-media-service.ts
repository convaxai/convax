import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { constants as fsConstants, type Stats } from "node:fs"
import fs from "node:fs/promises"
import { performance } from "node:perf_hooks"
import { Readable } from "node:stream"
import type { CanvasApplicationService } from "@convax/canvas/application"
import type { CanvasDocument, CanvasNode } from "@convax/canvas/core"
import {
  getPluginApiDefinition,
  isPluginApiDeclared,
  maximumPluginApiConnectedImageBytes,
  maximumPluginApiConnectedImageDimension,
  maximumPluginApiConnectedImagePixels,
  type PluginApiId,
} from "@convax/plugin-api"
import { getProjectResourceReference, type ProjectResourceReference } from "@convax/project/canvas"
import type { ProjectCanvasImageRead, ProjectCanvasImageReadPort } from "@convax/project/node"
import { canonicalize as canonicalizeConvaxUri, parse as parseConvaxUri } from "@convax/uri"

import type {
  PluginConnectedImageCloseInput,
  PluginConnectedImageOpenInput,
  PluginConnectedImageOpenResult,
} from "../plugin-connected-image-contracts"
import {
  pluginConnectedMediaScheme,
  type PluginConnectedMediaCloseInput,
  type PluginConnectedMediaFrameRef,
  type PluginConnectedMediaOpenInput,
  type PluginConnectedMediaOpenResult,
  type PluginConnectedMediaProbe,
} from "../plugin-connected-media-contracts"
import { matchesWebPluginCanvasNodeIdentity } from "../plugin-canvas-node"
import { isSupportedWebPluginManifestSchema, type InstalledWebPluginSummary } from "../plugin-contracts"
import { PluginHostApiError, PluginHostApiResourceUnavailableError } from "../plugin-host-errors"
import type { CanvasDocumentChangeBus } from "./canvas-document-change-bus"
import type { PluginConnectedImageInspector } from "./plugin-connected-image-inspector"
import {
  ManagedCanvasMediaResourceUnavailableError,
  ManagedCanvasMediaStaleError,
  type ManagedCanvasMediaFileIdentity,
  type ManagedCanvasMediaResolutionPort,
  type ResolvedManagedCanvasMedia,
} from "./managed-canvas-media-resolver"
import { parseSingleHttpByteRange } from "./http-byte-range"
import type { InstalledPluginCapabilityIdentitySource } from "./plugin-principal-resolver"

const maximumSessions = 128
const maximumSessionsPerFrame = 16
const maximumImageSessions = 4
const maximumImageSessionsPerFrame = 2
const maximumConcurrentImageValidations = 1
const maximumConcurrentImageValidationsPerFrame = 1
const maximumMediaBytes = 32 * 1024 * 1024 * 1024
const idleLifetimeMs = 15 * 60_000
const absoluteLifetimeMs = 4 * 60 * 60_000
const connectedImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"])

interface ConnectedSessionBase {
  absoluteExpiresAt: number
  activeRevision: number
  activeSetDigest: string
  abortController: AbortController
  bearerToken: string
  canvasId: string
  frameId: string
  idleExpiresAt: number
  manifestDigest: string
  mimeType: string
  ownerNodeId: string
  pluginId: string
  pluginVersion: string
  projectId: string
  senderId: number
  sessionId: string
  size: number
  snapshotDigest: string
  sourceNodeId: string
}

interface ConnectedStreamSession extends ConnectedSessionBase {
  activeStreams: Set<Readable>
  identity: ManagedCanvasMediaFileIdentity
  kind: "audio" | "video"
  path: string
  resourcePath: string
}

interface ConnectedImageSession extends ConnectedSessionBase {
  bytes: Uint8Array
  contentRevision: string
  height: number
  kind: "image"
  reference: Exclude<ProjectResourceReference, { kind: "project-directory" }>
  width: number
}

type ConnectedMediaSession = ConnectedImageSession | ConnectedStreamSession

type ConnectedMediaApplicationPort = Pick<CanvasApplicationService, "query">

interface ConnectedMediaMonotonicClock {
  now(): number
}

const systemMonotonicClock: ConnectedMediaMonotonicClock = {
  now: () => performance.now(),
}

export class PluginConnectedMediaService {
  private readonly sessions = new Map<string, ConnectedMediaSession>()
  private readonly imageValidationsByFrame = new Map<string, number>()
  private activeImageValidations = 0
  private readonly imageValidationControllers = new Set<AbortController>()
  private readonly canvasSubscription
  private lastMonotonicNow = 0
  private disposed = false

  constructor(
    private readonly input: {
      changes: Pick<CanvasDocumentChangeBus, "subscribeAll">
      clock?: ConnectedMediaMonotonicClock
      application: ConnectedMediaApplicationPort
      images: PluginConnectedImageInspector
      media: ManagedCanvasMediaResolutionPort
      plugins: InstalledPluginCapabilityIdentitySource
      resources: ProjectCanvasImageReadPort
    },
  ) {
    this.canvasSubscription = input.changes.subscribeAll((event) => {
      for (const [sessionId, session] of this.sessions) {
        if (session.projectId === event.ref.projectId && session.canvasId === event.ref.canvasId) {
          this.revokeSession(sessionId, "Canvas changed while connected media was streaming")
        }
      }
    })
  }

  async openImage(
    request: PluginConnectedImageOpenInput,
    senderId: number,
    signal?: AbortSignal,
  ): Promise<PluginConnectedImageOpenResult> {
    validateImageOpenInput(request)
    validateSenderId(senderId)
    const validation = this.beginImageValidation(request, senderId, signal)
    try {
      return await this.openImageBound(request, senderId, validation.signal)
    } catch (error) {
      if (validation.signal.aborted) throw imageAbortError()
      throw error
    } finally {
      validation.release()
    }
  }

  private async openImageBound(
    request: PluginConnectedImageOpenInput,
    senderId: number,
    signal?: AbortSignal,
  ): Promise<PluginConnectedImageOpenResult> {
    throwIfAborted(signal)
    const principal = await this.requirePrincipal(request, "canvas.inputs.image.open", signal)
    const { reference } = await this.requireLiveImageBinding(request, signal)
    this.cleanupExpired()
    this.requireImageSessionCapacity(request, senderId)
    const image = await this.readImageResource(request.projectId, reference, signal)
    const bytes = Buffer.from(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength)
    const headerDimensions = connectedImageDimensions(bytes, image.mimeType)
    requireConnectedImageDimensions(headerDimensions)
    const decodedDimensions = this.input.images.inspect(image.bytes)
    if (!decodedDimensions) {
      throw new PluginHostApiResourceUnavailableError("Connected image could not be decoded")
    }
    requireConnectedImageDimensions(decodedDimensions)
    if (decodedDimensions.width !== headerDimensions.width || decodedDimensions.height !== headerDimensions.height) {
      throw new PluginHostApiResourceUnavailableError("Connected image dimensions do not match its header")
    }
    throwIfAborted(signal)

    const currentPrincipal = await this.requirePrincipal(request, "canvas.inputs.image.open", signal, principal)
    if (!sameActivePluginIdentity(currentPrincipal, principal)) {
      throw new PluginHostApiError("stale-context", "Plugin changed while its connected image was opening")
    }
    const currentBinding = await this.requireLiveImageBinding(request, signal)
    if (!sameProjectResourceReference(currentBinding.reference, reference)) {
      throw new PluginHostApiError("stale-context", "Canvas changed while its connected image was opening")
    }
    const finalImage = await this.readImageResource(request.projectId, reference, signal)
    if (!sameProjectImageRead(image, finalImage)) {
      throw new PluginHostApiError("stale-context", "Connected image changed while its session was opening")
    }
    await this.requirePrincipal(request, "canvas.inputs.image.open", signal, principal)
    const finalBinding = await this.requireLiveImageBinding(request, signal)
    if (!sameProjectResourceReference(finalBinding.reference, reference)) {
      throw new PluginHostApiError("stale-context", "Canvas changed while its connected image was finalized")
    }
    throwIfAborted(signal)

    this.cleanupExpired()
    this.requireImageSessionCapacity(request, senderId)
    const now = this.monotonicNow()
    const sessionId = randomUUID()
    const bearerToken = randomBytes(16).toString("hex")
    const session: ConnectedImageSession = {
      absoluteExpiresAt: now + absoluteLifetimeMs,
      activeRevision: principal.activeRevision,
      activeSetDigest: principal.activeSetDigest,
      abortController: new AbortController(),
      bearerToken,
      bytes: Uint8Array.from(finalImage.bytes),
      canvasId: request.canvasId,
      contentRevision: finalImage.contentDigest,
      frameId: request.frameId,
      height: decodedDimensions.height,
      idleExpiresAt: now + idleLifetimeMs,
      kind: "image",
      manifestDigest: principal.digest,
      mimeType: finalImage.mimeType,
      ownerNodeId: request.nodeId,
      pluginId: request.pluginId,
      pluginVersion: request.pluginVersion,
      projectId: request.projectId,
      reference,
      senderId,
      sessionId,
      size: finalImage.size,
      snapshotDigest: principal.snapshotDigest,
      sourceNodeId: request.sourceNodeId,
      width: decodedDimensions.width,
    }
    this.sessions.set(sessionId, session)
    return {
      probe: {
        contentRevision: finalImage.contentDigest,
        height: decodedDimensions.height,
        kind: "image",
        mimeType: finalImage.mimeType,
        size: finalImage.size,
        width: decodedDimensions.width,
      },
      sessionId,
      url: connectedMediaBearerUrl(sessionId, bearerToken),
    }
  }

  async open(
    request: PluginConnectedMediaOpenInput,
    senderId: number,
    signal?: AbortSignal,
  ): Promise<PluginConnectedMediaOpenResult> {
    validateOpenInput(request)
    validateSenderId(senderId)
    throwIfAborted(signal)
    if (this.disposed) throw new Error("Connected-media service is disposed")
    this.cleanupExpired()
    this.requireStreamSessionCapacity(request, senderId)

    const principal = await this.requirePrincipal(request, "canvas.inputs.open", signal)
    const { source } = await this.requireLiveBinding(request, signal)
    const [resolved] = await this.input.media
      .resolve(
        {
          canvasId: request.canvasId,
          nodeIds: [request.sourceNodeId],
          scopeId: request.projectId,
        },
        {
          allowedKinds: new Set(["audio", "video"]),
          allowedKindsDescription: "audio or video",
          operationLabel: "Plugin connected-media preview",
        },
        signal,
      )
      .catch((error: unknown) => {
        if (error instanceof ManagedCanvasMediaResourceUnavailableError) {
          throw new PluginHostApiResourceUnavailableError("Connected-media resource could not be resolved", {
            cause: error,
          })
        }
        if (error instanceof ManagedCanvasMediaStaleError) {
          throw new PluginHostApiError("stale-context", "Connected-media Canvas binding changed", {
            cause: error,
          })
        }
        throw error
      })
    if (!resolved || resolved.size > maximumMediaBytes) {
      throw new PluginHostApiResourceUnavailableError("Connected media is unavailable or exceeds the size limit")
    }
    const currentPrincipal = await this.requirePrincipal(request, "canvas.inputs.open", signal, principal)
    if (!sameActivePluginIdentity(currentPrincipal, principal)) {
      throw new Error("Plugin changed while its connected-media session was opening")
    }
    await this.requireLiveBinding(request, signal)
    throwIfAborted(signal)
    this.cleanupExpired()
    this.requireStreamSessionCapacity(request, senderId)

    const now = this.monotonicNow()
    const sessionId = randomUUID()
    const bearerToken = randomBytes(16).toString("hex")
    const session: ConnectedMediaSession = {
      absoluteExpiresAt: now + absoluteLifetimeMs,
      activeRevision: principal.activeRevision,
      activeSetDigest: principal.activeSetDigest,
      abortController: new AbortController(),
      activeStreams: new Set(),
      bearerToken,
      canvasId: request.canvasId,
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
      snapshotDigest: principal.snapshotDigest,
      sourceNodeId: request.sourceNodeId,
    }
    this.sessions.set(sessionId, session)
    return {
      probe: connectedMediaProbe(source, resolved),
      sessionId,
      url: connectedMediaBearerUrl(sessionId, bearerToken),
    }
  }

  close(request: PluginConnectedMediaCloseInput, senderId: number) {
    validateFrameInput(request)
    validateIdentifier(request.sessionId, "sessionId", 128)
    validateSenderId(senderId)
    const session = this.sessions.get(request.sessionId)
    if (!session || session.kind === "image" || session.senderId !== senderId || !sameFrame(session, request)) {
      return false
    }
    return this.revokeSession(request.sessionId, "Connected-media session was explicitly closed")
  }

  closeImage(request: PluginConnectedImageCloseInput, senderId: number) {
    validateFrameInput(request)
    validateIdentifier(request.sessionId, "sessionId", 128)
    validateSenderId(senderId)
    const session = this.sessions.get(request.sessionId)
    if (!session || session.kind !== "image" || session.senderId !== senderId || !sameFrame(session, request)) {
      return false
    }
    return this.revokeSession(request.sessionId, "Connected-image session was explicitly closed")
  }

  revokeFrame(request: PluginConnectedMediaFrameRef, senderId: number) {
    validateFrameInput(request)
    validateSenderId(senderId)
    let revoked = 0
    for (const [sessionId, session] of this.sessions) {
      if (session.senderId === senderId && sameFrame(session, request)) {
        if (this.revokeSession(sessionId, "Plugin frame was revoked")) revoked += 1
      }
    }
    return revoked
  }

  revokePlugin(pluginId: string) {
    let revoked = 0
    for (const [sessionId, session] of this.sessions) {
      if (session.pluginId === pluginId) {
        if (this.revokeSession(sessionId, "Plugin was revoked")) revoked += 1
      }
    }
    return revoked
  }

  revokeSender(senderId: number) {
    let revoked = 0
    for (const [sessionId, session] of this.sessions) {
      if (session.senderId === senderId) {
        if (this.revokeSession(sessionId, "Plugin sender was revoked")) revoked += 1
      }
    }
    return revoked
  }

  async handle(request: Request): Promise<Response> {
    try {
      this.cleanupExpired()
      const parsed = parseConnectedMediaUrl(request.url)
      const session = this.sessions.get(parsed.sessionId)
      if (!session || !safeTokenEqual(session.bearerToken, parsed.bearerToken)) return missingResponse()
      // Electron's protocol Request has no trusted WebContents/frame principal.
      // GET/HEAD therefore uses the high-entropy bearer URL, then revalidates
      // the issuing Plugin principal and direct Canvas binding before serving.
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { headers: { Allow: "GET, HEAD" }, status: 405 })
      }
      const signal = session.abortController.signal
      throwIfAborted(signal)
      await this.revalidate(session, signal)
      this.requireCurrentSession(session)
      const range = parseSingleHttpByteRange(request.headers.get("range"), session.size)
      if (range === "unsatisfiable") {
        return new Response(null, {
          headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${session.size}` },
          status: 416,
        })
      }
      const start = range?.start ?? 0
      const end = range?.end ?? session.size - 1
      const length = session.size === 0 ? 0 : end - start + 1
      const headers = connectedMediaHeaders(session.mimeType, length)
      if (range) headers.set("Content-Range", `bytes ${start}-${end}/${session.size}`)
      if (request.method === "HEAD" || session.size === 0) {
        return new Response(null, { headers, status: range ? 206 : 200 })
      }
      if (session.kind === "image") {
        // Images are bounded immutable memory snapshots. Revocation prevents a
        // later fetch, but cannot retract a Response body already constructed
        // from this copy.
        this.requireCurrentSession(session)
        return new Response(session.bytes.slice(start, end + 1), { headers, status: range ? 206 : 200 })
      }

      const handle = await fs.open(session.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
      let stream: Readable | undefined
      try {
        throwIfAborted(signal)
        this.requireCurrentSession(session)
        const stat = await handle.stat()
        throwIfAborted(signal)
        this.requireCurrentSession(session)
        if (!matchesIdentity(session.identity, stat)) throw new Error("Connected media changed before streaming")
        const activeStream = handle.createReadStream({ autoClose: true, end, signal, start })
        stream = activeStream
        session.activeStreams.add(activeStream)
        activeStream.once("close", () => {
          session.activeStreams.delete(activeStream)
        })
        if (signal.aborted || this.sessions.get(session.sessionId) !== session) {
          activeStream.destroy(connectedMediaAbortError("Connected-media session was revoked before streaming"))
          throw connectedMediaAbortError("Connected-media session was revoked before streaming")
        }
        const body = Readable.toWeb(activeStream) as unknown as ReadableStream<Uint8Array>
        return new Response(body, { headers, status: range ? 206 : 200 })
      } catch (error) {
        stream?.destroy()
        await handle.close().catch(() => undefined)
        throw error
      }
    } catch {
      return missingResponse()
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    const reason = imageAbortError("Connected-image service was disposed")
    for (const controller of this.imageValidationControllers) controller.abort(reason)
    this.imageValidationControllers.clear()
    this.canvasSubscription.close()
    for (const sessionId of this.sessions.keys()) {
      this.revokeSession(sessionId, "Connected-media service was disposed")
    }
  }

  private beginImageValidation(request: PluginConnectedImageOpenInput, senderId: number, callerSignal?: AbortSignal) {
    if (this.disposed) throw new PluginHostApiResourceUnavailableError("Connected-image service is disposed")
    const key = imageValidationFrameKey(request, senderId)
    const frameValidations = this.imageValidationsByFrame.get(key) ?? 0
    if (
      this.activeImageValidations >= maximumConcurrentImageValidations ||
      frameValidations >= maximumConcurrentImageValidationsPerFrame
    ) {
      throw new PluginHostApiResourceUnavailableError("Connected-image validation capacity is exhausted")
    }
    const controller = new AbortController()
    const cancel = () => controller.abort(imageAbortError())
    if (callerSignal?.aborted) cancel()
    else callerSignal?.addEventListener("abort", cancel, { once: true })
    this.imageValidationControllers.add(controller)
    this.activeImageValidations += 1
    this.imageValidationsByFrame.set(key, frameValidations + 1)
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        callerSignal?.removeEventListener("abort", cancel)
        this.imageValidationControllers.delete(controller)
        this.activeImageValidations -= 1
        const current = this.imageValidationsByFrame.get(key) ?? 1
        if (current <= 1) this.imageValidationsByFrame.delete(key)
        else this.imageValidationsByFrame.set(key, current - 1)
      },
      signal: controller.signal,
    }
  }

  private requireImageSessionCapacity(request: PluginConnectedImageOpenInput, senderId: number) {
    if (this.disposed) throw new PluginHostApiResourceUnavailableError("Connected-image service is disposed")
    if (this.sessions.size >= maximumSessions) {
      throw new PluginHostApiResourceUnavailableError("Connected-media session capacity is exhausted")
    }
    const imageSessions = [...this.sessions.values()].filter((session) => session.kind === "image")
    if (imageSessions.length >= maximumImageSessions) {
      throw new PluginHostApiResourceUnavailableError("Connected-image session capacity is exhausted")
    }
    const frameSessions = imageSessions.filter(
      (session) => session.senderId === senderId && sameFrame(session, request),
    )
    if (frameSessions.length >= maximumImageSessionsPerFrame) {
      throw new PluginHostApiResourceUnavailableError(
        `Plugin frame exceeds ${maximumImageSessionsPerFrame} connected-image sessions`,
      )
    }
  }

  private requireStreamSessionCapacity(request: PluginConnectedMediaOpenInput, senderId: number) {
    if (this.disposed) throw new Error("Connected-media service is disposed")
    if (this.sessions.size >= maximumSessions) throw new Error("Connected-media session capacity is exhausted")
    const frameSessions = [...this.sessions.values()].filter(
      (session) => session.senderId === senderId && sameFrame(session, request),
    )
    if (frameSessions.length >= maximumSessionsPerFrame) {
      throw new Error(`Plugin frame exceeds ${maximumSessionsPerFrame} connected-media sessions`)
    }
  }

  private cleanupExpired(now = this.monotonicNow()) {
    for (const [sessionId, session] of this.sessions) {
      if (session.idleExpiresAt <= now || session.absoluteExpiresAt <= now) {
        this.revokeSession(sessionId, "Connected-media session expired")
      }
    }
  }

  private requireCurrentSession(session: ConnectedMediaSession) {
    throwIfAborted(session.abortController.signal)
    if (this.sessions.get(session.sessionId) !== session) {
      throw connectedMediaAbortError("Connected-media session is no longer current")
    }
  }

  private revokeSession(sessionId: string, message: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    this.sessions.delete(sessionId)
    if (!session.abortController.signal.aborted) {
      session.abortController.abort(connectedMediaAbortError(message))
    }
    if (session.kind !== "image") {
      for (const stream of session.activeStreams) stream.destroy()
      session.activeStreams.clear()
    }
    return true
  }

  private renewIdleDeadline(session: ConnectedMediaSession) {
    const now = this.monotonicNow()
    if (
      this.sessions.get(session.sessionId) !== session ||
      session.idleExpiresAt <= now ||
      session.absoluteExpiresAt <= now
    ) {
      if (this.sessions.get(session.sessionId) === session) {
        this.revokeSession(session.sessionId, "Connected-media session expired while it was being revalidated")
      }
      throw new Error("Connected-media session expired while it was being revalidated")
    }
    session.idleExpiresAt = Math.min(now + idleLifetimeMs, session.absoluteExpiresAt)
  }

  private monotonicNow() {
    const observed = (this.input.clock ?? systemMonotonicClock).now()
    if (!Number.isFinite(observed) || observed < 0) {
      throw new Error("Connected-media monotonic clock returned an invalid value")
    }
    this.lastMonotonicNow = Math.max(this.lastMonotonicNow, observed)
    return this.lastMonotonicNow
  }

  private async requirePrincipal(
    request: PluginConnectedMediaFrameRef,
    apiId: PluginApiId,
    signal?: AbortSignal,
    expected?: {
      activeRevision: number
      activeSetDigest: string
      digest: string
      snapshotDigest: string
    },
  ) {
    throwIfAborted(signal)
    const identity = await this.input.plugins.resolveCapabilityIdentity(request.pluginId)
    throwIfAborted(signal)
    if (
      !identity ||
      !isSupportedWebPluginManifestSchema(identity.plugin.schema) ||
      identity.plugin.version !== request.pluginVersion ||
      !identity.plugin.entry ||
      !hasActivePluginIdentity(identity)
    ) {
      throw new PluginHostApiError("stale-context", `Plugin identity is no longer current for ${apiId}`)
    }
    if (!declaresAuthorizedHostApi(identity.plugin, apiId)) {
      throw new PluginHostApiError(
        expected ? "stale-context" : "permission-denied",
        `Plugin is not authorized for ${apiId}`,
      )
    }
    if (expected && !sameActivePluginIdentity(identity, expected)) {
      throw new PluginHostApiError("stale-context", `Plugin identity changed during ${apiId}`)
    }
    return identity
  }

  private async requireLiveImageBinding(request: PluginConnectedImageOpenInput, signal?: AbortSignal) {
    throwIfAborted(signal)
    const snapshot = await this.input.application.query({ canvasId: request.canvasId, scopeId: request.projectId })
    throwIfAborted(signal)
    const document = snapshot.projection
    if (!document || document.id !== request.canvasId) {
      throw new PluginHostApiError("stale-context", "Plugin connected-image Canvas binding changed")
    }
    const owner = document.nodes.find((node) => node.id === request.nodeId)
    if (!owner || !matchesWebPluginCanvasNodeIdentity(request.pluginId, owner.data)) {
      throw new PluginHostApiError("stale-context", "Plugin frame no longer owns its Canvas node")
    }
    const source = requireDirectImageSource(document, request.nodeId, request.sourceNodeId)
    const reference = getProjectResourceReference(source.data.metadata)
    if (!reference || reference.kind === "project-directory") {
      throw new PluginHostApiResourceUnavailableError(
        "Connected image does not contain a typed Project resource reference",
      )
    }
    return { document, reference }
  }

  private async readImageResource(
    projectId: string,
    reference: Exclude<ProjectResourceReference, { kind: "project-directory" }>,
    signal?: AbortSignal,
  ) {
    const image = await this.input.resources
      .readImage({
        maximumBytes: maximumPluginApiConnectedImageBytes,
        projectId,
        reference,
        signal,
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) throw error
        throw new PluginHostApiResourceUnavailableError("Connected image resource could not be read safely", {
          cause: error,
        })
      })
    requireConnectedImageRead(image)
    return image
  }

  private async requireLiveBinding(request: PluginConnectedMediaOpenInput, signal?: AbortSignal) {
    throwIfAborted(signal)
    const snapshot = await this.input.application.query({ canvasId: request.canvasId, scopeId: request.projectId })
    throwIfAborted(signal)
    const document = snapshot.projection
    if (!document || document.id !== request.canvasId) throw new Error("Plugin Canvas was not found")
    const owner = document.nodes.find((node) => node.id === request.nodeId)
    if (!owner || !matchesWebPluginCanvasNodeIdentity(request.pluginId, owner.data)) {
      throw new Error("Plugin frame no longer owns its Canvas node")
    }
    const source = requireDirectMediaSource(document, request.nodeId, request.sourceNodeId)
    return { document, source }
  }

  private async revalidate(session: ConnectedMediaSession, signal: AbortSignal) {
    const frame = sessionFrame(session)
    const apiId = session.kind === "image" ? "canvas.inputs.image.open" : "canvas.inputs.open"
    const principal = await this.requirePrincipal(frame, apiId, signal, {
      activeRevision: session.activeRevision,
      activeSetDigest: session.activeSetDigest,
      digest: session.manifestDigest,
      snapshotDigest: session.snapshotDigest,
    })
    if (
      principal.digest !== session.manifestDigest ||
      principal.activeRevision !== session.activeRevision ||
      principal.activeSetDigest !== session.activeSetDigest ||
      principal.snapshotDigest !== session.snapshotDigest
    ) {
      throw new Error("Plugin changed after the session opened")
    }
    if (session.kind === "image") {
      const { reference } = await this.requireLiveImageBinding(
        {
          ...frame,
          sourceNodeId: session.sourceNodeId,
        },
        signal,
      )
      if (!sameProjectResourceReference(reference, session.reference)) {
        throw new Error("Connected image reference changed after the session opened")
      }
      this.renewIdleDeadline(session)
      return
    }
    const { source } = await this.requireLiveBinding(
      {
        ...frame,
        sourceNodeId: session.sourceNodeId,
      },
      signal,
    )
    if (source.data.kind !== session.kind) throw new Error("Connected media kind changed")
    const [resolved] = await this.input.media.resolve(
      {
        canvasId: session.canvasId,
        nodeIds: [session.sourceNodeId],
        scopeId: session.projectId,
      },
      {
        allowedKinds: new Set([session.kind]),
        allowedKindsDescription: session.kind,
        operationLabel: "Plugin connected-media stream",
      },
      signal,
    )
    throwIfAborted(signal)
    this.requireCurrentSession(session)
    if (
      !resolved ||
      resolved.resourcePath !== session.resourcePath ||
      resolved.mimeType !== session.mimeType ||
      resolved.size !== session.size ||
      !sameIdentity(resolved.identity, session.identity)
    ) {
      throw new Error("Connected media source changed after the session opened")
    }
    this.renewIdleDeadline(session)
    return resolved
  }
}

function declaresAuthorizedHostApi(plugin: InstalledWebPluginSummary, apiId: PluginApiId) {
  if (!plugin.hostApi || !isPluginApiDeclared(plugin.hostApi, apiId)) return false
  const grant = getPluginApiDefinition(apiId).grant
  return grant === null || plugin.capabilities.includes(grant as InstalledWebPluginSummary["capabilities"][number])
}

function hasActivePluginIdentity(
  identity: NonNullable<Awaited<ReturnType<InstalledPluginCapabilityIdentitySource["resolveCapabilityIdentity"]>>>,
): identity is typeof identity & {
  activeRevision: number
  activeSetDigest: string
  snapshotDigest: string
} {
  return (
    Number.isSafeInteger(identity.activeRevision) &&
    (identity.activeRevision ?? -1) >= 0 &&
    typeof identity.activeSetDigest === "string" &&
    /^[a-f0-9]{64}$/.test(identity.activeSetDigest) &&
    typeof identity.snapshotDigest === "string" &&
    /^[a-f0-9]{64}$/.test(identity.snapshotDigest)
  )
}

function sameActivePluginIdentity(
  left: {
    activeRevision: number
    activeSetDigest: string
    digest: string
    snapshotDigest: string
  },
  right: {
    activeRevision: number
    activeSetDigest: string
    digest: string
    snapshotDigest: string
  },
) {
  return (
    left.digest === right.digest &&
    left.activeRevision === right.activeRevision &&
    left.activeSetDigest === right.activeSetDigest &&
    left.snapshotDigest === right.snapshotDigest
  )
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

function requireDirectImageSource(document: CanvasDocument, ownerNodeId: string, sourceNodeId: string) {
  if (!document.edges.some((edge) => edge.source === sourceNodeId && edge.target === ownerNodeId)) {
    throw new PluginHostApiError("stale-context", "Canvas image is not a direct input of this Plugin node")
  }
  const source = document.nodes.find((node) => node.id === sourceNodeId)
  if (!source || source.type !== "file" || source.data.kind !== "image") {
    throw new PluginHostApiResourceUnavailableError("Connected input is not a readable image node")
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

function requireConnectedImageRead(image: ProjectCanvasImageRead) {
  const digest = createHash("sha256").update(image.bytes).digest("hex")
  if (
    !connectedImageMimeTypes.has(image.mimeType) ||
    !Number.isSafeInteger(image.size) ||
    image.size < 1 ||
    image.size > maximumPluginApiConnectedImageBytes ||
    image.bytes.byteLength !== image.size ||
    !/^[a-f0-9]{64}$/u.test(image.contentDigest) ||
    image.contentDigest !== digest ||
    !isSafeConnectedImageName(image.name)
  ) {
    throw new PluginHostApiResourceUnavailableError(
      "Connected image is unavailable, unsupported, or violates its typed resource contract",
    )
  }
}

function sameProjectImageRead(left: ProjectCanvasImageRead, right: ProjectCanvasImageRead) {
  return (
    left.contentDigest === right.contentDigest &&
    left.mimeType === right.mimeType &&
    left.name === right.name &&
    left.size === right.size
  )
}

function connectedImageDimensions(bytes: Buffer, mimeType: string): { height: number; width: number } {
  try {
    if (mimeType === "image/png") return pngDimensions(bytes)
    if (mimeType === "image/jpeg") return jpegDimensions(bytes)
    if (mimeType === "image/webp") return webpDimensions(bytes)
  } catch (error) {
    if (error instanceof ConnectedImageValidationError) {
      throw new PluginHostApiResourceUnavailableError("Connected image dimensions are invalid", { cause: error })
    }
    throw error
  }
  throw new PluginHostApiResourceUnavailableError("Connected image format is unsupported")
}

function pngDimensions(bytes: Buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(signature) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new ConnectedImageValidationError("Connected PNG header is invalid")
  }
  return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) }
}

function jpegDimensions(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new ConnectedImageValidationError("Connected JPEG header is invalid")
  }
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) break
    const marker = bytes[offset]!
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      throw new ConnectedImageValidationError("Connected JPEG segment is invalid")
    }
    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) throw new ConnectedImageValidationError("Connected JPEG frame is invalid")
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      }
    }
    offset += segmentLength
  }
  throw new ConnectedImageValidationError("Connected JPEG dimensions were not found")
}

function webpDimensions(bytes: Buffer) {
  if (
    bytes.length < 30 ||
    bytes.subarray(0, 4).toString("ascii") !== "RIFF" ||
    bytes.subarray(8, 12).toString("ascii") !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  ) {
    throw new ConnectedImageValidationError("Connected WebP header is invalid")
  }
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const chunk = bytes.subarray(offset, offset + 4).toString("ascii")
    const size = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + size
    if (end > bytes.length) throw new ConnectedImageValidationError("Connected WebP chunk is invalid")
    if (chunk === "VP8X" && size >= 10) {
      return {
        height: readUInt24LE(bytes, start + 7) + 1,
        width: readUInt24LE(bytes, start + 4) + 1,
      }
    }
    if (chunk === "VP8L" && size >= 5 && bytes[start] === 0x2f) {
      const bits = bytes.readUInt32LE(start + 1)
      return {
        height: ((bits >>> 14) & 0x3fff) + 1,
        width: (bits & 0x3fff) + 1,
      }
    }
    if (
      chunk === "VP8 " &&
      size >= 10 &&
      bytes[start + 3] === 0x9d &&
      bytes[start + 4] === 0x01 &&
      bytes[start + 5] === 0x2a
    ) {
      return {
        height: bytes.readUInt16LE(start + 8) & 0x3fff,
        width: bytes.readUInt16LE(start + 6) & 0x3fff,
      }
    }
    offset = end + (size % 2)
  }
  throw new ConnectedImageValidationError("Connected WebP dimensions were not found")
}

function readUInt24LE(bytes: Buffer, offset: number) {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
}

function requireConnectedImageDimensions(dimensions: { height: number; width: number }) {
  if (
    !Number.isSafeInteger(dimensions.width) ||
    !Number.isSafeInteger(dimensions.height) ||
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > maximumPluginApiConnectedImageDimension ||
    dimensions.height > maximumPluginApiConnectedImageDimension ||
    dimensions.width * dimensions.height > maximumPluginApiConnectedImagePixels
  ) {
    throw new PluginHostApiResourceUnavailableError(
      `Connected image dimensions must not exceed ${maximumPluginApiConnectedImageDimension} by ${maximumPluginApiConnectedImageDimension}`,
    )
  }
}

function isSafeConnectedImageName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value) &&
    value === value.trim() &&
    value.length <= 255 &&
    !/[\\/\u0000-\u001f\u007f]/u.test(value)
  )
}

class ConnectedImageValidationError extends Error {}

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

function imageValidationFrameKey(frame: PluginConnectedMediaFrameRef, senderId: number) {
  return [
    senderId,
    frame.frameId,
    frame.projectId,
    frame.canvasId,
    frame.nodeId,
    frame.pluginId,
    frame.pluginVersion,
  ].join("\0")
}

function sameProjectResourceReference(
  left: Exclude<ProjectResourceReference, { kind: "project-directory" }>,
  right: Exclude<ProjectResourceReference, { kind: "project-directory" }>,
) {
  if (left.kind !== right.kind) return false
  if (left.kind === "project-file" && right.kind === "project-file") return left.path === right.path
  if (left.kind === "managed-asset" && right.kind === "managed-asset") {
    return left.sha256 === right.sha256 && left.name === right.name && left.mediaType === right.mediaType
  }
  return false
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
  const uri = parseConvaxUri(value)
  if (uri.scheme !== pluginConnectedMediaScheme || uri.query || uri.fragment) {
    throw new Error("Connected-media URL is invalid")
  }
  const sessionId = uri.authority
  const segments = uri.pathSegments
  if (segments.length !== 1 || segments[0]!.includes("/")) throw new Error("Connected-media URL is invalid")
  validateIdentifier(sessionId, "sessionId", 128)
  if (!/^[a-f0-9]{32}$/u.test(segments[0]!)) throw new Error("Connected-media bearer token is invalid")
  return { bearerToken: segments[0], sessionId }
}

function connectedMediaBearerUrl(sessionId: string, bearerToken: string) {
  return canonicalizeConvaxUri(
    `${pluginConnectedMediaScheme}://${encodeURIComponent(sessionId)}/${encodeURIComponent(bearerToken)}`,
  )
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
}

function validateImageOpenInput(input: PluginConnectedImageOpenInput) {
  validateFrameInput(input)
  validateIdentifier(input.sourceNodeId, "sourceNodeId", 2_048)
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && (error.name === "AbortError" || error.message === "The operation was aborted")
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw connectedMediaAbortError()
}

function imageAbortError(message = "Plugin connected-image operation was canceled") {
  return new DOMException(message, "AbortError")
}

function connectedMediaAbortError(message = "Plugin connected-media operation was canceled") {
  return new DOMException(message, "AbortError")
}
