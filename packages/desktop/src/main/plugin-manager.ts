import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import {
  compareWebPluginVersions,
  type InstalledWebPluginSummary,
  type WebPluginManifest,
  parseWebPluginManifest,
  requireWebPluginId,
  requireWebPluginRelativePath,
  toInstalledWebPluginSummary,
  validatePortablePluginSegment,
  webPluginManifestFileName,
} from "../plugin-contracts"

const defaultLimits = {
  maxEntryCount: 2_000,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
} as const

const builtinProvenanceFileName = ".convax-builtin.json"
const portableBuiltinProvenanceFileName = builtinProvenanceFileName.toLocaleLowerCase("en-US")
const builtinProvenanceSchema = "convax.plugin-builtin/1" as const
const publicationTransactionUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const publicationCleanupPrefix = ".publication-cleanup-"

interface BuiltinProvenance {
  bundleDigest: string
  id: string
  schema: typeof builtinProvenanceSchema
  version: string
}

export interface WebPluginInstallLimits {
  maxEntryCount?: number
  maxFileBytes?: number
  maxTotalBytes?: number
}

export interface WebPluginBundle {
  files: Readonly<Record<string, string | Uint8Array>>
}

export interface WebPluginLegacyBundleDigest {
  bundleDigest: string
  version: string
}

/** A host-owned side effect that participates in one Plugin package publication. */
export interface WebPluginPublicationTransaction {
  /** Rechecks claims and persists rollback metadata before the Plugin package switch. */
  publish(): Promise<void>
  /** Switches the still-reversible host capability only after the Plugin package switch. */
  activate?(): Promise<void>
  /** Records the forward decision, then performs retryable publication cleanup. */
  commit(): Promise<void>
  /** Restores the pre-publication state while no forward decision is durable. */
  rollback(): Promise<void>
  /**
   * Releases process-local resources without changing durable publication
   * state. Startup recovery must first select the authoritative Plugin package
   * and then settle the retained capability journal.
   */
  deferToRecovery?(): Promise<void>
}

/** The Plugin package could not be rolled back atomically; startup owns the decision. */
export class WebPluginPublicationDeferredError extends AggregateError {
  readonly code = "PLUGIN_PUBLICATION_DEFERRED" as const
}

async function rollbackPublishedPublication(
  publication: WebPluginPublicationTransaction | undefined,
  published: boolean,
  cause: unknown,
  message: string,
) {
  if (!published || !publication) return
  try {
    await publication.rollback()
  } catch (rollbackError) {
    const failures: unknown[] = [cause, rollbackError]
    try {
      await publication.deferToRecovery?.()
    } catch (deferError) {
      failures.push(deferError)
    }
    throw new WebPluginPublicationDeferredError(failures, message, { cause })
  }
}

/** Main-only access to the fully validated candidate package being published. */
export interface WebPluginPublicationCandidate {
  /** Exact currently installed package when this publication is an update. */
  previous?: {
    plugin: InstalledWebPluginSummary
    root: string
  }
  root: string
}

export interface WebPluginPublicationOptions {
  beforePublish?(
    plugin: InstalledWebPluginSummary,
    candidate: WebPluginPublicationCandidate,
  ): Promise<WebPluginPublicationTransaction>
  /** Reuses an already-held per-Plugin lifecycle lock. */
  mutation?: WebPluginMutationContext
}

export interface WebPluginUninstallOptions {
  beforeRemove?(plugin: InstalledWebPluginSummary): Promise<WebPluginPublicationTransaction>
  /** Reuses an already-held per-Plugin lifecycle lock. */
  mutation?: WebPluginMutationContext
}

export interface WebPluginBundleInstallOptions extends WebPluginPublicationOptions {
  replaceExisting?: boolean
}

export interface WebPluginBuiltinInstallOptions extends WebPluginPublicationOptions {
  legacyBundleDigests?: readonly WebPluginLegacyBundleDigest[]
}

interface ResolvedLimits {
  maxEntryCount: number
  maxFileBytes: number
  maxTotalBytes: number
}

/** Opaque proof that the caller owns one Plugin's complete lifecycle lock. */
export interface WebPluginMutationContext {
  readonly pluginId: string
}

interface CopyState {
  entries: number
  limits: ResolvedLimits
  sourceRoot: string
  totalBytes: number
}

interface PublicationRemnantName {
  expectedId?: string
  kind: "backup" | "removed" | "staging"
}

interface ValidatedPluginPackage {
  builtinProvenance: boolean
  declaration: string
  digest: string
  directoryIdentity: {
    dev: number
    ino: number
  }
  id: string
  manifest: WebPluginManifest
  path: string
}

interface ValidatedPublicationPackage extends ValidatedPluginPackage {
  kind: PublicationRemnantName["kind"]
  name: string
}

interface PublicationRecoveryGroup {
  backupClaims: number
  backups: ValidatedPublicationPackage[]
  failures: unknown[]
  removalClaims: number
  removals: ValidatedPublicationPackage[]
  stagings: ValidatedPublicationPackage[]
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

async function exists(filePath: string) {
  try {
    await fs.lstat(filePath)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false
    throw error
  }
}

function isInside(candidate: string, root: string) {
  const relative = path.relative(root, candidate)
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
}

function publicationRemnantName(name: string): PublicationRemnantName | null {
  if (name.length <= 37 || name.at(-37) !== "-" || !publicationTransactionUuidPattern.test(name.slice(-36))) return null
  const prefix = name.slice(0, -37)
  if (prefix === ".staging-bundle") return { kind: "staging" }
  if (prefix.startsWith(".replaced-")) {
    const expectedId = prefix.slice(".replaced-".length)
    try {
      return { expectedId: requireWebPluginId(expectedId), kind: "backup" }
    } catch {
      return null
    }
  }
  if (prefix.startsWith(".removed-")) {
    const expectedId = prefix.slice(".removed-".length)
    try {
      return { expectedId: requireWebPluginId(expectedId), kind: "removed" }
    } catch {
      return null
    }
  }
  if (prefix.startsWith(".staging-")) {
    const expectedId = prefix.slice(".staging-".length)
    try {
      return { expectedId: requireWebPluginId(expectedId), kind: "staging" }
    } catch {
      return null
    }
  }
  return null
}

function isPublicationCleanupRemnant(name: string) {
  return (
    name.length === publicationCleanupPrefix.length + 36 &&
    name.startsWith(publicationCleanupPrefix) &&
    publicationTransactionUuidPattern.test(name.slice(-36))
  )
}

function assertInside(candidate: string, root: string, label: string) {
  if (!isInside(candidate, root)) throw new Error(`${label} escapes the plugin root`)
}

function resolveLimits(input: WebPluginInstallLimits): ResolvedLimits {
  const output = { ...defaultLimits, ...input }
  for (const [name, value] of Object.entries(output)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Plugin install ${name} must be a positive integer`)
  }
  if (output.maxFileBytes > output.maxTotalBytes) {
    throw new Error("Plugin install maxFileBytes cannot exceed maxTotalBytes")
  }
  return output
}

async function assertPlainDirectory(directory: string, label: string) {
  const stat = await fs.lstat(directory)
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error(`${label} must be a directory and cannot be a symbolic link`)
  return fs.realpath(directory)
}

async function readManifest(directory: string, maxFileBytes: number): Promise<WebPluginManifest> {
  const manifestPath = path.join(directory, webPluginManifestFileName)
  let stat: Awaited<ReturnType<typeof fs.lstat>>
  try {
    stat = await fs.lstat(manifestPath)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT")
      throw new Error(`Plugin package is missing ${webPluginManifestFileName}`, { cause: error })
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Plugin manifest must be a regular file")
  if (stat.size > maxFileBytes) throw new Error("Plugin manifest exceeds the per-file size limit")
  let value: unknown
  try {
    value = JSON.parse(await fs.readFile(manifestPath, "utf8"))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Plugin manifest is not valid JSON", { cause: error })
    throw error
  }
  return parseWebPluginManifest(value)
}

async function copyRegularFile(source: string, target: string, state: CopyState) {
  const noFollow = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
  const handle = await fs.open(source, noFollow)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error(`Plugin package contains an unsupported file type: ${source}`)
    if (stat.size > state.limits.maxFileBytes) throw new Error(`Plugin file exceeds the per-file size limit: ${source}`)
    if (state.totalBytes + stat.size > state.limits.maxTotalBytes)
      throw new Error("Plugin package exceeds the total size limit")
    const content = await handle.readFile()
    if (
      content.byteLength > state.limits.maxFileBytes ||
      state.totalBytes + content.byteLength > state.limits.maxTotalBytes
    ) {
      throw new Error("Plugin package exceeds the configured size limits")
    }
    await fs.writeFile(target, content, { flag: "wx", mode: 0o600 })
    state.totalBytes += content.byteLength
  } finally {
    await handle.close()
  }
}

async function copyPackageEntry(source: string, target: string, state: CopyState): Promise<void> {
  state.entries += 1
  if (state.entries > state.limits.maxEntryCount) throw new Error("Plugin package exceeds the entry count limit")
  const sourceRealPath = await fs.realpath(source)
  assertInside(sourceRealPath, state.sourceRoot, "Plugin source path")
  const relativePath = path.relative(state.sourceRoot, sourceRealPath).split(path.sep).join("/")
  if (relativePath) requireWebPluginRelativePath(relativePath, "Plugin package path")
  if (relativePath.toLocaleLowerCase("en-US") === portableBuiltinProvenanceFileName) {
    throw new Error(`Plugin package path is reserved by the host: ${builtinProvenanceFileName}`)
  }
  const stat = await fs.lstat(source)
  if (stat.isSymbolicLink()) throw new Error(`Plugin package cannot contain symbolic links: ${source}`)
  if (stat.isFile()) {
    await copyRegularFile(source, target, state)
    return
  }
  if (!stat.isDirectory()) throw new Error(`Plugin package contains an unsupported file type: ${source}`)
  await fs.mkdir(target, { mode: 0o700 })
  const names = await fs.readdir(source)
  const portableNames = new Set<string>()
  for (const name of names) {
    validatePortablePluginSegment(name)
    const portableName = name.toLocaleLowerCase("en-US")
    if (portableNames.has(portableName))
      throw new Error(`Plugin package contains names that collide on Windows: ${source}`)
    portableNames.add(portableName)
  }
  for (const name of names) await copyPackageEntry(path.join(source, name), path.join(target, name), state)
}

async function assertRegularInstalledFile(pluginRoot: string, relativePath: string, label: string) {
  const candidate = path.resolve(pluginRoot, ...relativePath.split("/"))
  assertInside(candidate, pluginRoot, label)
  let current = pluginRoot
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment)
    const segmentStat = await fs.lstat(current).catch((error) => {
      if (isNodeError(error) && error.code === "ENOENT") throw new Error(`${label} does not exist: ${relativePath}`)
      throw error
    })
    if (segmentStat.isSymbolicLink()) throw new Error(`${label} cannot contain a symbolic link: ${relativePath}`)
  }
  const realPath = await fs.realpath(candidate)
  assertInside(realPath, pluginRoot, label)
  if (!(await fs.stat(realPath)).isFile()) throw new Error(`${label} must be a regular file: ${relativePath}`)
  return realPath
}

async function validateInstalledPackage(directory: string, limits: ResolvedLimits) {
  const manifest = await readManifest(directory, limits.maxFileBytes)
  if (manifest.entry) await assertRegularInstalledFile(directory, manifest.entry, "Plugin entry")
  if (manifest.skill) {
    const skillPath = await assertRegularInstalledFile(directory, manifest.skill, "Plugin skill")
    if (path.basename(skillPath).toLocaleLowerCase("en-US") !== "skill.md") {
      throw new Error("Plugin skill must point to a SKILL.md file")
    }
  }
  for (const skill of manifest.contributes.skills ?? []) {
    await assertRegularInstalledFile(directory, `${skill.path}/SKILL.md`, `Plugin-owned Skill ${skill.name}`)
  }
  return manifest
}

function bundleManifest(bundle: WebPluginBundle) {
  const document = bundle.files[webPluginManifestFileName]
  if (typeof document !== "string" && !(document instanceof Uint8Array)) {
    throw new Error(`Plugin bundle is missing ${webPluginManifestFileName}`)
  }
  try {
    return parseWebPluginManifest(
      JSON.parse(typeof document === "string" ? document : Buffer.from(document).toString("utf8")),
    )
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Plugin bundle manifest is not valid JSON")
    throw error
  }
}

function bundleDigest(bundle: WebPluginBundle) {
  const digest = createHash("sha256")
  const files = Object.entries(bundle.files)
    .map(([relativePath, content]) => ({
      content: typeof content === "string" ? Buffer.from(content) : Buffer.from(content),
      relativePath: requireWebPluginRelativePath(relativePath, "Plugin bundle path"),
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  for (const file of files) {
    if (file.relativePath.toLocaleLowerCase("en-US") === portableBuiltinProvenanceFileName) {
      throw new Error(`Plugin bundle path is reserved by the host: ${builtinProvenanceFileName}`)
    }
    digest.update(String(Buffer.byteLength(file.relativePath)))
    digest.update(":")
    digest.update(file.relativePath)
    digest.update(":")
    digest.update(String(file.content.byteLength))
    digest.update(":")
    digest.update(file.content)
  }
  return digest.digest("hex")
}

/**
 * Capability authority comes only from the normalized manifest. Rehashing the
 * complete static package on every Canvas call would make a batched document
 * API scale with Plugin asset size instead of request size. Built-in provenance
 * still verifies the complete package separately where native trust requires it.
 */
function capabilityManifestDigest(manifest: WebPluginManifest) {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex")
}

async function readBuiltinProvenance(directory: string, manifest: WebPluginManifest) {
  const markerPath = path.join(directory, builtinProvenanceFileName)
  const stat = await fs.lstat(markerPath)
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 2_048) {
    throw new Error("Built-in Plugin provenance marker is invalid")
  }
  const value = JSON.parse(await fs.readFile(markerPath, "utf8")) as unknown
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Built-in Plugin provenance marker is invalid")
  }
  const marker = value as Record<string, unknown>
  if (
    marker.schema !== builtinProvenanceSchema ||
    marker.id !== manifest.id ||
    marker.version !== manifest.version ||
    typeof marker.bundleDigest !== "string" ||
    !/^[a-f0-9]{64}$/.test(marker.bundleDigest) ||
    Object.keys(marker).some((key) => !["bundleDigest", "id", "schema", "version"].includes(key))
  ) {
    throw new Error("Built-in Plugin provenance marker does not match its manifest")
  }
  return marker as unknown as BuiltinProvenance
}

async function readInstalledPackageFiles(directory: string, limits: ResolvedLimits) {
  const actual = new Map<string, Buffer>()
  let entries = 0
  let totalBytes = 0
  const visit = async (relativeDirectory = ""): Promise<void> => {
    const absoluteDirectory = relativeDirectory ? path.join(directory, ...relativeDirectory.split("/")) : directory
    for (const entry of await fs.readdir(absoluteDirectory, { withFileTypes: true })) {
      entries += 1
      if (entries > limits.maxEntryCount) throw new Error("Installed Plugin exceeds the entry count limit")
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      requireWebPluginRelativePath(relativePath, "Installed Plugin path")
      const absolutePath = path.join(absoluteDirectory, entry.name)
      const stat = await fs.lstat(absolutePath)
      if (stat.isSymbolicLink()) throw new Error("Installed Plugin package cannot contain symbolic links")
      if (stat.isDirectory()) {
        await visit(relativePath)
        continue
      }
      if (!stat.isFile()) throw new Error("Installed Plugin package contains an unsupported entry")
      if (relativePath.toLocaleLowerCase("en-US") === portableBuiltinProvenanceFileName) {
        if (relativePath !== builtinProvenanceFileName) {
          throw new Error("Installed Plugin contains a case-variant built-in provenance path")
        }
        continue
      }
      if (stat.size > limits.maxFileBytes) throw new Error("Installed Plugin file exceeds the size limit")
      const handle = await fs.open(absolutePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
      try {
        const content = await handle.readFile()
        totalBytes += content.byteLength
        if (totalBytes > limits.maxTotalBytes) throw new Error("Installed Plugin package exceeds the total size limit")
        actual.set(relativePath, content)
      } finally {
        await handle.close()
      }
    }
  }
  await visit()
  return actual
}

async function installedPackageMatchesBundle(directory: string, bundle: WebPluginBundle, limits: ResolvedLimits) {
  const expected = new Map(
    Object.entries(bundle.files).map(([relativePath, content]) => [
      requireWebPluginRelativePath(relativePath, "Plugin bundle path"),
      typeof content === "string" ? Buffer.from(content) : Buffer.from(content),
    ]),
  )
  let actual: Map<string, Buffer>
  try {
    actual = await readInstalledPackageFiles(directory, limits)
  } catch {
    return false
  }
  return (
    actual.size === expected.size &&
    [...expected].every(([relativePath, content]) => actual.get(relativePath)?.equals(content) === true)
  )
}

async function installedPackageDigest(directory: string, limits: ResolvedLimits) {
  const files = await readInstalledPackageFiles(directory, limits)
  return bundleDigest({ files: Object.fromEntries(files) })
}

function validateLegacyBundleDigests(
  currentVersion: string,
  values: readonly WebPluginLegacyBundleDigest[] | undefined,
) {
  const digests = new Map<string, string>()
  for (const value of values ?? []) {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.version !== "string" ||
      typeof value.bundleDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.bundleDigest) ||
      compareWebPluginVersions(value.version, currentVersion) >= 0 ||
      digests.has(value.version)
    ) {
      throw new Error("Built-in Plugin legacy bundle digest is invalid")
    }
    digests.set(value.version, value.bundleDigest)
  }
  return digests
}

export class WebPluginManager {
  readonly #activeMutationContexts = new WeakSet<WebPluginMutationContext>()
  readonly #limits: ResolvedLimits
  readonly #mutationTails = new Map<string, Promise<void>>()
  readonly #reservedBuiltinIds: ReadonlySet<string>
  readonly #rootPath: string

  constructor(rootPath: string, limits: WebPluginInstallLimits = {}, reservedBuiltinIds: readonly string[] = []) {
    if (!rootPath.trim()) throw new Error("Plugin installation root is required")
    this.#rootPath = path.resolve(rootPath)
    this.#limits = resolveLimits(limits)
    this.#reservedBuiltinIds = new Set(reservedBuiltinIds.map(requireWebPluginId))
  }

  async #ensureRoot() {
    await fs.mkdir(this.#rootPath, { mode: 0o700, recursive: true })
    return assertPlainDirectory(this.#rootPath, "Plugin installation root")
  }

  async #runPluginMutation<Result>(
    pluginId: string,
    operation: () => Promise<Result>,
    mutation?: WebPluginMutationContext,
  ): Promise<Result> {
    const id = requireWebPluginId(pluginId)
    if (mutation) {
      if (!this.#activeMutationContexts.has(mutation) || mutation.pluginId !== id) {
        throw new Error(`Plugin mutation context does not own this Plugin: ${id}`)
      }
      return operation()
    }
    const previous = this.#mutationTails.get(id) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const current = previous.then(() => gate)
    this.#mutationTails.set(id, current)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.#mutationTails.get(id) === current) this.#mutationTails.delete(id)
    }
  }

  /**
   * Serializes an entire host lifecycle, including package-independent
   * companion and authorization work. Operations invoked inside must receive
   * the supplied context instead of trying to acquire the same lock again.
   */
  async withPluginMutation<Result>(
    pluginId: string,
    operation: (mutation: WebPluginMutationContext) => Promise<Result>,
  ): Promise<Result> {
    const id = requireWebPluginId(pluginId)
    return this.#runPluginMutation(id, async () => {
      const mutation = Object.freeze({ pluginId: id })
      this.#activeMutationContexts.add(mutation)
      try {
        return await operation(mutation)
      } finally {
        this.#activeMutationContexts.delete(mutation)
      }
    })
  }

  async #validatePublicationPackage(
    installationRoot: string,
    directory: string,
    expectedId: string,
    label: string,
    expectedBuiltin = this.#reservedBuiltinIds.has(expectedId),
  ): Promise<ValidatedPluginPackage> {
    if (path.dirname(directory) !== installationRoot) {
      throw new Error(`${label} must be an immediate child of the Plugin installation root`)
    }
    const before = await fs.lstat(directory)
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw new Error(`${label} must be a real directory`)
    }
    const realDirectory = await fs.realpath(directory)
    if (realDirectory !== directory) throw new Error(`${label} must not resolve through a symbolic link`)
    const manifest = await validateInstalledPackage(realDirectory, this.#limits)
    if (manifest.id !== expectedId) throw new Error(`${label} manifest identity does not match its transaction name`)
    const digest = await installedPackageDigest(realDirectory, this.#limits)
    const markerPath = path.join(realDirectory, builtinProvenanceFileName)
    if (expectedBuiltin) {
      const provenance = await readBuiltinProvenance(realDirectory, manifest)
      if (provenance.bundleDigest !== digest) {
        throw new Error(`${label} built-in provenance does not match its package bytes`)
      }
    } else if (await exists(markerPath)) {
      throw new Error(`${label} contains host-only built-in provenance`)
    }
    const after = await fs.lstat(directory)
    if (
      after.isSymbolicLink() ||
      !after.isDirectory() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error(`${label} changed while it was validated`)
    }
    return {
      builtinProvenance: expectedBuiltin,
      declaration: JSON.stringify(manifest),
      digest,
      directoryIdentity: { dev: after.dev, ino: after.ino },
      id: manifest.id,
      manifest,
      path: realDirectory,
    }
  }

  async #assertPluginPackageUnchanged(installationRoot: string, candidate: ValidatedPluginPackage, label: string) {
    const current = await this.#validatePublicationPackage(
      installationRoot,
      candidate.path,
      candidate.id,
      label,
      candidate.builtinProvenance,
    )
    if (
      current.declaration !== candidate.declaration ||
      current.digest !== candidate.digest ||
      current.directoryIdentity.dev !== candidate.directoryIdentity.dev ||
      current.directoryIdentity.ino !== candidate.directoryIdentity.ino
    ) {
      throw new Error(`${label} changed before the package switch`)
    }
  }

  async #assertPublicationCandidateUnchanged(installationRoot: string, candidate: ValidatedPublicationPackage) {
    await this.#assertPluginPackageUnchanged(
      installationRoot,
      candidate,
      `Plugin publication ${candidate.kind} ${candidate.name}`,
    )
  }

  async #removePublicationCandidate(installationRoot: string, candidate: ValidatedPublicationPackage) {
    await this.#assertPublicationCandidateUnchanged(installationRoot, candidate)
    const tombstone = path.join(installationRoot, `${publicationCleanupPrefix}${randomUUID()}`)
    if (await exists(tombstone)) throw new Error("Plugin publication cleanup target already exists")
    await fs.rename(candidate.path, tombstone)
    await fs.rm(tombstone, { recursive: true })
  }

  async #removePublicationCleanupRemnant(installationRoot: string, name: string) {
    const target = path.join(installationRoot, name)
    if (path.dirname(target) !== installationRoot) {
      throw new Error("Plugin publication cleanup remnant escapes its host root")
    }
    const metadata = await fs.lstat(target)
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || (await fs.realpath(target)) !== target) {
      throw new Error(`Plugin publication cleanup remnant must be a real directory: ${name}`)
    }
    await fs.rm(target, { recursive: true })
  }

  async #restorePublicationBackup(installationRoot: string, candidate: ValidatedPublicationPackage): Promise<void> {
    await this.#assertPublicationCandidateUnchanged(installationRoot, candidate)
    const target = path.join(installationRoot, candidate.id)
    if (await exists(target)) throw new Error(`Plugin recovery will not overwrite an existing package: ${candidate.id}`)
    await fs.rename(candidate.path, target)
    const restored = await this.#validatePublicationPackage(
      installationRoot,
      target,
      candidate.id,
      "Restored Plugin package",
    )
    if (restored.declaration !== candidate.declaration || restored.digest !== candidate.digest) {
      throw new Error(`Restored Plugin package changed during recovery: ${candidate.id}`)
    }
  }

  /**
   * Recovers only host-named package publication transactions. A canonical package
   * always wins. When it is absent, exactly one validated update backup may be
   * restored, while exactly one validated uninstall tombstone is removed and is
   * never restored. Staging directories are never promoted. Invalid or ambiguous
   * remnants stay inert and are reported instead of being guessed at.
   */
  async reconcilePublicationState() {
    const installationRoot = await this.#ensureRoot()
    const groups = new Map<string, PublicationRecoveryGroup>()
    const failures: unknown[] = []
    const groupFor = (pluginId: string) => {
      let group = groups.get(pluginId)
      if (!group) {
        group = { backupClaims: 0, backups: [], failures: [], removalClaims: 0, removals: [], stagings: [] }
        groups.set(pluginId, group)
      }
      return group
    }

    const entries = await fs.readdir(installationRoot, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (isPublicationCleanupRemnant(entry.name)) {
        try {
          await this.#removePublicationCleanupRemnant(installationRoot, entry.name)
        } catch (error) {
          failures.push(error)
        }
        continue
      }
      const remnant = publicationRemnantName(entry.name)
      if (!remnant) continue
      const expectedGroup = remnant.expectedId ? groupFor(remnant.expectedId) : undefined
      if (remnant.kind === "backup") expectedGroup!.backupClaims += 1
      if (remnant.kind === "removed") expectedGroup!.removalClaims += 1
      try {
        if (entry.isSymbolicLink() || !entry.isDirectory()) {
          throw new Error(`Plugin publication ${remnant.kind} must be a real directory: ${entry.name}`)
        }
        const candidatePath = path.join(installationRoot, entry.name)
        const expectedId = remnant.expectedId ?? (await readManifest(candidatePath, this.#limits.maxFileBytes)).id
        const validated = await this.#validatePublicationPackage(
          installationRoot,
          candidatePath,
          expectedId,
          `Plugin publication ${remnant.kind}`,
        )
        const candidate: ValidatedPublicationPackage = {
          ...validated,
          kind: remnant.kind,
          name: entry.name,
        }
        const group = groupFor(candidate.id)
        if (candidate.kind === "backup") group.backups.push(candidate)
        else if (candidate.kind === "removed") group.removals.push(candidate)
        else group.stagings.push(candidate)
      } catch (error) {
        const destination = expectedGroup?.failures ?? failures
        destination.push(error)
      }
    }

    for (const [pluginId, group] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
      const target = path.join(installationRoot, pluginId)
      let canonical: ValidatedPluginPackage | null = null
      try {
        canonical = (await exists(target))
          ? await this.#validatePublicationPackage(installationRoot, target, pluginId, "Installed Plugin package")
          : null
      } catch (error) {
        group.failures.push(error)
        continue
      }

      if (canonical) {
        for (const candidate of [...group.backups, ...group.removals, ...group.stagings]) {
          try {
            await this.#removePublicationCandidate(installationRoot, candidate)
          } catch (error) {
            group.failures.push(error)
          }
        }
        continue
      }

      if (group.removalClaims === 1 && group.removals.length === 1 && group.backupClaims === 0) {
        try {
          await this.#removePublicationCandidate(installationRoot, group.removals[0]!)
        } catch (error) {
          group.failures.push(error)
          continue
        }
        for (const staging of group.stagings) {
          try {
            await this.#removePublicationCandidate(installationRoot, staging)
          } catch (error) {
            group.failures.push(error)
          }
        }
        continue
      }

      if (group.removalClaims === 0 && group.backupClaims === 1 && group.backups.length === 1) {
        try {
          await this.#restorePublicationBackup(installationRoot, group.backups[0]!)
        } catch (error) {
          group.failures.push(error)
          continue
        }
        for (const staging of group.stagings) {
          try {
            await this.#removePublicationCandidate(installationRoot, staging)
          } catch (error) {
            group.failures.push(error)
          }
        }
        continue
      }

      if (group.backupClaims === 0 && group.removalClaims === 0) {
        for (const staging of group.stagings) {
          try {
            await this.#removePublicationCandidate(installationRoot, staging)
          } catch (error) {
            group.failures.push(error)
          }
        }
      } else {
        group.failures.push(new Error(`Plugin publication recovery is ambiguous: ${pluginId}`))
      }
    }

    const allFailures = [...failures, ...[...groups.values()].flatMap((group) => group.failures)]
    if (allFailures.length) {
      throw new AggregateError(allFailures, "Plugin publication recovery did not accept every transaction remnant", {
        cause: allFailures[0],
      })
    }
  }

  async #commitStaging(
    installationRoot: string,
    staging: string,
    options: WebPluginBundleInstallOptions & { builtinProvenance?: boolean; expectedId?: string } = {},
  ) {
    const initialManifest = await validateInstalledPackage(staging, this.#limits)
    const stagingPackage = await this.#validatePublicationPackage(
      installationRoot,
      staging,
      initialManifest.id,
      "Plugin staging package",
      options.builtinProvenance,
    )
    const manifest = stagingPackage.manifest
    if (options.expectedId && manifest.id !== options.expectedId) {
      throw new Error("Plugin manifest changed while it was being installed")
    }
    const summary = toInstalledWebPluginSummary(manifest)
    const target = path.join(installationRoot, manifest.id)
    const targetExists = await exists(target)
    let previous: WebPluginPublicationCandidate["previous"]
    let previousPackage: ValidatedPluginPackage | undefined
    if (!options.replaceExisting && targetExists) {
      throw new Error(`Plugin is already installed: ${manifest.id}`)
    }
    if (options.replaceExisting) {
      if (!targetExists) throw new Error(`Plugin is not installed: ${manifest.id}`)
      previousPackage = await this.#validatePublicationPackage(
        installationRoot,
        target,
        manifest.id,
        "Installed Plugin update source",
      )
      const installedRoot = previousPackage.path
      const installedManifest = previousPackage.manifest
      if (installedManifest.id !== manifest.id) throw new Error("Installed plugin id does not match its directory")
      if (compareWebPluginVersions(manifest.version, installedManifest.version) <= 0) {
        throw new Error(`Plugin update must have a newer version: ${manifest.id}`)
      }
      previous = { plugin: toInstalledWebPluginSummary(installedManifest), root: installedRoot }
    }
    if ((summary.contributes.skills?.length || previous?.plugin.contributes.skills?.length) && !options.beforePublish) {
      throw new Error(`Plugin-owned Skills require a host publication lifecycle: ${manifest.id}`)
    }
    const publication = await options.beforePublish?.(summary, {
      ...(previous ? { previous } : {}),
      root: staging,
    })
    let publicationPublished = false
    const publishAuthorization = async () => {
      if (!publication) return
      try {
        await publication.publish()
        publicationPublished = true
      } catch (error) {
        await rollbackPublishedPublication(
          publication,
          true,
          error,
          `Plugin pre-publication rollback requires startup recovery: ${manifest.id}`,
        )
        throw error
      }
    }
    const deferAuthorization = async () => {
      if (publicationPublished) await publication?.deferToRecovery?.()
    }
    if (!options.replaceExisting) {
      await publishAuthorization()
      try {
        await this.#assertPluginPackageUnchanged(installationRoot, stagingPackage, "Plugin staging package")
        await fs.rename(staging, target)
      } catch (error) {
        await rollbackPublishedPublication(
          publication,
          publicationPublished,
          error,
          `Plugin capability rollback requires startup recovery: ${manifest.id}`,
        )
        throw error
      }
      try {
        await publication?.activate?.()
        await publication?.commit()
      } catch (error) {
        const failures: unknown[] = [error]
        let packageRollbackComplete = true
        try {
          await fs.rename(target, staging)
        } catch (rollbackError) {
          packageRollbackComplete = false
          failures.push(rollbackError)
        }
        if (packageRollbackComplete) {
          await rollbackPublishedPublication(
            publication,
            publicationPublished,
            error,
            `Plugin capability rollback requires startup recovery: ${manifest.id}`,
          )
        } else {
          try {
            await deferAuthorization()
          } catch (deferError) {
            failures.push(deferError)
          }
          throw new WebPluginPublicationDeferredError(
            failures,
            `Plugin publication requires startup recovery: ${manifest.id}`,
            { cause: error },
          )
        }
        throw new AggregateError(failures, `Plugin publication rollback failed: ${manifest.id}`, { cause: error })
      }
      return summary
    }
    const backup = path.join(installationRoot, `.replaced-${manifest.id}-${randomUUID()}`)
    await publishAuthorization()
    try {
      await this.#assertPluginPackageUnchanged(installationRoot, stagingPackage, "Plugin staging package")
      await this.#assertPluginPackageUnchanged(installationRoot, previousPackage!, "Installed Plugin update source")
      await fs.rename(target, backup)
    } catch (error) {
      await rollbackPublishedPublication(
        publication,
        publicationPublished,
        error,
        `Plugin update capability rollback requires startup recovery: ${manifest.id}`,
      )
      throw error
    }
    try {
      await fs.rename(staging, target)
    } catch (error) {
      try {
        await fs.rename(backup, target)
      } catch (rollbackError) {
        const deferError = await deferAuthorization().then(
          () => undefined,
          (failure) => failure,
        )
        throw new WebPluginPublicationDeferredError(
          [error, rollbackError, ...(deferError ? [deferError] : [])],
          `Plugin update requires startup recovery: ${manifest.id}`,
          {
            cause: error,
          },
        )
      }
      await rollbackPublishedPublication(
        publication,
        publicationPublished,
        error,
        `Plugin update capability rollback requires startup recovery: ${manifest.id}`,
      )
      throw error
    }
    try {
      await publication?.activate?.()
      await publication?.commit()
    } catch (error) {
      const failures: unknown[] = [error]
      let packageRollbackComplete = true
      try {
        await fs.rename(target, staging)
        await fs.rename(backup, target)
      } catch (rollbackError) {
        packageRollbackComplete = false
        failures.push(rollbackError)
      }
      if (packageRollbackComplete) {
        await rollbackPublishedPublication(
          publication,
          publicationPublished,
          error,
          `Plugin update capability rollback requires startup recovery: ${manifest.id}`,
        )
      } else {
        try {
          await deferAuthorization()
        } catch (deferError) {
          failures.push(deferError)
        }
        throw new WebPluginPublicationDeferredError(
          failures,
          `Plugin update requires startup recovery: ${manifest.id}`,
          { cause: error },
        )
      }
      throw new AggregateError(failures, `Plugin update publication rollback failed: ${manifest.id}`, { cause: error })
    }
    await fs.rm(backup, { force: true, recursive: true }).catch(() => undefined)
    return summary
  }

  async #replaceBuiltinStaging(
    installationRoot: string,
    staging: string,
    expectedId: string,
    options: WebPluginPublicationOptions = {},
  ) {
    const initialManifest = await validateInstalledPackage(staging, this.#limits)
    const stagingPackage = await this.#validatePublicationPackage(
      installationRoot,
      staging,
      initialManifest.id,
      "Built-in Plugin staging package",
      true,
    )
    const manifest = stagingPackage.manifest
    const target = path.join(installationRoot, manifest.id)
    const currentPackage = await this.#validatePublicationPackage(
      installationRoot,
      target,
      expectedId,
      "Installed built-in Plugin update source",
      true,
    )
    const currentManifest = currentPackage.manifest
    if (currentManifest.id !== expectedId) throw new Error("Installed Plugin id does not match its directory")
    const currentProvenance = await readBuiltinProvenance(target, currentManifest).catch(() => {
      throw new Error(`Refusing to replace an imported Plugin with a built-in package: ${expectedId}`)
    })
    if ((await installedPackageDigest(target, this.#limits)) !== currentProvenance.bundleDigest) {
      throw new Error(`Installed built-in Plugin files do not match their provenance: ${expectedId}`)
    }
    const summary = { ...toInstalledWebPluginSummary(manifest), trustedBuiltin: true } as const
    if ((summary.contributes.skills?.length || currentManifest.contributes.skills?.length) && !options.beforePublish) {
      throw new Error(`Plugin-owned Skills require a host publication lifecycle: ${manifest.id}`)
    }
    const publication = await options.beforePublish?.(summary, {
      previous: { plugin: toInstalledWebPluginSummary(currentManifest), root: target },
      root: staging,
    })
    let publicationPublished = false
    if (publication) {
      try {
        await publication.publish()
        publicationPublished = true
      } catch (error) {
        await rollbackPublishedPublication(
          publication,
          true,
          error,
          `Built-in Plugin pre-publication rollback requires startup recovery: ${expectedId}`,
        )
        throw error
      }
    }
    const replaced = path.join(installationRoot, `.replaced-${expectedId}-${randomUUID()}`)
    const deferPublication = async () => {
      if (publicationPublished) await publication?.deferToRecovery?.()
    }
    try {
      await this.#assertPluginPackageUnchanged(installationRoot, stagingPackage, "Built-in Plugin staging package")
      await this.#assertPluginPackageUnchanged(
        installationRoot,
        currentPackage,
        "Installed built-in Plugin update source",
      )
      await fs.rename(target, replaced)
    } catch (error) {
      await rollbackPublishedPublication(
        publication,
        publicationPublished,
        error,
        `Built-in Plugin capability rollback requires startup recovery: ${expectedId}`,
      )
      throw error
    }
    try {
      await fs.rename(staging, target)
    } catch (error) {
      try {
        await fs.rename(replaced, target)
      } catch (rollbackError) {
        const deferError = publicationPublished
          ? await deferPublication().then(
              () => undefined,
              (failure) => failure,
            )
          : undefined
        throw new WebPluginPublicationDeferredError(
          [error, rollbackError, ...(deferError ? [deferError] : [])],
          `Built-in Plugin update requires startup recovery: ${expectedId}`,
          {
            cause: error,
          },
        )
      }
      await rollbackPublishedPublication(
        publication,
        publicationPublished,
        error,
        `Built-in Plugin capability rollback requires startup recovery: ${expectedId}`,
      )
      throw error
    }
    try {
      await publication?.activate?.()
      await publication?.commit()
    } catch (error) {
      const failures: unknown[] = [error]
      let packageRollbackComplete = true
      try {
        await fs.rename(target, staging)
        await fs.rename(replaced, target)
      } catch (rollbackError) {
        packageRollbackComplete = false
        failures.push(rollbackError)
      }
      if (publicationPublished && packageRollbackComplete) {
        await rollbackPublishedPublication(
          publication,
          publicationPublished,
          error,
          `Built-in Plugin capability rollback requires startup recovery: ${expectedId}`,
        )
      }
      if (!packageRollbackComplete) {
        try {
          await deferPublication()
        } catch (deferError) {
          failures.push(deferError)
        }
        throw new WebPluginPublicationDeferredError(
          failures,
          `Built-in Plugin update requires startup recovery: ${expectedId}`,
          { cause: error },
        )
      }
      throw new AggregateError(failures, `Built-in Plugin publication rollback failed: ${expectedId}`, { cause: error })
    }
    await fs.rm(replaced, { force: true, recursive: true }).catch(() => undefined)
    return summary
  }

  async install(
    sourceDirectory: string,
    options: WebPluginPublicationOptions = {},
  ): Promise<InstalledWebPluginSummary> {
    const installationRoot = await this.#ensureRoot()
    const sourcePath = path.resolve(sourceDirectory)
    const sourceRoot = await assertPlainDirectory(sourcePath, "Plugin package")
    if (isInside(sourceRoot, installationRoot) || isInside(installationRoot, sourceRoot)) {
      throw new Error("Plugin package and installation roots cannot overlap")
    }
    const sourceManifest = await readManifest(sourceRoot, this.#limits.maxFileBytes)
    if (this.#reservedBuiltinIds.has(sourceManifest.id)) {
      throw new Error(`Plugin id is reserved for a built-in catalog package: ${sourceManifest.id}`)
    }
    return this.#runPluginMutation(
      sourceManifest.id,
      async () => {
        const target = path.join(installationRoot, sourceManifest.id)
        if (await exists(target)) throw new Error(`Plugin is already installed: ${sourceManifest.id}`)

        const staging = path.join(installationRoot, `.staging-${sourceManifest.id}-${randomUUID()}`)
        const beforePublish = options.beforePublish?.bind(options)
        try {
          await copyPackageEntry(sourceRoot, staging, {
            entries: 0,
            limits: this.#limits,
            sourceRoot,
            totalBytes: 0,
          })
          return await this.#commitStaging(installationRoot, staging, {
            ...(beforePublish ? { beforePublish } : {}),
            expectedId: sourceManifest.id,
          })
        } finally {
          // The package switch/error is authoritative. A host-named staging
          // remnant is recovered on startup and must never mask success or a
          // typed publication-deferred failure.
          await fs.rm(staging, { force: true, recursive: true }).catch(() => undefined)
        }
      },
      options.mutation,
    )
  }

  async installBundle(
    bundle: WebPluginBundle,
    options: WebPluginBundleInstallOptions = {},
  ): Promise<InstalledWebPluginSummary> {
    const manifest = bundleManifest(bundle)
    if (this.#reservedBuiltinIds.has(manifest.id)) {
      throw new Error(`Plugin id is reserved for a built-in catalog package: ${manifest.id}`)
    }
    return this.#runPluginMutation(
      manifest.id,
      () => this.#installBundle(bundle, undefined, false, options, manifest.id),
      options.mutation,
    )
  }

  async installOrUpdateBuiltinBundle(
    bundle: WebPluginBundle,
    options: WebPluginBuiltinInstallOptions = {},
  ): Promise<InstalledWebPluginSummary> {
    const requestedManifest = bundleManifest(bundle)
    return this.#runPluginMutation(
      requestedManifest.id,
      async () => {
        const manifest = bundleManifest(bundle)
        if (manifest.id !== requestedManifest.id) throw new Error("Plugin bundle changed while awaiting publication")
        const expectedDigest = bundleDigest(bundle)
        const installationRoot = await this.#ensureRoot()
        const target = path.join(installationRoot, manifest.id)
        if (await exists(target)) {
          await this.#claimInstalledBuiltinBundle(bundle, options)
          const installedManifest = await validateInstalledPackage(target, this.#limits)
          const provenance = await readBuiltinProvenance(target, installedManifest)
          if (
            installedManifest.id === manifest.id &&
            installedManifest.version === manifest.version &&
            provenance.bundleDigest === expectedDigest &&
            (await installedPackageMatchesBundle(target, bundle, this.#limits))
          ) {
            return { ...toInstalledWebPluginSummary(installedManifest), trustedBuiltin: true }
          }
          if (
            installedManifest.id !== manifest.id ||
            compareWebPluginVersions(manifest.version, installedManifest.version) <= 0
          ) {
            throw new Error(`Built-in Plugin update must have a newer version: ${manifest.id}`)
          }
        }
        const provenance: BuiltinProvenance = {
          bundleDigest: expectedDigest,
          id: manifest.id,
          schema: builtinProvenanceSchema,
          version: manifest.version,
        }
        return this.#installBundle(bundle, provenance, await exists(target), options, manifest.id)
      },
      options.mutation,
    )
  }

  /**
   * Claims only an already-installed, byte-for-byte approved catalog bundle.
   * A missing package stays missing so startup never reverses a user uninstall.
   */
  async claimInstalledBuiltinBundle(
    bundle: WebPluginBundle,
    options: { legacyBundleDigests?: readonly WebPluginLegacyBundleDigest[] } = {},
  ) {
    const manifest = bundleManifest(bundle)
    return this.#runPluginMutation(manifest.id, () => this.#claimInstalledBuiltinBundle(bundle, options))
  }

  async #claimInstalledBuiltinBundle(
    bundle: WebPluginBundle,
    options: { legacyBundleDigests?: readonly WebPluginLegacyBundleDigest[] } = {},
  ) {
    const manifest = bundleManifest(bundle)
    const expectedDigest = bundleDigest(bundle)
    const legacyBundleDigests = validateLegacyBundleDigests(manifest.version, options.legacyBundleDigests)
    const installationRoot = await this.#ensureRoot()
    const target = path.join(installationRoot, manifest.id)
    if (!(await exists(target))) return false

    const installedManifest = await validateInstalledPackage(target, this.#limits)
    const actualDigest = await installedPackageDigest(target, this.#limits).catch(() => "")
    const markerPath = path.join(target, builtinProvenanceFileName)
    const provenance = (await exists(markerPath)) ? await readBuiltinProvenance(target, installedManifest) : null
    if (provenance && provenance.bundleDigest !== actualDigest) {
      throw new Error(`Installed built-in Plugin files do not match their provenance: ${manifest.id}`)
    }

    const approvedCurrent =
      installedManifest.id === manifest.id &&
      installedManifest.version === manifest.version &&
      actualDigest === expectedDigest
    const approvedLegacy =
      installedManifest.id === manifest.id && legacyBundleDigests.get(installedManifest.version) === actualDigest
    if (!approvedCurrent && !approvedLegacy) {
      throw new Error(`A non-built-in Plugin is using the reserved catalog id: ${manifest.id}`)
    }
    if (!provenance) {
      const adopted: BuiltinProvenance = {
        bundleDigest: actualDigest,
        id: installedManifest.id,
        schema: builtinProvenanceSchema,
        version: installedManifest.version,
      }
      await fs.writeFile(markerPath, `${JSON.stringify(adopted, null, 2)}\n`, { flag: "wx", mode: 0o600 })
    }
    return true
  }

  async isBuiltinBundleInstalled(bundle: WebPluginBundle) {
    const manifest = bundleManifest(bundle)
    const expectedDigest = bundleDigest(bundle)
    try {
      const installationRoot = await this.#ensureRoot()
      const target = path.join(installationRoot, manifest.id)
      const installedManifest = await validateInstalledPackage(target, this.#limits)
      const provenance = await readBuiltinProvenance(target, installedManifest)
      return (
        installedManifest.id === manifest.id &&
        installedManifest.version === manifest.version &&
        provenance.bundleDigest === expectedDigest &&
        (await installedPackageMatchesBundle(target, bundle, this.#limits))
      )
    } catch {
      return false
    }
  }

  /** Verifies that an installed Registry package is byte-for-byte this bundle. */
  async isBundleInstalled(bundle: WebPluginBundle, mutation?: WebPluginMutationContext) {
    const manifest = bundleManifest(bundle)
    return this.#runPluginMutation(
      manifest.id,
      async () => {
        try {
          const installationRoot = await this.#ensureRoot()
          const target = path.join(installationRoot, manifest.id)
          const installedManifest = await validateInstalledPackage(target, this.#limits)
          return (
            installedManifest.id === manifest.id &&
            installedManifest.version === manifest.version &&
            (await installedPackageMatchesBundle(target, bundle, this.#limits))
          )
        } catch {
          return false
        }
      },
      mutation,
    )
  }

  async #installBundle(
    bundle: WebPluginBundle,
    provenance?: BuiltinProvenance,
    replaceBuiltin = false,
    options: WebPluginBundleInstallOptions = {},
    expectedId?: string,
  ): Promise<InstalledWebPluginSummary> {
    if (!bundle || typeof bundle !== "object" || !bundle.files || typeof bundle.files !== "object") {
      throw new Error("Plugin bundle files are required")
    }
    const installationRoot = await this.#ensureRoot()
    const staging = path.join(installationRoot, `.staging-bundle-${randomUUID()}`)
    try {
      const packagedFiles = provenance
        ? { ...bundle.files, [builtinProvenanceFileName]: `${JSON.stringify(provenance, null, 2)}\n` }
        : bundle.files
      const files = Object.entries(packagedFiles).map(([relativePath, content]) => ({
        content,
        relativePath: requireWebPluginRelativePath(relativePath, "Plugin bundle path"),
      }))
      if (!files.some((file) => file.relativePath === webPluginManifestFileName)) {
        throw new Error(`Plugin bundle is missing ${webPluginManifestFileName}`)
      }
      const portablePaths = new Set<string>()
      const directories = new Set<string>([""])
      const portableDirectories = new Map<string, string>()
      for (const file of files) {
        if (file.relativePath.toLocaleLowerCase("en-US") === portableBuiltinProvenanceFileName && !provenance) {
          throw new Error(`Plugin bundle path is reserved by the host: ${builtinProvenanceFileName}`)
        }
        const portablePath = file.relativePath.toLocaleLowerCase("en-US")
        if (portablePaths.has(portablePath)) throw new Error("Plugin bundle contains paths that collide on Windows")
        portablePaths.add(portablePath)
        const segments = file.relativePath.split("/")
        for (let index = 1; index < segments.length; index += 1) {
          const directory = segments.slice(0, index).join("/")
          const portableDirectory = directory.toLocaleLowerCase("en-US")
          const priorDirectory = portableDirectories.get(portableDirectory)
          if (priorDirectory && priorDirectory !== directory) {
            throw new Error("Plugin bundle contains directory names that collide on Windows")
          }
          portableDirectories.set(portableDirectory, directory)
          directories.add(directory)
        }
      }
      for (const directory of directories) {
        if (directory && portablePaths.has(directory.toLocaleLowerCase("en-US"))) {
          throw new Error(`Plugin bundle path is both a file and directory: ${directory}`)
        }
      }
      if (files.length + directories.size > this.#limits.maxEntryCount) {
        throw new Error("Plugin package exceeds the entry count limit")
      }
      await fs.mkdir(staging, { mode: 0o700 })
      let totalBytes = 0
      for (const file of files) {
        if (typeof file.content !== "string" && !(file.content instanceof Uint8Array)) {
          throw new Error(`Plugin bundle file has unsupported content: ${file.relativePath}`)
        }
        const content = typeof file.content === "string" ? Buffer.from(file.content) : Buffer.from(file.content)
        if (content.byteLength > this.#limits.maxFileBytes) {
          throw new Error(`Plugin file exceeds the per-file size limit: ${file.relativePath}`)
        }
        totalBytes += content.byteLength
        if (totalBytes > this.#limits.maxTotalBytes) throw new Error("Plugin package exceeds the total size limit")
        const target = path.join(staging, ...file.relativePath.split("/"))
        await fs.mkdir(path.dirname(target), { mode: 0o700, recursive: true })
        await fs.writeFile(target, content, { flag: "wx", mode: 0o600 })
      }
      if (replaceBuiltin) {
        return await this.#replaceBuiltinStaging(installationRoot, staging, provenance!.id, {
          beforePublish: options.beforePublish,
        })
      }
      const installed = await this.#commitStaging(installationRoot, staging, {
        ...(provenance ? { builtinProvenance: true } : {}),
        ...((provenance?.id ?? expectedId) ? { expectedId: provenance?.id ?? expectedId } : {}),
        ...options,
      })
      return provenance ? { ...installed, trustedBuiltin: true } : installed
    } finally {
      // Startup publication recovery owns any host-named remnant. Cleanup is
      // never allowed to replace the package transaction's result.
      await fs.rm(staging, { force: true, recursive: true }).catch(() => undefined)
    }
  }

  async list(): Promise<InstalledWebPluginSummary[]> {
    const installationRoot = await this.#ensureRoot()
    const summaries: InstalledWebPluginSummary[] = []
    for (const entry of await fs.readdir(installationRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue
      try {
        const pluginRoot = path.join(installationRoot, entry.name)
        const manifest = await validateInstalledPackage(pluginRoot, this.#limits)
        if (manifest.id === entry.name) {
          const summary = toInstalledWebPluginSummary(manifest)
          const trustedBuiltin = await readBuiltinProvenance(pluginRoot, manifest).then(
            async (provenance) =>
              (await installedPackageDigest(pluginRoot, this.#limits).catch(() => "")) === provenance.bundleDigest,
            () => false,
          )
          summaries.push(trustedBuiltin ? { ...summary, trustedBuiltin: true } : summary)
        }
      } catch {
        // Invalid or externally tampered installations never reach the renderer.
      }
    }
    return summaries.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  }

  /**
   * Resolves one exact installed manifest identity under the per-Plugin
   * publication lock. Capability connections bind to this digest and re-run
   * the resolution on every call, so permission changes, update, or uninstall
   * invalidate an existing connection without hashing unrelated static assets.
   */
  async resolveCapabilityIdentity(pluginId: string) {
    const id = requireWebPluginId(pluginId)
    return this.#runPluginMutation(id, async () => {
      const installationRoot = await this.#ensureRoot()
      const pluginRootPath = path.join(installationRoot, id)
      if (!(await exists(pluginRootPath))) return null
      const pluginRoot = await assertPlainDirectory(pluginRootPath, "Installed plugin")
      const manifest = await validateInstalledPackage(pluginRoot, this.#limits)
      if (manifest.id !== id) throw new Error("Installed plugin id does not match its directory")
      const digest = capabilityManifestDigest(manifest)
      const verifiedManifest = await validateInstalledPackage(pluginRoot, this.#limits)
      if (
        verifiedManifest.id !== manifest.id ||
        verifiedManifest.version !== manifest.version ||
        capabilityManifestDigest(verifiedManifest) !== digest
      ) {
        throw new Error(`Installed Plugin changed while its capability identity was resolved: ${id}`)
      }
      const summary = toInstalledWebPluginSummary(verifiedManifest)
      const trustedBuiltin = await readBuiltinProvenance(pluginRoot, verifiedManifest).then(
        async (provenance) => (await installedPackageDigest(pluginRoot, this.#limits)) === provenance.bundleDigest,
        () => false,
      )
      return {
        digest,
        plugin: trustedBuiltin ? { ...summary, trustedBuiltin: true as const } : summary,
      }
    })
  }

  async resolveAsset(pluginId: string, relativePath: string) {
    const id = requireWebPluginId(pluginId)
    const portablePath = requireWebPluginRelativePath(relativePath, "Plugin asset path")
    const installationRoot = await this.#ensureRoot()
    const pluginPath = path.join(installationRoot, id)
    const pluginRoot = await assertPlainDirectory(pluginPath, "Installed plugin")
    assertInside(pluginRoot, installationRoot, "Installed plugin")
    const manifest = await readManifest(pluginRoot, this.#limits.maxFileBytes)
    if (manifest.id !== id) throw new Error("Installed plugin id does not match its directory")
    return assertRegularInstalledFile(pluginRoot, portablePath, "Plugin asset")
  }

  async uninstall(pluginId: string, options: WebPluginUninstallOptions = {}) {
    const id = requireWebPluginId(pluginId)
    return this.#runPluginMutation(
      id,
      async () => {
        const installationRoot = await this.#ensureRoot()
        const target = path.join(installationRoot, id)
        if (!(await exists(target))) return false
        const installedRoot = await assertPlainDirectory(target, "Installed plugin")
        const manifest = await validateInstalledPackage(installedRoot, this.#limits)
        if (manifest.id !== id) throw new Error("Installed plugin id does not match its directory")
        if (manifest.contributes.skills?.length && !options.beforeRemove) {
          throw new Error(`Plugin-owned Skills require a host publication lifecycle: ${manifest.id}`)
        }
        const publication = await options.beforeRemove?.(toInstalledWebPluginSummary(manifest))
        let publicationPublished = false
        if (publication) {
          try {
            await publication.publish()
            publicationPublished = true
          } catch (error) {
            await rollbackPublishedPublication(
              publication,
              true,
              error,
              `Plugin uninstall pre-publication rollback requires startup recovery: ${id}`,
            )
            throw error
          }
        }
        const tombstone = path.join(installationRoot, `.removed-${id}-${randomUUID()}`)
        try {
          await fs.rename(target, tombstone)
        } catch (error) {
          await rollbackPublishedPublication(
            publication,
            publicationPublished,
            error,
            `Plugin uninstall capability rollback requires startup recovery: ${id}`,
          )
          throw error
        }
        try {
          await publication?.activate?.()
          await publication?.commit()
        } catch (error) {
          const failures: unknown[] = [error]
          let packageRollbackComplete = true
          try {
            await fs.rename(tombstone, target)
          } catch (rollbackError) {
            packageRollbackComplete = false
            failures.push(rollbackError)
          }
          if (publicationPublished && packageRollbackComplete) {
            await rollbackPublishedPublication(
              publication,
              publicationPublished,
              error,
              `Plugin uninstall capability rollback requires startup recovery: ${id}`,
            )
          }
          if (!packageRollbackComplete) {
            if (publicationPublished) {
              try {
                await publication?.deferToRecovery?.()
              } catch (deferError) {
                failures.push(deferError)
              }
            }
            throw new WebPluginPublicationDeferredError(failures, `Plugin uninstall requires startup recovery: ${id}`, {
              cause: error,
            })
          }
          throw new AggregateError(failures, `Plugin uninstall rollback failed: ${id}`, { cause: error })
        }
        await fs.rm(tombstone, { force: true, recursive: true }).catch(() => undefined)
        return true
      },
      options.mutation,
    )
  }
}
