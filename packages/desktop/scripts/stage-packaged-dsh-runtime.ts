import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, relative, resolve, sep } from "node:path"

const desktopDirectory = join(import.meta.dir, "..")
const repositoryRoot = resolve(desktopDirectory, "../..")
const agentRuntimePackageJson = join(repositoryRoot, "packages", "agent-runtime", "package.json")
const agentRuntimeDirectory = dirname(agentRuntimePackageJson)
const utilitySource = join(desktopDirectory, "src", "main", "dsh-project-utility.ts")
const destinationDirectory = join(desktopDirectory, ".packaging", "runtime", "dsh")

interface PackageMetadata {
  dependencies?: Record<string, string>
  license?: string
  name?: string
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  version?: string
}

async function metadata(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as PackageMetadata
}

function isInsideNodeModules(sourceRoot: string, path: string) {
  const nested = relative(sourceRoot, path).split(sep)
  return nested.includes("node_modules")
}

function resolvePackageJson(packageName: string, fromPackageJson: string) {
  const require = createRequire(fromPackageJson)
  let current: string
  try {
    const candidate = require.resolve(`${packageName}/package.json`)
    const value = require(candidate) as PackageMetadata
    if (value.name === packageName) return candidate
    current = dirname(candidate)
  } catch {
    current = dirname(require.resolve(packageName))
  }
  for (;;) {
    const candidate = join(current, "package.json")
    try {
      const value = require(candidate) as PackageMetadata
      if (value.name === packageName) return candidate
    } catch {
      // Continue to the owning package directory.
    }
    const parent = dirname(current)
    if (parent === current) throw new Error(`Could not locate package.json for ${packageName}`)
    current = parent
  }
}

export async function stagePackagedDshRuntime() {
  const root = await metadata(agentRuntimePackageJson)
  const roots = Object.keys(root.dependencies ?? {}).filter((name) => name.startsWith("@deepseek-ai/"))
  await mkdir(dirname(destinationDirectory), { recursive: true })
  const staging = await mkdtemp(join(dirname(destinationDirectory), ".dsh-staging-"))
  try {
    const placements = new Map<string, string>()
    const versions = new Map<string, Set<string>>()
    const rootNodeModules = join(staging, "node_modules")
    const install = async (
      name: string,
      from: string,
      parentNodeModules = rootNodeModules,
      ancestry = new Set<string>(),
    ): Promise<void> => {
      const packageJson = resolvePackageJson(name, from)
      const value = await metadata(packageJson)
      if (value.name !== name || !value.version) throw new Error(`Invalid DSH runtime package: ${name}`)
      const signature = `${name}@${value.version}`
      if (ancestry.has(signature)) return
      const rootTarget = join(rootNodeModules, ...name.split("/"))
      const rootVersion = placements.get(rootTarget)
      const target =
        rootVersion === undefined || rootVersion === value.version
          ? rootTarget
          : join(parentNodeModules, ...name.split("/"))
      const targetVersion = placements.get(target)
      if (targetVersion !== undefined) {
        if (targetVersion !== value.version) {
          throw new Error(`Could not place conflicting ${name} versions ${targetVersion} and ${value.version}`)
        }
        return
      }
      placements.set(target, value.version)
      const seenVersions = versions.get(name) ?? new Set<string>()
      seenVersions.add(value.version)
      versions.set(name, seenVersions)
      const source = dirname(packageJson)
      await cp(source, target, {
        dereference: true,
        filter: (path) => path === source || !isInsideNodeModules(source, path),
        recursive: true,
      })
      const dependencies = { ...value.dependencies, ...value.optionalDependencies, ...value.peerDependencies }
      const nextAncestry = new Set(ancestry).add(signature)
      for (const dependency of Object.keys(dependencies).sort()) {
        try {
          resolvePackageJson(dependency, packageJson)
          await install(dependency, packageJson, join(target, "node_modules"), nextAncestry)
        } catch (error) {
          if (value.dependencies?.[dependency]) {
            throw new Error(`Missing packaged dependency ${dependency} for ${name}`, { cause: error })
          }
        }
      }
    }
    for (const name of roots.sort()) await install(name, agentRuntimePackageJson)
    const agentRuntime = await metadata(agentRuntimePackageJson)
    const stagedAgentRuntime = join(rootNodeModules, "@convax", "agent-runtime")
    await mkdir(stagedAgentRuntime, { recursive: true })
    await cp(join(agentRuntimeDirectory, "dist"), join(stagedAgentRuntime, "dist"), { recursive: true })
    await writeFile(
      join(stagedAgentRuntime, "package.json"),
      `${JSON.stringify(
        {
          exports: {
            "./node": {
              default: "./dist/node/index.js",
              import: "./dist/node/index.js",
            },
            "./node/deepseek-harness-agent-runtime": {
              default: "./dist/node/deepseek-harness-agent-runtime.js",
              import: "./dist/node/deepseek-harness-agent-runtime.js",
            },
            "./node/host-message-port-carrier": {
              default: "./dist/node/host-message-port-carrier.js",
              import: "./dist/node/host-message-port-carrier.js",
            },
            "./node/local-tool-server": {
              default: "./dist/node/local-tool-server.js",
              import: "./dist/node/local-tool-server.js",
            },
          },
          name: "@convax/agent-runtime",
          type: "module",
          version: agentRuntime.version,
        },
        null,
        2,
      )}\n`,
      "utf8",
    )
    const utilityBuild = await Bun.build({
      entrypoints: [utilitySource],
      external: ["@convax/agent-runtime"],
      format: "esm",
      minify: true,
      naming: "dsh-project-utility.js",
      outdir: staging,
      packages: "external",
      target: "node",
    })
    if (!utilityBuild.success) {
      throw new Error(`Could not build the DSH utility entry: ${utilityBuild.logs.join("\n")}`)
    }
    await writeFile(
      join(staging, "package.json"),
      `${JSON.stringify({ name: "@convax/packaged-dsh-runtime", private: true, type: "module" }, null, 2)}\n`,
      "utf8",
    )
    await writeFile(
      join(staging, "runtime.json"),
      `${JSON.stringify(
        {
          packages: Object.fromEntries(
            [...versions]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([name, values]) => [name, [...values].sort()]),
          ),
          schema: "convax.packaged-dsh-runtime/1",
        },
        null,
        2,
      )}\n`,
      "utf8",
    )
    await rm(destinationDirectory, { force: true, recursive: true })
    await rename(staging, destinationDirectory)
  } catch (error) {
    await rm(staging, { force: true, recursive: true })
    throw error
  }
  const staged = JSON.parse(await readFile(join(destinationDirectory, "runtime.json"), "utf8")) as {
    packages: Record<string, string[]>
  }
  console.log(`Staged ${Object.keys(staged.packages).length} packages for the DSH utility runtime`)
  return destinationDirectory
}

if (import.meta.main) await stagePackagedDshRuntime()
