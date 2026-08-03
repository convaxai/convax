import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { PLUGIN_API_CATALOG_MAJOR } from "@convax/plugin-api"

import {
  parseWebPluginManifest,
  requireWebPluginId,
  requireWebPluginRelativePath,
  toInstalledWebPluginSummary,
  type InstalledWebPluginSummary,
} from "../plugin-contracts"
import {
  pluginSnapshotCanonicalDigest,
  type InstalledPluginAuthorizationBindings,
  type InstalledPluginCompanionSnapshot,
  type InstalledPluginSnapshot,
  type InstalledPluginSnapshotInput,
  type PluginSnapshotByteIdentity,
  type PluginSnapshotDigest,
  type PluginSnapshotFileIdentity,
  type PluginSnapshotLease,
} from "./plugin-installation-snapshots"
import {
  PluginExecutionSetupRequiredError,
  pluginInstallationRuntimeError,
  type ActivePluginRuntimeHandle,
  type ActivePluginRuntimeIdentity,
  type PluginInstallationCandidate,
  type PluginInstallationRuntimeOptions,
} from "./plugin-installation-runtime-contracts"

const maximumPackageFiles = 4_096
const maximumPackageBytes = 64 * 1024 * 1024
const maximumFileBytes = 16 * 1024 * 1024
const digestPattern = /^[a-f0-9]{64}$/
const runtimeError = pluginInstallationRuntimeError

function compareText(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1
}

function digest(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex")
}

function requireDigest(value: unknown, label: string) {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw runtimeError(`${label} must be a lowercase SHA-256 digest`)
  }
  return value
}

function bytesFor(value: string | Uint8Array) {
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw runtimeError(`${label} must be an object`)
  }
  return value
}

function normalizeCandidateFiles(files: Readonly<Record<string, string | Uint8Array>>) {
  const entries = Object.entries(files)
  if (entries.length < 1 || entries.length > maximumPackageFiles) {
    throw runtimeError(`Plugin package must contain between 1 and ${maximumPackageFiles} files`)
  }
  let totalBytes = 0
  const portablePaths = new Set<string>()
  const portableDirectories = new Map<string, string>()
  const normalized = entries
    .map(([relativePathInput, value]) => {
      const relativePath = requireWebPluginRelativePath(relativePathInput, "Plugin package path")
      const portablePath = relativePath.toLocaleLowerCase("en-US")
      if (portablePaths.has(portablePath)) {
        throw runtimeError(`Plugin package paths collide on case-insensitive filesystems: ${relativePath}`)
      }
      portablePaths.add(portablePath)
      const segments = relativePath.split("/")
      for (let index = 1; index < segments.length; index += 1) {
        const directory = segments.slice(0, index).join("/")
        const portableDirectory = directory.toLocaleLowerCase("en-US")
        const prior = portableDirectories.get(portableDirectory)
        if (prior && prior !== directory) {
          throw runtimeError(`Plugin package directories collide on case-insensitive filesystems: ${directory}`)
        }
        portableDirectories.set(portableDirectory, directory)
      }
      const bytes = bytesFor(value)
      if (bytes.byteLength > maximumFileBytes) {
        throw runtimeError(`Plugin package file exceeds the byte limit: ${relativePath}`)
      }
      totalBytes += bytes.byteLength
      if (totalBytes > maximumPackageBytes) throw runtimeError("Plugin package exceeds the total byte limit")
      return { bytes, path: relativePath }
    })
    .sort((left, right) => compareText(left.path, right.path))
  for (const portableDirectory of portableDirectories.keys()) {
    if (portablePaths.has(portableDirectory)) {
      throw runtimeError("Plugin package path cannot be both a file and a directory")
    }
  }
  return normalized
}

function fileIdentity(file: { bytes: Uint8Array; path: string }): PluginSnapshotFileIdentity {
  return {
    path: file.path,
    sha256: digest(file.bytes),
    size: file.bytes.byteLength,
  }
}

function requireArtifact(value: PluginSnapshotByteIdentity): PluginSnapshotByteIdentity {
  if (!value || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 8 * 1024 * 1024 * 1024) {
    throw runtimeError("Plugin artifact size is invalid")
  }
  return { sha256: requireDigest(value.sha256, "Plugin artifact digest"), size: value.size }
}

function requireSourceIdentity(value: string) {
  return requireDigest(value, "Plugin source identity")
}

function normalizeAuthorizationBindings(
  manifest: InstalledWebPluginSummary,
  companion: InstalledPluginCompanionSnapshot | undefined,
  hook: InstalledPluginSnapshotInput["hook"],
  sourceIdentity: PluginSnapshotDigest,
  input: PluginInstallationCandidate["executionAuthorization"],
): InstalledPluginAuthorizationBindings {
  const capabilityContractDigest = pluginSnapshotCanonicalDigest(manifest)
  if (input?.companion && !companion) throw runtimeError("Plugin has no immutable companion to authorize")
  if (input?.hook && !hook) throw runtimeError("Plugin has no immutable Hook to authorize")
  const descriptor = {
    authorizations: { capabilityContractDigest },
    ...(companion ? { companion } : {}),
    ...(hook ? { hook } : {}),
    pluginId: manifest.id,
    sourceIdentity,
    version: manifest.version,
  }
  return Object.freeze({
    capabilityContractDigest,
    ...(input?.companion ? { companionExecutionDigest: pluginExecutionBindingDigest(descriptor, "companion") } : {}),
    ...(input?.hook ? { hookExecutionDigest: pluginExecutionBindingDigest(descriptor, "hook") } : {}),
  })
}

export function pluginExecutionBindingDigest(
  descriptor: Pick<
    InstalledPluginSnapshot["descriptor"],
    "authorizations" | "companion" | "hook" | "pluginId" | "sourceIdentity" | "version"
  >,
  surface: "companion" | "hook",
) {
  const artifact = surface === "companion" ? descriptor.companion : descriptor.hook
  if (!artifact) throw runtimeError(`Plugin does not contain an immutable ${surface} execution artifact`)
  return pluginSnapshotCanonicalDigest({
    artifact,
    capabilityContractDigest: descriptor.authorizations.capabilityContractDigest,
    pluginId: descriptor.pluginId,
    schema: "convax.plugin-execution-binding/1",
    sourceIdentity: descriptor.sourceIdentity,
    surface,
    version: descriptor.version,
  })
}

export function preparePluginInstallationCandidate(candidate: PluginInstallationCandidate) {
  const files = normalizeCandidateFiles(candidate.files)
  const manifestFile = files.find((file) => file.path === "manifest.json")
  if (!manifestFile) throw runtimeError("Plugin package is missing manifest.json")
  let manifest: InstalledWebPluginSummary
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(manifestFile.bytes)
    manifest = toInstalledWebPluginSummary(parseWebPluginManifest(JSON.parse(text)))
  } catch (error) {
    throw runtimeError("Plugin package manifest is invalid", error)
  }
  const identities = files.map(fileIdentity)
  const fileByPath = new Map(identities.map((identity) => [identity.path, identity]))
  const ownedSkills = (manifest.contributes.skills ?? []).map((skill) => {
    const prefix = `${skill.path}/`
    const skillFiles = identities
      .filter((identity) => identity.path.startsWith(prefix))
      .map((identity) => ({ ...identity, path: identity.path.slice(prefix.length) }))
    if (!skillFiles.some((identity) => identity.path === "SKILL.md")) {
      throw runtimeError(`Plugin-owned Skill is missing SKILL.md: ${skill.name}`)
    }
    return { files: skillFiles, name: skill.name }
  })
  const hookIdentity = manifest.hooks ? fileByPath.get(manifest.hooks) : undefined
  if (manifest.hooks && !hookIdentity) throw runtimeError("Plugin Hook is missing from the immutable package")
  let companion: InstalledPluginCompanionSnapshot | undefined
  if (candidate.companion) {
    if (!manifest.runtime) {
      throw runtimeError("Static or remote-MCP Plugin cannot publish a native companion")
    }
    const entryPath = requireWebPluginRelativePath(candidate.companion.entryPath, "Plugin companion entry")
    const companionBytes = bytesFor(candidate.companion.bytes)
    if (companionBytes.byteLength < 1 || companionBytes.byteLength > 128 * 1024 * 1024) {
      throw runtimeError("Plugin companion byte size is invalid")
    }
    companion = {
      entryPath,
      mode: candidate.companion.mode,
      sha256: digest(companionBytes),
      size: companionBytes.byteLength,
      target: candidate.companion.target,
    }
  }
  const sourceIdentity = requireSourceIdentity(candidate.sourceIdentity)
  const hook = hookIdentity
    ? { entryPath: hookIdentity.path, sha256: hookIdentity.sha256, size: hookIdentity.size }
    : undefined
  const input: InstalledPluginSnapshotInput = {
    authorizations: normalizeAuthorizationBindings(
      manifest,
      companion,
      hook,
      sourceIdentity,
      candidate.executionAuthorization,
    ),
    ...(companion === undefined ? {} : { companion }),
    ...(hook === undefined ? {} : { hook }),
    ownedSkills,
    package: {
      artifact: requireArtifact(candidate.artifact),
      files: identities,
      manifest: {
        sha256: digest(manifestFile.bytes),
        size: manifestFile.bytes.byteLength,
      },
    },
    pluginId: manifest.id,
    sourceIdentity,
    version: manifest.version,
  }
  return {
    companionBytes: candidate.companion ? bytesFor(candidate.companion.bytes) : undefined,
    files,
    input,
    manifest,
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code
}

async function exists(target: string) {
  try {
    await fs.lstat(target)
    return true
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false
    throw error
  }
}

async function requireRealDirectory(directory: string, label: string, mode: number) {
  const info = await fs.lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) throw runtimeError(`${label} must be a real directory`)
  const [real, realParent] = await Promise.all([fs.realpath(directory), fs.realpath(path.dirname(directory))])
  if (real !== path.join(realParent, path.basename(directory))) {
    throw runtimeError(`${label} cannot resolve through a symbolic link`)
  }
  if (process.platform !== "win32") {
    await fs.chmod(real, mode)
    if (((await fs.lstat(real)).mode & 0o777) !== mode) throw runtimeError(`${label} has unsafe permissions`)
  }
  return real
}

async function ensureRealDirectory(directory: string, label: string, mode: number) {
  await fs.mkdir(directory, { mode, recursive: true })
  return requireRealDirectory(directory, label, mode)
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function verifyFile(
  root: string,
  relativePathInput: string,
  expected: PluginSnapshotByteIdentity,
  label: string,
) {
  const relativePath = requireWebPluginRelativePath(relativePathInput, label)
  const target = path.resolve(root, ...relativePath.split("/"))
  if (!inside(root, target)) throw runtimeError(`${label} escapes its immutable closure`)
  let current = root
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment)
    if ((await fs.lstat(current)).isSymbolicLink()) {
      throw runtimeError(`${label} cannot resolve through a symbolic link`)
    }
  }
  const before = await fs.lstat(target)
  if (!before.isFile() || before.isSymbolicLink() || before.size !== expected.size) {
    throw runtimeError(`${label} is not the expected immutable file`)
  }
  const [real, realParent, realRoot] = await Promise.all([
    fs.realpath(target),
    fs.realpath(path.dirname(target)),
    fs.realpath(root),
  ])
  if (real !== path.join(realParent, path.basename(target)) || !inside(realRoot, real)) {
    throw runtimeError(`${label} cannot resolve through a symbolic link`)
  }
  const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0
  const handle = await fs.open(real, fsConstants.O_RDONLY | noFollow)
  try {
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.ctimeMs !== before.ctimeMs
    ) {
      throw runtimeError(`${label} changed while it was opened`)
    }
    const bytes = await handle.readFile()
    if (bytes.byteLength !== expected.size || digest(bytes) !== expected.sha256) {
      throw runtimeError(`${label} digest does not match its Installed Plugin snapshot`)
    }
    const after = await fs.lstat(real)
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw runtimeError(`${label} changed while it was read`)
    }
    return { bytes, path: real }
  } finally {
    await handle.close()
  }
}

async function syncDirectory(directory: string) {
  if (process.platform === "win32") return
  try {
    const handle = await fs.open(directory, "r")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {
    // A caller can still re-open and validate the renamed immutable closure.
  }
}

async function immutableInventory(root: string, label: string, maximumFiles = maximumPackageFiles) {
  const files: string[] = []
  const visit = async (directory: string, prefix = ""): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw runtimeError(`${label} cannot contain symbolic links`)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(target, relativePath)
      } else if (entry.isFile()) {
        files.push(relativePath)
        if (files.length > maximumFiles) throw runtimeError(`${label} exceeds its file-count limit`)
      } else {
        throw runtimeError(`${label} contains an unsupported filesystem entry`)
      }
    }
  }
  await visit(root)
  return files.sort(compareText)
}

class ActivePluginRuntimeHandleImpl implements ActivePluginRuntimeHandle {
  readonly descriptor: InstalledPluginSnapshot["descriptor"]
  readonly identity: ActivePluginRuntimeIdentity
  readonly plugin: InstalledWebPluginSummary
  readonly #closureRoot: string
  readonly #lease: PluginSnapshotLease
  #released = false

  constructor(
    closureRoot: string,
    descriptor: InstalledPluginSnapshot["descriptor"],
    identity: ActivePluginRuntimeIdentity,
    plugin: InstalledWebPluginSummary,
    lease: PluginSnapshotLease,
  ) {
    this.#closureRoot = closureRoot
    this.descriptor = descriptor
    this.identity = identity
    this.plugin = plugin
    this.#lease = lease
  }

  get released() {
    return this.#released
  }

  release() {
    if (this.#released) return
    this.#released = true
    this.#lease.release()
  }

  async resolveAsset(relativePathInput: string) {
    if (this.#released) throw runtimeError("Active Plugin runtime lease has been released")
    const relativePath = requireWebPluginRelativePath(relativePathInput, "Plugin asset path")
    const identity = this.descriptor.package.files.find((file) => file.path === relativePath)
    if (!identity) throw runtimeError(`Plugin asset is not part of the Installed Plugin snapshot: ${relativePath}`)
    return (await verifyFile(path.join(this.#closureRoot, "package"), relativePath, identity, "Plugin asset")).path
  }

  async resolveOwnedSkillFile(skillNameInput: string, relativePathInput: string) {
    if (this.#released) throw runtimeError("Active Plugin runtime lease has been released")
    const skillName = requireWebPluginId(skillNameInput)
    const relativePath = requireWebPluginRelativePath(relativePathInput, "Plugin-owned Skill path")
    const skill = this.descriptor.ownedSkills.find((candidate) => candidate.name === skillName)
    const contribution = this.plugin.contributes.skills?.find((candidate) => candidate.name === skillName)
    if (!skill || !contribution) throw runtimeError(`Plugin-owned Skill is not active: ${skillName}`)
    const identity = skill.files.find((file) => file.path === relativePath)
    if (!identity) throw runtimeError(`Plugin-owned Skill file is not part of the snapshot: ${relativePath}`)
    return (
      await verifyFile(
        path.join(this.#closureRoot, "package", ...contribution.path.split("/")),
        relativePath,
        identity,
        "Plugin-owned Skill file",
      )
    ).path
  }

  async resolveOwnedSkillDirectory(skillNameInput: string) {
    if (this.#released) throw runtimeError("Active Plugin runtime lease has been released")
    const skillName = requireWebPluginId(skillNameInput)
    const skill = this.descriptor.ownedSkills.find((candidate) => candidate.name === skillName)
    const contribution = this.plugin.contributes.skills?.find((candidate) => candidate.name === skillName)
    if (!skill || !contribution) throw runtimeError(`Plugin-owned Skill is not active: ${skillName}`)
    const root = path.join(this.#closureRoot, "package", ...contribution.path.split("/"))
    for (const identity of skill.files) {
      await verifyFile(root, identity.path, identity, "Plugin-owned Skill file")
    }
    const expectedPaths = new Set(skill.files.map((identity) => identity.path))
    const actualPaths = await immutableInventory(root, "Plugin-owned Skill")
    if (
      actualPaths.length !== expectedPaths.size ||
      actualPaths.some((relativePath) => !expectedPaths.has(relativePath))
    ) {
      throw runtimeError(`Plugin-owned Skill inventory does not match its immutable snapshot: ${skillName}`)
    }
    return root
  }

  async resolveHook() {
    if (this.#released) throw runtimeError("Active Plugin runtime lease has been released")
    if (!this.descriptor.hook) return null
    if (!this.descriptor.authorizations.hookExecutionDigest) {
      throw new PluginExecutionSetupRequiredError(this.identity.pluginId, "hook")
    }
    return (
      await verifyFile(
        path.join(this.#closureRoot, "package"),
        this.descriptor.hook.entryPath,
        this.descriptor.hook,
        "Plugin Hook",
      )
    ).path
  }

  async resolveCompanion() {
    if (this.#released) throw runtimeError("Active Plugin runtime lease has been released")
    if (!this.descriptor.companion) return null
    if (!this.descriptor.authorizations.companionExecutionDigest) {
      throw new PluginExecutionSetupRequiredError(this.identity.pluginId, "companion")
    }
    return (
      await verifyFile(
        path.join(this.#closureRoot, "companion"),
        this.descriptor.companion.entryPath,
        this.descriptor.companion,
        "Plugin companion",
      )
    ).path
  }
}

/**
 * Main-owned immutable Plugin closure publisher and runtime resolver.
 *
 * Package validation and byte publication finish before the global ActiveSet
 * CAS. Runtime resolution starts from that one pointer, revalidates the exact
 * closure, and acquires an ActiveSet lease before returning any executable or
 * renderable path. The legacy `plugins/`, Skill journal, Hook receipt, and
 * companion directories are not fallback authorities.
 */

export interface StagedPluginClosureGarbage {
  readonly original: string
  readonly tombstone: string
}

/**
 * Owns immutable Plugin closure bytes and all native-filesystem verification.
 * It does not own the active pointer, capability topology, or runtime policy.
 */
export class PluginInstallationClosureStore {
  readonly #closureDirectory: string
  readonly #faultHook: PluginInstallationRuntimeOptions["faultHook"]

  constructor(closureDirectory: string, options: PluginInstallationRuntimeOptions = {}) {
    if (!path.isAbsolute(closureDirectory) || closureDirectory.includes("\0")) {
      throw runtimeError("Plugin installation closure directory must be an absolute path")
    }
    this.#closureDirectory = path.resolve(closureDirectory)
    this.#faultHook = options.faultHook
  }

  prepare(candidate: PluginInstallationCandidate) {
    return preparePluginInstallationCandidate(candidate)
  }

  createHandle(
    snapshot: InstalledPluginSnapshot,
    identity: ActivePluginRuntimeIdentity,
    plugin: InstalledWebPluginSummary,
    lease: PluginSnapshotLease,
  ): ActivePluginRuntimeHandle {
    return new ActivePluginRuntimeHandleImpl(
      this.#closureRoot(snapshot.digest),
      snapshot.descriptor,
      identity,
      plugin,
      lease,
    )
  }

  async ensureLayout() {
    await ensureRealDirectory(this.#closureDirectory, "Plugin installation closure directory", 0o700)
  }

  #closureRoot(snapshotDigest: PluginSnapshotDigest) {
    return path.join(this.#closureDirectory, snapshotDigest)
  }

  async publish(
    snapshot: InstalledPluginSnapshot,
    files: readonly { bytes: Uint8Array; path: string }[],
    companionBytes: Uint8Array | undefined,
  ) {
    const target = this.#closureRoot(snapshot.digest)
    if (await exists(target)) {
      await this.validate(snapshot)
      return
    }
    const staging = path.join(this.#closureDirectory, `.staging-${snapshot.digest}-${randomUUID()}`)
    try {
      await fs.mkdir(path.join(staging, "package"), { mode: 0o700, recursive: true })
      for (const file of files) {
        const targetFile = path.join(staging, "package", ...file.path.split("/"))
        await fs.mkdir(path.dirname(targetFile), { mode: 0o700, recursive: true })
        const handle = await fs.open(targetFile, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o400)
        try {
          await handle.writeFile(file.bytes)
          await handle.sync()
        } finally {
          await handle.close()
        }
        await this.#faultHook?.("closure.file-written", {
          pluginId: snapshot.descriptor.pluginId,
          snapshotDigest: snapshot.digest,
        })
      }
      if (snapshot.descriptor.companion) {
        if (!companionBytes) throw runtimeError("Plugin companion bytes are missing from the publication candidate")
        const companionFile = path.join(staging, "companion", ...snapshot.descriptor.companion.entryPath.split("/"))
        await fs.mkdir(path.dirname(companionFile), { mode: 0o700, recursive: true })
        const handle = await fs.open(
          companionFile,
          fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
          snapshot.descriptor.companion.mode === "native" ? 0o500 : 0o400,
        )
        try {
          await handle.writeFile(companionBytes)
          await handle.sync()
        } finally {
          await handle.close()
        }
      }
      await syncDirectory(staging)
      await fs.rename(staging, target)
      await syncDirectory(this.#closureDirectory)
      await this.#faultHook?.("closure.renamed-before-pointer", {
        pluginId: snapshot.descriptor.pluginId,
        snapshotDigest: snapshot.digest,
      })
    } finally {
      await fs.rm(staging, { force: true, recursive: true }).catch(() => undefined)
    }
  }

  async readBytes(snapshot: InstalledPluginSnapshot) {
    const packageRoot = path.join(this.#closureRoot(snapshot.digest), "package")
    const files = await Promise.all(
      snapshot.descriptor.package.files.map(async (identity) => ({
        bytes: (await verifyFile(packageRoot, identity.path, identity, "Plugin package file")).bytes,
        path: identity.path,
      })),
    )
    const companionBytes = snapshot.descriptor.companion
      ? (
          await verifyFile(
            path.join(this.#closureRoot(snapshot.digest), "companion"),
            snapshot.descriptor.companion.entryPath,
            snapshot.descriptor.companion,
            "Plugin companion",
          )
        ).bytes
      : undefined
    return { companionBytes, files }
  }

  async readManifest(snapshot: InstalledPluginSnapshot) {
    const manifest = await verifyFile(
      path.join(this.#closureRoot(snapshot.digest), "package"),
      "manifest.json",
      snapshot.descriptor.package.manifest,
      "Plugin manifest",
    )
    let plugin: InstalledWebPluginSummary
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(manifest.bytes)
      plugin = toInstalledWebPluginSummary(parseWebPluginManifest(JSON.parse(text)))
    } catch (error) {
      throw runtimeError("Immutable Plugin manifest is invalid", error)
    }
    if (plugin.id !== snapshot.descriptor.pluginId || plugin.version !== snapshot.descriptor.version) {
      throw runtimeError("Immutable Plugin manifest identity does not match its snapshot")
    }
    if (pluginSnapshotCanonicalDigest(plugin) !== snapshot.descriptor.authorizations.capabilityContractDigest) {
      throw runtimeError("Immutable Plugin capability contract does not match its authorization binding")
    }
    return Object.freeze(plugin)
  }

  async #validateInventory(snapshot: InstalledPluginSnapshot) {
    const root = await requireRealDirectory(this.#closureRoot(snapshot.digest), "Plugin installation closure", 0o700)
    const rootEntries = await fs.readdir(root, { withFileTypes: true })
    const expectedRootEntries = snapshot.descriptor.companion ? ["companion", "package"] : ["package"]
    if (
      rootEntries.length !== expectedRootEntries.length ||
      rootEntries
        .sort((left, right) => compareText(left.name, right.name))
        .some(
          (entry, index) => entry.name !== expectedRootEntries[index] || !entry.isDirectory() || entry.isSymbolicLink(),
        )
    ) {
      throw runtimeError("Plugin closure root inventory does not match its snapshot")
    }
    const packageRoot = await requireRealDirectory(path.join(root, "package"), "Plugin package closure", 0o700)
    for (const identity of snapshot.descriptor.package.files) {
      await verifyFile(packageRoot, identity.path, identity, "Plugin package file")
    }
    if (snapshot.descriptor.companion) {
      const companionRoot = await requireRealDirectory(path.join(root, "companion"), "Plugin companion closure", 0o700)
      await verifyFile(
        companionRoot,
        snapshot.descriptor.companion.entryPath,
        snapshot.descriptor.companion,
        "Plugin companion",
      )
      const companionPaths = await immutableInventory(companionRoot, "Plugin companion closure", 1)
      if (companionPaths.length !== 1 || companionPaths[0] !== snapshot.descriptor.companion.entryPath) {
        throw runtimeError("Plugin companion closure inventory does not match its snapshot")
      }
    } else if (await exists(path.join(root, "companion"))) {
      throw runtimeError("Plugin closure contains an undeclared companion tree")
    }
    const expectedPaths = new Set(snapshot.descriptor.package.files.map((identity) => identity.path))
    const actualPaths = await immutableInventory(packageRoot, "Plugin package closure")
    if (
      actualPaths.length !== expectedPaths.size ||
      actualPaths.some((relativePath) => !expectedPaths.has(relativePath))
    ) {
      throw runtimeError("Plugin closure package inventory does not match its snapshot")
    }
  }

  /**
   * Admits only closures whose immutable bytes still match their snapshot and
   * whose sole manifest incompatibility is a retired Host API major. The
   * returned manifest is a validation projection only; persisted bytes and
   * authorization bindings remain unchanged.
   */
  async validateRetiredHostApiMajor(snapshot: InstalledPluginSnapshot) {
    await this.#validateInventory(snapshot)
    const manifest = await verifyFile(
      path.join(this.#closureRoot(snapshot.digest), "package"),
      "manifest.json",
      snapshot.descriptor.package.manifest,
      "Plugin manifest",
    )
    let current: InstalledWebPluginSummary
    let retiredMajor: number
    try {
      const raw = record(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifest.bytes)),
        "Immutable Plugin manifest",
      )
      const hostApi = record(raw.hostApi, "Immutable Plugin Host API declaration")
      if (typeof hostApi.major !== "number") {
        throw new TypeError("Immutable Plugin Host API major must be a number")
      }
      retiredMajor = hostApi.major
      if (!Number.isSafeInteger(retiredMajor) || retiredMajor < 1 || retiredMajor >= PLUGIN_API_CATALOG_MAJOR) {
        throw new TypeError("Immutable Plugin does not target a retired Host API major")
      }
      current = toInstalledWebPluginSummary(
        parseWebPluginManifest({
          ...raw,
          hostApi: { ...hostApi, major: PLUGIN_API_CATALOG_MAJOR },
        }),
      )
      const normalizedRetiredManifest = {
        ...current,
        hostApi: { ...current.hostApi, major: retiredMajor },
      }
      if (
        pluginSnapshotCanonicalDigest(normalizedRetiredManifest) !==
        snapshot.descriptor.authorizations.capabilityContractDigest
      ) {
        throw new TypeError("Immutable Plugin capability contract does not match its retired authorization binding")
      }
    } catch (error) {
      throw runtimeError("Immutable Plugin is not eligible for retired Host API update recovery", error)
    }
    if (current.id !== snapshot.descriptor.pluginId || current.version !== snapshot.descriptor.version) {
      throw runtimeError("Immutable Plugin manifest identity does not match its snapshot")
    }
    return Object.freeze({ current, retiredMajor })
  }

  async validate(snapshot: InstalledPluginSnapshot) {
    await this.#validateInventory(snapshot)
    const plugin = await this.readManifest(snapshot)
    return plugin
  }

  async stageGarbage(snapshot: InstalledPluginSnapshot): Promise<StagedPluginClosureGarbage> {
    await this.validate(snapshot)
    const original = this.#closureRoot(snapshot.digest)
    const tombstone = path.join(this.#closureDirectory, `.gc-${snapshot.digest}-${randomUUID()}`)
    await fs.rename(original, tombstone)
    return Object.freeze({ original, tombstone })
  }

  async restoreGarbage(entry: StagedPluginClosureGarbage) {
    await fs.rename(entry.tombstone, entry.original)
  }

  async deleteGarbage(entry: StagedPluginClosureGarbage) {
    await fs.rm(entry.tombstone, { force: true, recursive: true })
  }

  async assertNoLegacyState(legacyPaths: readonly string[]) {
    for (const legacyPathInput of legacyPaths) {
      const legacyPath = path.resolve(legacyPathInput)
      if (!path.isAbsolute(legacyPathInput) || legacyPath.includes("\0")) {
        throw runtimeError("Legacy Plugin state path must be absolute")
      }
      if (await exists(legacyPath)) {
        throw runtimeError(`Unsupported legacy Plugin installation state must be removed explicitly: ${legacyPath}`)
      }
    }
  }
}
