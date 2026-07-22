import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"

const desktopDirectory = join(import.meta.dir, "..")
const packagedRuntimeDirectory = join(desktopDirectory, ".packaging", "runtime")

interface OpenCodePackageMetadata {
  license?: string
  name?: string
  optionalDependencies?: Record<string, string>
  version?: string
}

interface OpenCodePlatformExecutable {
  executable: string
  packageName: string
  version: string
}

export function packagedOpenCodeExecutableName(platform: NodeJS.Platform = process.platform) {
  return platform === "win32" ? "opencode.exe" : "opencode"
}

export function packagedOpenCodePackagePrefix(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
) {
  const packagePlatform = platform === "win32" ? "windows" : platform
  if (packagePlatform !== "darwin" && packagePlatform !== "linux" && packagePlatform !== "windows") {
    throw new Error(`OpenCode does not publish a Desktop runtime for ${platform}`)
  }
  if (architecture !== "arm64" && architecture !== "x64") {
    throw new Error(`OpenCode does not publish a Desktop runtime for ${architecture}`)
  }
  return `opencode-${packagePlatform}-${architecture}`
}

async function sha256(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

function resolveInstalledOpenCodePackage() {
  const require = createRequire(import.meta.url)
  let runtimeEntry: string
  try {
    runtimeEntry = require.resolve("@convax/agent-runtime")
  } catch (cause) {
    throw new Error("@convax/agent-runtime must be built before staging the Desktop package", { cause })
  }

  const runtimeRequire = createRequire(runtimeEntry)
  let packageJson: string
  try {
    packageJson = runtimeRequire.resolve("opencode-ai/package.json")
  } catch (cause) {
    throw new Error("The opencode-ai runtime dependency is missing; run `bun install`", { cause })
  }
  return {
    packageJson,
    sourceExecutable: join(dirname(packageJson), "bin", "opencode.exe"),
  }
}

async function resolveInstalledPlatformExecutables(
  packageJson: string,
  metadata: OpenCodePackageMetadata,
): Promise<OpenCodePlatformExecutable[]> {
  const prefix = packagedOpenCodePackagePrefix()
  const packageNames = Object.keys(metadata.optionalDependencies ?? {}).filter(
    (name) => name === prefix || name.startsWith(`${prefix}-`),
  )
  const require = createRequire(packageJson)
  const candidates: OpenCodePlatformExecutable[] = []
  for (const packageName of packageNames) {
    let platformPackageJson: string
    try {
      platformPackageJson = require.resolve(`${packageName}/package.json`)
    } catch {
      continue
    }
    const platformMetadata = JSON.parse(await readFile(platformPackageJson, "utf8")) as OpenCodePackageMetadata
    if (platformMetadata.name !== packageName || !platformMetadata.version?.trim()) continue
    candidates.push({
      executable: join(dirname(platformPackageJson), "bin", packagedOpenCodeExecutableName()),
      packageName,
      version: platformMetadata.version,
    })
  }
  return candidates
}

export async function verifyInstalledExecutableBytes(input: {
  candidates: OpenCodePlatformExecutable[]
  expectedVersion: string
  sourceExecutable: string
}) {
  const sourceStat = await stat(input.sourceExecutable).catch(() => null)
  if (!sourceStat?.isFile()) throw new Error(`Installed OpenCode executable was not found: ${input.sourceExecutable}`)
  const sourceDigest = await sha256(input.sourceExecutable)
  for (const candidate of input.candidates) {
    if (candidate.version !== input.expectedVersion) continue
    const candidateStat = await stat(candidate.executable).catch(() => null)
    if (!candidateStat?.isFile() || candidateStat.size !== sourceStat.size) continue
    if ((await sha256(candidate.executable)) !== sourceDigest) continue
    return { packageName: candidate.packageName, sha256: sourceDigest }
  }
  const installedVersions = input.candidates
    .map((candidate) => `${candidate.packageName}@${candidate.version}`)
    .join(", ")
  throw new Error(
    `Installed OpenCode executable does not match a ${packagedOpenCodePackagePrefix()} package at version ${input.expectedVersion}` +
      `${installedVersions ? ` (found ${installedVersions})` : ""}; run \`bun install\``,
  )
}

export async function stagePackagedOpenCodeRuntime() {
  const installed = resolveInstalledOpenCodePackage()
  const metadata = JSON.parse(await readFile(installed.packageJson, "utf8")) as OpenCodePackageMetadata
  if (!metadata.version?.trim()) throw new Error("Installed opencode-ai package has no version")
  const sourceStat = await stat(installed.sourceExecutable).catch(() => null)
  if (!sourceStat?.isFile()) {
    throw new Error(
      "The platform OpenCode executable was not installed; run `bun install` on the target platform and architecture",
    )
  }

  const verifiedExecutable = await verifyInstalledExecutableBytes({
    candidates: await resolveInstalledPlatformExecutables(installed.packageJson, metadata),
    expectedVersion: metadata.version,
    sourceExecutable: installed.sourceExecutable,
  })
  await mkdir(packagedRuntimeDirectory, { recursive: true })
  const stagingDirectory = await mkdtemp(join(packagedRuntimeDirectory, ".opencode-staging-"))
  const destinationDirectory = join(packagedRuntimeDirectory, "opencode")

  try {
    const binDirectory = join(stagingDirectory, "bin")
    const destinationExecutable = join(binDirectory, packagedOpenCodeExecutableName())
    await mkdir(binDirectory, { recursive: true })
    await copyFile(installed.sourceExecutable, destinationExecutable)
    await chmod(destinationExecutable, 0o755)
    const destinationDigest = await sha256(destinationExecutable)
    if (destinationDigest !== verifiedExecutable.sha256) {
      throw new Error("The staged OpenCode executable changed while it was being copied")
    }

    const licenseFile = join(dirname(installed.packageJson), "LICENSE")
    await copyFile(licenseFile, join(stagingDirectory, basename(licenseFile)))
    await chmod(join(stagingDirectory, basename(licenseFile)), 0o644)
    await writeFile(
      join(stagingDirectory, "runtime.json"),
      `${JSON.stringify(
        {
          arch: process.arch,
          executable: `bin/${packagedOpenCodeExecutableName()}`,
          license: metadata.license ?? null,
          package: verifiedExecutable.packageName,
          platform: process.platform,
          schema: "convax.packaged-runtime/1",
          sha256: destinationDigest,
          version: metadata.version,
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

  console.log(
    `Staged OpenCode ${metadata.version} for ${process.platform}/${process.arch} from ${verifiedExecutable.packageName}`,
  )
  return destinationDirectory
}

if (import.meta.main) await stagePackagedOpenCodeRuntime()
