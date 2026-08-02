import { expect, mock, test } from "bun:test"

import { syncDirectoryEntry, syncFileBytes } from "./filesystem-durability"

test("syncFileBytes preserves supported durability barriers", async () => {
  const sync = mock(async () => undefined)

  await syncFileBytes({ sync }, "linux")

  expect(sync).toHaveBeenCalledTimes(1)
})

test("syncFileBytes degrades only for Windows EPERM", async () => {
  const denied = Object.assign(new Error("unsupported durability barrier"), { code: "EPERM" })

  await expect(syncFileBytes({ sync: async () => Promise.reject(denied) }, "win32")).resolves.toBeUndefined()
  await expect(syncFileBytes({ sync: async () => Promise.reject(denied) }, "linux")).rejects.toBe(denied)

  const corrupted = Object.assign(new Error("storage failure"), { code: "EIO" })
  await expect(syncFileBytes({ sync: async () => Promise.reject(corrupted) }, "win32")).rejects.toBe(corrupted)
})

test("syncDirectoryEntry skips unsupported Windows directory handles", async () => {
  const openDirectory = mock(async () => ({
    close: async () => undefined,
    sync: async () => undefined,
  }))

  await syncDirectoryEntry("C:\\state", "win32", openDirectory)

  expect(openDirectory).not.toHaveBeenCalled()
})

test("syncDirectoryEntry closes a supported directory handle after success or failure", async () => {
  const close = mock(async () => undefined)
  const sync = mock(async () => undefined)
  const openDirectory = mock(async () => ({ close, sync }))

  await syncDirectoryEntry("/state", "linux", openDirectory)
  expect(sync).toHaveBeenCalledTimes(1)
  expect(close).toHaveBeenCalledTimes(1)

  const failure = new Error("directory sync failed")
  const failedClose = mock(async () => undefined)
  await expect(
    syncDirectoryEntry("/state", "linux", async () => ({
      close: failedClose,
      sync: async () => Promise.reject(failure),
    })),
  ).rejects.toBe(failure)
  expect(failedClose).toHaveBeenCalledTimes(1)
})
