import { randomUUID } from "node:crypto"
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

export interface WebPluginInstallLimits {
  maxEntryCount?: number
  maxFileBytes?: number
  maxTotalBytes?: number
}

export interface WebPluginBundle {
  files: Readonly<Record<string, string | Uint8Array>>
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
  await assertRegularInstalledFile(directory, manifest.entry, "Plugin entry")
  if (manifest.skill) {
    const skillPath = await assertRegularInstalledFile(directory, manifest.skill, "Plugin skill")
    if (path.basename(skillPath).toLocaleLowerCase("en-US") !== "skill.md") {
      throw new Error("Plugin skill must point to a SKILL.md file")
    }
  }
  return manifest
}

export class WebPluginManager {
  readonly #limits: ResolvedLimits
  readonly #rootPath: string

  constructor(rootPath: string, limits: WebPluginInstallLimits = {}) {
    if (!rootPath.trim()) throw new Error("Plugin installation root is required")
    this.#rootPath = path.resolve(rootPath)
    this.#limits = resolveLimits(limits)
  }

  async #ensureRoot() {
    await fs.mkdir(this.#rootPath, { mode: 0o700, recursive: true })
    return assertPlainDirectory(this.#rootPath, "Plugin installation root")
  }

  async #commitStaging(
    installationRoot: string,
    staging: string,
    options: { expectedId?: string; replaceExisting?: boolean } = {},
  ) {
    const manifest = await validateInstalledPackage(staging, this.#limits)
    if (options.expectedId && manifest.id !== options.expectedId) {
      throw new Error("Plugin manifest changed while it was being installed")
    }
    const target = path.join(installationRoot, manifest.id)
    const targetExists = await exists(target)
    if (!options.replaceExisting) {
      if (targetExists) throw new Error(`Plugin is already installed: ${manifest.id}`)
      await fs.rename(staging, target)
      return toInstalledWebPluginSummary(manifest)
    }
    if (!targetExists) throw new Error(`Plugin is not installed: ${manifest.id}`)

    const installedRoot = await assertPlainDirectory(target, "Installed plugin")
    const installedManifest = await validateInstalledPackage(installedRoot, this.#limits)
    if (installedManifest.id !== manifest.id) throw new Error("Installed plugin id does not match its directory")
    if (compareWebPluginVersions(manifest.version, installedManifest.version) <= 0) {
      throw new Error(`Plugin update must have a newer version: ${manifest.id}`)
    }

    const backup = path.join(installationRoot, `.replaced-${manifest.id}-${randomUUID()}`)
    await fs.rename(target, backup)
    try {
      await fs.rename(staging, target)
    } catch (error) {
      try {
        await fs.rename(backup, target)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Plugin update rollback failed: ${manifest.id}`, {
          cause: error,
        })
      }
      throw error
    }
    await fs.rm(backup, { force: true, recursive: true }).catch(() => undefined)
    return toInstalledWebPluginSummary(manifest)
  }

  async install(sourceDirectory: string): Promise<InstalledWebPluginSummary> {
    const installationRoot = await this.#ensureRoot()
    const sourcePath = path.resolve(sourceDirectory)
    const sourceRoot = await assertPlainDirectory(sourcePath, "Plugin package")
    if (isInside(sourceRoot, installationRoot) || isInside(installationRoot, sourceRoot)) {
      throw new Error("Plugin package and installation roots cannot overlap")
    }
    const sourceManifest = await readManifest(sourceRoot, this.#limits.maxFileBytes)
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
      return await this.#commitStaging(installationRoot, staging, { expectedId: sourceManifest.id })
    } finally {
      await fs.rm(staging, { force: true, recursive: true })
    }
  }

  async installBundle(
    bundle: WebPluginBundle,
    options: { replaceExisting?: boolean } = {},
  ): Promise<InstalledWebPluginSummary> {
    if (!bundle || typeof bundle !== "object" || !bundle.files || typeof bundle.files !== "object") {
      throw new Error("Plugin bundle files are required")
    }
    const installationRoot = await this.#ensureRoot()
    const staging = path.join(installationRoot, `.staging-bundle-${randomUUID()}`)
    try {
      const files = Object.entries(bundle.files).map(([relativePath, content]) => ({
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
      return await this.#commitStaging(installationRoot, staging, options)
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
        if (manifest.id === entry.name) summaries.push(toInstalledWebPluginSummary(manifest))
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
