import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { fsyncProjectDirectory } from "./directory-durability"

const MARKER_FORMAT = "convax.immediate-predecessor-migration"
const MARKER_FILE = "collaboration-migration.json"
const MIGRATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

type MigrationPhase = "prepared" | "old-moved" | "current-published"

interface MigrationMarker {
  readonly format: typeof MARKER_FORMAT
  readonly phase: MigrationPhase
  readonly migrationId: string
  readonly stageName: string
  readonly rollbackName: string
  readonly parentDevice: string
  readonly parentInode: string
  readonly sourceDevice: string
  readonly sourceInode: string
  readonly stageDevice: string
  readonly stageInode: string
  readonly sourceClosureDigest: string
  readonly expectedCurrentAuthority: MigrationCurrentAuthorityIdentity
}

export interface MigrationCurrentAuthorityIdentity {
  readonly mode: "local-project-owner" | "team-replica"
  readonly actorId: string
  readonly memberId: string
  readonly replicaId: string
  readonly authorizationDigest: string
  readonly authorityDigest: string
}

interface DirectoryIdentity { readonly device: string; readonly inode: string }

export interface ImmediatePredecessorCutoverFaultHooks {
  beforeOldRename?(): Promise<void>
  afterOldRenameBeforeCurrentRename?(): Promise<void>
  afterCurrentRenameBeforeParentFsync?(): Promise<void>
  afterCurrentParentFsyncBeforeCleanup?(): Promise<void>
  beforeRollbackCleanup?(): Promise<void>
}

export interface MigrateImmediatePredecessorCollaborationStoreInput {
  /** Canonical registered Project root that owns the target below. */
  readonly projectRoot: string
  /** Must be the exact `.convax/collaboration` directory. */
  readonly collaborationDirectory: string
  /** Returns the exact verified manifest+inventory+all-head closure digest. */
  readonly inspectImmediatePredecessor: (directory: string) => Promise<string>
  /** Exact closure used to build the staged current import. */
  readonly expectedSourceClosureDigest: string
  readonly expectedCurrentAuthority: MigrationCurrentAuthorityIdentity
  /** Writes a complete current store into the empty same-filesystem stage. */
  readonly buildCurrentStore: (stageDirectory: string) => Promise<void>
  /** Reopens and validates every staged/current ProjectIndex and Canvas shard. */
  readonly verifyCurrentStore: (
    directory: string,
    expectedSourceClosureDigest: string,
    expectedCurrentAuthority: MigrationCurrentAuthorityIdentity,
  ) => Promise<void>
  readonly hooks?: ImmediatePredecessorCutoverFaultHooks
}

/**
 * One-shot, same-filesystem, rollback-capable switch. The old private
 * collaboration tree exists only as an exact rollback sibling until the new
 * current tree has reopened successfully; it is never retained as an archive.
 */
export async function migrateImmediatePredecessorCollaborationStore(
  input: MigrateImmediatePredecessorCollaborationStoreInput,
): Promise<void> {
  const layout = migrationLayout(input.projectRoot, input.collaborationDirectory)
  const boundary = await captureMigrationBoundary(input.projectRoot, layout.parent)
  const releaseLock = await acquireMigrationLock(layout.lock, layout.parent, boundary.parent)
  try {
    await recoverImmediatePredecessorCollaborationCutoverUnlocked(
      layout,
      input.verifyCurrentStore,
      input.inspectImmediatePredecessor,
    )
    const parentIdentity = await requireDirectoryIdentity(
      layout.parent,
      input.projectRoot,
      boundary.projectRoot,
      boundary.parent,
    )
    const sourceIdentity = await readDirectoryIdentity(layout.current, layout.parent, parentIdentity)
    const sourceClosureDigest = requireClosureDigest(input.expectedSourceClosureDigest)
    if (await input.inspectImmediatePredecessor(layout.current) !== sourceClosureDigest) {
      throw new TypeError("Prepared import no longer matches the immediate-predecessor source closure")
    }

    const migrationId = randomUUID()
    const stageName = `collaboration-migration-stage-${migrationId}`
    const rollbackName = `collaboration-migration-rollback-${migrationId}`
    const stage = path.join(layout.parent, stageName)
    const rollback = path.join(layout.parent, rollbackName)
    await fs.mkdir(stage, { mode: 0o700 })
    let stageIdentity = await readDirectoryIdentity(stage, layout.parent, parentIdentity)
    try {
    await input.buildCurrentStore(stage)
    await input.verifyCurrentStore(stage, sourceClosureDigest, input.expectedCurrentAuthority)
    stageIdentity = await requireDirectoryIdentity(stage, layout.parent, parentIdentity, stageIdentity)
    await requireDirectoryIdentity(layout.current, layout.parent, parentIdentity, sourceIdentity)
    const marker: MigrationMarker = Object.freeze({
      format: MARKER_FORMAT,
      phase: "prepared",
      migrationId,
      stageName,
      rollbackName,
      parentDevice: parentIdentity.device,
      parentInode: parentIdentity.inode,
      sourceDevice: sourceIdentity.device,
      sourceInode: sourceIdentity.inode,
      stageDevice: stageIdentity.device,
      stageInode: stageIdentity.inode,
      sourceClosureDigest,
      expectedCurrentAuthority: parseCurrentAuthorityIdentity(input.expectedCurrentAuthority),
    })
    await writeMarker(layout.marker, marker, null)
    await input.hooks?.beforeOldRename?.()

    await requireDirectoryIdentity(layout.current, layout.parent, parentIdentity, sourceIdentity)
    if (await input.inspectImmediatePredecessor(layout.current) !== sourceClosureDigest) {
      throw new TypeError("Immediate-predecessor source closure changed before cutover")
    }
    await assertMissing(rollback)
    await fs.rename(layout.current, rollback)
    await requireDirectoryIdentity(rollback, layout.parent, parentIdentity, sourceIdentity)
    if (await input.inspectImmediatePredecessor(rollback) !== sourceClosureDigest) {
      throw new TypeError("Immediate-predecessor source closure changed during cutover")
    }
    await fsyncProjectDirectory(layout.parent)
    await writeMarker(layout.marker, { ...marker, phase: "old-moved" }, "prepared")
    await input.hooks?.afterOldRenameBeforeCurrentRename?.()

    await requireDirectoryIdentity(stage, layout.parent, parentIdentity, stageIdentity)
    await assertMissing(layout.current)
    await fs.rename(stage, layout.current)
    await requireDirectoryIdentity(layout.current, layout.parent, parentIdentity, stageIdentity)
    await input.hooks?.afterCurrentRenameBeforeParentFsync?.()
    await fsyncProjectDirectory(layout.parent)
    await input.verifyCurrentStore(layout.current, sourceClosureDigest, marker.expectedCurrentAuthority)
    await input.hooks?.afterCurrentParentFsyncBeforeCleanup?.()
    await input.hooks?.beforeRollbackCleanup?.()
    if (await input.inspectImmediatePredecessor(rollback) !== sourceClosureDigest) {
      throw new TypeError("Immediate-predecessor rollback closure changed before cleanup")
    }
    await writeMarker(layout.marker, { ...marker, phase: "current-published" }, "old-moved")

    await removeExactTree(rollback, layout.parent, parentIdentity, sourceIdentity)
    await removeMarker(layout.marker)
    } catch (error) {
      await recoverImmediatePredecessorCollaborationCutoverUnlocked(
        layout,
        input.verifyCurrentStore,
        input.inspectImmediatePredecessor,
      ).catch(() => undefined)
      if (await exists(stage)) {
        await removeExactTree(stage, layout.parent, parentIdentity, stageIdentity).catch(() => undefined)
      }
      throw error
    }
  } finally {
    await releaseLock()
  }
}

export async function recoverImmediatePredecessorCollaborationCutover(input: {
  readonly projectRoot: string
  readonly collaborationDirectory: string
  readonly verifyCurrentStore: (
    directory: string,
    expectedSourceClosureDigest: string,
    expectedCurrentAuthority: MigrationCurrentAuthorityIdentity,
  ) => Promise<void>
  readonly inspectImmediatePredecessor: (directory: string) => Promise<string>
}): Promise<"none" | "restored-predecessor" | "completed-current"> {
  const layout = migrationLayout(input.projectRoot, input.collaborationDirectory)
  const boundary = await captureMigrationBoundary(input.projectRoot, layout.parent)
  const releaseLock = await acquireMigrationLock(layout.lock, layout.parent, boundary.parent)
  try {
    return await recoverImmediatePredecessorCollaborationCutoverUnlocked(
      layout,
      input.verifyCurrentStore,
      input.inspectImmediatePredecessor,
    )
  } finally {
    await releaseLock()
  }
}

async function captureMigrationBoundary(
  projectRoot: string,
  parent: string,
): Promise<Readonly<{ projectRoot: DirectoryIdentity; parent: DirectoryIdentity }>> {
  const projectRootIdentity = await readDirectoryIdentity(projectRoot, path.dirname(projectRoot))
  const parentIdentity = await readDirectoryIdentity(parent, projectRoot, projectRootIdentity)
  return Object.freeze({ projectRoot: projectRootIdentity, parent: parentIdentity })
}

async function recoverImmediatePredecessorCollaborationCutoverUnlocked(
  layout: ReturnType<typeof migrationLayout>,
  verifyCurrentStore: (
    directory: string,
    expectedSourceClosureDigest: string,
    expectedCurrentAuthority: MigrationCurrentAuthorityIdentity,
  ) => Promise<void>,
  inspectImmediatePredecessor: (directory: string) => Promise<string>,
): Promise<"none" | "restored-predecessor" | "completed-current"> {
  const marker = await readMarker(layout.marker)
  if (marker === null) return "none"
  const stage = path.join(layout.parent, marker.stageName)
  const rollback = path.join(layout.parent, marker.rollbackName)
  const parentIdentity = Object.freeze({ device: marker.parentDevice, inode: marker.parentInode })
  const sourceIdentity = Object.freeze({ device: marker.sourceDevice, inode: marker.sourceInode })
  const stageIdentity = Object.freeze({ device: marker.stageDevice, inode: marker.stageInode })
  await requireDirectoryIdentity(layout.parent, path.dirname(layout.parent), undefined, parentIdentity)

  if (marker.phase === "current-published") {
    try {
      await requireDirectoryIdentity(layout.current, layout.parent, parentIdentity, stageIdentity)
      await verifyCurrentStore(layout.current, marker.sourceClosureDigest, marker.expectedCurrentAuthority)
      if (await exists(rollback)) {
        if (await inspectImmediatePredecessor(rollback) !== marker.sourceClosureDigest) {
          throw new TypeError("Published migration does not match its rollback closure")
        }
        await removeExactTree(rollback, layout.parent, parentIdentity, sourceIdentity)
      }
      if (await exists(stage)) await removeExactTree(stage, layout.parent, parentIdentity, stageIdentity)
      await removeMarker(layout.marker)
      return "completed-current"
    } catch (error) {
      if (!(await exists(rollback))) throw error
      if (await exists(layout.current)) await removeExactTree(layout.current, layout.parent, parentIdentity, stageIdentity)
      await requireDirectoryIdentity(rollback, layout.parent, parentIdentity, sourceIdentity)
      await fs.rename(rollback, layout.current)
      await requireDirectoryIdentity(layout.current, layout.parent, parentIdentity, sourceIdentity)
      await fsyncProjectDirectory(layout.parent)
      if (await exists(stage)) await removeExactTree(stage, layout.parent, parentIdentity, stageIdentity)
      await removeMarker(layout.marker)
      return "restored-predecessor"
    }
  }

  // Before `current-published`, recovery always returns to the untouched old
  // store. A stage that happened to be renamed is disposable and rebuilt.
  if (await exists(rollback)) {
    if (await exists(layout.current)) await removeExactTree(layout.current, layout.parent, parentIdentity, stageIdentity)
    await requireDirectoryIdentity(rollback, layout.parent, parentIdentity, sourceIdentity)
    await fs.rename(rollback, layout.current)
    await requireDirectoryIdentity(layout.current, layout.parent, parentIdentity, sourceIdentity)
    await fsyncProjectDirectory(layout.parent)
  }
  if (await exists(stage)) await removeExactTree(stage, layout.parent, parentIdentity, stageIdentity)
  await removeMarker(layout.marker)
  return "restored-predecessor"
}

function migrationLayout(projectRoot: string, collaborationDirectory: string) {
  if (
    !path.isAbsolute(projectRoot) || path.resolve(projectRoot) !== projectRoot ||
    collaborationDirectory !== path.join(projectRoot, ".convax", "collaboration")
  ) {
    throw new TypeError("Immediate-predecessor migration requires the exact registered Project collaboration directory")
  }
  const parent = path.dirname(collaborationDirectory)
  return Object.freeze({
    current: collaborationDirectory,
    parent,
    marker: path.join(parent, MARKER_FILE),
    lock: path.join(parent, "collaboration-migration.lock"),
  })
}

async function readDirectoryIdentity(
  target: string,
  boundary: string,
  expectedBoundary?: DirectoryIdentity,
): Promise<DirectoryIdentity> {
  const relative = path.relative(boundary, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new TypeError("Migration path escapes its private Project boundary")
  if (expectedBoundary) {
    const boundaryStat = await fs.lstat(boundary)
    if (
      !boundaryStat.isDirectory() || boundaryStat.isSymbolicLink() ||
      String(boundaryStat.dev) !== expectedBoundary.device || String(boundaryStat.ino) !== expectedBoundary.inode
    ) throw new TypeError("Migration parent directory identity changed")
  }
  const stat = await fs.lstat(target)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError("Migration target must be a plain directory")
  const real = await fs.realpath(target)
  const boundaryReal = await fs.realpath(boundary)
  const expectedReal = path.join(boundaryReal, relative)
  if (real !== expectedReal) throw new TypeError("Migration target is not its canonical real path")
  return Object.freeze({ device: String(stat.dev), inode: String(stat.ino) })
}

async function requireDirectoryIdentity(
  target: string,
  boundary: string,
  boundaryIdentity: DirectoryIdentity | undefined,
  expected: DirectoryIdentity,
): Promise<DirectoryIdentity> {
  const actual = await readDirectoryIdentity(target, boundary, boundaryIdentity)
  if (actual.device !== expected.device || actual.inode !== expected.inode) {
    throw new TypeError("Migration directory identity changed")
  }
  return actual
}

async function writeMarker(
  target: string,
  marker: MigrationMarker,
  expectedPhase: MigrationPhase | null,
): Promise<void> {
  const parsed = parseMarker(marker)
  if (expectedPhase === null) {
    await assertMissing(target)
  } else {
    const current = await readMarker(target)
    if (
      current === null || current.migrationId !== marker.migrationId ||
      current.phase !== expectedPhase
    ) throw new TypeError("Migration marker compare-and-swap failed")
  }
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.tmp`,
  )
  const handle = await fs.open(temporary, "wx", 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(parsed)}\n`, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(temporary, target)
  await fsyncProjectDirectory(path.dirname(target))
}

async function acquireMigrationLock(
  target: string,
  parent: string,
  parentIdentity: DirectoryIdentity,
): Promise<() => Promise<void>> {
  await requireDirectoryIdentity(parent, path.dirname(parent), undefined, parentIdentity)
  const token = randomUUID()
  let handle: Awaited<ReturnType<typeof fs.open>>
  try {
    handle = await fs.open(target, "wx", 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const owner = await readMigrationLockOwner(target)
    if (processIsAlive(owner.pid)) {
      throw new TypeError("Another Project collaboration migration owns the cutover lock")
    }
    await removeStaleMigrationLock(target, owner)
    return acquireMigrationLock(target, parent, parentIdentity)
  }
  const stat = await handle.stat()
  try {
    await requireDirectoryIdentity(parent, path.dirname(parent), undefined, parentIdentity)
    await handle.writeFile(`${JSON.stringify({ format: MARKER_FORMAT, pid: process.pid, token })}\n`, "utf8")
    await handle.sync()
    await fsyncProjectDirectory(path.dirname(target))
  } catch (error) {
    await handle.close().catch(() => undefined)
    const current = await fs.lstat(target).catch(() => null)
    if (current && String(current.dev) === String(stat.dev) && String(current.ino) === String(stat.ino)) {
      await fs.rm(target, { force: true }).catch(() => undefined)
    }
    throw error
  }
  let released = false
  return async () => {
    if (released) return
    released = true
    await handle.close()
    await requireDirectoryIdentity(parent, path.dirname(parent), undefined, parentIdentity)
    const current = await fs.lstat(target).catch(() => null)
    if (!current || String(current.dev) !== String(stat.dev) || String(current.ino) !== String(stat.ino)) {
      throw new TypeError("Migration cutover lock identity changed")
    }
    const bytes = await fs.readFile(target, "utf8")
    const decoded = JSON.parse(bytes) as { token?: unknown }
    if (decoded.token !== token) throw new TypeError("Migration cutover lock owner token changed")
    await fs.rm(target)
    await fsyncProjectDirectory(path.dirname(target))
  }
}

interface MigrationLockOwner {
  readonly format: typeof MARKER_FORMAT
  readonly pid: number
  readonly token: string
  readonly identity: DirectoryIdentity
}

async function readMigrationLockOwner(target: string): Promise<MigrationLockOwner> {
  const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < 1 || stat.size > 512) throw new TypeError("Migration lock record is invalid")
    const value = JSON.parse(await handle.readFile("utf8")) as Record<string, unknown>
    if (
      value.format !== MARKER_FORMAT ||
      !Number.isSafeInteger(value.pid) || Number(value.pid) < 1 ||
      !MIGRATION_ID.test(String(value.token))
    ) throw new TypeError("Migration lock owner is invalid")
    return Object.freeze({
      format: MARKER_FORMAT,
      pid: Number(value.pid),
      token: String(value.token),
      identity: Object.freeze({ device: String(stat.dev), inode: String(stat.ino) }),
    })
  } finally {
    await handle.close()
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}

async function removeStaleMigrationLock(target: string, owner: MigrationLockOwner): Promise<void> {
  const current = await readMigrationLockOwner(target)
  if (
    current.token !== owner.token || current.identity.device !== owner.identity.device ||
    current.identity.inode !== owner.identity.inode || processIsAlive(current.pid)
  ) throw new TypeError("Migration lock owner changed before stale recovery")
  const stale = path.join(path.dirname(target), `.collaboration-migration-stale-lock-${owner.token}-${randomUUID()}`)
  await assertMissing(stale)
  await fs.rename(target, stale)
  const moved = await readMigrationLockOwner(stale)
  if (
    moved.token !== owner.token || moved.identity.device !== owner.identity.device ||
    moved.identity.inode !== owner.identity.inode
  ) throw new TypeError("Migration stale lock identity changed")
  await fs.rm(stale)
  await fsyncProjectDirectory(path.dirname(target))
}

async function readMarker(target: string): Promise<MigrationMarker | null> {
  let bytes: string
  try {
    const stat = await fs.lstat(target)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new TypeError("Migration marker is not a bounded plain file")
    bytes = await fs.readFile(target, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
  return parseMarker(JSON.parse(bytes))
}

function parseMarker(value: unknown): MigrationMarker {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Migration marker is invalid")
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join("\0") !== [
    "expectedCurrentAuthority", "format", "migrationId", "parentDevice", "parentInode", "phase", "rollbackName",
    "sourceClosureDigest", "sourceDevice", "sourceInode", "stageDevice", "stageInode", "stageName",
  ].sort().join("\0")) {
    throw new TypeError("Migration marker fields are invalid")
  }
  if (record.format !== MARKER_FORMAT || !MIGRATION_ID.test(String(record.migrationId))) throw new TypeError("Migration marker identity is invalid")
  const migrationId = String(record.migrationId)
  if (record.stageName !== `collaboration-migration-stage-${migrationId}` || record.rollbackName !== `collaboration-migration-rollback-${migrationId}`) {
    throw new TypeError("Migration marker paths are invalid")
  }
  if (record.phase !== "prepared" && record.phase !== "old-moved" && record.phase !== "current-published") {
    throw new TypeError("Migration marker phase is invalid")
  }
  for (const key of [
    "parentDevice", "parentInode", "sourceDevice", "sourceInode", "stageDevice", "stageInode",
  ] as const) {
    if (typeof record[key] !== "string" || !/^[0-9]+$/u.test(record[key])) {
      throw new TypeError("Migration marker directory identity is invalid")
    }
  }
  const sourceClosureDigest = requireClosureDigest(record.sourceClosureDigest)
  const expectedCurrentAuthority = parseCurrentAuthorityIdentity(record.expectedCurrentAuthority)
  return Object.freeze({
    format: MARKER_FORMAT,
    phase: record.phase,
    migrationId,
    stageName: record.stageName,
    rollbackName: record.rollbackName,
    parentDevice: record.parentDevice as string,
    parentInode: record.parentInode as string,
    sourceDevice: record.sourceDevice as string,
    sourceInode: record.sourceInode as string,
    stageDevice: record.stageDevice as string,
    stageInode: record.stageInode as string,
    sourceClosureDigest,
    expectedCurrentAuthority,
  })
}

function parseCurrentAuthorityIdentity(value: unknown): MigrationCurrentAuthorityIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Migration current authority identity is invalid")
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join("\0") !== [
    "actorId", "authorityDigest", "authorizationDigest", "memberId", "mode", "replicaId",
  ].sort().join("\0")) throw new TypeError("Migration current authority fields are invalid")
  if (record.mode !== "local-project-owner" && record.mode !== "team-replica") {
    throw new TypeError("Migration current authority mode is invalid")
  }
  for (const key of ["actorId", "memberId", "replicaId", "authorizationDigest", "authorityDigest"] as const) {
    if (typeof record[key] !== "string" || record[key].length < 1 || record[key].length > 256) {
      throw new TypeError("Migration current authority value is invalid")
    }
  }
  for (const key of ["authorizationDigest", "authorityDigest"] as const) requireClosureDigest(record[key])
  return Object.freeze({
    mode: record.mode,
    actorId: record.actorId as string,
    memberId: record.memberId as string,
    replicaId: record.replicaId as string,
    authorizationDigest: record.authorizationDigest as string,
    authorityDigest: record.authorityDigest as string,
  })
}

function requireClosureDigest(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError("Migration source closure digest is invalid")
  }
  return value
}

async function removeExactTree(
  target: string,
  boundary: string,
  boundaryIdentity: DirectoryIdentity,
  expected: DirectoryIdentity,
): Promise<void> {
  await requireDirectoryIdentity(target, boundary, boundaryIdentity, expected)
  const disposal = path.join(boundary, `.collaboration-migration-delete-${randomUUID()}`)
  await assertMissing(disposal)
  await fs.rename(target, disposal)
  await requireDirectoryIdentity(disposal, boundary, boundaryIdentity, expected)
  await fsyncProjectDirectory(boundary)
  await fs.rm(disposal, { recursive: true })
  await fsyncProjectDirectory(boundary)
}

async function removeMarker(target: string): Promise<void> {
  await fs.rm(target, { force: true })
  await fsyncProjectDirectory(path.dirname(target))
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

async function assertMissing(target: string): Promise<void> {
  if (await exists(target)) throw new TypeError("Migration destination already exists")
}
