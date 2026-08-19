import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { desktopBunRuntime, desktopDshRuntime } from "./packaged-runtime"

describe("Desktop packaged runtime composition", () => {
  test("uses only the staged DSH utility closure in a packaged app", () => {
    const resourcesDirectory = join("Applications", "Convax.app", "Contents", "Resources")
    expect(
      desktopDshRuntime({
        applicationDirectory: "unused",
        isPackaged: true,
        resourcesDirectory,
      }),
    ).toEqual({
      moduleDirectory: join(resourcesDirectory, "dsh-runtime", "node_modules"),
      utilityEntry: join(resourcesDirectory, "dsh-runtime", "dsh-project-utility.js"),
    })
  })

  test("uses the repository-staged DSH utility closure in development", () => {
    expect(
      desktopDshRuntime({
        applicationDirectory: "/repo/packages/desktop",
        isPackaged: false,
        resourcesDirectory: "unused",
      }),
    ).toEqual({
      moduleDirectory: join("/repo", "packages", "desktop", ".packaging", "runtime", "dsh", "node_modules"),
      utilityEntry: join("/repo", "packages", "desktop", ".packaging", "runtime", "dsh", "dsh-project-utility.js"),
    })
  })

  test("uses an independently staged app-owned Bun CLI", () => {
    const resourcesDirectory = join("Applications", "Convax.app", "Contents", "Resources")
    expect(desktopBunRuntime({ isPackaged: true, platform: "darwin", resourcesDirectory })).toEqual({
      command: join(resourcesDirectory, "bun", "bin", "bun"),
      env: {},
    })
    expect(desktopBunRuntime({ isPackaged: true, platform: "win32", resourcesDirectory })).toEqual({
      command: join(resourcesDirectory, "bun", "bin", "bun.exe"),
      env: {},
    })
    expect(
      desktopBunRuntime({
        applicationDirectory: "/repo/packages/desktop",
        isPackaged: false,
        platform: "darwin",
        resourcesDirectory: "unused",
      }),
    ).toEqual({
      command: join("/repo/packages/desktop", ".packaging", "runtime", "bun", "bin", "bun"),
      env: {},
    })
  })
})
