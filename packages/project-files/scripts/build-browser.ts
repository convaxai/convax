import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dir, "..")
const sourceRoot = resolve(packageRoot, "src")
const outputDirectory = resolve(packageRoot, "dist")
const entrypoints = [
  "src/index.ts",
  "src/contracts.ts",
  "src/drag.ts",
  "src/identity.ts",
  "src/project-uri.ts",
]

for (const entrypoint of entrypoints) {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "build",
      "--production",
      "--keep-names",
      "--target=browser",
      "--format=esm",
      "--packages=external",
      "--external=@convax/*",
      "--sourcemap=linked",
      `--root=${sourceRoot}`,
      `--outdir=${outputDirectory}`,
      resolve(packageRoot, entrypoint),
    ],
    { cwd: packageRoot, stderr: "inherit", stdout: "inherit" },
  )
  if (result.exitCode !== 0) throw new Error(`Failed to build @convax/project-files entry ${entrypoint}`)
}
