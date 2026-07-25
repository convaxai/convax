import { createHash, randomUUID } from "node:crypto"
import { AsyncLocalStorage } from "node:async_hooks"
import { constants as fsConstants, type BigIntStats } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {
  managedAssetPath,
  requireProjectResourceReference,
  type ProjectResourceReference,
} from "../../canvas/project-resources"

export interface ProjectRootResolver {
  resolveProjectRoot(input: { projectId: string }): Promise<string>
}

type ManagedAssetReference = Extract<ProjectResourceReference, { kind: "managed-asset" }>

export interface ExternalManagedAssetInput {
  mediaType?: string
  name: string
  sourcePath: string
}

export interface ProjectManagedAssetStoreOptions {
  maximumBytes?: number
  now?: () => number
  randomId?: () => string
}

export const defaultProjectManagedAssetMaximumBytes = 8 * 1024 ** 3
const copyChunkBytes = 64 * 1024

class ProjectAssetMutex {
  readonly #queues = new Map<string, Promise<void>>()

  async run<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(projectId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.catch(() => undefined).then(() => current)
    this.#queues.set(projectId, queued)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.#queues.get(projectId) === queued) this.#queues.delete(projectId)
    }
  }
}

export class ProjectManagedAssetStore {
  readonly #lockContext = new AsyncLocalStorage<ProjectAssetLockScope>()
  readonly #maximumBytes: number
  readonly #mutex = new ProjectAssetMutex()
  readonly #now: () => number
  readonly #randomId: () => string

  constructor(
    private readonly roots: ProjectRootResolver,
    options: ProjectManagedAssetStoreOptions = {},
  ) {
    const maximumBytes = options.maximumBytes ?? defaultProjectManagedAssetMaximumBytes
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new Error("Managed asset maximumBytes must be a positive safe integer")
    }
    this.#maximumBytes = maximumBytes
    this.#now = options.now ?? Date.now
    this.#randomId = options.randomId ?? (() => `${this.#now().toString(36)}-${randomUUID()}`)
  }

  admitExternalFile(input: ExternalManagedAssetInput & { projectId: string }) {
    return this.runExclusive(input.projectId, async () => {
      const layout = await this.#resolveLayout(input.projectId)
      return this.#admitExternalFileUnlocked(layout, input)
    })
  }

  withAdmittedLocalFiles<T>(
    input: { files: readonly ExternalManagedAssetInput[]; projectId: string },
    commit: (references: readonly ProjectResourceReference[]) => Promise<T>,
  ) {
    return this.runExclusive(input.projectId, async () => {
      const layout = await this.#resolveLayout(input.projectId)
      const references: ProjectResourceReference[] = []
      for (const file of input.files) {
        references.push(await this.#classifyLocalFileUnlocked(layout, { ...file, projectId: input.projectId }))
      }
      return commit(references)
    })
  }

  resolve(input: { projectId: string; reference: ManagedAssetReference }) {
    return this.runExclusive(input.projectId, async () => {
      const layout = await this.#resolveLayout(input.projectId)
      return this.#verifyReferenceUnlocked(layout, input.reference)
    })
  }

  withVerifiedReferences<T>(
    input: { projectId: string; references: readonly ManagedAssetReference[] },
    commit: () => Promise<T>,
  ) {
    const scope = this.#lockContext.getStore()
    if (scope?.active && scope.root.projectId === input.projectId) {
      return this.#runNestedVerification(scope.root, input, commit)
    }
    return this.runExclusive(input.projectId, async () => {
      const layout = await this.#resolveLayout(input.projectId)
      for (const reference of input.references) {
        await this.#verifyReferenceUnlocked(layout, reference)
      }
      return commit()
    })
  }

  runExclusive<T>(projectId: string, operation: () => Promise<T>) {
    if (!projectId) throw new Error("Project id is required")
    const scope = this.#lockContext.getStore()
    if (scope?.active) {
      return Promise.reject(
        new Error(
          "Cannot enter another active Project asset lock; only same-Project withVerifiedReferences may reuse it",
        ),
      )
    }
    return this.#mutex.run(projectId, () => this.#runLockScope(projectId, operation))
  }

  getMaximumBytesForMaintenance() {
    return this.#maximumBytes
  }

  async #runLockScope<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const root: ProjectAssetLockRoot = { nested: [], projectId }
    const scope: ProjectAssetLockScope = { active: true, root }
    return this.#lockContext.run(scope, async () => {
      try {
        return await operation()
      } finally {
        scope.active = false
        let settled = 0
        while (settled < root.nested.length) {
          const pending = root.nested.slice(settled)
          settled = root.nested.length
          await Promise.allSettled(pending)
        }
      }
    })
  }

  #runNestedVerification<T>(
    root: ProjectAssetLockRoot,
    input: { projectId: string; references: readonly ManagedAssetReference[] },
    commit: () => Promise<T>,
  ) {
    const scope: ProjectAssetLockScope = { active: true, root }
    const nested = this.#lockContext.run(scope, async () => {
      try {
        const layout = await this.#resolveLayout(input.projectId)
        for (const reference of input.references) {
          await this.#verifyReferenceUnlocked(layout, reference)
        }
        return await commit()
      } finally {
        scope.active = false
      }
    })
    root.nested.push(nested)
    void nested.catch(() => undefined)
    return nested
  }

  async #admitExternalFileUnlocked(
    layout: ManagedAssetLayout,
    input: ExternalManagedAssetInput & { projectId: string },
  ): Promise<ManagedAssetReference> {
    const metadata = requireManagedAssetReference({
      kind: "managed-asset",
      ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
      name: input.name,
      sha256: "0".repeat(64),
    })
    if (typeof input.sourcePath !== "string" || !input.sourcePath.trim()) {
      throw new Error("External managed asset source path is required")
    }

    const sourcePath = path.resolve(input.sourcePath)
    if (isInsidePath(sourcePath, layout.projectRoot)) {
      throw new Error("External managed asset source must be outside the Project")
    }
    const sourceSnapshot = await fs.lstat(sourcePath, { bigint: true })
    assertRegularNonSymlink(sourceSnapshot, sourcePath, "Managed asset source")
    if (sourceSnapshot.size > BigInt(this.#maximumBytes)) {
      throw new Error(`Managed asset exceeds maximum size: ${input.name}`)
    }
    const realSource = await fs.realpath(sourcePath)
    if (isInsidePath(realSource, layout.projectRoot)) {
      throw new Error("External managed asset source must be outside the Project")
    }

    const operationId = requireOperationId(this.#randomId())
    const stagingPath = path.join(layout.stagingRoot, operationId)
    await assertManagedDirectories(layout)
    let ownedStaging: OwnedFile | undefined
    let ownedPublication: OwnedFile | undefined
    let publicationVerified = false
    try {
      const copied = await this.#copySourceToStaging({
        layout,
        realSource,
        sourcePath,
        sourceSnapshot,
        stagingPath,
      })
      ownedStaging = copied.staging

      await assertManagedDirectories(layout)
      await this.#verifyFile(stagingPath, copied.sha256, "Managed asset staging file")
      await assertOwnedFile(ownedStaging, "Managed asset staging file")
      await assertManagedDirectories(layout)
      const targetPath = path.join(layout.blobRoot, copied.sha256)
      try {
        await fs.link(stagingPath, targetPath)
        ownedPublication = await captureOwnedFile(targetPath, ownedStaging.snapshot, "Managed asset blob publication")
        if (!sameNativePath(path.dirname(ownedPublication.realPath), layout.blobDirectory.realPath)) {
          throw new Error("Managed asset blob directory changed during publication")
        }
        await assertManagedDirectories(layout)
        await this.#verifyFile(targetPath, copied.sha256, "Managed asset blob")
        await assertOwnedFile(ownedPublication, "Managed asset blob publication")
        await assertManagedDirectories(layout)
        publicationVerified = true
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error
        await assertManagedDirectories(layout)
        await this.#verifyFile(targetPath, copied.sha256, "Managed asset blob")
        await assertManagedDirectories(layout)
      }

      if (await unlinkOwnedFile(ownedStaging)) ownedStaging = undefined
      return requireManagedAssetReference({
        kind: "managed-asset",
        ...(metadata.mediaType === undefined ? {} : { mediaType: metadata.mediaType }),
        name: metadata.name,
        sha256: copied.sha256,
      })
    } finally {
      if (ownedPublication && !publicationVerified) {
        await unlinkOwnedPublishedFile(ownedPublication, ownedStaging)
      }
      if (ownedStaging) await unlinkOwnedFile(ownedStaging)
    }
  }

  async #classifyLocalFileUnlocked(
    layout: ManagedAssetLayout,
    input: ExternalManagedAssetInput & { projectId: string },
  ): Promise<ProjectResourceReference> {
    if (typeof input.sourcePath !== "string" || !input.sourcePath.trim()) {
      throw new Error("Local Canvas file source path is required")
    }
    const sourcePath = path.resolve(input.sourcePath)
    const before = await fs.lstat(sourcePath, { bigint: true })
    assertRegularNonSymlink(before, sourcePath, "Local Canvas file source")
    const realSource = await fs.realpath(sourcePath)
    const realSnapshot = await fs.lstat(realSource, { bigint: true })
    assertRegularNonSymlink(realSnapshot, realSource, "Local Canvas file source")
    if (!sameFileIdentity(before, realSnapshot)) {
      throw new Error("Local Canvas file source changed while it was classified")
    }

    if (!isInsidePath(realSource, layout.projectRoot)) {
      return this.#admitExternalFileUnlocked(layout, input)
    }

    const relativePath = path.relative(layout.projectRoot, realSource).split(path.sep).join("/")
    const reference = requireProjectResourceReference({ kind: "project-file", path: relativePath })
    const after = await fs.lstat(realSource, { bigint: true })
    assertRegularNonSymlink(after, realSource, "Local Canvas file source")
    assertSameContentSnapshot(before, after, "Local Canvas file source changed while it was classified")
    return reference
  }

  async #copySourceToStaging(input: {
    layout: ManagedAssetLayout
    realSource: string
    sourcePath: string
    sourceSnapshot: BigIntStats
    stagingPath: string
  }) {
    const source = await fs.open(input.sourcePath, secureReadFlags())
    let staging: Awaited<ReturnType<typeof fs.open>> | undefined
    let ownedStaging: OwnedFile | undefined
    try {
      const openedSnapshot = await source.stat({ bigint: true })
      assertRegularNonSymlink(openedSnapshot, input.sourcePath, "Managed asset source")
      assertSameSnapshot(input.sourceSnapshot, openedSnapshot, "Managed asset source changed before copy")
      if (!sameNativePath(await fs.realpath(input.sourcePath), input.realSource)) {
        throw new Error("Managed asset source changed before copy")
      }

      await assertManagedDirectories(input.layout)
      staging = await fs.open(input.stagingPath, "wx", 0o600)
      const openedStagingSnapshot = await staging.stat({ bigint: true })
      assertRegularNonSymlink(openedStagingSnapshot, input.stagingPath, "Managed asset staging file")
      ownedStaging = await captureOwnedFile(input.stagingPath, openedStagingSnapshot, "Managed asset staging file")
      if (!sameNativePath(path.dirname(ownedStaging.realPath), input.layout.stagingDirectory.realPath)) {
        throw new Error("Managed asset staging directory changed before copy")
      }
      await assertManagedDirectories(input.layout)
      const hash = createHash("sha256")
      const buffer = Buffer.allocUnsafe(copyChunkBytes)
      let totalBytes = 0
      while (true) {
        const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, null)
        if (bytesRead === 0) break
        totalBytes += bytesRead
        if (totalBytes > this.#maximumBytes) {
          throw new Error("Managed asset exceeds maximum size")
        }
        const chunk = buffer.subarray(0, bytesRead)
        hash.update(chunk)
        await writeAll(staging, chunk)
      }
      await staging.sync()
      await staging.close()
      staging = undefined

      const afterHandleSnapshot = await source.stat({ bigint: true })
      const afterPathSnapshot = await fs.lstat(input.sourcePath, { bigint: true })
      assertRegularNonSymlink(afterPathSnapshot, input.sourcePath, "Managed asset source")
      assertSameSnapshot(input.sourceSnapshot, afterHandleSnapshot, "Managed asset source changed during copy")
      assertSameSnapshot(input.sourceSnapshot, afterPathSnapshot, "Managed asset source changed during copy")
      if (!sameNativePath(await fs.realpath(input.sourcePath), input.realSource)) {
        throw new Error("Managed asset source changed during copy")
      }
      await assertOwnedFile(ownedStaging, "Managed asset staging file")
      await assertManagedDirectories(input.layout)
      return { sha256: hash.digest("hex"), staging: ownedStaging }
    } catch (error) {
      if (staging) await staging.close().catch(() => undefined)
      if (ownedStaging) await unlinkOwnedFile(ownedStaging)
      throw error
    } finally {
      await source.close().catch(() => undefined)
    }
  }

  async #verifyReferenceUnlocked(layout: ManagedAssetLayout, reference: ManagedAssetReference) {
    const normalized = requireManagedAssetReference(reference)
    const targetPath = path.join(layout.projectRoot, managedAssetPath(normalized.sha256))
    await assertManagedDirectories(layout)
    await this.#verifyFile(targetPath, normalized.sha256, "Managed asset blob")
    await assertManagedDirectories(layout)
    return targetPath
  }

  async #verifyFile(targetPath: string, expectedDigest: string, label: string) {
    const pathSnapshot = await fs.lstat(targetPath, { bigint: true })
    assertRegularNonSymlink(pathSnapshot, targetPath, label)
    if (pathSnapshot.size > BigInt(this.#maximumBytes)) {
      throw new Error(`${label} exceeds maximum size`)
    }

    const handle = await fs.open(targetPath, secureReadFlags())
    try {
      const openedSnapshot = await handle.stat({ bigint: true })
      assertRegularNonSymlink(openedSnapshot, targetPath, label)
      assertSameContentSnapshot(pathSnapshot, openedSnapshot, `${label} changed during verification`)
      const hash = createHash("sha256")
      const buffer = Buffer.allocUnsafe(copyChunkBytes)
      let totalBytes = 0
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null)
        if (bytesRead === 0) break
        totalBytes += bytesRead
        if (totalBytes > this.#maximumBytes) throw new Error(`${label} exceeds maximum size`)
        hash.update(buffer.subarray(0, bytesRead))
      }

      const afterHandleSnapshot = await handle.stat({ bigint: true })
      const afterPathSnapshot = await fs.lstat(targetPath, { bigint: true })
      assertRegularNonSymlink(afterPathSnapshot, targetPath, label)
      assertSameContentSnapshot(pathSnapshot, afterHandleSnapshot, `${label} changed during verification`)
      assertSameContentSnapshot(pathSnapshot, afterPathSnapshot, `${label} changed during verification`)
      const actualDigest = hash.digest("hex")
      if (actualDigest !== expectedDigest) {
        throw new Error(`${label} digest mismatch: expected ${expectedDigest}, received ${actualDigest}`)
      }
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  async #resolveLayout(projectId: string): Promise<ManagedAssetLayout> {
    const requestedRoot = path.resolve(await this.roots.resolveProjectRoot({ projectId }))
    const projectRoot = await fs.realpath(requestedRoot)
    const privateRoot = path.join(projectRoot, ".convax")
    const assetRoot = path.join(privateRoot, "assets")
    const blobRoot = path.join(assetRoot, "blobs")
    const stagingRoot = path.join(assetRoot, ".staging")
    await ensureRealDirectory(privateRoot)
    await ensureRealDirectory(assetRoot)
    await ensureRealDirectory(blobRoot)
    await ensureRealDirectory(stagingRoot)
    const blobDirectory = await captureDirectory(blobRoot, "Managed asset blob directory")
    const stagingDirectory = await captureDirectory(stagingRoot, "Managed asset staging directory")
    return {
      assetRoot,
      blobDirectory,
      blobRoot,
      privateRoot,
      projectRoot,
      stagingDirectory,
      stagingRoot,
    }
  }
}

interface ManagedAssetLayout {
  assetRoot: string
  blobDirectory: DirectoryIdentity
  blobRoot: string
  privateRoot: string
  projectRoot: string
  stagingDirectory: DirectoryIdentity
  stagingRoot: string
}

interface ProjectAssetLockRoot {
  nested: Promise<unknown>[]
  projectId: string
}

interface ProjectAssetLockScope {
  active: boolean
  root: ProjectAssetLockRoot
}

interface DirectoryIdentity {
  path: string
  realPath: string
  snapshot: BigIntStats
}

interface OwnedFile {
  path: string
  realPath: string
  snapshot: BigIntStats
}

function requireManagedAssetReference(value: unknown): ManagedAssetReference {
  const reference = requireProjectResourceReference(value)
  if (reference.kind !== "managed-asset") throw new Error("Managed asset reference is required")
  return reference
}

function secureReadFlags() {
  let flags = fsConstants.O_RDONLY
  if (process.platform !== "win32") {
    flags |= fsConstants.O_NOFOLLOW
    flags |= fsConstants.O_NONBLOCK
  }
  return flags
}

function assertRegularNonSymlink(stat: BigIntStats, targetPath: string, label: string) {
  if (stat.isSymbolicLink()) throw new Error(`${label} is a symbolic link: ${targetPath}`)
  if (!stat.isFile()) throw new Error(`${label} must be a regular file: ${targetPath}`)
}

function assertSameSnapshot(before: BigIntStats, after: BigIntStats, message: string) {
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
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
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mode !== after.mode ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs
  ) {
    throw new Error(message)
  }
}

function isInsidePath(candidate: string, rootPath: string) {
  const relative = path.relative(rootPath, candidate)
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function requireOperationId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error("Managed asset operation id is invalid")
  }
  return value
}

async function ensureRealDirectory(targetPath: string) {
  try {
    await fs.mkdir(targetPath, { mode: 0o700 })
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error
  }
  const stat = await fs.lstat(targetPath)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Managed asset directory is not a real directory: ${targetPath}`)
  }
  if (!sameNativePath(await fs.realpath(targetPath), targetPath)) {
    throw new Error(`Managed asset directory resolves through a symbolic link: ${targetPath}`)
  }
}

async function captureDirectory(targetPath: string, label: string): Promise<DirectoryIdentity> {
  const snapshot = await fs.lstat(targetPath, { bigint: true })
  if (snapshot.isSymbolicLink() || !snapshot.isDirectory()) {
    throw new Error(`${label} is not a real directory: ${targetPath}`)
  }
  const realPath = await fs.realpath(targetPath)
  if (!sameNativePath(realPath, targetPath)) {
    throw new Error(`${label} resolves through a symbolic link: ${targetPath}`)
  }
  return { path: targetPath, realPath, snapshot }
}

async function assertManagedDirectories(layout: ManagedAssetLayout) {
  await assertDirectoryIdentity(layout.stagingDirectory, "Managed asset staging directory")
  await assertDirectoryIdentity(layout.blobDirectory, "Managed asset blob directory")
}

async function assertDirectoryIdentity(identity: DirectoryIdentity, label: string) {
  const current = await fs.lstat(identity.path, { bigint: true })
  if (current.isSymbolicLink() || !current.isDirectory()) {
    throw new Error(`${label} changed or became a symbolic link`)
  }
  if (
    !sameFileIdentity(identity.snapshot, current) ||
    identity.snapshot.mode !== current.mode ||
    !sameNativePath(await fs.realpath(identity.path), identity.realPath)
  ) {
    throw new Error(`${label} changed after it was validated`)
  }
}

async function captureOwnedFile(targetPath: string, expected: BigIntStats, label: string): Promise<OwnedFile> {
  const snapshot = await fs.lstat(targetPath, { bigint: true })
  assertRegularNonSymlink(snapshot, targetPath, label)
  if (!sameFileIdentity(expected, snapshot)) {
    throw new Error(`${label} changed before ownership could be confirmed`)
  }
  return { path: targetPath, realPath: await canonicalEntryPath(targetPath), snapshot }
}

async function assertOwnedFile(owned: OwnedFile, label: string) {
  const current = await fs.lstat(owned.realPath, { bigint: true })
  assertRegularNonSymlink(current, owned.realPath, label)
  if (
    !sameFileIdentity(owned.snapshot, current) ||
    !sameNativePath(await canonicalEntryPath(owned.path), owned.realPath)
  ) {
    throw new Error(`${label} changed after it was created`)
  }
  const handle = await fs.open(owned.path, secureReadFlags())
  try {
    const opened = await handle.stat({ bigint: true })
    const afterOpen = await fs.lstat(owned.realPath, { bigint: true })
    if (!opened.isFile() || !sameFileIdentity(owned.snapshot, opened) || !sameFileIdentity(owned.snapshot, afterOpen)) {
      throw new Error(`${label} changed after it was created`)
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function unlinkOwnedPublishedFile(publication: OwnedFile, staging: OwnedFile | undefined) {
  if (!staging || !sameFileIdentity(publication.snapshot, staging.snapshot)) return false
  return unlinkOwnedFile(publication)
}

async function unlinkOwnedFile(owned: OwnedFile) {
  let current: BigIntStats
  try {
    current = await fs.lstat(owned.realPath, { bigint: true })
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return true
    throw error
  }
  if (current.isSymbolicLink() || !current.isFile() || !sameFileIdentity(owned.snapshot, current)) {
    return false
  }
  await fs.unlink(owned.realPath)
  return true
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev && left.ino === right.ino
}

function sameNativePath(left: string, right: string) {
  const leftPath = path.resolve(left)
  const rightPath = path.resolve(right)
  return process.platform === "win32"
    ? leftPath.toLocaleLowerCase("en-US") === rightPath.toLocaleLowerCase("en-US")
    : leftPath === rightPath
}

async function canonicalEntryPath(targetPath: string) {
  return path.join(await fs.realpath(path.dirname(targetPath)), path.basename(targetPath))
}

async function writeAll(handle: Awaited<ReturnType<typeof fs.open>>, bytes: Uint8Array) {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null)
    if (bytesWritten === 0) throw new Error("Managed asset staging write made no progress")
    offset += bytesWritten
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
