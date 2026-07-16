import fs from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const electronPackageRoot = path.dirname(require.resolve("electron/package.json"))

async function resolveInstalledBinary() {
  const relativeBinary = await fs.readFile(path.join(electronPackageRoot, "path.txt"), "utf8")
    .then((value) => value.trim())
    .catch(() => "")
  if (!relativeBinary) return null
  const binary = path.join(electronPackageRoot, "dist", relativeBinary)
  return fs.access(binary).then(() => binary, () => null)
}

if (!await resolveInstalledBinary()) {
  const installer = path.join(electronPackageRoot, "install.js")
  await fs.access(installer).catch(() => {
    throw new Error("Electron dependency is missing; run `bun install`")
  })
  const install = Bun.spawn([process.execPath, installer], {
    cwd: electronPackageRoot,
    stderr: "inherit",
    stdout: "inherit",
  })
  const exitCode = await install.exited
  if (exitCode !== 0 || !await resolveInstalledBinary()) {
    throw new Error(`Electron runtime installation failed with exit code ${exitCode}`)
  }
  console.log("Electron runtime restored")
}
