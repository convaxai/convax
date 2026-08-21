import { describe, expect, test } from "bun:test"

import {
  desktopPackagedSmokeLaunchArguments,
  packagedSmokeOfficialMarketplaceNetworkIsolation,
} from "./desktop-packaged-smoke-args"

describe("Desktop packaged smoke launch arguments", () => {
  test("fails Official Marketplace Pages and Release networking closed without mapping loopback", () => {
    const arguments_ = desktopPackagedSmokeLaunchArguments({
      debuggerPort: 9_224,
      executable: "/tmp/convax",
      platform: "linux",
    })

    expect(arguments_).toContain(packagedSmokeOfficialMarketplaceNetworkIsolation)
    expect(packagedSmokeOfficialMarketplaceNetworkIsolation).toContain("MAP convaxai.github.io ^NOTFOUND")
    expect(packagedSmokeOfficialMarketplaceNetworkIsolation).toContain("MAP github.com ^NOTFOUND")
    expect(packagedSmokeOfficialMarketplaceNetworkIsolation).not.toMatch(/MAP (?:localhost|127\.0\.0\.1|\[::1\])\b/)
    expect(packagedSmokeOfficialMarketplaceNetworkIsolation).not.toContain("microvoid.github.io")
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
