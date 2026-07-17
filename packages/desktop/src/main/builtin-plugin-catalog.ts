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
import upstreamStatePatch from "../../resources/plugins/storyai-3d-director-desk/UPSTREAM.state.patch?raw"
import upstreamViewPatch from "../../resources/plugins/storyai-3d-director-desk/UPSTREAM.view.patch?raw"
import panoramaApp from "../../resources/plugins/panorama-viewer/assets/app.js?raw"
import panoramaImage from "../../resources/plugins/panorama-viewer/assets/panorama-image.js?raw"
import panoramaRenderer from "../../resources/plugins/panorama-viewer/assets/panorama-renderer.js?raw"
import panoramaStyles from "../../resources/plugins/panorama-viewer/assets/styles.css?raw"
import panoramaEntry from "../../resources/plugins/panorama-viewer/index.html?raw"
import panoramaManifestDocument from "../../resources/plugins/panorama-viewer/manifest.json?raw"

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
    "UPSTREAM.state.patch": upstreamStatePatch,
    "UPSTREAM.view.patch": upstreamViewPatch,
  },
}

const panoramaViewerBundle: WebPluginBundle = {
  files: {
    "assets/app.js": panoramaApp,
    "assets/panorama-image.js": panoramaImage,
    "assets/panorama-renderer.js": panoramaRenderer,
    "assets/styles.css": panoramaStyles,
    "index.html": panoramaEntry,
    "manifest.json": panoramaManifestDocument,
  },
}

export const desktopBuiltinPluginCatalog = [
  {
    bundle: directorStageBundle,
    manifest: parseWebPluginManifest(JSON.parse(manifestDocument)),
  },
  {
    bundle: panoramaViewerBundle,
    manifest: parseWebPluginManifest(JSON.parse(panoramaManifestDocument)),
  },
] as const satisfies readonly DesktopBuiltinPluginBundle[]
