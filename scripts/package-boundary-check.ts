import { dirname, join, relative, resolve, sep } from "node:path"

type PackageManifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  exports?: Record<string, unknown> | string
  name?: string
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  private?: boolean
}

type WorkspacePackage = {
  directory: string
  manifest: PackageManifest
  name: string
}

const repositoryRoot = join(import.meta.dir, "..")
const publishablePackageNames = new Set([
  "@convax/agent-runtime",
  "@convax/canvas",
  "@convax/project",
  "@convax/project-files",
  "@convax/ui",
  "@convax/workbench",
])

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
for await (const manifestPath of new Bun.Glob("packages/*/package.json").scan(repositoryRoot)) {
  const directory = dirname(join(repositoryRoot, manifestPath))
  const manifest = (await Bun.file(join(repositoryRoot, manifestPath)).json()) as PackageManifest
  if (!manifest.name) throw new Error(`${manifestPath}: package name is required`)
  packages.push({ directory, manifest, name: manifest.name })
}

const packagesByName = new Map(packages.map((workspacePackage) => [workspacePackage.name, workspacePackage]))
for (const name of publishablePackageNames) {
  const workspacePackage = packagesByName.get(name)
  if (!workspacePackage || workspacePackage.manifest.private) {
    throw new Error(`${name}: expected an independent publishable package`)
  }
}

const graph = new Map<string, Set<string>>()
for (const workspacePackage of packages) {
  const runtimeDependencies = {
    ...workspacePackage.manifest.dependencies,
    ...workspacePackage.manifest.optionalDependencies,
    ...workspacePackage.manifest.peerDependencies,
  }
  graph.set(
    workspacePackage.name,
    new Set(Object.keys(runtimeDependencies).filter((dependency) => packagesByName.has(dependency))),
  )

  const validateSpecifier = (sourcePath: string, specifier: string) => {
    const absoluteSourcePath = join(workspacePackage.directory, sourcePath)
    if (specifier.startsWith(".") && leavesPackage(absoluteSourcePath, specifier, workspacePackage.directory)) {
      throw new Error(`${sourcePath}: relative import escapes ${workspacePackage.name}: ${specifier}`)
    }
    if (
      workspacePackage.name !== "@convax/agent-runtime" &&
      (specifier === "opencode-ai" || specifier.startsWith("opencode-ai/") || specifier.startsWith("@opencode-ai/"))
    ) {
      throw new Error(`${sourcePath}: OpenCode imports must stay behind @convax/agent-runtime`)
    }

    const dependencyPackage = packages.find(
      (candidate) => specifier === candidate.name || specifier.startsWith(`${candidate.name}/`),
    )
    if (!dependencyPackage || dependencyPackage.name === workspacePackage.name) return
    if (!(dependencyPackage.name in runtimeDependencies)) {
      throw new Error(`${sourcePath}: ${dependencyPackage.name} must be a runtime dependency of ${workspacePackage.name}`)
    }

    const suffix = specifier.slice(dependencyPackage.name.length)
    const subpath = suffix ? `.${suffix}` : "."
    if (!matchesExport(dependencyPackage.manifest.exports, subpath)) {
      throw new Error(`${sourcePath}: ${specifier} is not a public export of ${dependencyPackage.name}`)
    }
  }

  for (const sourceRoot of ["src", "test"]) {
    for await (const sourcePath of new Bun.Glob(`${sourceRoot}/**/*.{ts,tsx,js,jsx,mjs,cjs}`).scan(
      workspacePackage.directory,
    )) {
      const source = await Bun.file(join(workspacePackage.directory, sourcePath)).text()
      const specifiers = [
        ...source.matchAll(/(?:from\s*|import\s*\(\s*|require(?:\.resolve)?\s*\(\s*)["']([^"']+)["']/g),
        ...source.matchAll(/(?:^|[;\n])\s*import\s*["']([^"']+)["']/g),
      ].map((match) => match[1])
      for (const specifier of specifiers) validateSpecifier(sourcePath, specifier)
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

console.log(`package boundary check passed: ${packages.length} packages, no private imports or dependency cycles`)
