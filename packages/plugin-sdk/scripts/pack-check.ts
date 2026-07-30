import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"

const packageRoot = resolve(import.meta.dir, "..")
const temporaryRoot = mkdtempSync(join(tmpdir(), "convax-plugin-sdk-pack-"))

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
    "package/dist/client.d.ts",
    "package/dist/client.js",
    "package/dist/index.d.ts",
    "package/dist/index.js",
  ]) {
    if (!entries.includes(required)) throw new Error(`packed artifact is missing ${required}`)
  }
  if (entries.some((entry) => entry.startsWith("package/src/"))) {
    throw new Error("source leaked into the published package")
  }

  const consumerRoot = join(temporaryRoot, "consumer")
  const sdkRoot = join(consumerRoot, "node_modules", "@convax", "plugin-sdk")
  const apiRoot = join(consumerRoot, "node_modules", "@convax", "plugin-api")
  for (const [entry, file] of files) {
    if (!entry.startsWith("package/")) continue
    const relative = entry.slice("package/".length)
    if (!relative || relative.includes("..")) throw new Error(`unsafe packed path: ${entry}`)
    const target = join(sdkRoot, relative)
    mkdirSync(dirname(target), { recursive: true })
    await Bun.write(target, await file.bytes())
  }
  const pluginApiDist = resolve(packageRoot, "../plugin-api/dist")
  for await (const entry of new Bun.Glob("**/*").scan({ cwd: pluginApiDist, onlyFiles: true })) {
    const target = join(apiRoot, "dist", entry)
    mkdirSync(dirname(target), { recursive: true })
    await Bun.write(target, await Bun.file(join(pluginApiDist, entry)).bytes())
  }
  await Bun.write(
    join(apiRoot, "package.json"),
    JSON.stringify({
      name: "@convax/plugin-api",
      type: "module",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
    }),
  )
  await Bun.write(
    join(consumerRoot, "index.ts"),
    [
      'import { parsePluginCapabilityDeclaration, parsePluginManifestV8, parsePortablePluginCanvasUiContribution, renderPluginCapabilityReference, type PortablePluginManifestV8 } from "@convax/plugin-sdk"',
      'import { createPluginHostClient, pluginHostProtocolV8, type PluginHostMessagePort } from "@convax/plugin-sdk/client"',
      "const declaration = parsePluginCapabilityDeclaration({ exports: [], imports: { required: [], optional: [] } })",
      "void renderPluginCapabilityReference(declaration)",
      "void parsePortablePluginCanvasUiContribution({ commands: [], menus: [], toolbar: [] })",
      'const manifest: PortablePluginManifestV8 = parsePluginManifestV8({ capabilities: [], contributes: { canvas: { renderer: { create: true } } }, description: "External consumer", entry: "index.html", hostApi: { major: 1, optional: [], required: ["host.context.get"] }, id: "external-consumer", name: "External Consumer", schema: "convax.plugin/8", version: "1.0.0" })',
      "void manifest",
      "declare const port: PluginHostMessagePort",
      "const client = createPluginHostClient({ manifest, port })",
      "void client.closed",
      'void client.getHostApiAvailability("host.context.get")',
      'void client.requireHostApi("host.context.get")',
      "void pluginHostProtocolV8",
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
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
