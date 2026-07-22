import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import {
  maxRemoteCompanionBytes,
  officialRemoteRegistryIndexUrl,
  parseRemoteCapabilityRegistry,
  RemoteCapabilityRegistryClient,
  type RemoteCapabilityArtifact,
  type RemoteCapabilityFetch,
  type RemotePluginCompanionTarget,
  type RemotePluginPackage,
} from "./remote-capability-registry"

const packagedDefaultCapabilitiesSchema = "convax.packaged-default-capabilities/1" as const
const maxManifestBytes = 64 * 1024
const maxRegistryBytes = 2 * 1024 * 1024
const maxPluginArtifactBytes = 64 * 1024 * 1024

interface PackagedArtifactDescriptor extends RemoteCapabilityArtifact {
  relativePath: string
}

interface PackagedCompanionDescriptor extends PackagedArtifactDescriptor {
  arch: "arm64" | "x64"
  command: string
  platform: "darwin" | "linux" | "win32"
  version: string
}

interface PackagedRegistryDescriptor extends PackagedArtifactDescriptor {
  revision: string
  sequence: number
}

interface PackagedDefaultCapabilitiesManifest {
  arch: "arm64" | "x64"
  companions: PackagedCompanionDescriptor[]
  platform: "darwin" | "linux" | "win32"
  pluginArtifact: PackagedArtifactDescriptor & { version: string }
  pluginId: string
  registry: PackagedRegistryDescriptor
  schema: typeof packagedDefaultCapabilitiesSchema
}

export interface PackagedDefaultCapabilityRegistryOptions {
  arch?: NodeJS.Architecture
  platform?: NodeJS.Platform
  pluginId: string
  root: string
}

function validationError(message: string): never {
  throw new Error(`Packaged default capability seed is invalid: ${message}`)
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) validationError(`${label} must be an object`)
  return value as Record<string, unknown>
}

function assertExactKeys(input: Record<string, unknown>, expected: readonly string[], label: string) {
  const allowed = new Set(expected)
  const unknown = Object.keys(input).find((key) => !allowed.has(key))
  if (unknown) validationError(`${label} contains an unsupported field: ${unknown}`)
  const missing = expected.find((key) => !(key in input))
  if (missing) validationError(`${label} is missing ${missing}`)
}

function parseString(value: unknown, label: string, maxLength = 512) {
  if (typeof value !== "string" || !value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    validationError(`${label} is invalid`)
  }
  return value
}

function parseSha256(value: unknown, label: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) validationError(`${label} is invalid`)
  return value
}

function parseSize(value: unknown, label: string, maximum: number) {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    validationError(`${label} is invalid`)
  }
  return value as number
}

function parseRelativePath(value: unknown, label: string) {
  const relativePath = parseString(value, label, 512)
  if (
    path.posix.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    validationError(`${label} must be a normalized relative POSIX path`)
  }
  return relativePath
}

function parseUrl(value: unknown, label: string) {
  const url = parseString(value, label, 2_048)
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    validationError(`${label} is invalid`)
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    validationError(`${label} must be an HTTPS URL without credentials or a fragment`)
  }
  return parsed.toString()
}

function parseArtifact(value: unknown, label: string, maximum: number): PackagedArtifactDescriptor {
  const input = assertObject(value, label)
  assertExactKeys(input, ["relativePath", "sha256", "size", "url"], label)
  return {
    relativePath: parseRelativePath(input.relativePath, `${label}.relativePath`),
    sha256: parseSha256(input.sha256, `${label}.sha256`),
    size: parseSize(input.size, `${label}.size`, maximum),
    url: parseUrl(input.url, `${label}.url`),
  }
}

function parseManifest(value: unknown): PackagedDefaultCapabilitiesManifest {
  const input = assertObject(value, "manifest")
  assertExactKeys(
    input,
    ["arch", "companions", "platform", "pluginArtifact", "pluginId", "registry", "schema"],
    "manifest",
  )
  if (input.schema !== packagedDefaultCapabilitiesSchema) validationError("manifest schema is unsupported")
  if (input.platform !== "darwin" && input.platform !== "linux" && input.platform !== "win32") {
    validationError("manifest platform is unsupported")
  }
  if (input.arch !== "arm64" && input.arch !== "x64") validationError("manifest architecture is unsupported")
  const platform = input.platform as PackagedDefaultCapabilitiesManifest["platform"]
  const arch = input.arch as PackagedDefaultCapabilitiesManifest["arch"]

  const registryInput = assertObject(input.registry, "manifest.registry")
  assertExactKeys(registryInput, ["relativePath", "revision", "sequence", "sha256", "size", "url"], "manifest.registry")
  const registryArtifact = parseArtifact(
    {
      relativePath: registryInput.relativePath,
      sha256: registryInput.sha256,
      size: registryInput.size,
      url: registryInput.url,
    },
    "manifest.registry",
    maxRegistryBytes,
  )
  if (!Number.isSafeInteger(registryInput.sequence) || (registryInput.sequence as number) < 0) {
    validationError("manifest.registry.sequence is invalid")
  }
  const revision = parseString(registryInput.revision, "manifest.registry.revision", 64)
  if (!/^[a-f0-9]{40}$/.test(revision)) validationError("manifest.registry.revision is invalid")

  const pluginInput = assertObject(input.pluginArtifact, "manifest.pluginArtifact")
  assertExactKeys(pluginInput, ["relativePath", "sha256", "size", "url", "version"], "manifest.pluginArtifact")
  const pluginArtifact = parseArtifact(
    {
      relativePath: pluginInput.relativePath,
      sha256: pluginInput.sha256,
      size: pluginInput.size,
      url: pluginInput.url,
    },
    "manifest.pluginArtifact",
    maxPluginArtifactBytes,
  )

  if (!Array.isArray(input.companions) || input.companions.length < 1 || input.companions.length > 16) {
    validationError("manifest.companions is invalid")
  }
  const companions = input.companions.map((value, index): PackagedCompanionDescriptor => {
    const label = `manifest.companions[${index}]`
    const companionInput = assertObject(value, label)
    assertExactKeys(
      companionInput,
      ["arch", "command", "platform", "relativePath", "sha256", "size", "url", "version"],
      label,
    )
    const artifact = parseArtifact(
      {
        relativePath: companionInput.relativePath,
        sha256: companionInput.sha256,
        size: companionInput.size,
        url: companionInput.url,
      },
      label,
      maxRemoteCompanionBytes,
    )
    if (companionInput.platform !== platform || companionInput.arch !== arch) {
      validationError(`${label} does not match the seed target`)
    }
    return {
      ...artifact,
      arch,
      command: parseString(companionInput.command, `${label}.command`, 128),
      platform,
      version: parseString(companionInput.version, `${label}.version`, 128),
    }
  })

  const relativePaths = [
    registryArtifact.relativePath,
    pluginArtifact.relativePath,
    ...companions.map((x) => x.relativePath),
  ]
  if (new Set(relativePaths).size !== relativePaths.length) validationError("manifest contains duplicate file paths")
  const urls = [registryArtifact.url, pluginArtifact.url, ...companions.map((x) => x.url)]
  if (new Set(urls).size !== urls.length) validationError("manifest contains duplicate URLs")

  return {
    arch,
    companions,
    platform,
    pluginArtifact: {
      ...pluginArtifact,
      version: parseString(pluginInput.version, "manifest.pluginArtifact.version", 128),
    },
    pluginId: parseString(input.pluginId, "manifest.pluginId", 128),
    registry: {
      ...registryArtifact,
      revision,
      sequence: registryInput.sequence as number,
    },
    schema: packagedDefaultCapabilitiesSchema,
  }
}

async function readRegularFile(input: {
  expectedSize?: number
  label: string
  maximum: number
  root: string
  rootRealPath: string
  relativePath: string
}) {
  const target = path.resolve(input.root, ...input.relativePath.split("/"))
  if (!target.startsWith(`${path.resolve(input.root)}${path.sep}`))
    validationError(`${input.label} escapes the seed root`)
  let realTarget: string
  try {
    realTarget = await fs.realpath(target)
  } catch (error) {
    throw new Error(`Packaged default capability seed could not read ${input.label}`, { cause: error })
  }
  if (!realTarget.startsWith(`${input.rootRealPath}${path.sep}`))
    validationError(`${input.label} escapes the seed root`)
  const handle = await fs.open(realTarget, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < 1 || stat.size > input.maximum)
      validationError(`${input.label} is not a bounded file`)
    if (input.expectedSize !== undefined && stat.size !== input.expectedSize) {
      validationError(`${input.label} size does not match the manifest`)
    }
    return new Uint8Array(await handle.readFile())
  } finally {
    await handle.close()
  }
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function sameArtifact(left: RemoteCapabilityArtifact, right: PackagedArtifactDescriptor) {
  return left.url === right.url && left.size === right.size && left.sha256 === right.sha256
}

function matchingTarget(
  item: RemotePluginPackage,
  descriptor: PackagedCompanionDescriptor,
): RemotePluginCompanionTarget | undefined {
  return item.companions
    ?.find((companion) => companion.command === descriptor.command && companion.version === descriptor.version)
    ?.targets.find((target) => target.platform === descriptor.platform && target.arch === descriptor.arch)
}

/**
 * Reads a signed-app resource seed and exposes it through the normal verified
 * Registry client. The seed retains remote provenance; it is never admitted as
 * a trusted built-in package and the regular installer still owns publication.
 */
export async function createPackagedDefaultCapabilityRegistry(
  options: PackagedDefaultCapabilityRegistryOptions,
): Promise<RemoteCapabilityRegistryClient | null> {
  if (!path.isAbsolute(options.root)) throw new Error("Packaged default capability seed root must be absolute")
  let rootStat
  try {
    rootStat = await fs.lstat(options.root)
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null
    throw error
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) validationError("seed root must be a real directory")
  const root = path.resolve(options.root)
  const rootRealPath = await fs.realpath(root)

  const manifestBytes = await readRegularFile({
    label: "manifest",
    maximum: maxManifestBytes,
    relativePath: "manifest.json",
    root,
    rootRealPath,
  })
  let manifestValue: unknown
  try {
    manifestValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes))
  } catch (error) {
    throw new Error("Packaged default capability seed manifest is not valid UTF-8 JSON", { cause: error })
  }
  const manifest = parseManifest(manifestValue)
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  if (manifest.platform !== platform || manifest.arch !== arch) {
    validationError(`seed target ${manifest.platform}/${manifest.arch} does not match ${platform}/${arch}`)
  }
  if (manifest.pluginId !== options.pluginId) validationError("seed Plugin id does not match the requested default")
  if (manifest.registry.url !== officialRemoteRegistryIndexUrl) validationError("seed Registry URL is not official")

  const registryBytes = await readRegularFile({
    expectedSize: manifest.registry.size,
    label: "Registry",
    maximum: maxRegistryBytes,
    relativePath: manifest.registry.relativePath,
    root,
    rootRealPath,
  })
  if (sha256(registryBytes) !== manifest.registry.sha256) validationError("Registry digest does not match the manifest")
  let registryValue: unknown
  try {
    registryValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(registryBytes))
  } catch (error) {
    throw new Error("Packaged default capability Registry is not valid UTF-8 JSON", { cause: error })
  }
  const registry = parseRemoteCapabilityRegistry(registryValue)
  if (registry.sequence !== manifest.registry.sequence || registry.revision !== manifest.registry.revision) {
    validationError("Registry identity does not match the manifest")
  }
  const item = registry.packages.find(
    (candidate): candidate is RemotePluginPackage => candidate.kind === "plugin" && candidate.id === manifest.pluginId,
  )
  if (!item || item.yanked) validationError("seed Plugin is missing or yanked")
  if (item.version !== manifest.pluginArtifact.version || !sameArtifact(item.artifact, manifest.pluginArtifact)) {
    validationError("Plugin artifact does not match the Registry")
  }
  const expectedCompanions = (item.companions ?? []).map((companion) => ({
    companion,
    target: companion.targets.find((target) => target.platform === manifest.platform && target.arch === manifest.arch),
  }))
  if (expectedCompanions.some(({ target }) => !target) || expectedCompanions.length !== manifest.companions.length) {
    validationError("companion target set does not match the Registry")
  }
  for (const descriptor of manifest.companions) {
    const target = matchingTarget(item, descriptor)
    if (!target || !sameArtifact(target.artifact, descriptor)) {
      validationError(`companion ${descriptor.command} does not match the Registry`)
    }
  }

  const resources = new Map<
    string,
    { descriptor: PackagedArtifactDescriptor; maximum: number; mime: "application/octet-stream" | "application/zip" }
  >()
  resources.set(manifest.pluginArtifact.url, {
    descriptor: manifest.pluginArtifact,
    maximum: maxPluginArtifactBytes,
    mime: "application/zip",
  })
  for (const descriptor of manifest.companions) {
    resources.set(descriptor.url, {
      descriptor,
      maximum: maxRemoteCompanionBytes,
      mime: "application/octet-stream",
    })
  }
  const registryBody = new TextDecoder("utf-8", { fatal: true }).decode(registryBytes)
  const fetch: RemoteCapabilityFetch = async (url, init) => {
    if (init?.signal?.aborted) throw init.signal.reason
    if (url === manifest.registry.url) {
      return new Response(registryBody, {
        headers: {
          "content-length": String(registryBytes.byteLength),
          "content-type": "application/json",
        },
        status: 200,
      })
    }
    const resource = resources.get(url)
    if (!resource) throw new Error("Packaged default capability seed rejected an unknown URL")
    const bytes = await readRegularFile({
      expectedSize: resource.descriptor.size,
      label: `artifact ${path.posix.basename(resource.descriptor.relativePath)}`,
      maximum: resource.maximum,
      relativePath: resource.descriptor.relativePath,
      root,
      rootRealPath,
    })
    return new Response(bytes, {
      headers: { "content-length": String(bytes.byteLength), "content-type": resource.mime },
      status: 200,
    })
  }

  const client = new RemoteCapabilityRegistryClient({ fetch })
  const loaded = await client.fetchRegistry()
  if (loaded.registry.sequence !== registry.sequence || loaded.registry.revision !== registry.revision) {
    validationError("verified Registry identity changed while loading the seed")
  }
  return client
}
