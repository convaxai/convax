import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"

const packageRoot = resolve(import.meta.dir, "..")
const temporaryRoot = mkdtempSync(join(tmpdir(), "convax-plugin-api-pack-"))

try {
  const pack = Bun.spawnSync({
    cmd: [process.execPath, "pm", "pack", "--ignore-scripts", "--destination", temporaryRoot, "--quiet"],
    cwd: packageRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (pack.exitCode !== 0) {
    throw new Error(`pack failed\n${pack.stdout.toString()}\n${pack.stderr.toString()}`)
  }
  const tarballs = readdirSync(temporaryRoot).filter((entry) => entry.endsWith(".tgz"))
  if (tarballs.length !== 1) throw new Error(`expected one tarball, received ${tarballs.length}`)
  const archive = new Bun.Archive(Bun.gunzipSync(await Bun.file(join(temporaryRoot, tarballs[0])).bytes()))
  const files = await archive.files()
  const entries = [...files.keys()].sort()
  for (const required of [
    "package/package.json",
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/dist/generator.js",
    "package/dist/generator.d.ts",
    "package/dist/generated/plugin-api.json",
    "package/dist/generated/plugin-api.md",
  ]) {
    if (!entries.includes(required)) throw new Error(`packed artifact is missing ${required}`)
  }
  if (entries.some((entry) => entry.startsWith("package/src/") || entry.startsWith("package/history/"))) {
    throw new Error("source or compatibility history leaked into the published package")
  }

  const consumerRoot = join(temporaryRoot, "consumer")
  const installedRoot = join(consumerRoot, "node_modules", "@convax", "plugin-api")
  for (const [entry, file] of files) {
    if (!entry.startsWith("package/")) continue
    const relative = entry.slice("package/".length)
    if (!relative || relative.includes("..")) throw new Error(`unsafe packed path: ${entry}`)
    const target = join(installedRoot, relative)
    mkdirSync(dirname(target), { recursive: true })
    await Bun.write(target, await file.bytes())
  }
  await Bun.write(
    join(consumerRoot, "index.ts"),
    [
      'import { PLUGIN_API_CATALOG_ARTIFACT_SCHEMA, PLUGIN_API_CATALOG_VERSION, getPluginApiWireContract, isPluginApiCommitPreserving, parsePluginApiParams, parsePluginApiRemoteFailure, parsePluginApiResult, renderPluginApiReference, type PluginApiId, type PluginApiParams, type PluginApiResult } from "@convax/plugin-api"',
      'import { parsePluginApiCatalogArtifact, renderPluginApiJson } from "@convax/plugin-api/generator"',
      'const id: PluginApiId = "host.context.get"',
      'const prompt: PluginApiParams<"agent.prompt"> = parsePluginApiParams("agent.prompt", { text: "hello" })',
      'const prompted: PluginApiResult<"agent.prompt"> = parsePluginApiResult("agent.prompt", { text: "accepted" })',
      'const remote = parsePluginApiRemoteFailure("agent.prompt", { code: "permission-denied", kind: "api", message: "denied", recoverable: false })',
      "const artifact = parsePluginApiCatalogArtifact(JSON.parse(renderPluginApiJson()))",
      'void [id, prompt, prompted, remote, artifact, PLUGIN_API_CATALOG_ARTIFACT_SCHEMA, getPluginApiWireContract("canvas.resource.image.create"), isPluginApiCommitPreserving("agent.prompt"), PLUGIN_API_CATALOG_VERSION, renderPluginApiReference({ requiredIds: [], optionalIds: [] })]',
      "",
    ].join("\n"),
  )
  await Bun.write(
    join(consumerRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          lib: ["ES2022"],
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
    cmd: [resolve(packageRoot, "node_modules/typescript/bin/tsc"), "-p", consumerRoot],
    cwd: consumerRoot,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (typecheck.exitCode !== 0) {
    throw new Error(
      `external consumer typecheck failed\n${typecheck.stdout.toString()}\n${typecheck.stderr.toString()}`,
    )
  }
  if (!existsSync(join(installedRoot, "dist/generated/plugin-api.json"))) {
    throw new Error("external consumer catalog artifact is missing")
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
