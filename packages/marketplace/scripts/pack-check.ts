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

const packageRoot = resolve(import.meta.dir, "..")
const temporaryRoot = await mkdtemp(join(tmpdir(), "convax-marketplace-pack-check-"))
try {
  const tarballRoot = join(temporaryRoot, "tarballs")
  const consumerRoot = join(temporaryRoot, "consumer")
  await mkdir(tarballRoot)
  await mkdir(consumerRoot)
  const marketplaceTarball = await pack(packageRoot, tarballRoot)
  await writeFile(
    join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: { "@convax/marketplace": `file:${marketplaceTarball}` },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(consumerRoot, "index.ts"),
    `import { BUILTIN_SOURCE_IDENTITY, builtinSourceKey, parseRegistryV2 } from "@convax/marketplace"
import type { RegistryV2 } from "@convax/marketplace/schemas"
import { OFFICIAL_SERVER_SCHEMA_SHA256 } from "@convax/marketplace/server-schema"
import { parseBuiltinBundleArchive } from "@convax/marketplace/builtin-archive"
void [BUILTIN_SOURCE_IDENTITY, builtinSourceKey, parseRegistryV2, OFFICIAL_SERVER_SCHEMA_SHA256, parseBuiltinBundleArchive]
const registry: RegistryV2 | undefined = undefined
void registry
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
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
