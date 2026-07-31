import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
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

const packageRoot = resolve(import.meta.dir, "..")
const kitRoot = resolve(packageRoot, "../marketplace-kit")
const marketplaceRoot = resolve(packageRoot, "../marketplace")
const pluginApiRoot = resolve(packageRoot, "../plugin-api")
const pluginSdkRoot = resolve(packageRoot, "../plugin-sdk")
const temporaryRoot = await mkdtemp(join(tmpdir(), "create-convax-marketplace-pack-check-"))
try {
  const tarballRoot = join(temporaryRoot, "tarballs")
  const consumerRoot = join(temporaryRoot, "consumer")
  await mkdir(tarballRoot)
  await mkdir(consumerRoot)
  const marketplaceTarball = await pack(marketplaceRoot, tarballRoot)
  const pluginApiTarball = await pack(pluginApiRoot, tarballRoot)
  const pluginSdkTarball = await pack(pluginSdkRoot, tarballRoot)
  const kitTarball = await pack(kitRoot, tarballRoot)
  const createTarball = await pack(packageRoot, tarballRoot)
  await assertPackedDependency(kitTarball, "@convax/marketplace", "^0.2.1")
  await assertPackedDependency(kitTarball, "@convax/plugin-api", "^2.0.0")
  await assertPackedDependency(kitTarball, "@convax/plugin-sdk", "^0.1.0")
  await assertPackedDependency(createTarball, "@convax/marketplace-kit", "^0.2.1")
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
          "create-convax-marketplace": `file:${createTarball}`,
        },
        overrides: {
          "@convax/marketplace": `file:${marketplaceTarball}`,
          "@convax/marketplace-kit": `file:${kitTarball}`,
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
    `import { create, type CreateMarketplaceOptions } from "create-convax-marketplace"
void create
const options: CreateMarketplaceOptions | undefined = undefined
void options
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
  const generatedRoot = join(consumerRoot, "generated-marketplace")
  await run(
    [
      "bun",
      join(consumerRoot, "node_modules/create-convax-marketplace/dist/cli.js"),
      generatedRoot,
      "--owner",
      "external-consumer",
      "--starter",
      "mcp-server",
      "--skip-install",
    ],
    consumerRoot,
  )
  const generatedServer = await stat(join(generatedRoot, "packages/mcp-servers/example-mcp/package/server.json"))
  if (!generatedServer.isFile()) throw new Error("packed create CLI did not emit its selected starter")
  const generatedPackage = await stat(join(generatedRoot, "packages/mcp-servers/example-mcp/convax-package.json"))
  if (!generatedPackage.isFile()) throw new Error("packed create CLI did not emit convax.package/2 metadata")
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
