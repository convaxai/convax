import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"
import { ProjectController, type ProjectLifecycleClient, type ProjectRecord } from "@convax/project"
import type { ProjectIndexFileApplicationPort } from "@convax/project/canvas"
import type { ProjectChangeEvent } from "@convax/project-files"
import { configureElectronMock, resetElectronMock } from "./electron-test-mock"
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
const projectCreationDirectory = "/Documents/Convax"
const showOpenDialog = mock(async () => ({ canceled: true, filePaths: [] as string[] }))

beforeEach(() => {
  configureElectronMock({
    BrowserWindow: {
      fromWebContents: () => undefined,
      getAllWindows: () => windows,
    },
    dialog: {
      showOpenDialog,
    },
    ipcMain: {
      handle: (channel: string, handler: InvokeHandler) => handlers.set(channel, handler),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
    shell: {
      openPath: async () => "",
      showItemInFolder: () => undefined,
    },
  })
})

afterEach(() => {
  handlers.clear()
  windows.splice(0)
  showOpenDialog.mockClear()
  resetElectronMock()
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
    readTextFile: unsupported,
    readTextPreview: unsupported,
    rename: unsupported,
    renameEntry: unsupported,
    resolveEntryPath: unsupported,
    touch: unsupported,
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
  const dispose = await registerProjectIpc(manager, { isTrustedSender: () => true, projectCreationDirectory })

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

test("publishes Project files before ProjectIndex and reports collaboration failure as partial success", async () => {
  const projectId = "project_0123456789abcdef0123456789abcdef"
  const order: string[] = []
  const writeTextFile = mock(async (input: { path: string; projectId: string }) => {
    order.push("file")
    return { operation: "write" as const, projectId: input.projectId, affectedPaths: [input.path], targetPaths: [input.path] }
  })
  const readFile = mock(async (input: { path: string }) => ({
    dataUrl: "data:text/markdown;base64,IyBUaXRsZQ==",
    mimeType: "text/markdown",
    name: "notes.md",
    path: input.path,
    size: 7,
  }))
  const projectIndexFiles: ProjectIndexFileApplicationPort = {
    admitManagedBlob: async () => ({ status: "partial-success", code: "index-commit-failed" }),
    createDirectory: async () => ({ status: "committed", entryId: `pd_${"a".repeat(64)}`, versionId: null }),
    publishFile: async (input) => {
      order.push("index")
      expect(new TextDecoder().decode(input.exactBytes)).toBe("# Title")
      expect(input.contentPolicy).toBe("conflict-preserving-text")
      return { status: "partial-success", code: "index-commit-failed" }
    },
    relocateEntry: async () => ({ status: "committed", entryId: `pf_${"a".repeat(64)}`, versionId: null }),
    tombstoneEntry: async () => ({ status: "committed", entryId: `pf_${"a".repeat(64)}`, versionId: null }),
  }
  const unsupported = async (): Promise<never> => { throw new Error("Unexpected Project manager call") }
  const manager = {
    add: unsupported, copyEntries: unsupported, create: unsupported, createEntry: unsupported,
    deleteEntries: unsupported, forget: unsupported, importEntries: unsupported, list: async () => [],
    listDirectory: unsupported, moveEntries: unsupported, readFile, readFileInfo: unsupported,
    readTextFile: unsupported, readTextPreview: unsupported, rename: unsupported, renameEntry: unsupported,
    resolveEntryPath: unsupported, touch: unsupported, watchProject: () => () => undefined, writeTextFile,
  } satisfies DesktopProjectManager
  const { projectFilesIpcChannels, registerProjectIpc } = await import("./project-ipc")
  const dispose = await registerProjectIpc(manager, {
    isTrustedSender: () => true,
    projectCreationDirectory,
    projectIndexFiles,
  })
  const result = await invoke(projectFilesIpcChannels.writeTextFile, { projectId, path: "Notes/notes.md", content: "# Title" })
  expect(order).toEqual(["file", "index"])
  expect(result).toMatchObject({
    collaboration: {
      status: "partial-success",
      failedPaths: [{ path: "Notes/notes.md", code: "index-commit-failed" }],
    },
  })
  dispose()
})

test("uses the manager's exact relocation receipt instead of guessing source paths by basename", async () => {
  const projectId = "project_0123456789abcdef0123456789abcdef"
  const relocateEntry = mock(async (_input: Parameters<ProjectIndexFileApplicationPort["relocateEntry"]>[0]) => ({ status: "committed" as const, entryId: `pf_${"a".repeat(64)}` as const, versionId: null }))
  const moveEntries = mock(async () => ({
    operation: "move" as const,
    projectId,
    affectedPaths: ["A/same.md", "B/same.md", "C/one.md", "D/two.md"],
    sourcePaths: ["A/same.md", "B/same.md"],
    targetPaths: ["C/one.md", "D/two.md"],
    relocations: [
      { sourcePath: "B/same.md", targetPath: "C/one.md" },
      { sourcePath: "A/same.md", targetPath: "D/two.md" },
    ],
  }))
  const unsupported = async (): Promise<never> => { throw new Error("Unexpected Project manager call") }
  const manager = {
    add: unsupported, copyEntries: unsupported, create: unsupported, createEntry: unsupported,
    deleteEntries: unsupported, forget: unsupported, importEntries: unsupported, list: async () => [],
    listDirectory: unsupported, moveEntries, readFile: unsupported, readFileInfo: unsupported,
    readTextFile: unsupported, readTextPreview: unsupported, rename: unsupported, renameEntry: unsupported,
    resolveEntryPath: unsupported, touch: unsupported, watchProject: () => () => undefined, writeTextFile: unsupported,
  } satisfies DesktopProjectManager
  const projectIndexFiles: ProjectIndexFileApplicationPort = {
    admitManagedBlob: unsupported,
    createDirectory: unsupported,
    publishFile: unsupported,
    relocateEntry,
    tombstoneEntry: unsupported,
  }
  const { projectFilesIpcChannels, registerProjectIpc } = await import("./project-ipc")
  const dispose = await registerProjectIpc(manager, { isTrustedSender: () => true, projectCreationDirectory, projectIndexFiles })
  await invoke(projectFilesIpcChannels.moveEntries, { projectId, paths: ["A/same.md", "B/same.md"], destinationPath: "C" })
  expect(relocateEntry.mock.calls.map(([input]) => input)).toEqual([
    expect.objectContaining({ currentPath: "B/same.md", nextPath: "C/one.md" }),
    expect.objectContaining({ currentPath: "A/same.md", nextPath: "D/two.md" }),
  ])
  dispose()
})

test("commits ProjectIndex tombstones before native deletion and preserves the file when tombstoning fails", async () => {
  const projectId = "project_0123456789abcdef0123456789abcdef"
  const order: string[] = []
  const deleteEntries = mock(async () => {
    order.push("file-delete")
    return { operation: "delete" as const, projectId, affectedPaths: ["notes.md"], sourcePaths: ["notes.md"] }
  })
  const readFileInfo = mock(async () => ({ mimeType: "text/markdown", name: "notes.md", path: "notes.md", size: 4 }))
  let reject = false
  const tombstoneEntry = mock(async () => {
    order.push("tombstone")
    return reject
      ? { status: "partial-success" as const, code: "index-commit-failed" as const }
      : { status: "committed" as const, entryId: `pf_${"a".repeat(64)}` as const, versionId: null }
  })
  const unsupported = async (): Promise<never> => { throw new Error("Unexpected Project manager call") }
  const manager = {
    add: unsupported, copyEntries: unsupported, create: unsupported, createEntry: unsupported,
    deleteEntries, forget: unsupported, importEntries: unsupported, list: async () => [],
    listDirectory: unsupported, moveEntries: unsupported, readFile: unsupported, readFileInfo,
    readTextFile: unsupported, readTextPreview: unsupported, rename: unsupported, renameEntry: unsupported,
    resolveEntryPath: unsupported, touch: unsupported, watchProject: () => () => undefined, writeTextFile: unsupported,
  } satisfies DesktopProjectManager
  const projectIndexFiles: ProjectIndexFileApplicationPort = {
    admitManagedBlob: unsupported,
    createDirectory: unsupported, publishFile: unsupported, relocateEntry: unsupported, tombstoneEntry,
  }
  const { projectFilesIpcChannels, registerProjectIpc } = await import("./project-ipc")
  const dispose = await registerProjectIpc(manager, { isTrustedSender: () => true, projectCreationDirectory, projectIndexFiles })
  await invoke(projectFilesIpcChannels.deleteEntries, { projectId, paths: ["notes.md"] })
  expect(order).toEqual(["tombstone", "file-delete"])

  order.length = 0
  reject = true
  const result = await invoke(projectFilesIpcChannels.deleteEntries, { projectId, paths: ["notes.md"] }) as { collaboration: { status: string } }
  expect(order).toEqual(["tombstone"])
  expect(result.collaboration.status).toBe("partial-success")
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
    readTextFile: unsupported,
    readTextPreview: unsupported,
    rename: unsupported,
    renameEntry: unsupported,
    resolveEntryPath: unsupported,
    touch: unsupported,
    watchProject,
    writeTextFile: unsupported,
  } satisfies DesktopProjectManager
  const onForgot = mock((_projectId: string) => undefined)

  const { projectFilesIpcChannels, projectIpcChannels, registerProjectIpc } = await import("./project-ipc")
  const dispose = await registerProjectIpc(manager, { isTrustedSender: () => true, onForgot, projectCreationDirectory })

  const firstFileRequest = Promise.resolve(
    invoke(projectFilesIpcChannels.listDirectory, { path: "", projectId: "one" }),
  )
  await Bun.sleep(0)
  expect(watchProject).toHaveBeenCalledTimes(1)

  const forgetRequest = Promise.resolve(invoke(projectIpcChannels.forgetProject, { projectId: "one" }))
  await Bun.sleep(0)
  expect(onForgot).toHaveBeenCalledWith("one")
  const replacementFileRequest = Promise.resolve(
    invoke(projectFilesIpcChannels.listDirectory, { path: "assets", projectId: "one" }),
  )
  await Bun.sleep(0)
  expect(watchProject).toHaveBeenCalledTimes(2)

  rejectFirstWatcher(new Error("first watcher failed after it was stopped"))
  await Promise.all([firstFileRequest, forgetRequest, replacementFileRequest])

  expect(reportError).toHaveBeenCalledWith("Failed to watch project one", expect.any(Error))
  expect(replacementStop).toHaveBeenCalledTimes(1)
  expect(onForgot).toHaveBeenCalledWith("one")
  reportError.mockRestore()
  dispose()
})

test("does not report a forgotten Project until the Main quiesce barrier completes", async () => {
  let releaseQuiesce: (() => void) | undefined
  const quiesceBarrier = new Promise<void>((resolve) => {
    releaseQuiesce = resolve
  })
  const onForgot = mock(async (_projectId: string) => {
    await quiesceBarrier
  })
  const stopWatching = mock(() => undefined)
  const unsupported = async (): Promise<never> => {
    throw new Error("Unexpected Project manager call")
  }
  const manager = {
    add: unsupported,
    copyEntries: unsupported,
    create: unsupported,
    createEntry: unsupported,
    deleteEntries: unsupported,
    forget: mock(async () => true),
    importEntries: unsupported,
    list: mock(async () => []),
    listDirectory: mock(async (input: { path?: string; projectId: string }) => ({
      entries: [],
      path: input.path ?? "",
      projectId: input.projectId,
    })),
    moveEntries: unsupported,
    readFile: unsupported,
    readFileInfo: unsupported,
    readTextFile: unsupported,
    readTextPreview: unsupported,
    rename: unsupported,
    renameEntry: unsupported,
    resolveEntryPath: unsupported,
    touch: unsupported,
    watchProject: mock(() => stopWatching),
    writeTextFile: unsupported,
  } satisfies DesktopProjectManager

  const { projectFilesIpcChannels, projectIpcChannels, registerProjectIpc } = await import("./project-ipc")
  const dispose = await registerProjectIpc(manager, {
    isTrustedSender: () => true,
    onForgot,
    projectCreationDirectory,
  })
  await invoke(projectFilesIpcChannels.listDirectory, { path: "", projectId: "one" })

  let settled = false
  const request = Promise.resolve(invoke(projectIpcChannels.forgetProject, { projectId: "one" })).then((result) => {
    settled = true
    return result
  })
  await Bun.sleep(0)

  expect(onForgot).toHaveBeenCalledWith("one")
  expect(settled).toBe(false)
  expect(stopWatching).not.toHaveBeenCalled()

  releaseQuiesce?.()
  await expect(request).resolves.toEqual({ projects: [], removed: true })
  expect(stopWatching).toHaveBeenCalledTimes(1)

  dispose()
})

test("creates a named project in the injected user workspace without opening a directory dialog", async () => {
  let projects: ProjectRecord[] = []
  const created = project("storyboard")
  const create = mock(async (parentPath: string, name: string) => {
    projects = [{ ...created, name, rootPath: `${parentPath}/${name}` }]
    return projects[0]!
  })
  const watchProject = mock(() => () => undefined)
  const unsupported = async (): Promise<never> => {
    throw new Error("Unexpected Project manager call")
  }
  const manager = {
    add: unsupported,
    copyEntries: unsupported,
    create,
    createEntry: unsupported,
    deleteEntries: unsupported,
    forget: unsupported,
    importEntries: unsupported,
    list: async () => projects,
    listDirectory: unsupported,
    moveEntries: unsupported,
    readFile: unsupported,
    readFileInfo: unsupported,
    readTextFile: unsupported,
    readTextPreview: unsupported,
    rename: unsupported,
    renameEntry: unsupported,
    resolveEntryPath: unsupported,
    touch: unsupported,
    watchProject,
    writeTextFile: unsupported,
  } satisfies DesktopProjectManager

  const { projectIpcChannels, registerProjectIpc } = await import("./project-ipc")
  const onActivated = mock(async (_project: ProjectRecord) => undefined)
  const dispose = await registerProjectIpc(manager, {
    isTrustedSender: () => true,
    onActivated,
    projectCreationDirectory,
  })

  const result = await invoke(projectIpcChannels.createProject, { name: "Storyboard" })
  await Bun.sleep(0)

  expect(create).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledWith(projectCreationDirectory, "Storyboard")
  expect(showOpenDialog).not.toHaveBeenCalled()
  expect(watchProject).toHaveBeenCalledWith("storyboard", expect.any(Function))
  expect(onActivated).not.toHaveBeenCalled()
  expect(result).toMatchObject({
    canceled: false,
    project: { name: "Storyboard", rootPath: `${projectCreationDirectory}/Storyboard` },
  })

  create.mockImplementationOnce(async () => {
    throw new Error("Project already exists: Storyboard")
  })
  await expect(invoke(projectIpcChannels.createProject, { name: "Storyboard" })).rejects.toThrow(
    "Project already exists",
  )
  expect(showOpenDialog).not.toHaveBeenCalled()
  expect(watchProject).toHaveBeenCalledTimes(1)

  expect(await invoke(projectIpcChannels.openProject)).toMatchObject({ canceled: true })
  expect(showOpenDialog).toHaveBeenCalledTimes(1)

  dispose()
})

test("activates a created Project only after the renderer leave guard and through one touch barrier", async () => {
  let projects = [project("one")]
  const created = { ...project("two"), name: "Two" }
  const order: string[] = []
  let releaseLeaveGuard: (() => void) | undefined
  const leaveGuard = new Promise<void>((resolve) => {
    releaseLeaveGuard = resolve
  })
  const create = mock(async () => {
    order.push("create")
    projects = [...projects, created]
    return created
  })
  const touch = mock(async (projectId: string) => {
    order.push(`touch:${projectId}`)
    const current = projects.find((candidate) => candidate.id === projectId)
    if (!current) throw new Error(`Project was not found: ${projectId}`)
    return current
  })
  const unsupported = async (): Promise<never> => {
    throw new Error("Unexpected Project manager call")
  }
  const manager = {
    add: unsupported,
    copyEntries: unsupported,
    create,
    createEntry: unsupported,
    deleteEntries: unsupported,
    forget: unsupported,
    importEntries: unsupported,
    list: async () => projects,
    listDirectory: unsupported,
    moveEntries: unsupported,
    readFile: unsupported,
    readFileInfo: unsupported,
    readTextFile: unsupported,
    readTextPreview: unsupported,
    rename: unsupported,
    renameEntry: unsupported,
    resolveEntryPath: unsupported,
    touch,
    watchProject: () => () => undefined,
    writeTextFile: unsupported,
  } satisfies DesktopProjectManager

  const { projectIpcChannels, registerProjectIpc } = await import("./project-ipc")
  const onActivated = mock(async (selected: ProjectRecord) => {
    order.push(`activate:${selected.id}`)
  })
  const dispose = await registerProjectIpc(manager, {
    isTrustedSender: () => true,
    onActivated,
    projectCreationDirectory,
  })
  const client: ProjectLifecycleClient = {
    createProject: (input) =>
      Promise.resolve(invoke(projectIpcChannels.createProject, input)) as ReturnType<
        ProjectLifecycleClient["createProject"]
      >,
    forgetProject: async () => {
      throw new Error("Unexpected forgetProject call")
    },
    listProjects: () =>
      Promise.resolve(invoke(projectIpcChannels.listProjects)) as ReturnType<
        ProjectLifecycleClient["listProjects"]
      >,
    openProject: async () => {
      throw new Error("Unexpected openProject call")
    },
    renameProject: async () => {
      throw new Error("Unexpected renameProject call")
    },
    touchProject: (input) =>
      Promise.resolve(invoke(projectIpcChannels.touchProject, input)) as ReturnType<
        ProjectLifecycleClient["touchProject"]
      >,
  }
  const controller = new ProjectController(client, {
    beforeActiveProjectChange: async (currentProjectId, nextProjectId) => {
      order.push(`guard:${currentProjectId}->${nextProjectId}`)
      await leaveGuard
      order.push("guard:passed")
      return true
    },
  })

  await controller.initialize()
  order.length = 0
  onActivated.mockClear()
  touch.mockClear()

  const selection = controller.createProject("Two")
  await Bun.sleep(0)

  expect(order).toEqual(["create", "guard:one->two"])
  expect(onActivated).not.toHaveBeenCalled()
  expect(touch).not.toHaveBeenCalled()
  expect(controller.getSnapshot()).toMatchObject({
    activeProjectId: "one",
    changingActiveProject: true,
  })

  releaseLeaveGuard?.()
  await expect(selection).resolves.toBe(true)

  expect(order).toEqual([
    "create",
    "guard:one->two",
    "guard:passed",
    "touch:two",
    "activate:two",
  ])
  expect(touch).toHaveBeenCalledTimes(1)
  expect(onActivated).toHaveBeenCalledTimes(1)
  expect(controller.getSnapshot()).toMatchObject({
    activeProjectId: "two",
    changingActiveProject: false,
    error: null,
  })

  controller.dispose()
  dispose()
})

test("replaces an existing watcher when the same Project id is opened or created again", async () => {
  let projects = [{ ...project("same"), rootPath: "/projects/original" }]
  const stops = [mock(() => undefined), mock(() => undefined), mock(() => undefined)]
  let watcherCall = 0
  const watchProject = mock(() => stops[watcherCall++])
  const add = mock(async (rootPath: string) => {
    projects = [{ ...projects[0], rootPath }]
    return projects[0]
  })
  const create = mock(async (parentPath: string, name: string) => {
    projects = [{ ...projects[0], name, rootPath: `${parentPath}/${name}` }]
    return projects[0]
  })
  const listDirectory = mock(async (input: { path?: string; projectId: string }) => ({
    entries: [],
    path: input.path ?? "",
    projectId: input.projectId,
  }))
  const unsupported = async (): Promise<never> => {
    throw new Error("Unexpected Project manager call")
  }
  const manager = {
    add,
    copyEntries: unsupported,
    create,
    createEntry: unsupported,
    deleteEntries: unsupported,
    forget: unsupported,
    importEntries: unsupported,
    list: async () => projects,
    listDirectory,
    moveEntries: unsupported,
    readFile: unsupported,
    readFileInfo: unsupported,
    readTextFile: unsupported,
    readTextPreview: unsupported,
    rename: unsupported,
    renameEntry: unsupported,
    resolveEntryPath: unsupported,
    touch: unsupported,
    watchProject,
    writeTextFile: unsupported,
  } satisfies DesktopProjectManager

  const { projectFilesIpcChannels, projectIpcChannels, registerProjectIpc } = await import("./project-ipc")
  const onActivated = mock(async (_project: ProjectRecord) => undefined)
  const dispose = await registerProjectIpc(manager, {
    isTrustedSender: () => true,
    onActivated,
    projectCreationDirectory,
  })

  await invoke(projectFilesIpcChannels.listDirectory, { path: "", projectId: "same" })
  expect(watchProject).toHaveBeenCalledTimes(1)

  showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/projects/rebound"] })
  await invoke(projectIpcChannels.openProject)
  expect(add).toHaveBeenCalledWith("/projects/rebound")
  expect(stops[0]).toHaveBeenCalledTimes(1)
  expect(watchProject).toHaveBeenCalledTimes(2)
  expect(onActivated).not.toHaveBeenCalled()

  await invoke(projectIpcChannels.createProject, { name: "Recreated" })
  expect(create).toHaveBeenCalledWith(projectCreationDirectory, "Recreated")
  expect(stops[1]).toHaveBeenCalledTimes(1)
  expect(watchProject).toHaveBeenCalledTimes(3)
  expect(onActivated).not.toHaveBeenCalled()

  dispose()
})

test("touches project recency through a trusted lifecycle channel and returns the refreshed ordering", async () => {
  let projects = [project("one"), project("two")]
  const touch = mock(async (projectId: string) => {
    const current = projects.find((candidate) => candidate.id === projectId)
    if (!current) throw new Error(`Project was not found: ${projectId}`)
    const touched = { ...current, lastOpenedAt: 3 }
    projects = [touched, ...projects.filter((candidate) => candidate.id !== projectId)]
    return touched
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
    list: async () => projects,
    listDirectory: unsupported,
    moveEntries: unsupported,
    readFile: unsupported,
    readFileInfo: unsupported,
    readTextFile: unsupported,
    readTextPreview: unsupported,
    rename: unsupported,
    renameEntry: unsupported,
    resolveEntryPath: unsupported,
    touch,
    watchProject: () => () => undefined,
    writeTextFile: unsupported,
  } satisfies DesktopProjectManager

  const { projectIpcChannels, registerProjectIpc } = await import("./project-ipc")
  const onActivated = mock(async (_project: ProjectRecord) => undefined)
  const dispose = await registerProjectIpc(manager, {
    isTrustedSender: () => true,
    onActivated,
    projectCreationDirectory,
  })

  await expect(invoke(projectIpcChannels.touchProject, { projectId: "two" })).resolves.toEqual({
    project: { ...project("two"), lastOpenedAt: 3 },
    projects: [{ ...project("two"), lastOpenedAt: 3 }, project("one")],
  })
  expect(touch).toHaveBeenCalledWith("two")
  expect(onActivated).toHaveBeenCalledWith(expect.objectContaining({ id: "two" }))

  dispose()
})
