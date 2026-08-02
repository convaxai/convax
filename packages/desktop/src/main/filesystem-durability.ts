import fs, { type FileHandle } from "node:fs/promises"

type SyncHandle = Pick<FileHandle, "close" | "sync">
type OpenDirectory = (directory: string, flags: "r") => Promise<SyncHandle>

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

/**
 * Flush file bytes when the host filesystem exposes a durability barrier.
 * Electron on some valid Windows filesystems rejects FlushFileBuffers with
 * EPERM; the completed write plus close remains the strongest available edge.
 */
export async function syncFileBytes(handle: Pick<FileHandle, "sync">, platform: NodeJS.Platform = process.platform) {
  try {
    await handle.sync()
  } catch (error) {
    if (platform === "win32" && isNodeError(error) && error.code === "EPERM") return
    throw error
  }
}

/** Flush the containing directory when the platform supports directory handles. */
export async function syncDirectoryEntry(
  directory: string,
  platform: NodeJS.Platform = process.platform,
  openDirectory: OpenDirectory = fs.open,
) {
  if (platform === "win32") return
  const handle = await openDirectory(directory, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
