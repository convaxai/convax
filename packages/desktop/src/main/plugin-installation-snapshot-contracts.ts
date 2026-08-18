import { createHash } from "node:crypto"

import { requireWebPluginId, requireWebPluginRelativePath } from "../plugin-contracts"
import { pluginCapabilityTopologySchema, type PluginCapabilityTopology } from "./plugin-capability-binding-plan"

export const installedPluginSnapshotSchema = "convax.installed-plugin-snapshot/1" as const
export const legacyActivePluginSetSnapshotSchema = "convax.active-plugin-set-snapshot/1" as const
export const activePluginSetSnapshotSchema = "convax.active-plugin-set-snapshot/2" as const
export const activePluginPointerSchema = "convax.active-plugin-pointer/1" as const
export const pluginSnapshotOwnerPinsSchema = "convax.plugin-snapshot-owner-pins/1" as const

const digestPattern = /^[a-f0-9]{64}$/
const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const portableNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const maximumPackageFiles = 4_096
const maximumOwnedSkills = 64
const maximumSkillFiles = 512
const maximumActivePlugins = 256
const maximumOwnerPins = 4_096
const maximumDeclaredByteSize = 8 * 1024 * 1024 * 1024

export type PluginSnapshotDigest = string

export interface PluginSnapshotByteIdentity {
  readonly sha256: PluginSnapshotDigest
  readonly size: number
}

export interface PluginSnapshotFileIdentity extends PluginSnapshotByteIdentity {
  /** A normalized POSIX path relative to the artifact root, never a native path. */
  readonly path: string
}

export interface InstalledPluginPackageSnapshot {
  /** Exact downloaded package/archive identity. */
  readonly artifact: PluginSnapshotByteIdentity
  /** Exact normalized manifest bytes, which must also be `files/manifest.json`. */
  readonly manifest: PluginSnapshotByteIdentity
  /** Complete normalized package tree in stable path order. */
  readonly files: readonly PluginSnapshotFileIdentity[]
}

export interface InstalledPluginOwnedSkillSnapshot {
  readonly files: readonly PluginSnapshotFileIdentity[]
  readonly name: string
}

export interface InstalledPluginHookSnapshot extends PluginSnapshotByteIdentity {
  /** Package-relative entry whose bytes must match this private Hook snapshot. */
  readonly entryPath: string
}

export interface InstalledPluginCompanionSnapshot extends PluginSnapshotByteIdentity {
  readonly entryPath: string
  readonly mode: "convax-bun" | "native"
  readonly target: string
}

export interface InstalledPluginAuthorizationBindings {
  /**
   * Digest of the normalized capability declaration admitted by the Host.
   * This is authority metadata, not an OAuth token, Cookie, or preference.
   */
  readonly capabilityContractDigest: PluginSnapshotDigest
  /** Exact install-time companion execution binding, when a companion exists. */
  readonly companionExecutionDigest?: PluginSnapshotDigest
  /** Exact install-time Hook execution binding, when a Hook exists. */
  readonly hookExecutionDigest?: PluginSnapshotDigest
}

export interface InstalledPluginSnapshotInput {
  readonly authorizations: InstalledPluginAuthorizationBindings
  readonly companion?: InstalledPluginCompanionSnapshot
  readonly hook?: InstalledPluginHookSnapshot
  readonly ownedSkills: readonly InstalledPluginOwnedSkillSnapshot[]
  readonly package: InstalledPluginPackageSnapshot
  readonly pluginId: string
  /** Canonical Marketplace SourceKey digest; never a URL, credential, or native path. */
  readonly sourceIdentity: PluginSnapshotDigest
  readonly version: string
}

export interface InstalledPluginSnapshotDescriptor extends InstalledPluginSnapshotInput {
  readonly schema: typeof installedPluginSnapshotSchema
}

export interface InstalledPluginSnapshot {
  readonly descriptor: InstalledPluginSnapshotDescriptor
  readonly digest: PluginSnapshotDigest
}

export interface ActivePluginSnapshotReference {
  /** Random per-install incarnation carried atomically by the ActiveSet CAS. */
  readonly activationId: PluginSnapshotDigest
  readonly pluginId: string
  readonly snapshotDigest: PluginSnapshotDigest
}

export interface LegacyActivePluginSnapshotReference {
  readonly pluginId: string
  readonly snapshotDigest: PluginSnapshotDigest
}

export interface ActivePluginSetSnapshotDescriptor {
  readonly capabilityTopology: PluginCapabilityTopology
  readonly plugins: readonly ActivePluginSnapshotReference[]
  readonly schema: typeof activePluginSetSnapshotSchema
}

export interface LegacyActivePluginSetSnapshotDescriptor {
  readonly capabilityTopology: PluginCapabilityTopology
  readonly plugins: readonly LegacyActivePluginSnapshotReference[]
  readonly schema: typeof legacyActivePluginSetSnapshotSchema
}

export interface ActivePluginSetSnapshot {
  readonly descriptor: ActivePluginSetSnapshotDescriptor | LegacyActivePluginSetSnapshotDescriptor
  readonly digest: PluginSnapshotDigest
}

export interface ActivePluginSelection {
  readonly activeSet: ActivePluginSetSnapshot | null
  /** Zero denotes a pristine store with no pointer. Published pointers start at one. */
  readonly revision: number
}

export interface PluginSnapshotOwnerPin {
  readonly activeRevision: number
  readonly activeSetDigest: PluginSnapshotDigest
  readonly ownerKey: string
  readonly pluginId: string
  readonly snapshotDigest: PluginSnapshotDigest
}

export interface PersistentPluginSnapshotOwnerPins {
  readonly pins: readonly PluginSnapshotOwnerPin[]
  readonly revision: number
  readonly schema: typeof pluginSnapshotOwnerPinsSchema
}

export interface PluginSnapshotLease {
  readonly released: boolean
  release(): void
}

export interface PluginSnapshotOwnerPinLease {
  readonly activationId?: PluginSnapshotDigest
  readonly lease: PluginSnapshotLease
  readonly pin: PluginSnapshotOwnerPin
}

export interface PluginSnapshotReferenceLease {
  readonly activationId?: PluginSnapshotDigest
  readonly lease: PluginSnapshotLease
}

export interface PluginSnapshotGarbageCollectionEligibility {
  readonly active: boolean
  readonly eligible: boolean
  readonly leased: boolean
  readonly persistentlyPinned: boolean
  readonly snapshotDigest: PluginSnapshotDigest
}

export interface PluginSnapshotGarbageCollectionCandidates {
  readonly activeSetDigests: readonly PluginSnapshotDigest[]
  readonly installedSnapshotDigests: readonly PluginSnapshotDigest[]
}

export interface CollectedPluginSnapshotGarbage {
  readonly activeSetDigests: readonly PluginSnapshotDigest[]
  readonly installedSnapshotDigests: readonly PluginSnapshotDigest[]
}

export type PluginInstallationSnapshotFaultPoint =
  | "active-pointer.renamed"
  | "active-pointer.temp-synced"
  | "active-set.partial-written"
  | "active-set.renamed-before-pointer"
  | "installed-snapshot.partial-written"
  | "installed-snapshot.renamed"
  | "owner-pins.renamed"
  | "owner-pins.temp-synced"

export interface PluginInstallationSnapshotFaultContext {
  readonly digest?: PluginSnapshotDigest
  readonly revision?: number
}

export interface PluginInstallationSnapshotStoreOptions {
  /**
   * Tests may throw at a named durability boundary to model abrupt termination.
   * A thrown pre-rename hook intentionally leaves its private temporary file.
   */
  readonly faultHook?: (
    point: PluginInstallationSnapshotFaultPoint,
    context: PluginInstallationSnapshotFaultContext,
  ) => Promise<void> | void
}

export interface ActivePluginPointer {
  activeSetDigest: PluginSnapshotDigest
  revision: number
  schema: typeof activePluginPointerSchema
}

type CanonicalJson =
  | boolean
  | null
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson }

export class PluginInstallationSnapshotStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "PluginInstallationSnapshotStoreError"
  }
}

export class ActivePluginSetRevisionConflictError extends PluginInstallationSnapshotStoreError {
  readonly actualRevision: number
  readonly expectedRevision: number

  constructor(expectedRevision: number, actualRevision: number) {
    super(`Active Plugin set revision conflict: expected ${expectedRevision}, current ${actualRevision}`)
    this.name = "ActivePluginSetRevisionConflictError"
    this.expectedRevision = expectedRevision
    this.actualRevision = actualRevision
  }
}

export function snapshotError(message: string, cause?: unknown) {
  return new PluginInstallationSnapshotStoreError(message, cause === undefined ? undefined : { cause })
}

function compareStrings(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1
}

function strictRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw snapshotError(`${label} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw snapshotError(`${label} must be a plain object`)
  }
  return Object.fromEntries(Object.entries(value))
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort(compareStrings)
  const sortedExpected = [...expected].sort(compareStrings)
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw snapshotError(`${label} contains unsupported or missing fields`)
  }
}

function requireOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
) {
  const expected = [...required, ...optional.filter((key) => value[key] !== undefined)]
  requireExactKeys(value, expected, label)
}

function requireBoundedString(value: unknown, label: string, maximumLength: number) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw snapshotError(`${label} must be a bounded, trimmed string`)
  }
  return value
}

export function requireDigest(value: unknown, label: string): PluginSnapshotDigest {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw snapshotError(`${label} must be a lowercase SHA-256 digest`)
  }
  return value
}

function requireByteSize(value: unknown, label: string, allowEmpty: boolean) {
  if (!Number.isSafeInteger(value) || Number(value) < (allowEmpty ? 0 : 1) || Number(value) > maximumDeclaredByteSize) {
    throw snapshotError(`${label} has an invalid byte size`)
  }
  return Number(value)
}

export function requireRevision(value: unknown, label: string, allowZero: boolean) {
  if (!Number.isSafeInteger(value) || Number(value) < (allowZero ? 0 : 1)) {
    throw snapshotError(`${label} must be a non-negative safe integer`)
  }
  return Number(value)
}

function requireSemver(value: unknown) {
  const version = requireBoundedString(value, "Installed Plugin version", 255)
  if (!semverPattern.test(version)) throw snapshotError("Installed Plugin version must be valid SemVer")
  return version
}

function requirePortableName(value: unknown, label: string) {
  const name = requireBoundedString(value, label, 160)
  if (!portableNamePattern.test(name)) throw snapshotError(`${label} must use kebab-case`)
  requireWebPluginRelativePath(name, label)
  return name
}

function normalizeByteIdentity(value: unknown, label: string, allowEmpty: boolean): PluginSnapshotByteIdentity {
  const input = strictRecord(value, label)
  requireExactKeys(input, ["sha256", "size"], label)
  return {
    sha256: requireDigest(input.sha256, `${label} digest`),
    size: requireByteSize(input.size, label, allowEmpty),
  }
}

function normalizeFileIdentity(value: unknown, label: string): PluginSnapshotFileIdentity {
  const input = strictRecord(value, label)
  requireExactKeys(input, ["path", "sha256", "size"], label)
  let relativePath: string
  try {
    relativePath = requireWebPluginRelativePath(input.path, `${label} path`)
  } catch (error) {
    throw snapshotError(`${label} path is invalid`, error)
  }
  return {
    path: relativePath,
    sha256: requireDigest(input.sha256, `${label} digest`),
    size: requireByteSize(input.size, label, true),
  }
}

function normalizeFiles(value: unknown, label: string, maximum: number) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw snapshotError(`${label} must contain between 1 and ${maximum} files`)
  }
  const files = value.map((file, index) => normalizeFileIdentity(file, `${label} file ${index + 1}`))
  files.sort((left, right) => compareStrings(left.path, right.path))
  if (files.some((file, index) => index > 0 && files[index - 1]?.path === file.path)) {
    throw snapshotError(`${label} contains duplicate paths`)
  }
  return files
}

function normalizePackage(value: unknown): InstalledPluginPackageSnapshot {
  const input = strictRecord(value, "Installed Plugin package")
  requireExactKeys(input, ["artifact", "files", "manifest"], "Installed Plugin package")
  const artifact = normalizeByteIdentity(input.artifact, "Installed Plugin package artifact", false)
  const files = normalizeFiles(input.files, "Installed Plugin package", maximumPackageFiles)
  const manifest = normalizeByteIdentity(input.manifest, "Installed Plugin manifest", false)
  const manifestFile = files.find((file) => file.path === "manifest.json")
  if (!manifestFile || manifestFile.sha256 !== manifest.sha256 || manifestFile.size !== manifest.size) {
    throw snapshotError("Installed Plugin manifest must match package file manifest.json")
  }
  return { artifact, files, manifest }
}

function normalizeOwnedSkills(value: unknown) {
  if (!Array.isArray(value) || value.length > maximumOwnedSkills) {
    throw snapshotError(`Installed Plugin owned Skills must contain at most ${maximumOwnedSkills} entries`)
  }
  const skills = value.map((raw, index): InstalledPluginOwnedSkillSnapshot => {
    const input = strictRecord(raw, `Installed Plugin owned Skill ${index + 1}`)
    requireExactKeys(input, ["files", "name"], `Installed Plugin owned Skill ${index + 1}`)
    const name = requirePortableName(input.name, "Installed Plugin owned Skill name")
    const files = normalizeFiles(input.files, `Installed Plugin owned Skill ${name}`, maximumSkillFiles)
    if (!files.some((file) => file.path === "SKILL.md")) {
      throw snapshotError(`Installed Plugin owned Skill ${name} must contain SKILL.md`)
    }
    return { files, name }
  })
  skills.sort((left, right) => compareStrings(left.name, right.name))
  if (skills.some((skill, index) => index > 0 && skills[index - 1]?.name === skill.name)) {
    throw snapshotError("Installed Plugin owned Skills contain duplicate names")
  }
  return skills
}

function normalizeHook(value: unknown): InstalledPluginHookSnapshot {
  const input = strictRecord(value, "Installed Plugin Hook")
  requireExactKeys(input, ["entryPath", "sha256", "size"], "Installed Plugin Hook")
  let entryPath: string
  try {
    entryPath = requireWebPluginRelativePath(input.entryPath, "Installed Plugin Hook entry")
  } catch (error) {
    throw snapshotError("Installed Plugin Hook entry is invalid", error)
  }
  if (!entryPath.endsWith(".js") && !entryPath.endsWith(".mjs")) {
    throw snapshotError("Installed Plugin Hook entry must be a JavaScript ESM file")
  }
  return {
    entryPath,
    sha256: requireDigest(input.sha256, "Installed Plugin Hook digest"),
    size: requireByteSize(input.size, "Installed Plugin Hook", false),
  }
}

function normalizeCompanion(value: unknown): InstalledPluginCompanionSnapshot {
  const input = strictRecord(value, "Installed Plugin companion")
  requireExactKeys(input, ["entryPath", "mode", "sha256", "size", "target"], "Installed Plugin companion")
  let entryPath: string
  try {
    entryPath = requireWebPluginRelativePath(input.entryPath, "Installed Plugin companion entry")
  } catch (error) {
    throw snapshotError("Installed Plugin companion entry is invalid", error)
  }
  if (input.mode !== "convax-bun" && input.mode !== "native") {
    throw snapshotError("Installed Plugin companion mode is unsupported")
  }
  return {
    entryPath,
    mode: input.mode,
    sha256: requireDigest(input.sha256, "Installed Plugin companion digest"),
    size: requireByteSize(input.size, "Installed Plugin companion", false),
    target: requirePortableName(input.target, "Installed Plugin companion target"),
  }
}

function normalizeAuthorizations(
  value: unknown,
  hasCompanion: boolean,
  hasHook: boolean,
): InstalledPluginAuthorizationBindings {
  const input = strictRecord(value, "Installed Plugin authorization bindings")
  requireOptionalKeys(
    input,
    ["capabilityContractDigest"],
    ["companionExecutionDigest", "hookExecutionDigest"],
    "Installed Plugin authorization bindings",
  )
  const companionExecutionDigest =
    input.companionExecutionDigest === undefined
      ? undefined
      : requireDigest(input.companionExecutionDigest, "Installed Plugin companion execution binding")
  const hookExecutionDigest =
    input.hookExecutionDigest === undefined
      ? undefined
      : requireDigest(input.hookExecutionDigest, "Installed Plugin Hook execution binding")
  if (!hasCompanion && companionExecutionDigest !== undefined) {
    throw snapshotError("Installed Plugin companion execution binding requires an immutable companion")
  }
  if (!hasHook && hookExecutionDigest !== undefined) {
    throw snapshotError("Installed Plugin Hook execution binding requires an immutable Hook")
  }
  return {
    capabilityContractDigest: requireDigest(input.capabilityContractDigest, "Installed Plugin capability contract"),
    ...(companionExecutionDigest === undefined ? {} : { companionExecutionDigest }),
    ...(hookExecutionDigest === undefined ? {} : { hookExecutionDigest }),
  }
}

export function normalizeInstalledDescriptor(value: unknown, persisted: boolean): InstalledPluginSnapshotDescriptor {
  const input = strictRecord(value, "Installed Plugin snapshot")
  const required = ["authorizations", "ownedSkills", "package", "pluginId", "sourceIdentity", "version"]
  const optional = ["companion", "hook"]
  if (persisted) required.push("schema")
  requireOptionalKeys(input, required, optional, "Installed Plugin snapshot")
  if (persisted && input.schema !== installedPluginSnapshotSchema) {
    throw snapshotError("Installed Plugin snapshot schema is unsupported")
  }
  const pluginPackage = normalizePackage(input.package)
  const hook = input.hook === undefined ? undefined : normalizeHook(input.hook)
  const companion = input.companion === undefined ? undefined : normalizeCompanion(input.companion)
  if (hook) {
    const packageEntry = pluginPackage.files.find((file) => file.path === hook.entryPath)
    if (!packageEntry || packageEntry.sha256 !== hook.sha256 || packageEntry.size !== hook.size) {
      throw snapshotError("Installed Plugin Hook must match its package entry")
    }
  }
  let pluginId: string
  try {
    pluginId = requireWebPluginId(input.pluginId)
  } catch (error) {
    throw snapshotError("Installed Plugin id is invalid", error)
  }
  return {
    authorizations: normalizeAuthorizations(input.authorizations, companion !== undefined, hook !== undefined),
    ...(companion === undefined ? {} : { companion }),
    ...(hook === undefined ? {} : { hook }),
    ownedSkills: normalizeOwnedSkills(input.ownedSkills),
    package: pluginPackage,
    pluginId,
    schema: installedPluginSnapshotSchema,
    sourceIdentity: requireDigest(input.sourceIdentity, "Installed Plugin source identity"),
    version: requireSemver(input.version),
  }
}

function normalizeActiveReferences(value: unknown, legacy: boolean) {
  if (!Array.isArray(value) || value.length > maximumActivePlugins) {
    throw snapshotError(`Active Plugin set must contain at most ${maximumActivePlugins} Plugins`)
  }
  const plugins = value.map((raw, index): ActivePluginSnapshotReference | LegacyActivePluginSnapshotReference => {
    const input = strictRecord(raw, `Active Plugin reference ${index + 1}`)
    requireExactKeys(
      input,
      legacy ? ["pluginId", "snapshotDigest"] : ["activationId", "pluginId", "snapshotDigest"],
      `Active Plugin reference ${index + 1}`,
    )
    let pluginId: string
    try {
      pluginId = requireWebPluginId(input.pluginId)
    } catch (error) {
      throw snapshotError(`Active Plugin reference ${index + 1} has an invalid Plugin id`, error)
    }
    return {
      ...(legacy
        ? {}
        : {
            activationId: requireDigest(input.activationId, `Active Plugin reference ${index + 1} activation id`),
          }),
      pluginId,
      snapshotDigest: requireDigest(input.snapshotDigest, `Active Plugin reference ${index + 1} digest`),
    }
  })
  plugins.sort((left, right) => compareStrings(left.pluginId, right.pluginId))
  if (plugins.some((plugin, index) => index > 0 && plugins[index - 1]?.pluginId === plugin.pluginId)) {
    throw snapshotError("Active Plugin set contains duplicate Plugin ids")
  }
  return plugins
}

export function normalizeActiveSetDescriptor(value: unknown, persisted: false): ActivePluginSetSnapshotDescriptor
export function normalizeActiveSetDescriptor(
  value: unknown,
  persisted: true,
): ActivePluginSetSnapshotDescriptor | LegacyActivePluginSetSnapshotDescriptor
export function normalizeActiveSetDescriptor(
  value: unknown,
  persisted: boolean,
): ActivePluginSetSnapshotDescriptor | LegacyActivePluginSetSnapshotDescriptor {
  const input = strictRecord(value, "Active Plugin set snapshot")
  requireExactKeys(
    input,
    persisted ? ["capabilityTopology", "plugins", "schema"] : ["capabilityTopology", "plugins"],
    "Active Plugin set snapshot",
  )
  if (
    persisted &&
    input.schema !== activePluginSetSnapshotSchema &&
    input.schema !== legacyActivePluginSetSnapshotSchema
  ) {
    throw snapshotError("Active Plugin set snapshot schema is unsupported")
  }
  const legacy = persisted && input.schema === legacyActivePluginSetSnapshotSchema
  const capabilityTopology = normalizeCapabilityTopology(input.capabilityTopology)
  if (legacy) {
    return {
      capabilityTopology,
      plugins: normalizeActiveReferences(input.plugins, true) as LegacyActivePluginSnapshotReference[],
      schema: legacyActivePluginSetSnapshotSchema,
    }
  }
  return {
    capabilityTopology,
    plugins: normalizeActiveReferences(input.plugins, false) as ActivePluginSnapshotReference[],
    schema: activePluginSetSnapshotSchema,
  }
}

function normalizeCapabilityTopology(value: unknown): PluginCapabilityTopology {
  const input = strictRecord(value, "Plugin capability topology")
  requireExactKeys(input, ["descriptor", "topologyDigest"], "Plugin capability topology")
  const topologyDigest = requireDigest(input.topologyDigest, "Plugin capability topology digest")
  const descriptor = strictRecord(input.descriptor, "Plugin capability topology descriptor")
  requireExactKeys(descriptor, ["bindings", "schema"], "Plugin capability topology descriptor")
  if (descriptor.schema !== pluginCapabilityTopologySchema || !Array.isArray(descriptor.bindings)) {
    throw snapshotError("Plugin capability topology descriptor is invalid")
  }
  const canonicalDescriptor = JSON.parse(
    pluginSnapshotCanonicalJson(descriptor),
  ) as PluginCapabilityTopology["descriptor"]
  if (pluginSnapshotCanonicalDigest(canonicalDescriptor) !== topologyDigest) {
    throw snapshotError("Plugin capability topology digest does not match its descriptor")
  }
  return deepFreeze({ descriptor: canonicalDescriptor, topologyDigest })
}

export function normalizePointer(value: unknown): ActivePluginPointer {
  const input = strictRecord(value, "Active Plugin pointer")
  requireExactKeys(input, ["activeSetDigest", "revision", "schema"], "Active Plugin pointer")
  if (input.schema !== activePluginPointerSchema) {
    throw snapshotError("Active Plugin pointer schema is unsupported")
  }
  return {
    activeSetDigest: requireDigest(input.activeSetDigest, "Active Plugin set digest"),
    revision: requireRevision(input.revision, "Active Plugin pointer revision", false),
    schema: activePluginPointerSchema,
  }
}

export function normalizeDigestList(value: unknown, label: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw snapshotError(`${label} must contain at most ${maximum} digests`)
  }
  const digests = value.map((digest, index) => requireDigest(digest, `${label} entry ${index + 1}`))
  digests.sort(compareStrings)
  if (digests.some((digest, index) => index > 0 && digests[index - 1] === digest)) {
    throw snapshotError(`${label} contains duplicate digests`)
  }
  return digests
}

export function requireOwnerKey(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 384 ||
    !/^[a-z][a-z0-9-]{0,63}:[A-Za-z0-9][A-Za-z0-9._:-]{0,319}$/.test(value)
  ) {
    throw snapshotError("Plugin snapshot pin owner key is invalid")
  }
  return value
}

export function normalizeOwnerPin(value: unknown): PluginSnapshotOwnerPin {
  const input = strictRecord(value, "Plugin snapshot owner pin")
  requireExactKeys(
    input,
    ["activeRevision", "activeSetDigest", "ownerKey", "pluginId", "snapshotDigest"],
    "Plugin snapshot owner pin",
  )
  return {
    activeRevision: requireRevision(input.activeRevision, "Plugin snapshot owner pin revision", false),
    activeSetDigest: requireDigest(input.activeSetDigest, "Plugin snapshot owner ActiveSet digest"),
    ownerKey: requireOwnerKey(input.ownerKey),
    pluginId: requireWebPluginId(input.pluginId),
    snapshotDigest: requireDigest(input.snapshotDigest, "Plugin snapshot owner snapshot digest"),
  }
}

export function normalizeOwnerPins(value: unknown): PersistentPluginSnapshotOwnerPins {
  const input = strictRecord(value, "Plugin snapshot owner pins")
  requireExactKeys(input, ["pins", "revision", "schema"], "Plugin snapshot owner pins")
  if (input.schema !== pluginSnapshotOwnerPinsSchema || !Array.isArray(input.pins)) {
    throw snapshotError("Plugin snapshot owner pins schema is unsupported")
  }
  if (input.pins.length > maximumOwnerPins) {
    throw snapshotError(`Plugin snapshot owner pins must contain at most ${maximumOwnerPins} entries`)
  }
  const pins = input.pins.map(normalizeOwnerPin).sort((left, right) => compareStrings(left.ownerKey, right.ownerKey))
  if (pins.some((pin, index) => index > 0 && pins[index - 1]?.ownerKey === pin.ownerKey)) {
    throw snapshotError("Plugin snapshot owner pins contain duplicate owner keys")
  }
  return {
    pins,
    revision: requireRevision(input.revision, "Plugin snapshot owner pins revision", false),
    schema: pluginSnapshotOwnerPinsSchema,
  }
}

function canonicalize(value: unknown, seen: Set<object>): CanonicalJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw snapshotError("Canonical JSON cannot contain a non-finite number")
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value !== "object") {
    throw snapshotError("Canonical JSON contains a non-JSON value")
  }
  if (seen.has(value)) throw snapshotError("Canonical JSON cannot contain cycles")
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen))
    const record = strictRecord(value, "Canonical JSON object")
    const result: Record<string, CanonicalJson> = {}
    for (const key of Object.keys(record).sort(compareStrings)) {
      result[key] = canonicalize(record[key], seen)
    }
    return result
  } finally {
    seen.delete(value)
  }
}

/** RFC-8259-shaped canonical JSON with recursively sorted object keys and no insignificant whitespace. */
export function pluginSnapshotCanonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value, new Set()))
}

/** SHA-256 over `pluginSnapshotCanonicalJson(value)`. */
export function pluginSnapshotCanonicalDigest(value: unknown): PluginSnapshotDigest {
  return createHash("sha256").update(pluginSnapshotCanonicalJson(value), "utf8").digest("hex")
}

export function deepFreeze<Value>(value: Value, seen = new Set<object>()): Value {
  if (!value || typeof value !== "object" || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}
