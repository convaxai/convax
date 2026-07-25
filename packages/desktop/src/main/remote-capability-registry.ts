import { createHash } from "node:crypto"

import {
  type WebPluginManifest,
  parseWebPluginManifest,
  requireWebPluginId,
  webPluginManifestSchema,
  webPluginManifestSchemaV2,
  webPluginManifestSchemaV3,
  webPluginManifestSchemaV4,
  webPluginManifestSchemaV5,
  webPluginManifestSchemaV6,
  webPluginManifestSchemaV7,
} from "../plugin-contracts"
import { type SafeZipLimits, unpackSafeZip } from "./safe-zip"

export const officialRemoteRegistryIndexUrl =
  "https://microvoid.github.io/convax-plugins/registry/v1/index.json" as const
export const officialRemoteShowcaseIndexUrl =
  "https://microvoid.github.io/convax-plugins/showcase/v1/index.json" as const
export const remoteCapabilityRegistrySchema = "convax.registry/1" as const
export const remoteCapabilityShowcaseSchema = "convax.showcase/1" as const
export const remotePluginHostSchema = "convax.plugin-host/1" as const
export const remotePluginHostSchemaV2 = "convax.plugin-host/2" as const
export const remotePluginHostSchemaV3 = "convax.plugin-host/3" as const
export const remotePluginHostSchemaV4 = "convax.plugin-host/4" as const
export const remotePluginCapabilitySchemaV1 = "convax.plugin-capability/1" as const
export const remoteSkillSchema = "opencode.skill/1" as const

export type RemotePluginCompatibility =
  | {
      pluginHost: typeof remotePluginHostSchema
      pluginSchema: typeof webPluginManifestSchema
    }
  | {
      pluginHost: typeof remotePluginHostSchemaV2
      pluginSchema: typeof webPluginManifestSchemaV2
    }
  | {
      pluginHost: typeof remotePluginHostSchemaV3
      pluginSchema: typeof webPluginManifestSchemaV3
    }
  | {
      pluginHost: typeof remotePluginHostSchemaV4
      pluginSchema: typeof webPluginManifestSchemaV4
    }
  | {
      pluginHost: typeof remotePluginCapabilitySchemaV1
      pluginSchema: typeof webPluginManifestSchemaV5
    }
  | {
      pluginHost: typeof remotePluginCapabilitySchemaV1
      pluginSchema: typeof webPluginManifestSchemaV6
    }
  | {
      pluginHost: typeof remotePluginCapabilitySchemaV1
      pluginSchema: typeof webPluginManifestSchemaV7
    }

const maxRegistryBytes = 2 * 1024 * 1024
const maxArtifactBytes = 64 * 1024 * 1024
export const maxRemoteCompanionBytes = 128 * 1024 * 1024
const maxShowcaseIndexBytes = 2 * 1024 * 1024
const maxShowcasePosterBytes = 4 * 1024 * 1024
const maxShowcaseAnimationBytes = 24 * 1024 * 1024
const defaultRemoteRequestTimeoutMs = 10_000
const defaultRemoteTransferInactivityTimeoutMs = 60_000
const defaultRemoteTransferTimeoutMs = 10 * 60_000
const maxRemoteRequestTimeoutMs = 120_000
const maxRemoteTransferTimeoutMs = 10 * 60_000
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export interface RemoteCapabilityArtifact {
  sha256: string
  size: number
  url: string
}

export type RemoteCompanionPlatform = "darwin" | "linux" | "win32"
export type RemoteCompanionArch = "arm64" | "x64"

export interface RemotePluginCompanionTarget {
  arch: RemoteCompanionArch
  artifact: RemoteCapabilityArtifact
  platform: RemoteCompanionPlatform
}

export interface RemotePluginCompanion {
  command: string
  targets: RemotePluginCompanionTarget[]
  version: string
}

export interface RemotePluginPackage {
  artifact: RemoteCapabilityArtifact
  companions?: RemotePluginCompanion[]
  compatibility: RemotePluginCompatibility
  description: string
  id: string
  kind: "plugin"
  manifest: WebPluginManifest
  name: string
  version: string
  yanked: boolean
}

export interface RemoteSkillPackage {
  artifact: RemoteCapabilityArtifact
  compatibility: {
    skillSchema: typeof remoteSkillSchema
  }
  description: string
  id: string
  kind: "skill"
  name: string
  /** Plugin whose v4 Skill contribution owns this Skill's Convax lifecycle. */
  ownerPluginId?: string
  version: string
  yanked: boolean
}

export type RemoteCapabilityPackage = RemotePluginPackage | RemoteSkillPackage

export interface RemoteCapabilityRegistry {
  packages: RemoteCapabilityPackage[]
  revision: string
  schema: typeof remoteCapabilityRegistrySchema
  sequence: number
}

export type RemoteShowcasePosterMime = "image/jpeg" | "image/png" | "image/webp"
export type RemoteShowcaseAnimationMime = "image/gif" | "video/mp4"
export type RemoteShowcaseMime = RemoteShowcaseAnimationMime | RemoteShowcasePosterMime

export interface RemoteShowcaseMedia<Mime extends string = string> {
  alt: string
  height: number
  mime: Mime
  sha256: string
  size: number
  url: string
  width: number
}

export interface RemoteCapabilityShowcasePackage {
  animation?: RemoteShowcaseMedia<RemoteShowcaseAnimationMime>
  id: string
  kind: "plugin" | "skill"
  poster: RemoteShowcaseMedia<RemoteShowcasePosterMime>
  version: string
}

export interface RemoteCapabilityShowcase {
  packages: RemoteCapabilityShowcasePackage[]
  revision: string
  schema: typeof remoteCapabilityShowcaseSchema
  sequence: number
}

export interface RemoteSkillShowcaseDownload {
  altText: string
  bytes: Uint8Array
  mimeType: RemoteShowcaseMime
  size: number
}

export interface RemoteRegistryCacheEntry {
  body: string
  etag?: string
  sha256: string
}

export interface RemoteRegistryCache {
  read(): Promise<RemoteRegistryCacheEntry | null>
  write(entry: RemoteRegistryCacheEntry): Promise<void>
}

export interface RemoteShowcaseMediaCache {
  read(input: { sha256: string; size: number }): Promise<Uint8Array | null>
  write(input: { bytes: Uint8Array; sha256: string }): Promise<void>
}

/** Non-authoritative content-addressed cache for immutable ZIP and companion bytes. */
export interface RemoteArtifactCache {
  read(input: { sha256: string; size: number }): Promise<Uint8Array | null>
  write(input: { bytes: Uint8Array; sha256: string }): Promise<void>
}

export interface RemoteRegistryFetchResult {
  etag?: string
  registry: RemoteCapabilityRegistry
  source: "cache" | "network" | "not-modified"
  staleReason?: string
}

export interface RemoteCapabilityBundle {
  files: Readonly<Record<string, Uint8Array>>
}

export interface RemoteCapabilityRegistryClientOptions {
  artifactCache?: RemoteArtifactCache
  cache?: RemoteRegistryCache
  fetch?: RemoteCapabilityFetch
  /** Main-owned test seam for the cache-first Registry revalidation clock. */
  now?: () => number
  /** Main-owned test seam. Production composition must use the official default. */
  registryUrl?: string
  registryRevalidateMs?: number
  showcaseCache?: RemoteRegistryCache
  showcaseMediaCache?: RemoteShowcaseMediaCache
  /** Main-owned test seam. Production composition must use the official default. */
  showcaseUrl?: string
  /** Main-owned test seam for a transfer's maximum time without network progress. */
  transferInactivityTimeoutMs?: number
  /** Main-owned test seam for the hard deadline of a bounded artifact transfer. */
  transferTimeoutMs?: number
  /** Main-owned test seam for bounded Registry and Showcase metadata requests. */
  timeoutMs?: number
}

export type RemoteCapabilityFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface RemoteCapabilityDownloadOptions {
  maxBytes?: number
  signal?: AbortSignal
  timeoutMs?: number
  zipLimits?: SafeZipLimits
}

export interface RemoteCompanionDownloadOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface RemoteShowcaseDownloadOptions {
  media?: "animation" | "poster"
  signal?: AbortSignal
  timeoutMs?: number
}

export interface RemoteRegistryFetchOptions {
  cachePolicy?: "cache-first" | "network-first"
  signal?: AbortSignal
}

export class RemoteRegistryValidationError extends Error {
  override readonly name = "RemoteRegistryValidationError"
}

/** Replaceable on-disk cache content corruption; I/O/trust-boundary errors use their original type. */
export class RemoteRegistryCacheCorruptionError extends Error {
  override readonly name = "RemoteRegistryCacheCorruptionError"
}

export class RemoteRegistryTimeoutError extends Error {
  override readonly name = "RemoteRegistryTimeoutError"
}

class RemoteRegistryTransportError extends Error {
  override readonly name = "RemoteRegistryTransportError"

  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message)
  }
}

function validationError(message: string): never {
  throw new RemoteRegistryValidationError(message)
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) validationError(`${label} must be an object`)
  return value as Record<string, unknown>
}

function assertKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const keys = Object.keys(value)
  const unknown = keys.find((key) => !expected.includes(key))
  if (unknown) validationError(`${label} contains an unsupported field: ${unknown}`)
  const missing = expected.find((key) => !Object.hasOwn(value, key))
  if (missing) validationError(`${label} is missing a required field: ${missing}`)
}

function assertKeysWithOptional(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
) {
  const keys = Object.keys(value)
  const allowed = [...required, ...optional]
  const unknown = keys.find((key) => !allowed.includes(key))
  if (unknown) validationError(`${label} contains an unsupported field: ${unknown}`)
  const missing = required.find((key) => !Object.hasOwn(value, key))
  if (missing) validationError(`${label} is missing a required field: ${missing}`)
}

function requireString(value: unknown, label: string, maxLength: number) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    validationError(`${label} must be a non-empty, trimmed string`)
  }
  return value
}

function requireBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") validationError(`${label} must be a boolean`)
  return value
}

function requireSemver(value: unknown, label: string) {
  const version = requireString(value, label, 128)
  if (!semverPattern.test(version)) validationError(`${label} must be valid SemVer`)
  return version
}

function requireSkillId(value: unknown) {
  const id = requireString(value, "Remote Skill id", 64)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    validationError("Remote Skill id must be a kebab-case identifier")
  }
  return id
}

function parseHttpsUrl(value: unknown, label: string) {
  const input = requireString(value, label, 2_048)
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    validationError(`${label} must be a valid URL`)
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) {
    validationError(`${label} must be a plain HTTPS URL without credentials, a custom port, or a fragment`)
  }
  return parsed
}

function assertOfficialArtifactUrl(value: unknown) {
  const parsed = parseHttpsUrl(value, "Remote artifact URL")
  if (parsed.hostname !== "github.com" || parsed.search) {
    validationError("Remote artifacts must use the official GitHub Releases repository")
  }
  if (
    !/^\/microvoid\/convax-plugins\/releases\/download\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.zip$/.test(
      parsed.pathname,
    )
  ) {
    validationError("Remote artifacts must use a ZIP asset from the official GitHub Releases repository")
  }
  return parsed.toString()
}

function expectedCompanionArtifactUrl(
  pluginId: string,
  pluginVersion: string,
  companion: Pick<RemotePluginCompanion, "command" | "version">,
  target: Pick<RemotePluginCompanionTarget, "arch" | "platform">,
) {
  const extension = target.platform === "win32" ? ".exe" : ""
  return (
    `https://github.com/microvoid/convax-plugins/releases/download/plugin-${pluginId}-v${pluginVersion}/` +
    `convax-companion-${companion.command}-${companion.version}-${target.platform}-${target.arch}${extension}`
  )
}

function assertOfficialCompanionArtifactUrl(
  value: unknown,
  pluginId: string,
  pluginVersion: string,
  companion: Pick<RemotePluginCompanion, "command" | "version">,
  target: Pick<RemotePluginCompanionTarget, "arch" | "platform">,
) {
  const parsed = parseHttpsUrl(value, "Remote companion artifact URL")
  if (parsed.search || parsed.toString() !== expectedCompanionArtifactUrl(pluginId, pluginVersion, companion, target)) {
    validationError("Remote companion artifact URL must exactly match its Plugin, command, version, and target")
  }
  return parsed.toString()
}

function assertOfficialShowcaseMediaUrl(
  value: unknown,
  identity: Pick<RemoteCapabilityShowcasePackage, "id" | "kind" | "version">,
  mime: RemoteShowcaseAnimationMime | RemoteShowcasePosterMime,
) {
  const parsed = parseHttpsUrl(value, "Remote showcase media URL")
  if (parsed.hostname !== "github.com" || parsed.search) {
    validationError("Remote showcase media must use the official GitHub Releases repository")
  }
  const releasePrefix = `/microvoid/convax-plugins/releases/download/${identity.kind}-${identity.id}-v${identity.version}/`
  if (!parsed.pathname.startsWith(releasePrefix)) {
    validationError("Remote showcase media release must match its package identity and version")
  }
  const fileName = parsed.pathname.slice(releasePrefix.length)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(fileName)) {
    validationError("Remote showcase media asset name is invalid")
  }
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLocaleLowerCase("en-US")
  const expectedExtensions: Record<RemoteShowcaseAnimationMime | RemoteShowcasePosterMime, readonly string[]> = {
    "image/gif": [".gif"],
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/webp": [".webp"],
    "video/mp4": [".mp4"],
  }
  if (!expectedExtensions[mime].includes(extension)) {
    validationError("Remote showcase media extension does not match its MIME type")
  }
  return parsed.toString()
}

function assertAllowedArtifactRequestUrl(value: string, initial: boolean) {
  if (initial) return assertOfficialArtifactUrl(value)
  const parsed = parseHttpsUrl(value, "Remote artifact redirect URL")
  if (parsed.hostname === "github.com") return assertOfficialArtifactUrl(parsed.toString())
  if (!["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(parsed.hostname)) {
    validationError(`Remote artifact redirect host is not allowed: ${parsed.hostname}`)
  }
  if (!parsed.pathname.startsWith("/") || parsed.pathname === "/") {
    validationError("Remote artifact redirect path is invalid")
  }
  return parsed.toString()
}

function assertAllowedCompanionRequestUrl(value: string, initial: boolean) {
  const parsed = parseHttpsUrl(value, "Remote companion artifact request URL")
  if (initial) {
    if (
      parsed.hostname !== "github.com" ||
      parsed.search ||
      !/^\/microvoid\/convax-plugins\/releases\/download\/plugin-[a-z0-9]+(?:-[a-z0-9]+)*-v[0-9A-Za-z.+-]+\/convax-companion-[A-Za-z0-9][A-Za-z0-9._-]*-[0-9A-Za-z.+-]+-(?:darwin|linux|win32)-(?:arm64|x64)(?:\.exe)?$/.test(
        parsed.pathname,
      )
    ) {
      validationError("Remote companion artifacts must use their exact official GitHub Release asset path")
    }
    return parsed.toString()
  }
  if (!parsed.search && parsed.hostname === "github.com") {
    return assertAllowedCompanionRequestUrl(parsed.toString(), true)
  }
  if (!["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(parsed.hostname)) {
    validationError(`Remote companion artifact redirect host is not allowed: ${parsed.hostname}`)
  }
  if (!parsed.pathname.startsWith("/") || parsed.pathname === "/") {
    validationError("Remote companion artifact redirect path is invalid")
  }
  return parsed.toString()
}

function assertAllowedShowcaseMediaRequestUrl(value: string, initial: boolean) {
  const parsed = parseHttpsUrl(value, "Remote showcase media request URL")
  if (initial) {
    if (
      parsed.hostname !== "github.com" ||
      parsed.search ||
      !/^\/microvoid\/convax-plugins\/releases\/download\/[A-Za-z0-9][A-Za-z0-9._+-]{0,199}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.(?:gif|jpe?g|mp4|png|webp)$/.test(
        parsed.pathname,
      )
    ) {
      validationError("Remote showcase media must use an official GitHub Release asset")
    }
    return parsed.toString()
  }
  if (!parsed.search && parsed.hostname === "github.com")
    return assertAllowedShowcaseMediaRequestUrl(parsed.toString(), true)
  if (!["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(parsed.hostname)) {
    validationError(`Remote showcase media redirect host is not allowed: ${parsed.hostname}`)
  }
  if (!parsed.pathname.startsWith("/") || parsed.pathname === "/") {
    validationError("Remote showcase media redirect path is invalid")
  }
  return parsed.toString()
}

function parseArtifact(value: unknown): RemoteCapabilityArtifact {
  const input = asRecord(value, "Remote artifact")
  assertKeys(input, ["sha256", "size", "url"], "Remote artifact")
  if (!Number.isSafeInteger(input.size) || (input.size as number) < 1 || (input.size as number) > maxArtifactBytes) {
    validationError(`Remote artifact size must be an integer between 1 and ${maxArtifactBytes}`)
  }
  const sha256 = requireString(input.sha256, "Remote artifact SHA-256", 64)
  if (!/^[a-f0-9]{64}$/.test(sha256)) validationError("Remote artifact SHA-256 must be 64 lowercase hex characters")
  return { sha256, size: input.size as number, url: assertOfficialArtifactUrl(input.url) }
}

function parseCompanions(
  value: unknown,
  identity: { id: string; version: string },
  manifest: WebPluginManifest,
): RemotePluginCompanion[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    validationError("Remote Plugin companions must be an array of between 1 and 16 entries")
  }
  const runtimeCommand = manifest.runtime?.type === "mcp-stdio" ? manifest.runtime.command : undefined
  if (!runtimeCommand) validationError("Remote Plugin companions require a matching external MCP runtime")
  const commands = new Set<string>()
  return value.map((entry, companionIndex) => {
    const input = asRecord(entry, `Remote Plugin companion ${companionIndex}`)
    assertKeys(input, ["command", "targets", "version"], `Remote Plugin companion ${companionIndex}`)
    const command = requireString(input.command, `Remote Plugin companion ${companionIndex} command`, 128)
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(command)) {
      validationError(`Remote Plugin companion ${companionIndex} command must be a bare executable name`)
    }
    if (command !== runtimeCommand) {
      validationError("Remote Plugin companion command must exactly match its manifest runtime command")
    }
    if (commands.has(command)) validationError(`Remote Plugin companions contain a duplicate command: ${command}`)
    commands.add(command)
    const version = requireSemver(input.version, `Remote Plugin companion ${companionIndex} version`)
    if (!Array.isArray(input.targets) || input.targets.length < 1 || input.targets.length > 16) {
      validationError(`Remote Plugin companion ${companionIndex} targets must contain between 1 and 16 entries`)
    }
    const targetIdentities = new Set<string>()
    const targets = input.targets.map((entryTarget, targetIndex): RemotePluginCompanionTarget => {
      const target = asRecord(entryTarget, `Remote Plugin companion ${companionIndex} target ${targetIndex}`)
      assertKeys(
        target,
        ["arch", "artifact", "platform"],
        `Remote Plugin companion ${companionIndex} target ${targetIndex}`,
      )
      if (!(["darwin", "linux", "win32"] as const).includes(target.platform as RemoteCompanionPlatform)) {
        validationError(`Remote Plugin companion ${companionIndex} target platform is not supported`)
      }
      if (!(["arm64", "x64"] as const).includes(target.arch as RemoteCompanionArch)) {
        validationError(`Remote Plugin companion ${companionIndex} target architecture is not supported`)
      }
      const platform = target.platform as RemoteCompanionPlatform
      const arch = target.arch as RemoteCompanionArch
      const targetIdentity = `${platform}/${arch}`
      if (targetIdentities.has(targetIdentity)) {
        validationError(`Remote Plugin companion ${companionIndex} contains a duplicate target: ${targetIdentity}`)
      }
      targetIdentities.add(targetIdentity)
      const artifactInput = asRecord(target.artifact, `Remote Plugin companion ${companionIndex} artifact`)
      assertKeys(artifactInput, ["sha256", "size", "url"], `Remote Plugin companion ${companionIndex} artifact`)
      if (
        !Number.isSafeInteger(artifactInput.size) ||
        (artifactInput.size as number) < 1 ||
        (artifactInput.size as number) > maxRemoteCompanionBytes
      ) {
        validationError(
          `Remote Plugin companion artifact size must be an integer between 1 and ${maxRemoteCompanionBytes}`,
        )
      }
      const sha256 = requireString(artifactInput.sha256, "Remote Plugin companion artifact SHA-256", 64)
      if (!/^[a-f0-9]{64}$/.test(sha256)) {
        validationError("Remote Plugin companion artifact SHA-256 must be 64 lowercase hex characters")
      }
      const companionIdentity = { command, version }
      const targetIdentityParts = { arch, platform }
      return {
        arch,
        artifact: {
          sha256,
          size: artifactInput.size as number,
          url: assertOfficialCompanionArtifactUrl(
            artifactInput.url,
            identity.id,
            identity.version,
            companionIdentity,
            targetIdentityParts,
          ),
        },
        platform,
      }
    })
    return { command, targets, version }
  })
}

function parsePluginPackage(input: Record<string, unknown>): RemotePluginPackage {
  assertKeysWithOptional(
    input,
    ["artifact", "compatibility", "description", "id", "kind", "manifest", "name", "version", "yanked"],
    ["companions"],
    "Remote Plugin package",
  )
  const compatibility = asRecord(input.compatibility, "Remote Plugin compatibility")
  assertKeys(compatibility, ["pluginHost", "pluginSchema"], "Remote Plugin compatibility")
  const compatibleV1 =
    compatibility.pluginHost === remotePluginHostSchema && compatibility.pluginSchema === webPluginManifestSchema
  const compatibleV2 =
    compatibility.pluginHost === remotePluginHostSchemaV2 && compatibility.pluginSchema === webPluginManifestSchemaV2
  const compatibleV3 =
    compatibility.pluginHost === remotePluginHostSchemaV3 && compatibility.pluginSchema === webPluginManifestSchemaV3
  const compatibleV4 =
    compatibility.pluginHost === remotePluginHostSchemaV4 && compatibility.pluginSchema === webPluginManifestSchemaV4
  const compatibleV5 =
    compatibility.pluginHost === remotePluginCapabilitySchemaV1 &&
    compatibility.pluginSchema === webPluginManifestSchemaV5
  const compatibleV6 =
    compatibility.pluginHost === remotePluginCapabilitySchemaV1 &&
    compatibility.pluginSchema === webPluginManifestSchemaV6
  const compatibleV7 =
    compatibility.pluginHost === remotePluginCapabilitySchemaV1 &&
    compatibility.pluginSchema === webPluginManifestSchemaV7
  if (
    !compatibleV1 &&
    !compatibleV2 &&
    !compatibleV3 &&
    !compatibleV4 &&
    !compatibleV5 &&
    !compatibleV6 &&
    !compatibleV7
  ) {
    validationError("Remote Plugin compatibility is not supported by this host")
  }
  const parsedCompatibility: RemotePluginCompatibility = compatibleV1
    ? { pluginHost: remotePluginHostSchema, pluginSchema: webPluginManifestSchema }
    : compatibleV2
      ? { pluginHost: remotePluginHostSchemaV2, pluginSchema: webPluginManifestSchemaV2 }
      : compatibleV3
        ? { pluginHost: remotePluginHostSchemaV3, pluginSchema: webPluginManifestSchemaV3 }
        : compatibleV4
          ? { pluginHost: remotePluginHostSchemaV4, pluginSchema: webPluginManifestSchemaV4 }
          : compatibleV5
            ? { pluginHost: remotePluginCapabilitySchemaV1, pluginSchema: webPluginManifestSchemaV5 }
            : compatibleV6
              ? { pluginHost: remotePluginCapabilitySchemaV1, pluginSchema: webPluginManifestSchemaV6 }
              : { pluginHost: remotePluginCapabilitySchemaV1, pluginSchema: webPluginManifestSchemaV7 }
  let manifest: WebPluginManifest
  try {
    manifest = parseWebPluginManifest(input.manifest)
  } catch (error) {
    validationError(error instanceof Error ? error.message : "Remote Plugin manifest is invalid")
  }
  let id: string
  try {
    id = requireWebPluginId(input.id)
  } catch (error) {
    validationError(error instanceof Error ? error.message : "Remote Plugin id is invalid")
  }
  const name = requireString(input.name, "Remote Plugin name", 120)
  const description = requireString(input.description, "Remote Plugin description", 2_000)
  const version = requireSemver(input.version, "Remote Plugin version")
  if (
    parsedCompatibility.pluginSchema !== manifest.schema ||
    id !== manifest.id ||
    name !== manifest.name ||
    description !== manifest.description ||
    version !== manifest.version
  ) {
    validationError("Remote Plugin identity fields must exactly match its manifest")
  }
  const companions = parseCompanions(input.companions, { id, version }, manifest)
  return {
    artifact: parseArtifact(input.artifact),
    ...(companions ? { companions } : {}),
    compatibility: parsedCompatibility,
    description,
    id,
    kind: "plugin",
    manifest,
    name,
    version,
    yanked: requireBoolean(input.yanked, "Remote Plugin yanked"),
  }
}

function parseSkillPackage(input: Record<string, unknown>): RemoteSkillPackage {
  assertKeysWithOptional(
    input,
    ["artifact", "compatibility", "description", "id", "kind", "name", "version", "yanked"],
    ["ownerPluginId"],
    "Remote Skill package",
  )
  const compatibility = asRecord(input.compatibility, "Remote Skill compatibility")
  assertKeys(compatibility, ["skillSchema"], "Remote Skill compatibility")
  if (compatibility.skillSchema !== remoteSkillSchema) validationError("Remote Skill compatibility is not supported")
  return {
    artifact: parseArtifact(input.artifact),
    compatibility: { skillSchema: remoteSkillSchema },
    description: requireString(input.description, "Remote Skill description", 2_000),
    id: requireSkillId(input.id),
    kind: "skill",
    name: requireString(input.name, "Remote Skill name", 120),
    ...(input.ownerPluginId === undefined ? {} : { ownerPluginId: requireWebPluginId(input.ownerPluginId) }),
    version: requireSemver(input.version, "Remote Skill version"),
    yanked: requireBoolean(input.yanked, "Remote Skill yanked"),
  }
}

export function parseRemoteCapabilityPackage(value: unknown): RemoteCapabilityPackage {
  const input = asRecord(value, "Remote capability package")
  if (input.kind === "plugin") return parsePluginPackage(input)
  if (input.kind === "skill") return parseSkillPackage(input)
  validationError("Remote capability package kind must be plugin or skill")
}

export function remoteCapabilityPackageId(item: RemoteCapabilityPackage) {
  return item.id
}

export function remoteCapabilityPackageVersion(item: RemoteCapabilityPackage) {
  return item.version
}

export function parseRemoteCapabilityRegistry(value: unknown): RemoteCapabilityRegistry {
  const input = asRecord(value, "Remote capability registry")
  assertKeys(input, ["packages", "revision", "schema", "sequence"], "Remote capability registry")
  if (input.schema !== remoteCapabilityRegistrySchema)
    validationError("Remote capability registry schema is not supported")
  if (!Number.isSafeInteger(input.sequence) || (input.sequence as number) < 1) {
    validationError("Remote capability registry sequence must be a positive integer")
  }
  const revision = requireString(input.revision, "Remote capability registry revision", 64)
  if (!/^[a-f0-9]{40}$/.test(revision))
    validationError("Remote capability registry revision must be a lowercase Git commit SHA")
  if (!Array.isArray(input.packages) || input.packages.length > 10_000) {
    validationError("Remote capability registry packages must be an array of at most 10000 entries")
  }
  const packages = input.packages.map(parseRemoteCapabilityPackage)
  const identities = new Set<string>()
  const artifactUrls = new Set<string>()
  for (const item of packages) {
    const identity = `${item.kind}:${remoteCapabilityPackageId(item)}`
    if (identities.has(identity))
      validationError(`Remote capability registry contains a duplicate package: ${identity}`)
    if (artifactUrls.has(item.artifact.url))
      validationError(`Remote capability registry reuses an artifact URL: ${item.artifact.url}`)
    identities.add(identity)
    artifactUrls.add(item.artifact.url)
    if (item.kind === "plugin") {
      for (const companion of item.companions ?? []) {
        for (const target of companion.targets) {
          if (artifactUrls.has(target.artifact.url)) {
            validationError(`Remote capability registry reuses an artifact URL: ${target.artifact.url}`)
          }
          artifactUrls.add(target.artifact.url)
        }
      }
    }
  }
  const contributedSkillOwners = new Map<string, string>()
  for (const item of packages) {
    if (
      item.kind !== "plugin" ||
      (item.manifest.schema !== webPluginManifestSchemaV4 &&
        item.manifest.schema !== webPluginManifestSchemaV5 &&
        item.manifest.schema !== webPluginManifestSchemaV6 &&
        item.manifest.schema !== webPluginManifestSchemaV7)
    )
      continue
    for (const skill of item.manifest.contributes.skills ?? []) {
      const previousOwner = contributedSkillOwners.get(skill.name)
      if (previousOwner && previousOwner !== item.id) {
        validationError(`Remote capability registry assigns Plugin-owned Skill ${skill.name} to multiple Plugins`)
      }
      contributedSkillOwners.set(skill.name, item.id)
    }
  }
  const skillPackages = new Map(
    packages.filter((item): item is RemoteSkillPackage => item.kind === "skill").map((item) => [item.id, item]),
  )
  for (const [skillName, pluginId] of contributedSkillOwners) {
    if (!skillPackages.has(skillName)) {
      validationError(`Plugin ${pluginId} contributes Skill ${skillName} without a matching Registry package`)
    }
  }
  for (const item of packages) {
    if (item.kind !== "skill") continue
    const contributedOwner = contributedSkillOwners.get(item.id)
    if (item.ownerPluginId === undefined) {
      if (contributedOwner) {
        validationError(`Remote Skill ${item.id} must declare its owning Plugin: ${contributedOwner}`)
      }
      continue
    }
    if (contributedOwner !== item.ownerPluginId) {
      validationError(`Remote Skill ${item.id} owner does not match a Plugin Skill contribution: ${item.ownerPluginId}`)
    }
  }
  return { packages, revision, schema: remoteCapabilityRegistrySchema, sequence: input.sequence as number }
}

function requirePositiveInteger(value: unknown, label: string, maximum: number) {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    validationError(`${label} must be an integer between 1 and ${maximum}`)
  }
  return value as number
}

function parseShowcaseMedia<Mime extends RemoteShowcaseAnimationMime | RemoteShowcasePosterMime>(
  value: unknown,
  label: string,
  identity: Pick<RemoteCapabilityShowcasePackage, "id" | "kind" | "version">,
  allowedMimes: readonly Mime[],
  maxBytes: number,
): RemoteShowcaseMedia<Mime> {
  const input = asRecord(value, label)
  assertKeys(input, ["alt", "height", "mime", "sha256", "size", "url", "width"], label)
  const mime = requireString(input.mime, `${label} MIME type`, 64)
  if (!allowedMimes.includes(mime as Mime)) validationError(`${label} MIME type is not supported`)
  const sha256Value = requireString(input.sha256, `${label} SHA-256`, 64)
  if (!/^[a-f0-9]{64}$/.test(sha256Value)) validationError(`${label} SHA-256 must be 64 lowercase hex characters`)
  return {
    alt: requireString(input.alt, `${label} alt text`, 500),
    height: requirePositiveInteger(input.height, `${label} height`, 8_192),
    mime: mime as Mime,
    sha256: sha256Value,
    size: requirePositiveInteger(input.size, `${label} size`, maxBytes),
    url: assertOfficialShowcaseMediaUrl(input.url, identity, mime as Mime),
    width: requirePositiveInteger(input.width, `${label} width`, 8_192),
  }
}

function parseShowcasePackage(value: unknown): RemoteCapabilityShowcasePackage {
  const input = asRecord(value, "Remote showcase package")
  assertKeysWithOptional(input, ["id", "kind", "poster", "version"], ["animation"], "Remote showcase package")
  if (input.kind !== "plugin" && input.kind !== "skill") {
    validationError("Remote showcase package kind must be plugin or skill")
  }
  const kind: "plugin" | "skill" = input.kind
  let id: string
  if (kind === "skill") id = requireSkillId(input.id)
  else {
    try {
      id = requireWebPluginId(input.id)
    } catch (error) {
      validationError(error instanceof Error ? error.message : "Remote showcase Plugin id is invalid")
    }
  }
  const identity = { id, kind, version: requireSemver(input.version, "Remote showcase package version") }
  return {
    ...(Object.hasOwn(input, "animation")
      ? {
          animation: parseShowcaseMedia(
            input.animation,
            "Remote showcase animation",
            identity,
            ["image/gif", "video/mp4"],
            maxShowcaseAnimationBytes,
          ),
        }
      : {}),
    ...identity,
    poster: parseShowcaseMedia(
      input.poster,
      "Remote showcase poster",
      identity,
      ["image/jpeg", "image/png", "image/webp"],
      maxShowcasePosterBytes,
    ),
  }
}

export function parseRemoteCapabilityShowcase(
  value: unknown,
  registry: RemoteCapabilityRegistry,
): RemoteCapabilityShowcase {
  const input = asRecord(value, "Remote capability showcase")
  assertKeys(input, ["packages", "revision", "schema", "sequence"], "Remote capability showcase")
  if (input.schema !== remoteCapabilityShowcaseSchema)
    validationError("Remote capability showcase schema is not supported")
  if (input.sequence !== registry.sequence)
    validationError("Remote capability showcase sequence does not match the Registry")
  if (input.revision !== registry.revision)
    validationError("Remote capability showcase revision does not match the Registry")
  if (!Array.isArray(input.packages) || input.packages.length > registry.packages.length) {
    validationError("Remote capability showcase packages must be a bounded array")
  }
  const registryPackages = new Map(registry.packages.map((item) => [`${item.kind}:${item.id}`, item]))
  const identities = new Set<string>()
  const packages = input.packages.map((value) => {
    const item = parseShowcasePackage(value)
    const identity = `${item.kind}:${item.id}`
    if (identities.has(identity))
      validationError(`Remote capability showcase contains a duplicate package: ${identity}`)
    identities.add(identity)
    const registryPackage = registryPackages.get(identity)
    if (!registryPackage || registryPackage.yanked || registryPackage.version !== item.version) {
      validationError(`Remote capability showcase package does not match the current Registry: ${identity}`)
    }
    return item
  })
  return {
    packages,
    revision: registry.revision,
    schema: remoteCapabilityShowcaseSchema,
    sequence: registry.sequence,
  }
}

function sha256(bytes: string | Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function parseRegistryBody(body: string) {
  if (Buffer.byteLength(body) > maxRegistryBytes) validationError("Remote capability registry exceeds the size limit")
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    validationError("Remote capability registry is not valid JSON")
  }
  return parseRemoteCapabilityRegistry(value)
}

function parseShowcaseBody(body: string, registry: RemoteCapabilityRegistry) {
  if (Buffer.byteLength(body) > maxShowcaseIndexBytes)
    validationError("Remote capability showcase exceeds the size limit")
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    validationError("Remote capability showcase is not valid JSON")
  }
  return parseRemoteCapabilityShowcase(value, registry)
}

function bytesMatchShowcaseMime(bytes: Uint8Array, mime: RemoteShowcaseMime) {
  if (mime === "image/gif") {
    if (bytes.byteLength < 6) return false
    const signature = String.fromCharCode(...bytes.subarray(0, 6))
    return signature === "GIF87a" || signature === "GIF89a"
  }
  if (mime === "image/jpeg") {
    return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (mime === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    return bytes.byteLength >= signature.length && signature.every((value, index) => bytes[index] === value)
  }
  if (mime === "image/webp") {
    return (
      bytes.byteLength >= 12 &&
      String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
    )
  }
  return bytes.byteLength >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
}

function assertShowcaseContentType(response: Response, expected: RemoteShowcaseMime) {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US")
  if (contentType !== expected && contentType !== "application/octet-stream") {
    validationError(`Remote showcase media Content-Type does not match ${expected}`)
  }
}

function validEtag(value: string | null | undefined) {
  if (!value) return undefined
  if (value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) validationError("Remote registry ETag is invalid")
  return value
}

function abortError(signal?: AbortSignal) {
  if (signal?.reason instanceof Error) return signal.reason
  return new DOMException("Remote capability request was cancelled", "AbortError")
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
  label = "Remote capability request",
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > maxRemoteRequestTimeoutMs) {
    throw new Error(
      `Remote capability timeout must be an integer between 1 and ${maxRemoteRequestTimeoutMs} milliseconds`,
    )
  }
  if (externalSignal?.aborted) throw abortError(externalSignal)
  const controller = new AbortController()
  let timedOut = false
  const cancel = () => controller.abort(externalSignal?.reason)
  externalSignal?.addEventListener("abort", cancel, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    const result = await operation(controller.signal)
    // An operation can finish CPU/cache publication work after its signal was
    // aborted. Preserve safe cache side effects, but never report that cancelled
    // or timed-out caller as successful.
    if (externalSignal?.aborted) throw abortError(externalSignal)
    if (timedOut) throw new RemoteRegistryTimeoutError(`${label} timed out after ${timeoutMs}ms`)
    return result
  } catch (error) {
    if (externalSignal?.aborted) throw abortError(externalSignal)
    if (timedOut) throw new RemoteRegistryTimeoutError(`${label} timed out after ${timeoutMs}ms`)
    throw error
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener("abort", cancel)
  }
}

interface RemoteTransferTimeoutOptions {
  externalSignal?: AbortSignal
  inactivityTimeoutMs: number
  label: string
  timeoutMs: number
}

async function withTransferTimeout<T>(
  operation: (input: { progress: () => void; signal: AbortSignal }) => Promise<T>,
  options: RemoteTransferTimeoutOptions,
) {
  const { externalSignal, inactivityTimeoutMs, label, timeoutMs } = options
  if (
    !Number.isSafeInteger(inactivityTimeoutMs) ||
    inactivityTimeoutMs < 1 ||
    inactivityTimeoutMs > maxRemoteRequestTimeoutMs
  ) {
    throw new Error(
      `Remote transfer inactivity timeout must be an integer between 1 and ${maxRemoteRequestTimeoutMs} milliseconds`,
    )
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > maxRemoteTransferTimeoutMs) {
    throw new Error(
      `Remote transfer timeout must be an integer between 1 and ${maxRemoteTransferTimeoutMs} milliseconds`,
    )
  }
  if (externalSignal?.aborted) throw abortError(externalSignal)

  const controller = new AbortController()
  let completed = false
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined
  let interruption: Error | undefined
  let rejectInterruption!: (error: Error) => void
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectInterruption = reject
  })

  const interrupt = (error: Error) => {
    if (completed || interruption) return
    interruption = error
    controller.abort(error)
    rejectInterruption(error)
  }
  const progress = () => {
    if (completed || interruption) return
    if (inactivityTimer) clearTimeout(inactivityTimer)
    inactivityTimer = setTimeout(() => {
      interrupt(
        new RemoteRegistryTimeoutError(`${label} stalled for ${inactivityTimeoutMs}ms without receiving network data`),
      )
    }, inactivityTimeoutMs)
  }
  const onExternalAbort = () => interrupt(abortError(externalSignal))
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true })
  progress()
  const hardTimer = setTimeout(() => {
    interrupt(new RemoteRegistryTimeoutError(`${label} timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  const pending = Promise.resolve().then(() => operation({ progress, signal: controller.signal }))
  void pending.catch(() => undefined)

  try {
    return await Promise.race([pending, interrupted])
  } catch (error) {
    if (externalSignal?.aborted) throw abortError(externalSignal)
    if (interruption) throw interruption
    throw error
  } finally {
    completed = true
    clearTimeout(hardTimer)
    if (inactivityTimer) clearTimeout(inactivityTimer)
    externalSignal?.removeEventListener("abort", onExternalAbort)
  }
}

function parseContentLength(response: Response, maxBytes: number, label: string) {
  const header = response.headers.get("content-length")
  if (header === null) return undefined
  if (!/^(0|[1-9]\d*)$/.test(header)) validationError(`${label} Content-Length is invalid`)
  const length = Number(header)
  if (!Number.isSafeInteger(length) || length > maxBytes) validationError(`${label} exceeds the download size limit`)
  return length
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  label: string,
  signal: AbortSignal,
  onProgress?: () => void,
) {
  parseContentLength(response, maxBytes, label)
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) validationError(`${label} exceeds the download size limit`)
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  const cancelOnAbort = () => {
    void reader.cancel(abortError(signal)).catch(() => undefined)
  }
  signal.addEventListener("abort", cancelOnAbort, { once: true })
  try {
    while (true) {
      if (signal.aborted) throw abortError(signal)
      const result = await reader.read()
      if (result.done) {
        if (signal.aborted) throw abortError(signal)
        break
      }
      total += result.value.byteLength
      if (!Number.isSafeInteger(total) || total > maxBytes) validationError(`${label} exceeds the download size limit`)
      if (result.value.byteLength > 0) onProgress?.()
      chunks.push(result.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    signal.removeEventListener("abort", cancelOnAbort)
    reader.releaseLock()
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function assertConfiguredRegistryUrl(input: string) {
  const parsed = parseHttpsUrl(input, "Remote registry URL")
  if (parsed.search) validationError("Remote registry URL cannot contain query parameters")
  return parsed.toString()
}

async function fetchWithRedirects(
  fetchImplementation: RemoteCapabilityFetch,
  inputUrl: string,
  signal: AbortSignal,
  headers: Headers,
  purpose: "artifact" | "companion" | "registry",
  configuredRegistryUrl: string,
  onProgress?: () => void,
) {
  let currentUrl = inputUrl
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    if (purpose === "artifact") assertAllowedArtifactRequestUrl(currentUrl, redirectCount === 0)
    else if (purpose === "companion") assertAllowedCompanionRequestUrl(currentUrl, redirectCount === 0)
    else if (currentUrl !== configuredRegistryUrl)
      validationError("Remote registry redirected outside its configured index URL")
    let response: Response
    try {
      response = await fetchImplementation(currentUrl, { headers, redirect: "manual", signal })
    } catch (error) {
      if (signal.aborted) throw error
      throw new RemoteRegistryTransportError(error instanceof Error ? error.message : "Remote request failed", true)
    }
    onProgress?.()
    if (response.url) {
      if (purpose === "artifact") assertAllowedArtifactRequestUrl(response.url, response.url === inputUrl)
      else if (purpose === "companion") {
        assertAllowedCompanionRequestUrl(response.url, response.url === inputUrl)
      } else if (response.url !== configuredRegistryUrl) validationError("Remote registry response URL is not trusted")
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get("location")
    await response.body?.cancel().catch(() => undefined)
    if (!location) validationError("Remote capability redirect is missing its Location header")
    if (redirectCount === 5) validationError("Remote capability request exceeded the redirect limit")
    currentUrl = new URL(location, currentUrl).toString()
  }
  throw new Error("unreachable")
}

async function fetchShowcaseMediaWithRedirects(
  fetchImplementation: RemoteCapabilityFetch,
  inputUrl: string,
  signal: AbortSignal,
  headers: Headers,
  onProgress?: () => void,
) {
  let currentUrl = inputUrl
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    assertAllowedShowcaseMediaRequestUrl(currentUrl, redirectCount === 0)
    let response: Response
    try {
      response = await fetchImplementation(currentUrl, { headers, redirect: "manual", signal })
    } catch (error) {
      if (signal.aborted) throw error
      throw new RemoteRegistryTransportError(error instanceof Error ? error.message : "Remote showcase request failed")
    }
    onProgress?.()
    if (response.url) assertAllowedShowcaseMediaRequestUrl(response.url, redirectCount === 0)
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get("location")
    await response.body?.cancel().catch(() => undefined)
    if (!location) validationError("Remote showcase redirect is missing its Location header")
    if (redirectCount === 5) validationError("Remote showcase request exceeded the redirect limit")
    currentUrl = new URL(location, currentUrl).toString()
  }
  throw new Error("unreachable")
}

function cacheEntry(body: string, etag?: string): RemoteRegistryCacheEntry {
  return { body, ...(etag ? { etag } : {}), sha256: sha256(body) }
}

function readValidCache(entry: RemoteRegistryCacheEntry | null) {
  if (!entry) return null
  if (
    typeof entry.body !== "string" ||
    typeof entry.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    sha256(entry.body) !== entry.sha256
  ) {
    return null
  }
  try {
    return { entry, registry: parseRegistryBody(entry.body) }
  } catch {
    return null
  }
}

function readValidShowcaseCache(entry: RemoteRegistryCacheEntry | null, registry: RemoteCapabilityRegistry) {
  if (
    !entry ||
    typeof entry.body !== "string" ||
    typeof entry.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(entry.sha256) ||
    sha256(entry.body) !== entry.sha256
  ) {
    return null
  }
  try {
    return { entry, showcase: parseShowcaseBody(entry.body, registry) }
  } catch {
    return null
  }
}

function showcaseBytesAreValid(bytes: Uint8Array, media: RemoteShowcaseMedia<RemoteShowcaseMime>) {
  return bytes.byteLength === media.size && sha256(bytes) === media.sha256 && bytesMatchShowcaseMime(bytes, media.mime)
}

function sameRegistry(left: RemoteCapabilityRegistry, right: RemoteCapabilityRegistry) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export class MemoryRemoteRegistryCache implements RemoteRegistryCache {
  #entry: RemoteRegistryCacheEntry | null = null

  async read() {
    return this.#entry ? structuredClone(this.#entry) : null
  }

  async write(entry: RemoteRegistryCacheEntry) {
    this.#entry = structuredClone(entry)
  }
}

/** Main-only client for the fixed official Registry and its immutable Release assets. */
export class RemoteCapabilityRegistryClient {
  readonly #artifactCache?: RemoteArtifactCache
  readonly #cache: RemoteRegistryCache
  readonly #fetch: RemoteCapabilityFetch
  #lastRegistryRefreshStartedAt = Number.NEGATIVE_INFINITY
  readonly #now: () => number
  #registryCachePublication: Promise<void> = Promise.resolve()
  #registryHighWatermark?: NonNullable<ReturnType<typeof readValidCache>>
  readonly #registryListeners = new Set<() => void>()
  readonly #registryRevalidateMs: number
  #registryRequest?: Promise<RemoteRegistryFetchResult>
  readonly #registryUrl: string
  #showcaseCache?: RemoteCapabilityShowcase
  readonly #showcaseIndexCache: RemoteRegistryCache
  #showcaseCachePublication: Promise<void> = Promise.resolve()
  #showcaseLatestRegistry?: { revision: string; sequence: number }
  readonly #showcaseMediaCache?: RemoteShowcaseMediaCache
  readonly #showcaseMediaRequests = new Map<string, Promise<Uint8Array>>()
  #showcaseRequest?: { identity: string; promise: Promise<RemoteCapabilityShowcase> }
  readonly #showcaseUrl: string
  readonly #timeoutMs: number
  readonly #transferInactivityTimeoutMs: number
  readonly #transferTimeoutMs: number

  constructor(options: RemoteCapabilityRegistryClientOptions = {}) {
    this.#artifactCache = options.artifactCache
    this.#cache = options.cache ?? new MemoryRemoteRegistryCache()
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#now = options.now ?? Date.now
    this.#registryRevalidateMs = options.registryRevalidateMs ?? 5 * 60_000
    if (
      !Number.isSafeInteger(this.#registryRevalidateMs) ||
      this.#registryRevalidateMs < 1_000 ||
      this.#registryRevalidateMs > 24 * 60 * 60_000
    ) {
      throw new Error("Remote registry revalidation interval must be an integer between 1000 and 86400000 milliseconds")
    }
    this.#registryUrl = assertConfiguredRegistryUrl(options.registryUrl ?? officialRemoteRegistryIndexUrl)
    this.#showcaseIndexCache = options.showcaseCache ?? new MemoryRemoteRegistryCache()
    this.#showcaseMediaCache = options.showcaseMediaCache
    this.#showcaseUrl = assertConfiguredRegistryUrl(options.showcaseUrl ?? officialRemoteShowcaseIndexUrl)
    this.#timeoutMs = options.timeoutMs ?? defaultRemoteRequestTimeoutMs
    this.#transferInactivityTimeoutMs = options.transferInactivityTimeoutMs ?? defaultRemoteTransferInactivityTimeoutMs
    this.#transferTimeoutMs = options.transferTimeoutMs ?? defaultRemoteTransferTimeoutMs
  }

  #withRegistryCachePublication<T>(operation: () => Promise<T>) {
    const result = this.#registryCachePublication.then(operation)
    this.#registryCachePublication = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  #withShowcaseCachePublication(operation: () => Promise<void>) {
    const result = this.#showcaseCachePublication.then(operation)
    this.#showcaseCachePublication = result.catch(() => undefined)
    return result
  }

  async #readRegistryForPublication() {
    try {
      return readValidCache(await this.#cache.read())
    } catch (error) {
      if (error instanceof RemoteRegistryCacheCorruptionError) return null
      throw error
    }
  }

  #latestObservedRegistry(candidate: ReturnType<typeof readValidCache>) {
    const highWatermark = this.#registryHighWatermark
    if (!candidate) return highWatermark ? structuredClone(highWatermark) : null
    if (!highWatermark || candidate.registry.sequence > highWatermark.registry.sequence) {
      this.#registryHighWatermark = structuredClone(candidate)
      return candidate
    }
    if (candidate.registry.sequence < highWatermark.registry.sequence) return structuredClone(highWatermark)
    if (!sameRegistry(candidate.registry, highWatermark.registry)) return structuredClone(highWatermark)
    this.#registryHighWatermark = structuredClone(candidate)
    return candidate
  }

  subscribe(listener: () => void) {
    this.#registryListeners.add(listener)
    return () => this.#registryListeners.delete(listener)
  }

  #publishRegistryChange() {
    for (const listener of this.#registryListeners) {
      try {
        listener()
      } catch {
        // A presentation refresh cannot invalidate an already-published cache.
      }
    }
  }

  #publishRegistry(body: string, etag: string | undefined, registry: RemoteCapabilityRegistry) {
    return this.#withRegistryCachePublication(async () => {
      const latest = this.#latestObservedRegistry(await this.#readRegistryForPublication())
      if (latest) {
        if (registry.sequence < latest.registry.sequence) {
          validationError("Remote registry sequence would roll back the cache")
        }
        if (registry.sequence === latest.registry.sequence && !sameRegistry(registry, latest.registry)) {
          validationError("Remote registry changed without increasing its sequence")
        }
      }
      const entry = cacheEntry(body, etag)
      await this.#cache.write(entry)
      this.#latestObservedRegistry({ entry, registry })
      return Boolean(latest && !sameRegistry(registry, latest.registry))
    }).then((changed) => {
      if (changed) this.#publishRegistryChange()
    })
  }

  #publishNotModified(cached: NonNullable<ReturnType<typeof readValidCache>>, etag: string | undefined) {
    return this.#withRegistryCachePublication(async (): Promise<RemoteRegistryFetchResult> => {
      const onDisk = await this.#readRegistryForPublication()
      const latest = this.#latestObservedRegistry(onDisk)
      if (latest && latest.registry.sequence > cached.registry.sequence) {
        if (
          !onDisk ||
          onDisk.entry.body !== latest.entry.body ||
          onDisk.entry.etag !== latest.entry.etag ||
          !sameRegistry(onDisk.registry, latest.registry)
        ) {
          await this.#cache.write(latest.entry)
        }
        return {
          ...(latest.entry.etag ? { etag: latest.entry.etag } : {}),
          registry: latest.registry,
          source: "cache",
        }
      }
      if (latest?.registry.sequence === cached.registry.sequence && !sameRegistry(latest.registry, cached.registry)) {
        validationError("Remote registry changed without increasing its sequence")
      }
      const body = latest?.registry.sequence === cached.registry.sequence ? latest.entry.body : cached.entry.body
      const effectiveEtag = etag ?? cached.entry.etag
      const entry = cacheEntry(body, effectiveEtag)
      if (!onDisk || onDisk.entry.body !== body || onDisk.entry.etag !== effectiveEtag) {
        await this.#cache.write(entry)
      }
      this.#latestObservedRegistry({ entry, registry: cached.registry })
      return { ...(effectiveEtag ? { etag: effectiveEtag } : {}), registry: cached.registry, source: "not-modified" }
    })
  }

  async #fetchRegistryNetwork(
    cached: ReturnType<typeof readValidCache>,
    signal?: AbortSignal,
  ): Promise<RemoteRegistryFetchResult> {
    try {
      return await withTimeout(
        async (signal) => {
          const headers = new Headers({ accept: "application/json" })
          if (cached?.entry.etag) headers.set("if-none-match", validEtag(cached.entry.etag)!)
          const response = await fetchWithRedirects(
            this.#fetch,
            this.#registryUrl,
            signal,
            headers,
            "registry",
            this.#registryUrl,
          )
          if (response.status === 304) {
            if (!cached) validationError("Remote registry returned 304 without a valid cached index")
            const etag = validEtag(response.headers.get("etag")) ?? cached.entry.etag
            return this.#publishNotModified(cached, etag)
          }
          if (response.status !== 200)
            throw new RemoteRegistryTransportError(`Remote registry returned HTTP ${response.status}`)
          const bytes = await readBoundedBody(response, maxRegistryBytes, "Remote registry", signal)
          let body: string
          try {
            body = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
          } catch {
            validationError("Remote capability registry is not valid UTF-8")
          }
          const registry = parseRegistryBody(body)
          if (cached) {
            if (registry.sequence < cached.registry.sequence)
              validationError("Remote registry sequence would roll back the cache")
            if (registry.sequence === cached.registry.sequence && !sameRegistry(registry, cached.registry)) {
              validationError("Remote registry changed without increasing its sequence")
            }
          }
          const etag = validEtag(response.headers.get("etag"))
          await this.#publishRegistry(body, etag, registry)
          return { ...(etag ? { etag } : {}), registry, source: "network" }
        },
        this.#timeoutMs,
        signal,
        "Remote Registry request",
      )
    } catch (error) {
      if (signal?.aborted) throw abortError(signal)
      if (error instanceof RemoteRegistryValidationError || !cached) throw error
      const fallback = this.#latestObservedRegistry(cached)
      if (!fallback) throw error
      return {
        ...(fallback.entry.etag ? { etag: fallback.entry.etag } : {}),
        registry: fallback.registry,
        source: "cache",
        staleReason: error instanceof Error ? error.message : "Remote registry request failed",
      }
    }
  }

  #requestRegistryNetwork(cached: ReturnType<typeof readValidCache>, signal?: AbortSignal) {
    if (signal) return this.#fetchRegistryNetwork(cached, signal)
    if (this.#registryRequest) return this.#registryRequest
    this.#lastRegistryRefreshStartedAt = this.#now()
    const request = this.#fetchRegistryNetwork(cached).finally(() => {
      if (this.#registryRequest === request) this.#registryRequest = undefined
    })
    this.#registryRequest = request
    return request
  }

  #revalidateCachedRegistry(cached: NonNullable<ReturnType<typeof readValidCache>>) {
    if (this.#registryRequest || this.#now() - this.#lastRegistryRefreshStartedAt < this.#registryRevalidateMs) return
    void this.#requestRegistryNetwork(cached).catch(() => undefined)
  }

  async fetchRegistry(options: RemoteRegistryFetchOptions = {}): Promise<RemoteRegistryFetchResult> {
    if (options.signal?.aborted) throw abortError(options.signal)
    const cached = this.#latestObservedRegistry(readValidCache(await this.#cache.read().catch(() => null)))
    if (options.signal?.aborted) throw abortError(options.signal)
    if (options.cachePolicy === "cache-first" && cached) {
      this.#revalidateCachedRegistry(cached)
      return {
        ...(cached.entry.etag ? { etag: cached.entry.etag } : {}),
        registry: cached.registry,
        source: "cache",
      }
    }
    return this.#requestRegistryNetwork(cached, options.signal)
  }

  #observeShowcaseRegistry(registry: RemoteCapabilityRegistry) {
    const latest = this.#showcaseLatestRegistry
    if (!latest || registry.sequence > latest.sequence) {
      this.#showcaseLatestRegistry = { revision: registry.revision, sequence: registry.sequence }
      return
    }
    if (registry.sequence === latest.sequence && registry.revision !== latest.revision) {
      validationError("Remote showcase Registry changed without increasing its sequence")
    }
  }

  #isLatestShowcase(showcase: RemoteCapabilityShowcase) {
    const latest = this.#showcaseLatestRegistry
    return Boolean(latest && showcase.sequence === latest.sequence && showcase.revision === latest.revision)
  }

  #rememberShowcase(showcase: RemoteCapabilityShowcase) {
    if (this.#isLatestShowcase(showcase)) this.#showcaseCache = showcase
  }

  #publishShowcase(body: string, showcase: RemoteCapabilityShowcase) {
    return this.#withShowcaseCachePublication(async () => {
      if (!this.#isLatestShowcase(showcase)) return
      await this.#showcaseIndexCache.write(cacheEntry(body)).catch(() => undefined)
      this.#rememberShowcase(showcase)
    })
  }

  async #loadShowcase(
    registry: RemoteCapabilityRegistry,
    options: RemoteShowcaseDownloadOptions,
  ): Promise<RemoteCapabilityShowcase> {
    if (options.signal?.aborted) throw abortError(options.signal)
    const cached = readValidShowcaseCache(await this.#showcaseIndexCache.read().catch(() => null), registry)
    if (options.signal?.aborted) throw abortError(options.signal)
    if (cached) return cached.showcase
    let body = ""
    const showcase = await withTimeout(
      async (signal) => {
        const response = await fetchWithRedirects(
          this.#fetch,
          this.#showcaseUrl,
          signal,
          new Headers({ accept: "application/json" }),
          "registry",
          this.#showcaseUrl,
        )
        if (response.status !== 200) {
          throw new RemoteRegistryTransportError(`Remote showcase index returned HTTP ${response.status}`)
        }
        const bytes = await readBoundedBody(response, maxShowcaseIndexBytes, "Remote showcase index", signal)
        try {
          body = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
        } catch {
          validationError("Remote capability showcase is not valid UTF-8")
        }
        return parseShowcaseBody(body, registry)
      },
      options.timeoutMs ?? this.#timeoutMs,
      options.signal,
      "Remote showcase index request",
    )
    await this.#publishShowcase(body, showcase)
    return showcase
  }

  async #fetchShowcase(
    registry: RemoteCapabilityRegistry,
    options: RemoteShowcaseDownloadOptions,
  ): Promise<RemoteCapabilityShowcase> {
    if (options.signal?.aborted) throw abortError(options.signal)
    this.#observeShowcaseRegistry(registry)
    if (this.#showcaseCache?.sequence === registry.sequence && this.#showcaseCache.revision === registry.revision) {
      return this.#showcaseCache
    }
    const identity = `${registry.sequence}:${registry.revision}`
    if (!options.signal && options.timeoutMs === undefined && this.#showcaseRequest?.identity === identity) {
      return this.#showcaseRequest.promise
    }
    const load = this.#loadShowcase(registry, options)
    const request = load.then((showcase) => {
      this.#rememberShowcase(showcase)
      return showcase
    })
    if (!options.signal && options.timeoutMs === undefined) {
      const tracked = request.finally(() => {
        if (this.#showcaseRequest?.promise === tracked) this.#showcaseRequest = undefined
      })
      this.#showcaseRequest = { identity, promise: tracked }
      return tracked
    }
    const showcase = await request
    this.#rememberShowcase(showcase)
    return showcase
  }

  async #downloadShowcaseMedia(media: RemoteShowcaseMedia<RemoteShowcaseMime>, options: RemoteShowcaseDownloadOptions) {
    if (options.signal?.aborted) throw abortError(options.signal)
    const cached = await this.#showcaseMediaCache?.read({ sha256: media.sha256, size: media.size }).catch(() => null)
    if (options.signal?.aborted) throw abortError(options.signal)
    if (cached && showcaseBytesAreValid(cached, media)) return Uint8Array.from(cached)
    const bytes = await withTransferTimeout(
      async ({ progress, signal }) => {
        const response = await fetchShowcaseMediaWithRedirects(
          this.#fetch,
          media.url,
          signal,
          new Headers({ accept: media.mime }),
          progress,
        )
        if (response.status !== 200) {
          throw new RemoteRegistryTransportError(`Remote showcase media returned HTTP ${response.status}`)
        }
        assertShowcaseContentType(response, media.mime)
        return readBoundedBody(response, media.size, "Remote showcase media", signal, progress)
      },
      {
        externalSignal: options.signal,
        inactivityTimeoutMs: this.#transferInactivityTimeoutMs,
        label: "Remote showcase media download",
        timeoutMs: options.timeoutMs ?? this.#transferTimeoutMs,
      },
    )
    if (bytes.byteLength !== media.size) {
      validationError(`Remote showcase media size mismatch: expected ${media.size}, received ${bytes.byteLength}`)
    }
    if (sha256(bytes) !== media.sha256) validationError("Remote showcase media SHA-256 does not match the showcase")
    if (!bytesMatchShowcaseMime(bytes, media.mime)) {
      validationError(`Remote showcase media bytes do not match ${media.mime}`)
    }
    await this.#showcaseMediaCache?.write({ bytes, sha256: media.sha256 }).catch(() => undefined)
    return bytes
  }

  async #readOrDownloadShowcaseMedia(
    media: RemoteShowcaseMedia<RemoteShowcaseMime>,
    options: RemoteShowcaseDownloadOptions,
  ) {
    if (options.signal || options.timeoutMs !== undefined) return this.#downloadShowcaseMedia(media, options)
    const identity = `${media.sha256}:${media.size}:${media.mime}`
    const existing = this.#showcaseMediaRequests.get(identity)
    if (existing) return Uint8Array.from(await existing)
    const request = this.#downloadShowcaseMedia(media, options).finally(() => {
      if (this.#showcaseMediaRequests.get(identity) === request) this.#showcaseMediaRequests.delete(identity)
    })
    this.#showcaseMediaRequests.set(identity, request)
    return Uint8Array.from(await request)
  }

  async downloadSkillShowcase(
    registryValue: RemoteCapabilityRegistry,
    packageValue: RemoteSkillPackage,
    options: RemoteShowcaseDownloadOptions = {},
  ): Promise<RemoteSkillShowcaseDownload | null> {
    const registry = parseRemoteCapabilityRegistry(registryValue)
    const packageItem = parseRemoteCapabilityPackage(packageValue)
    if (packageItem.kind !== "skill") validationError("Remote Skill showcase requires a Skill package")
    const current = registry.packages.find((item) => item.kind === "skill" && item.id === packageItem.id)
    if (!current || JSON.stringify(current) !== JSON.stringify(packageItem) || current.yanked) {
      validationError("Remote Skill showcase package does not match the current Registry")
    }
    const showcase = await this.#fetchShowcase(registry, options)
    const mediaRole = options.media ?? "animation"
    const media = showcase.packages.find(
      (item) => item.kind === "skill" && item.id === packageItem.id && item.version === packageItem.version,
    )?.[mediaRole]
    if (!media) return null
    const bytes = await this.#readOrDownloadShowcaseMedia(media, options)
    return {
      altText: media.alt,
      bytes,
      mimeType: media.mime,
      size: media.size,
    }
  }

  async downloadCompanionArtifact(
    packageValue: RemotePluginPackage,
    companionValue: RemotePluginCompanion,
    targetValue: RemotePluginCompanionTarget,
    options: RemoteCompanionDownloadOptions = {},
  ): Promise<Uint8Array> {
    const item = parseRemoteCapabilityPackage(packageValue)
    if (item.kind !== "plugin") validationError("Remote companion download requires a Plugin package")
    if (item.yanked) validationError("Remote Plugin package is yanked and cannot be installed")
    const companion = item.companions?.find(
      (candidate) =>
        candidate.command === companionValue.command &&
        candidate.version === companionValue.version &&
        JSON.stringify(candidate) === JSON.stringify(companionValue),
    )
    if (!companion) validationError("Remote companion does not match its Plugin Registry entry")
    const target = companion.targets.find(
      (candidate) =>
        candidate.platform === targetValue.platform &&
        candidate.arch === targetValue.arch &&
        JSON.stringify(candidate) === JSON.stringify(targetValue),
    )
    if (!target) validationError("Remote companion target does not match its Plugin Registry entry")
    return this.#downloadArtifactBytes(
      target.artifact,
      options,
      "Remote companion artifact download",
      "Remote companion artifact",
      "Remote companion artifact SHA-256 does not match the Registry",
      async ({ progress, signal }) => {
        const response = await fetchWithRedirects(
          this.#fetch,
          target.artifact.url,
          signal,
          new Headers({ accept: "application/octet-stream" }),
          "companion",
          this.#registryUrl,
          progress,
        )
        if (response.status !== 200) {
          throw new RemoteRegistryTransportError(`Remote companion artifact returned HTTP ${response.status}`)
        }
        return readBoundedBody(response, target.artifact.size, "Remote companion artifact", signal, progress)
      },
    )
  }

  async downloadBundle(
    packageValue: RemoteCapabilityPackage,
    options: RemoteCapabilityDownloadOptions = {},
  ): Promise<RemoteCapabilityBundle> {
    const item = parseRemoteCapabilityPackage(packageValue)
    if (item.yanked) validationError(`Remote ${item.kind} package is yanked and cannot be installed`)
    const downloadLimit = options.maxBytes ?? maxArtifactBytes
    if (!Number.isSafeInteger(downloadLimit) || downloadLimit < 1 || downloadLimit > maxArtifactBytes) {
      throw new Error(`Remote artifact maxBytes must be an integer between 1 and ${maxArtifactBytes}`)
    }
    if (item.artifact.size > downloadLimit) validationError("Remote artifact declared size exceeds the download limit")
    const bytes = await this.#downloadArtifactBytes(
      item.artifact,
      options,
      `Remote ${item.kind === "plugin" ? "Plugin" : "Skill"} package download`,
      "Remote artifact",
      "Remote artifact SHA-256 does not match the registry",
      async ({ progress, signal }) => {
        const response = await fetchWithRedirects(
          this.#fetch,
          item.artifact.url,
          signal,
          new Headers({ accept: "application/zip" }),
          "artifact",
          this.#registryUrl,
          progress,
        )
        if (response.status !== 200)
          throw new RemoteRegistryTransportError(`Remote artifact returned HTTP ${response.status}`)
        return readBoundedBody(response, item.artifact.size, "Remote artifact", signal, progress)
      },
    )
    const files = unpackSafeZip(bytes, options.zipLimits)
    if (item.kind === "plugin") {
      const manifestBytes = files["manifest.json"]
      if (!manifestBytes) validationError("Remote Plugin bundle is missing manifest.json")
      let manifest: WebPluginManifest
      try {
        manifest = parseWebPluginManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)))
      } catch (error) {
        validationError(error instanceof Error ? error.message : "Remote Plugin bundle manifest is invalid")
      }
      if (JSON.stringify(manifest) !== JSON.stringify(item.manifest)) {
        validationError("Remote Plugin bundle manifest does not match the registry")
      }
    } else if (!files["SKILL.md"]) {
      validationError("Remote Skill bundle is missing SKILL.md")
    }
    return { files }
  }

  async #downloadArtifactBytes(
    artifact: RemoteCapabilityArtifact,
    options: { signal?: AbortSignal; timeoutMs?: number },
    label: string,
    validationLabel: string,
    digestError: string,
    download: (input: { progress: () => void; signal: AbortSignal }) => Promise<Uint8Array>,
  ) {
    if (options.signal?.aborted) throw abortError(options.signal)
    const cached = await this.#artifactCache?.read({ sha256: artifact.sha256, size: artifact.size }).catch(() => null)
    if (options.signal?.aborted) throw abortError(options.signal)
    if (cached && cached.byteLength === artifact.size && sha256(cached) === artifact.sha256) {
      return Uint8Array.from(cached)
    }

    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const bytes = await withTransferTimeout(download, {
          externalSignal: options.signal,
          inactivityTimeoutMs: this.#transferInactivityTimeoutMs,
          label,
          timeoutMs: options.timeoutMs ?? this.#transferTimeoutMs,
        })
        if (bytes.byteLength !== artifact.size) {
          validationError(`${validationLabel} size mismatch: expected ${artifact.size}, received ${bytes.byteLength}`)
        }
        if (sha256(bytes) !== artifact.sha256) validationError(digestError)
        await this.#artifactCache?.write({ bytes, sha256: artifact.sha256 }).catch(() => undefined)
        return bytes
      } catch (error) {
        if (options.signal?.aborted) throw abortError(options.signal)
        lastError = error
        const retryable =
          (error instanceof RemoteRegistryTimeoutError && error.message.includes(" stalled ")) ||
          (error instanceof RemoteRegistryTransportError
            ? error.retryable
            : !(error instanceof RemoteRegistryValidationError))
        if (!retryable || attempt === 1) throw error
      }
    }
    throw lastError
  }
}

/** Convenience for callers that only need one verified bundle. */
export async function downloadBundle(
  packageValue: RemoteCapabilityPackage,
  options: RemoteCapabilityDownloadOptions & RemoteCapabilityRegistryClientOptions = {},
) {
  const {
    artifactCache,
    cache,
    fetch,
    now,
    registryRevalidateMs,
    registryUrl,
    showcaseCache,
    showcaseMediaCache,
    showcaseUrl,
    transferInactivityTimeoutMs,
    transferTimeoutMs,
    timeoutMs,
    ...downloadOptions
  } = options
  return new RemoteCapabilityRegistryClient({
    artifactCache,
    cache,
    fetch,
    now,
    registryRevalidateMs,
    registryUrl,
    showcaseCache,
    showcaseMediaCache,
    showcaseUrl,
    transferInactivityTimeoutMs,
    transferTimeoutMs: transferTimeoutMs ?? timeoutMs,
    timeoutMs,
  }).downloadBundle(packageValue, downloadOptions)
}
