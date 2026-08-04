import { describe, expect, mock, test } from "bun:test"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  NodeDirectoryDurabilityErrorV2,
  NodeDirectoryDurabilityUnavailableErrorV2,
  fsyncProjectDirectoryV2,
  isNodeDirectoryDurabilityUnavailableV2,
} from "./directory-durability"

describe("Project/node directory durability boundary", () => {
  test("flushes and closes a supported directory handle", async () => {
    const sync = mock(async () => undefined)
    const close = mock(async () => undefined)
    const openDirectory = mock(async (_directory: string, _flags: number) => ({ close, sync }))

    await fsyncProjectDirectoryV2("/project/.convax", { openDirectory, platform: "posix" })

    expect(openDirectory).toHaveBeenCalledWith(
      "/project/.convax",
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    expect(sync).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  test("rejects Windows fsync EPERM as unavailable instead of claiming durability", async () => {
    const denied = Object.assign(new Error("operation not permitted"), { code: "EPERM", syscall: "fsync" })
    const close = mock(async () => undefined)

    const result = fsyncProjectDirectoryV2("C:\\project\\.convax", {
      platform: "win32",
      openDirectory: async (_directory, flags) => {
        expect(flags).toBe(constants.O_RDONLY)
        return { close, sync: async () => Promise.reject(denied) }
      },
    })

    await expect(result).rejects.toMatchObject({
      cause: denied,
      code: "directory-durability-unavailable",
      directory: "C:\\project\\.convax",
    })
    await expect(result).rejects.toBeInstanceOf(NodeDirectoryDurabilityUnavailableErrorV2)
    await result.catch((error) => expect(isNodeDirectoryDurabilityUnavailableV2(error)).toBe(true))
    expect(close).toHaveBeenCalledTimes(1)
  })

  test("propagates open, non-capability sync and close failures with their exact causes", async () => {
    const openFailure = Object.assign(new Error("permission denied"), { code: "EPERM", syscall: "open" })
    await expect(fsyncProjectDirectoryV2("C:\\state", {
      platform: "win32",
      openDirectory: async () => Promise.reject(openFailure),
    })).rejects.toMatchObject({ cause: openFailure, code: "directory-durability-failed", phase: "open" })

    const ioFailure = Object.assign(new Error("storage failure"), { code: "EIO", syscall: "fsync" })
    await expect(fsyncProjectDirectoryV2("C:\\state", {
      platform: "win32",
      openDirectory: async () => ({ close: async () => undefined, sync: async () => Promise.reject(ioFailure) }),
    })).rejects.toMatchObject({ cause: ioFailure, code: "directory-durability-failed", phase: "sync" })

    const closeFailure = Object.assign(new Error("close failure"), { code: "EIO", syscall: "close" })
    await expect(fsyncProjectDirectoryV2("/state", {
      platform: "posix",
      openDirectory: async () => ({ close: async () => Promise.reject(closeFailure), sync: async () => undefined }),
    })).rejects.toMatchObject({ cause: closeFailure, code: "directory-durability-failed", phase: "close" })
  })

  test("does not call the Windows capability gap on another platform", async () => {
    const denied = Object.assign(new Error("operation not permitted"), { code: "EPERM", syscall: "fsync" })
    const result = fsyncProjectDirectoryV2("/state", {
      platform: "posix",
      openDirectory: async () => ({ close: async () => undefined, sync: async () => Promise.reject(denied) }),
    })
    await expect(result).rejects.toBeInstanceOf(NodeDirectoryDurabilityErrorV2)
    await expect(result).rejects.not.toBeInstanceOf(NodeDirectoryDurabilityUnavailableErrorV2)
    await expect(result).rejects.toMatchObject({ cause: denied, code: "directory-durability-failed" })
  })

  test.skipIf(process.platform !== "win32")(
    "rejects the real Windows directory barrier before durable publication can be claimed",
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-directory-durability-"))
      let claimedDurable = false
      try {
        await expect((async () => {
          await fsyncProjectDirectoryV2(root)
          claimedDurable = true
        })()).rejects.toBeInstanceOf(NodeDirectoryDurabilityUnavailableErrorV2)
        expect(claimedDurable).toBe(false)
      } finally {
        await fs.rm(root, { recursive: true, force: true })
      }
    },
  )
})
