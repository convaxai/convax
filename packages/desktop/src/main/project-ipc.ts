import type { ProjectChangeEvent, ProjectClient, ProjectRecord } from "@convax/project"
import { BrowserWindow, dialog, ipcMain, shell } from "electron"
import type { IpcMainInvokeEvent, OpenDialogOptions } from "electron"

type ClientInput<Method extends keyof ProjectClient> = Parameters<ProjectClient[Method]>[0]
type ClientResult<Method extends keyof ProjectClient> = Awaited<ReturnType<ProjectClient[Method]>>

interface ProjectImportIpcInput {
  destinationPath?: string
  projectId: string
  sourcePaths: string[]
}

export const projectIpcChannels = {
  activateCanvas: "project:canvas-activate",
  changed: "project:changed",
  copyEntries: "project:copy-entries",
  createEntry: "project:create-entry",
  createCanvas: "project:canvas-create",
  createProject: "project:create",
  deleteEntries: "project:delete-entries",
  deleteCanvas: "project:canvas-delete",
  forgetProject: "project:forget",
  importEntries: "project:import-entries",
  getWorkspace: "project:workspace",
  listDirectory: "project:list-directory",
  listProjects: "project:list",
  moveEntries: "project:move-entries",
  openEntry: "project:open-entry",
  openProject: "project:open",
  readFile: "project:read-file",
  readFileInfo: "project:read-file-info",
  readCanvasDocument: "project:canvas-read-document",
  readTextPreview: "project:read-text-preview",
  readTextFile: "project:read-text-file",
  renameEntry: "project:rename-entry",
  renameCanvas: "project:canvas-rename",
  renameProject: "project:rename",
  revealEntry: "project:reveal-entry",
  writeTextFile: "project:write-text-file",
  writeCanvasDocument: "project:canvas-write-document",
} as const

interface ProjectIpcContract {
  "project:canvas-activate": {
    input: ClientInput<"activateCanvas">
    result: ClientResult<"activateCanvas">
  }
  "project:copy-entries": {
    input: ClientInput<"copyEntries">
    result: ClientResult<"copyEntries">
  }
  "project:create-entry": {
    input: ClientInput<"createEntry">
    result: ClientResult<"createEntry">
  }
  "project:canvas-create": {
    input: ClientInput<"createCanvas">
    result: ClientResult<"createCanvas">
  }
  "project:create": {
    input: ClientInput<"createProject">
    result: ClientResult<"createProject">
  }
  "project:delete-entries": {
    input: ClientInput<"deleteEntries">
    result: ClientResult<"deleteEntries">
  }
  "project:canvas-delete": {
    input: ClientInput<"deleteCanvas">
    result: ClientResult<"deleteCanvas">
  }
  "project:forget": {
    input: ClientInput<"forgetProject">
    result: ClientResult<"forgetProject">
  }
  "project:import-entries": {
    input: ProjectImportIpcInput
    result: ClientResult<"importEntries">
  }
  "project:workspace": {
    input: ClientInput<"getWorkspace">
    result: ClientResult<"getWorkspace">
  }
  "project:list-directory": {
    input: ClientInput<"listDirectory">
    result: ClientResult<"listDirectory">
  }
  "project:list": {
    input: undefined
    result: ClientResult<"listProjects">
  }
  "project:move-entries": {
    input: ClientInput<"moveEntries">
    result: ClientResult<"moveEntries">
  }
  "project:open-entry": {
    input: ClientInput<"openEntry">
    result: ClientResult<"openEntry">
  }
  "project:open": {
    input: undefined
    result: ClientResult<"openProject">
  }
  "project:read-file": {
    input: ClientInput<"readFile">
    result: ClientResult<"readFile">
  }
  "project:read-file-info": {
    input: ClientInput<"readFileInfo">
    result: ClientResult<"readFileInfo">
  }
  "project:canvas-read-document": {
    input: ClientInput<"readCanvasDocument">
    result: ClientResult<"readCanvasDocument">
  }
  "project:read-text-preview": {
    input: ClientInput<"readTextPreview">
    result: ClientResult<"readTextPreview">
  }
  "project:read-text-file": {
    input: ClientInput<"readTextFile">
    result: ClientResult<"readTextFile">
  }
  "project:rename-entry": {
    input: ClientInput<"renameEntry">
    result: ClientResult<"renameEntry">
  }
  "project:canvas-rename": {
    input: ClientInput<"renameCanvas">
    result: ClientResult<"renameCanvas">
  }
  "project:rename": {
    input: ClientInput<"renameProject">
    result: ClientResult<"renameProject">
  }
  "project:reveal-entry": {
    input: ClientInput<"revealEntry">
    result: ClientResult<"revealEntry">
  }
  "project:write-text-file": {
    input: ClientInput<"writeTextFile">
    result: ClientResult<"writeTextFile">
  }
  "project:canvas-write-document": {
    input: ClientInput<"writeCanvasDocument">
    result: ClientResult<"writeCanvasDocument">
  }
}

type ProjectInvokeChannel = keyof ProjectIpcContract
type StopWatching = () => void

export interface DesktopProjectManager {
  activateCanvas(input: ClientInput<"activateCanvas">): Promise<ClientResult<"activateCanvas">>
  add(rootPath: string): Promise<ProjectRecord>
  copyEntries(input: ClientInput<"copyEntries">): Promise<ClientResult<"copyEntries">>
  create(parentPath: string, name: string): Promise<ProjectRecord>
  createEntry(input: ClientInput<"createEntry">): Promise<ClientResult<"createEntry">>
  createCanvas(input: ClientInput<"createCanvas">): Promise<ClientResult<"createCanvas">>
  deleteEntries(input: ClientInput<"deleteEntries">): Promise<ClientResult<"deleteEntries">>
  deleteCanvas(input: ClientInput<"deleteCanvas">): Promise<ClientResult<"deleteCanvas">>
  forget(projectId: string): Promise<boolean>
  importEntries(input: ProjectImportIpcInput): Promise<ClientResult<"importEntries">>
  getWorkspace(input: ClientInput<"getWorkspace">): Promise<ClientResult<"getWorkspace">>
  list(): Promise<ProjectRecord[]>
  listDirectory(input: ClientInput<"listDirectory">): Promise<ClientResult<"listDirectory">>
  moveEntries(input: ClientInput<"moveEntries">): Promise<ClientResult<"moveEntries">>
  readFile(input: ClientInput<"readFile">): Promise<ClientResult<"readFile">>
  readFileInfo(input: ClientInput<"readFileInfo">): Promise<ClientResult<"readFileInfo">>
  readCanvasDocument(input: ClientInput<"readCanvasDocument">): Promise<ClientResult<"readCanvasDocument">>
  readTextPreview(input: ClientInput<"readTextPreview">): Promise<ClientResult<"readTextPreview">>
  readTextFile(input: ClientInput<"readTextFile">): Promise<ClientResult<"readTextFile">>
  rename(projectId: string, name: string): Promise<ProjectRecord>
  renameEntry(input: ClientInput<"renameEntry">): Promise<ClientResult<"renameEntry">>
  renameCanvas(input: ClientInput<"renameCanvas">): Promise<ClientResult<"renameCanvas">>
  resolveEntryPath(input: { path?: string; projectId: string }): Promise<string>
  watchProject(projectId: string, listener: (event: ProjectChangeEvent) => void): Promise<StopWatching> | StopWatching
  writeTextFile(input: ClientInput<"writeTextFile">): Promise<ClientResult<"writeTextFile">>
  writeCanvasDocument(input: ClientInput<"writeCanvasDocument">): Promise<ClientResult<"writeCanvasDocument">>
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
  options: { isTrustedSender: (event: IpcMainInvokeEvent) => boolean },
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
      window.webContents.send(projectIpcChannels.changed, event)
    }
  }

  const ensureWatching = (project: ProjectRecord) => {
    if (project.missing || watchers.has(project.id)) return
    const watcher = Promise.resolve(manager.watchProject(project.id, publishChange)).catch((error: unknown) => {
      watchers.delete(project.id)
      console.error(`Failed to watch project ${project.id}`, error)
      return () => undefined
    })
    watchers.set(project.id, watcher)
  }

  const listProjects = async () => {
    const projects = await manager.list()
    const activeIds = new Set(projects.filter((project) => !project.missing).map((project) => project.id))
    for (const projectId of watchers.keys()) {
      if (!activeIds.has(projectId)) await stopWatching(projectId)
    }
    for (const project of projects) ensureWatching(project)
    return projects
  }

  const selectionResult = async (canceled: boolean, project?: ProjectRecord) => ({
    canceled,
    project,
    projects: await listProjects(),
  })

  handlerDisposers.push(
    registerHandler(projectIpcChannels.activateCanvas, options.isTrustedSender, async (_event, input) => {
      const workspace = await manager.activateCanvas(input)
      publishChange({ kind: "workspace", projectId: input.projectId })
      return workspace
    }),
    registerHandler(projectIpcChannels.listProjects, options.isTrustedSender, async () => ({ projects: await listProjects() })),
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
    registerHandler(projectIpcChannels.createProject, options.isTrustedSender, async (event, input) => {
      const result = await showDirectoryDialog(event, {
        buttonLabel: "Create Here",
        properties: ["openDirectory", "createDirectory"],
        title: "Choose a location for the new project",
      })
      if (result.canceled || !result.filePaths[0]) return selectionResult(true)
      const project = await manager.create(result.filePaths[0], input.name)
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
    registerHandler(projectIpcChannels.listDirectory, options.isTrustedSender, (_event, input) => manager.listDirectory(input)),
    registerHandler(projectIpcChannels.copyEntries, options.isTrustedSender, (_event, input) => manager.copyEntries(input)),
    registerHandler(projectIpcChannels.createEntry, options.isTrustedSender, (_event, input) => manager.createEntry(input)),
    registerHandler(projectIpcChannels.createCanvas, options.isTrustedSender, async (_event, input) => {
      const result = await manager.createCanvas(input)
      publishChange({ kind: "workspace", projectId: input.projectId })
      return result
    }),
    registerHandler(projectIpcChannels.renameEntry, options.isTrustedSender, (_event, input) => manager.renameEntry(input)),
    registerHandler(projectIpcChannels.moveEntries, options.isTrustedSender, (_event, input) => manager.moveEntries(input)),
    registerHandler(projectIpcChannels.deleteEntries, options.isTrustedSender, (_event, input) => manager.deleteEntries(input)),
    registerHandler(projectIpcChannels.deleteCanvas, options.isTrustedSender, async (_event, input) => {
      const result = await manager.deleteCanvas(input)
      publishChange({ kind: "workspace", projectId: input.projectId })
      return result
    }),
    registerHandler(projectIpcChannels.getWorkspace, options.isTrustedSender, (_event, input) => manager.getWorkspace(input)),
    registerHandler(projectIpcChannels.importEntries, options.isTrustedSender, async (_event, input) => {
      const result = await manager.importEntries(input)
      return { ...result, sourcePaths: undefined }
    }),
    registerHandler(projectIpcChannels.readFile, options.isTrustedSender, (_event, input) => manager.readFile(input)),
    registerHandler(projectIpcChannels.readFileInfo, options.isTrustedSender, (_event, input) => manager.readFileInfo(input)),
    registerHandler(projectIpcChannels.readCanvasDocument, options.isTrustedSender, (_event, input) => manager.readCanvasDocument(input)),
    registerHandler(projectIpcChannels.readTextPreview, options.isTrustedSender, (_event, input) => manager.readTextPreview(input)),
    registerHandler(projectIpcChannels.readTextFile, options.isTrustedSender, (_event, input) => manager.readTextFile(input)),
    registerHandler(projectIpcChannels.writeTextFile, options.isTrustedSender, (_event, input) => manager.writeTextFile(input)),
    registerHandler(projectIpcChannels.writeCanvasDocument, options.isTrustedSender, (_event, input) => manager.writeCanvasDocument(input)),
    registerHandler(projectIpcChannels.renameCanvas, options.isTrustedSender, async (_event, input) => {
      const result = await manager.renameCanvas(input)
      publishChange({ kind: "workspace", projectId: input.projectId })
      return result
    }),
    registerHandler(projectIpcChannels.revealEntry, options.isTrustedSender, async (_event, input) => {
      shell.showItemInFolder(await manager.resolveEntryPath(input))
    }),
    registerHandler(projectIpcChannels.openEntry, options.isTrustedSender, async (_event, input) => {
      const error = await shell.openPath(await manager.resolveEntryPath(input))
      return error ? { error } : {}
    }),
  )

  for (const project of await manager.list()) ensureWatching(project)

  return () => {
    for (const dispose of handlerDisposers) dispose()
    for (const projectId of watchers.keys()) void stopWatching(projectId)
  }
}
