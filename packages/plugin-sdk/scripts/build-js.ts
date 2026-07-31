import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dir, "..")
const result = await Bun.build({
  entrypoints: [
    resolve(packageRoot, "src/index.ts"),
    resolve(packageRoot, "src/client.ts"),
    resolve(packageRoot, "src/pet.ts"),
    resolve(packageRoot, "src/pet-client.ts"),
  ],
  outdir: resolve(packageRoot, "dist"),
  root: resolve(packageRoot, "src"),
  target: "browser",
  format: "esm",
  packages: "external",
  minify: false,
  sourcemap: "linked",
})

if (!result.success) throw new AggregateError(result.logs, "Failed to build @convax/plugin-sdk")
