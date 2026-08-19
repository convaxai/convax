import type { Configuration } from "electron-builder"

import { createElectronBuilderConfig } from "./electron-builder.config"

/**
 * Adoption-gate artifact only. It boots the two-Project DSH smoke entry and
 * deliberately excludes every OpenCode runtime artifact.
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
    extraResources: [
      ...((base.extraResources ?? []) as Exclude<Configuration["extraResources"], string | undefined>).filter(
        (resource) => typeof resource === "object" && resource !== null && resource.to !== "opencode",
      ),
      {
        from: ".packaging/runtime/dsh",
        to: "dsh-runtime",
        filter: ["dsh-project-utility.js", "package.json", "runtime.json"],
      },
      {
        from: ".packaging/runtime/dsh/node_modules",
        to: "dsh-runtime/node_modules",
        filter: ["**/*"],
      },
    ],
  }
}

export default createDshPocElectronBuilderConfig()
