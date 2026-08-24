import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants, type BigIntStats } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { parseDigest, parseProjectId, type Digest, type ProjectId } from "@convax/collaboration"
import { parseProjectEntryId } from "@convax/project-files/identity"
import type {
  ProjectIndexAcceptedNativeMaterializationCoveragePort,
  ProjectIndexFileMaterializationEntry,
  ProjectIndexFileMaterializationPlan,
  ProjectIndexFileMaterializationProjectionPort,
} from "../../canvas/project-index-file-application"
import type { ProjectIndexResourceReference } from "../../collaboration/project-index"
import {
  fsyncProjectDirectory,
  isNodeDirectoryDurabilityError,
} from "./directory-durability"

export interface ProjectIndexMaterializationBlobPort {
  copyVerifiedBytesTo(reference: ProjectIndexResourceReference, stagingPath: string): Promise<void>
}

export interface ProjectIndexFileMaterializationResult {
  readonly materializedPaths: readonly string[]
  readonly removedPaths: readonly string[]
  readonly pendingPaths: readonly Readonly<{ path: string; code: "blob-unavailable" | "native-path-conflict" }> []
}

interface MaterializedEntry {
  readonly entryId: string
  readonly kind: "directory" | "file"
  readonly path: string
  readonly blobDigest: Digest | null
}

/**
 * Native guarded projection of ProjectIndex. The in-memory receipt map is only a
 * deletion/replace guard: it never selects identity, location or current bytes.
 * Losing it on crash may leave an invisible physical orphan, as permitted by the
 * protocol, but can never revive or overwrite a logical entry.
 */
export class ProjectIndexFileMaterializer {
  readonly #projectId: ProjectId
  readonly #projectRoot: string
  readonly #projection: ProjectIndexFileMaterializationProjectionPort
  readonly #blobs: ProjectIndexMaterializationBlobPort
  readonly #coveredAcceptedFrames = new Map<
    Digest,
    Parameters<ProjectIndexAcceptedNativeMaterializationCoveragePort["cover"]>[0]["entries"]
  >()
  #pendingBlobDigests = new Set<Digest>()
  #previous = new Map<string, MaterializedEntry>()
  #queue: Promise<void> = Promise.resolve()

  private constructor(input: {
    projectId: ProjectId
    projectRoot: string
    projection: ProjectIndexFileMaterializationProjectionPort
    blobs: ProjectIndexMaterializationBlobPort
  }) {
    this.#projectId = input.projectId
    this.#projectRoot = input.projectRoot
    this.#projection = input.projection
    this.#blobs = input.blobs
  }

  static async open(input: {
    readonly projectId: ProjectId
    readonly projectRoot: string
    readonly projection: ProjectIndexFileMaterializationProjectionPort
    readonly blobs: ProjectIndexMaterializationBlobPort
  }): Promise<ProjectIndexFileMaterializer> {
    const projectId = parseProjectId(input.projectId)
    if (!path.isAbsolute(input.projectRoot)) throw new TypeError("Project materialization root must be absolute")
    const projectRoot = await fs.realpath(input.projectRoot)
    const stat = await fs.lstat(projectRoot)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Project materialization root is not a real directory")
    return new ProjectIndexFileMaterializer({ ...input, projectId, projectRoot })
  }

  reconcile(): Promise<ProjectIndexFileMaterializationResult> {
    return this.#enqueue(() => this.#reconcile())
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    let resolveResult!: (value: T) => void
    let rejectResult!: (reason: unknown) => void
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    this.#queue = this.#queue.then(async () => {
      try { resolveResult(await operation()) } catch (error) { rejectResult(error) }
    }, async () => {
      try { resolveResult(await operation()) } catch (error) { rejectResult(error) }
    })
    return result
  }

  coverAcceptedFrame(
    input: Parameters<ProjectIndexAcceptedNativeMaterializationCoveragePort["cover"]>[0],
  ): void {
    const frameDigest = parseDigest(input.frameDigest)
    if (!Array.isArray(input.entries) || input.entries.length < 1 || input.entries.length > 32) {
      throw new TypeError("Accepted native materialization coverage entries are outside bounds")
    }
    const paths = new Set<string>()
    const entries = input.entries.map((entry) => {
      this.#absolute(entry.path)
      if (paths.has(entry.path)) throw new TypeError("Accepted native materialization coverage repeats a path")
      paths.add(entry.path)
      return entry.kind === "directory"
        ? Object.freeze({ entryId: parseProjectEntryId(entry.entryId), kind: "directory" as const, path: entry.path })
        : Object.freeze({
            blobDigest: parseDigest(entry.blobDigest),
            entryId: parseProjectEntryId(entry.entryId),
            kind: "file" as const,
            path: entry.path,
          })
    })
    this.#coveredAcceptedFrames.delete(frameDigest)
    this.#coveredAcceptedFrames.set(frameDigest, Object.freeze(entries))
    while (this.#coveredAcceptedFrames.size > 64) {
      this.#coveredAcceptedFrames.delete(this.#coveredAcceptedFrames.keys().next().value!)
    }
  }

  async consumeAcceptedFrameCoverage(frameDigestInput: Digest): Promise<boolean> {
    const frameDigest = parseDigest(frameDigestInput)
    return this.#enqueue(() => this.#consumeAcceptedFrameCoverage(frameDigest))
  }

  async #consumeAcceptedFrameCoverage(frameDigest: Digest): Promise<boolean> {
    const entries = this.#coveredAcceptedFrames.get(frameDigest)
    this.#coveredAcceptedFrames.delete(frameDigest)
    if (!entries) return false
    try {
      const projected = await this.#projection.queryFileMaterializationEntries({
        projectId: this.#projectId,
        paths: entries.map((entry) => entry.path),
      })
      this.#validatePlan(projected)
      const projectedByPath = new Map(projected.entries.map((entry) => [entry.path, entry] as const))
      if (projectedByPath.size !== entries.length) return false
      for (const entry of entries) {
        const ownerEntry = projectedByPath.get(entry.path)
        if (
          !ownerEntry ||
          ownerEntry.entryId !== entry.entryId ||
          ownerEntry.kind !== entry.kind ||
          (entry.kind === "directory"
            ? ownerEntry.reference !== null
            : ownerEntry.reference?.blob.digest !== entry.blobDigest)
        ) return false
        const target = this.#absolute(entry.path)
        if (entry.kind === "directory") {
          if (!(await isStableContainedDirectory(target, this.#projectRoot))) return false
          continue
        }
        if (await digestRegularFile(target, this.#projectRoot) !== entry.blobDigest) return false
      }
      for (const entry of entries) {
        this.#previous.set(entry.entryId, Object.freeze({
          blobDigest: entry.kind === "file" ? entry.blobDigest : null,
          entryId: entry.entryId,
          kind: entry.kind,
          path: entry.path,
        }))
      }
      return true
    } catch {
      return false
    }
  }

  needsPublishedBlob(digest: Digest): boolean {
    return this.#pendingBlobDigests.has(parseDigest(digest))
  }

  async #reconcile(): Promise<ProjectIndexFileMaterializationResult> {
    const plan = await this.#projection.queryFileMaterializationPlan({ projectId: this.#projectId })
    this.#validatePlan(plan)
    const materializedPaths: string[] = []
    const removedPaths: string[] = []
    const pendingPaths: Array<{ path: string; code: "blob-unavailable" | "native-path-conflict" }> = []
    const pendingBlobDigests = new Set<Digest>()
    const next = new Map<string, MaterializedEntry>()

    for (const entry of plan.entries.filter((candidate) => candidate.kind === "directory")) {
      try {
        await this.#ensureDirectory(entry.path)
        next.set(entry.entryId, tracked(entry))
        materializedPaths.push(entry.path)
      } catch (error) {
        if (isNodeDirectoryDurabilityError(error)) throw error
        pendingPaths.push({ path: entry.path, code: "native-path-conflict" })
      }
    }

    for (const entry of plan.entries.filter((candidate) => candidate.kind === "file")) {
      const previous = this.#previous.get(entry.entryId)
      try {
        await this.#materializeFile(entry, previous)
        next.set(entry.entryId, tracked(entry))
        materializedPaths.push(entry.path)
      } catch (error) {
        if (isNodeDirectoryDurabilityError(error)) throw error
        const blobUnavailable = isBlobUnavailable(error)
        pendingPaths.push({ path: entry.path, code: blobUnavailable ? "blob-unavailable" : "native-path-conflict" })
        if (blobUnavailable && entry.reference) pendingBlobDigests.add(entry.reference.blob.digest)
        if (previous) next.set(previous.entryId, previous)
      }
    }

    const desiredIds = new Set<string>(plan.entries.map((entry) => entry.entryId))
    const stale = [...this.#previous.values()].filter((entry) => {
      const desired = next.get(entry.entryId)
      return !desiredIds.has(entry.entryId) || (desired !== undefined && desired.path !== entry.path)
    })
    for (const entry of stale.filter((candidate) => candidate.kind === "file")) {
      if (await this.#removeTrackedFile(entry)) removedPaths.push(entry.path)
    }
    for (const entry of stale.filter((candidate) => candidate.kind === "directory").sort((left, right) => right.path.length - left.path.length)) {
      if (await this.#removeEmptyDirectory(entry.path)) removedPaths.push(entry.path)
    }
    this.#previous = next
    this.#pendingBlobDigests = pendingBlobDigests
    return Object.freeze({
      materializedPaths: Object.freeze(materializedPaths),
      removedPaths: Object.freeze(removedPaths),
      pendingPaths: Object.freeze(pendingPaths.map((entry) => Object.freeze(entry))),
    })
  }

  #validatePlan(plan: ProjectIndexFileMaterializationPlan): void {
    if (plan.projectId !== this.#projectId) throw new Error("ProjectIndex materialization plan crossed Project identity")
    const ids = new Set<string>()
    const paths = new Set<string>()
    for (const entry of plan.entries) {
      if (ids.has(entry.entryId) || paths.has(entry.path)) throw new Error("ProjectIndex materialization plan is not one-to-one")
      ids.add(entry.entryId)
      paths.add(entry.path)
      this.#absolute(entry.path)
      if ((entry.kind === "file") !== (entry.reference !== null)) throw new Error("ProjectIndex materialization entry shape is invalid")
    }
  }

  async #materializeFile(entry: ProjectIndexFileMaterializationEntry, previous?: MaterializedEntry): Promise<void> {
    if (entry.reference === null) throw new Error("ProjectIndex file reference is absent")
    const target = this.#absolute(entry.path)
    await this.#ensureDirectory(parentOf(entry.path))
    const current = await digestRegularFile(target, this.#projectRoot)
    if (current === entry.reference.blob.digest) return
    if (current !== null && !(previous?.path === entry.path && previous.blobDigest === current)) {
      throw new Error("Native Project path contains untracked bytes")
    }
    const staging = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.convax-stage`)
    try {
      await this.#blobs.copyVerifiedBytesTo(entry.reference, staging)
    } catch (error) {
      if (isMissingBlobError(error)) throw new BlobUnavailableError({ cause: error })
      throw error
    }
    try {
      if (current === null) {
        await fs.link(staging, target)
        await fs.unlink(staging)
      } else {
        const revalidated = await digestRegularFile(target, this.#projectRoot)
        if (revalidated !== current) throw new Error("Native Project file changed during materialization")
        await fs.rename(staging, target)
      }
      await fsyncFile(target)
      await fsyncProjectDirectory(path.dirname(target))
    } finally {
      await fs.rm(staging, { force: true }).catch(() => undefined)
    }
  }

  async #removeTrackedFile(entry: MaterializedEntry): Promise<boolean> {
    if (entry.blobDigest === null) return false
    const target = this.#absolute(entry.path)
    const current = await digestRegularFile(target, this.#projectRoot)
    if (current === null) return true
    if (current !== entry.blobDigest) return false
    await fs.unlink(target)
    await fsyncProjectDirectory(path.dirname(target))
    return true
  }

  async #removeEmptyDirectory(portablePath: string): Promise<boolean> {
    const target = this.#absolute(portablePath)
    try {
      await fs.rmdir(target)
      await fsyncProjectDirectory(path.dirname(target))
      return true
    } catch (error) {
      if (isNodeDirectoryDurabilityError(error)) throw error
      if (isNodeError(error) && (error.code === "ENOENT" || error.code === "ENOTEMPTY")) return error.code === "ENOENT"
      return false
    }
  }

  async #ensureDirectory(portablePath: string): Promise<void> {
    if (portablePath === "") return
    let current = this.#projectRoot
    for (const segment of portablePath.split("/")) {
      current = path.join(current, segment)
      try { await fs.mkdir(current) } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error
      }
      const stat = await fs.lstat(current)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Project materialization directory is unsafe")
      const real = await fs.realpath(current)
      if (!inside(this.#projectRoot, real)) throw new Error("Project materialization escaped Project root")
    }
  }

  #absolute(portablePath: string): string {
    if (portablePath === "" || portablePath.startsWith("/") || portablePath.endsWith("/") || portablePath.includes("\\") || portablePath.includes("//")) {
      throw new Error("Project materialization path is invalid")
    }
    const segments = portablePath.split("/")
    if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment === ".convax")) {
      throw new Error("Project materialization path is invalid")
    }
    const target = path.resolve(this.#projectRoot, ...segments)
    if (!inside(this.#projectRoot, target)) throw new Error("Project materialization escaped Project root")
    return target
  }
}

class BlobUnavailableError extends Error {
  constructor(options: ErrorOptions) { super("Project blob is not locally durable", options); this.name = "BlobUnavailableError" }
}

function tracked(entry: ProjectIndexFileMaterializationEntry): MaterializedEntry {
  return Object.freeze({ entryId: entry.entryId, kind: entry.kind, path: entry.path, blobDigest: entry.reference?.blob.digest ?? null })
}

function parentOf(portablePath: string): string {
  const index = portablePath.lastIndexOf("/")
  return index < 0 ? "" : portablePath.slice(0, index)
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function digestRegularFile(target: string, containmentRoot: string): Promise<Digest | null> {
  let pathBefore: BigIntStats
  try { pathBefore = await fs.lstat(target, { bigint: true }) } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null
    throw error
  }
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.nlink !== 1n) {
    throw new Error("Project materialization target is not an owned regular file")
  }
  const resolvedBefore = await fs.realpath(target)
  if (!inside(containmentRoot, resolvedBefore)) throw new Error("Project materialization target escaped Project root")
  const handle = await fs.open(target, fsConstants.O_RDONLY | noFollowFlag())
  try {
    const openedBefore = await handle.stat({ bigint: true })
    if (!sameFileIdentity(pathBefore, openedBefore) || !openedBefore.isFile() || openedBefore.nlink !== 1n) {
      throw new Error("Project materialization target changed before verification")
    }
    const hash = createHash("sha256")
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let offset = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, offset)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      offset += bytesRead
    }
    const openedAfter = await handle.stat({ bigint: true })
    const pathAfter = await fs.lstat(target, { bigint: true })
    const resolvedAfter = await fs.realpath(target)
    if (
      !sameFileIdentity(openedBefore, openedAfter) ||
      !sameFileIdentity(openedAfter, pathAfter) ||
      pathAfter.isSymbolicLink() ||
      pathAfter.nlink !== 1n ||
      resolvedAfter !== resolvedBefore ||
      !inside(containmentRoot, resolvedAfter)
    ) {
      throw new Error("Project materialization target changed during verification")
    }
    return parseDigest(hash.digest("hex"))
  } finally { await handle.close() }
}

function noFollowFlag(): number {
  return process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

async function isStableContainedDirectory(target: string, containmentRoot: string): Promise<boolean> {
  const before = await fs.lstat(target, { bigint: true })
  if (!before.isDirectory() || before.isSymbolicLink()) return false
  const resolvedBefore = await fs.realpath(target)
  if (!inside(containmentRoot, resolvedBefore)) return false
  const after = await fs.lstat(target, { bigint: true })
  const resolvedAfter = await fs.realpath(target)
  return (
    after.isDirectory() &&
    !after.isSymbolicLink() &&
    sameFileIdentity(before, after) &&
    resolvedAfter === resolvedBefore &&
    inside(containmentRoot, resolvedAfter)
  )
}

async function fsyncFile(target: string): Promise<void> {
  const handle = await fs.open(target, "r")
  try { await handle.sync() } finally { await handle.close() }
}

function isBlobUnavailable(error: unknown): boolean { return error instanceof BlobUnavailableError }
function isMissingBlobError(error: unknown): boolean { return error instanceof Error && /not locally durable/u.test(error.message) }
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error }
