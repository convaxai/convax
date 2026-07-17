import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import type { RemoteRegistryCache, RemoteRegistryCacheEntry } from "./remote-capability-registry"

const maxCacheFileBytes = 3 * 1024 * 1024

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

function parseCacheEntry(value: unknown): RemoteRegistryCacheEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Remote registry cache must be an object")
  const input = value as Record<string, unknown>
  const allowed = new Set(["body", "etag", "sha256"])
  const unknown = Object.keys(input).find((key) => !allowed.has(key))
  if (unknown) throw new Error(`Remote registry cache contains an unsupported field: ${unknown}`)
  if (typeof input.body !== "string" || Buffer.byteLength(input.body) > 2 * 1024 * 1024) {
    throw new Error("Remote registry cache body is invalid")
  }
  if (typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256)) {
    throw new Error("Remote registry cache SHA-256 is invalid")
  }
  if (
    input.etag !== undefined &&
    (typeof input.etag !== "string" || !input.etag || input.etag.length > 256 || /[\u0000-\u001f\u007f]/.test(input.etag))
  ) {
    throw new Error("Remote registry cache ETag is invalid")
  }
  return {
    body: input.body,
    ...(input.etag === undefined ? {} : { etag: input.etag as string }),
    sha256: input.sha256,
  }
}

/** Atomic JSON cache adapter for a main-owned absolute path under Electron userData. */
export class FileRemoteRegistryCache implements RemoteRegistryCache {
  readonly #stateFile: string

  constructor(stateFile: string) {
    if (!stateFile || stateFile.includes("\0") || !path.isAbsolute(stateFile)) {
      throw new Error("Remote registry cache path must be absolute")
    }
    this.#stateFile = path.resolve(stateFile)
  }

  async read(): Promise<RemoteRegistryCacheEntry | null> {
    const directory = path.dirname(this.#stateFile)
    try {
      const directoryStat = await fs.lstat(directory)
      if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
        throw new Error("Remote registry cache directory must be a real directory")
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null
      throw error
    }
    let handle: fs.FileHandle
    try {
      handle = await fs.open(this.#stateFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null
      throw error
    }
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > maxCacheFileBytes) throw new Error("Remote registry cache is not a bounded regular file")
      let value: unknown
      try {
        value = JSON.parse(await handle.readFile("utf8"))
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error("Remote registry cache is not valid JSON", { cause: error })
        }
        throw error
      }
      return parseCacheEntry(value)
    } finally {
      await handle.close()
    }
  }

  async write(entry: RemoteRegistryCacheEntry): Promise<void> {
    const validated = parseCacheEntry(entry)
    const directory = path.dirname(this.#stateFile)
    await fs.mkdir(directory, { mode: 0o700, recursive: true })
    const directoryStat = await fs.lstat(directory)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new Error("Remote registry cache directory must be a real directory")
    }
    try {
      const targetStat = await fs.lstat(this.#stateFile)
      if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
        throw new Error("Remote registry cache target must be a regular file")
      }
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error
    }
    const temporary = path.join(directory, `.${path.basename(this.#stateFile)}.${randomUUID()}.tmp`)
    try {
      const document = `${JSON.stringify(validated, null, 2)}\n`
      await fs.writeFile(temporary, document, { encoding: "utf8", flag: "wx", mode: 0o600 })
      await fs.rename(temporary, this.#stateFile)
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }
}
