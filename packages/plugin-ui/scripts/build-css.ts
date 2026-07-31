import { mkdirSync } from "node:fs"
import { join } from "node:path"

const packageDirectory = join(import.meta.dir, "..")
const outputDirectory = join(packageDirectory, "dist")
mkdirSync(outputDirectory, { recursive: true })
await Bun.write(join(outputDirectory, "theme.css"), Bun.file(join(packageDirectory, "src", "theme.css")))
