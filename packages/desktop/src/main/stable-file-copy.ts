import { constants, type BigIntStats } from "node:fs"
import fs, { type FileHandle } from "node:fs/promises"

const copyBufferBytes = 1024 * 1024

export interface StableFileCopyContext {
  handle: FileHandle
  size: number
}

export interface StableFileCopyOptions {
  description: string
  expectedRealPath: string
  expectedSize?: number
  maximumBytes: number
  prepareTarget(context: StableFileCopyContext): Promise<string> | string
  signal?: AbortSignal
  sourcePath: string
}

function abortError(reason?: unknown) {
  const message =
    typeof reason === "string" || typeof reason === "number" || typeof reason === "boolean"
      ? String(reason)
      : "Operation was canceled"
  const error = reason instanceof Error ? reason : new Error(message)
  error.name = "AbortError"
  return error
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal.reason)
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev && left.ino === right.ino
}

function sameFileSnapshot(left: BigIntStats, right: BigIntStats) {
  return (
    sameFileIdentity(left, right) &&
    left.nlink === 1n &&
    right.nlink === 1n &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

function changedError(description: string, cause?: unknown) {
  return new Error(`${description} changed while it was being copied`, cause === undefined ? undefined : { cause })
}

function validateMaximumBytes(value: number) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("Stable file copy byte limit must be a positive integer")
}

async function writeExact(writer: FileHandle, buffer: Buffer, length: number, position: number) {
  let written = 0
  while (written < length) {
    const result = await writer.write(buffer, written, length - written, position + written)
    if (result.bytesWritten < 1) throw new Error("Stable file copy could not write its target")
    written += result.bytesWritten
  }
}

async function copyExactBytes(source: FileHandle, target: string, size: number, signal?: AbortSignal) {
  const writer = await fs.open(target, "wx", 0o600)
  let failure: unknown
  try {
    const buffer = Buffer.allocUnsafe(Math.min(copyBufferBytes, size))
    let offset = 0
    while (offset < size) {
      assertNotAborted(signal)
      const length = Math.min(buffer.byteLength, size - offset)
      const { bytesRead } = await source.read(buffer, 0, length, offset)
      if (bytesRead < 1) throw new Error("Stable file copy source ended before its initial size")
      await writeExact(writer, buffer, bytesRead, offset)
      offset += bytesRead
    }
  } catch (error) {
    failure = error
  } finally {
    try {
      await writer.close()
    } catch (error) {
      failure ??= error
    }
  }
  if (failure !== undefined) {
    await fs.rm(target, { force: true }).catch(() => undefined)
    throw failure
  }
}

async function assertUnchangedAfterCopy(
  source: FileHandle,
  sourcePath: string,
  expectedRealPath: string,
  before: BigIntStats,
  size: number,
  description: string,
) {
  try {
    const extra = Buffer.allocUnsafe(1)
    const { bytesRead: extraBytes } = await source.read(extra, 0, 1, size)
    const after = await source.stat({ bigint: true })
    const pathAfterCopy = await fs.lstat(sourcePath, { bigint: true })
    const resolvedAfterCopy = await fs.realpath(sourcePath)
    if (
      extraBytes !== 0 ||
      !after.isFile() ||
      after.nlink !== 1n ||
      !pathAfterCopy.isFile() ||
      pathAfterCopy.isSymbolicLink() ||
      pathAfterCopy.nlink !== 1n ||
      !sameFileSnapshot(before, after) ||
      !sameFileSnapshot(after, pathAfterCopy) ||
      resolvedAfterCopy !== expectedRealPath
    ) {
      throw changedError(description)
    }
  } catch (error) {
    if (error instanceof Error && error.message === `${description} changed while it was being copied`) throw error
    throw changedError(description, error)
  }
}

/**
 * Copies one regular file as a stable snapshot. The source is pinned by native
 * identity, copied only through its open handle, bounded by its initial size,
 * and rechecked through both the handle and pathname before the target is kept.
 */
export async function copyStableFile(options: StableFileCopyOptions) {
  validateMaximumBytes(options.maximumBytes)
  if (
    options.expectedSize !== undefined &&
    (!Number.isSafeInteger(options.expectedSize) ||
      options.expectedSize < 1 ||
      options.expectedSize > options.maximumBytes)
  ) {
    throw new Error(`${options.description} has an invalid expected size`)
  }

  const pathBeforeOpen = await fs.lstat(options.sourcePath, { bigint: true })
  if (!pathBeforeOpen.isFile() || pathBeforeOpen.isSymbolicLink() || pathBeforeOpen.nlink !== 1n) {
    throw new Error(`${options.description} must be a regular single-link file`)
  }
  if (pathBeforeOpen.size < 1n || pathBeforeOpen.size > BigInt(options.maximumBytes)) {
    throw new Error(`${options.description} is empty or exceeds the configured size limit`)
  }
  if (options.expectedSize !== undefined && pathBeforeOpen.size !== BigInt(options.expectedSize)) {
    throw changedError(options.description)
  }

  const handle = await fs.open(
    options.expectedRealPath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  )
  let target: string | undefined
  let targetCreated = false
  try {
    const before = await handle.stat({ bigint: true })
    const resolvedBeforeCopy = await fs.realpath(options.sourcePath)
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      !sameFileSnapshot(pathBeforeOpen, before) ||
      resolvedBeforeCopy !== options.expectedRealPath
    ) {
      throw changedError(options.description)
    }
    if (before.size < 1n || before.size > BigInt(options.maximumBytes)) {
      throw new Error(`${options.description} is empty or exceeds the configured size limit`)
    }
    const size = Number(before.size)
    target = await options.prepareTarget({ handle, size })
    assertNotAborted(options.signal)
    await copyExactBytes(handle, target, size, options.signal)
    targetCreated = true
    assertNotAborted(options.signal)
    await assertUnchangedAfterCopy(
      handle,
      options.sourcePath,
      options.expectedRealPath,
      before,
      size,
      options.description,
    )
    assertNotAborted(options.signal)
    return target
  } catch (error) {
    if (targetCreated && target) await fs.rm(target, { force: true }).catch(() => undefined)
    throw error
  } finally {
    await handle.close()
  }
}
