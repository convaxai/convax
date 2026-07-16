import type { WebPluginBundle } from "./plugin-manager"
import { parseWebPluginManifest, type WebPluginManifest } from "../plugin-contracts"
import app from "../../resources/plugins/storyai-3d-director-desk/assets/app.js?raw"
import styles from "../../resources/plugins/storyai-3d-director-desk/assets/styles.css?raw"
import entry from "../../resources/plugins/storyai-3d-director-desk/index.html?raw"
import license from "../../resources/plugins/storyai-3d-director-desk/LICENSE?raw"
import manifestDocument from "../../resources/plugins/storyai-3d-director-desk/manifest.json?raw"
import skill from "../../resources/plugins/storyai-3d-director-desk/SKILL.md?raw"
import upstream from "../../resources/plugins/storyai-3d-director-desk/UPSTREAM.md?raw"
import upstreamPatch from "../../resources/plugins/storyai-3d-director-desk/UPSTREAM.patch?raw"

export interface DesktopBuiltinPluginBundle {
  bundle: WebPluginBundle
  manifest: WebPluginManifest
}

const directorStageBundle: WebPluginBundle = {
  files: {
    "assets/app.js": app,
    "assets/styles.css": styles,
    "index.html": entry,
    "LICENSE": license,
    "manifest.json": manifestDocument,
    "SKILL.md": skill,
    "UPSTREAM.md": upstream,
    "UPSTREAM.patch": upstreamPatch,
  },
}

export const desktopBuiltinPluginCatalog = [{
  bundle: directorStageBundle,
  manifest: parseWebPluginManifest(JSON.parse(manifestDocument)),
}] as const satisfies readonly DesktopBuiltinPluginBundle[]
