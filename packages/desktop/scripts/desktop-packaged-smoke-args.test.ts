import { describe, expect, test } from "bun:test"

import { desktopPackagedSmokeLaunchArguments } from "./desktop-packaged-smoke-args"

describe("Desktop packaged smoke launch arguments", () => {
  test("isolates macOS smoke runs from the developer's login Keychain", () => {
    expect(
      desktopPackagedSmokeLaunchArguments({
        debuggerPort: 9_224,
        executable: "/tmp/Convax Dev.app/Contents/MacOS/Convax Dev",
        platform: "darwin",
      }),
    ).toContain("--use-mock-keychain")
  })

  test("does not pass the macOS-only mock Keychain switch on other platforms", () => {
    expect(
      desktopPackagedSmokeLaunchArguments({
        debuggerPort: 9_224,
        executable: "/tmp/convax",
        platform: "linux",
      }),
    ).not.toContain("--use-mock-keychain")
  })
})
