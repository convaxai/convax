import type { ProjectLifecycleClient, ProjectRecord } from "@convax/project"
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
  readManagedImageFile: "project-files:read-managed-image-file",
  readTextPreview: "project-files:read-text-preview",
  readTextFile: "project-files:read-text-file",
  renameEntry: "project-files:rename-entry",
  revealEntry: "project-files:reveal-entry",
  writeTextFile: "project-files:write-text-file",
} as const

interface ProjectIpcContract {
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
  "project-files:read-managed-image-file": {
    input: FilesInput<"readManagedImageFile">
    result: FilesResult<"readManagedImageFile">
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
  readManagedImageFile(input: FilesInput<"readManagedImageFile">): Promise<FilesResult<"readManagedImageFile">>
  readTextPreview(input: FilesInput<"readTextPreview">): Promise<FilesResult<"readTextPreview">>
  readTextFile(input: FilesInput<"readTextFile">): Promise<FilesResult<"readTextFile">>
  rename(projectId: string, name: string): Promise<ProjectRecord>
  renameEntry(input: FilesInput<"renameEntry">): Promise<FilesResult<"renameEntry">>
  resolveEntryPath(input: { path?: string; projectId: string }): Promise<string>
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

  const ensureWatching = (project: ProjectRecord) => {
    if (project.missing) return
    void ensureWatchingProject(project.id)
  }

  const withProjectWatcher = async <Result>(projectId: string, operation: () => Promise<Result>) => {
    await ensureWatchingProject(projectId)
    return operation()
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
      ensureWatching(project)
      return selectionResult(false, project)
    }),
    registerHandler(projectIpcChannels.createProject, options.isTrustedSender, async (_event, input) => {
      const project = await manager.create(options.projectCreationDirectory, input.name)
      ensureWatching(project)
      return selectionResult(false, project)
    }),
    registerHandler(projectIpcChannels.renameProject, options.isTrustedSender, async (_event, input) => {
      const project = await manager.rename(input.projectId, input.name)
      return { project, projects: await listProjects() }
    }),
    registerHandler(projectIpcChannels.forgetProject, options.isTrustedSender, async (_event, input) => {
      const removed = await manager.forget(input.projectId)
      if (removed) await stopWatching(input.projectId)
      return { projects: await listProjects(), removed }
    }),
    registerHandler(projectFilesIpcChannels.listDirectory, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.listDirectory(input)),
    ),
    registerHandler(projectFilesIpcChannels.copyEntries, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.copyEntries(input)),
    ),
    registerHandler(projectFilesIpcChannels.createEntry, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.createEntry(input)),
    ),
    registerHandler(projectFilesIpcChannels.renameEntry, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.renameEntry(input)),
    ),
    registerHandler(projectFilesIpcChannels.moveEntries, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.moveEntries(input)),
    ),
    registerHandler(projectFilesIpcChannels.deleteEntries, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.deleteEntries(input)),
    ),
    registerHandler(projectFilesIpcChannels.importEntries, options.isTrustedSender, async (_event, input) => {
      const result = await withProjectWatcher(input.projectId, () => manager.importEntries(input))
      return { ...result, sourcePaths: undefined }
    }),
    registerHandler(projectFilesIpcChannels.readFile, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.readFile(input)),
    ),
    registerHandler(projectFilesIpcChannels.readFileInfo, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.readFileInfo(input)),
    ),
    registerHandler(projectFilesIpcChannels.readManagedImageFile, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.readManagedImageFile(input)),
    ),
    registerHandler(projectFilesIpcChannels.readTextPreview, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.readTextPreview(input)),
    ),
    registerHandler(projectFilesIpcChannels.readTextFile, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.readTextFile(input)),
    ),
    registerHandler(projectFilesIpcChannels.writeTextFile, options.isTrustedSender, (_event, input) =>
      withProjectWatcher(input.projectId, () => manager.writeTextFile(input)),
    ),
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
