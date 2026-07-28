import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

interface PublishableManifest {
  dependencies?: Record<string, string>
  exports?: Record<string, unknown>
  files?: string[]
  name?: string
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  private?: boolean
  scripts?: Record<string, string>
  version?: string
}

interface PublishablePackage {
  directory: string
  manifest: PublishableManifest
  name: string
}

const stylePackageDirectories = new Set(["canvas", "project", "ui"])
const repositoryRoot = join(import.meta.dir, "..")
const forbiddenPackEntries = [".turbo/", "src/", "test/", "tsconfig.json", "tsconfig.build.json"]

const publishablePackages: PublishablePackage[] = []
for await (const manifestPath of new Bun.Glob("packages/*/package.json").scan(repositoryRoot)) {
  const packageDirectory = dirname(join(repositoryRoot, manifestPath))
  const manifest = await Bun.file(join(repositoryRoot, manifestPath)).json() as PublishableManifest
  if (manifest.private) continue
  if (!manifest.name) throw new Error(`${manifestPath}: publishable package name is required`)
  publishablePackages.push({
    directory: basename(packageDirectory),
    manifest,
    name: manifest.name,
  })
}
publishablePackages.sort((left, right) => left.name.localeCompare(right.name))

const packagesByName = new Map(publishablePackages.map((workspacePackage) => [workspacePackage.name, workspacePackage]))
const packageDirectories = publishablePackages.map((workspacePackage) => workspacePackage.directory)
const standaloneBuildOrder: string[] = []
const built = new Set<string>()
const building = new Set<string>()

function scheduleBuild(workspacePackage: PublishablePackage) {
  if (built.has(workspacePackage.name)) return
  if (building.has(workspacePackage.name)) throw new Error(`publishable package dependency cycle at ${workspacePackage.name}`)
  building.add(workspacePackage.name)
  const dependencies = {
    ...workspacePackage.manifest.dependencies,
    ...workspacePackage.manifest.optionalDependencies,
    ...workspacePackage.manifest.peerDependencies,
  }
  for (const dependencyName of Object.keys(dependencies).sort()) {
    const dependency = packagesByName.get(dependencyName)
    if (dependency) scheduleBuild(dependency)
  }
  building.delete(workspacePackage.name)
  built.add(workspacePackage.name)
  standaloneBuildOrder.push(workspacePackage.directory)
}
for (const workspacePackage of publishablePackages) scheduleBuild(workspacePackage)

const workspaceVersions = new Map(
  publishablePackages.flatMap((workspacePackage) =>
    workspacePackage.manifest.version ? [[workspacePackage.name, workspacePackage.manifest.version] as const] : [],
  ),
)

for (const directory of packageDirectories) {
  const cwd = join(repositoryRoot, "packages", directory)
  const clean = Bun.spawnSync({ cmd: [process.execPath, "run", "clean"], cwd, stdout: "pipe", stderr: "pipe" })
  if (clean.exitCode !== 0) {
    throw new Error(`${directory}: clean failed\n${clean.stdout.toString()}\n${clean.stderr.toString()}`)
  }
}

function collectExportTargets(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (!value || typeof value !== "object") return []
  return Object.values(value).flatMap(collectExportTargets)
}

const publicTypeEntrypoints = new Set<string>()

async function registerPublicTypeEntrypoints(manifest: PublishableManifest, cwd: string) {
  if (!manifest.name || !manifest.exports) return
  for (const [exportPath, exportValue] of Object.entries(manifest.exports)) {
    const typeTargets = collectExportTargets(exportValue).filter((target) => target.endsWith(".d.ts"))
    for (const target of typeTargets) {
      const exportWildcard = exportPath.indexOf("*")
      const targetWildcard = target.indexOf("*")
      if (exportWildcard < 0 && targetWildcard < 0) {
        publicTypeEntrypoints.add(`${manifest.name}${exportPath === "." ? "" : exportPath.slice(1)}`)
        continue
      }
      if (exportWildcard < 0 || targetWildcard < 0) {
        throw new Error(`${manifest.name}: type export wildcards do not align: ${exportPath} -> ${target}`)
      }
      const pattern = target.slice(2)
      const patternWildcard = pattern.indexOf("*")
      const prefix = pattern.slice(0, patternWildcard)
      const suffix = pattern.slice(patternWildcard + 1)
      for await (const sourcePath of new Bun.Glob(pattern).scan(cwd)) {
        const normalizedSourcePath = sourcePath.replaceAll("\\", "/")
        const valueEnd = suffix ? normalizedSourcePath.length - suffix.length : normalizedSourcePath.length
        const wildcardValue = normalizedSourcePath.slice(prefix.length, valueEnd)
        const resolvedExport = exportPath.replace("*", wildcardValue)
        publicTypeEntrypoints.add(`${manifest.name}${resolvedExport.slice(1)}`)
      }
    }
  }
}

for (const directory of standaloneBuildOrder) {
  const cwd = join(repositoryRoot, "packages", directory)
  const manifest = await Bun.file(join(cwd, "package.json")).json() as PublishableManifest

  const build = Bun.spawnSync({ cmd: [process.execPath, "run", "build"], cwd, stdout: "pipe", stderr: "pipe" })
  if (build.exitCode !== 0) {
    throw new Error(`${manifest.name}: standalone build failed\n${build.stdout.toString()}\n${build.stderr.toString()}`)
  }

  if (!manifest.name || manifest.private || manifest.version === "0.0.0") {
    throw new Error(`${directory}: package must have a publishable name and version`)
  }
  if (!manifest.files?.includes("dist") || !manifest.scripts?.build || !manifest.exports) {
    throw new Error(`${manifest.name}: package must publish built dist exports`)
  }
  if (!existsSync(join(cwd, "dist", "index.js")) || !existsSync(join(cwd, "dist", "index.d.ts"))) {
    throw new Error(`${manifest.name}: build artifacts are missing`)
  }
  for (const target of collectExportTargets(manifest.exports)) {
    if (!target.startsWith("./dist/")) {
      throw new Error(`${manifest.name}: export target is outside dist: ${target}`)
    }
    if (target.includes("*")) {
      let matched = false
      for await (const _ of new Bun.Glob(target.slice(2)).scan(cwd)) {
        matched = true
        break
      }
      if (!matched) throw new Error(`${manifest.name}: wildcard export target has no matches: ${target}`)
    } else if (!existsSync(join(cwd, target))) {
      throw new Error(`${manifest.name}: export target is missing: ${target}`)
    }
  }
  await registerPublicTypeEntrypoints(manifest, cwd)
  if (stylePackageDirectories.has(directory)) {
    for (const peer of ["react", "react-dom"]) {
      if (!manifest.peerDependencies?.[peer] || manifest.peerDependencies[peer].includes("catalog:")) {
        throw new Error(`${manifest.name}: ${peer} must be declared as a publishable peer dependency`)
      }
    }
    if (manifest.exports?.["./styles.css"] !== "./dist/styles.css") {
      throw new Error(`${manifest.name}: package styles must be exported from dist`)
    }
    const styles = await Bun.file(join(cwd, "dist", "styles.css")).text()
    if (
      styles.length < 1_000 ||
      !styles.includes("@layer utilities") ||
      !styles.includes("--background:") ||
      /@(source|theme)\b|@import\s+["']tailwindcss/.test(styles)
    ) {
      throw new Error(`${manifest.name}: package styles must be precompiled for non-Tailwind consumers`)
    }
    if (directory === "canvas" && !styles.includes(".convax-canvas")) {
      throw new Error(`${manifest.name}: package styles are missing the Canvas layout rules`)
    }
    if (directory === "ui") {
      const theme = await Bun.file(join(cwd, "dist", "theme.css")).text()
      if (!theme.includes("@theme inline") || !theme.includes(":root")) {
        throw new Error(`${manifest.name}: raw Tailwind theme export is incomplete`)
      }
    }
  }
  for (const [dependency, version] of Object.entries(manifest.dependencies ?? {})) {
    if (dependency.startsWith("@convax/") && version !== "workspace:^") {
      throw new Error(`${manifest.name}: internal dependency must publish as a compatible semver range: ${dependency}@${version}`)
    }
  }
  for await (const testDeclaration of new Bun.Glob("**/*.{test,spec}.d.ts").scan(join(cwd, "dist"))) {
    throw new Error(`${manifest.name}: test declaration leaked into dist: ${testDeclaration}`)
  }

  const packDirectory = mkdtempSync(join(tmpdir(), "convax-pack-"))
  try {
    const pack = Bun.spawnSync({
      cmd: [process.execPath, "pm", "pack", "--ignore-scripts", "--destination", packDirectory, "--quiet"],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = `${pack.stdout.toString()}\n${pack.stderr.toString()}`
    if (pack.exitCode !== 0) throw new Error(`${manifest.name}: pack failed\n${output}`)

    const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith(".tgz"))
    if (tarballs.length !== 1) {
      throw new Error(`${manifest.name}: expected one package tarball, received ${tarballs.length}`)
    }
    const tarball = join(packDirectory, tarballs[0])
    const archive = new Bun.Archive(Bun.gunzipSync(await Bun.file(tarball).bytes()))
    const packedFiles = await archive.files()
    const packedEntries = [...packedFiles.keys()].map((entry) => entry.replace(/^package\//, ""))
    const leaked = forbiddenPackEntries.find((forbidden) =>
      packedEntries.some((entry) => entry === forbidden || entry.startsWith(forbidden)),
    )
    if (leaked) throw new Error(`${manifest.name}: forbidden path was packed: ${leaked}`)

    const packedManifestFile = packedFiles.get("package/package.json")
    if (!packedManifestFile) throw new Error(`${manifest.name}: packed manifest is missing`)
    const packedManifest = JSON.parse(await packedManifestFile.text()) as Record<string, unknown>
    const packedManifestText = JSON.stringify(packedManifest)
    if (/"(?:workspace|catalog):/.test(packedManifestText)) {
      throw new Error(`${manifest.name}: packed manifest contains an unresolved workspace or catalog protocol`)
    }
    const packedPeerDependencies = (packedManifest.peerDependencies ?? {}) as Record<string, string>
    for (const [peer, sourceVersion] of Object.entries(manifest.peerDependencies ?? {})) {
      if (packedPeerDependencies[peer] !== sourceVersion) {
        throw new Error(`${manifest.name}: packed peer dependency changed unexpectedly: ${peer}`)
      }
    }
    const packedDependencies = (packedManifest.dependencies ?? {}) as Record<string, string>
    for (const [dependency, sourceVersion] of Object.entries(manifest.dependencies ?? {})) {
      if (!dependency.startsWith("@convax/") || sourceVersion !== "workspace:^") continue
      const dependencyVersion = workspaceVersions.get(dependency)
      if (!dependencyVersion || packedDependencies[dependency] !== `^${dependencyVersion}`) {
        throw new Error(`${manifest.name}: packed dependency was not rewritten to ^${dependencyVersion}: ${dependency}`)
      }
    }
  } finally {
    rmSync(packDirectory, { force: true, recursive: true })
  }
  console.log(`pack smoke passed: ${manifest.name}@${manifest.version}`)
}

const consumerDirectory = mkdtempSync(join(tmpdir(), "convax-consumer-"))
try {
  const packageScopeDirectory = join(consumerDirectory, "node_modules", "@convax")
  mkdirSync(packageScopeDirectory, { recursive: true })
  for (const workspacePackage of publishablePackages) {
    const linkType = process.platform === "win32" ? "junction" : "dir"
    const packageLink = workspacePackage.name.startsWith("@convax/")
      ? join(packageScopeDirectory, workspacePackage.name.slice("@convax/".length))
      : join(consumerDirectory, "node_modules", workspacePackage.name)
    symlinkSync(
      join(repositoryRoot, "packages", workspacePackage.directory),
      packageLink,
      linkType,
    )
  }

  for (const workspacePackage of publishablePackages) {
    if (!publicTypeEntrypoints.has(workspacePackage.name)) {
      throw new Error(`${workspacePackage.name}: public root TypeScript entrypoint is missing from external consumer smoke`)
    }
  }
  const sortedTypeEntrypoints = [...publicTypeEntrypoints].sort()
  const consumerSource = sortedTypeEntrypoints
    .map((specifier, index) => `import * as package${index} from ${JSON.stringify(specifier)}`)
    .join("\n")
  await Bun.write(join(consumerDirectory, "index.ts"), `${consumerSource}\nvoid [${sortedTypeEntrypoints.map((_, index) => `package${index}`).join(", ")}]\n`)
  await Bun.write(
    join(consumerDirectory, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          jsx: "react-jsx",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ES2022",
          types: [],
        },
        include: ["index.ts"],
      },
      null,
      2,
    ),
  )
  const typecheck = Bun.spawnSync({
    cmd: [join(repositoryRoot, "packages", "ui", "node_modules", ".bin", "tsc"), "--project", "tsconfig.json"],
    cwd: consumerDirectory,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (typecheck.exitCode !== 0) {
    throw new Error(`packed declaration consumer check failed\n${typecheck.stdout.toString()}\n${typecheck.stderr.toString()}`)
  }
} finally {
  rmSync(consumerDirectory, { force: true, recursive: true })
}
console.log("package declaration consumer check passed: all public TypeScript entrypoints")
