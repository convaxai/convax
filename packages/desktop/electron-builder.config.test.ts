import { describe, expect, test } from "bun:test"
import { createRequire } from "node:module"
import { createElectronBuilderConfig, resolveConvaxChannel } from "./electron-builder.config"

const require = createRequire(import.meta.url)

function electronVersion() {
  const { version } = require("electron/package.json") as { version: string }
  return version.split(".").map((part) => Number(part))
}

describe("Desktop package identity", () => {
  const channels = [
    {
      appId: "com.microvoid.convax.dev",
      channel: "dev",
      productName: "Convax Dev",
      rpmPackageName: "convax-dev",
    },
    {
      appId: "com.microvoid.convax.beta",
      channel: "beta",
      productName: "Convax Beta",
      rpmPackageName: "convax-beta",
    },
    {
      appId: "com.microvoid.convax",
      channel: "prod",
      productName: "Convax",
      rpmPackageName: "convax",
    },
  ] as const

  for (const expected of channels) {
    test(`keeps platform identities aligned for ${expected.channel}`, () => {
      const config = createElectronBuilderConfig({ CONVAX_CHANNEL: expected.channel })

      expect(config.appId).toBe(expected.appId)
      expect(config.productName).toBe(expected.productName)
      expect(config.extraMetadata?.desktopName).toBe(`${expected.appId}.desktop`)
      expect(config.linux?.executableName).toBe(expected.appId)
      expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(expected.appId)
      expect(config.protocols).toEqual([{ name: "Convax", schemes: ["convax"] }])
      expect(config.rpm?.packageName).toBe(expected.rpmPackageName)
    })
  }

  test("defaults unknown or absent channels to a side-by-side development identity", () => {
    expect(resolveConvaxChannel(undefined)).toBe("dev")
    expect(resolveConvaxChannel("nightly")).toBe("dev")
    expect(createElectronBuilderConfig({}).appId).toBe("com.microvoid.convax.dev")
  })
})

describe("Desktop package contents", () => {
  test("uses an Electron release that does not eagerly access macOS Safe Storage from ESM imports", () => {
    const [major = 0, minor = 0, patch = 0] = electronVersion()

    expect(major > 42 || (major === 42 && (minor > 4 || (minor === 4 && patch >= 1)))).toBe(true)
  })

  test("archives built application code and stages host-owned resources outside ASAR", () => {
    const config = createElectronBuilderConfig({})

    expect(config.asar).toBe(true)
    expect(config.directories).toEqual({ buildResources: "resources", output: "dist" })
    expect(config.files).toEqual(["out/**/*", "resources/**/*", "package.json", "!node_modules/**/*"])
    expect(config.npmRebuild).toBe(false)
    expect(config.extraResources).toContainEqual({
      from: ".packaging/marketplace-product",
      to: "marketplace-product",
      filter: ["**/*"],
    })
    expect(config.extraResources).toContainEqual({
      from: ".packaging/runtime/opencode",
      to: "opencode",
      filter: ["**/*"],
    })
  })

  test("hardens the packaged Electron executable around its integrity-checked ASAR", () => {
    expect(createElectronBuilderConfig({}).electronFuses).toEqual({
      resetAdHocDarwinSignature: true,
      runAsNode: false,
      enableCookieEncryption: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      loadBrowserProcessSpecificV8Snapshot: false,
      grantFileProtocolExtraPrivileges: true,
    })
  })
})

describe("Desktop platform artifacts", () => {
  test("matches the OpenCode-style platform target set", () => {
    const config = createElectronBuilderConfig({})

    expect(config.artifactName).toBe("convax-desktop-${os}-${arch}.${ext}")
    expect(config.mac?.target).toEqual(["dmg", "zip"])
    expect(config.win?.target).toEqual(["nsis"])
    expect(config.linux?.target).toEqual(["AppImage", "deb", "rpm"])
    expect(config.nsis).toMatchObject({ oneClick: true, perMachine: false })
    expect(config.mac).toMatchObject({
      category: "public.app-category.productivity",
      gatekeeperAssess: false,
      hardenedRuntime: true,
      icon: "resources/icon.png",
    })
    expect(config.win?.icon).toBe("resources/icon.png")
    expect(config.linux).toMatchObject({ category: "Graphics", icon: "resources/icon.png" })
  })

  test("allows unsigned local builds but fails closed for release signing and notarization", () => {
    const local = createElectronBuilderConfig({})
    const release = createElectronBuilderConfig({ CONVAX_RELEASE: "true" })

    expect(local.forceCodeSigning).toBe(false)
    expect(local.mac?.notarize).toBe(false)
    expect(local.dmg?.sign).toBe(false)
    expect(release.forceCodeSigning).toBe(true)
    expect(release.mac?.notarize).toBe(true)
    expect(release.dmg?.sign).toBe(true)
  })
})
