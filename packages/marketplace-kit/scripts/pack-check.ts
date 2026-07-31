import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`${command.join(" ")} failed with exit code ${exitCode}`)
}

async function pack(packageRoot: string, destination: string): Promise<string> {
  const before = new Set(await readdir(destination))
  await run(["bun", "pm", "pack", "--destination", destination], packageRoot)
  const tarballs = (await readdir(destination)).filter((name) => name.endsWith(".tgz") && !before.has(name))
  if (tarballs.length !== 1) throw new Error(`expected one packed tarball for ${packageRoot}`)
  return join(destination, tarballs[0])
}

async function assertPackedDependency(tarball: string, name: string, expected: string): Promise<void> {
  const child = Bun.spawn(["tar", "-xOf", tarball, "package/package.json"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`cannot inspect packed manifest: ${stderr}`)
  const manifest: unknown = JSON.parse(stdout)
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("packed manifest must be an object")
  }
  const dependencies = Reflect.get(manifest, "dependencies")
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    throw new Error("packed manifest must declare dependencies")
  }
  const actual = Reflect.get(dependencies, name)
  if (actual !== expected || (typeof actual === "string" && actual.startsWith("workspace:"))) {
    throw new Error(`packed dependency ${name} must be ${expected}, received ${String(actual)}`)
  }
}

async function assertPackedLockInputParser(cliPath: string, cwd: string): Promise<void> {
  const child = Bun.spawn(
    [
      "bun",
      cliPath,
      "lock-input",
      "--catalog",
      "missing-catalog",
      "--builtin",
      "missing-builtin",
      "--out",
      "missing-output.json",
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  )
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (exitCode === 0) throw new Error("packed lock-input parser unexpectedly accepted missing fixture directories")
  if (stderr.includes("lock-input requires --catalog, --builtin, and --out")) {
    throw new Error("packed lock-input bin dropped its first named option")
  }
}

const packageRoot = resolve(import.meta.dir, "..")
const marketplaceRoot = resolve(packageRoot, "../marketplace")
const pluginApiRoot = resolve(packageRoot, "../plugin-api")
const pluginSdkRoot = resolve(packageRoot, "../plugin-sdk")
const temporaryRoot = await mkdtemp(join(tmpdir(), "convax-marketplace-kit-pack-check-"))
try {
  const tarballRoot = join(temporaryRoot, "tarballs")
  const consumerRoot = join(temporaryRoot, "consumer")
  await mkdir(tarballRoot)
  await mkdir(consumerRoot)
  const marketplaceTarball = await pack(marketplaceRoot, tarballRoot)
  const pluginApiTarball = await pack(pluginApiRoot, tarballRoot)
  const pluginSdkTarball = await pack(pluginSdkRoot, tarballRoot)
  const kitTarball = await pack(packageRoot, tarballRoot)
  await assertPackedDependency(kitTarball, "@convax/marketplace", "^0.2.1")
  await assertPackedDependency(kitTarball, "@convax/plugin-api", "^2.0.0")
  await assertPackedDependency(kitTarball, "@convax/plugin-sdk", "^0.1.1")
  await writeFile(
    join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          "@convax/marketplace": `file:${marketplaceTarball}`,
          "@convax/marketplace-kit": `file:${kitTarball}`,
          "@convax/plugin-api": `file:${pluginApiTarball}`,
          "@convax/plugin-sdk": `file:${pluginSdkTarball}`,
        },
        overrides: {
          "@convax/marketplace": `file:${marketplaceTarball}`,
          "@convax/plugin-api": `file:${pluginApiTarball}`,
          "@convax/plugin-sdk": `file:${pluginSdkTarball}`,
        },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(consumerRoot, "index.ts"),
    `import {
  assertSelectiveMarketplaceClosure,
  buildMarketplace,
  createMarketplaceStarter,
  parseMarketplaceSelectionContext,
  releaseTagForPackage,
} from "@convax/marketplace-kit"
import type {
  BuildMarketplaceOptions,
  MarketplaceSelectionContext,
} from "@convax/marketplace-kit"
import { runMarketplaceCli } from "@convax/marketplace-kit/cli"
const options: BuildMarketplaceOptions = {
  root: ".",
  outDir: "dist",
  previousDescriptorPath: "previous-marketplace.json",
  previousRegistryPath: "previous-registry.json",
  previousShowcasePath: "previous-showcase.json",
  publishSelections: [{
    kind: "plugin",
    id: "example",
    version: "1.1.0",
    previousVersion: "1.0.0",
    releaseTag: "plugin-example-v1.1.0",
  }],
  fetchArtifact: async () => new Uint8Array([1]),
}
const context: MarketplaceSelectionContext | undefined = undefined
void [
  assertSelectiveMarketplaceClosure,
  buildMarketplace,
  context,
  createMarketplaceStarter,
  options,
  parseMarketplaceSelectionContext,
  releaseTagForPackage,
  runMarketplaceCli,
]
`,
  )
  await writeFile(
    join(consumerRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: "ES2022",
          types: [],
        },
        include: ["index.ts"],
      },
      null,
      2,
    )}\n`,
  )
  await run(["bun", "install", "--ignore-scripts"], consumerRoot)
  await run([join(packageRoot, "node_modules/.bin/tsc"), "-p", "tsconfig.json"], consumerRoot)
  await assertPackedLockInputParser(
    join(consumerRoot, "node_modules/@convax/marketplace-kit/dist/cli.js"),
    consumerRoot,
  )
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
