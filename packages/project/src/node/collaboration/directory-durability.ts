import { constants } from "node:fs"
import fs from "node:fs/promises"

export interface NodeDirectorySyncHandleV2 {
  close(): Promise<void>
  sync(): Promise<void>
}

export type NodeDirectoryDurabilityPlatformV2 = "posix" | "win32"
export type OpenNodeDirectoryV2 = (
  directory: string,
  flags: number,
) => Promise<NodeDirectorySyncHandleV2>

export const NODE_DIRECTORY_DURABILITY_UNAVAILABLE_V2 = "directory-durability-unavailable" as const
export const NODE_DIRECTORY_DURABILITY_FAILED_V2 = "directory-durability-failed" as const
type NodeDirectoryDurabilityErrorCodeV2 =
  | typeof NODE_DIRECTORY_DURABILITY_FAILED_V2
  | typeof NODE_DIRECTORY_DURABILITY_UNAVAILABLE_V2
type NodeDirectoryDurabilityPhaseV2 = "close" | "open" | "sync"

export class NodeDirectoryDurabilityErrorV2 extends Error {
  constructor(
    readonly code: NodeDirectoryDurabilityErrorCodeV2,
    readonly directory: string,
    readonly phase: NodeDirectoryDurabilityPhaseV2,
    message: string,
    options: ErrorOptions,
  ) {
    super(message, options)
    this.name = "NodeDirectoryDurabilityErrorV2"
  }
}

/**
 * The native Project store must not turn an unsupported directory flush into a
 * successful durable publication. Windows needs a native write-through adapter;
 * ordinary Node/Bun directory FileHandle.sync currently reports EPERM.
 */
export class NodeDirectoryDurabilityUnavailableErrorV2 extends NodeDirectoryDurabilityErrorV2 {
  constructor(
    directory: string,
    options: ErrorOptions,
  ) {
    super(
      NODE_DIRECTORY_DURABILITY_UNAVAILABLE_V2,
      directory,
      "sync",
      "This platform cannot prove durable Project directory publication",
      options,
    )
    this.name = "NodeDirectoryDurabilityUnavailableErrorV2"
  }
}

export interface NodeDirectoryDurabilityRuntimeV2 {
  readonly openDirectory?: OpenNodeDirectoryV2
  readonly platform?: NodeDirectoryDurabilityPlatformV2
}

export function isNodeDirectoryDurabilityUnavailableV2(
  error: unknown,
): error is NodeDirectoryDurabilityUnavailableErrorV2 | AggregateError {
  return error instanceof NodeDirectoryDurabilityUnavailableErrorV2 ||
    (error instanceof AggregateError && error.errors.some(isNodeDirectoryDurabilityUnavailableV2))
}

export function isNodeDirectoryDurabilityErrorV2(
  error: unknown,
): error is NodeDirectoryDurabilityErrorV2 | AggregateError {
  return error instanceof NodeDirectoryDurabilityErrorV2 ||
    (error instanceof AggregateError && error.errors.some(isNodeDirectoryDurabilityErrorV2))
}

/**
 * Flushes a Project directory entry or rejects. The only normalized platform
 * error is Windows' documented fsync EPERM capability gap, and normalization
 * remains a rejection rather than a false durability acknowledgement.
 */
export async function fsyncProjectDirectoryV2(
  directory: string,
  runtime: NodeDirectoryDurabilityRuntimeV2 = {},
): Promise<void> {
  const platform = runtime.platform ?? (process.platform === "win32" ? "win32" : "posix")
  const openDirectory = runtime.openDirectory ?? fs.open
  const flags = platform === "win32"
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  let handle: NodeDirectorySyncHandleV2
  try {
    handle = await openDirectory(directory, flags)
  } catch (error) {
    throw new NodeDirectoryDurabilityErrorV2(
      NODE_DIRECTORY_DURABILITY_FAILED_V2,
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
      ? new NodeDirectoryDurabilityUnavailableErrorV2(directory, { cause: error })
      : new NodeDirectoryDurabilityErrorV2(
          NODE_DIRECTORY_DURABILITY_FAILED_V2,
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
    closeFailure = new NodeDirectoryDurabilityErrorV2(
      NODE_DIRECTORY_DURABILITY_FAILED_V2,
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
  platform: NodeDirectoryDurabilityPlatformV2,
): boolean {
  return platform === "win32" && isNodeError(error) && error.code === "EPERM" && error.syscall === "fsync"
}

function isNodeError(error: unknown): error is Error & { code: unknown; syscall?: unknown } {
  return error instanceof Error && "code" in error
}
