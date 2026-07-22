import { createHash, randomUUID } from "node:crypto"
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

import {
  type RemoteCapabilityArtifact,
  type RemoteCapabilityFetch,
  type RemoteCapabilityRegistry,
  type RemoteCapabilityRegistryClient,
  type RemoteCompanionArch,
  type RemoteCompanionPlatform,
  type RemotePluginCompanion,
  type RemotePluginCompanionTarget,
  type RemotePluginPackage,
  RemoteCapabilityRegistryClient as RegistryClient,
  officialRemoteRegistryIndexUrl,
  parseRemoteCapabilityRegistry,
} from "../src/main/remote-capability-registry"

export const packagedDefaultCapabilitiesSchema = "convax.packaged-default-capabilities/1" as const

const defaultPluginId = "ffmpeg-tools"
const desktopDirectory = join(import.meta.dir, "..")
const defaultOutputDirectory = join(desktopDirectory, ".packaging", "default-capabilities")

interface PackagedArtifactMetadata {
  relativePath: string
  sha256: string
  size: number
  url: string
}

export interface PackagedDefaultPluginArtifact extends PackagedArtifactMetadata {
  version: string
}

export interface PackagedDefaultCompanion extends PackagedArtifactMetadata {
  arch: RemoteCompanionArch
  command: string
  platform: RemoteCompanionPlatform
  version: string
}

export interface PackagedDefaultCapabilitiesManifest {
  arch: RemoteCompanionArch
  companions: PackagedDefaultCompanion[]
  platform: RemoteCompanionPlatform
  pluginArtifact: PackagedDefaultPluginArtifact
  pluginId: string
  registry: PackagedArtifactMetadata & {
    revision: string
    sequence: number
  }
  schema: typeof packagedDefaultCapabilitiesSchema
}

export interface StageDefaultCapabilitiesOptions {
  arch?: NodeJS.Architecture
  fetch?: RemoteCapabilityFetch
  outputDirectory?: string
  platform?: NodeJS.Platform
}

interface CapturedResponse<T> {
  bytes: Uint8Array
  result: T
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function concatBytes(chunks: readonly Uint8Array[], size: number) {
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/**
 * Retains exactly the bytes consumed by the Registry client. It intentionally
 * avoids Response.clone(), whose second stream could keep an oversized response
 * downloading after the bounded verifier has cancelled its own branch.
 */
async function captureVerifiedResponse<T>(
  fetchImplementation: RemoteCapabilityFetch,
  label: string,
  operation: (client: RemoteCapabilityRegistryClient) => Promise<T>,
): Promise<CapturedResponse<T>> {
  let capturedBytes: Promise<Uint8Array> | undefined
  const fetchWithCapture: RemoteCapabilityFetch = async (input, init) => {
    const response = await fetchImplementation(input, init)
    if (response.status !== 200) return response
    if (capturedBytes) throw new Error(`${label} returned more than one successful response`)
    if (!response.body) {
      capturedBytes = Promise.resolve(new Uint8Array())
      return response
    }

    const chunks: Uint8Array[] = []
    let size = 0
    let resolveBytes!: (bytes: Uint8Array) => void
    capturedBytes = new Promise((resolve) => {
      resolveBytes = resolve
    })
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        flush() {
          resolveBytes(concatBytes(chunks, size))
        },
        transform(chunk, controller) {
          const retained = Uint8Array.from(chunk)
          size += retained.byteLength
          chunks.push(retained)
          controller.enqueue(chunk)
        },
      }),
    )
    const wrapped = new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    })
    if (response.url) Object.defineProperty(wrapped, "url", { configurable: true, value: response.url })
    return wrapped
  }

  const result = await operation(new RegistryClient({ fetch: fetchWithCapture }))
  if (!capturedBytes) throw new Error(`${label} did not return a successful response body`)
  return { bytes: await capturedBytes, result }
}

function requireSupportedPlatform(value: NodeJS.Platform): RemoteCompanionPlatform {
  if (value === "darwin" || value === "linux" || value === "win32") return value
  throw new Error(`Default capability companions do not support platform ${value}`)
}

function requireSupportedArch(value: NodeJS.Architecture): RemoteCompanionArch {
  if (value === "arm64" || value === "x64") return value
  throw new Error(`Default capability companions do not support architecture ${value}`)
}

function assertCapturedArtifact(bytes: Uint8Array, artifact: RemoteCapabilityArtifact, label: string) {
  if (bytes.byteLength !== artifact.size) {
    throw new Error(`${label} capture size mismatch: expected ${artifact.size}, received ${bytes.byteLength}`)
  }
  if (sha256(bytes) !== artifact.sha256) throw new Error(`${label} capture SHA-256 does not match the Registry`)
}

function selectDefaultPlugin(
  registry: Awaited<ReturnType<RemoteCapabilityRegistryClient["fetchRegistry"]>>["registry"],
) {
  const item = registry.packages.find(
    (candidate): candidate is RemotePluginPackage => candidate.kind === "plugin" && candidate.id === defaultPluginId,
  )
  if (!item) throw new Error(`The official Registry does not contain ${defaultPluginId}`)
  if (item.yanked) throw new Error(`The official Registry package ${defaultPluginId} is yanked`)
  if (!item.companions?.length) throw new Error(`The official Registry package ${defaultPluginId} has no companion`)
  return item
}

function selectCompanionTargets(
  item: RemotePluginPackage,
  platform: RemoteCompanionPlatform,
  arch: RemoteCompanionArch,
) {
  return item.companions!.map((companion) => {
    const target = companion.targets.find((candidate) => candidate.platform === platform && candidate.arch === arch)
    if (!target) {
      throw new Error(
        `The official Registry package ${item.id} has no ${companion.command} companion for ${platform}/${arch}`,
      )
    }
    return { companion, target }
  })
}

function companionFileName(
  companion: Pick<RemotePluginCompanion, "command" | "version">,
  target: Pick<RemotePluginCompanionTarget, "arch" | "platform">,
) {
  const extension = target.platform === "win32" ? ".exe" : ""
  return `${companion.command}-${companion.version}-${target.platform}-${target.arch}${extension}`
}

function isMissing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

async function publishStagedDirectory(stagingDirectory: string, outputDirectory: string) {
  const backupDirectory = join(dirname(outputDirectory), `.${basename(outputDirectory)}-backup-${randomUUID()}`)
  let hasBackup = false
  try {
    await rename(outputDirectory, backupDirectory)
    hasBackup = true
  } catch (error) {
    if (!isMissing(error)) throw error
  }

  try {
    await rename(stagingDirectory, outputDirectory)
  } catch (publishError) {
    if (hasBackup) {
      try {
        await rename(backupDirectory, outputDirectory)
      } catch (restoreError) {
        const publicationMessage = publishError instanceof Error ? publishError.message : String(publishError)
        throw new Error(
          `Failed to restore packaged default capabilities at ${outputDirectory} after publication failed: ${publicationMessage}`,
          { cause: restoreError },
        )
      }
    }
    throw publishError
  }
  if (hasBackup) await rm(backupDirectory, { force: true, recursive: true }).catch(() => undefined)
}

export async function stageDefaultCapabilities(options: StageDefaultCapabilitiesOptions = {}) {
  const platform = requireSupportedPlatform(options.platform ?? process.platform)
  const arch = requireSupportedArch(options.arch ?? process.arch)
  const fetchImplementation = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const outputDirectory = options.outputDirectory ?? defaultOutputDirectory

  const registryCapture = await captureVerifiedResponse(fetchImplementation, "Official Registry", (client) =>
    client.fetchRegistry({ cachePolicy: "network-first" }),
  )
  if (registryCapture.result.source !== "network") {
    throw new Error("Default capabilities must be staged from a fresh official Registry response")
  }
  let capturedRegistry: RemoteCapabilityRegistry
  try {
    capturedRegistry = parseRemoteCapabilityRegistry(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(registryCapture.bytes)),
    )
  } catch (error) {
    throw new Error("Captured official Registry bytes are invalid", { cause: error })
  }
  if (JSON.stringify(capturedRegistry) !== JSON.stringify(registryCapture.result.registry)) {
    throw new Error("Captured official Registry bytes do not match the validated Registry")
  }

  const item = selectDefaultPlugin(registryCapture.result.registry)
  const selectedCompanions = selectCompanionTargets(item, platform, arch)
  const [pluginCapture, ...companionCaptures] = await Promise.all([
    captureVerifiedResponse(fetchImplementation, `${item.id} Plugin artifact`, (client) => client.downloadBundle(item)),
    ...selectedCompanions.map(({ companion, target }) =>
      captureVerifiedResponse(fetchImplementation, `${companion.command} companion`, (client) =>
        client.downloadCompanionArtifact(item, companion, target),
      ),
    ),
  ])
  assertCapturedArtifact(pluginCapture.bytes, item.artifact, `${item.id} Plugin artifact`)
  for (const [index, capture] of companionCaptures.entries()) {
    assertCapturedArtifact(capture.bytes, selectedCompanions[index].target.artifact, "Plugin companion artifact")
  }

  await mkdir(dirname(outputDirectory), { recursive: true })
  const stagingDirectory = await mkdtemp(join(dirname(outputDirectory), `.${basename(outputDirectory)}-staging-`))
  try {
    const artifactDirectory = join(stagingDirectory, "artifacts")
    await mkdir(artifactDirectory, { recursive: true })
    const pluginRelativePath = `artifacts/${item.id}-${item.version}.zip`
    const pluginPath = join(stagingDirectory, pluginRelativePath)
    await writeFile(pluginPath, pluginCapture.bytes)
    await chmod(pluginPath, 0o644)

    const companions: PackagedDefaultCompanion[] = []
    for (const [index, { companion, target }] of selectedCompanions.entries()) {
      const relativePath = `artifacts/${companionFileName(companion, target)}`
      const companionPath = join(stagingDirectory, relativePath)
      await writeFile(companionPath, companionCaptures[index].bytes)
      await chmod(companionPath, 0o755)
      companions.push({
        arch: target.arch,
        command: companion.command,
        platform: target.platform,
        relativePath,
        sha256: target.artifact.sha256,
        size: target.artifact.size,
        url: target.artifact.url,
        version: companion.version,
      })
    }

    const registryRelativePath = "registry.json"
    const registryPath = join(stagingDirectory, registryRelativePath)
    await writeFile(registryPath, registryCapture.bytes)
    await chmod(registryPath, 0o644)
    const manifest: PackagedDefaultCapabilitiesManifest = {
      arch,
      companions,
      platform,
      pluginArtifact: {
        relativePath: pluginRelativePath,
        sha256: item.artifact.sha256,
        size: item.artifact.size,
        url: item.artifact.url,
        version: item.version,
      },
      pluginId: item.id,
      registry: {
        relativePath: registryRelativePath,
        revision: registryCapture.result.registry.revision,
        sequence: registryCapture.result.registry.sequence,
        sha256: sha256(registryCapture.bytes),
        size: registryCapture.bytes.byteLength,
        url: officialRemoteRegistryIndexUrl,
      },
      schema: packagedDefaultCapabilitiesSchema,
    }
    const manifestPath = join(stagingDirectory, "manifest.json")
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
    await chmod(manifestPath, 0o644)
    await publishStagedDirectory(stagingDirectory, outputDirectory)
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true })
    throw error
  }

  console.log(`Staged ${item.id} ${item.version} for ${platform}/${arch} from the official Registry`)
  return outputDirectory
}

if (import.meta.main) await stageDefaultCapabilities()
