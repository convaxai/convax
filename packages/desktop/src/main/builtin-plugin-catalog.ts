import type { WebPluginBundle, WebPluginLegacyBundleDigest } from "./plugin-manager"
import { parseWebPluginManifest, type WebPluginManifest } from "../plugin-contracts"
import app from "../../resources/plugins/storyai-3d-director-desk/assets/app.js?raw"
import styles from "../../resources/plugins/storyai-3d-director-desk/assets/styles.css?raw"
import entry from "../../resources/plugins/storyai-3d-director-desk/index.html?raw"
import license from "../../resources/plugins/storyai-3d-director-desk/LICENSE?raw"
import manifestDocument from "../../resources/plugins/storyai-3d-director-desk/manifest.json?raw"
import skill from "../../resources/plugins/storyai-3d-director-desk/SKILL.md?raw"
import upstream from "../../resources/plugins/storyai-3d-director-desk/UPSTREAM.md?raw"
import upstreamPatch from "../../resources/plugins/storyai-3d-director-desk/UPSTREAM.patch?raw"
import upstreamStatePatch from "../../resources/plugins/storyai-3d-director-desk/UPSTREAM.state.patch?raw"
import upstreamViewPatch from "../../resources/plugins/storyai-3d-director-desk/UPSTREAM.view.patch?raw"
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

const directorStageBundle: WebPluginBundle = {
  files: {
    "assets/app.js": app,
    "assets/styles.css": styles,
    "index.html": entry,
    LICENSE: license,
    "manifest.json": manifestDocument,
    "SKILL.md": skill,
    "UPSTREAM.md": upstream,
    "UPSTREAM.patch": upstreamPatch,
    "UPSTREAM.state.patch": upstreamStatePatch,
    "UPSTREAM.view.patch": upstreamViewPatch,
  },
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

export const desktopBuiltinPluginCatalog = [
  {
    bundle: directorStageBundle,
    companionSkillName: "storyai-3d-director-desk",
    legacyBundleDigests: [
      {
        // Canonical digest of the checked-in 0.0.1-convax.1 catalog bundle
        // from commit 7088ed1e8. It permits only that exact pre-provenance
        // installation to be adopted and upgraded.
        bundleDigest: "87a10c5dd5fe31e2c3d3982e7cc4949951ec58665ba440c6bf7fb9f58f425cd4",
        version: "0.0.1-convax.1",
      },
    ],
    manifest: parseWebPluginManifest(JSON.parse(manifestDocument)),
  },
  {
    bundle: jianyingEditorBundle,
    companionSkillName: "jianying-editor",
    defaultInstall: true,
    defaultInstallCompanionSkill: true,
    manifest: parseWebPluginManifest(JSON.parse(jianyingManifestDocument)),
  },
] as const satisfies readonly DesktopBuiltinPluginBundle[]
