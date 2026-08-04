import { resolve } from "node:path"

const packageRoot = resolve(import.meta.dir, "..")
const sourceRoot = resolve(packageRoot, "src")
const outputDirectory = resolve(packageRoot, "dist")
const entrypoints = [
  "src/index.ts",
  "src/application/index.ts",
  "src/application/errors.ts",
  "src/collaboration/index.ts",
  "src/core.ts",
  "src/view.ts",
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
  if (result.exitCode !== 0) throw new Error(`Failed to build @convax/canvas entry ${entrypoint}`)
}
