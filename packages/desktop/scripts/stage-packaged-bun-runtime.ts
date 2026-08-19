import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { chmod, copyFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

const desktopDirectory = join(import.meta.dir, "..")
const packagedRuntimeDirectory = join(desktopDirectory, ".packaging", "runtime")

export function packagedBunExecutableName(platform: NodeJS.Platform = process.platform) {
  return platform === "win32" ? "bun.exe" : "bun"
}

async function sha256(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

export function assertPackagableBunExecutable(input: { executable: string; platform?: NodeJS.Platform }) {
  const expected = packagedBunExecutableName(input.platform)
  const actual = basename(input.executable).toLowerCase()
  if (actual !== expected && !(expected === "bun" && actual.startsWith("bun-"))) {
    throw new Error(`Desktop runtime staging must run under Bun, received ${input.executable}`)
  }
}

/**
 * Stage the exact Bun executable running this script. DSH is an in-process npm
 * runtime; Bun remains a separate product asset solely for verified convax-bun
 * companions and must never be sourced from another Agent backend binary.
 */
export async function stagePackagedBunRuntime() {
  const sourceExecutable = process.execPath
  assertPackagableBunExecutable({ executable: sourceExecutable })
  const sourceStat = await stat(sourceExecutable).catch(() => null)
  if (!sourceStat?.isFile()) throw new Error(`Bun executable was not found: ${sourceExecutable}`)
  const sourceDigest = await sha256(sourceExecutable)

  await mkdir(packagedRuntimeDirectory, { recursive: true })
  const stagingDirectory = await mkdtemp(join(packagedRuntimeDirectory, ".bun-staging-"))
  const destinationDirectory = join(packagedRuntimeDirectory, "bun")
  try {
    const binDirectory = join(stagingDirectory, "bin")
    const destinationExecutable = join(binDirectory, packagedBunExecutableName())
    await mkdir(binDirectory, { recursive: true })
    await copyFile(sourceExecutable, destinationExecutable)
    await chmod(destinationExecutable, 0o755)
    const destinationDigest = await sha256(destinationExecutable)
    if (destinationDigest !== sourceDigest) throw new Error("The staged Bun executable changed while it was copied")
    await writeFile(
      join(stagingDirectory, "runtime.json"),
      `${JSON.stringify(
        {
          arch: process.arch,
          executable: `bin/${packagedBunExecutableName()}`,
          package: "bun",
          platform: process.platform,
          schema: "convax.packaged-runtime/1",
          sha256: destinationDigest,
          version: Bun.version,
        },
        null,
        2,
      )}\n`,
      "utf8",
    )
    await rm(destinationDirectory, { force: true, recursive: true })
    await rename(stagingDirectory, destinationDirectory)
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true })
    throw error
  }
  console.log(`Staged Bun ${Bun.version} for ${process.platform}/${process.arch}`)
  return destinationDirectory
}

if (import.meta.main) await stagePackagedBunRuntime()
