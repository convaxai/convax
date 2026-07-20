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
  publish(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
}

export interface WebPluginPublicationOptions {
  beforePublish?(plugin: InstalledWebPluginSummary): Promise<WebPluginPublicationTransaction>
}

export interface WebPluginBundleInstallOptions extends WebPluginPublicationOptions {
  replaceExisting?: boolean
}

interface ResolvedLimits {
  maxEntryCount: number
  maxFileBytes: number
  maxTotalBytes: number
}

interface CopyState {
  entries: number
  limits: ResolvedLimits
  sourceRoot: string
  totalBytes: number
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
  readonly #limits: ResolvedLimits
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

  async #commitStaging(
    installationRoot: string,
    staging: string,
    options: WebPluginBundleInstallOptions & { expectedId?: string } = {},
  ) {
    const manifest = await validateInstalledPackage(staging, this.#limits)
    if (options.expectedId && manifest.id !== options.expectedId) {
      throw new Error("Plugin manifest changed while it was being installed")
    }
    const summary = toInstalledWebPluginSummary(manifest)
    const target = path.join(installationRoot, manifest.id)
    const targetExists = await exists(target)
    if (!options.replaceExisting && targetExists) {
      throw new Error(`Plugin is already installed: ${manifest.id}`)
    }
    if (options.replaceExisting) {
      if (!targetExists) throw new Error(`Plugin is not installed: ${manifest.id}`)
      const installedRoot = await assertPlainDirectory(target, "Installed plugin")
      const installedManifest = await validateInstalledPackage(installedRoot, this.#limits)
      if (installedManifest.id !== manifest.id) throw new Error("Installed plugin id does not match its directory")
      if (compareWebPluginVersions(manifest.version, installedManifest.version) <= 0) {
        throw new Error(`Plugin update must have a newer version: ${manifest.id}`)
      }
    }

    const publication = await options.beforePublish?.(summary)
    let publicationPublished = false
    const publishAuthorization = async () => {
      if (!publication) return
      try {
        await publication.publish()
        publicationPublished = true
      } catch (error) {
        await publication.rollback().catch(() => undefined)
        throw error
      }
    }
    const rollbackAuthorization = async () => {
      if (publicationPublished) await publication?.rollback()
    }

    if (!options.replaceExisting) {
      await publishAuthorization()
      try {
        await fs.rename(staging, target)
        await publication?.commit()
      } catch (error) {
        const failures: unknown[] = [error]
        if (await exists(target)) {
          try {
            await fs.rename(target, staging)
          } catch (rollbackError) {
            failures.push(rollbackError)
          }
        }
        try {
          await rollbackAuthorization()
        } catch (rollbackError) {
          failures.push(rollbackError)
        }
        throw new AggregateError(failures, `Plugin publication rollback failed: ${manifest.id}`, { cause: error })
      }
      return summary
    }

    const backup = path.join(installationRoot, `.replaced-${manifest.id}-${randomUUID()}`)
    await publishAuthorization()
    try {
      await fs.rename(target, backup)
    } catch (error) {
      await rollbackAuthorization().catch(() => undefined)
      throw error
    }
    try {
      await fs.rename(staging, target)
      await publication?.commit()
    } catch (error) {
      const failures: unknown[] = [error]
      try {
        if (await exists(target)) await fs.rename(target, staging)
        await fs.rename(backup, target)
      } catch (rollbackError) {
        failures.push(rollbackError)
      }
      try {
        await rollbackAuthorization()
      } catch (rollbackError) {
        failures.push(rollbackError)
      }
      throw new AggregateError(failures, `Plugin update publication rollback failed: ${manifest.id}`, { cause: error })
    }
    await fs.rm(backup, { force: true, recursive: true }).catch(() => undefined)
    return summary
  }

  async #replaceBuiltinStaging(installationRoot: string, staging: string, expectedId: string) {
    const manifest = await validateInstalledPackage(staging, this.#limits)
    if (manifest.id !== expectedId) throw new Error("Plugin manifest changed while it was being installed")
    await readBuiltinProvenance(staging, manifest)
    const target = path.join(installationRoot, manifest.id)
    const currentManifest = await validateInstalledPackage(target, this.#limits)
    if (currentManifest.id !== expectedId) throw new Error("Installed Plugin id does not match its directory")
    const currentProvenance = await readBuiltinProvenance(target, currentManifest).catch(() => {
      throw new Error(`Refusing to replace an imported Plugin with a built-in package: ${expectedId}`)
    })
    if ((await installedPackageDigest(target, this.#limits)) !== currentProvenance.bundleDigest) {
      throw new Error(`Installed built-in Plugin files do not match their provenance: ${expectedId}`)
    }
    const replaced = path.join(installationRoot, `.replaced-${expectedId}-${randomUUID()}`)
    await fs.rename(target, replaced)
    try {
      await fs.rename(staging, target)
    } catch (error) {
      try {
        await fs.rename(replaced, target)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Built-in Plugin update rollback failed: ${expectedId}`, {
          cause: error,
        })
      }
      throw error
    }
    await fs.rm(replaced, { force: true, recursive: true }).catch(() => undefined)
    return { ...toInstalledWebPluginSummary(manifest), trustedBuiltin: true } as const
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
    const target = path.join(installationRoot, sourceManifest.id)
    if (await exists(target)) throw new Error(`Plugin is already installed: ${sourceManifest.id}`)

    const staging = path.join(installationRoot, `.staging-${sourceManifest.id}-${randomUUID()}`)
    try {
      await copyPackageEntry(sourceRoot, staging, {
        entries: 0,
        limits: this.#limits,
        sourceRoot,
        totalBytes: 0,
      })
      return await this.#commitStaging(installationRoot, staging, {
        ...(options.beforePublish ? { beforePublish: options.beforePublish } : {}),
        expectedId: sourceManifest.id,
      })
    } finally {
      await fs.rm(staging, { force: true, recursive: true })
    }
  }

  async installBundle(
    bundle: WebPluginBundle,
    options: WebPluginBundleInstallOptions = {},
  ): Promise<InstalledWebPluginSummary> {
    const manifest = bundleManifest(bundle)
    if (this.#reservedBuiltinIds.has(manifest.id)) {
      throw new Error(`Plugin id is reserved for a built-in catalog package: ${manifest.id}`)
    }
    return this.#installBundle(bundle, undefined, false, options)
  }

  async installOrUpdateBuiltinBundle(
    bundle: WebPluginBundle,
    options: { legacyBundleDigests?: readonly WebPluginLegacyBundleDigest[] } = {},
  ): Promise<InstalledWebPluginSummary> {
    const manifest = bundleManifest(bundle)
    const expectedDigest = bundleDigest(bundle)
    const installationRoot = await this.#ensureRoot()
    const target = path.join(installationRoot, manifest.id)
    if (await exists(target)) {
      await this.claimInstalledBuiltinBundle(bundle, options)
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
    return this.#installBundle(bundle, provenance, await exists(target))
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

  async #installBundle(
    bundle: WebPluginBundle,
    provenance?: BuiltinProvenance,
    replaceBuiltin = false,
    options: WebPluginBundleInstallOptions = {},
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
      if (replaceBuiltin) return await this.#replaceBuiltinStaging(installationRoot, staging, provenance!.id)
      const installed = await this.#commitStaging(installationRoot, staging, {
        ...(provenance ? { expectedId: provenance.id } : {}),
        ...options,
      })
      return provenance ? { ...installed, trustedBuiltin: true } : installed
    } finally {
      await fs.rm(staging, { force: true, recursive: true })
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

  async uninstall(pluginId: string) {
    const id = requireWebPluginId(pluginId)
    const installationRoot = await this.#ensureRoot()
    const target = path.join(installationRoot, id)
    if (!(await exists(target))) return false
    await assertPlainDirectory(target, "Installed plugin")
    const tombstone = path.join(installationRoot, `.removed-${id}-${randomUUID()}`)
    await fs.rename(target, tombstone)
    await fs.rm(tombstone, { force: true, recursive: true })
    return true
  }
}
