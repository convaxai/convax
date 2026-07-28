import { constants } from "node:fs"
import fs from "node:fs/promises"

function changed(label: string, cause?: unknown) {
  return new Error(`${label} changed while it was being read`, cause === undefined ? undefined : { cause })
}

function sameSnapshot(
  left: Awaited<ReturnType<typeof fs.lstat>>,
  right: Awaited<ReturnType<typeof fs.lstat>>,
) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.nlink === right.nlink
  )
}

/**
 * Reads a small authoritative file without following links or allocating before
 * its fixed byte bound and stable native identity have been established.
 */
export async function readBoundedAuthorityFile(file: string, maximumBytes: number, label: string) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error("Authority byte limit is invalid")
  const beforePath = await fs.lstat(file)
  if (
    !beforePath.isFile() ||
    beforePath.isSymbolicLink() ||
    beforePath.nlink !== 1 ||
    beforePath.size < 1 ||
    beforePath.size > maximumBytes
  ) {
    throw new Error(`${label} is not one bounded single-link regular file`)
  }
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const beforeHandle = await handle.stat()
    if (!beforeHandle.isFile() || beforeHandle.nlink !== 1 || !sameSnapshot(beforePath, beforeHandle)) {
      throw changed(label)
    }
    const bytes = await handle.readFile()
    const [afterHandle, afterPath] = await Promise.all([handle.stat(), fs.lstat(file)])
    if (
      bytes.byteLength !== beforeHandle.size ||
      !afterPath.isFile() ||
      afterPath.isSymbolicLink() ||
      afterPath.nlink !== 1 ||
      !sameSnapshot(beforeHandle, afterHandle) ||
      !sameSnapshot(afterHandle, afterPath)
    ) {
      throw changed(label)
    }
    return bytes
  } catch (error) {
    if (error instanceof Error && error.message === `${label} changed while it was being read`) throw error
    throw changed(label, error)
  } finally {
    await handle.close()
  }
}
