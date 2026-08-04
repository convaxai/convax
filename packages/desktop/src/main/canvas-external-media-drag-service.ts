import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { pipeline } from "node:stream/promises"
import type { NativeImage } from "electron"

import type { CanvasExternalMediaDragRequest, CanvasExternalMediaDragTicket } from "../canvas-external-drag-contracts"
import type { ManagedCanvasMediaResolutionPort, ResolvedManagedCanvasMedia } from "./managed-canvas-media-resolver"

const defaultTicketTtlMs = 5 * 60_000
const defaultPostDragRetentionMs = 10 * 60_000
const defaultMaximumLeaseMs = 30 * 60_000
const defaultMaximumItems = 100
const defaultMaximumBytes = 32 * 1024 * 1024 * 1024
const defaultMaximumTickets = 64
const defaultMaximumTicketsPerSender = 8

interface PreparedTicket {
  directory: string
  expiresAt: number
  files: string[]
  icon: CanvasExternalMediaDragIcon
  ownerId: number
  timer: ReturnType<typeof setTimeout>
}

interface StagedDirectory {
  timer?: ReturnType<typeof setTimeout>
}

interface StagingRootIdentity {
  dev: number
  ino: number
  path: string
}

export interface CanvasExternalMediaDragLease {
  file: string
  files: string[]
  icon: CanvasExternalMediaDragIcon
  release(): void
}

export type CanvasExternalMediaDragIcon = NativeImage | string

export interface CanvasExternalMediaDragIconRequest {
  file: string
  itemCount: number
  signal?: AbortSignal
}

export interface CanvasExternalMediaDragTicketPort {
  cancel(ownerId: number, ticket: string): Promise<void>
  consume(ownerId: number, ticket: string): CanvasExternalMediaDragLease
  prepare(
    ownerId: number,
    request: CanvasExternalMediaDragRequest,
    signal?: AbortSignal,
  ): Promise<CanvasExternalMediaDragTicket>
}

type CopyFile = (source: string, destination: string, mode?: number, signal?: AbortSignal) => Promise<void>

/**
 * Resolves a pathless Canvas selection, stages immutable host-owned copies and
 * publishes one-use sender-scoped tickets for the synchronous native drag edge.
 */
export class CanvasExternalMediaDragService implements CanvasExternalMediaDragTicketPort {
  private readonly copyFile: CopyFile
  private readonly maximumBytes: number
  private readonly maximumItems: number
  private readonly maximumLeaseMs: number
  private readonly maximumTickets: number
  private readonly maximumTicketsPerSender: number
  private readonly now: () => number
  private readonly postDragRetentionMs: number
  private readonly ticketTtlMs: number
  private readonly tickets = new Map<string, PreparedTicket>()
  private readonly stages = new Map<string, StagedDirectory>()
  private readonly pendingBySender = new Map<number, number>()
  private pendingPrepares = 0
  private disposed = false
  private initialization?: Promise<void>
  private stagingRoot?: StagingRootIdentity

  constructor(
    private readonly input: {
      media: ManagedCanvasMediaResolutionPort
      stagingRoot: string
      copyFile?: CopyFile
      createIcon?: (request: CanvasExternalMediaDragIconRequest) => Promise<CanvasExternalMediaDragIcon>
      maximumBytes?: number
      maximumItems?: number
      maximumLeaseMs?: number
      maximumTickets?: number
      maximumTicketsPerSender?: number
      now?: () => number
      onCleanupError?: (error: unknown) => void
      postDragRetentionMs?: number
      ticketTtlMs?: number
    },
  ) {
    if (!path.isAbsolute(input.stagingRoot)) throw new Error("Canvas external drag staging root must be absolute")
    this.copyFile = input.copyFile ?? copyStagedFile
    this.maximumBytes = requirePositiveInteger(input.maximumBytes ?? defaultMaximumBytes, "maximum staged bytes")
    this.maximumItems = requirePositiveInteger(input.maximumItems ?? defaultMaximumItems, "maximum staged items")
    this.maximumLeaseMs = requirePositiveInteger(
      input.maximumLeaseMs ?? defaultMaximumLeaseMs,
      "maximum lease lifetime",
    )
    this.maximumTickets = requirePositiveInteger(
      input.maximumTickets ?? defaultMaximumTickets,
      "maximum active tickets",
    )
    this.maximumTicketsPerSender = requirePositiveInteger(
      input.maximumTicketsPerSender ?? defaultMaximumTicketsPerSender,
      "maximum sender tickets",
    )
    this.now = input.now ?? Date.now
    this.postDragRetentionMs = requireNonNegativeInteger(
      input.postDragRetentionMs ?? defaultPostDragRetentionMs,
      "post-drag retention",
    )
    this.ticketTtlMs = requirePositiveInteger(input.ticketTtlMs ?? defaultTicketTtlMs, "ticket lifetime")
  }

  async prepare(
    ownerId: number,
    request: CanvasExternalMediaDragRequest,
    signal?: AbortSignal,
  ): Promise<CanvasExternalMediaDragTicket> {
    this.requireAvailableOwner(ownerId)
    throwIfAborted(signal)
    await this.initialize()
    this.requireAvailableOwner(ownerId)
    throwIfAborted(signal)
    this.reservePrepare(ownerId)
    let directory: string | undefined
    try {
      const media = await this.input.media.resolve(
        {
          canvasId: request.ref.canvasId,
          nodeIds: request.nodeIds,
          scopeId: request.ref.scopeId,
        },
        {
          allowedKinds: new Set(["audio", "image", "video"]),
          allowedKindsDescription: "images, videos, and audio",
          operationLabel: "external drag",
        },
        signal,
      )
      throwIfAborted(signal)
      this.validateAggregate(media)
      const stagingRoot = this.requireStagingRoot()
      await this.assertStagingRootIdentity(stagingRoot)
      directory = await fs.mkdtemp(path.join(stagingRoot.path, "selection-"))
      await fs.chmod(directory, 0o700)
      this.stages.set(directory, {})
      const files = await this.stageMedia(directory, media, signal)
      throwIfAborted(signal)
      const icon = this.input.createIcon
        ? await this.input.createIcon({ file: files[0]!, itemCount: files.length, signal })
        : files[0]!
      throwIfAborted(signal)
      if (this.disposed) throw new Error("Canvas external drag service is disposed")

      const ticket = this.createTicket()
      const expiresAt = this.now() + this.ticketTtlMs
      const timer = setTimeout(() => {
        void this.expire(ticket).catch((error) => this.reportCleanupError(error))
      }, this.ticketTtlMs)
      timer.unref?.()
      this.tickets.set(ticket, { directory, expiresAt, files, icon, ownerId, timer })
      directory = undefined
      return { expiresAt, itemCount: files.length, ticket }
    } finally {
      this.releasePrepare(ownerId)
      if (directory) await this.cleanupStage(directory)
    }
  }

  async cancel(ownerId: number, ticket: string): Promise<void> {
    this.requireOwner(ownerId)
    const entry = this.getOwnedTicket(ownerId, ticket)
    if (!entry) return
    this.tickets.delete(ticket)
    clearTimeout(entry.timer)
    await this.cleanupStage(entry.directory)
  }

  consume(ownerId: number, ticket: string): CanvasExternalMediaDragLease {
    this.requireAvailableOwner(ownerId)
    const entry = this.getOwnedTicket(ownerId, ticket)
    if (!entry) throw new Error("Canvas external media drag ticket is unavailable")
    if (entry.expiresAt <= this.now()) {
      this.tickets.delete(ticket)
      clearTimeout(entry.timer)
      void this.cleanupStage(entry.directory).catch((error) => this.reportCleanupError(error))
      throw new Error("Canvas external media drag ticket has expired")
    }
    this.tickets.delete(ticket)
    clearTimeout(entry.timer)
    this.scheduleStageCleanup(entry.directory, this.maximumLeaseMs)
    let released = false
    return {
      file: entry.files[0]!,
      files: [...entry.files],
      icon: entry.icon,
      release: () => {
        if (released) return
        released = true
        this.scheduleStageCleanup(entry.directory, this.postDragRetentionMs)
      },
    }
  }

  /** Eager cleanup hook for deterministic shutdown and tests. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    try {
      await this.initialization
    } catch (error) {
      this.reportCleanupError(error)
    }
    for (const entry of this.tickets.values()) clearTimeout(entry.timer)
    this.tickets.clear()
    for (const stage of this.stages.values()) {
      if (stage.timer) clearTimeout(stage.timer)
    }
    const directories = [...this.stages.keys()]
    await Promise.all(directories.map((directory) => this.cleanupStage(directory)))
    const root = this.stagingRoot
    if (root) {
      await this.assertStagingRootIdentity(root)
      await fs.rmdir(root.path).catch((error: unknown) => {
        if (!isNodeError(error, "ENOENT") && !isNodeError(error, "ENOTEMPTY")) throw error
      })
    }
  }

  /** Validate the private root and remove crash-orphaned selection directories. */
  async initialize(): Promise<void> {
    if (this.disposed) throw new Error("Canvas external drag service is disposed")
    if (!this.initialization) {
      this.initialization = (async () => {
        const root = await initializeStagingRoot(this.input.stagingRoot)
        this.stagingRoot = root
        await this.reconcileRoot(root)
      })()
    }
    return this.initialization
  }

  /** Reconcile only host-created `selection-*` directories; unrelated files are untouched. */
  async reconcile(): Promise<void> {
    await this.initialize()
    await this.reconcileRoot(this.requireStagingRoot())
  }

  private validateAggregate(media: readonly ResolvedManagedCanvasMedia[]) {
    if (media.length === 0 || media.length > this.maximumItems) {
      throw new Error(`Canvas external drag supports between 1 and ${this.maximumItems} media items`)
    }
    let total = 0
    for (const item of media) {
      if (!Number.isSafeInteger(item.size) || item.size < 0) throw new Error("Canvas media size is invalid")
      total += item.size
      if (!Number.isSafeInteger(total) || total > this.maximumBytes) {
        throw new Error("Canvas external drag selection is too large to stage safely")
      }
    }
  }

  private async stageMedia(directory: string, media: readonly ResolvedManagedCanvasMedia[], signal?: AbortSignal) {
    const usedNames = new Set<string>()
    const staged: string[] = []
    for (const [index, item] of media.entries()) {
      throwIfAborted(signal)
      const name = uniqueStagedName(item.name, index, usedNames)
      const destination = path.join(directory, name)
      const before = await fs.lstat(item.path)
      if (!matchesFileIdentity(before, item.identity)) {
        throw new Error(`Canvas media changed before it could be staged: ${item.resourcePath}`)
      }
      await cloneOrCopy(this.copyFile, item.path, destination, signal)
      const [after, stat] = await Promise.all([fs.lstat(item.path), fs.lstat(destination)])
      if (!matchesFileIdentity(after, item.identity)) {
        throw new Error(`Canvas media changed while it was staged: ${item.resourcePath}`)
      }
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== item.identity.size) {
        throw new Error(`Staged Canvas media changed while it was copied: ${item.resourcePath}`)
      }
      staged.push(destination)
    }
    return staged
  }

  private reservePrepare(ownerId: number) {
    const owned = this.countOwnedTickets(ownerId) + (this.pendingBySender.get(ownerId) ?? 0)
    if (this.tickets.size + this.pendingPrepares >= this.maximumTickets) {
      throw new Error("Too many Canvas external media drags are being prepared")
    }
    if (owned >= this.maximumTicketsPerSender) {
      throw new Error("Too many Canvas external media drags are being prepared by this window")
    }
    this.pendingPrepares += 1
    this.pendingBySender.set(ownerId, (this.pendingBySender.get(ownerId) ?? 0) + 1)
  }

  private releasePrepare(ownerId: number) {
    this.pendingPrepares = Math.max(0, this.pendingPrepares - 1)
    const remaining = (this.pendingBySender.get(ownerId) ?? 1) - 1
    if (remaining > 0) this.pendingBySender.set(ownerId, remaining)
    else this.pendingBySender.delete(ownerId)
  }

  private countOwnedTickets(ownerId: number) {
    let count = 0
    for (const entry of this.tickets.values()) {
      if (entry.ownerId === ownerId) count += 1
    }
    return count
  }

  private createTicket() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const ticket = `drag_${randomUUID()}`
      if (!this.tickets.has(ticket)) return ticket
    }
    throw new Error("Could not allocate a Canvas external media drag ticket")
  }

  private getOwnedTicket(ownerId: number, ticket: string) {
    if (!isTicket(ticket)) return undefined
    const entry = this.tickets.get(ticket)
    return entry?.ownerId === ownerId ? entry : undefined
  }

  private async expire(ticket: string) {
    const entry = this.tickets.get(ticket)
    if (!entry) return
    this.tickets.delete(ticket)
    clearTimeout(entry.timer)
    await this.cleanupStage(entry.directory)
  }

  private scheduleStageCleanup(directory: string, delayMs: number) {
    const stage = this.stages.get(directory)
    if (!stage) return
    if (stage.timer) clearTimeout(stage.timer)
    stage.timer = setTimeout(() => {
      void this.cleanupStage(directory).catch((error) => this.reportCleanupError(error))
    }, delayMs)
    stage.timer.unref?.()
  }

  private async cleanupStage(directory: string) {
    const stage = this.stages.get(directory)
    if (!stage) return
    const root = this.requireStagingRoot()
    await this.assertStagingRootIdentity(root)
    if (!isOwnedStagePath(root.path, directory)) {
      throw new Error("Refusing to clean an external drag directory outside its host-owned root")
    }
    const stat = await fs.lstat(directory).catch((error: unknown) => {
      if (isNodeError(error, "ENOENT")) return null
      throw error
    })
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
      throw new Error("Refusing to clean a replaced Canvas external drag directory")
    }
    this.stages.delete(directory)
    if (stage.timer) clearTimeout(stage.timer)
    await fs.rm(directory, { force: true, recursive: true })
  }

  private requireAvailableOwner(ownerId: number) {
    if (this.disposed) throw new Error("Canvas external drag service is disposed")
    this.requireOwner(ownerId)
  }

  private requireOwner(ownerId: number) {
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0) throw new Error("Canvas external drag sender is invalid")
  }

  private requireStagingRoot() {
    if (!this.stagingRoot) throw new Error("Canvas external drag staging root is not initialized")
    return this.stagingRoot
  }

  private async assertStagingRootIdentity(root: StagingRootIdentity) {
    const stat = await fs.lstat(root.path).catch((error: unknown) => {
      throw new Error(`Canvas external drag staging root is unavailable${nodeErrorCode(error)}`)
    })
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev !== root.dev || stat.ino !== root.ino) {
      throw new Error("Canvas external drag staging root changed after initialization")
    }
  }

  private async reconcileRoot(root: StagingRootIdentity) {
    await this.assertStagingRootIdentity(root)
    const entries = await fs.readdir(root.path, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.name.startsWith("selection-") || !entry.isDirectory() || entry.isSymbolicLink()) continue
      const candidate = path.join(root.path, entry.name)
      if (this.stages.has(candidate)) continue
      await this.assertStagingRootIdentity(root)
      const stat = await fs.lstat(candidate)
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue
      await fs.rm(candidate, { force: true, recursive: true })
    }
  }

  private reportCleanupError(error: unknown) {
    try {
      this.input.onCleanupError?.(error)
    } catch {
      // Cleanup reporting is optional and cannot widen filesystem access.
    }
  }
}

async function initializeStagingRoot(requestedRoot: string): Promise<StagingRootIdentity> {
  const requested = path.resolve(requestedRoot)
  await fs.mkdir(requested, { mode: 0o700, recursive: true })
  const requestedStat = await fs.lstat(requested)
  if (requestedStat.isSymbolicLink() || !requestedStat.isDirectory()) {
    throw new Error("Canvas external drag staging root must be a real directory")
  }
  const canonical = await fs.realpath(requested)
  const canonicalStat = await fs.lstat(canonical)
  if (
    canonicalStat.isSymbolicLink() ||
    !canonicalStat.isDirectory() ||
    canonicalStat.dev !== requestedStat.dev ||
    canonicalStat.ino !== requestedStat.ino
  ) {
    throw new Error("Canvas external drag staging root changed while it was initialized")
  }
  return { dev: canonicalStat.dev, ino: canonicalStat.ino, path: canonical }
}

function matchesFileIdentity(
  stat: Awaited<ReturnType<typeof fs.lstat>>,
  identity: ResolvedManagedCanvasMedia["identity"],
) {
  return (
    !stat.isSymbolicLink() &&
    stat.isFile() &&
    stat.dev === identity.dev &&
    stat.ino === identity.ino &&
    stat.size === identity.size &&
    stat.mtimeMs === identity.mtimeMs &&
    stat.ctimeMs === identity.ctimeMs
  )
}

async function cloneOrCopy(copyFile: CopyFile, source: string, destination: string, signal?: AbortSignal) {
  throwIfAborted(signal)
  try {
    await copyFile(source, destination, fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE_FORCE, signal)
    throwIfAborted(signal)
  } catch (error) {
    if (!isCloneUnsupported(error)) throw error
    await fs.rm(destination, { force: true })
    throwIfAborted(signal)
    await copyFile(source, destination, fsConstants.COPYFILE_EXCL, signal)
    throwIfAborted(signal)
  }
}

async function copyStagedFile(source: string, destination: string, mode = 0, signal?: AbortSignal) {
  throwIfAborted(signal)
  if (mode & fsConstants.COPYFILE_FICLONE_FORCE) {
    await fs.copyFile(source, destination, mode)
    throwIfAborted(signal)
    return
  }
  await pipeline(
    createReadStream(source, { flags: "r" }),
    createWriteStream(destination, { flags: mode & fsConstants.COPYFILE_EXCL ? "wx" : "w", mode: 0o600 }),
    { signal },
  )
  throwIfAborted(signal)
}

function isCloneUnsupported(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return false
  return new Set(["EINVAL", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EXDEV"]).has(String(error.code))
}

function uniqueStagedName(value: string, index: number, used: Set<string>) {
  const original = path
    .basename(value)
    .replace(/[\u0000-\u001f\u007f]/g, "-")
    .replace(/[. ]+$/g, "")
  const fallback = `media-${index + 1}`
  const safe = original && original !== "." && original !== ".." ? original : fallback
  const extension = path.extname(safe)
  const stem = safe.slice(0, safe.length - extension.length) || fallback
  let candidate = safe
  let suffix = 2
  while (used.has(candidate.toLowerCase())) {
    candidate = `${stem} ${suffix}${extension}`
    suffix += 1
  }
  used.add(candidate.toLowerCase())
  return candidate
}

function isOwnedStagePath(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return Boolean(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function isTicket(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^drag_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}

function isNodeError(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code
}

function nodeErrorCode(error: unknown) {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? ` (${error.code})` : ""
}

function requirePositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Canvas external drag ${label} must be positive`)
  return value
}

function requireNonNegativeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Canvas external drag ${label} cannot be negative`)
  return value
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Canceled", "AbortError")
}
