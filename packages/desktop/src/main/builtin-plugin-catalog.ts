import type { WebPluginManifest } from "../plugin-contracts"

export interface WebPluginBundle {
  files: Readonly<Record<string, string | Uint8Array>>
}

export interface WebPluginLegacyBundleDigest {
  bundleDigest: string
  version: string
}

export interface DesktopBuiltinPluginBundle {
  bundle: WebPluginBundle
  companionSkillName?: string
  defaultInstall?: boolean
  defaultInstallCompanionSkill?: boolean
  legacyBundleDigests?: readonly WebPluginLegacyBundleDigest[]
  manifest: WebPluginManifest
}

export const desktopBuiltinPluginCatalog: readonly DesktopBuiltinPluginBundle[] = []
