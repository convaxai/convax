import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { parse } from "acorn"
import { defineConfig } from "electron-vite"
import { builtinModules } from "node:module"
import type { Plugin } from "vite"
import { resolveDesktopBuildFeatureFlags } from "./build-feature-flags"

const desktopBuildFeatureFlags = resolveDesktopBuildFeatureFlags(process.env)
const dshAdoptionGateBuild = process.env.CONVAX_DSH_ADOPTION_GATE === "true"

const dependencyPathPattern = /[\\/]node_modules[\\/]/
const workspaceDistPathPattern = /[\\/]packages[\\/][^\\/]+[\\/]dist(?:[\\/]|$)/

const desktopHostExternalImports = new Set([
  "electron",
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
])

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

/** Inline DSH package attribution because the staged utility closure has no dependency-relative package.json. */
export function dshPackageMetadataPlugin(): Plugin {
  return {
    name: "dsh-package-metadata",
    transform(code, id) {
      if (!id.includes("@deepseek-ai")) return
      const transformed = code.replace(
        /createRequire\(import\.meta\.url\)\((["'])\.\.\/package\.json\1\)/gu,
        '({ version: "0.1.0-rc.7" })',
      )
      return transformed === code ? undefined : { code: transformed, map: null }
    },
  }
}

interface SandboxedPreloadOutput {
  code?: string
  dynamicImports?: readonly string[]
  imports?: readonly string[]
  isEntry?: boolean
  type: "asset" | "chunk"
}

function isDesktopHostExternalImport(specifier: string) {
  return desktopHostExternalImports.has(specifier) || specifier.startsWith("electron/")
}

function runtimeModuleLoads(code: string) {
  const moduleLoads: string[] = []
  const root = parse(code, {
    allowAwaitOutsideFunction: true,
    ecmaVersion: "latest",
    sourceType: "module",
  })
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    const node = value as Record<string, unknown>
    if (node.type === "CallExpression") {
      const callee = node.callee as Record<string, unknown> | undefined
      const args = node.arguments as unknown[] | undefined
      const argument = args?.[0] as Record<string, unknown> | undefined
      const literalSpecifier =
        argument?.type === "Literal" && typeof argument.value === "string" ? argument.value : undefined
      if (callee?.type === "Identifier" && callee.name === "require") {
        moduleLoads.push(literalSpecifier ?? "<dynamic require>")
      } else if (callee?.type === "MemberExpression") {
        const object = callee.object as Record<string, unknown> | undefined
        const property = callee.property as Record<string, unknown> | undefined
        const isRequireResolve =
          object?.type === "Identifier" &&
          object.name === "require" &&
          ((callee.computed === false && property?.type === "Identifier" && property.name === "resolve") ||
            (callee.computed === true && property?.type === "Literal" && property.value === "resolve"))
        if (isRequireResolve) moduleLoads.push(literalSpecifier ?? "<dynamic require.resolve>")
      }
    } else if (node.type === "ImportExpression") {
      const source = node.source as Record<string, unknown> | undefined
      moduleLoads.push(
        source?.type === "Literal" && typeof source.value === "string" ? source.value : "<dynamic import>",
      )
    }
    Object.values(node).forEach(visit)
  }
  visit(root)
  return moduleLoads
}

/** Packaged Desktop ships no node_modules, so only Electron and Node host modules may remain external. */
export function assertPackagedRuntimeBundle(
  bundle: Record<string, SandboxedPreloadOutput>,
  surface: "Main" | "Preload",
  allowedComputedImportEntries: readonly string[] = [],
) {
  const emittedFiles = new Set(Object.keys(bundle))
  for (const [fileName, output] of Object.entries(bundle)) {
    if (output.type !== "chunk") continue
    const unresolvedImports = [
      ...(output.imports ?? []),
      ...(output.dynamicImports ?? []),
      ...(output.code ? runtimeModuleLoads(output.code) : []),
    ].filter(
      (specifier) =>
        !(specifier === "<dynamic import>" && allowedComputedImportEntries.includes(fileName)) &&
        !emittedFiles.has(specifier) &&
        !specifier.startsWith(".") &&
        !isDesktopHostExternalImport(specifier),
    )
    if (unresolvedImports.length) {
      throw new Error(
        `Packaged Desktop ${surface} ${fileName} must bundle runtime dependencies; external imports: ${unresolvedImports.join(", ")}`,
      )
    }
  }
}

export function packagedRuntimeBoundaryPlugin(
  surface: "Main" | "Preload",
  allowedComputedImportEntries: readonly string[] = [],
): Plugin {
  return {
    name: `convax-packaged-${surface.toLowerCase()}-runtime-boundary`,
    apply: "build",
    generateBundle(_options, bundle) {
      assertPackagedRuntimeBundle(bundle, surface, allowedComputedImportEntries)
    },
  }
}

/** Sandboxed Electron preloads cannot require another emitted CommonJS file. */
export function assertSandboxedPreloadBundle(bundle: Record<string, SandboxedPreloadOutput>) {
  const emittedFiles = new Set(Object.keys(bundle))
  for (const [fileName, output] of Object.entries(bundle)) {
    if (output.type !== "chunk" || !output.isEntry) continue
    const forbiddenImports = (output.imports ?? []).filter(
      (imported) => emittedFiles.has(imported) || imported !== "electron",
    )
    if (forbiddenImports.length) {
      throw new Error(
        `Sandboxed preload ${fileName} must be self-contained; forbidden imports: ${forbiddenImports.join(", ")}`,
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
  "peerjs-transport-host": "src/preload/peerjs-transport-host.ts",
  "plugin-service-browser-authorization": "src/preload/plugin-service-browser-authorization.ts",
} as const

export const desktopRendererInputs = {
  index: "src/renderer/index.html",
} as const

export function desktopMainInputs(includeDshAdoptionGate: boolean) {
  return includeDshAdoptionGate
    ? { index: "src/main/index.ts", "dsh-project-process-smoke": "src/main/dsh-project-process-smoke.ts" }
    : "src/main/index.ts"
}

export default defineConfig({
  main: {
    plugins: [
      dshPackageMetadataPlugin(),
      packagedRuntimeBoundaryPlugin("Main", dshAdoptionGateBuild ? ["dsh-project-process-smoke.cjs"] : []),
    ],
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: desktopMainInputs(dshAdoptionGateBuild),
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs",
        },
      },
    },
  },
  preload: {
    plugins: [sandboxedPreloadBoundaryPlugin(), packagedRuntimeBoundaryPlugin("Preload")],
    build: {
      externalizeDeps: false,
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
