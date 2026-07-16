import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import { build, type Rollup } from "vite"

async function compileStyles(input: string, root: string, themePath?: string): Promise<string> {
  const result = await build({
    build: {
      cssMinify: false,
      minify: false,
      rollupOptions: { input },
      write: false,
    },
    configFile: false,
    logLevel: "error",
    plugins: [tailwindcss()],
    resolve: themePath ? { alias: { "@convax/ui/theme.css": themePath } } : undefined,
    root,
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
    throw new Error(`expected one compiled CSS asset for ${input}, received ${cssAssets.length}`)
  }
  return String(cssAssets[0].source)
}

const packageDirectory = join(import.meta.dir, "..")
const outputDirectory = join(packageDirectory, "dist")
const resolvedUiThemePath = fileURLToPath(import.meta.resolve("@convax/ui/theme.css"))
const uiPackageDirectory = dirname(dirname(resolvedUiThemePath))
const builtUiStylesPath = join(uiPackageDirectory, "dist", "styles.css")
const builtUiThemePath = join(uiPackageDirectory, "dist", "theme.css")
const sourceUiStylesPath = join(uiPackageDirectory, "src", "styles.css")
const sourceUiThemePath = join(uiPackageDirectory, "src", "theme.css")

const hasBuiltUiStyles = existsSync(builtUiStylesPath) && existsSync(builtUiThemePath)
if (!hasBuiltUiStyles && (!existsSync(sourceUiStylesPath) || !existsSync(sourceUiThemePath))) {
  throw new Error("@convax/ui must provide either compiled styles or source styles while building @convax/canvas")
}

const uiStyles = hasBuiltUiStyles
  ? await Bun.file(builtUiStylesPath).text()
  : await compileStyles(sourceUiStylesPath, uiPackageDirectory)
const uiThemePath = hasBuiltUiStyles ? builtUiThemePath : sourceUiThemePath
const canvasStyles = await compileStyles(join(packageDirectory, "src", "styles.css"), packageDirectory, uiThemePath)
for (const selector of [".absolute", ".bottom-3", ".left-3", ".z-20"]) {
  if (!canvasStyles.includes(selector)) {
    throw new Error(`@convax/canvas: compiled CSS is missing required utility ${selector}`)
  }
}
const styles = `${uiStyles}\n${canvasStyles}`

mkdirSync(outputDirectory, { recursive: true })
await Bun.write(join(outputDirectory, "styles.css"), styles)

console.log(`compiled package CSS: @convax/canvas (${styles.length} bytes)`)
