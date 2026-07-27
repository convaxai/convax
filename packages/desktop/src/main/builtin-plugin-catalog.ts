import type { WebPluginBundle, WebPluginLegacyBundleDigest } from "./plugin-manager"
import type { WebPluginManifest } from "../plugin-contracts"

export interface DesktopBuiltinPluginBundle {
  bundle: WebPluginBundle
  companionSkillName?: string
  defaultInstall?: boolean
  defaultInstallCompanionSkill?: boolean
  legacyBundleDigests?: readonly WebPluginLegacyBundleDigest[]
  manifest: WebPluginManifest
}

export const desktopBuiltinPluginCatalog: readonly DesktopBuiltinPluginBundle[] = []
