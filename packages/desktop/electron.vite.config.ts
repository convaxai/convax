import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import type { Plugin } from "vite"
import { resolveDesktopBuildFeatureFlags } from "./build-feature-flags"

const desktopBuildFeatureFlags = resolveDesktopBuildFeatureFlags(process.env)

const dependencyPathPattern = /[\\/]node_modules[\\/]/
const workspaceDistPathPattern = /[\\/]packages[\\/][^\\/]+[\\/]dist(?:[\\/]|$)/

const desktopMainBundledDependencies = [
  "@convax/agent-runtime",
  "@convax/canvas",
  "@convax/project",
  "@opencode-ai/sdk",
  "acorn",
] as const

export function isWorkspaceDistPath(file: string) {
  return workspaceDistPathPattern.test(file)
}

export function workspaceDistFullReloadPlugin(): Plugin {
  return {
    name: "convax-workspace-dist-full-reload",
    apply: "serve",
    hotUpdate(options) {
      if (!isWorkspaceDistPath(options.file)) return
      // Workspace dist entries are production Bun bundles. Fast Refresh can
      // misclassify their minified exports as component families across builds.
      this.environment.hot.send({ path: "*", type: "full-reload" })
      return []
    },
  }
}

interface SandboxedPreloadOutput {
  imports?: readonly string[]
  isEntry?: boolean
  type: "asset" | "chunk"
}

/** Sandboxed Electron preloads cannot require another emitted CommonJS file. */
export function assertSandboxedPreloadBundle(bundle: Record<string, SandboxedPreloadOutput>) {
  const emittedFiles = new Set(Object.keys(bundle))
  for (const [fileName, output] of Object.entries(bundle)) {
    if (output.type !== "chunk" || !output.isEntry) continue
    const sharedChunks = (output.imports ?? []).filter((imported) => emittedFiles.has(imported))
    if (sharedChunks.length) {
      throw new Error(
        `Sandboxed preload ${fileName} must be self-contained; emitted imports: ${sharedChunks.join(", ")}`,
      )
    }
  }
}

export function sandboxedPreloadBoundaryPlugin(): Plugin {
  return {
    name: "convax-sandboxed-preload-boundary",
    apply: "build",
    generateBundle(_options, bundle) {
      assertSandboxedPreloadBundle(bundle)
    },
  }
}

export const desktopPreloadInputs = {
  index: "src/preload/index.ts",
  pet: "src/preload/pet.ts",
  "plugin-service-browser-authorization": "src/preload/plugin-service-browser-authorization.ts",
} as const

export const desktopRendererInputs = {
  index: "src/renderer/index.html",
} as const

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: [...desktopMainBundledDependencies],
      },
      rollupOptions: {
        input: "src/main/index.ts",
      },
    },
  },
  preload: {
    plugins: [sandboxedPreloadBoundaryPlugin()],
    build: {
      rollupOptions: {
        input: desktopPreloadInputs,
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [
      workspaceDistFullReloadPlugin(),
      react({ exclude: [dependencyPathPattern, workspaceDistPathPattern] }),
      tailwindcss(),
    ],
    define: {
      __CONVAX_FEATURE_SERVICES__: JSON.stringify(desktopBuildFeatureFlags.services),
      __CONVAX_FEATURE_SKILLS_AND_PLUGINS__: JSON.stringify(desktopBuildFeatureFlags.skillsAndPlugins),
    },
    build: {
      rollupOptions: {
        input: desktopRendererInputs,
      },
    },
  },
})
