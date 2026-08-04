import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants, type BigIntStats } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { parseDigestV2, parseProjectIdV2 } from "@convax/collaboration"
import type { ProjectIndexCurrentBlobReferencePortV2 } from "../../collaboration/blob-replication"
import type { ProjectRootResolver, ProjectManagedAssetStore } from "./project-managed-asset-store"

export const projectAssetGcGraceMs = 7 * 24 * 60 * 60 * 1_000
export const projectAssetGcMinimumIntervalMs = 24 * 60 * 60 * 1_000
export const projectAssetGcOpenDelayMs = 30 * 1_000
export const projectAssetGcRetryMs = 15 * 60 * 1_000
export const projectAssetStagingRetentionMs = 24 * 60 * 60 * 1_000

export interface ProjectAssetGcState {
  schemaVersion: 1
  entries: Record<string, { unreferencedSince: string }>
}

export interface ProjectAssetGcOptions {
  assets: ProjectManagedAssetStore
  references: ProjectIndexCurrentBlobReferencePortV2
  now?: () => number
  projects: ProjectRootResolver
}

interface AssetLayout {
  assetRoot: DirectoryIdentity
  blobRoot: DirectoryIdentity
  managedStagingRoot: DirectoryIdentity
  projectStagingPath: string
  statePath: string
}

interface DirectoryIdentity {
  path: string
  realPath: string
  snapshot: BigIntStats
}

interface VerifiedFile {
  path: string
  snapshot: BigIntStats
}

interface CandidateInventory {
  blobs: Map<string, VerifiedFile>
  quarantines: Map<string, VerifiedFile>
}

interface DueCandidate {
  digest: string
  file: VerifiedFile
  kind: "blob" | "quarantine"
}

const digestPattern = /^[a-f0-9]{64}$/
const quarantinePattern = /^gc-delete-([a-f0-9]{64})$/
const stateMaximumBytes = 4 * 1024 * 1024
const hashChunkBytes = 64 * 1024

export class ProjectAssetGc {
  readonly #assets: ProjectManagedAssetStore
  readonly #references: ProjectIndexCurrentBlobReferencePortV2
  readonly #now: () => number
  readonly #projects: ProjectRootResolver

  constructor(options: ProjectAssetGcOptions) {
    this.#assets = options.assets
    this.#references = options.references
    this.#now = options.now ?? Date.now
    this.#projects = options.projects
  }

  scan(projectId: string) {
    return this.#assets.runExclusive(projectId, () => this.#scanExclusive(projectId))
  }

  async #scanExclusive(projectId: string) {
    const now = this.#now()
    if (!Number.isFinite(now)) throw new Error("Project asset GC clock is invalid")
    const live = await this.#loadLiveDigests(projectId)
    const layout = await resolveAssetLayout(this.#projects, projectId)
    const maximumBytes = this.#assets.getMaximumBytesForMaintenance()
    const inventory = await enumerateCandidates(layout, maximumBytes)
    const loaded = await loadState(layout.statePath, now)
    const next = buildNextState(loaded.valid ? loaded.state : undefined, inventory, live, now)
    await saveState(layout, next)

    if (!loaded.valid) return

    await restoreLiveQuarantines(layout, inventory, live, maximumBytes)

    let stateChanged = false
    const due = Object.entries(next.entries)
      .filter(([, entry]) => now - Date.parse(entry.unreferencedSince) >= projectAssetGcGraceMs)
      .map(([digest]) => digest)
    if (due.length > 0) {
      const liveAgain = await this.#loadLiveDigests(projectId)
      for (const digest of due) {
        if (!liveAgain.has(digest)) continue
        delete next.entries[digest]
        stateChanged = true
      }
      if (stateChanged) await saveState(layout, next)

      const remainingDue = due.filter((digest) => !liveAgain.has(digest))
      const candidates = await preflightDueCandidates(layout, remainingDue, maximumBytes)
      for (const candidate of candidates) {
        try {
          await deleteDueCandidate(layout, candidate, maximumBytes)
          delete next.entries[candidate.digest]
          stateChanged = true
        } catch {
          // A failed candidate remains marked and is retried from its canonical or
          // quarantined location after another complete durable-reference scan.
        }
      }
      if (stateChanged) await saveState(layout, next)
    }

    await cleanOrdinaryStaging(layout.managedStagingRoot, now, true)
    await cleanProjectStaging(layout.projectStagingPath, now)
  }

  async #loadLiveDigests(projectId: string) {
    const values = await this.#references.queryCurrentBlobDigests({ projectId: parseProjectIdV2(projectId) })
    const result = new Set<string>()
    for (const digest of values) {
      if (!digestPattern.test(digest))
        throw new Error("ProjectIndex current blob-reference query returned an invalid digest")
      result.add(parseDigestV2(digest))
    }
    return result
  }
}

function buildNextState(
  previous: ProjectAssetGcState | undefined,
  inventory: CandidateInventory,
  live: ReadonlySet<string>,
  now: number,
): ProjectAssetGcState {
  const entries: ProjectAssetGcState["entries"] = Object.create(null)
  const candidates = new Set([...inventory.blobs.keys(), ...inventory.quarantines.keys()])
  for (const digest of candidates) {
    if (live.has(digest)) continue
    entries[digest] = previous?.entries[digest] ?? { unreferencedSince: new Date(now).toISOString() }
  }
  return { entries, schemaVersion: 1 }
}

async function resolveAssetLayout(projects: ProjectRootResolver, projectId: string): Promise<AssetLayout> {
  const requestedRoot = path.resolve(await projects.resolveProjectRoot({ projectId }))
  const requestedSnapshot = await fs.lstat(requestedRoot, { bigint: true })
  if (requestedSnapshot.isSymbolicLink() || !requestedSnapshot.isDirectory()) {
    throw new Error("Project root is not a real directory")
  }
  const projectRoot = await captureDirectory(await fs.realpath(requestedRoot), "Project root")
  const privateRoot = await captureDirectory(path.join(projectRoot.path, ".convax"), "Project private storage")
  await assertDirectory(projectRoot, "Project root")
  const assetRoot = await ensureChildDirectory(privateRoot, "assets", "Project asset directory")
  const blobRoot = await ensureChildDirectory(assetRoot, "blobs", "Project asset blob directory")
  const managedStagingRoot = await ensureChildDirectory(
    assetRoot,
    ".staging",
    "Project managed-asset staging directory",
  )
  await assertDirectory(projectRoot, "Project root")
  await assertDirectory(privateRoot, "Project private storage")
  await assertDirectory(assetRoot, "Project asset directory")
  return {
    assetRoot,
    blobRoot,
    managedStagingRoot,
    projectStagingPath: path.join(privateRoot.path, "staging"),
    statePath: path.join(assetRoot.path, "gc.json"),
  }
}

async function enumerateCandidates(layout: AssetLayout, maximumBytes: number): Promise<CandidateInventory> {
  const blobs = new Map<string, VerifiedFile>()
  const quarantines = new Map<string, VerifiedFile>()
  await assertLayout(layout)
  for (const entry of await fs.readdir(layout.blobRoot.path, { withFileTypes: true })) {
    if (!digestPattern.test(entry.name)) continue
    const filePath = path.join(layout.blobRoot.path, entry.name)
    const verified = await verifyDigestFile(filePath, entry.name, maximumBytes, "Managed asset blob")
    blobs.set(entry.name, verified)
  }
  await assertLayout(layout)
  for (const entry of await fs.readdir(layout.managedStagingRoot.path, { withFileTypes: true })) {
    const match = quarantinePattern.exec(entry.name)
    if (!match) continue
    const digest = match[1]
    const filePath = path.join(layout.managedStagingRoot.path, entry.name)
    const verified = await verifyDigestFile(filePath, digest, maximumBytes, "Managed asset GC quarantine")
    quarantines.set(digest, verified)
  }
  await assertLayout(layout)
  return { blobs, quarantines }
}

async function preflightDueCandidates(
  layout: AssetLayout,
  due: readonly string[],
  maximumBytes: number,
): Promise<DueCandidate[]> {
  const candidates: DueCandidate[] = []
  await assertLayout(layout)
  for (const digest of due) {
    const blob = await verifyIfPresent(
      path.join(layout.blobRoot.path, digest),
      digest,
      maximumBytes,
      "Managed asset blob",
    )
    const quarantine = await verifyIfPresent(
      path.join(layout.managedStagingRoot.path, `gc-delete-${digest}`),
      digest,
      maximumBytes,
      "Managed asset GC quarantine",
    )
    if (blob && quarantine) {
      throw new Error(`Managed asset GC found both canonical and quarantined files: ${digest}`)
    }
    if (blob) candidates.push({ digest, file: blob, kind: "blob" })
    else if (quarantine) candidates.push({ digest, file: quarantine, kind: "quarantine" })
  }
  await assertLayout(layout)
  return candidates
}

async function restoreLiveQuarantines(
  layout: AssetLayout,
  inventory: CandidateInventory,
  live: ReadonlySet<string>,
  maximumBytes: number,
) {
  const quarantines = [...inventory.quarantines.entries()].sort(([left], [right]) => left.localeCompare(right))
  for (const [digest, capturedQuarantine] of quarantines) {
    if (!live.has(digest)) continue
    const quarantine = await verifyDigestFile(
      capturedQuarantine.path,
      digest,
      maximumBytes,
      "Managed asset GC quarantine",
    )
    assertSameSnapshot(
      capturedQuarantine.snapshot,
      quarantine.snapshot,
      "Managed asset GC quarantine changed before live recovery",
    )
    const capturedCanonical = inventory.blobs.get(digest)
    if (capturedCanonical) {
      const canonical = await verifyDigestFile(capturedCanonical.path, digest, maximumBytes, "Managed asset blob")
      assertSameSnapshot(
        capturedCanonical.snapshot,
        canonical.snapshot,
        "Managed asset blob changed before live recovery",
      )
    } else {
      const canonicalPath = path.join(layout.blobRoot.path, digest)
      await assertLayout(layout)
      // link(2) is the portable no-replace publication primitive already used
      // by managed admission. A crash leaves two verified aliases for the next
      // scan; an existing canonical target is never overwritten.
      await fs.link(quarantine.path, canonicalPath)
      const canonical = await verifyDigestFile(canonicalPath, digest, maximumBytes, "Managed asset blob")
      assertSameContentSnapshot(
        quarantine.snapshot,
        canonical.snapshot,
        "Managed asset GC live recovery identity changed",
      )
      const alias = await verifyDigestFile(quarantine.path, digest, maximumBytes, "Managed asset GC quarantine")
      assertSameContentSnapshot(canonical.snapshot, alias.snapshot, "Managed asset GC live recovery alias changed")
    }
    await assertLayout(layout)
    await fs.unlink(quarantine.path)
  }
}

async function deleteDueCandidate(layout: AssetLayout, candidate: DueCandidate, maximumBytes: number) {
  await assertLayout(layout)
  const current = await verifyDigestFile(
    candidate.file.path,
    candidate.digest,
    maximumBytes,
    candidate.kind === "blob" ? "Managed asset blob" : "Managed asset GC quarantine",
  )
  assertSameSnapshot(candidate.file.snapshot, current.snapshot, "Managed asset GC candidate changed after preflight")
  if (candidate.kind === "quarantine") {
    await fs.unlink(current.path)
    return
  }

  const quarantinePath = path.join(layout.managedStagingRoot.path, `gc-delete-${candidate.digest}`)
  const existing = await fs.lstat(quarantinePath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return null
    throw error
  })
  if (existing) throw new Error(`Managed asset GC quarantine already exists: ${candidate.digest}`)
  await assertLayout(layout)
  // Portable Node cannot make this no-replace check and rename conditional on
  // directory-entry identity. Same-UID malicious replacement in that syscall
  // window is explicitly outside the threat model; every other transition is
  // re-opened no-follow and verified by identity, size/mtime, and digest.
  await fs.rename(current.path, quarantinePath)
  const quarantined = await verifyDigestFile(
    quarantinePath,
    candidate.digest,
    maximumBytes,
    "Managed asset GC quarantine",
  )
  assertSameContentSnapshot(current.snapshot, quarantined.snapshot, "Managed asset GC quarantine identity changed")
  await assertLayout(layout)
  await fs.unlink(quarantinePath)
}

async function loadState(
  statePath: string,
  now: number,
): Promise<{ state: ProjectAssetGcState; valid: true } | { valid: false }> {
  try {
    const snapshot = await fs.lstat(statePath, { bigint: true })
    if (snapshot.isSymbolicLink() || !snapshot.isFile() || snapshot.size > BigInt(stateMaximumBytes)) {
      return { valid: false }
    }
    const handle = await fs.open(statePath, secureReadFlags())
    let content: string
    try {
      const opened = await handle.stat({ bigint: true })
      assertSameSnapshot(snapshot, opened, "Project asset GC state changed while opening")
      content = await handle.readFile("utf8")
      const after = await handle.stat({ bigint: true })
      assertSameSnapshot(snapshot, after, "Project asset GC state changed while reading")
    } finally {
      await handle.close().catch(() => undefined)
    }
    return { state: parseState(JSON.parse(content), now), valid: true }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { valid: false }
    return { valid: false }
  }
}

function parseState(value: unknown, now: number): ProjectAssetGcState {
  if (!isExactRecord(value, ["entries", "schemaVersion"]) || value.schemaVersion !== 1) {
    throw new Error("Project asset GC state schema is not supported")
  }
  if (!value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)) {
    throw new Error("Project asset GC entries are invalid")
  }
  const entries: ProjectAssetGcState["entries"] = Object.create(null)
  for (const [digest, entry] of Object.entries(value.entries)) {
    if (!digestPattern.test(digest) || !isExactRecord(entry, ["unreferencedSince"])) {
      throw new Error("Project asset GC entry is invalid")
    }
    const unreferencedSince = entry.unreferencedSince
    if (typeof unreferencedSince !== "string") throw new Error("Project asset GC timestamp is invalid")
    const timestamp = Date.parse(unreferencedSince)
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== unreferencedSince || timestamp > now) {
      throw new Error("Project asset GC timestamp is invalid")
    }
    entries[digest] = { unreferencedSince }
  }
  return { entries, schemaVersion: 1 }
}

async function saveState(layout: AssetLayout, state: ProjectAssetGcState) {
  await assertLayout(layout)
  const temporaryPath = path.join(layout.assetRoot.path, `.gc-${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    handle = await fs.open(temporaryPath, "wx", 0o600)
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await assertLayout(layout)
    await fs.rename(temporaryPath, layout.statePath)
  } finally {
    if (handle) await handle.close().catch(() => undefined)
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function cleanProjectStaging(stagingPath: string, now: number) {
  const stat = await fs.lstat(stagingPath, { bigint: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return null
    throw error
  })
  if (!stat) return
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Project publication staging path is not a real directory")
  }
  const identity = await captureDirectory(stagingPath, "Project publication staging directory")
  await cleanOrdinaryStaging(identity, now, false)
}

async function cleanOrdinaryStaging(root: DirectoryIdentity, now: number, skipQuarantines: boolean) {
  await assertDirectory(root, "Project staging directory")
  const cutoff = now - projectAssetStagingRetentionMs
  for (const entry of await fs.readdir(root.path, { withFileTypes: true })) {
    if (skipQuarantines && quarantinePattern.test(entry.name)) continue
    const entryPath = path.join(root.path, entry.name)
    const stat = await fs.lstat(entryPath, { bigint: true })
    if (stat.isSymbolicLink() || !stat.isFile()) continue
    const latestChange = Math.max(Number(stat.ctimeMs), Number(stat.mtimeMs))
    if (latestChange >= cutoff) continue
    const current = await fs.lstat(entryPath, { bigint: true })
    if (current.isSymbolicLink() || !current.isFile()) continue
    assertSameSnapshot(stat, current, "Project staging file changed before cleanup")
    await fs.unlink(entryPath)
  }
  await assertDirectory(root, "Project staging directory")
}

async function ensureChildDirectory(parent: DirectoryIdentity, name: string, label: string) {
  await assertDirectory(parent, label)
  const targetPath = path.join(parent.path, name)
  try {
    await fs.mkdir(targetPath, { mode: 0o700 })
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error
  }
  await assertDirectory(parent, label)
  return captureDirectory(targetPath, label)
}

async function captureDirectory(targetPath: string, label: string): Promise<DirectoryIdentity> {
  const snapshot = await fs.lstat(targetPath, { bigint: true })
  if (snapshot.isSymbolicLink() || !snapshot.isDirectory()) throw new Error(`${label} is not a real directory`)
  const realPath = await fs.realpath(targetPath)
  if (!sameNativePath(realPath, targetPath)) throw new Error(`${label} resolves through a symbolic link`)
  return { path: targetPath, realPath, snapshot }
}

async function assertLayout(layout: AssetLayout) {
  await assertDirectory(layout.assetRoot, "Project asset directory")
  await assertDirectory(layout.blobRoot, "Project asset blob directory")
  await assertDirectory(layout.managedStagingRoot, "Project managed-asset staging directory")
}

async function assertDirectory(identity: DirectoryIdentity, label: string) {
  const current = await fs.lstat(identity.path, { bigint: true })
  if (
    current.isSymbolicLink() ||
    !current.isDirectory() ||
    !sameIdentity(identity.snapshot, current) ||
    !sameNativePath(await fs.realpath(identity.path), identity.realPath)
  ) {
    throw new Error(`${label} changed after validation`)
  }
}

async function verifyIfPresent(targetPath: string, digest: string, maximumBytes: number, label: string) {
  try {
    return await verifyDigestFile(targetPath, digest, maximumBytes, label)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null
    throw error
  }
}

async function verifyDigestFile(
  targetPath: string,
  expectedDigest: string,
  maximumBytes: number,
  label: string,
): Promise<VerifiedFile> {
  const snapshot = await fs.lstat(targetPath, { bigint: true })
  if (snapshot.isSymbolicLink()) throw new Error(`${label} is a symbolic link`)
  if (!snapshot.isFile()) throw new Error(`${label} is not a regular file`)
  if (snapshot.size > BigInt(maximumBytes)) throw new Error(`${label} exceeds maximum size`)
  const handle = await fs.open(targetPath, secureReadFlags())
  try {
    const opened = await handle.stat({ bigint: true })
    assertSameSnapshot(snapshot, opened, `${label} changed while opening`)
    const hash = createHash("sha256")
    const buffer = Buffer.allocUnsafe(hashChunkBytes)
    let totalBytes = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null)
      if (bytesRead === 0) break
      totalBytes += bytesRead
      if (totalBytes > maximumBytes) throw new Error(`${label} exceeds maximum size`)
      hash.update(buffer.subarray(0, bytesRead))
    }
    const afterHandle = await handle.stat({ bigint: true })
    const afterPath = await fs.lstat(targetPath, { bigint: true })
    assertSameSnapshot(snapshot, afterHandle, `${label} changed while hashing`)
    assertSameSnapshot(snapshot, afterPath, `${label} changed while hashing`)
    const actual = hash.digest("hex")
    if (actual !== expectedDigest) {
      throw new Error(`${label} digest mismatch: expected ${expectedDigest}, received ${actual}`)
    }
    return { path: targetPath, snapshot }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function assertSameSnapshot(before: BigIntStats, after: BigIntStats, message: string) {
  if (
    !sameIdentity(before, after) ||
    before.mode !== after.mode ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  ) {
    throw new Error(message)
  }
}

function assertSameContentSnapshot(before: BigIntStats, after: BigIntStats, message: string) {
  if (
    !sameIdentity(before, after) ||
    before.mode !== after.mode ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs
  ) {
    throw new Error(message)
  }
}

function sameIdentity(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev && left.ino === right.ino
}

function sameNativePath(left: string, right: string) {
  const leftPath = path.resolve(left)
  const rightPath = path.resolve(right)
  return process.platform === "win32"
    ? leftPath.toLocaleLowerCase("en-US") === rightPath.toLocaleLowerCase("en-US")
    : leftPath === rightPath
}

function secureReadFlags() {
  let flags = fsConstants.O_RDONLY
  if (process.platform !== "win32") {
    flags |= fsConstants.O_NOFOLLOW
    flags |= fsConstants.O_NONBLOCK
  }
  return flags
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
