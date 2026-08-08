import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { constants as fsConstants, type Stats } from "node:fs"
import fs from "node:fs/promises"
import { Readable } from "node:stream"

import type {
  ProjectFilePreviewLease,
  ProjectFilePreviewPurpose,
  ProjectFileThumbnail,
} from "@convax/project-files"

import { projectFilePreviewScheme } from "../project-file-preview-contracts"
import { parseSingleHttpByteRange } from "./http-byte-range"
import { projectResourceAccessControlAllowOrigin } from "./project-resource-protocol"

interface PreviewImage {
  getSize(scaleFactor?: number): { height: number; width: number }
  isEmpty(): boolean
  resize(options: { height: number; quality: "better"; width: number }): PreviewImage
  toDataURL(): string
}

export interface ProjectFilePreviewNativeImageAdapter {
  createFromPath(file: string): PreviewImage
}

interface PreviewSession {
  abortController: AbortController
  activeStreams: Set<Readable>
  bearerToken: string
  identity: FileIdentity
  leaseId: string
  mimeType: string
  ownerId: number
  path: string
  purpose: ProjectFilePreviewPurpose
}

interface FileIdentity {
  ctimeMs: number
  dev: number
  ino: number
  mtimeMs: number
  size: number
}

export class ProjectFilePreviewService {
  readonly #sessions = new Map<string, PreviewSession>()
  #disposed = false

  constructor(
    private readonly input: {
      images: ProjectFilePreviewNativeImageAdapter
      projects: {
        readFileInfo(input: { path: string; projectId: string }): Promise<{ mimeType: string }>
        resolveEntryPath(input: { path: string; projectId: string }): Promise<string>
      }
      trustedRendererUrl: string
    },
  ) {}

  async open(
    input: { path: string; projectId: string; purpose?: ProjectFilePreviewPurpose },
    ownerId: number,
  ): Promise<ProjectFilePreviewLease> {
    requireOwnerId(ownerId)
    if (this.#disposed) throw new Error("Project file preview service is disposed")
    const purpose = requirePurpose(input.purpose)
    const [source, info] = await Promise.all([
      this.input.projects.resolveEntryPath(input),
      this.input.projects.readFileInfo(input),
    ])
    const opened = await inspectRegularFile(source)
    if (this.#disposed) throw new Error("Project file preview service is disposed")
    if (purpose === "preview") this.revokeOwnerPurpose(ownerId, purpose)
    if (purpose === "thumbnail" && this.countOwnerSessions(ownerId, purpose) >= 2) {
      throw new Error("Project file thumbnail concurrency limit was reached")
    }
    const leaseId = randomUUID()
    const bearerToken = randomBytes(16).toString("hex")
    this.#sessions.set(leaseId, {
      abortController: new AbortController(),
      activeStreams: new Set(),
      bearerToken,
      identity: opened.identity,
      leaseId,
      mimeType: normalizeMimeType(info.mimeType),
      ownerId,
      path: opened.path,
      purpose,
    })
    return {
      leaseId,
      url: `${projectFilePreviewScheme}://${leaseId}/stream?token=${bearerToken}`,
    }
  }

  close(input: { leaseId: string }, ownerId: number) {
    requireLeaseId(input.leaseId)
    requireOwnerId(ownerId)
    const session = this.#sessions.get(input.leaseId)
    return Boolean(session && session.ownerId === ownerId && this.revoke(input.leaseId, "Project file preview closed"))
  }

  async thumbnail(input: { path: string; projectId: string }): Promise<ProjectFileThumbnail> {
    if (this.#disposed) throw new Error("Project file preview service is disposed")
    const [file, info] = await Promise.all([
      this.input.projects.resolveEntryPath(input),
      this.input.projects.readFileInfo(input),
    ])
    await inspectRegularFile(file)
    const mimeType = normalizeMimeType(info.mimeType)
    if (mimeType.startsWith("video/")) return { dataUrl: null }
    let image: PreviewImage
    try {
      image = mimeType.startsWith("image/")
        ? this.input.images.createFromPath(file)
        : this.input.images.createFromPath("")
    } catch {
      return { dataUrl: null }
    }
    if (image.isEmpty()) return { dataUrl: null }
    const size = image.getSize(1)
    if (!positiveSize(size)) return { dataUrl: null }
    const scale = Math.min(40 / size.width, 40 / size.height, 1)
    const resized = image.resize({
      height: Math.max(1, Math.round(size.height * scale)),
      quality: "better",
      width: Math.max(1, Math.round(size.width * scale)),
    })
    return { dataUrl: resized.isEmpty() ? null : resized.toDataURL() }
  }

  async handle(request: Request): Promise<Response> {
    try {
      const parsed = parsePreviewUrl(request.url)
      const session = this.#sessions.get(parsed.leaseId)
      if (!session || !safeTokenEqual(session.bearerToken, parsed.bearerToken)) return missingResponse()
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", { headers: { Allow: "GET, HEAD" }, status: 405 })
      }
      const allowOrigin = projectResourceAccessControlAllowOrigin(request, this.input.trustedRendererUrl)
      const signal = session.abortController.signal
      signal.throwIfAborted()
      const range = parseSingleHttpByteRange(request.headers.get("range"), session.identity.size)
      if (range === "unsatisfiable") {
        return new Response(null, {
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Range": `bytes */${session.identity.size}`,
            ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin, Vary: "Origin" } : {}),
          },
          status: 416,
        })
      }
      const start = range?.start ?? 0
      const end = range?.end ?? session.identity.size - 1
      const length = session.identity.size === 0 ? 0 : end - start + 1
      const headers = new Headers({
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Length": String(length),
        "Content-Type": session.mimeType,
        "X-Content-Type-Options": "nosniff",
      })
      if (allowOrigin) {
        headers.set("Access-Control-Allow-Origin", allowOrigin)
        headers.set("Vary", "Origin")
      }
      if (range) headers.set("Content-Range", `bytes ${start}-${end}/${session.identity.size}`)
      if (request.method === "HEAD" || session.identity.size === 0) {
        return new Response(null, { headers, status: range ? 206 : 200 })
      }

      const handle = await fs.open(session.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
      let stream: Readable | undefined
      try {
        signal.throwIfAborted()
        if (
          this.#sessions.get(session.leaseId) !== session ||
          !matchesIdentity(session.identity, await handle.stat())
        ) {
          throw new Error("Project file preview changed before streaming")
        }
        stream = handle.createReadStream({ autoClose: true, end, signal, start })
        session.activeStreams.add(stream)
        stream.once("close", () => session.activeStreams.delete(stream!))
        return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, {
          headers,
          status: range ? 206 : 200,
        })
      } catch (error) {
        stream?.destroy()
        await handle.close().catch(() => undefined)
        throw error
      }
    } catch {
      return missingResponse()
    }
  }

  revokeOwner(ownerId: number) {
    let count = 0
    for (const [leaseId, session] of this.#sessions) {
      if (session.ownerId === ownerId && this.revoke(leaseId, "Project preview owner changed")) count += 1
    }
    return count
  }

  private countOwnerSessions(ownerId: number, purpose: ProjectFilePreviewPurpose) {
    let count = 0
    for (const session of this.#sessions.values()) {
      if (session.ownerId === ownerId && session.purpose === purpose) count += 1
    }
    return count
  }

  private revokeOwnerPurpose(ownerId: number, purpose: ProjectFilePreviewPurpose) {
    let count = 0
    for (const [leaseId, session] of this.#sessions) {
      if (
        session.ownerId === ownerId &&
        session.purpose === purpose &&
        this.revoke(leaseId, "Project preview owner changed")
      ) {
        count += 1
      }
    }
    return count
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    for (const leaseId of this.#sessions.keys()) this.revoke(leaseId, "Project file preview service disposed")
  }

  private revoke(leaseId: string, reason: string) {
    const session = this.#sessions.get(leaseId)
    if (!session) return false
    this.#sessions.delete(leaseId)
    session.abortController.abort(new DOMException(reason, "AbortError"))
    for (const stream of session.activeStreams) stream.destroy()
    session.activeStreams.clear()
    return true
  }
}

async function inspectRegularFile(source: string) {
  const before = await fs.lstat(source)
  if (before.isSymbolicLink() || !before.isFile()) throw new Error("Project preview is not a regular file")
  const path = await fs.realpath(source)
  const handle = await fs.open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!matchesStats(before, stat)) throw new Error("Project preview changed while opening")
    return { identity: identityFor(stat), path }
  } finally {
    await handle.close()
  }
}

function identityFor(stat: Stats): FileIdentity {
  return { ctimeMs: stat.ctimeMs, dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size }
}

function matchesStats(left: Stats, right: Stats) {
  return left.isFile() && right.isFile() && matchesIdentity(identityFor(left), right)
}

function matchesIdentity(identity: FileIdentity, stat: Stats) {
  return (
    stat.isFile() &&
    identity.dev === stat.dev &&
    identity.ino === stat.ino &&
    identity.size === stat.size &&
    identity.mtimeMs === stat.mtimeMs &&
    identity.ctimeMs === stat.ctimeMs
  )
}

function parsePreviewUrl(value: string) {
  const url = new URL(value)
  if (
    url.protocol !== `${projectFilePreviewScheme}:` ||
    url.pathname !== "/stream" ||
    [...url.searchParams.keys()].join(",") !== "token"
  ) {
    throw new Error("Project preview URL is invalid")
  }
  const leaseId = url.hostname
  const bearerToken = url.searchParams.get("token") ?? ""
  requireLeaseId(leaseId)
  if (!/^[a-f0-9]{32}$/.test(bearerToken)) throw new Error("Project preview token is invalid")
  return { bearerToken, leaseId }
}

function requireLeaseId(value: string) {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error("Project preview lease id is invalid")
}

function requireOwnerId(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Project preview owner is invalid")
}

function requirePurpose(value: ProjectFilePreviewPurpose | undefined): ProjectFilePreviewPurpose {
  if (value === undefined || value === "preview") return "preview"
  if (value === "thumbnail") return value
  throw new Error("Project preview purpose is invalid")
}

function safeTokenEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function normalizeMimeType(value: string) {
  return value.split(";", 1)[0]!.trim().toLowerCase() || "application/octet-stream"
}

function positiveSize(value: { height: number; width: number }) {
  return Number.isFinite(value.width) && value.width > 0 && Number.isFinite(value.height) && value.height > 0
}

function missingResponse() {
  return new Response("Project preview was not found", { status: 404 })
}
