import { builtinModules } from "node:module"
import { dirname, join, relative, resolve, sep } from "node:path"

type PackageManifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: Record<string, unknown> | string
  files?: string[]
  name?: string
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  private?: boolean
  scripts?: Record<string, string>
  version?: string
}

type WorkspacePackage = {
  directory: string
  manifest: PackageManifest
  name: string
}

const repositoryRoot = join(import.meta.dir, "..")
const hostChangeGovernancePath = join(repositoryRoot, "docs", "plugin-host-change-governance.md")
const desktopCompositionPath = join(repositoryRoot, "packages", "desktop", "src", "main", "index.ts")
const retiredRegistryPaths = [
  "packages/desktop/src/main/remote-capability-registry.ts",
  "packages/desktop/src/main/remote-capability-installer.ts",
  "packages/desktop/src/main/default-remote-capability-catalog.ts",
  "packages/desktop/src/main/electron-remote-capability-fetch.ts",
  "packages/desktop/src/main/file-remote-registry-cache.ts",
  "packages/desktop/src/main/file-remote-showcase-media-cache.ts",
  "packages/desktop/src/main/packaged-default-capabilities.ts",
  "packages/desktop/scripts/stage-default-capabilities.ts",
]
const retiredRegistryTokens = [
  "convax.registry/1",
  "convax.showcase/1",
  "RemoteCapabilityInstaller",
  "RemoteCapabilityRegistry",
  "default-remote-capability",
  "remote-capability-installer",
  "remote-capability-registry",
  "registry/v1/index.json",
]
const applicationPackageNames = new Set(["@convax/desktop"])
const publishablePackageNames = new Set([
  "@convax/agent-runtime",
  "@convax/canvas",
  "@convax/marketplace",
  "@convax/marketplace-kit",
  "@convax/plugin-api",
  "@convax/plugin-sdk",
  "@convax/project",
  "@convax/project-files",
  "@convax/ui",
  "@convax/workbench",
  "create-convax-marketplace",
])
const reservedWorkspacePackageName = "@convax/workspace"
const allowedInternalRuntimeDependencies = new Map<string, ReadonlySet<string>>([
  ["@convax/agent-runtime", new Set()],
  ["@convax/canvas", new Set(["@convax/ui"])],
  ["@convax/marketplace", new Set()],
  ["@convax/plugin-api", new Set()],
  ["@convax/plugin-sdk", new Set(["@convax/plugin-api"])],
  ["@convax/marketplace-kit", new Set(["@convax/marketplace", "@convax/plugin-api", "@convax/plugin-sdk"])],
  ["create-convax-marketplace", new Set(["@convax/marketplace-kit"])],
  [
    "@convax/desktop",
    new Set([
      "@convax/agent-runtime",
      "@convax/canvas",
      "@convax/marketplace",
      "@convax/plugin-api",
      "@convax/plugin-sdk",
      "@convax/project",
      "@convax/project-files",
      "@convax/ui",
      "@convax/workbench",
    ]),
  ],
  ["@convax/project", new Set(["@convax/canvas", "@convax/project-files", "@convax/ui"])],
  ["@convax/project-files", new Set()],
  ["@convax/ui", new Set()],
  ["@convax/workbench", new Set()],
])
const allowedInternalSubpaths = new Map<string, ReadonlySet<string>>([
  ["@convax/canvas -> @convax/ui", new Set([".", "./theme.css"])],
  ["@convax/project -> @convax/canvas", new Set(["./application", "./core"])],
  ["@convax/project -> @convax/project-files", new Set([".", "./contracts", "./drag"])],
  ["@convax/project -> @convax/ui", new Set([".", "./theme.css"])],
])
const nodeBuiltinSpecifiers = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

function normalizedSourcePath(sourcePath: string): string {
  return sourcePath.replaceAll("\\", "/")
}

function isTestSource(sourcePath: string): boolean {
  const normalized = normalizedSourcePath(sourcePath)
  return normalized.startsWith("test/") || /(?:^|\/)[^/]+\.(?:spec|test)\.[cm]?[jt]sx?$/.test(normalized)
}

function canImportNodeBuiltins(packageName: string, sourcePath: string): boolean {
  if (isTestSource(sourcePath)) return true
  const normalized = normalizedSourcePath(sourcePath)
  if (packageName === "@convax/agent-runtime") return normalized.startsWith("src/node/")
  if (packageName === "@convax/project") return normalized.startsWith("src/node/")
  if (packageName === "@convax/desktop") return normalized.startsWith("src/main/")
  if (
    packageName === "@convax/marketplace"
    || packageName === "@convax/marketplace-kit"
    || packageName === "@convax/plugin-api"
    || packageName === "@convax/plugin-sdk"
    || packageName === "create-convax-marketplace"
  ) return true
  return false
}

function canImportElectron(packageName: string, sourcePath: string): boolean {
  if (packageName !== "@convax/desktop") return false
  const normalized = normalizedSourcePath(sourcePath)
  return normalized.startsWith("src/main/") || normalized.startsWith("src/preload/")
}

function canImportNodeEntry(packageName: string, sourcePath: string): boolean {
  if (isTestSource(sourcePath)) return true
  return packageName === "@convax/desktop" && normalizedSourcePath(sourcePath).startsWith("src/main/")
}

function matchesExport(exports: PackageManifest["exports"], subpath: string): boolean {
  if (typeof exports === "string") return subpath === "."
  if (!exports) return false
  if (subpath in exports) return true
  return Object.keys(exports).some((key) => {
    const wildcard = key.indexOf("*")
    if (wildcard < 0) return false
    return subpath.startsWith(key.slice(0, wildcard)) && subpath.endsWith(key.slice(wildcard + 1))
  })
}

function leavesPackage(sourceFile: string, specifier: string, packageDirectory: string): boolean {
  const target = resolve(dirname(sourceFile), specifier)
  const pathFromPackage = relative(packageDirectory, target)
  return pathFromPackage === ".." || pathFromPackage.startsWith(`..${sep}`)
}

function findCycle(graph: Map<string, Set<string>>): string[] | undefined {
  const visited = new Set<string>()
  const active = new Set<string>()
  const path: string[] = []

  const visit = (name: string): string[] | undefined => {
    if (active.has(name)) return [...path.slice(path.indexOf(name)), name]
    if (visited.has(name)) return undefined
    visited.add(name)
    active.add(name)
    path.push(name)
    for (const dependency of graph.get(name) ?? []) {
      const cycle = visit(dependency)
      if (cycle) return cycle
    }
    path.pop()
    active.delete(name)
    return undefined
  }

  for (const name of graph.keys()) {
    const cycle = visit(name)
    if (cycle) return cycle
  }
  return undefined
}

const packages: WorkspacePackage[] = []
const rootContract = await Bun.file(join(repositoryRoot, "AGENTS.md")).text()
const hostChangeGovernance = await Bun.file(hostChangeGovernancePath).text()
const desktopComposition = await Bun.file(desktopCompositionPath).text()
if (
  !rootContract.includes("## Plugin-to-Host change gate") ||
  !rootContract.includes("Agent-authored approval text") ||
  !rootContract.includes("protected external decision receipt") ||
  !hostChangeGovernance.includes("Status: mandatory review gate.") ||
  !hostChangeGovernance.includes("must not decide to modify the Convax repository") ||
  !hostChangeGovernance.includes("Status: pending human review") ||
  !hostChangeGovernance.includes("Decision: pending") ||
  !hostChangeGovernance.includes("Approval prose committed by an Agent or Plugin author is not an approval")
) {
  throw new Error("Plugin-to-Host human review gate is missing from the architecture contract")
}
if (
  desktopComposition.includes("RemoteCapabilityRegistryClient") ||
  desktopComposition.includes("registry/v1/index.json") ||
  desktopComposition.includes("convax.registry/1")
) {
  throw new Error("Desktop production composition must use Marketplace v2 and must not revive the legacy Registry v1")
}
for (const retiredPath of retiredRegistryPaths) {
  if (await Bun.file(join(repositoryRoot, retiredPath)).exists()) {
    throw new Error(`${retiredPath}: legacy Registry v1 ownership must not be restored`)
  }
}
for await (const sourcePath of new Bun.Glob("packages/desktop/src/main/**/*.ts").scan(repositoryRoot)) {
  if (sourcePath.endsWith(".test.ts") || sourcePath.endsWith(".fixture.ts")) continue
  const source = await Bun.file(join(repositoryRoot, sourcePath)).text()
  const retiredToken = retiredRegistryTokens.find((token) => source.includes(token))
  if (retiredToken) {
    throw new Error(`${sourcePath}: production source revives retired Registry v1 ownership (${retiredToken})`)
  }
}
for await (const manifestPath of new Bun.Glob("packages/*/package.json").scan(repositoryRoot)) {
  const directory = dirname(join(repositoryRoot, manifestPath))
  const manifest = (await Bun.file(join(repositoryRoot, manifestPath)).json()) as PackageManifest
  if (!manifest.name) throw new Error(`${manifestPath}: package name is required`)
  packages.push({ directory, manifest, name: manifest.name })
}

const packagesByName = new Map(packages.map((workspacePackage) => [workspacePackage.name, workspacePackage]))
for (const workspacePackage of packages) {
  if (!workspacePackage.name.startsWith("@convax/") && workspacePackage.name !== "create-convax-marketplace") {
    throw new Error(`${workspacePackage.name}: workspace packages must use the @convax scope except the create CLI`)
  }
  if (!allowedInternalRuntimeDependencies.has(workspacePackage.name)) {
    throw new Error(
      `${workspacePackage.name}: package ownership is not registered; update AGENTS.md, docs/architecture.md, and package-boundary-check.ts`,
    )
  }
  if (!await Bun.file(join(workspacePackage.directory, "AGENTS.md")).exists()) {
    throw new Error(`${workspacePackage.name}: every package needs a local AGENTS.md ownership contract`)
  }
  if (!applicationPackageNames.has(workspacePackage.name) && !publishablePackageNames.has(workspacePackage.name)) {
    throw new Error(`${workspacePackage.name}: new library packages must be registered as independently publishable`)
  }
}
for (const packageName of allowedInternalRuntimeDependencies.keys()) {
  if (!packagesByName.has(packageName)) {
    throw new Error(`${packageName}: architecture dependency policy refers to a missing workspace package`)
  }
}
for (const name of publishablePackageNames) {
  const workspacePackage = packagesByName.get(name)
  if (!workspacePackage || workspacePackage.manifest.private) {
    throw new Error(`${name}: expected an independent publishable package`)
  }
  const { exports, files, scripts, version } = workspacePackage.manifest
  if (
    !version
    || version === "0.0.0"
    || !files?.includes("dist")
    || !exports
    || typeof exports === "string"
    || !matchesExport(exports, ".")
  ) {
    throw new Error(`${name}: publishable packages need a real version, dist files, and a public root export`)
  }
  for (const script of ["build", "clean", "prepack", "prepublishOnly", "test", "typecheck"]) {
    if (!scripts?.[script]) throw new Error(`${name}: publishable packages need a package-local ${script} script`)
  }
}
for (const name of applicationPackageNames) {
  const workspacePackage = packagesByName.get(name)
  if (!workspacePackage?.manifest.private) {
    throw new Error(`${name}: application composition packages must stay private`)
  }
}

const graph = new Map<string, Set<string>>()
for (const workspacePackage of packages) {
  const runtimeDependencies = {
    ...workspacePackage.manifest.dependencies,
    ...workspacePackage.manifest.optionalDependencies,
    ...workspacePackage.manifest.peerDependencies,
  }
  const allDeclaredDependencies = {
    ...runtimeDependencies,
    ...workspacePackage.manifest.devDependencies,
  }
  if (reservedWorkspacePackageName in allDeclaredDependencies) {
    throw new Error(
      `${workspacePackage.name}: ${reservedWorkspacePackageName} is reserved for a future multi-project window model`,
    )
  }
  const internalRuntimeDependencies = Object.keys(runtimeDependencies).filter((dependency) => packagesByName.has(dependency))
  const allowedDependencies = allowedInternalRuntimeDependencies.get(workspacePackage.name)!
  for (const dependency of internalRuntimeDependencies) {
    if (!allowedDependencies.has(dependency)) {
      throw new Error(
        `${workspacePackage.name}: architecture forbids runtime dependency on ${dependency}; compose the packages in @convax/desktop instead`,
      )
    }
  }
  graph.set(
    workspacePackage.name,
    new Set(internalRuntimeDependencies),
  )

  const validateSpecifier = (sourcePath: string, specifier: string) => {
    const absoluteSourcePath = join(workspacePackage.directory, sourcePath)
    if (
      specifier.startsWith("/")
      || /^[A-Za-z]:[\\/]/.test(specifier)
      || specifier.startsWith("file:")
    ) {
      throw new Error(`${sourcePath}: absolute file imports are not portable: ${specifier}`)
    }
    if ((specifier.startsWith(".") || specifier.startsWith("@convax/")) && specifier.includes("\\")) {
      throw new Error(`${sourcePath}: module specifiers must use forward slashes on every platform: ${specifier}`)
    }
    if (specifier.startsWith(".") && leavesPackage(absoluteSourcePath, specifier, workspacePackage.directory)) {
      throw new Error(`${sourcePath}: relative import escapes ${workspacePackage.name}: ${specifier}`)
    }
    if (specifier === reservedWorkspacePackageName || specifier.startsWith(`${reservedWorkspacePackageName}/`)) {
      throw new Error(
        `${sourcePath}: ${reservedWorkspacePackageName} is reserved; Workbench owns active window state and Project owns one folder`,
      )
    }
    if (
      workspacePackage.name !== "@convax/agent-runtime" &&
      (specifier === "opencode-ai" || specifier.startsWith("opencode-ai/") || specifier.startsWith("@opencode-ai/"))
    ) {
      throw new Error(`${sourcePath}: OpenCode imports must stay behind @convax/agent-runtime`)
    }
    if (nodeBuiltinSpecifiers.has(specifier) && !canImportNodeBuiltins(workspacePackage.name, sourcePath)) {
      throw new Error(`${sourcePath}: Node built-in ${specifier} is outside an approved Node adapter directory`)
    }
    if ((specifier === "electron" || specifier.startsWith("electron/")) && !canImportElectron(workspacePackage.name, sourcePath)) {
      throw new Error(`${sourcePath}: Electron imports are limited to @convax/desktop main and preload`)
    }

    const dependencyPackage = packages.find(
      (candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`),
    )
    if (!dependencyPackage) return
    if (dependencyPackage.name !== workspacePackage.name && !(dependencyPackage.name in runtimeDependencies)) {
      throw new Error(`${sourcePath}: ${dependencyPackage.name} must be a runtime dependency of ${workspacePackage.name}`)
    }

    const suffix = specifier.slice(dependencyPackage.name.length)
    const subpath = suffix ? `.${suffix}` : "."
    if (!matchesExport(dependencyPackage.manifest.exports, subpath)) {
      throw new Error(`${sourcePath}: ${specifier} is not a public export of ${dependencyPackage.name}`)
    }
    if ((subpath === "./node" || subpath.startsWith("./node/")) && !canImportNodeEntry(workspacePackage.name, sourcePath)) {
      throw new Error(`${sourcePath}: ${specifier} is a Node-only entry and may only be composed by Desktop main`)
    }
    if (dependencyPackage.name !== workspacePackage.name) {
      const edge = `${workspacePackage.name} -> ${dependencyPackage.name}`
      const allowedSubpaths = allowedInternalSubpaths.get(edge)
      if (allowedSubpaths && !allowedSubpaths.has(subpath)) {
        throw new Error(
          `${sourcePath}: architecture forbids ${specifier}; allowed ${dependencyPackage.name} entries are ${[...allowedSubpaths].join(", ")}`,
        )
      }
    }
  }

  for (const sourceRoot of ["src", "test"]) {
    for await (const sourcePath of new Bun.Glob(`${sourceRoot}/**/*.{ts,tsx,js,jsx,mjs,cjs}`).scan(
      workspacePackage.directory,
    )) {
      const source = await Bun.file(join(workspacePackage.directory, sourcePath)).text()
      if (
        workspacePackage.name !== "@convax/project"
        && !isTestSource(sourcePath)
        && /\.convax\/(?:project\.json|canvas\.json|canvases(?:\/|\b))/i.test(source.replaceAll("\\", "/"))
      ) {
        throw new Error(
          `${sourcePath}: private Project metadata must be accessed through @convax/project ports, never by path`,
        )
      }
      const specifiers = [
        ...source.matchAll(/(?:from\s*|import\s*\(\s*|require(?:\.resolve)?\s*\(\s*)["']([^"']+)["']/g),
        ...source.matchAll(/(?:^|[;\n])\s*import\s*["']([^"']+)["']/g),
      ].map((match) => match[1])
      for (const specifier of specifiers) {
        validateSpecifier(sourcePath, specifier)
        if (
          publishablePackageNames.has(workspacePackage.name)
          && !isTestSource(sourcePath)
          && !specifier.startsWith(".")
          && !specifier.startsWith("/")
          && !specifier.startsWith("file:")
          && !specifier.startsWith("bun:")
          && !nodeBuiltinSpecifiers.has(specifier)
          && !packages.some((candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`))
        ) {
          const [first, second] = specifier.split("/")
          const dependencyName = first?.startsWith("@") ? `${first}/${second}` : first
          if (!dependencyName || !(dependencyName in runtimeDependencies)) {
            throw new Error(
              `${sourcePath}: external import ${specifier} must be a declared dependency or peer of ${workspacePackage.name}`,
            )
          }
        }
      }
    }
  }

  for await (const sourcePath of new Bun.Glob("src/**/*.css").scan(workspacePackage.directory)) {
    const source = await Bun.file(join(workspacePackage.directory, sourcePath)).text()
    for (const match of source.matchAll(/@(?:import|source)\s+(?:url\(\s*)?["']([^"']+)["']/g)) {
      validateSpecifier(sourcePath, match[1])
    }
  }

  if (workspacePackage.name !== "@convax/agent-runtime") {
    const forbiddenDependency = Object.keys(runtimeDependencies).find(
      (dependency) => dependency === "opencode-ai" || dependency.startsWith("@opencode-ai/"),
    )
    if (forbiddenDependency) {
      throw new Error(`${workspacePackage.name}: ${forbiddenDependency} must stay behind @convax/agent-runtime`)
    }
  }
}

const cycle = findCycle(graph)
if (cycle) throw new Error(`package dependency cycle: ${cycle.join(" -> ")}`)

console.log(`package boundary check passed: ${packages.length} packages, architecture and runtime boundaries valid`)
