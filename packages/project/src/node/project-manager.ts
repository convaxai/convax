import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants, watch as watchFileSystem, type BigIntStats, type FSWatcher } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import type {
  ProjectChangeEvent,
  ProjectDirectoryListing,
  ProjectEntry,
  ProjectFileContents,
  ProjectFileInfo,
  ProjectMutationResult,
  ProjectTextFileContents,
  ProjectTextPreviewContents,
} from "../contracts"
import {
  assertNoSymlinkSegments,
  assertNotProjectRoot,
  assertPortableTree,
  assertUserMutationPath,
  collisionKey,
  compareEntries,
  compareProjects,
  copyPath,
  ensureInside,
  exists,
  existsPortable,
  isDirectory,
  isIgnoredName,
  isInsidePath,
  isNodeError,
  isProjectRecord,
  isSafeProjectRoot,
  joinRelative,
  mimeTypeForPath,
  movePath,
  mutation,
  nextAvailablePath,
  normalizeRelativePath,
  normalizeSelectionRoots,
  parentOf,
  parseProjectManifest,
  projectIdForPath,
  projectManifestPath,
  requireEntryPath,
  requireProjectId,
  sameNativePath,
  textFileKey,
  textPreviewBytes,
  toProjectRecord,
  validateName,
  writeFileReplacing,
  type ProjectManifest,
  type ProjectRegistryFile,
  type ProjectRegistryRecord,
} from "./project-manager-helpers"
import {
  ProjectPrivateStorageConflictError,
  type ProjectPrivatePathRef,
  type ProjectPrivatePathResolver,
  type ProjectPrivateStorage,
  type ProjectPrivateTextFileRef,
  type ProjectPrivateTextFileWrite,
} from "./project-private-storage"

export interface NodeProjectManagerOptions {
  caseInsensitivePaths?: boolean
  maxReadableFileBytes?: number
  maxTextFileBytes?: number
  now?: () => number
  registryFile: string
  trash?: (targetPath: string) => Promise<void>
  watchDebounceMs?: number
}

function privateTextFileRelativePath(namespace: string, value: string) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(namespace)) {
    throw new Error(`Invalid project private namespace: ${namespace}`)
  }
  const relativePath = normalizeRelativePath(value)
  if (!relativePath) throw new Error("Project private file path is required")
  return `.convax/${namespace}/${relativePath}`
}

function privateTextFilePath(rootPath: string, namespace: string, value: string) {
  const relativePath = privateTextFileRelativePath(namespace, value)
  const namespaceRoot = path.join(rootPath, ".convax", namespace)
  const absolutePath = path.resolve(rootPath, ...relativePath.split("/"))
  ensureInside(absolutePath, namespaceRoot, relativePath)
  return absolutePath
}

function privatePathRelativePath(value: string) {
  const relativePath = normalizeRelativePath(value)
  if (!relativePath) throw new Error("Project private path is required")
  return `.convax/${relativePath}`
}

function privateTextVersion(content: string) {
  return createHash("sha256").update(content).digest("hex")
}

export class NodeProjectManager implements ProjectPrivatePathResolver, ProjectPrivateStorage {
  private readonly now: () => number
  private projectCreationQueue: Promise<void> = Promise.resolve()
  private registryQueue: Promise<unknown> = Promise.resolve()
  private readonly projectMutationQueues = new Map<string, Promise<void>>()
  private readonly textWriteQueues = new Map<string, Promise<void>>()

  constructor(private readonly options: NodeProjectManagerOptions) {
    this.now = options.now ?? Date.now
  }

  list() {
    return this.listProjects()
  }

  add(rootPath: string) {
    return this.addProject(rootPath)
  }

  create(parentPath: string, name: string) {
    return this.createProject({ name, parentPath })
  }

  rename(projectId: string, name: string) {
    return this.renameProject(projectId, name)
  }

  forget(projectId: string) {
    return this.forgetProject(projectId)
  }

  async flushPendingWrites() {
    const failures: unknown[] = []
    while (true) {
      const projectCreation = this.projectCreationQueue
      const registry = this.registryQueue
      const results = await Promise.allSettled([
        projectCreation,
        ...this.textWriteQueues.values(),
        ...this.projectMutationQueues.values(),
      ])
      failures.push(...results.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])))
      await registry
      if (
        this.textWriteQueues.size === 0 &&
        this.projectMutationQueues.size === 0 &&
        projectCreation === this.projectCreationQueue &&
        registry === this.registryQueue
      )
        break
    }
    if (failures.length > 0) throw new AggregateError(failures, "Project files could not be saved")
  }

  async readPrivateTextFile(input: ProjectPrivateTextFileRef) {
    const relativePath = privateTextFileRelativePath(input.namespace, input.path)
    await this.waitForTextWrite(textFileKey(input.projectId, relativePath))
    const project = await this.getProject(input.projectId)
    const absolutePath = privateTextFilePath(project.rootPath, input.namespace, input.path)
    await assertNoSymlinkSegments(project.rootPath, relativePath)
    try {
      const stat = await fs.stat(absolutePath)
      if (!stat.isFile()) throw new Error(`Project private path is not a file: ${relativePath}`)
      if (stat.size > (this.options.maxTextFileBytes ?? 16 * 1024 * 1024)) {
        throw new Error(`Project private file is too large to read: ${relativePath}`)
      }
      const content = await fs.readFile(absolutePath, "utf8")
      return { content, exists: true, version: privateTextVersion(content) }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return { content: "", exists: false, version: null }
      throw error
    }
  }

  async writePrivateTextFile(input: ProjectPrivateTextFileWrite) {
    const relativePath = privateTextFileRelativePath(input.namespace, input.path)
    if (Buffer.byteLength(input.content, "utf8") > (this.options.maxTextFileBytes ?? 16 * 1024 * 1024)) {
      throw new Error(`Project private file is too large to write: ${relativePath}`)
    }
    let version = ""
    await this.queueTextWrite(textFileKey(input.projectId, relativePath), async () => {
      await this.queueProjectMutation(input.projectId, async () => {
        const project = await this.getProject(input.projectId)
        const absolutePath = privateTextFilePath(project.rootPath, input.namespace, input.path)
        await assertNoSymlinkSegments(project.rootPath, relativePath)
        const currentContent = await fs.readFile(absolutePath, "utf8").catch((error: unknown) => {
          if (isNodeError(error) && error.code === "ENOENT") return null
          throw error
        })
        const currentVersion = currentContent === null ? null : privateTextVersion(currentContent)
        if (input.expectedVersion !== undefined && input.expectedVersion !== currentVersion) {
          throw new ProjectPrivateStorageConflictError(input.expectedVersion, currentVersion)
        }
        if (input.createParents) await fs.mkdir(path.dirname(absolutePath), { recursive: true })
        else if (!(await fs.stat(path.dirname(absolutePath))).isDirectory()) {
          throw new Error(`Project private parent is not a directory: ${relativePath}`)
        }
        await writeFileReplacing(absolutePath, input.content)
        version = privateTextVersion(input.content)
      })
    })
    return { version }
  }

  async removePrivatePath(input: ProjectPrivateTextFileRef) {
    const relativePath = privateTextFileRelativePath(input.namespace, input.path)
    await this.waitForProjectTextWrites(input.projectId)
    return this.queueProjectMutation(input.projectId, async () => {
      const project = await this.getProject(input.projectId)
      const absolutePath = privateTextFilePath(project.rootPath, input.namespace, input.path)
      await assertNoSymlinkSegments(project.rootPath, relativePath)
      const stat = await fs.lstat(absolutePath).catch((error: unknown) => {
        if (isNodeError(error) && error.code === "ENOENT") return null
        throw error
      })
      if (!stat) return { removed: false }
      if (stat.isSymbolicLink()) throw new Error(`Project private path is a symbolic link: ${relativePath}`)
      await fs.rm(absolutePath, { force: true, recursive: true })
      return { removed: true }
    })
  }

  async listProjects() {
    const projects = await this.readStableRegistry()
    return Promise.all(
      projects.map(async (project) => {
        const safe = await isSafeProjectRoot(project.rootPath)
        return { ...toProjectRecord(project), missing: !safe }
      }),
    ).then((records) => records.sort(compareProjects))
  }

  async addProject(rootPath: string) {
    const realRoot = await fs.realpath(path.resolve(rootPath))
    const stat = await fs.stat(realRoot)
    if (!stat.isDirectory()) throw new Error(`Project root is not a directory: ${rootPath}`)
    const registeredProjects = await this.readStableRegistry()
    const existingByRoot = registeredProjects.find((project) => sameNativePath(project.rootPath, realRoot))
    const manifest = await this.ensureProjectManifest(realRoot, existingByRoot?.id ?? projectIdForPath(realRoot))
    const id = manifest.projectId
    const existingById = registeredProjects.find((project) => project.id === id)
    let rebindFromRoot: string | undefined
    if (existingById && !sameNativePath(existingById.rootPath, realRoot)) {
      if (await isSafeProjectRoot(existingById.rootPath)) {
        throw new Error(`Project id is already bound to another folder: ${existingById.rootPath}`)
      }
      rebindFromRoot = existingById.rootPath
    }
    return this.mutateRegistry((projects) => {
      const conflicting = projects.find((project) => project.id === id && !sameNativePath(project.rootPath, realRoot))
      if (conflicting && (!rebindFromRoot || !sameNativePath(conflicting.rootPath, rebindFromRoot))) {
        throw new Error(`Project id is already bound to another folder: ${conflicting.rootPath}`)
      }
      const existing = projects.find((project) => project.id === id || sameNativePath(project.rootPath, realRoot))
      const timestamp = this.now()
      const project: ProjectRegistryRecord = existing
        ? { ...toProjectRecord(existing), id, lastOpenedAt: timestamp, missing: false, rootPath: realRoot }
        : {
            createdAt: timestamp,
            id,
            lastOpenedAt: timestamp,
            name: path.basename(realRoot) || "Project",
            rootPath: realRoot,
          }
      return {
        projects: [
          ...projects.filter((candidate) => candidate.id !== id && !sameNativePath(candidate.rootPath, realRoot)),
          project,
        ],
        value: toProjectRecord(project),
      }
    })
  }

  createProject(input: { name: string; parentPath: string }) {
    const result = this.projectCreationQueue.then(() => this.createProjectUnlocked(input))
    this.projectCreationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async createProjectUnlocked(input: { name: string; parentPath: string }) {
    const name = validateName(input.name)
    const requestedParent = path.resolve(input.parentPath)
    await fs.mkdir(requestedParent, { recursive: true })
    const parentRoot = await fs.realpath(requestedParent)
    if (!(await fs.stat(parentRoot)).isDirectory()) throw new Error(`Project parent is not a directory: ${input.parentPath}`)
    const rootPath = path.join(parentRoot, name)
    if (await existsPortable(rootPath, true)) throw new Error(`Project already exists: ${name}`)
    try {
      await fs.mkdir(rootPath)
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        throw new Error(`Project already exists: ${name}`, { cause: error })
      }
      throw error
    }
    return this.addProject(rootPath)
  }

  renameProject(projectId: string, name: string) {
    const normalizedName = validateName(name)
    return this.mutateRegistry((projects) => {
      const current = projects.find((project) => project.id === projectId)
      if (!current) throw new Error(`Project was not found: ${projectId}`)
      const project: ProjectRegistryRecord = { ...current, name: normalizedName }
      return {
        projects: projects.map((candidate) => (candidate.id === projectId ? project : candidate)),
        value: toProjectRecord(project),
      }
    })
  }

  async forgetProject(projectId: string) {
    await this.waitForProjectTextWrites(projectId)
    return this.queueProjectMutation(projectId, () =>
      this.mutateRegistry((projects) => ({
        projects: projects.filter((project) => project.id !== projectId),
        value: projects.some((project) => project.id === projectId),
      })),
    )
  }

  async listDirectory(input: { path?: string; projectId: string }): Promise<ProjectDirectoryListing> {
    const relativePath = normalizeRelativePath(input.path)
    assertUserMutationPath(relativePath)
    const { absolutePath } = await this.resolveExisting(input.projectId, relativePath)
    const stat = await fs.stat(absolutePath)
    if (!stat.isDirectory()) throw new Error(`Project path is not a directory: ${relativePath}`)
    const dirents = await fs.readdir(absolutePath, { withFileTypes: true })
    const entries = await Promise.all(
      dirents
        .filter(
          (dirent) =>
            !dirent.isSymbolicLink() && !isIgnoredName(dirent.name) && (dirent.isDirectory() || dirent.isFile()),
        )
        .map(async (dirent): Promise<ProjectEntry> => {
          const entryPath = joinRelative(relativePath, dirent.name)
          const entryStat = await fs.stat(path.join(absolutePath, dirent.name))
          return {
            kind: dirent.isDirectory() ? "directory" : "file",
            modifiedAt: entryStat.mtimeMs,
            name: dirent.name,
            parentPath: relativePath,
            path: entryPath,
            size: dirent.isFile() ? entryStat.size : undefined,
          }
        }),
    )
    entries.sort(compareEntries)
    return { entries, path: relativePath, projectId: input.projectId }
  }

  createEntry(input: {
    content?: string
    kind: "directory" | "file"
    name: string
    parentPath?: string
    projectId: string
  }) {
    return this.queueProjectMutation(input.projectId, () => this.createEntryUnlocked(input))
  }

  private async createEntryUnlocked(input: {
    content?: string
    kind: "directory" | "file"
    name: string
    parentPath?: string
    projectId: string
  }): Promise<ProjectMutationResult> {
    const parentPath = normalizeRelativePath(input.parentPath)
    const name = validateName(input.name)
    assertUserMutationPath(parentPath)
    const { absolutePath: parent } = await this.resolveExisting(input.projectId, parentPath)
    if (!(await fs.stat(parent)).isDirectory()) throw new Error(`Project path is not a directory: ${parentPath}`)
    const targetPath = joinRelative(parentPath, name)
    assertUserMutationPath(targetPath)
    const target = path.join(parent, name)
    if (await existsPortable(target, this.caseInsensitivePaths))
      throw new Error(`Project entry already exists: ${targetPath}`)
    if (input.kind === "directory") await fs.mkdir(target)
    else await fs.writeFile(target, input.content ?? "", { encoding: "utf8", flag: "wx" })
    return mutation("create", input.projectId, [targetPath], undefined, [targetPath])
  }

  renameEntry(input: { name: string; path: string; projectId: string }) {
    return this.queueProjectMutation(input.projectId, () => this.renameEntryUnlocked(input))
  }

  private async renameEntryUnlocked(input: {
    name: string
    path: string
    projectId: string
  }): Promise<ProjectMutationResult> {
    const sourcePath = requireEntryPath(input.path)
    assertUserMutationPath(sourcePath)
    const name = validateName(input.name)
    const { absolutePath: source, rootPath } = await this.resolveExisting(input.projectId, sourcePath)
    assertNotProjectRoot(source, rootPath)
    const targetPath = joinRelative(parentOf(sourcePath), name)
    assertUserMutationPath(targetPath)
    const { absolutePath: target } = await this.resolveOutput(input.projectId, targetPath)
    if (sourcePath === targetPath) return mutation("rename", input.projectId, [sourcePath], [sourcePath], [targetPath])
    const caseOnlyRename = sourcePath.toLowerCase() === targetPath.toLowerCase()
    const targetStat = await fs.lstat(target).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") return null
      throw error
    })
    if (caseOnlyRename && (!targetStat || sameNativePath(await fs.realpath(source), await fs.realpath(target)))) {
      const temporary = path.join(path.dirname(source), `.${path.basename(source)}.${randomUUID()}.rename`)
      await fs.rename(source, temporary)
      try {
        await fs.rename(temporary, target)
      } catch (error) {
        await fs.rename(temporary, source)
        throw error
      }
      return mutation("rename", input.projectId, [sourcePath, targetPath], [sourcePath], [targetPath])
    }
    if (targetStat || (await existsPortable(target, this.caseInsensitivePaths))) {
      throw new Error(`Project entry already exists: ${targetPath}`)
    }
    await fs.rename(source, target)
    return mutation("rename", input.projectId, [sourcePath, targetPath], [sourcePath], [targetPath])
  }

  moveEntries(input: { destinationPath?: string; paths: string[]; projectId: string }) {
    return this.queueProjectMutation(input.projectId, () => this.moveEntriesUnlocked(input))
  }

  private async moveEntriesUnlocked(input: {
    destinationPath?: string
    paths: string[]
    projectId: string
  }): Promise<ProjectMutationResult> {
    const destinationPath = normalizeRelativePath(input.destinationPath)
    assertUserMutationPath(destinationPath)
    const { absolutePath: destination } = await this.resolveExisting(input.projectId, destinationPath)
    if (!(await fs.stat(destination)).isDirectory())
      throw new Error(`Move destination is not a directory: ${destinationPath}`)
    const sourcePaths = normalizeSelectionRoots(input.paths.map(requireEntryPath))
    const moves: Array<{ source: string; sourcePath: string; target: string; targetPath: string }> = []
    const plannedTargets = new Set<string>()
    for (const sourcePath of sourcePaths) {
      assertUserMutationPath(sourcePath)
      const { absolutePath: source, rootPath } = await this.resolveExisting(input.projectId, sourcePath)
      assertNotProjectRoot(source, rootPath)
      const sourceStat = await fs.stat(source)
      validateName(path.posix.basename(sourcePath))
      await assertPortableTree(source)
      if (
        sourceStat.isDirectory() &&
        (destinationPath === sourcePath || destinationPath.startsWith(`${sourcePath}/`))
      ) {
        throw new Error(`Cannot move a directory into itself: ${sourcePath}`)
      }
      const targetPath = joinRelative(destinationPath, path.posix.basename(sourcePath))
      if (targetPath === sourcePath) continue
      const { absolutePath: target } = await this.resolveOutput(input.projectId, targetPath)
      const targetKey = collisionKey(targetPath, this.caseInsensitivePaths)
      if ((await existsPortable(target, this.caseInsensitivePaths)) || plannedTargets.has(targetKey)) {
        throw new Error(`Project entry already exists: ${targetPath}`)
      }
      plannedTargets.add(targetKey)
      moves.push({ source, sourcePath, target, targetPath })
    }
    for (const move of moves) await movePath(move.source, move.target)
    const targetPaths = moves.map((move) => move.targetPath)
    return mutation("move", input.projectId, [...sourcePaths, ...targetPaths], sourcePaths, targetPaths)
  }

  copyEntries(input: { destinationPath?: string; paths: string[]; projectId: string }) {
    return this.queueProjectMutation(input.projectId, () => this.copyEntriesUnlocked(input))
  }

  private async copyEntriesUnlocked(input: {
    destinationPath?: string
    paths: string[]
    projectId: string
  }): Promise<ProjectMutationResult> {
    const destinationPath = normalizeRelativePath(input.destinationPath)
    assertUserMutationPath(destinationPath)
    const { absolutePath: destination } = await this.resolveExisting(input.projectId, destinationPath)
    if (!(await fs.stat(destination)).isDirectory())
      throw new Error(`Copy destination is not a directory: ${destinationPath}`)
    const sourcePaths = normalizeSelectionRoots(input.paths.map(requireEntryPath))
    const copies: Array<{ source: string; target: string; targetPath: string }> = []
    const reservedTargets = new Set<string>()
    for (const sourcePath of sourcePaths) {
      assertUserMutationPath(sourcePath)
      const { absolutePath: source } = await this.resolveExisting(input.projectId, sourcePath)
      const sourceStat = await fs.stat(source)
      if (sourceStat.isDirectory() && isInsidePath(destination, source)) {
        throw new Error(`Cannot copy a directory into itself: ${sourcePath}`)
      }
      const sourceName = validateName(path.posix.basename(sourcePath))
      await assertPortableTree(source)
      assertUserMutationPath(joinRelative(destinationPath, sourceName))
      const target = await nextAvailablePath(destination, sourceName, reservedTargets, this.caseInsensitivePaths)
      assertUserMutationPath(joinRelative(destinationPath, path.basename(target)))
      reservedTargets.add(collisionKey(target, this.caseInsensitivePaths))
      copies.push({ source, target, targetPath: joinRelative(destinationPath, path.basename(target)) })
    }
    for (const item of copies) await copyPath(item.source, item.target)
    const targetPaths = copies.map((item) => item.targetPath)
    return mutation("copy", input.projectId, targetPaths, sourcePaths, targetPaths)
  }

  deleteEntries(input: { paths: string[]; projectId: string }) {
    return this.queueProjectMutation(input.projectId, () => this.deleteEntriesUnlocked(input))
  }

  private async deleteEntriesUnlocked(input: { paths: string[]; projectId: string }): Promise<ProjectMutationResult> {
    const sourcePaths = normalizeSelectionRoots(input.paths.map(requireEntryPath))
    sourcePaths.forEach(assertUserMutationPath)
    const resolved = await Promise.all(
      sourcePaths.map((relativePath) => this.resolveExisting(input.projectId, relativePath)),
    )
    for (const item of resolved) {
      assertNotProjectRoot(item.absolutePath, item.rootPath)
      if (this.options.trash) await this.options.trash(item.absolutePath)
      else await fs.rm(item.absolutePath, { recursive: true })
    }
    return mutation("delete", input.projectId, sourcePaths, sourcePaths)
  }

  importEntries(input: { destinationPath?: string; projectId: string; sourcePaths: string[] }) {
    return this.queueProjectMutation(input.projectId, () => this.importEntriesUnlocked(input))
  }

  private async importEntriesUnlocked(input: {
    destinationPath?: string
    projectId: string
    sourcePaths: string[]
  }): Promise<ProjectMutationResult> {
    const destinationPath = normalizeRelativePath(input.destinationPath)
    assertUserMutationPath(destinationPath)
    const { absolutePath: destination } = await this.resolveExisting(input.projectId, destinationPath)
    if (!(await fs.stat(destination)).isDirectory())
      throw new Error(`Import destination is not a directory: ${destinationPath}`)
    const sourcePaths = [
      ...new Set(
        input.sourcePaths.map((sourcePath) => {
          if (!sourcePath.trim()) throw new Error("Import source path is empty")
          return path.resolve(sourcePath)
        }),
      ),
    ]
    const imports: Array<{ source: string; target: string; targetPath: string }> = []
    const reservedTargets = new Set<string>()
    for (const sourcePath of sourcePaths) {
      const sourceStat = await fs.lstat(sourcePath)
      if (sourceStat.isSymbolicLink() || (!sourceStat.isDirectory() && !sourceStat.isFile())) {
        throw new Error(`Import source is not supported: ${sourcePath}`)
      }
      const realSource = await fs.realpath(sourcePath)
      if (sourceStat.isDirectory() && isInsidePath(destination, realSource)) {
        throw new Error(`Cannot import a directory into itself: ${sourcePath}`)
      }
      const sourceName = validateName(path.basename(sourcePath))
      await assertPortableTree(sourcePath)
      assertUserMutationPath(joinRelative(destinationPath, sourceName))
      const target = await nextAvailablePath(destination, sourceName, reservedTargets, this.caseInsensitivePaths)
      assertUserMutationPath(joinRelative(destinationPath, path.basename(target)))
      reservedTargets.add(collisionKey(target, this.caseInsensitivePaths))
      imports.push({ source: sourcePath, target, targetPath: joinRelative(destinationPath, path.basename(target)) })
    }
    // Never remove a published import target after an external failure. Node's
    // portable filesystem API cannot atomically prove pathname identity and
    // unlink it, so rollback could delete a concurrent writer's replacement.
    // A failed directory import may conservatively leave a partial target; a
    // later explicit user action can inspect and remove it safely.
    for (const item of imports) await copyPath(item.source, item.target)
    const targetPaths = imports.map((item) => item.targetPath)
    return mutation("import", input.projectId, targetPaths, sourcePaths, targetPaths)
  }

  async readTextPreview(input: { path: string; projectId: string }): Promise<ProjectTextPreviewContents> {
    const relativePath = requireEntryPath(input.path)
    assertUserMutationPath(relativePath)
    await this.waitForTextWrite(textFileKey(input.projectId, relativePath))
    const { absolutePath } = await this.resolveExisting(input.projectId, relativePath)
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile()) throw new Error(`Project path is not a file: ${relativePath}`)
    const length = Math.min(stat.size, textPreviewBytes)
    const buffer = Buffer.allocUnsafe(length)
    const handle = await fs.open(absolutePath, "r")
    try {
      const { bytesRead } = await handle.read(buffer, 0, length, 0)
      return {
        content: buffer.subarray(0, bytesRead).toString("utf8"),
        path: relativePath,
        truncated: stat.size > bytesRead,
      }
    } finally {
      await handle.close()
    }
  }

  async readFile(input: { path: string; projectId: string }): Promise<ProjectFileContents> {
    const relativePath = requireEntryPath(input.path)
    assertUserMutationPath(relativePath)
    const { absolutePath } = await this.resolveExisting(input.projectId, relativePath)
    const maxBytes = this.options.maxReadableFileBytes ?? 64 * 1024 * 1024
    const content = await readStableFile(absolutePath, relativePath, maxBytes)
    const mimeType = mimeTypeForPath(relativePath)
    return {
      dataUrl: `data:${mimeType};base64,${content.toString("base64")}`,
      mimeType,
      name: path.basename(absolutePath),
      path: relativePath,
      size: content.byteLength,
    }
  }

  async readFileInfo(input: { path: string; projectId: string }): Promise<ProjectFileInfo> {
    const relativePath = requireEntryPath(input.path)
    assertUserMutationPath(relativePath)
    const { absolutePath } = await this.resolveExisting(input.projectId, relativePath)
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile()) throw new Error(`Project path is not a file: ${relativePath}`)
    const mimeType = mimeTypeForPath(relativePath)
    return {
      mimeType,
      name: path.basename(absolutePath),
      path: relativePath,
      size: stat.size,
    }
  }

  async readTextFile(input: { path: string; projectId: string }): Promise<ProjectTextFileContents> {
    const relativePath = requireEntryPath(input.path)
    assertUserMutationPath(relativePath)
    await this.waitForTextWrite(textFileKey(input.projectId, relativePath))
    const output = await this.resolveOutput(input.projectId, relativePath)
    try {
      const existing = await this.resolveExisting(input.projectId, relativePath)
      const bytes = await readStableFile(
        existing.absolutePath,
        relativePath,
        this.options.maxTextFileBytes ?? 16 * 1024 * 1024,
      )
      let content: string
      try {
        content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
      } catch (error) {
        throw new Error(`Project text file is not valid UTF-8: ${relativePath}`, { cause: error })
      }
      return {
        content,
        contentRevision: createHash("sha256").update(bytes).digest("hex"),
        exists: true,
        path: relativePath,
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { content: "", contentRevision: "", exists: false, path: relativePath }
      }
      if (!(await exists(output.absolutePath))) {
        return { content: "", contentRevision: "", exists: false, path: relativePath }
      }
      throw error
    }
  }

  async writeTextFile(input: {
    content: string
    createParents?: boolean
    path: string
    projectId: string
  }): Promise<ProjectMutationResult> {
    const relativePath = requireEntryPath(input.path)
    assertUserMutationPath(relativePath)
    await this.queueTextWrite(textFileKey(input.projectId, relativePath), async () => {
      if (Buffer.byteLength(input.content, "utf8") > (this.options.maxTextFileBytes ?? 16 * 1024 * 1024)) {
        throw new Error(`Project text file is too large to write: ${relativePath}`)
      }
      await this.queueProjectMutation(input.projectId, async () => {
        const { absolutePath } = await this.resolveOutput(input.projectId, relativePath)
        const parent = path.dirname(absolutePath)
        if (input.createParents) await fs.mkdir(parent, { recursive: true })
        else if (!(await isDirectory(parent)))
          throw new Error(`Project parent directory was not found: ${parentOf(relativePath)}`)
        await writeFileReplacing(absolutePath, input.content)
      })
    })
    return mutation("write", input.projectId, [relativePath], undefined, [relativePath])
  }

  async resolveEntryPath(input: { path?: string; projectId: string }) {
    const relativePath = normalizeRelativePath(input.path)
    assertUserMutationPath(relativePath)
    return (await this.resolveExisting(input.projectId, relativePath)).absolutePath
  }

  async resolveProjectRoot(input: { projectId: string }) {
    return fs.realpath((await this.getProject(input.projectId)).rootPath)
  }

  async resolvePrivatePath(input: ProjectPrivatePathRef) {
    const relativePath = privatePathRelativePath(input.path)
    const rootPath = await fs.realpath((await this.getProject(input.projectId)).rootPath)
    const privateRoot = path.join(rootPath, ".convax")
    const absolutePath = path.resolve(rootPath, ...relativePath.split("/"))
    ensureInside(absolutePath, privateRoot, relativePath)
    await assertNoSymlinkSegments(rootPath, relativePath)
    return absolutePath
  }

  async watchProject(projectId: string, listener: (event: ProjectChangeEvent) => void) {
    const project = await this.getProject(projectId)
    const rootPath = await fs.realpath(project.rootPath)
    let timer: ReturnType<typeof setTimeout> | undefined
    let restartTimer: ReturnType<typeof setTimeout> | undefined
    let latestPath: string | undefined
    let restartAttempts = 0
    let stopped = false
    let watcher: FSWatcher | undefined
    const notify = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        listener({ kind: "filesystem", path: latestPath, projectId })
      }, this.options.watchDebounceMs ?? 120)
    }
    const onChange = (_eventType: string, filename: string | Buffer | null) => {
      restartAttempts = 0
      const relativePath = filename ? String(filename).replaceAll("\\", "/").replace(/^\/+/, "") : undefined
      if (relativePath && isIgnoredName(relativePath.split("/")[0] ?? "")) return
      latestPath = relativePath
      notify()
    }
    const scheduleRestart = () => {
      if (stopped || restartTimer || restartAttempts >= 5) return
      const delay = Math.min(2_000, 100 * 2 ** restartAttempts)
      restartAttempts += 1
      restartTimer = setTimeout(() => {
        restartTimer = undefined
        startWatcher()
      }, delay)
    }
    const startWatcher = () => {
      if (stopped) return
      try {
        try {
          watcher = watchFileSystem(rootPath, { persistent: false, recursive: true }, onChange)
        } catch {
          watcher = watchFileSystem(rootPath, { persistent: false }, onChange)
        }
        watcher.once("error", () => {
          watcher?.close()
          watcher = undefined
          latestPath = undefined
          notify()
          scheduleRestart()
        })
      } catch {
        watcher = undefined
        latestPath = undefined
        notify()
        scheduleRestart()
      }
    }
    startWatcher()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      if (restartTimer) clearTimeout(restartTimer)
      watcher?.close()
    }
  }

  private async getProject(projectId: string) {
    const project = (await this.readStableRegistry()).find((candidate) => candidate.id === projectId)
    if (!project) throw new Error(`Project was not found: ${projectId}`)
    if (!(await isSafeProjectRoot(project.rootPath)))
      throw new Error(`Project folder is unavailable: ${project.rootPath}`)
    return project
  }

  private get caseInsensitivePaths() {
    return this.options.caseInsensitivePaths ?? true
  }

  private async ensureProjectManifest(rootPath: string, preferredProjectId: string): Promise<ProjectManifest> {
    const privateRoot = path.join(rootPath, ".convax")
    const manifestFile = path.join(rootPath, ...projectManifestPath.split("/"))
    await ensureSafeDirectory(privateRoot, "Project private storage")
    await assertNoSymlinkSegments(rootPath, projectManifestPath)
    let manifest: ProjectManifest
    let manifestChanged = false
    try {
      manifest = parseProjectManifest(JSON.parse(await fs.readFile(manifestFile, "utf8")))
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error
      manifest = {
        projectId: requireProjectId(preferredProjectId),
        schemaVersion: "convax.project/1",
      }
      manifestChanged = true
    }
    if (manifest.projectId !== preferredProjectId && (await this.registryContainsProject(preferredProjectId))) {
      throw new Error(`Project manifest belongs to a different project: ${manifest.projectId}`)
    }

    await ensureSafeDirectory(path.join(privateRoot, "assets"), "Project asset storage")
    if (manifestChanged) await this.writeProjectManifest(rootPath, manifest)
    return manifest
  }

  private async writeProjectManifest(rootPath: string, manifest: ProjectManifest) {
    const target = path.join(rootPath, ...projectManifestPath.split("/"))
    await ensureSafeDirectory(path.dirname(target), "Project private storage")
    await assertNoSymlinkSegments(rootPath, projectManifestPath)
    await writeFileReplacing(target, `${JSON.stringify(manifest, null, 2)}\n`)
  }

  private async registryContainsProject(projectId: string) {
    return (await this.readStableRegistry()).some((project) => project.id === projectId)
  }

  private async resolveExisting(projectId: string, relativePath: string) {
    const project = await this.getProject(projectId)
    const rootPath = await fs.realpath(project.rootPath)
    const candidate = path.resolve(rootPath, ...relativePath.split("/").filter(Boolean))
    ensureInside(candidate, rootPath, relativePath)
    await assertNoSymlinkSegments(rootPath, relativePath)
    if ((await fs.lstat(candidate)).isSymbolicLink()) {
      throw new Error(`Symbolic links are not supported project entries: ${relativePath}`)
    }
    const absolutePath = await fs.realpath(candidate)
    ensureInside(absolutePath, rootPath, relativePath)
    return { absolutePath, rootPath }
  }

  private async resolveOutput(projectId: string, relativePath: string) {
    const project = await this.getProject(projectId)
    const rootPath = await fs.realpath(project.rootPath)
    const absolutePath = path.resolve(rootPath, ...relativePath.split("/").filter(Boolean))
    ensureInside(absolutePath, rootPath, relativePath)
    await assertNoSymlinkSegments(rootPath, relativePath)
    let ancestor = path.dirname(absolutePath)
    while (!(await exists(ancestor))) {
      const parent = path.dirname(ancestor)
      if (parent === ancestor) break
      ancestor = parent
    }
    const realAncestor = await fs.realpath(ancestor)
    ensureInside(realAncestor, rootPath, relativePath)
    const targetStat = await fs.lstat(absolutePath).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") return null
      throw error
    })
    if (targetStat?.isSymbolicLink()) {
      throw new Error(`Symbolic links are not supported project entries: ${relativePath}`)
    }
    if (targetStat) ensureInside(await fs.realpath(absolutePath), rootPath, relativePath)
    return { absolutePath, rootPath }
  }

  private async readStableRegistry() {
    await this.registryQueue
    return this.readRegistry()
  }

  private async queueTextWrite(key: string, write: () => Promise<void>) {
    const previous = this.textWriteQueues.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(write)
    this.textWriteQueues.set(key, current)
    try {
      await current
    } finally {
      if (this.textWriteQueues.get(key) === current) this.textWriteQueues.delete(key)
    }
  }

  private async queueProjectMutation<T>(projectId: string, mutate: () => Promise<T>) {
    const previous = this.projectMutationQueues.get(projectId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(mutate)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    this.projectMutationQueues.set(projectId, settled)
    try {
      return await result
    } finally {
      if (this.projectMutationQueues.get(projectId) === settled) this.projectMutationQueues.delete(projectId)
    }
  }

  private async waitForTextWrite(key: string) {
    await this.textWriteQueues.get(key)
  }

  private async waitForProjectTextWrites(projectId: string) {
    const prefix = `${projectId}:`
    while (true) {
      const writes = [...this.textWriteQueues].filter(([key]) => key.startsWith(prefix)).map(([, write]) => write)
      if (writes.length === 0) return
      await Promise.all(writes)
    }
  }

  private mutateRegistry<T>(
    mutate: (projects: ProjectRegistryRecord[]) => { projects: ProjectRegistryRecord[]; value: T },
  ) {
    const result = this.registryQueue.then(async () => {
      const current = await this.readRegistry()
      const next = mutate(current)
      await this.writeRegistry(next.projects)
      return next.value
    })
    this.registryQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async readRegistry(): Promise<ProjectRegistryRecord[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.options.registryFile, "utf8")) as Partial<ProjectRegistryFile>
      if (parsed.version !== 1 || !Array.isArray(parsed.projects)) return []
      return parsed.projects.filter(isProjectRecord).map(toProjectRecord)
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return []
      throw error
    }
  }

  private async writeRegistry(projects: ProjectRegistryRecord[]) {
    await fs.mkdir(path.dirname(this.options.registryFile), { recursive: true })
    await writeFileReplacing(
      this.options.registryFile,
      `${JSON.stringify({ projects, version: 1 } satisfies ProjectRegistryFile, null, 2)}\n`,
    )
  }
}

async function ensureSafeDirectory(directory: string, description: string) {
  try {
    await fs.mkdir(directory)
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error
  }
  const stat = await fs.lstat(directory)
  if (stat.isSymbolicLink()) throw new Error(`${description} cannot be a symbolic link: ${directory}`)
  if (!stat.isDirectory()) throw new Error(`${description} is not a directory: ${directory}`)
}

async function readStableFile(absolutePath: string, relativePath: string, maximumBytes: number) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("Project file byte limit must be a positive integer")
  }
  const pathBeforeOpen = await fs.lstat(absolutePath, { bigint: true })
  if (!pathBeforeOpen.isFile() || pathBeforeOpen.isSymbolicLink()) {
    throw new Error(`Project path is not a regular file: ${relativePath}`)
  }
  const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW
  const handle = await fs.open(absolutePath, fsConstants.O_RDONLY | noFollow)
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || !sameFileIdentity(pathBeforeOpen, before)) {
      throw new Error(`Project file changed before it could be read: ${relativePath}`)
    }
    if (before.size > BigInt(maximumBytes)) {
      throw new Error(`Project file is too large to read: ${relativePath}`)
    }
    const size = Number(before.size)
    const content = Buffer.allocUnsafe(size)
    let offset = 0
    while (offset < size) {
      const { bytesRead } = await handle.read(content, offset, size - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    const extra = Buffer.allocUnsafe(1)
    const { bytesRead: extraBytes } = await handle.read(extra, 0, 1, size)
    const after = await handle.stat({ bigint: true })
    const pathAfterRead = await fs.lstat(absolutePath, { bigint: true })
    const resolvedAfterRead = await fs.realpath(absolutePath)
    if (
      offset !== size ||
      extraBytes !== 0 ||
      !sameFileSnapshot(before, after) ||
      !sameFileIdentity(after, pathAfterRead) ||
      !sameNativePath(resolvedAfterRead, absolutePath)
    ) {
      throw new Error(`Project file changed while it was being read: ${relativePath}`)
    }
    return content
  } finally {
    await handle.close()
  }
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev && left.ino === right.ino
}

function sameFileSnapshot(left: BigIntStats, right: BigIntStats) {
  return (
    sameFileIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}
