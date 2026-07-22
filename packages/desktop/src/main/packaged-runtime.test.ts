import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { desktopOpenCodeBinaryDirectory } from "./packaged-runtime"

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
})
