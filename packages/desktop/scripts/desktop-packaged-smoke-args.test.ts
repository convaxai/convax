import { describe, expect, test } from "bun:test"

import { desktopPackagedSmokeLaunchArguments } from "./desktop-packaged-smoke-args"

describe("Desktop packaged smoke launch arguments", () => {
  test("isolates the Official Marketplace Pages host from the packaged smoke run", () => {
    const arguments_ = desktopPackagedSmokeLaunchArguments({
      debuggerPort: 9_224,
      executable: "/tmp/convax",
      platform: "linux",
    })

    expect(arguments_).toContain("--host-resolver-rules=MAP convaxai.github.io 127.0.0.1")
    expect(arguments_).not.toContain("--host-resolver-rules=MAP microvoid.github.io 127.0.0.1")
  })

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

  test("disables Electron's setuid sandbox only for the Linux smoke process", () => {
    expect(
      desktopPackagedSmokeLaunchArguments({
        debuggerPort: 9_224,
        executable: "/tmp/convax",
        platform: "linux",
      }),
    ).toContain("--no-sandbox")
    expect(
      desktopPackagedSmokeLaunchArguments({
        debuggerPort: 9_224,
        executable: "/tmp/Convax Dev.app/Contents/MacOS/Convax Dev",
        platform: "darwin",
      }),
    ).not.toContain("--no-sandbox")
  })
})
