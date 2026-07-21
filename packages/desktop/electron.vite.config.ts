import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "electron-vite"
import type { Plugin } from "vite"

const dependencyPathPattern = /[\\/]node_modules[\\/]/
const workspaceDistPathPattern = /[\\/]packages[\\/][^\\/]+[\\/]dist(?:[\\/]|$)/

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

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: [
          "@convax/agent-runtime",
          "@convax/canvas",
          "@convax/project",
          "@opencode-ai/sdk",
        ],
      },
      rollupOptions: {
        input: "src/main/index.ts",
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: "src/preload/index.ts",
          "plugin-service-browser-authorization": "src/preload/plugin-service-browser-authorization.ts",
        },
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
    build: {
      rollupOptions: {
        input: "src/renderer/index.html",
      },
    },
  },
})
