import { mkdirSync } from "node:fs"
import { join } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { build, type Rollup } from "vite"

const packageDirectory = join(import.meta.dir, "..")
const outputDirectory = join(packageDirectory, "dist")
const result = await build({
  build: {
    cssMinify: false,
    minify: false,
    rollupOptions: {
      input: join(packageDirectory, "src", "styles.css"),
    },
    write: false,
  },
  configFile: false,
  logLevel: "error",
  plugins: [tailwindcss()],
  root: packageDirectory,
})

const buildResults = Array.isArray(result) ? result : [result]
const cssAssets = buildResults.flatMap((buildResult) =>
  "output" in buildResult
    ? buildResult.output.filter(
        (output): output is Rollup.OutputAsset => output.type === "asset" && output.fileName.endsWith(".css"),
      )
    : [],
)
if (cssAssets.length !== 1) {
  throw new Error(`@convax/ui: expected one compiled CSS asset, received ${cssAssets.length}`)
}

const styles = String(cssAssets[0].source)
mkdirSync(outputDirectory, { recursive: true })
await Bun.write(join(outputDirectory, "styles.css"), styles)
await Bun.write(join(outputDirectory, "theme.css"), Bun.file(join(packageDirectory, "src", "theme.css")))

console.log(`compiled package CSS: @convax/ui (${styles.length} bytes)`)
