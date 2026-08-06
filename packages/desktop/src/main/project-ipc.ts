import type { ProjectCollaborationRecoveryClient, ProjectLifecycleClient, ProjectRecord } from "@convax/project"
import type { ProjectIndexFileApplicationPortV2, ProjectIndexFileMutationResultV2 } from "@convax/project/canvas"
import { parseProjectId } from "@convax/collaboration"
import type { ProjectChangeEvent, ProjectFilesClient } from "@convax/project-files"
import { BrowserWindow, dialog, ipcMain, shell } from "electron"
import type { IpcMainInvokeEvent, OpenDialogOptions } from "electron"

type LifecycleInput<Method extends keyof ProjectLifecycleClient> = Parameters<ProjectLifecycleClient[Method]>[0]
type LifecycleResult<Method extends keyof ProjectLifecycleClient> = Awaited<ReturnType<ProjectLifecycleClient[Method]>>
type FilesInput<Method extends keyof ProjectFilesClient> = Parameters<ProjectFilesClient[Method]>[0]
type FilesResult<Method extends keyof ProjectFilesClient> = Awaited<ReturnType<ProjectFilesClient[Method]>>

interface ProjectImportIpcInput {
  destinationPath?: string
  projectId: string
  sourcePaths: string[]
}

export const projectIpcChannels = {
  createProject: "project:create",
  forgetProject: "project:forget",
  listProjects: "project:list",
  openProject: "project:open",
  renameProject: "project:rename",
  touchProject: "project:touch",
} as const

export const projectRecoveryIpcChannels = {
  confirmReset: "project:recovery-confirm-reset",
  inspectProject: "project:recovery-inspect",
  previewReset: "project:recovery-preview-reset",
} as const

export const projectFilesIpcChannels = {
  changed: "project-files:changed",
  copyEntries: "project-files:copy-entries",
  createEntry: "project-files:create-entry",
  deleteEntries: "project-files:delete-entries",
  importEntries: "project-files:import-entries",
  listDirectory: "project-files:list-directory",
  moveEntries: "project-files:move-entries",
  openEntry: "project-files:open-entry",
  readFile: "project-files:read-file",
  readFileInfo: "project-files:read-file-info",
  readTextPreview: "project-files:read-text-preview",
  readTextFile: "project-files:read-text-file",
  renameEntry: "project-files:rename-entry",
  revealEntry: "project-files:reveal-entry",
  writeTextFile: "project-files:write-text-file",
} as const

interface ProjectIpcContract {
  "project:recovery-confirm-reset": {
    input: Parameters<ProjectCollaborationRecoveryClient["confirmReset"]>[0]
    result: Awaited<ReturnType<ProjectCollaborationRecoveryClient["confirmReset"]>>
  }
  "project:recovery-inspect": {
    input: { projectId: string }
    result: Awaited<ReturnType<ProjectCollaborationRecoveryClient["inspectProject"]>>
  }
  "project:recovery-preview-reset": {
    input: { projectId: string }
    result: Awaited<ReturnType<ProjectCollaborationRecoveryClient["previewReset"]>>
  }
  "project-files:copy-entries": {
    input: FilesInput<"copyEntries">
    result: FilesResult<"copyEntries">
  }
  "project-files:create-entry": {
    input: FilesInput<"createEntry">
    result: FilesResult<"createEntry">
  }
  "project:create": {
    input: LifecycleInput<"createProject">
    result: LifecycleResult<"createProject">
  }
  "project-files:delete-entries": {
    input: FilesInput<"deleteEntries">
    result: FilesResult<"deleteEntries">
  }
  "project:forget": {
    input: LifecycleInput<"forgetProject">
    result: LifecycleResult<"forgetProject">
  }
  "project-files:import-entries": {
    input: ProjectImportIpcInput
    result: FilesResult<"importEntries">
  }
  "project-files:list-directory": {
    input: FilesInput<"listDirectory">
    result: FilesResult<"listDirectory">
  }
  "project:list": {
    input: undefined
    result: LifecycleResult<"listProjects">
  }
  "project-files:move-entries": {
    input: FilesInput<"moveEntries">
    result: FilesResult<"moveEntries">
  }
  "project-files:open-entry": {
    input: FilesInput<"openEntry">
    result: FilesResult<"openEntry">
  }
  "project:open": {
    input: undefined
    result: LifecycleResult<"openProject">
  }
  "project-files:read-file": {
    input: FilesInput<"readFile">
    result: FilesResult<"readFile">
  }
  "project-files:read-file-info": {
    input: FilesInput<"readFileInfo">
    result: FilesResult<"readFileInfo">
  }
  "project-files:read-text-preview": {
    input: FilesInput<"readTextPreview">
    result: FilesResult<"readTextPreview">
  }
  "project-files:read-text-file": {
    input: FilesInput<"readTextFile">
    result: FilesResult<"readTextFile">
  }
  "project-files:rename-entry": {
    input: FilesInput<"renameEntry">
    result: FilesResult<"renameEntry">
  }
  "project:rename": {
    input: LifecycleInput<"renameProject">
    result: LifecycleResult<"renameProject">
  }
  "project:touch": {
    input: LifecycleInput<"touchProject">
    result: LifecycleResult<"touchProject">
  }
  "project-files:reveal-entry": {
    input: FilesInput<"revealEntry">
    result: FilesResult<"revealEntry">
  }
  "project-files:write-text-file": {
    input: FilesInput<"writeTextFile">
    result: FilesResult<"writeTextFile">
  }
}

type ProjectInvokeChannel = keyof ProjectIpcContract
type StopWatching = () => void

function parseProjectIdForCollaboration(projectId: string) {
  return parseProjectId(projectId)
}

function decodeProjectFileDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",")
  if (comma < 0 || !dataUrl.slice(0, comma).endsWith(";base64")) throw new Error("Project file data URL is invalid")
  const encoded = dataUrl.slice(comma + 1)
  const bytes = Buffer.from(encoded, "base64")
  if (bytes.toString("base64") !== encoded) throw new Error("Project file data URL is not canonical base64")
  return Uint8Array.from(bytes)
}

function projectContentPolicy(path: string, mime: string): "immutable" | "conflict-preserving-text" | "overwritable-binary" {
  if (path === "Generated" || path.startsWith("Generated/")) return "immutable"
  if (mime.startsWith("text/") || /\.(?:md|mdx|txt|json|ya?ml|toml|tsx?|jsx?|css|html?|xml|csv|srt|vtt)$/iu.test(path)) {
    return "conflict-preserving-text"
  }
  return "overwritable-binary"
}

export function registerProjectRecoveryIpc(
  recovery: ProjectCollaborationRecoveryClient,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
) {
  const disposers = [
    registerHandler(projectRecoveryIpcChannels.inspectProject, isTrustedSender, (_event, input) =>
      recovery.inspectProject(input.projectId),
    ),
    registerHandler(projectRecoveryIpcChannels.previewReset, isTrustedSender, (_event, input) =>
      recovery.previewReset(input.projectId),
    ),
    registerHandler(projectRecoveryIpcChannels.confirmReset, isTrustedSender, (_event, input) =>
      recovery.confirmReset({ projectId: input.projectId, token: input.token }),
    ),
  ]
  return () => disposers.forEach((dispose) => dispose())
}

export interface DesktopProjectManager {
  add(rootPath: string): Promise<ProjectRecord>
  copyEntries(input: FilesInput<"copyEntries">): Promise<FilesResult<"copyEntries">>
  create(parentPath: string, name: string): Promise<ProjectRecord>
  createEntry(input: FilesInput<"createEntry">): Promise<FilesResult<"createEntry">>
  deleteEntries(input: FilesInput<"deleteEntries">): Promise<FilesResult<"deleteEntries">>
  forget(projectId: string): Promise<boolean>
  importEntries(input: ProjectImportIpcInput): Promise<FilesResult<"importEntries">>
  list(): Promise<ProjectRecord[]>
  listDirectory(input: FilesInput<"listDirectory">): Promise<FilesResult<"listDirectory">>
  moveEntries(input: FilesInput<"moveEntries">): Promise<FilesResult<"moveEntries">>
  readFile(input: FilesInput<"readFile">): Promise<FilesResult<"readFile">>
  readFileInfo(input: FilesInput<"readFileInfo">): Promise<FilesResult<"readFileInfo">>
  readTextPreview(input: FilesInput<"readTextPreview">): Promise<FilesResult<"readTextPreview">>
  readTextFile(input: FilesInput<"readTextFile">): Promise<FilesResult<"readTextFile">>
  rename(projectId: string, name: string): Promise<ProjectRecord>
  renameEntry(input: FilesInput<"renameEntry">): Promise<FilesResult<"renameEntry">>
  resolveEntryPath(input: { path?: string; projectId: string }): Promise<string>
  touch(projectId: string): Promise<ProjectRecord>
  watchProject(projectId: string, listener: (event: ProjectChangeEvent) => void): Promise<StopWatching> | StopWatching
  writeTextFile(input: FilesInput<"writeTextFile">): Promise<FilesResult<"writeTextFile">>
}

function showDirectoryDialog(event: IpcMainInvokeEvent, options: OpenDialogOptions) {
  const owner = BrowserWindow.fromWebContents(event.sender)
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
}

function registerHandler<Channel extends ProjectInvokeChannel>(
  channel: Channel,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
  handler: (
    event: IpcMainInvokeEvent,
    input: ProjectIpcContract[Channel]["input"],
  ) => Promise<ProjectIpcContract[Channel]["result"]> | ProjectIpcContract[Channel]["result"],
) {
  ipcMain.handle(channel, (event, input: ProjectIpcContract[Channel]["input"]) => {
    if (!isTrustedSender(event)) throw new Error("Project IPC request came from an untrusted renderer")
    return handler(event, input)
  })
  return () => ipcMain.removeHandler(channel)
}

export async function registerProjectIpc(
  manager: DesktopProjectManager,
  options: {
    isTrustedSender: (event: IpcMainInvokeEvent) => boolean
    projectCreationDirectory: string
    /** The forget result is not published until Main has quiesced Project-scoped runtimes. */
    onForgot?(projectId: string): Promise<void> | void
    /**
     * The guarded `project:touch` command is the sole Main activation barrier.
     * Native create/open only register a selection candidate and must not change
     * Main's active Project before the renderer has completed its leave guard.
     */
    onActivated?(project: ProjectRecord): Promise<void> | void
    /** Main-owned ProjectIndex bridge. Production supplies it; unit adapters may omit it. */
    projectIndexFiles?: ProjectIndexFileApplicationPortV2
  },
) {
  const handlerDisposers: Array<() => void> = []
  const watchers = new Map<string, Promise<StopWatching>>()

  const stopWatching = async (projectId: string) => {
    const watcher = watchers.get(projectId)
    if (!watcher) return
    watchers.delete(projectId)
    const stop = await watcher
    stop()
  }

  const publishChange = (event: ProjectChangeEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      window.webContents.send(projectFilesIpcChannels.changed, event)
    }
  }

  const ensureWatchingProject = (projectId: string) => {
    const existing = watchers.get(projectId)
    if (existing) return existing
    let watcher: Promise<StopWatching>
    watcher = Promise.resolve()
      .then(() => manager.watchProject(projectId, publishChange))
      .catch((error: unknown) => {
        if (watchers.get(projectId) === watcher) watchers.delete(projectId)
        console.error(`Failed to watch project ${projectId}`, error)
        return () => undefined
      })
    watchers.set(projectId, watcher)
    return watcher
  }

  const replaceProjectWatcher = async (project: ProjectRecord) => {
    await stopWatching(project.id)
    if (project.missing) return
    await ensureWatchingProject(project.id)
  }

  const withProjectWatcher = async <Result>(projectId: string, operation: () => Promise<Result>) => {
    await ensureWatchingProject(projectId)
    return operation()
  }

  const withCollaboration = async (
    result: FilesResult<"createEntry">,
    operations: readonly Readonly<{ path: string; run: () => Promise<ProjectIndexFileMutationResultV2> }>[],
  ): Promise<FilesResult<"createEntry">> => {
    if (!options.projectIndexFiles) return result
    const failedPaths: Array<{ path: string; code: string }> = []
    for (const operation of operations) {
      const outcome = await operation.run()
      if (outcome.status === "partial-success") failedPaths.push({ path: operation.path, code: outcome.code })
    }
    return {
      ...result,
      collaboration: failedPaths.length === 0
        ? { status: "committed", paths: operations.map((operation) => operation.path) }
        : { status: "partial-success", paths: operations.map((operation) => operation.path), failedPaths },
    }
  }

  const publishFileOperation = async (projectId: string, filePath: string) => {
    const contents = await manager.readFile({ projectId, path: filePath })
    const exactBytes = decodeProjectFileDataUrl(contents.dataUrl)
    return options.projectIndexFiles!.publishFile({
      projectId: parseProjectIdForCollaboration(projectId),
      path: filePath,
      exactBytes,
      mime: contents.mimeType,
      contentPolicy: projectContentPolicy(filePath, contents.mimeType),
      provenance: filePath === "Generated" || filePath.startsWith("Generated/") ? "generated" : "user",
    })
  }

  const publishTreeOperations = async (projectId: string, rootPath: string) => {
    const operations: Array<Readonly<{ path: string; run: () => Promise<ProjectIndexFileMutationResultV2> }>> = []
    const visit = async (entryPath: string) => {
      try {
        await manager.readFileInfo({ projectId, path: entryPath })
        operations.push({ path: entryPath, run: () => publishFileOperation(projectId, entryPath) })
        return
      } catch {
        const listing = await manager.listDirectory({ projectId, path: entryPath })
        operations.push({
          path: entryPath,
          run: () => options.projectIndexFiles!.createDirectory({ projectId: parseProjectIdForCollaboration(projectId), path: entryPath }),
        })
        for (const entry of listing.entries) await visit(entry.path)
      }
    }
    await visit(rootPath)
    return operations
  }

  const listTreePaths = async (projectId: string, rootPath: string): Promise<readonly string[]> => {
    try {
      await manager.readFileInfo({ projectId, path: rootPath })
      return [rootPath]
    } catch {
      const listing = await manager.listDirectory({ projectId, path: rootPath })
      const descendants = await Promise.all(listing.entries.map((entry) => listTreePaths(projectId, entry.path)))
      return [...descendants.flat(), rootPath]
    }
  }

  const listProjects = async () => {
    const projects = await manager.list()
    const availableIds = new Set(projects.filter((project) => !project.missing).map((project) => project.id))
    for (const projectId of watchers.keys()) {
      if (!availableIds.has(projectId)) await stopWatching(projectId)
    }
    return projects
  }

  const selectionResult = async (canceled: boolean, project?: ProjectRecord) => ({
    canceled,
    project,
    projects: await listProjects(),
  })

  handlerDisposers.push(
    registerHandler(projectIpcChannels.listProjects, options.isTrustedSender, async () => ({
      projects: await listProjects(),
    })),
    registerHandler(projectIpcChannels.openProject, options.isTrustedSender, async (event) => {
      const result = await showDirectoryDialog(event, {
        buttonLabel: "Open Project",
        properties: ["openDirectory"],
        title: "Open project folder",
      })
      if (result.canceled || !result.filePaths[0]) return selectionResult(true)
      const project = await manager.add(result.filePaths[0])
      await replaceProjectWatcher(project)
      return selectionResult(false, project)
    }),
    registerHandler(projectIpcChannels.createProject, options.isTrustedSender, async (_event, input) => {
      const project = await manager.create(options.projectCreationDirectory, input.name)
      await replaceProjectWatcher(project)
      return selectionResult(false, project)
    }),
    registerHandler(projectIpcChannels.renameProject, options.isTrustedSender, async (_event, input) => {
      const project = await manager.rename(input.projectId, input.name)
      return { project, projects: await listProjects() }
    }),
    registerHandler(projectIpcChannels.touchProject, options.isTrustedSender, async (_event, input) => {
      const project = await manager.touch(input.projectId)
      await options.onActivated?.(project)
      return { project, projects: await listProjects() }
    }),
    registerHandler(projectIpcChannels.forgetProject, options.isTrustedSender, async (_event, input) => {
      const removed = await manager.forget(input.projectId)
      if (removed) {
        await options.onForgot?.(input.projectId)
        await stopWatching(input.projectId)
      }
      return { projects: await listProjects(), removed }
    }),
    registerHandler(projectFilesIpcChannels.listDirectory, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.listDirectory(input)),
    ),
    registerHandler(projectFilesIpcChannels.copyEntries, options.isTrustedSender, async (_event, input) => {
      const result = await withProjectWatcher(input.projectId, () => manager.copyEntries(input))
      if (!options.projectIndexFiles) return result
      const groups = await Promise.all((result.targetPaths ?? []).map((target) => publishTreeOperations(input.projectId, target)))
      return withCollaboration(result, groups.flat())
    }),
    registerHandler(projectFilesIpcChannels.createEntry, options.isTrustedSender, async (_event, input) => {
      const result = await withProjectWatcher(input.projectId, () => manager.createEntry(input))
      if (!options.projectIndexFiles) return result
      const target = result.targetPaths?.[0]
      if (!target) return withCollaboration(result, [])
      const operations = input.kind === "directory"
        ? [{ path: target, run: () => options.projectIndexFiles!.createDirectory({ projectId: parseProjectIdForCollaboration(input.projectId), path: target }) }]
        : [{ path: target, run: () => publishFileOperation(input.projectId, target) }]
      return withCollaboration(result, operations)
    }),
    registerHandler(projectFilesIpcChannels.renameEntry, options.isTrustedSender, async (_event, input) => {
      const result = await withProjectWatcher(input.projectId, () => manager.renameEntry(input))
      if (!options.projectIndexFiles) return result
      const relocation = result.relocations?.[0]
      if (!relocation) return withCollaboration(result, [])
      return withCollaboration(result, [{ path: relocation.targetPath, run: () => options.projectIndexFiles!.relocateEntry({ projectId: parseProjectIdForCollaboration(input.projectId), currentPath: relocation.sourcePath, nextPath: relocation.targetPath, reason: "rename" }) }])
    }),
    registerHandler(projectFilesIpcChannels.moveEntries, options.isTrustedSender, async (_event, input) => {
      const result = await withProjectWatcher(input.projectId, () => manager.moveEntries(input))
      if (!options.projectIndexFiles) return result
      const operations = (result.relocations ?? []).map(({ sourcePath, targetPath }) => ({
        path: targetPath,
        run: () => options.projectIndexFiles!.relocateEntry({
          projectId: parseProjectIdForCollaboration(input.projectId),
          currentPath: sourcePath,
          nextPath: targetPath,
          reason: "move",
        }),
      }))
      return withCollaboration(result, operations)
    }),
    registerHandler(projectFilesIpcChannels.deleteEntries, options.isTrustedSender, async (_event, input) => {
      if (!options.projectIndexFiles) return withProjectWatcher(input.projectId, () => manager.deleteEntries(input))
      const paths = (await Promise.all(input.paths.map((entryPath) => listTreePaths(input.projectId, entryPath)))).flat()
      const logical = await withCollaboration(
        { affectedPaths: [], operation: "delete", projectId: input.projectId, sourcePaths: input.paths },
        paths.map((entryPath) => ({ path: entryPath, run: () => options.projectIndexFiles!.tombstoneEntry({ projectId: parseProjectIdForCollaboration(input.projectId), path: entryPath }) })),
      )
      if (logical.collaboration?.status === "partial-success") return logical
      const result = await withProjectWatcher(input.projectId, () => manager.deleteEntries(input))
      return { ...result, collaboration: logical.collaboration }
    }),
    registerHandler(projectFilesIpcChannels.importEntries, options.isTrustedSender, async (_event, input) => {
      const result = await withProjectWatcher(input.projectId, () => manager.importEntries(input))
      const sanitized = { ...result, sourcePaths: undefined }
      if (!options.projectIndexFiles) return sanitized
      const groups = await Promise.all((result.targetPaths ?? []).map((target) => publishTreeOperations(input.projectId, target)))
      return withCollaboration(sanitized, groups.flat())
    }),
    registerHandler(projectFilesIpcChannels.readFile, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.readFile(input)),
    ),
    registerHandler(projectFilesIpcChannels.readFileInfo, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.readFileInfo(input)),
    ),
    registerHandler(projectFilesIpcChannels.readTextPreview, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.readTextPreview(input)),
    ),
    registerHandler(projectFilesIpcChannels.readTextFile, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.readTextFile(input)),
    ),
    registerHandler(projectFilesIpcChannels.writeTextFile, options.isTrustedSender, async (_event, input) => {
      const result = await withProjectWatcher(input.projectId, () => manager.writeTextFile(input))
      return withCollaboration(result, options.projectIndexFiles ? [{ path: input.path, run: () => publishFileOperation(input.projectId, input.path) }] : [])
    }),
    registerHandler(projectFilesIpcChannels.revealEntry, options.isTrustedSender, async (_event, input) => {
      shell.showItemInFolder(await withProjectWatcher(input.projectId, () => manager.resolveEntryPath(input)))
    }),
    registerHandler(projectFilesIpcChannels.openEntry, options.isTrustedSender, async (_event, input) => {
      const error = await shell.openPath(
        await withProjectWatcher(input.projectId, () => manager.resolveEntryPath(input)),
      )
      return error ? { error } : {}
    }),
  )

  return () => {
    for (const dispose of handlerDisposers) dispose()
    for (const projectId of watchers.keys()) void stopWatching(projectId)
  }
}
