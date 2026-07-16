import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const packageDirectories = ["agent-runtime", "canvas", "project", "project-files", "ui", "workbench"] as const
const standaloneBuildOrder = ["ui", "project-files", "canvas", "project", "workbench", "agent-runtime"] as const
const stylePackageDirectories = new Set(["canvas", "project", "ui"])
const repositoryRoot = join(import.meta.dir, "..")
const forbiddenPackEntries = [".turbo/", "src/", "test/", "tsconfig.json", "tsconfig.build.json"]

const workspaceVersions = new Map<string, string>()
for (const directory of packageDirectories) {
  const manifest = await Bun.file(join(repositoryRoot, "packages", directory, "package.json")).json() as {
    name?: string
    version?: string
  }
  if (manifest.name && manifest.version) workspaceVersions.set(manifest.name, manifest.version)
}

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

for (const directory of standaloneBuildOrder) {
  const cwd = join(repositoryRoot, "packages", directory)
  const manifest = await Bun.file(join(cwd, "package.json")).json() as {
    exports?: Record<string, unknown>
    dependencies?: Record<string, string>
    files?: string[]
    name?: string
    peerDependencies?: Record<string, string>
    private?: boolean
    scripts?: Record<string, string>
    version?: string
  }

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
  for (const directory of packageDirectories) {
    symlinkSync(join(repositoryRoot, "packages", directory), join(packageScopeDirectory, directory), "dir")
  }

  const publicTypeEntrypoints = [
    "@convax/agent-runtime",
    "@convax/agent-runtime/node",
    "@convax/agent-runtime/node/protected-path-plugin",
    "@convax/canvas",
    "@convax/canvas/application",
    "@convax/canvas/core",
    "@convax/canvas/view",
    "@convax/project",
    "@convax/project/canvas",
    "@convax/project/contracts",
    "@convax/project/node",
    "@convax/project-files",
    "@convax/project-files/contracts",
    "@convax/project-files/drag",
    "@convax/ui",
    "@convax/ui/components/button",
    "@convax/ui/components/context-menu",
    "@convax/ui/components/input",
    "@convax/ui/components/tooltip",
    "@convax/ui/lib/utils",
    "@convax/workbench",
  ]
  const consumerSource = publicTypeEntrypoints
    .map((specifier, index) => `import * as package${index} from ${JSON.stringify(specifier)}`)
    .join("\n")
  await Bun.write(join(consumerDirectory, "index.ts"), `${consumerSource}\nvoid [${publicTypeEntrypoints.map((_, index) => `package${index}`).join(", ")}]\n`)
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
