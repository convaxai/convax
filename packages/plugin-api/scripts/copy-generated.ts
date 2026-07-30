import { cp, mkdir } from "node:fs/promises"
import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dir, "..")
const target = resolve(packageRoot, "dist/generated")
await mkdir(target, { recursive: true })
for (const name of ["plugin-api.json", "plugin-api.md"]) {
  await cp(resolve(packageRoot, "generated", name), resolve(target, name))
}
