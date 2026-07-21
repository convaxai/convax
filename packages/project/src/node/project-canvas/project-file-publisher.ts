import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants, type BigIntStats } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import type { ProjectCanvasFilePublisher } from "./project-canvas-resource-preparation"
import type { ProjectRootResolver } from "./project-managed-asset-store"

export interface ProjectFilePublisherOptions {
  maximumBytes?: number
  randomId?: () => string
}

export const defaultProjectTextPublicationMaximumBytes = 16 * 1024 * 1024
const maximumPublicationAttempts = 32
const maximumPortableComponentLength = 255
const maximumPublicationIdLength = 64
const publicationFileSuffix = `-${"i".repeat(maximumPublicationIdLength)}.md`
const maximumPublicationStemBytes = maximumPortableComponentLength - Buffer.byteLength(publicationFileSuffix, "utf8")
const maximumPublicationStemUtf16Units = maximumPortableComponentLength - publicationFileSuffix.length
const portableStemReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i

export class ProjectFilePublisher implements ProjectCanvasFilePublisher {
  readonly #maximumBytes: number
  readonly #randomId: () => string

  constructor(
    private readonly roots: ProjectRootResolver,
    options: ProjectFilePublisherOptions = {},
  ) {
    const maximumBytes = options.maximumBytes ?? defaultProjectTextPublicationMaximumBytes
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
      throw new Error("Project text publication maximumBytes must be a positive safe integer")
    }
    this.#maximumBytes = maximumBytes
    this.#randomId = options.randomId ?? randomUUID
  }

  async publishText(input: {
    content: string
    directory: "Notes"
    extension: ".md"
    name?: string
    projectId: string
  }) {
    if (input.directory !== "Notes" || input.extension !== ".md") {
      throw new Error("Project text publication only supports Notes Markdown files")
    }
    if (typeof input.content !== "string") throw new Error("Project text publication content must be a string")
    if (typeof input.projectId !== "string" || !input.projectId) throw new Error("Project id is required")

    const stem = requirePortableStem(input.name)
    const contentByteLength = Buffer.byteLength(input.content, "utf8")
    if (contentByteLength > this.#maximumBytes) {
      throw new Error("Project text publication exceeds the maximum size")
    }
    const content = Buffer.from(input.content, "utf8")
    const contentRevision = createHash("sha256").update(content).digest("hex")
    const layout = await this.#resolveLayout(input.projectId)
    const firstId = requirePublicationId(this.#randomId())
    const stagingPath = path.join(layout.staging.path, firstId)
    await assertPublicationDirectories(layout)

    const stagingHandle = await fs.open(stagingPath, "wx", 0o600)
    let staging: OwnedFile
    try {
      const opened = await stagingHandle.stat({ bigint: true })
      assertRegularFile(opened, "Project publication staging file")
      staging = await captureOwnedFile(stagingPath, opened, "Project publication staging file")
      if (!sameNativePath(path.dirname(staging.realPath), layout.staging.realPath)) {
        throw new Error("Project publication staging directory changed")
      }
      await assertPublicationDirectories(layout)
      await stagingHandle.writeFile(content)
      await stagingHandle.sync()
      const written = await stagingHandle.stat({ bigint: true })
      assertRegularFile(written, "Project publication staging file")
      if (!sameFileIdentity(staging.snapshot, written) || written.size !== BigInt(content.byteLength)) {
        throw new Error("Project publication staging file changed during write")
      }
      staging = { ...staging, snapshot: written }
    } finally {
      await stagingHandle.close().catch(() => undefined)
    }
    await assertPublicationDirectories(layout)

    for (let attempt = 0; attempt < maximumPublicationAttempts; attempt += 1) {
      const shortId = attempt === 0 ? firstId : requirePublicationId(this.#randomId())
      const fileName = `${stem}-${shortId}${input.extension}`
      const targetPath = path.join(layout.notes.path, fileName)
      await assertPublicationDirectories(layout)
      // Repeated identity checks fail closed on ordinary symlinks and replacements
      // completed before a check. Portable Node cannot make parent-directory
      // validation and link(2) one atomic operation, so this does not defend against
      // a same-UID actor concurrently replacing current-Project directory entries,
      // including .convax or Notes, between validation and the syscall.
      try {
        await fs.link(staging.path, targetPath)
      } catch (error) {
        if (isNodeError(error) && error.code === "EEXIST") continue
        throw error
      }

      const publication = await captureOwnedFile(targetPath, staging.snapshot, "Published Project file")
      if (!sameNativePath(path.dirname(publication.realPath), layout.notes.realPath)) {
        throw new Error("Project Notes directory changed during publication")
      }
      // A user-visible publication is never rolled back. Post-link verification
      // reports failure without unlinking the published path.
      await assertPublicationDirectories(layout)
      await verifyPublishedFile(publication, contentRevision, contentByteLength)
      return {
        contentRevision,
        path: `${input.directory}/${fileName}`,
      }
    }

    throw new Error("Project text publication could not find a unique name after repeated collisions")
  }

  async #resolveLayout(projectId: string): Promise<PublicationLayout> {
    const projectPath = path.resolve(await this.roots.resolveProjectRoot({ projectId }))
    const projectRoot = await captureDirectory(projectPath, "Project root")
    await assertDirectoryIdentity(projectRoot, "Project root")
    const privatePath = path.join(projectRoot.path, ".convax")
    const privateStorage = await captureDirectory(privatePath, "Project private storage")
    await assertDirectoryIdentity(projectRoot, "Project root")
    await assertDirectoryIdentity(privateStorage, "Project private storage")

    const stagingRoot = path.join(privateStorage.path, "staging")
    const notesRoot = path.join(projectRoot.path, "Notes")
    await assertDirectoryIdentity(projectRoot, "Project root")
    await assertDirectoryIdentity(privateStorage, "Project private storage")
    await ensureRealDirectory(stagingRoot, 0o700, "Project publication staging directory")
    await assertDirectoryIdentity(projectRoot, "Project root")
    await assertDirectoryIdentity(privateStorage, "Project private storage")
    const staging = await captureDirectory(stagingRoot, "Project publication staging directory")

    await assertDirectoryIdentity(projectRoot, "Project root")
    await assertDirectoryIdentity(privateStorage, "Project private storage")
    await assertDirectoryIdentity(staging, "Project publication staging directory")
    await ensureRealDirectory(notesRoot, 0o755, "Project Notes directory")
    await assertDirectoryIdentity(projectRoot, "Project root")
    await assertDirectoryIdentity(privateStorage, "Project private storage")
    await assertDirectoryIdentity(staging, "Project publication staging directory")
    const layout = {
      notes: await captureDirectory(notesRoot, "Project Notes directory"),
      privateStorage,
      projectRoot,
      staging,
    }
    await assertPublicationDirectories(layout)
    return layout
  }
}

interface PublicationLayout {
  notes: DirectoryIdentity
  privateStorage: DirectoryIdentity
  projectRoot: DirectoryIdentity
  staging: DirectoryIdentity
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

function requirePortableStem(value: string | undefined) {
  if (value !== undefined && typeof value !== "string") throw new Error("Project publication name must be a string")
  if (value !== undefined && !hasOnlyUnicodeScalars(value)) {
    throw new Error("Project publication name must contain only Unicode scalar values")
  }
  const requested = value?.trim() || "Untitled"
  if (requested.includes("/") || requested.includes("\\") || requested.includes("\0")) {
    throw new Error("Project publication name must be one portable name")
  }
  const extension = path.posix.extname(requested)
  const withoutExtension = extension ? requested.slice(0, -extension.length) : requested
  const stem = withoutExtension
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/[:*?"<>|\u0000-\u001f\u007f]+/gu, "-")
    .replace(/[. -]+$/gu, "")
  const boundedStem = truncatePortableStem(stem)
  const firstStem = boundedStem.split(".", 1)[0] ?? ""
  if (!boundedStem || boundedStem === "." || boundedStem === ".." || portableStemReservedName.test(firstStem)) {
    throw new Error("Project publication name does not produce a portable stem")
  }
  return boundedStem
}

function truncatePortableStem(value: string) {
  let byteLength = 0
  let utf16Units = 0
  let result = ""
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8")
    if (
      byteLength + characterBytes > maximumPublicationStemBytes ||
      utf16Units + character.length > maximumPublicationStemUtf16Units
    ) {
      break
    }
    result += character
    byteLength += characterBytes
    utf16Units += character.length
  }
  return result
}

function hasOnlyUnicodeScalars(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false
  }
  return true
}

function requirePublicationId(value: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new Error("Project publication id is invalid")
  }
  return value.toLowerCase()
}

async function ensureRealDirectory(targetPath: string, mode: number, label: string) {
  try {
    await fs.mkdir(targetPath, { mode })
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error
  }
  const stat = await fs.lstat(targetPath)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} is not a real directory`)
  if (!sameNativePath(await fs.realpath(targetPath), targetPath)) {
    throw new Error(`${label} resolves through a symbolic link`)
  }
}

async function captureDirectory(targetPath: string, label: string): Promise<DirectoryIdentity> {
  const snapshot = await fs.lstat(targetPath, { bigint: true })
  if (snapshot.isSymbolicLink() || !snapshot.isDirectory()) throw new Error(`${label} is not a real directory`)
  const realPath = await fs.realpath(targetPath)
  if (!sameNativePath(realPath, targetPath)) throw new Error(`${label} resolves through a symbolic link`)
  return { path: targetPath, realPath, snapshot }
}

async function assertPublicationDirectories(layout: PublicationLayout) {
  await assertDirectoryIdentity(layout.projectRoot, "Project root")
  await assertDirectoryIdentity(layout.privateStorage, "Project private storage")
  await assertDirectoryIdentity(layout.staging, "Project publication staging directory")
  await assertDirectoryIdentity(layout.notes, "Project Notes directory")
}

async function assertDirectoryIdentity(identity: DirectoryIdentity, label: string) {
  const current = await fs.lstat(identity.path, { bigint: true })
  if (current.isSymbolicLink() || !current.isDirectory()) throw new Error(`${label} changed or became a symbolic link`)
  if (
    !sameFileIdentity(identity.snapshot, current) ||
    identity.snapshot.mode !== current.mode ||
    !sameNativePath(await fs.realpath(identity.path), identity.realPath)
  ) {
    throw new Error(`${label} changed after validation`)
  }
}

async function captureOwnedFile(targetPath: string, expected: BigIntStats, label: string): Promise<OwnedFile> {
  const snapshot = await fs.lstat(targetPath, { bigint: true })
  assertRegularFile(snapshot, label)
  if (!sameFileIdentity(expected, snapshot)) throw new Error(`${label} changed before ownership was confirmed`)
  return { path: targetPath, realPath: await canonicalEntryPath(targetPath), snapshot }
}

async function verifyPublishedFile(file: OwnedFile, expectedDigest: string, expectedSize: number) {
  const handle = await fs.open(file.path, secureReadFlags())
  try {
    const opened = await handle.stat({ bigint: true })
    assertRegularFile(opened, "Published Project file")
    if (!sameFileSnapshot(file.snapshot, opened)) throw new Error("Published Project file changed before verification")
    if (opened.size !== BigInt(expectedSize)) throw new Error("Published Project file size changed before verification")

    const hash = createHash("sha256")
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(expectedSize, 1)))
    let offset = 0
    while (offset < expectedSize) {
      const length = Math.min(chunk.byteLength, expectedSize - offset)
      const { bytesRead } = await handle.read(chunk, 0, length, offset)
      if (bytesRead === 0) throw new Error("Published Project file size changed during verification")
      hash.update(chunk.subarray(0, bytesRead))
      offset += bytesRead
    }
    const extra = Buffer.allocUnsafe(1)
    const { bytesRead: extraBytes } = await handle.read(extra, 0, 1, expectedSize)
    const after = await handle.stat({ bigint: true })
    const pathAfter = await fs.lstat(file.path, { bigint: true })
    const canonicalPathAfter = await canonicalEntryPath(file.path)
    if (
      offset !== expectedSize ||
      extraBytes !== 0 ||
      !sameFileSnapshot(opened, after) ||
      !sameFileSnapshot(opened, pathAfter) ||
      !sameNativePath(canonicalPathAfter, file.realPath)
    ) {
      throw new Error("Published Project file size or identity changed during verification")
    }
    const actualDigest = hash.digest("hex")
    if (actualDigest !== expectedDigest) throw new Error("Published Project file digest mismatch")
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function assertRegularFile(stat: BigIntStats, label: string) {
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular file`)
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev && left.ino === right.ino
}

function sameFileSnapshot(left: BigIntStats, right: BigIntStats) {
  return (
    sameFileIdentity(left, right) &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

function sameNativePath(left: string, right: string) {
  const leftPath = path.resolve(left)
  const rightPath = path.resolve(right)
  return process.platform === "win32"
    ? leftPath.toLocaleLowerCase("en-US") === rightPath.toLocaleLowerCase("en-US")
    : leftPath === rightPath
}

function secureReadFlags() {
  return process.platform === "win32" ? fsConstants.O_RDONLY : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
}

async function canonicalEntryPath(targetPath: string) {
  return path.join(await fs.realpath(path.dirname(targetPath)), path.basename(targetPath))
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
