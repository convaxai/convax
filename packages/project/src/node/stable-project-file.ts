import { createHash } from "node:crypto"
import { constants as fsConstants, type BigIntStats } from "node:fs"
import fs from "node:fs/promises"
import { sameNativePath } from "./project-manager-helpers"

export interface StableProjectFileRead {
  bytes: Buffer
  snapshot: BigIntStats
}

export interface StableProjectUtf8Read extends StableProjectFileRead {
  content: string
  contentRevision: string
}

export async function readStableProjectFile(
  absolutePath: string,
  portablePath: string,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<StableProjectFileRead> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("Project file byte limit must be a positive integer")
  }
  signal?.throwIfAborted()
  const pathBeforeOpen = await fs.lstat(absolutePath, { bigint: true })
  signal?.throwIfAborted()
  if (!pathBeforeOpen.isFile() || pathBeforeOpen.isSymbolicLink()) {
    throw new Error(`Project path is not a regular file: ${portablePath}`)
  }
  const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW
  const handle = await fs.open(absolutePath, fsConstants.O_RDONLY | noFollow)
  try {
    signal?.throwIfAborted()
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || !sameProjectFileIdentity(pathBeforeOpen, before)) {
      throw new Error(`Project file changed before it could be read: ${portablePath}`)
    }
    if (before.size > BigInt(maximumBytes)) {
      throw new Error(`Project file is too large to read: ${portablePath}`)
    }
    const size = Number(before.size)
    const bytes = Buffer.allocUnsafe(size)
    let offset = 0
    while (offset < size) {
      signal?.throwIfAborted()
      const length = Math.min(64 * 1024, size - offset)
      const { bytesRead } = await handle.read(bytes, offset, length, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    signal?.throwIfAborted()
    const extra = Buffer.allocUnsafe(1)
    const { bytesRead: extraBytes } = await handle.read(extra, 0, 1, size)
    const after = await handle.stat({ bigint: true })
    const pathAfterRead = await fs.lstat(absolutePath, { bigint: true })
    const resolvedAfterRead = await fs.realpath(absolutePath)
    signal?.throwIfAborted()
    if (
      offset !== size ||
      extraBytes !== 0 ||
      !sameProjectFileSnapshot(before, after) ||
      !sameProjectFileIdentity(after, pathAfterRead) ||
      !sameNativePath(resolvedAfterRead, absolutePath)
    ) {
      throw new Error(`Project file changed while it was being read: ${portablePath}`)
    }
    return { bytes, snapshot: after }
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
