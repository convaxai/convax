import { chmod } from "node:fs/promises"
import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dir, "..")
const builds = [
  { entry: "src/index.ts", target: "browser" as const },
  { entry: "src/generator.ts", target: "node" as const },
  { entry: "src/cli.ts", target: "node" as const },
]

for (const build of builds) {
  const result = await Bun.build({
    entrypoints: [resolve(packageRoot, build.entry)],
    outdir: resolve(packageRoot, "dist"),
    root: resolve(packageRoot, "src"),
    target: build.target,
    format: "esm",
    packages: "external",
    minify: false,
    sourcemap: "linked",
    naming: "[dir]/[name].[ext]",
  })
  if (!result.success) {
    throw new AggregateError(result.logs, `Failed to build ${build.entry}`)
  }
}

const cliPath = resolve(packageRoot, "dist/cli.js")
const cli = await Bun.file(cliPath).text()
if (!cli.startsWith("#!")) {
  await Bun.write(cliPath, `#!/usr/bin/env node\n${cli}`)
}
await chmod(cliPath, 0o755)
