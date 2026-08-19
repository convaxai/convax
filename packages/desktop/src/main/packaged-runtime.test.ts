import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { desktopBunRuntime, desktopOpenCodeBinaryDirectory } from "./packaged-runtime"

describe("Desktop packaged runtime composition", () => {
  test("uses only the staged OpenCode binary directory in a packaged app", () => {
    expect(
      desktopOpenCodeBinaryDirectory({
        isPackaged: true,
        resourcesDirectory: join("Applications", "Convax.app", "Contents", "Resources"),
      }),
    ).toBe(join("Applications", "Convax.app", "Contents", "Resources", "opencode", "bin"))
  })

  test("leaves source and dev-server binary resolution to agent-runtime", () => {
    expect(
      desktopOpenCodeBinaryDirectory({
        isPackaged: false,
        resourcesDirectory: "unused",
      }),
    ).toBeUndefined()
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
