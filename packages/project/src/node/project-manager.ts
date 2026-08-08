import { createHash, randomUUID } from "node:crypto"
import { watch as watchFileSystem, type FSWatcher } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import type {
  ProjectChangeEvent,
  ProjectDirectoryListing,
  ProjectEntry,
  ProjectFileContents,
  ProjectFileInfo,
  ProjectMutationResult,
  ProjectRecoveryStatus,
  ProjectTextFileContents,
  ProjectTextPreviewContents,
} from "../contracts"
import {
  ProjectTextFileConflictError,
  type ProjectTextFileCompareAndReplaceInput,
  type ProjectTextFileCompareAndReplacePort,
  type ProjectTextFileCompareAndReplaceResult,
} from "@convax/project-files"
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
import {
  readStableProjectFile,
  readStableProjectUtf8File,
  sameProjectFileSnapshot,
} from "./stable-project-file"
import { resolvePortableProjectData, PortableProjectResetError } from "./collaboration/portable-cutover"

export interface NodeProjectManagerOptions {
  caseInsensitivePaths?: boolean
  maxReadableFileBytes?: number
  maxTextFileBytes?: number
  now?: () => number
  registryFile: string
  trash?: (targetPath: string) => Promise<void>
  watchDebounceMs?: number
}

export interface RegisteredProjectPrivateStorageRecoveryPort {
  ensureRegisteredProjectPrivateStorage(input: {
    projectId: string
    projectRoot: string
  }): Promise<void>
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

export class NodeProjectManager
  implements
    ProjectPrivatePathResolver,
    ProjectPrivateStorage,
    ProjectTextFileCompareAndReplacePort,
    RegisteredProjectPrivateStorageRecoveryPort
{
  private readonly now: () => number
  private projectCreationQueue: Promise<void> = Promise.resolve()
  private readonly projectPrivateStorageQueues = new Map<string, Promise<void>>()
  private registryQueue: Promise<unknown> = Promise.resolve()
  private readonly projectMutationQueues = new Map<string, Promise<void>>()
  private readonly textWriteQueues = new Map<string, Promise<void>>()

  constructor(private readonly options: NodeProjectManagerOptions) {
    this.now = options.now ?? Date.now
  }

  protected async beforeCompareAndReplaceCommit(_input: { targetPath: string; temporaryPath: string }) {}

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

  touch(projectId: string) {
    return this.touchProject(projectId)
  }

  async flushPendingWrites() {
    const failures: unknown[] = []
    while (true) {
      const projectCreation = this.projectCreationQueue
      const registry = this.registryQueue
      const results = await Promise.allSettled([
        projectCreation,
        ...this.projectPrivateStorageQueues.values(),
        ...this.textWriteQueues.values(),
        ...this.projectMutationQueues.values(),
      ])
      failures.push(...results.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])))
      await registry
      if (
        this.textWriteQueues.size === 0 &&
        this.projectPrivateStorageQueues.size === 0 &&
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
        return {
          ...toProjectRecord(project),
          missing: !safe,
          ...(safe ? await projectRecoveryProjection(project.rootPath) : {}),
        }
      }),
    ).then((records) => records.sort(compareProjects))
  }

  touchProject(projectId: string) {
    return this.mutateRegistry(async (projects) => {
      const current = projects.find((project) => project.id === projectId)
      if (!current) throw new Error(`Project was not found: ${projectId}`)
      if (!(await isSafeProjectRoot(current.rootPath))) {
        throw new Error(`Project folder is unavailable: ${current.rootPath}`)
      }
      await this.queueProjectPrivateStorage(current.id, async () => {
        await assertPortableProjectOpenable(current.rootPath)
        await this.ensureProjectManifest(current.rootPath, current.id, projects)
      })
      const latestTimestamp = projects.reduce(
        (latest, project) => Math.max(latest, project.lastOpenedAt),
        0,
      )
      const { missing: _derivedMissing, ...persistedCurrent } = current
      const project: ProjectRegistryRecord = {
        ...persistedCurrent,
        lastOpenedAt: Math.max(this.now(), latestTimestamp + 1),
      }
      return {
        projects: projects.map((candidate) => (candidate.id === projectId ? project : candidate)),
        value: toProjectRecord(project),
      }
    })
  }

  async ensureRegisteredProjectPrivateStorage(input: {
    projectId: string
    projectRoot: string
  }): Promise<void> {
    const project = await this.getProject(input.projectId)
    const realRoot = await fs.realpath(path.resolve(input.projectRoot))
    if (!sameNativePath(project.rootPath, realRoot)) {
      throw new Error(`Project root differs from its durable registry binding: ${input.projectId}`)
    }
    return this.queueProjectPrivateStorage(input.projectId, async () => {
      await assertPortableProjectOpenable(realRoot)
      await this.ensureProjectManifest(realRoot, project.id, [project])
    })
  }

  async addProject(rootPath: string) {
    const realRoot = await fs.realpath(path.resolve(rootPath))
    const stat = await fs.stat(realRoot)
    if (!stat.isDirectory()) throw new Error(`Project root is not a directory: ${rootPath}`)
    const registeredProjects = await this.readStableRegistry()
    const existingByRoot = registeredProjects.find((project) => sameNativePath(project.rootPath, realRoot))
    const recovery = await projectRecoveryProjection(realRoot)
    const preferredProjectId = existingByRoot?.id ?? projectIdForPath(realRoot)
    const manifest = await this.queueProjectPrivateStorage(preferredProjectId, () =>
      this.ensureProjectManifest(realRoot, preferredProjectId, registeredProjects),
    )
    const id = manifest.projectId
    const existingById = registeredProjects.find((project) => project.id === id)
    let rebindFromRoot: string | undefined
    if (existingById && !sameNativePath(existingById.rootPath, realRoot)) {
      if (await isSafeProjectRoot(existingById.rootPath)) {
        throw new Error(`Project id is already bound to another folder: ${existingById.rootPath}`)
      }
      rebindFromRoot = existingById.rootPath
    }
    const registered = await this.mutateRegistry((projects) => {
      const conflicting = projects.find((project) => project.id === id && !sameNativePath(project.rootPath, realRoot))
      if (conflicting && (!rebindFromRoot || !sameNativePath(conflicting.rootPath, rebindFromRoot))) {
        throw new Error(`Project id is already bound to another folder: ${conflicting.rootPath}`)
      }
      const existing = projects.find((project) => project.id === id || sameNativePath(project.rootPath, realRoot))
      const timestamp = this.now()
      // Native selection registers the binding before the renderer's leave guard
      // runs. Keep a new binding behind every selected Project until activate()
      // records the successful choice through touchProject().
      const oldestOpenedAt = projects.reduce(
        (oldest, candidate) => Math.min(oldest, candidate.lastOpenedAt),
        Number.POSITIVE_INFINITY,
      )
      const unopenedTimestamp =
        projects.length === 0
          ? 0
          : oldestOpenedAt - 1
      const project: ProjectRegistryRecord = existing
        ? {
            createdAt: existing.createdAt,
            id,
            lastOpenedAt: existing.lastOpenedAt,
            name: existing.name,
            rootPath: realRoot,
          }
        : {
            createdAt: timestamp,
            id,
            lastOpenedAt: unopenedTimestamp,
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
    return { ...registered, ...recovery }
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
    if (sourcePath === targetPath) return {
      ...mutation("rename", input.projectId, [sourcePath], [sourcePath], [targetPath]),
      relocations: [{ sourcePath, targetPath }],
    }
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
      return {
        ...mutation("rename", input.projectId, [sourcePath, targetPath], [sourcePath], [targetPath]),
        relocations: [{ sourcePath, targetPath }],
      }
    }
    if (targetStat || (await existsPortable(target, this.caseInsensitivePaths))) {
      throw new Error(`Project entry already exists: ${targetPath}`)
    }
    await fs.rename(source, target)
    return {
      ...mutation("rename", input.projectId, [sourcePath, targetPath], [sourcePath], [targetPath]),
      relocations: [{ sourcePath, targetPath }],
    }
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
    return {
      ...mutation("move", input.projectId, [...sourcePaths, ...targetPaths], sourcePaths, targetPaths),
      relocations: moves.map(({ sourcePath, targetPath }) => Object.freeze({ sourcePath, targetPath })),
    }
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
    const { bytes: content } = await readStableProjectFile(absolutePath, relativePath, maxBytes)
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
      const { content, contentRevision } = await readStableProjectUtf8File(
        existing.absolutePath,
        relativePath,
        this.options.maxTextFileBytes ?? 16 * 1024 * 1024,
      )
      return {
        content,
        contentRevision,
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

  async compareAndReplaceTextFile(
    input: ProjectTextFileCompareAndReplaceInput,
  ): Promise<ProjectTextFileCompareAndReplaceResult> {
    const relativePath = requireEntryPath(input.path)
    assertUserMutationPath(relativePath)
    if (!/^[a-f0-9]{64}$/.test(input.expectedRevision)) {
      throw new Error("Expected Project text revision is invalid")
    }
    if (typeof input.content !== "string") throw new Error("Project text content must be a string")
    if (Buffer.byteLength(input.content, "utf8") > (this.options.maxTextFileBytes ?? 16 * 1024 * 1024)) {
      throw new Error(`Project text file is too large to write: ${relativePath}`)
    }

    let contentRevision = ""
    await this.queueTextWrite(textFileKey(input.projectId, relativePath), async () => {
      await this.queueProjectMutation(input.projectId, async () => {
        let existing: Awaited<ReturnType<NodeProjectManager["resolveExisting"]>>
        try {
          existing = await this.resolveExisting(input.projectId, relativePath)
        } catch (error) {
          if (isNodeError(error) && error.code === "ENOENT") {
            throw new ProjectTextFileConflictError(input.expectedRevision, null)
          }
          throw error
        }

        const current = await readStableProjectUtf8File(
          existing.absolutePath,
          relativePath,
          this.options.maxTextFileBytes ?? 16 * 1024 * 1024,
        )
        if (current.contentRevision !== input.expectedRevision) {
          throw new ProjectTextFileConflictError(input.expectedRevision, current.contentRevision)
        }

        await writeFileReplacing(existing.absolutePath, input.content, async (staged) => {
          await this.beforeCompareAndReplaceCommit(staged)

          let resolvedBeforeReplace: string
          let targetBeforeReplace: Awaited<ReturnType<typeof fs.lstat>>
          try {
            resolvedBeforeReplace = await fs.realpath(existing.absolutePath)
            targetBeforeReplace = await fs.lstat(existing.absolutePath, { bigint: true })
          } catch (error) {
            if (isNodeError(error) && error.code === "ENOENT") {
              throw new ProjectTextFileConflictError(input.expectedRevision, null)
            }
            throw error
          }
          if (
            targetBeforeReplace.isSymbolicLink() ||
            !targetBeforeReplace.isFile() ||
            !sameNativePath(resolvedBeforeReplace, existing.absolutePath)
          ) {
            throw new Error(`Project text file changed before it could be replaced: ${relativePath}`)
          }
          if (!sameProjectFileSnapshot(current.snapshot, targetBeforeReplace)) {
            try {
              const replacement = await readStableProjectFile(
                existing.absolutePath,
                relativePath,
                this.options.maxTextFileBytes ?? 16 * 1024 * 1024,
              )
              throw new ProjectTextFileConflictError(
                input.expectedRevision,
                createHash("sha256").update(replacement.bytes).digest("hex"),
              )
            } catch (error) {
              if (isNodeError(error) && error.code === "ENOENT") {
                throw new ProjectTextFileConflictError(input.expectedRevision, null)
              }
              throw error
            }
          }
        })
        contentRevision = createHash("sha256").update(Buffer.from(input.content, "utf8")).digest("hex")
      })
    })
    return { contentRevision }
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

  private async ensureProjectManifest(
    rootPath: string,
    preferredProjectId: string,
    registeredProjects?: readonly Pick<ProjectRegistryRecord, "id">[],
  ): Promise<ProjectManifest> {
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
    if (manifest.projectId !== preferredProjectId) {
      const preferredProjectIsRegistered = registeredProjects
        ? registeredProjects.some((project) => project.id === preferredProjectId)
        : await this.registryContainsProject(preferredProjectId)
      if (preferredProjectIsRegistered) {
        throw new Error(`Project manifest belongs to a different project: ${manifest.projectId}`)
      }
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

  private async queueProjectPrivateStorage<T>(projectId: string, mutate: () => Promise<T>) {
    const previous = this.projectPrivateStorageQueues.get(projectId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(mutate)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    this.projectPrivateStorageQueues.set(projectId, settled)
    try {
      return await result
    } finally {
      if (this.projectPrivateStorageQueues.get(projectId) === settled) {
        this.projectPrivateStorageQueues.delete(projectId)
      }
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
    mutate: (
      projects: ProjectRegistryRecord[],
    ) =>
      | { projects: ProjectRegistryRecord[]; value: T }
      | Promise<{ projects: ProjectRegistryRecord[]; value: T }>,
  ) {
    const result = this.registryQueue.then(async () => {
      const current = await this.readRegistry()
      const next = await mutate(current)
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

async function assertPortableProjectOpenable(projectRoot: string) {
  const resolution = await resolvePortableProjectData(projectRoot)
  if (resolution.status === "unsupported-project-data") throw resolution.error
  if (resolution.status === "recovery-required") {
    throw new PortableProjectResetError(
      "RECOVERY_REQUIRED",
      "Project has an incomplete collaboration reset and cannot be opened",
    )
  }
}

async function projectRecoveryProjection(
  projectRoot: string,
): Promise<Readonly<{ recovery: ProjectRecoveryStatus }> | Record<string, never>> {
  const resolution = await resolvePortableProjectData(projectRoot)
  if (resolution.status === "current") return Object.freeze({})
  if (resolution.status === "recovery-required") {
    return Object.freeze({ recovery: Object.freeze({ status: "recovery-required" as const }) })
  }
  return Object.freeze({
    recovery: Object.freeze({
      unsupportedPaths: Object.freeze([...resolution.error.unsupportedPaths]),
      status: "unsupported-project-data" as const,
    }),
  })
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
