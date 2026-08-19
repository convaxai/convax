import type { Configuration } from "electron-builder"

import { createElectronBuilderConfig } from "./electron-builder.config"

/**
 * Adoption-gate artifact only. It boots the two-Project DSH smoke entry and
 * uses the same DSH runtime closure as the ordinary product artifact.
 */
export function createDshPocElectronBuilderConfig(environment: NodeJS.ProcessEnv = process.env): Configuration {
  const base = createElectronBuilderConfig(environment)
  return {
    ...base,
    directories: { ...base.directories, output: "dist/dsh-poc" },
    extraMetadata: {
      ...base.extraMetadata,
      main: "./out/main/dsh-project-process-smoke.cjs",
    },
    extraResources: base.extraResources,
  }
}

export default createDshPocElectronBuilderConfig()
