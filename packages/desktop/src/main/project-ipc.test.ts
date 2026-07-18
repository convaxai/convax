import { afterEach, expect, mock, spyOn, test } from "bun:test"
import type { ProjectRecord } from "@convax/project"
import type { ProjectChangeEvent } from "@convax/project-files"
import type { DesktopProjectManager } from "./project-ipc"

type InvokeHandler = (event: TestIpcEvent, input?: unknown) => unknown
type TestIpcEvent = { sender: { id: number } }

interface TestWindow {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    send: ReturnType<typeof mock>
  }
}

const handlers = new Map<string, InvokeHandler>()
const windows: TestWindow[] = []

void mock.module("electron", () => ({
  BrowserWindow: {
    fromWebContents: () => undefined,
    getAllWindows: () => windows,
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  ipcMain: {
    handle: (channel: string, handler: InvokeHandler) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
  shell: {
    openPath: async () => "",
    showItemInFolder: () => undefined,
  },
}))

afterEach(() => {
  handlers.clear()
  windows.splice(0)
})

function project(id: string, missing = false): ProjectRecord {
  return {
    createdAt: 1,
    id,
    lastOpenedAt: 1,
    missing,
    name: id,
    rootPath: `/projects/${id}`,
  }
}

function invoke(channel: string, input?: unknown) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return handler({ sender: { id: 1 } }, input)
}

test("watches projects lazily when their files are first used", async () => {
  let projects = [project("one"), project("two")]
  const changeListeners = new Map<string, (event: ProjectChangeEvent) => void>()
  const stops = new Map<string, ReturnType<typeof mock>>()
  const list = mock(async () => projects)
  const listDirectory = mock(async (input: { path?: string; projectId: string }) => ({
    entries: [],
    path: input.path ?? "",
    projectId: input.projectId,
  }))
  const watchProject = mock((projectId: string, listener: (event: ProjectChangeEvent) => void) => {
    const stop = mock(() => undefined)
    changeListeners.set(projectId, listener)
    stops.set(projectId, stop)
    return stop
  })
  const unsupported = async (): Promise<never> => {
    throw new Error("Unexpected Project manager call")
  }
  const manager = {
    add: unsupported,
    copyEntries: unsupported,
    create: unsupported,
    createEntry: unsupported,
    deleteEntries: unsupported,
    forget: unsupported,
    importEntries: unsupported,
    list,
    listDirectory,
    moveEntries: unsupported,
    readFile: unsupported,
    readFileInfo: unsupported,
    readManagedImageFile: unsupported,
    readTextFile: unsupported,
    readTextPreview: unsupported,
    rename: unsupported,
    renameEntry: unsupported,
    resolveEntryPath: unsupported,
    watchProject,
    writeTextFile: unsupported,
  } satisfies DesktopProjectManager
  const sent = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: mock(() => undefined),
    },
  }
  windows.push(sent)

  const { projectFilesIpcChannels, projectIpcChannels, registerProjectIpc } = await import("./project-ipc")
  const dispose = await registerProjectIpc(manager, { isTrustedSender: () => true })

  expect(list).not.toHaveBeenCalled()
  expect(watchProject).not.toHaveBeenCalled()

  await invoke(projectIpcChannels.listProjects)
  expect(list).toHaveBeenCalledTimes(1)
  expect(watchProject).not.toHaveBeenCalled()

  await invoke(projectFilesIpcChannels.listDirectory, { path: "", projectId: "one" })
  await invoke(projectFilesIpcChannels.listDirectory, { path: "assets", projectId: "one" })
  expect(watchProject).toHaveBeenCalledTimes(1)
  expect(watchProject).toHaveBeenCalledWith("one", expect.any(Function))
  expect(listDirectory).toHaveBeenCalledTimes(2)

  const change = { kind: "filesystem", path: "brief.txt", projectId: "one" } as const
  changeListeners.get("one")?.(change)
  expect(sent.webContents.send).toHaveBeenCalledWith(projectFilesIpcChannels.changed, change)

  projects = [project("one", true), project("two")]
  await invoke(projectIpcChannels.listProjects)
  expect(stops.get("one")).toHaveBeenCalledTimes(1)

  dispose()
})

test("keeps a replacement watcher when a stopped pending watcher later fails", async () => {
  const reportError = spyOn(console, "error").mockImplementation(() => undefined)
  let projects = [project("one")]
  let rejectFirstWatcher: (error: Error) => void = () => undefined
  const firstWatcher = new Promise<() => void>((_resolve, reject) => {
    rejectFirstWatcher = reject
  })
  const replacementStop = mock(() => undefined)
  const list = mock(async () => projects)
  const listDirectory = mock(async (input: { path?: string; projectId: string }) => ({
    entries: [],
    path: input.path ?? "",
    projectId: input.projectId,
  }))
  let watcherCalls = 0
  const watchProject = mock(() => {
    watcherCalls += 1
    return watcherCalls === 1 ? firstWatcher : replacementStop
  })
  const unsupported = async (): Promise<never> => {
    throw new Error("Unexpected Project manager call")
  }
  const manager = {
    add: unsupported,
    copyEntries: unsupported,
    create: unsupported,
    createEntry: unsupported,
    deleteEntries: unsupported,
    forget: mock(async () => {
      projects = []
      return true
    }),
    importEntries: unsupported,
    list,
    listDirectory,
    moveEntries: unsupported,
    readFile: unsupported,
    readFileInfo: unsupported,
    readManagedImageFile: unsupported,
    readTextFile: unsupported,
    readTextPreview: unsupported,
    rename: unsupported,
    renameEntry: unsupported,
    resolveEntryPath: unsupported,
    watchProject,
    writeTextFile: unsupported,
  } satisfies DesktopProjectManager

  const { projectFilesIpcChannels, projectIpcChannels, registerProjectIpc } = await import("./project-ipc")
  const dispose = await registerProjectIpc(manager, { isTrustedSender: () => true })

  const firstFileRequest = Promise.resolve(
    invoke(projectFilesIpcChannels.listDirectory, { path: "", projectId: "one" }),
  )
  await Bun.sleep(0)
  expect(watchProject).toHaveBeenCalledTimes(1)

  const forgetRequest = Promise.resolve(invoke(projectIpcChannels.forgetProject, { projectId: "one" }))
  await Bun.sleep(0)
  const replacementFileRequest = Promise.resolve(
    invoke(projectFilesIpcChannels.listDirectory, { path: "assets", projectId: "one" }),
  )
  await Bun.sleep(0)
  expect(watchProject).toHaveBeenCalledTimes(2)

  rejectFirstWatcher(new Error("first watcher failed after it was stopped"))
  await Promise.all([firstFileRequest, forgetRequest, replacementFileRequest])

  expect(reportError).toHaveBeenCalledWith("Failed to watch project one", expect.any(Error))
  expect(replacementStop).toHaveBeenCalledTimes(1)
  reportError.mockRestore()
  dispose()
})
