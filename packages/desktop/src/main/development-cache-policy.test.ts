import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  desktopDevelopmentCachePolicy,
  quarantineLegacyDevelopmentCaches,
  removeQuarantinedDevelopmentCaches,
} from "./development-cache-policy"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("desktop development cache policy", () => {
  test("disables persistent Chromium caches only for the Vite renderer", () => {
    expect(
      desktopDevelopmentCachePolicy({
        isPackaged: false,
        rendererUrl: "http://localhost:5173",
      }),
    ).toEqual({
      legacyDirectoryNames: ["Cache", "Code Cache"],
      switches: [{ name: "disable-http-cache" }],
      v8CacheOptions: "none",
    })

    expect(desktopDevelopmentCachePolicy({ isPackaged: false })).toEqual({
      legacyDirectoryNames: [],
      switches: [],
    })
    expect(
      desktopDevelopmentCachePolicy({
        isPackaged: true,
        rendererUrl: "http://localhost:5173",
      }),
    ).toEqual({
      legacyDirectoryNames: [],
      switches: [],
    })
  })

  test("removes obsolete renderer caches without deleting durable browser storage", async () => {
    const userDataDirectory = await mkdtemp(join(tmpdir(), "convax-development-cache-"))
    temporaryDirectories.push(userDataDirectory)
    await Promise.all([
      mkdir(join(userDataDirectory, "Cache")),
      mkdir(join(userDataDirectory, "Code Cache")),
      mkdir(join(userDataDirectory, "Local Storage")),
    ])
    await Promise.all([
      writeFile(join(userDataDirectory, "Cache", "http-entry"), "cached module"),
      writeFile(join(userDataDirectory, "Code Cache", "js-entry"), "compiled module"),
      writeFile(join(userDataDirectory, "Local Storage", "preferences"), "keep me"),
    ])

    const quarantine = quarantineLegacyDevelopmentCaches(userDataDirectory, ["Cache", "Code Cache"], "test-run")

    expect(await Bun.file(join(userDataDirectory, "Cache", "http-entry")).exists()).toBe(false)
    expect(await Bun.file(join(userDataDirectory, "Code Cache", "js-entry")).exists()).toBe(false)
    expect(await Bun.file(join(userDataDirectory, "Local Storage", "preferences")).text()).toBe("keep me")
    expect(quarantine.failures).toEqual([])
    expect(quarantine.paths).toHaveLength(2)
    expect(await Promise.all(quarantine.paths.map((path) => Bun.file(join(path, "http-entry")).exists()))).toContain(
      true,
    )

    await removeQuarantinedDevelopmentCaches(userDataDirectory)

    expect(await Promise.all(quarantine.paths.map((path) => Bun.file(path).exists()))).toEqual([false, false])
  })
})
