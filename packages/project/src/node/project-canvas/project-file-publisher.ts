import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants, type BigIntStats } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import type { ProjectCanvasFilePublisher } from "./project-canvas-resource-preparation"
import type { ProjectRootResolver } from "./project-managed-asset-store"

export interface ProjectFilePublisherOptions {
  maximumGeneratedBytes?: number
  maximumBytes?: number
  randomId?: () => string
}

export const defaultProjectTextPublicationMaximumBytes = 16 * 1024 * 1024
export const defaultProjectGeneratedPublicationMaximumBytes = 2 * 1024 * 1024 * 1024
const maximumPublicationAttempts = 32
const maximumPortableComponentLength = 255
const maximumPublicationIdLength = 64
const publicationCopyChunkBytes = 64 * 1024
const portableStemReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i

export class ProjectFilePublisher implements ProjectCanvasFilePublisher {
  readonly #maximumGeneratedBytes: number
  readonly #maximumBytes: number
  readonly #randomId: () => string

  constructor(
    private readonly roots: ProjectRootResolver,
    options: ProjectFilePublisherOptions = {},
  ) {
    const maximumBytes = requirePublicationMaximum(
      options.maximumBytes,
      defaultProjectTextPublicationMaximumBytes,
      "maximumBytes",
    )
    const maximumGeneratedBytes = requirePublicationMaximum(
      options.maximumGeneratedBytes,
      defaultProjectGeneratedPublicationMaximumBytes,
      "maximumGeneratedBytes",
    )
    this.#maximumGeneratedBytes = maximumGeneratedBytes
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

    const contentByteLength = Buffer.byteLength(input.content, "utf8")
    if (contentByteLength > this.#maximumBytes) {
      throw new Error("Project text publication exceeds the maximum size")
    }
    const content = Buffer.from(input.content, "utf8")
    const contentRevision = createHash("sha256").update(content).digest("hex")
    const published = await this.#publish({
      directory: input.directory,
      extension: input.extension,
      maximumBytes: this.#maximumBytes,
      name: input.name,
      projectId: input.projectId,
      source: { bytes: content, kind: "bytes" },
    })
    return { contentRevision, path: published.path }
  }

  async publishGenerated(input: {
    bytes?: Uint8Array
    extension: string
    name?: string
    projectId: string
    sourcePath?: string
  }): Promise<{ path: string }> {
    const hasBytes = input.bytes !== undefined
    const hasSourcePath = input.sourcePath !== undefined
    if (hasBytes === hasSourcePath) {
      throw new Error("Generated Project publication requires exactly one byte or file source")
    }
    return this.#publish({
      directory: "Generated",
      extension: input.extension,
      maximumBytes: this.#maximumGeneratedBytes,
      name: input.name ?? "generated",
      projectId: input.projectId,
      source: hasBytes
        ? { bytes: requirePublicationBytes(input.bytes), kind: "bytes" }
        : { kind: "file", sourcePath: requireSourcePath(input.sourcePath) },
    })
  }

  async #publish(input: {
    directory: "Generated" | "Notes"
    extension: string
    maximumBytes: number
    name?: string
    projectId: string
    source: PublicationSource
  }): Promise<{ path: string }> {
    if (typeof input.projectId !== "string" || !input.projectId) throw new Error("Project id is required")
    const extension = requirePortableExtension(input.extension)
    const stem = requirePortableStem(input.name, extension)
    const layout = await this.#resolveLayout(input.projectId, input.directory)
    const firstId = requirePublicationId(this.#randomId())
    const stagingPath = path.join(layout.staging.path, firstId)
    await assertPublicationDirectories(layout)
    const staged = await writePublicationStaging({
      layout,
      maximumBytes: input.maximumBytes,
      source: input.source,
      stagingPath,
    })
    const staging = staged.file
    await assertPublicationDirectories(layout)

    for (let attempt = 0; attempt < maximumPublicationAttempts; attempt += 1) {
      const shortId = attempt === 0 ? firstId : requirePublicationId(this.#randomId())
      const fileName = `${stem}-${shortId}${extension}`
      const targetPath = path.join(layout.target.path, fileName)
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
      if (!sameNativePath(path.dirname(publication.realPath), layout.target.realPath)) {
        throw new Error(`Project ${input.directory} directory changed during publication`)
      }
      // A user-visible publication is never rolled back. Post-link verification
      // reports failure without unlinking the published path.
      await assertPublicationDirectories(layout)
      await verifyPublishedFile(publication, staged.sha256, staged.size)
      return { path: `${input.directory}/${fileName}` }
    }

    throw new Error("Project text publication could not find a unique name after repeated collisions")
  }

  async #resolveLayout(projectId: string, directory: "Generated" | "Notes"): Promise<PublicationLayout> {
    const projectPath = path.resolve(await this.roots.resolveProjectRoot({ projectId }))
    const projectRoot = await captureDirectory(projectPath, "Project root")
    await assertDirectoryIdentity(projectRoot, "Project root")
    const privatePath = path.join(projectRoot.path, ".convax")
    const privateStorage = await captureDirectory(privatePath, "Project private storage")
    await assertDirectoryIdentity(projectRoot, "Project root")
    await assertDirectoryIdentity(privateStorage, "Project private storage")

    const stagingRoot = path.join(privateStorage.path, "staging")
    const targetRoot = path.join(projectRoot.path, directory)
    await assertDirectoryIdentity(projectRoot, "Project root")
    await assertDirectoryIdentity(privateStorage, "Project private storage")
    await ensureRealDirectory(stagingRoot, 0o700, "Project publication staging directory")
    await assertDirectoryIdentity(projectRoot, "Project root")
    await assertDirectoryIdentity(privateStorage, "Project private storage")
    const staging = await captureDirectory(stagingRoot, "Project publication staging directory")

    await assertDirectoryIdentity(projectRoot, "Project root")
    await assertDirectoryIdentity(privateStorage, "Project private storage")
    await assertDirectoryIdentity(staging, "Project publication staging directory")
    await ensureRealDirectory(targetRoot, 0o755, `Project ${directory} directory`)
    await assertDirectoryIdentity(projectRoot, "Project root")
    await assertDirectoryIdentity(privateStorage, "Project private storage")
    await assertDirectoryIdentity(staging, "Project publication staging directory")
    const layout = {
      privateStorage,
      projectRoot,
      staging,
      target: await captureDirectory(targetRoot, `Project ${directory} directory`),
    }
    await assertPublicationDirectories(layout)
    return layout
  }
}

interface PublicationLayout {
  privateStorage: DirectoryIdentity
  projectRoot: DirectoryIdentity
  staging: DirectoryIdentity
  target: DirectoryIdentity
}

type PublicationSource = { bytes: Uint8Array; kind: "bytes" } | { kind: "file"; sourcePath: string }

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

function requirePublicationMaximum(value: number | undefined, hardMaximum: number, name: string) {
  const maximum = value ?? hardMaximum
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > hardMaximum) {
    throw new Error(`Project publication ${name} must be a positive safe integer no greater than ${hardMaximum}`)
  }
  return maximum
}

async function writePublicationStaging(input: {
  layout: PublicationLayout
  maximumBytes: number
  source: PublicationSource
  stagingPath: string
}): Promise<{ file: OwnedFile; sha256: string; size: number }> {
  let sourceHandle: Awaited<ReturnType<typeof fs.open>> | undefined
  let sourcePath: string | undefined
  let sourceRealPath: string | undefined
  let sourceSnapshot: BigIntStats | undefined
  if (input.source.kind === "bytes") {
    if (input.source.bytes.byteLength > input.maximumBytes) {
      throw new Error("Project publication exceeds the maximum size")
    }
  } else {
    sourcePath = input.source.sourcePath
    sourceSnapshot = await fs.lstat(sourcePath, { bigint: true })
    assertRegularFile(sourceSnapshot, "Generated Project publication source")
    if (sourceSnapshot.size > BigInt(input.maximumBytes)) {
      throw new Error("Generated Project publication source exceeds the maximum size")
    }
    sourceRealPath = await fs.realpath(sourcePath)
  }

  try {
    if (sourcePath && sourceRealPath && sourceSnapshot) {
      sourceHandle = await fs.open(sourcePath, secureReadFlags())
      const openedSource = await sourceHandle.stat({ bigint: true })
      assertRegularFile(openedSource, "Generated Project publication source")
      if (
        !sameFileSnapshot(sourceSnapshot, openedSource) ||
        !sameNativePath(await fs.realpath(sourcePath), sourceRealPath)
      ) {
        throw new Error("Generated Project publication source changed before copy")
      }
    }

    const stagingHandle = await fs.open(input.stagingPath, "wx", 0o600)
    let staging: OwnedFile
    const hash = createHash("sha256")
    let totalBytes = 0
    try {
      const opened = await stagingHandle.stat({ bigint: true })
      assertRegularFile(opened, "Project publication staging file")
      staging = await captureOwnedFile(input.stagingPath, opened, "Project publication staging file")
      if (!sameNativePath(path.dirname(staging.realPath), input.layout.staging.realPath)) {
        throw new Error("Project publication staging directory changed")
      }
      await assertPublicationDirectories(input.layout)

      if (input.source.kind === "bytes") {
        hash.update(input.source.bytes)
        totalBytes = input.source.bytes.byteLength
        await writeAll(stagingHandle, input.source.bytes)
      } else {
        const buffer = Buffer.allocUnsafe(publicationCopyChunkBytes)
        while (true) {
          const { bytesRead } = await sourceHandle!.read(buffer, 0, buffer.byteLength, null)
          if (bytesRead === 0) break
          totalBytes += bytesRead
          if (totalBytes > input.maximumBytes) {
            throw new Error("Generated Project publication source exceeds the maximum size")
          }
          const chunk = buffer.subarray(0, bytesRead)
          hash.update(chunk)
          await writeAll(stagingHandle, chunk)
        }
      }

      await stagingHandle.sync()
      const written = await stagingHandle.stat({ bigint: true })
      assertRegularFile(written, "Project publication staging file")
      if (!sameFileIdentity(staging.snapshot, written) || written.size !== BigInt(totalBytes)) {
        throw new Error("Project publication staging file changed during write")
      }
      staging = { ...staging, snapshot: written }
    } finally {
      await stagingHandle.close().catch(() => undefined)
    }

    if (sourceHandle && sourcePath && sourceRealPath && sourceSnapshot) {
      const afterHandle = await sourceHandle.stat({ bigint: true })
      const afterPath = await fs.lstat(sourcePath, { bigint: true })
      assertRegularFile(afterPath, "Generated Project publication source")
      if (
        !sameFileSnapshot(sourceSnapshot, afterHandle) ||
        !sameFileSnapshot(sourceSnapshot, afterPath) ||
        !sameNativePath(await fs.realpath(sourcePath), sourceRealPath)
      ) {
        throw new Error("Generated Project publication source changed during copy")
      }
    }

    const sha256 = hash.digest("hex")
    await assertPublicationDirectories(input.layout)
    await verifyPublishedFile(staging!, sha256, totalBytes)
    return { file: staging!, sha256, size: totalBytes }
  } finally {
    await sourceHandle?.close().catch(() => undefined)
  }
}

async function writeAll(handle: Awaited<ReturnType<typeof fs.open>>, data: Uint8Array) {
  let offset = 0
  while (offset < data.byteLength) {
    const { bytesWritten } = await handle.write(data, offset, data.byteLength - offset)
    if (bytesWritten <= 0) throw new Error("Project publication staging write made no progress")
    offset += bytesWritten
  }
}

function requirePortableStem(value: string | undefined, extension: string) {
  if (value !== undefined && typeof value !== "string") throw new Error("Project publication name must be a string")
  if (value !== undefined && !hasOnlyUnicodeScalars(value)) {
    throw new Error("Project publication name must contain only Unicode scalar values")
  }
  const requested = value?.trim() || "Untitled"
  if (requested.includes("/") || requested.includes("\\") || requested.includes("\0")) {
    throw new Error("Project publication name must be one portable name")
  }
  const requestedExtension = path.posix.extname(requested)
  const withoutExtension = requestedExtension ? requested.slice(0, -requestedExtension.length) : requested
  const stem = withoutExtension
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/[:*?"<>|\u0000-\u001f\u007f]+/gu, "-")
    .replace(/[. -]+$/gu, "")
  const boundedStem = truncatePortableStem(stem, extension)
  const firstStem = boundedStem.split(".", 1)[0] ?? ""
  if (!boundedStem || boundedStem === "." || boundedStem === ".." || portableStemReservedName.test(firstStem)) {
    throw new Error("Project publication name does not produce a portable stem")
  }
  return boundedStem
}

function truncatePortableStem(value: string, extension: string) {
  const publicationFileSuffix = `-${"i".repeat(maximumPublicationIdLength)}${extension}`
  const maximumPublicationStemBytes = maximumPortableComponentLength - Buffer.byteLength(publicationFileSuffix, "utf8")
  const maximumPublicationStemUtf16Units = maximumPortableComponentLength - publicationFileSuffix.length
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

function requirePortableExtension(value: string) {
  if (typeof value !== "string" || !/^\.[a-z0-9]{1,16}$/.test(value)) {
    throw new Error("Project publication extension must be a canonical portable extension")
  }
  return value
}

function requirePublicationBytes(value: Uint8Array | undefined) {
  if (!(value instanceof Uint8Array)) throw new Error("Generated Project publication bytes are invalid")
  return value
}

function requireSourcePath(value: string | undefined) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new Error("Generated Project publication source path is invalid")
  }
  return path.resolve(value)
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
  await assertDirectoryIdentity(layout.target, "Project publication target directory")
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
