import { createHash } from "node:crypto"
import { constants as fsConstants, type BigIntStats } from "node:fs"
import fs, { type FileHandle } from "node:fs/promises"
import { sameNativePath } from "./project-manager-helpers"

export interface StableProjectFileRead {
  bytes: Buffer
  snapshot: BigIntStats
}

export interface StableProjectUtf8Read extends StableProjectFileRead {
  content: string
  contentRevision: string
}

const stableReadChunkBytes = 64 * 1024

export class StableProjectFileHandle {
  readonly size: number
  readonly snapshot: BigIntStats
  readonly #absolutePath: string
  #closed = false
  readonly #handle: FileHandle
  readonly #portablePath: string
  #transferred = false
  #verified = false

  constructor(handle: FileHandle, absolutePath: string, portablePath: string, snapshot: BigIntStats) {
    this.#absolutePath = absolutePath
    this.#handle = handle
    this.#portablePath = portablePath
    this.size = Number(snapshot.size)
    this.snapshot = snapshot
  }

  async digest(signal?: AbortSignal) {
    return (await this.#scan(false, signal)).digest
  }

  async readAll(signal?: AbortSignal) {
    return (await this.#scan(true, signal)).bytes!
  }

  createReadStream(input: { end: number; signal?: AbortSignal; start: number }) {
    if (!this.#verified) throw new Error("Project file handle must be verified before streaming")
    if (this.#closed || this.#transferred) throw new Error("Project file handle is no longer readable")
    if (
      !Number.isSafeInteger(input.start) ||
      !Number.isSafeInteger(input.end) ||
      input.start < 0 ||
      input.end < input.start ||
      input.end >= this.size
    ) {
      throw new Error("Project file byte range is invalid")
    }
    input.signal?.throwIfAborted()
    this.#transferred = true
    const iterator = this.#streamRange(input)
    const handle = this
    let removeAbortListener: () => void = () => undefined
    return new ReadableStream<Uint8Array>({
      async cancel() {
        removeAbortListener()
        await iterator.return(undefined).catch(() => undefined)
        await handle.close()
      },
      async pull(controller) {
        try {
          const next = await iterator.next()
          if (next.done) {
            removeAbortListener()
            controller.close()
          } else controller.enqueue(next.value)
        } catch (error) {
          removeAbortListener()
          controller.error(error)
        }
      },
      start(controller) {
        const signal = input.signal
        if (!signal) return
        const onAbort = () => {
          removeAbortListener()
          controller.error(signal.reason)
          void iterator.return(undefined).catch(() => undefined)
          void handle.close()
        }
        removeAbortListener = () => signal.removeEventListener("abort", onAbort)
        signal.addEventListener("abort", onAbort, { once: true })
        if (signal.aborted) onAbort()
      },
    })
  }

  async close() {
    if (this.#closed) return
    this.#closed = true
    await this.#handle.close().catch(() => undefined)
  }

  async #scan(captureBytes: boolean, signal?: AbortSignal) {
    if (this.#closed || this.#transferred) throw new Error("Project file handle is no longer readable")
    signal?.throwIfAborted()
    const bytes = captureBytes ? Buffer.allocUnsafe(this.size) : undefined
    const scratch = captureBytes ? bytes! : Buffer.allocUnsafe(Math.min(stableReadChunkBytes, this.size))
    const hash = createHash("sha256")
    let offset = 0
    while (offset < this.size) {
      signal?.throwIfAborted()
      const length = Math.min(stableReadChunkBytes, this.size - offset)
      const bufferOffset = captureBytes ? offset : 0
      const { bytesRead } = await this.#handle.read(scratch, bufferOffset, length, offset)
      if (bytesRead < 1) break
      hash.update(scratch.subarray(bufferOffset, bufferOffset + bytesRead))
      offset += bytesRead
    }
    signal?.throwIfAborted()
    await this.#assertStablePath(offset, signal)
    this.#verified = true
    return { bytes, digest: hash.digest("hex") }
  }

  async #assertStablePath(offset: number, signal?: AbortSignal) {
    const extra = Buffer.allocUnsafe(1)
    const { bytesRead: extraBytes } = await this.#handle.read(extra, 0, 1, this.size)
    const after = await this.#handle.stat({ bigint: true })
    const pathAfterRead = await fs.lstat(this.#absolutePath, { bigint: true })
    const resolvedAfterRead = await fs.realpath(this.#absolutePath)
    signal?.throwIfAborted()
    if (
      offset !== this.size ||
      extraBytes !== 0 ||
      !sameProjectFileSnapshot(this.snapshot, after) ||
      !sameProjectFileIdentity(after, pathAfterRead) ||
      pathAfterRead.isSymbolicLink() ||
      !sameNativePath(resolvedAfterRead, this.#absolutePath)
    ) {
      throw new Error(`Project file changed while it was being read: ${this.#portablePath}`)
    }
  }

  async *#streamRange(input: { end: number; signal?: AbortSignal; start: number }) {
    let offset = input.start
    try {
      while (offset <= input.end) {
        input.signal?.throwIfAborted()
        await this.#assertOpenHandleUnchanged()
        const length = Math.min(stableReadChunkBytes, input.end - offset + 1)
        const bytes = Buffer.allocUnsafe(length)
        const { bytesRead } = await this.#handle.read(bytes, 0, length, offset)
        await this.#assertOpenHandleUnchanged()
        input.signal?.throwIfAborted()
        if (bytesRead !== length) {
          throw new Error(`Project file changed while it was being streamed: ${this.#portablePath}`)
        }
        offset += bytesRead
        yield bytes
      }
    } finally {
      await this.close()
    }
  }

  async #assertOpenHandleUnchanged() {
    const current = await this.#handle.stat({ bigint: true })
    if (!current.isFile() || !sameProjectFileSnapshot(this.snapshot, current)) {
      throw new Error(`Project file changed while it was being streamed: ${this.#portablePath}`)
    }
  }
}

export async function openStableProjectFile(
  absolutePath: string,
  portablePath: string,
  maximumBytes: number,
  signal?: AbortSignal,
) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("Project file byte limit must be a positive integer")
  }
  signal?.throwIfAborted()
  const pathBeforeOpen = await fs.lstat(absolutePath, { bigint: true })
  signal?.throwIfAborted()
  if (pathBeforeOpen.isSymbolicLink()) {
    throw new Error(`Project path is a symbolic link: ${portablePath}`)
  }
  if (!pathBeforeOpen.isFile()) {
    throw new Error(`Project path is not a regular file: ${portablePath}`)
  }
  if (pathBeforeOpen.size > BigInt(maximumBytes)) {
    throw new Error(`Project file is too large to read: ${portablePath}`)
  }
  const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW
  const handle = await fs.open(absolutePath, fsConstants.O_RDONLY | noFollow)
  try {
    signal?.throwIfAborted()
    const opened = await handle.stat({ bigint: true })
    const pathAfterOpen = await fs.lstat(absolutePath, { bigint: true })
    const resolvedAfterOpen = await fs.realpath(absolutePath)
    signal?.throwIfAborted()
    if (
      !opened.isFile() ||
      opened.size > BigInt(maximumBytes) ||
      pathAfterOpen.isSymbolicLink() ||
      !sameProjectFileSnapshot(pathBeforeOpen, opened) ||
      !sameProjectFileIdentity(opened, pathAfterOpen) ||
      !sameNativePath(resolvedAfterOpen, absolutePath)
    ) {
      throw new Error(`Project file changed before it could be read: ${portablePath}`)
    }
    return new StableProjectFileHandle(handle, absolutePath, portablePath, opened)
  } catch (error) {
    await handle.close().catch(() => undefined)
    throw error
  }
}

export async function readStableProjectFile(
  absolutePath: string,
  portablePath: string,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<StableProjectFileRead> {
  const handle = await openStableProjectFile(absolutePath, portablePath, maximumBytes, signal)
  try {
    const bytes = await handle.readAll(signal)
    return { bytes, snapshot: handle.snapshot }
  } finally {
    await handle.close()
  }
}

export async function readStableProjectUtf8File(
  absolutePath: string,
  portablePath: string,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<StableProjectUtf8Read> {
  const result = await readStableProjectFile(absolutePath, portablePath, maximumBytes, signal)
  signal?.throwIfAborted()
  let content: string
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(result.bytes)
  } catch (error) {
    throw new Error(`Project text file is not valid UTF-8: ${portablePath}`, { cause: error })
  }
  return {
    ...result,
    content,
    contentRevision: createHash("sha256").update(result.bytes).digest("hex"),
  }
}

export function sameProjectFileIdentity(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev && left.ino === right.ino
}

export function sameProjectFileSnapshot(left: BigIntStats, right: BigIntStats) {
  return (
    sameProjectFileIdentity(left, right) &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}
