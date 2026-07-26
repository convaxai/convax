import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { generationOperationRequestDigest } from "./generation-operation-store"

const snapshotSchema = "convax.generation-input-snapshot/1" as const
const digestPattern = /^[a-f0-9]{64}$/
const logicalNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/
const maximumManifestBytes = 256 * 1024

interface SnapshotManifest {
  files: Array<{ name: string; path: string; sha256: string; size: number }>
  request: unknown
  requestDigest: string
  schema: typeof snapshotSchema
}

export interface GenerationInputSnapshot {
  files: Array<{ name: string; path: string; sha256: string; size: number }>
  id: string
  request: unknown
  requestDigest: string
}

async function ensureDirectory(root: string) {
  try {
    const stat = await fs.lstat(root)
    if (stat.isSymbolicLink()) throw new Error("Generation input snapshot root cannot be a symlink")
    if (!stat.isDirectory()) throw new Error("Generation input snapshot root is invalid")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
  }
  await fs.chmod(root, 0o700)
}

function stableManifest(value: SnapshotManifest) {
  return JSON.stringify(value)
}

function snapshotId(manifest: SnapshotManifest) {
  return createHash("sha256").update(stableManifest(manifest)).digest("hex")
}

function parseManifest(value: unknown): SnapshotManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Generation input snapshot manifest is invalid")
  }
  const input = value as Record<string, unknown>
  if (
    Object.keys(input).some((key) => !["files", "request", "requestDigest", "schema"].includes(key)) ||
    input.schema !== snapshotSchema ||
    !Array.isArray(input.files) ||
    input.files.length > 32 ||
    typeof input.requestDigest !== "string" ||
    !digestPattern.test(input.requestDigest) ||
    generationOperationRequestDigest(input.request) !== input.requestDigest
  ) {
    throw new Error("Generation input snapshot manifest is invalid")
  }
  const files = input.files.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Generation input snapshot manifest is invalid")
    }
    const file = value as Record<string, unknown>
    if (
      Object.keys(file).some((key) => !["name", "path", "sha256", "size"].includes(key)) ||
      typeof file.name !== "string" ||
      !logicalNamePattern.test(file.name) ||
      typeof file.path !== "string" ||
      file.path !== `${index + 1}-${file.sha256}` ||
      typeof file.sha256 !== "string" ||
      !digestPattern.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      (file.size as number) < 1
    ) {
      throw new Error("Generation input snapshot manifest is invalid")
    }
    return {
      name: file.name,
      path: file.path,
      sha256: file.sha256,
      size: file.size as number,
    }
  })
  return {
    files,
    request: structuredClone(input.request),
    requestDigest: input.requestDigest,
    schema: snapshotSchema,
  }
}

async function sha256File(file: string) {
  const bytes = await fs.readFile(file)
  return createHash("sha256").update(bytes).digest("hex")
}

async function storedSnapshotBytes(root: string) {
  let total = 0
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    if (entry.name.startsWith(".snapshot-") && entry.name.endsWith(".tmp")) {
      await fs.rm(entryPath, { force: true, recursive: true })
      continue
    }
    if (!entry.isDirectory() || !digestPattern.test(entry.name)) {
      throw new Error("Generation input snapshot store contains invalid state")
    }
    for (const file of await fs.readdir(entryPath, { withFileTypes: true })) {
      if (!file.isFile()) throw new Error("Generation input snapshot store contains invalid state")
      const stat = await fs.lstat(path.join(entryPath, file.name))
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error("Generation input snapshot store contains invalid state")
      }
      total += stat.size
      if (!Number.isSafeInteger(total)) throw new Error("Generation input snapshot store is too large")
    }
  }
  return total
}

export class GenerationInputSnapshotStore {
  readonly #maxOperationBytes: number
  readonly #maxTotalBytes: number

  constructor(
    private readonly root: string,
    options: { maxOperationBytes?: number; maxTotalBytes?: number } = {},
  ) {
    if (!path.isAbsolute(root)) throw new Error("Generation input snapshot root must be absolute")
    this.#maxOperationBytes = options.maxOperationBytes ?? 2 * 1024 * 1024 * 1024
    if (!Number.isSafeInteger(this.#maxOperationBytes) || this.#maxOperationBytes < 1) {
      throw new Error("Generation input snapshot size limit is invalid")
    }
    this.#maxTotalBytes = options.maxTotalBytes ?? 8 * 1024 * 1024 * 1024
    if (
      !Number.isSafeInteger(this.#maxTotalBytes) ||
      this.#maxTotalBytes < 1 ||
      this.#maxTotalBytes > 64 * 1024 * 1024 * 1024
    ) {
      throw new Error("Generation input snapshot total size limit is invalid")
    }
  }

  async create(input: {
    files: readonly { logicalName: string; sourcePath: string }[]
    request: unknown
  }): Promise<GenerationInputSnapshot> {
    if (!Array.isArray(input.files) || input.files.length > 32) {
      throw new Error("Generation input snapshot accepts at most 32 files")
    }
    await ensureDirectory(this.root)
    const existingBytes = await storedSnapshotBytes(this.root)
    const temporary = path.join(this.root, `.snapshot-${randomUUID()}.tmp`)
    await fs.mkdir(temporary, { mode: 0o700 })
    try {
      const files: SnapshotManifest["files"] = []
      let total = 0
      for (const [index, source] of input.files.entries()) {
        if (!logicalNamePattern.test(source.logicalName)) {
          throw new Error("Generation input snapshot logical name is invalid")
        }
        const sourceStat = await fs.lstat(source.sourcePath)
        if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
          throw new Error("Generation input snapshot source cannot be symbolic or non-file")
        }
        total += sourceStat.size
        if (sourceStat.size < 1 || total > this.#maxOperationBytes) {
          throw new Error("Generation input snapshot exceeds the operation size limit")
        }
        const handle = await fs.open(source.sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        let bytes: Buffer
        try {
          const opened = await handle.stat()
          if (!opened.isFile() || opened.size !== sourceStat.size) {
            throw new Error("Generation input snapshot source changed")
          }
          bytes = await handle.readFile()
          const after = await handle.stat()
          if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || bytes.byteLength !== opened.size) {
            throw new Error("Generation input snapshot source changed")
          }
        } finally {
          await handle.close()
        }
        const sha256 = createHash("sha256").update(bytes).digest("hex")
        const relativePath = `${index + 1}-${sha256}`
        await fs.writeFile(path.join(temporary, relativePath), bytes, { flag: "wx", mode: 0o400 })
        files.push({ name: source.logicalName, path: relativePath, sha256, size: bytes.byteLength })
      }
      let request: unknown
      try {
        request = JSON.parse(JSON.stringify(input.request)) as unknown
      } catch {
        throw new Error("Generation input snapshot request is not JSON-serializable")
      }
      const manifest: SnapshotManifest = {
        files,
        request,
        requestDigest: generationOperationRequestDigest(request),
        schema: snapshotSchema,
      }
      const manifestBytes = Buffer.byteLength(`${stableManifest(manifest)}\n`, "utf8")
      if (
        manifestBytes > maximumManifestBytes ||
        existingBytes + total + manifestBytes > this.#maxTotalBytes
      ) {
        throw new Error("Generation input snapshot exceeds the total store size limit")
      }
      const id = snapshotId(manifest)
      await fs.writeFile(path.join(temporary, "manifest.json"), `${stableManifest(manifest)}\n`, {
        flag: "wx",
        mode: 0o400,
      })
      const target = path.join(this.root, id)
      try {
        await fs.rename(temporary, target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        await fs.rm(temporary, { force: true, recursive: true })
      }
      return this.open(id)
    } catch (error) {
      await fs.rm(temporary, { force: true, recursive: true })
      throw error
    }
  }

  async open(id: string): Promise<GenerationInputSnapshot> {
    if (!digestPattern.test(id)) throw new Error("Generation input snapshot id is invalid")
    await ensureDirectory(this.root)
    const directory = path.join(this.root, id)
    const stat = await fs.lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Generation input snapshot is invalid")
    const manifestPath = path.join(directory, "manifest.json")
    const manifestStat = await fs.lstat(manifestPath)
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > maximumManifestBytes) {
      throw new Error("Generation input snapshot manifest is invalid")
    }
    let manifest: SnapshotManifest
    try {
      manifest = parseManifest(JSON.parse(await fs.readFile(manifestPath, "utf8")) as unknown)
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Generation input snapshot manifest is invalid", { cause: error })
      }
      throw error
    }
    if (snapshotId(manifest) !== id) throw new Error("Generation input snapshot manifest digest is invalid")
    const files: GenerationInputSnapshot["files"] = []
    let total = 0
    for (const file of manifest.files) {
      const absolutePath = path.join(directory, file.path)
      const fileStat = await fs.lstat(absolutePath)
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size !== file.size) {
        throw new Error("Generation input snapshot file is invalid")
      }
      total += fileStat.size
      if (total > this.#maxOperationBytes || (await sha256File(absolutePath)) !== file.sha256) {
        throw new Error("Generation input snapshot file digest is invalid")
      }
      files.push({ ...file, path: absolutePath })
    }
    return {
      files,
      id,
      request: structuredClone(manifest.request),
      requestDigest: manifest.requestDigest,
    }
  }

  async remove(id: string) {
    if (!digestPattern.test(id)) throw new Error("Generation input snapshot id is invalid")
    await ensureDirectory(this.root)
    await fs.rm(path.join(this.root, id), { force: true, recursive: true })
  }
}
