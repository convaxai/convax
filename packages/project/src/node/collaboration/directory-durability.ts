import { constants } from "node:fs"
import fs from "node:fs/promises"

export interface NodeDirectorySyncHandle {
  close(): Promise<void>
  sync(): Promise<void>
}

export type NodeDirectoryDurabilityPlatform = "posix" | "win32"
export type OpenNodeDirectory = (
  directory: string,
  flags: number,
) => Promise<NodeDirectorySyncHandle>

export const NODE_DIRECTORY_DURABILITY_UNAVAILABLE = "directory-durability-unavailable" as const
export const NODE_DIRECTORY_DURABILITY_FAILED = "directory-durability-failed" as const
type NodeDirectoryDurabilityErrorCode =
  | typeof NODE_DIRECTORY_DURABILITY_FAILED
  | typeof NODE_DIRECTORY_DURABILITY_UNAVAILABLE
type NodeDirectoryDurabilityPhase = "close" | "open" | "sync"

export class NodeDirectoryDurabilityError extends Error {
  constructor(
    readonly code: NodeDirectoryDurabilityErrorCode,
    readonly directory: string,
    readonly phase: NodeDirectoryDurabilityPhase,
    message: string,
    options: ErrorOptions,
  ) {
    super(message, options)
    this.name = "NodeDirectoryDurabilityError"
  }
}

/**
 * The native Project store must not turn an unsupported directory flush into a
 * successful durable publication. Windows needs a native write-through adapter;
 * ordinary Node/Bun directory FileHandle.sync currently reports EPERM.
 */
export class NodeDirectoryDurabilityUnavailableError extends NodeDirectoryDurabilityError {
  constructor(
    directory: string,
    options: ErrorOptions,
  ) {
    super(
      NODE_DIRECTORY_DURABILITY_UNAVAILABLE,
      directory,
      "sync",
      "This platform cannot prove durable Project directory publication",
      options,
    )
    this.name = "NodeDirectoryDurabilityUnavailableError"
  }
}

export interface NodeDirectoryDurabilityRuntime {
  readonly openDirectory?: OpenNodeDirectory
  readonly platform?: NodeDirectoryDurabilityPlatform
}

export function isNodeDirectoryDurabilityUnavailable(
  error: unknown,
): error is NodeDirectoryDurabilityUnavailableError | AggregateError {
  return error instanceof NodeDirectoryDurabilityUnavailableError ||
    (error instanceof AggregateError && error.errors.some(isNodeDirectoryDurabilityUnavailable))
}

export function isNodeDirectoryDurabilityError(
  error: unknown,
): error is NodeDirectoryDurabilityError | AggregateError {
  return error instanceof NodeDirectoryDurabilityError ||
    (error instanceof AggregateError && error.errors.some(isNodeDirectoryDurabilityError))
}

/**
 * Flushes a Project directory entry or rejects. The only normalized platform
 * error is Windows' documented fsync EPERM capability gap, and normalization
 * remains a rejection rather than a false durability acknowledgement.
 */
export async function fsyncProjectDirectory(
  directory: string,
  runtime: NodeDirectoryDurabilityRuntime = {},
): Promise<void> {
  const platform = runtime.platform ?? (process.platform === "win32" ? "win32" : "posix")
  const openDirectory = runtime.openDirectory ?? fs.open
  const flags = platform === "win32"
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  let handle: NodeDirectorySyncHandle
  try {
    handle = await openDirectory(directory, flags)
  } catch (error) {
    throw new NodeDirectoryDurabilityError(
      NODE_DIRECTORY_DURABILITY_FAILED,
      directory,
      "open",
      "Project directory durability handle could not be opened",
      { cause: error },
    )
  }
  let syncFailure: unknown
  try {
    await handle.sync()
  } catch (error) {
    syncFailure = isUnsupportedWindowsDirectorySync(error, platform)
      ? new NodeDirectoryDurabilityUnavailableError(directory, { cause: error })
      : new NodeDirectoryDurabilityError(
          NODE_DIRECTORY_DURABILITY_FAILED,
          directory,
          "sync",
          "Project directory durability sync failed",
          { cause: error },
        )
  }

  let closeFailure: unknown
  try {
    await handle.close()
  } catch (error) {
    closeFailure = new NodeDirectoryDurabilityError(
      NODE_DIRECTORY_DURABILITY_FAILED,
      directory,
      "close",
      "Project directory durability handle could not be closed",
      { cause: error },
    )
  }

  if (syncFailure !== undefined && closeFailure !== undefined) {
    throw new AggregateError([syncFailure, closeFailure], "Project directory sync and close both failed")
  }
  if (syncFailure !== undefined) throw syncFailure
  if (closeFailure !== undefined) throw closeFailure
}

function isUnsupportedWindowsDirectorySync(
  error: unknown,
  platform: NodeDirectoryDurabilityPlatform,
): boolean {
  return platform === "win32" && isNodeError(error) && error.code === "EPERM" && error.syscall === "fsync"
}

function isNodeError(error: unknown): error is Error & { code: unknown; syscall?: unknown } {
  return error instanceof Error && "code" in error
}
