import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dir, "..")
const result = await Bun.build({
  entrypoints: [
    resolve(packageRoot, "src/index.ts"),
    resolve(packageRoot, "src/contracts.ts"),
    resolve(packageRoot, "src/drag.ts"),
    resolve(packageRoot, "src/identity.ts"),
    resolve(packageRoot, "src/project-uri.ts"),
  ],
  outdir: resolve(packageRoot, "dist"),
  root: resolve(packageRoot, "src"),
  target: "browser",
  format: "esm",
  packages: "external",
  external: ["@convax/*"],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  minify: true,
  keepNames: true,
  sourcemap: "linked",
  naming: "[dir]/[name].[ext]",
})

if (!result.success) throw new AggregateError(result.logs, "Failed to build @convax/project-files")
