import type { WebPluginBundle, WebPluginLegacyBundleDigest } from "./plugin-manager"
import { parseWebPluginManifest, type WebPluginManifest } from "../plugin-contracts"
import jianyingEntry from "../../resources/plugins/jianying-editor/index.html?raw"
import jianyingLicense from "../../resources/plugins/jianying-editor/LICENSE?raw"
import jianyingManifestDocument from "../../resources/plugins/jianying-editor/manifest.json?raw"
import jianyingSkill from "../../resources/plugins/jianying-editor/skills/jianying-editor/SKILL.md?raw"
import jianyingUpstream from "../../resources/plugins/jianying-editor/UPSTREAM.md?raw"

export interface DesktopBuiltinPluginBundle {
  bundle: WebPluginBundle
  companionSkillName?: string
  defaultInstall?: boolean
  defaultInstallCompanionSkill?: boolean
  legacyBundleDigests?: readonly WebPluginLegacyBundleDigest[]
  manifest: WebPluginManifest
}

const jianyingEditorBundle: WebPluginBundle = {
  files: {
    "index.html": jianyingEntry,
    LICENSE: jianyingLicense,
    "manifest.json": jianyingManifestDocument,
    "skills/jianying-editor/SKILL.md": jianyingSkill,
    "UPSTREAM.md": jianyingUpstream,
  },
}

export const desktopBuiltinPluginCatalog: readonly DesktopBuiltinPluginBundle[] = [
  {
    bundle: jianyingEditorBundle,
    companionSkillName: "jianying-editor",
    defaultInstall: true,
    defaultInstallCompanionSkill: true,
    manifest: parseWebPluginManifest(JSON.parse(jianyingManifestDocument)),
  },
]
