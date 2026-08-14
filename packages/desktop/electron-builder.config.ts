import type { Configuration } from "electron-builder"

type ConvaxChannel = "beta" | "dev" | "prod"

const CHANNELS = {
  dev: {
    appId: "com.microvoid.convax.dev",
    productName: "Convax Dev",
    rpmPackageName: "convax-dev",
  },
  beta: {
    appId: "com.microvoid.convax.beta",
    productName: "Convax Beta",
    rpmPackageName: "convax-beta",
  },
  prod: {
    appId: "com.microvoid.convax",
    productName: "Convax",
    rpmPackageName: "convax",
  },
} as const satisfies Record<ConvaxChannel, { appId: string; productName: string; rpmPackageName: string }>

export function resolveConvaxChannel(value: string | undefined): ConvaxChannel {
  if (value === "beta" || value === "prod") return value
  return "dev"
}

export function resolveDesktopUpdateBaseUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  const url = new URL(value.trim())
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.origin === "null") {
    throw new Error("CONVAX_UPDATE_BASE_URL must be a public HTTPS origin/path without credentials, query, or fragment")
  }
  return url.href.replace(/\/+$/, "")
}

export function createElectronBuilderConfig(environment: NodeJS.ProcessEnv = process.env): Configuration {
  const channel = resolveConvaxChannel(environment.CONVAX_CHANNEL)
  const identity = CHANNELS[channel]
  // Developer and pull-request artifacts intentionally remain buildable without
  // credentials. Every publishable macOS or Windows job opts in and fails closed.
  const release = environment.CONVAX_RELEASE === "true"
  const updateBaseUrl = resolveDesktopUpdateBaseUrl(environment.CONVAX_UPDATE_BASE_URL)
  const releaseVersion = environment.CONVAX_RELEASE_VERSION?.trim()
  const releaseNotesFile = environment.CONVAX_RELEASE_NOTES_FILE?.trim()
  const windowsPublisherName = environment.CONVAX_WINDOWS_PUBLISHER_NAME?.trim()

  if (release && !updateBaseUrl) throw new Error("CONVAX_UPDATE_BASE_URL is required for a release build")
  if (release && !releaseVersion?.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/)) {
    throw new Error("CONVAX_RELEASE_VERSION must be an exact SemVer for a release build")
  }

  return {
    appId: identity.appId,
    productName: identity.productName,
    artifactName: "convax-desktop-${version}-${os}-${arch}.${ext}",
    directories: {
      buildResources: "resources",
      output: "dist",
    },
    extraMetadata: {
      // Electron Builder 26 does not yet derive the Linux desktop entry name
      // from executableName by default. Keep every Linux identity aligned.
      desktopName: `${identity.appId}.desktop`,
      ...(releaseVersion ? { version: releaseVersion } : {}),
    },
    electronUpdaterCompatibility: ">=2.16",
    publish: updateBaseUrl ? [{ provider: "generic", url: updateBaseUrl }] : undefined,
    releaseInfo: releaseNotesFile ? { releaseNotesFile } : undefined,
    // Main, preload, renderer, the OpenCode SDK, and every Convax workspace
    // dependency are already bundled by electron-vite. electron-builder's Bun
    // dependency traversal would otherwise follow workspace links and publish
    // package source, tests, and build caches inside app.asar.
    files: ["out/**/*", "resources/**/*", "package.json", "!node_modules/**/*"],
    extraResources: [
      {
        from: ".packaging/collaboration-protocol",
        to: "collaboration-protocol",
        filter: ["current.json"],
      },
      {
        from: ".packaging/marketplace-product",
        to: "marketplace-product",
        filter: ["**/*"],
      },
      {
        from: ".packaging/runtime/opencode",
        to: "opencode",
        filter: ["**/*"],
      },
    ],
    asar: true,
    npmRebuild: false,
    forceCodeSigning: release,
    electronFuses: {
      // Flipping an Electron fuse mutates the macOS executable. arm64 rejects
      // the original ad-hoc signature unless @electron/fuses regenerates it;
      // release signing then replaces this with the Developer ID signature.
      resetAdHocDarwinSignature: true,
      runAsNode: false,
      // Convax has no persistent browser-cookie authentication surface. Enabling
      // this fuse would synchronously unlock the macOS Keychain before main can
      // create a window, which makes unsigned/headless package smoke hang.
      enableCookieEncryption: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      loadBrowserProcessSpecificV8Snapshot: false,
      // The host renderer still boots from file://.../app.asar. Keep Electron's
      // ASAR-aware file privileges until that surface moves to a dedicated,
      // explicitly served application protocol.
      grantFileProtocolExtraPrivileges: true,
    },
    mac: {
      category: "public.app-category.productivity",
      icon: "resources/icon.png",
      hardenedRuntime: true,
      gatekeeperAssess: false,
      notarize: release,
      target: ["dmg", "zip"],
    },
    dmg: {
      sign: release,
    },
    win: {
      icon: "resources/icon.png",
      publisherName: windowsPublisherName,
      target: ["nsis"],
      verifyUpdateCodeSignature: true,
    },
    nsis: {
      oneClick: true,
      perMachine: false,
    },
    linux: {
      category: "Graphics",
      executableName: identity.appId,
      icon: "resources/icon.png",
      desktop: {
        entry: {
          StartupWMClass: identity.appId,
        },
      },
      target: ["AppImage", "deb", "rpm"],
    },
    rpm: {
      packageName: identity.rpmPackageName,
    },
  }
}

export default createElectronBuilderConfig()
