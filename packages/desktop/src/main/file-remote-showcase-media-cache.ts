import { createHash, randomUUID } from "node:crypto"
import type { Stats } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import type { RemoteShowcaseMediaCache } from "./remote-capability-registry"

const defaultMaxTotalBytes = 256 * 1024 * 1024
const digestPattern = /^[a-f0-9]{64}$/
const temporaryPattern = /^\.[a-f0-9]{64}\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/

interface CacheDirectoryIdentity {
  dev: number
  ino: number
  realPath: string
}

export interface FileRemoteShowcaseMediaCacheOptions {
  maxTotalBytes?: number
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

function requireDigest(value: unknown) {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw new Error("Remote showcase cache SHA-256 must be 64 lowercase hex characters")
  }
  return value
}

function requireSize(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error("Remote showcase cache size must be a positive safe integer")
  }
  return value as number
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function sameFile(left: Pick<Stats, "dev" | "ino">, right: Pick<Stats, "dev" | "ino">) {
  return left.dev === right.dev && left.ino === right.ino
}

/**
 * Main-owned, content-addressed cache for immutable Registry showcase media.
 * Cache entries are non-authoritative: every hit is checked against the size and
 * SHA-256 supplied by the already-validated Showcase sidecar.
 */
export class FileRemoteShowcaseMediaCache implements RemoteShowcaseMediaCache {
  readonly #maxTotalBytes: number
  readonly #rootDirectory: string
  #rootIdentity?: CacheDirectoryIdentity
  #temporaryReconciliation?: Promise<void>

  constructor(rootDirectory: string, options: FileRemoteShowcaseMediaCacheOptions = {}) {
    if (!rootDirectory || rootDirectory.includes("\0") || !path.isAbsolute(rootDirectory)) {
      throw new Error("Remote showcase cache directory must be absolute")
    }
    const maxTotalBytes = options.maxTotalBytes ?? defaultMaxTotalBytes
    if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1) {
      throw new Error("Remote showcase cache byte limit must be a positive safe integer")
    }
    this.#rootDirectory = path.resolve(rootDirectory)
    this.#maxTotalBytes = maxTotalBytes
  }

  async read(input: { sha256: string; size: number }): Promise<Uint8Array | null> {
    const sha256 = requireDigest(input.sha256)
    const size = requireSize(input.size)
    const root = await this.#ensureRoot()
    const target = path.join(this.#rootDirectory, sha256)
    let targetMetadata: Stats
    try {
      targetMetadata = await fs.lstat(target)
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null
      throw error
    }
    if (targetMetadata.isSymbolicLink() || !targetMetadata.isFile()) {
      throw new Error("Remote showcase cache entry must be a real regular file")
    }

    let handle: fs.FileHandle
    try {
      handle = await fs.open(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null
      throw error
    }

    let invalidIdentity: Pick<Stats, "dev" | "ino"> | undefined
    try {
      const openedMetadata = await handle.stat()
      if (
        !sameFile(targetMetadata, openedMetadata) ||
        !openedMetadata.isFile() ||
        openedMetadata.size !== size ||
        size > this.#maxTotalBytes
      ) {
        invalidIdentity = openedMetadata
      } else {
        const bytes = await handle.readFile()
        if (bytes.byteLength === size && digest(bytes) === sha256) {
          await handle.utimes(new Date(), new Date()).catch(() => undefined)
          await this.#assertRoot(root)
          return Uint8Array.from(bytes)
        }
        invalidIdentity = openedMetadata
      }
    } finally {
      await handle.close()
    }

    if (invalidIdentity) await this.#removeRegularFile(target, invalidIdentity)
    await this.#assertRoot(root)
    return null
  }

  async write(input: { bytes: Uint8Array; sha256: string }): Promise<void> {
    const sha256 = requireDigest(input.sha256)
    if (!(input.bytes instanceof Uint8Array)) {
      throw new Error("Remote showcase cache bytes must be a Uint8Array")
    }
    const bytes = Uint8Array.from(input.bytes)
    if (bytes.byteLength < 1 || digest(bytes) !== sha256) {
      throw new Error("Remote showcase cache bytes do not match their SHA-256")
    }
    if (bytes.byteLength > this.#maxTotalBytes) return

    const existing = await this.read({ sha256, size: bytes.byteLength })
    if (existing) return
    const root = await this.#ensureRoot()
    const target = path.join(this.#rootDirectory, sha256)
    const temporary = path.join(this.#rootDirectory, `.${sha256}.${randomUUID()}.tmp`)
    let temporaryPublished = false
    try {
      const handle = await fs.open(
        temporary,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
        0o600,
      )
      try {
        await handle.writeFile(bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await this.#assertRoot(root)
      await this.#assertReplaceableTarget(target)
      await fs.rename(temporary, target)
      temporaryPublished = true
      const published = await fs.lstat(target)
      if (published.isSymbolicLink() || !published.isFile()) {
        throw new Error("Remote showcase cache publication did not create a regular file")
      }
      await this.#assertRoot(root)
      await this.#prune(root)
    } finally {
      if (!temporaryPublished) await this.#removeTemporary(temporary)
    }
  }

  async #ensureRoot() {
    await fs.mkdir(this.#rootDirectory, { mode: 0o700, recursive: true })
    const metadata = await fs.lstat(this.#rootDirectory)
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("Remote showcase cache directory must be a real directory")
    }
    const identity = {
      dev: metadata.dev,
      ino: metadata.ino,
      realPath: await fs.realpath(this.#rootDirectory),
    }
    if (
      this.#rootIdentity &&
      (this.#rootIdentity.dev !== identity.dev ||
        this.#rootIdentity.ino !== identity.ino ||
        this.#rootIdentity.realPath !== identity.realPath)
    ) {
      throw new Error("Remote showcase cache directory changed while in use")
    }
    this.#rootIdentity ??= identity
    this.#temporaryReconciliation ??= this.#removeAbandonedTemporaryFiles(identity).catch((error) => {
      this.#temporaryReconciliation = undefined
      throw error
    })
    await this.#temporaryReconciliation
    return identity
  }

  async #removeAbandonedTemporaryFiles(root: CacheDirectoryIdentity) {
    for (const entry of await fs.readdir(this.#rootDirectory, { withFileTypes: true })) {
      if (!temporaryPattern.test(entry.name)) continue
      const entryPath = path.join(this.#rootDirectory, entry.name)
      const metadata = await fs.lstat(entryPath)
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error("Remote showcase cache temporary entry is not a regular file")
      }
      await this.#removeRegularFile(entryPath, metadata)
    }
    await this.#assertRoot(root)
  }

  async #assertRoot(expected: CacheDirectoryIdentity) {
    const metadata = await fs.lstat(this.#rootDirectory)
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      metadata.dev !== expected.dev ||
      metadata.ino !== expected.ino ||
      (await fs.realpath(this.#rootDirectory)) !== expected.realPath
    ) {
      throw new Error("Remote showcase cache directory changed during an operation")
    }
  }

  async #assertReplaceableTarget(target: string) {
    let metadata: Stats
    try {
      metadata = await fs.lstat(target)
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return
      throw error
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error("Remote showcase cache target must be a real regular file")
    }
    await this.#removeRegularFile(target, metadata)
  }

  async #removeRegularFile(target: string, expected: Pick<Stats, "dev" | "ino">) {
    let current: Stats
    try {
      current = await fs.lstat(target)
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return false
      throw error
    }
    if (current.isSymbolicLink() || !current.isFile() || !sameFile(current, expected)) return false
    await fs.unlink(target)
    return true
  }

  async #removeTemporary(target: string) {
    let metadata: Stats
    try {
      metadata = await fs.lstat(target)
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return
      throw error
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error("Remote showcase cache temporary entry is not a regular file")
    }
    await fs.unlink(target)
  }

  async #prune(root: CacheDirectoryIdentity) {
    const entries: Array<{ metadata: Stats; name: string; path: string }> = []
    for (const entry of await fs.readdir(this.#rootDirectory, { withFileTypes: true })) {
      if (!digestPattern.test(entry.name)) continue
      const entryPath = path.join(this.#rootDirectory, entry.name)
      const metadata = await fs.lstat(entryPath)
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error("Remote showcase cache contains a non-regular content entry")
      }
      entries.push({ metadata, name: entry.name, path: entryPath })
    }
    let total = entries.reduce((sum, entry) => sum + entry.metadata.size, 0)
    entries.sort((left, right) => left.metadata.mtimeMs - right.metadata.mtimeMs || left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (total <= this.#maxTotalBytes) break
      if (await this.#removeRegularFile(entry.path, entry.metadata)) total -= entry.metadata.size
    }
    await this.#assertRoot(root)
    if (total > this.#maxTotalBytes) {
      throw new Error("Remote showcase cache could not enforce its byte limit")
    }
  }
}
