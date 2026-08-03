import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { parseProjectIdV2, type DigestV2, type ProjectIdV2 } from "@convax/collaboration"
import type {
  ProjectIndexFileMaterializationEntryV2,
  ProjectIndexFileMaterializationPlanV2,
  ProjectIndexFileMaterializationProjectionPortV2,
} from "../../canvas/project-index-file-application"
import type { ProjectResourceReferenceV2 } from "../../collaboration/project-index"

export interface ProjectIndexMaterializationBlobPortV2 {
  copyVerifiedBytesTo(reference: ProjectResourceReferenceV2, stagingPath: string): Promise<void>
}

export interface ProjectIndexFileMaterializationResultV2 {
  readonly materializedPaths: readonly string[]
  readonly removedPaths: readonly string[]
  readonly pendingPaths: readonly Readonly<{ path: string; code: "blob-unavailable" | "native-path-conflict" }> []
}

interface MaterializedEntryV2 {
  readonly entryId: string
  readonly kind: "directory" | "file"
  readonly path: string
  readonly blobDigest: DigestV2 | null
}

/**
 * Native guarded projection of ProjectIndex. The in-memory receipt map is only a
 * deletion/replace guard: it never selects identity, location or current bytes.
 * Losing it on crash may leave an invisible physical orphan, as permitted by the
 * protocol, but can never revive or overwrite a logical entry.
 */
export class ProjectIndexFileMaterializerV2 {
  readonly #projectId: ProjectIdV2
  readonly #projectRoot: string
  readonly #projection: ProjectIndexFileMaterializationProjectionPortV2
  readonly #blobs: ProjectIndexMaterializationBlobPortV2
  #previous = new Map<string, MaterializedEntryV2>()
  #queue: Promise<void> = Promise.resolve()

  private constructor(input: {
    projectId: ProjectIdV2
    projectRoot: string
    projection: ProjectIndexFileMaterializationProjectionPortV2
    blobs: ProjectIndexMaterializationBlobPortV2
  }) {
    this.#projectId = input.projectId
    this.#projectRoot = input.projectRoot
    this.#projection = input.projection
    this.#blobs = input.blobs
  }

  static async open(input: {
    readonly projectId: ProjectIdV2
    readonly projectRoot: string
    readonly projection: ProjectIndexFileMaterializationProjectionPortV2
    readonly blobs: ProjectIndexMaterializationBlobPortV2
  }): Promise<ProjectIndexFileMaterializerV2> {
    const projectId = parseProjectIdV2(input.projectId)
    if (!path.isAbsolute(input.projectRoot)) throw new TypeError("Project materialization root must be absolute")
    const projectRoot = await fs.realpath(input.projectRoot)
    const stat = await fs.lstat(projectRoot)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Project materialization root is not a real directory")
    return new ProjectIndexFileMaterializerV2({ ...input, projectId, projectRoot })
  }

  reconcile(): Promise<ProjectIndexFileMaterializationResultV2> {
    let resolveResult!: (value: ProjectIndexFileMaterializationResultV2) => void
    let rejectResult!: (reason: unknown) => void
    const result = new Promise<ProjectIndexFileMaterializationResultV2>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    this.#queue = this.#queue.then(async () => {
      try { resolveResult(await this.#reconcile()) } catch (error) { rejectResult(error) }
    }, async () => {
      try { resolveResult(await this.#reconcile()) } catch (error) { rejectResult(error) }
    })
    return result
  }

  async #reconcile(): Promise<ProjectIndexFileMaterializationResultV2> {
    const plan = await this.#projection.queryFileMaterializationPlan({ projectId: this.#projectId })
    this.#validatePlan(plan)
    const materializedPaths: string[] = []
    const removedPaths: string[] = []
    const pendingPaths: Array<{ path: string; code: "blob-unavailable" | "native-path-conflict" }> = []
    const next = new Map<string, MaterializedEntryV2>()

    for (const entry of plan.entries.filter((candidate) => candidate.kind === "directory")) {
      try {
        await this.#ensureDirectory(entry.path)
        next.set(entry.entryId, tracked(entry))
        materializedPaths.push(entry.path)
      } catch {
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
        pendingPaths.push({ path: entry.path, code: isBlobUnavailable(error) ? "blob-unavailable" : "native-path-conflict" })
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
    return Object.freeze({
      materializedPaths: Object.freeze(materializedPaths),
      removedPaths: Object.freeze(removedPaths),
      pendingPaths: Object.freeze(pendingPaths.map((entry) => Object.freeze(entry))),
    })
  }

  #validatePlan(plan: ProjectIndexFileMaterializationPlanV2): void {
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

  async #materializeFile(entry: ProjectIndexFileMaterializationEntryV2, previous?: MaterializedEntryV2): Promise<void> {
    if (entry.reference === null) throw new Error("ProjectIndex file reference is absent")
    const target = this.#absolute(entry.path)
    await this.#ensureDirectory(parentOf(entry.path))
    const current = await digestRegularFile(target)
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
        const revalidated = await digestRegularFile(target)
        if (revalidated !== current) throw new Error("Native Project file changed during materialization")
        await fs.rename(staging, target)
      }
      await fsyncFile(target)
      await fsyncDirectory(path.dirname(target))
    } finally {
      await fs.rm(staging, { force: true }).catch(() => undefined)
    }
  }

  async #removeTrackedFile(entry: MaterializedEntryV2): Promise<boolean> {
    if (entry.blobDigest === null) return false
    const target = this.#absolute(entry.path)
    const current = await digestRegularFile(target)
    if (current === null) return true
    if (current !== entry.blobDigest) return false
    await fs.unlink(target)
    await fsyncDirectory(path.dirname(target))
    return true
  }

  async #removeEmptyDirectory(portablePath: string): Promise<boolean> {
    const target = this.#absolute(portablePath)
    try {
      await fs.rmdir(target)
      await fsyncDirectory(path.dirname(target))
      return true
    } catch (error) {
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

function tracked(entry: ProjectIndexFileMaterializationEntryV2): MaterializedEntryV2 {
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

async function digestRegularFile(target: string): Promise<DigestV2 | null> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>
  try { stat = await fs.lstat(target) } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null
    throw error
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Project materialization target is not a regular file")
  const handle = await fs.open(target, "r")
  try {
    const hash = createHash("sha256")
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let offset = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, offset)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      offset += bytesRead
    }
    return hash.digest("hex") as DigestV2
  } finally { await handle.close() }
}

async function fsyncFile(target: string): Promise<void> {
  const handle = await fs.open(target, "r")
  try { await handle.sync() } finally { await handle.close() }
}

async function fsyncDirectory(target: string): Promise<void> {
  const handle = await fs.open(target, "r")
  try { await handle.sync() } finally { await handle.close() }
}

function isBlobUnavailable(error: unknown): boolean { return error instanceof BlobUnavailableError }
function isMissingBlobError(error: unknown): boolean { return error instanceof Error && /not locally durable/u.test(error.message) }
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error }
