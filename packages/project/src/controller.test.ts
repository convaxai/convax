import { describe, expect, mock, test } from "bun:test"
import type {
  ProjectCanvas,
  ProjectChangeEvent,
  ProjectClient,
  ProjectDirectoryListing,
  ProjectEntry,
  ProjectMutationResult,
  ProjectRecord,
  ProjectWorkspace,
} from "./contracts"
import { ProjectController } from "./controller"

const projects: ProjectRecord[] = [
  { createdAt: 1, id: "one", lastOpenedAt: 2, name: "One", rootPath: "/one" },
  { createdAt: 1, id: "two", lastOpenedAt: 1, name: "Two", rootPath: "/two" },
]

function canvas(id: string, name = id): ProjectCanvas {
  return { createdAt: 1, id, name, updatedAt: 1 }
}

function workspace(projectId: string, activeCanvasId = `${projectId}-main`, canvases = [canvas(activeCanvasId)]): ProjectWorkspace {
  return { activeCanvasId, canvases, projectId }
}

function entry(path: string, kind: ProjectEntry["kind"] = "file"): ProjectEntry {
  const segments = path.split("/")
  return {
    kind,
    modifiedAt: 1,
    name: segments.at(-1) ?? path,
    parentPath: segments.slice(0, -1).join("/"),
    path,
  }
}

function listing(projectId: string, path: string, entries: ProjectEntry[]): ProjectDirectoryListing {
  return { entries, path, projectId }
}

function createClient(overrides: Partial<ProjectClient> = {}) {
  let changeListener: ((event: ProjectChangeEvent) => void) | undefined
  const client: ProjectClient = {
    activateCanvas: mock(async (input) => workspace(input.projectId, input.canvasId)),
    copyEntries: mock(async (input: Parameters<ProjectClient["copyEntries"]>[0]): Promise<ProjectMutationResult> => ({
      affectedPaths: input.paths,
      operation: "copy",
      projectId: input.projectId,
      sourcePaths: input.paths,
      targetPaths: input.paths.map((path) => `${input.destinationPath}/${path.split("/").at(-1)}`),
    })),
    createEntry: mock(async (input: Parameters<ProjectClient["createEntry"]>[0]): Promise<ProjectMutationResult> => ({ affectedPaths: [input.name], operation: "create", projectId: input.projectId, targetPaths: [input.name] })),
    createCanvas: mock(async (input) => {
      const created = canvas(`${input.projectId}-created`, input.name ?? "Untitled")
      return {
        canvas: created,
        workspace: workspace(input.projectId, `${input.projectId}-main`, [canvas(`${input.projectId}-main`), created]),
      }
    }),
    createProject: mock(async () => ({ canceled: true, projects })),
    createImportToken: (file) => `import:${file.name}`,
    deleteEntries: mock(async (input: Parameters<ProjectClient["deleteEntries"]>[0]): Promise<ProjectMutationResult> => ({ affectedPaths: input.paths, operation: "delete", projectId: input.projectId, sourcePaths: input.paths })),
    deleteCanvas: mock(async (input) => ({ deleted: true, workspace: workspace(input.projectId) })),
    forgetProject: mock(async () => ({ projects, removed: false })),
    importEntries: mock(async (input: Parameters<ProjectClient["importEntries"]>[0]): Promise<ProjectMutationResult> => ({
      affectedPaths: input.sourceTokens,
      operation: "import",
      projectId: input.projectId,
      targetPaths: input.sourceTokens.map((token) => token.replace(/^import:/, "assets/")),
    })),
    getWorkspace: mock(async (input) => workspace(input.projectId)),
    listDirectory: mock(async (input) => listing(input.projectId, input.path ?? "", [])),
    listProjects: mock(async () => ({ projects })),
    moveEntries: mock(async (input: Parameters<ProjectClient["moveEntries"]>[0]): Promise<ProjectMutationResult> => ({
      affectedPaths: input.paths,
      operation: "move",
      projectId: input.projectId,
      sourcePaths: input.paths,
      targetPaths: input.paths.map((path) => `${input.destinationPath}/${path.split("/").at(-1)}`),
    })),
    onDidChange: (listener) => {
      changeListener = listener
      return () => { changeListener = undefined }
    },
    openEntry: mock(async () => ({})),
    openProject: mock(async () => ({ canceled: true, projects })),
    readFile: mock(async (input) => ({ dataUrl: "data:text/plain;base64,", mimeType: "text/plain", name: input.path, path: input.path, size: 0 })),
    readFileInfo: mock(async (input) => ({ mimeType: "text/plain", name: input.path, path: input.path, size: 0 })),
    readCanvasDocument: mock(async () => ({ content: "", exists: false, path: "" })),
    readTextPreview: mock(async (input) => ({ content: "", path: input.path, truncated: false })),
    readTextFile: mock(async (input) => ({ content: "", exists: false, path: input.path })),
    renameEntry: mock(async (input: Parameters<ProjectClient["renameEntry"]>[0]): Promise<ProjectMutationResult> => ({ affectedPaths: [input.path], operation: "rename", projectId: input.projectId, targetPaths: [input.name] })),
    renameCanvas: mock(async (input) => {
      const renamed = canvas(input.canvasId, input.name)
      return { canvas: renamed, workspace: workspace(input.projectId, input.canvasId, [renamed]) }
    }),
    renameProject: mock(async (input) => ({ project: projects[0]!, projects })),
    revealEntry: mock(async () => undefined),
    writeTextFile: mock(async (input: Parameters<ProjectClient["writeTextFile"]>[0]): Promise<ProjectMutationResult> => ({ affectedPaths: [input.path], operation: "write", projectId: input.projectId, targetPaths: [input.path] })),
    writeCanvasDocument: mock(async (input: Parameters<ProjectClient["writeCanvasDocument"]>[0]): Promise<ProjectMutationResult> => ({ affectedPaths: [input.canvasId], operation: "write", projectId: input.projectId, targetPaths: [input.canvasId] })),
    ...overrides,
  }
  return { client, emit: (event: ProjectChangeEvent) => changeListener?.(event) }
}

describe("ProjectController", () => {
  test("initializes the latest project and lazily expands directories", async () => {
    const { client } = createClient({
      listDirectory: mock(async (input) => input.path === "assets"
        ? listing(input.projectId, "assets", [entry("assets/a.png"), entry("assets/b.png")])
        : listing(input.projectId, "", [entry("assets", "directory"), entry("readme.md")])) ,
    })
    const controller = new ProjectController(client)
    await controller.initialize()
    expect(controller.getSnapshot().activeProjectId).toBe("one")
    expect(controller.getSnapshot().activeCanvasId).toBe("one-main")
    expect(controller.getSnapshot().canvases.map((item) => item.id)).toEqual(["one-main"])
    expect(Object.keys(controller.getSnapshot().listings)).toEqual([""])

    await controller.toggleDirectory("assets")
    expect(controller.getSnapshot().expandedPaths).toEqual(["assets"])
    expect(controller.getSnapshot().listings.assets?.entries).toHaveLength(2)
    controller.selectEntry("assets/a.png", { range: false, toggle: false })
    controller.selectEntry("readme.md", { range: true, toggle: false })
    expect(controller.getSnapshot().selectedPaths).toEqual(["assets/a.png", "assets/b.png", "readme.md"])
    controller.dispose()
  })

  test("restores the active canvas recorded for each project", async () => {
    const oneCanvases = [canvas("one-main"), canvas("one-storyboard")]
    const twoCanvases = [canvas("two-main"), canvas("two-review")]
    const { client } = createClient({
      getWorkspace: mock(async ({ projectId }) => projectId === "one"
        ? workspace("one", "one-storyboard", oneCanvases)
        : workspace("two", "two-review", twoCanvases)),
    })
    const controller = new ProjectController(client)
    await controller.initialize()
    expect(controller.getSnapshot().activeCanvasId).toBe("one-storyboard")

    await controller.activate("two")
    expect(controller.getSnapshot().activeProjectId).toBe("two")
    expect(controller.getSnapshot().activeCanvasId).toBe("two-review")
    expect(controller.getSnapshot().canvases).toEqual(twoCanvases)
    controller.dispose()
  })

  test("does not let a stale directory response overwrite a newly active project", async () => {
    let resolveFirst: ((value: ProjectDirectoryListing) => void) | undefined
    const firstListing = new Promise<ProjectDirectoryListing>((resolve) => { resolveFirst = resolve })
    const { client } = createClient({
      listDirectory: mock(async (input) => input.projectId === "one"
        ? firstListing
        : listing("two", "", [entry("two.txt")])) ,
    })
    const controller = new ProjectController(client)
    const initializing = controller.initialize()
    await Promise.resolve()
    await Promise.resolve()
    await controller.activate("two")
    resolveFirst?.(listing("one", "", [entry("stale.txt")]))
    await initializing

    expect(controller.getSnapshot().activeProjectId).toBe("two")
    expect(controller.getSnapshot().listings[""]?.entries.map((item) => item.name)).toEqual(["two.txt"])
    controller.dispose()
  })

  test("does not let a stale workspace response overwrite a newly active project", async () => {
    let resolveFirst: ((value: ProjectWorkspace) => void) | undefined
    const firstWorkspace = new Promise<ProjectWorkspace>((resolve) => { resolveFirst = resolve })
    const { client } = createClient({
      getWorkspace: mock(async ({ projectId }) => projectId === "one"
        ? firstWorkspace
        : workspace("two", "two-current", [canvas("two-current")])) ,
    })
    const controller = new ProjectController(client)
    const initializing = controller.initialize()
    while (controller.getSnapshot().activeProjectId !== "one") await Promise.resolve()

    await controller.activate("two")
    resolveFirst?.(workspace("one", "one-stale", [canvas("one-stale")]))
    await initializing

    expect(controller.getSnapshot().activeProjectId).toBe("two")
    expect(controller.getSnapshot().activeCanvasId).toBe("two-current")
    expect(controller.getSnapshot().canvases.map((item) => item.id)).toEqual(["two-current"])
    controller.dispose()
  })

  test("converts dropped browser files into explicit import source paths", async () => {
    const importEntries = mock(async (input: Parameters<ProjectClient["importEntries"]>[0]) => ({
      affectedPaths: ["photo.png"],
      operation: "import" as const,
      projectId: input.projectId,
      targetPaths: ["assets/photo.png"],
    }))
    const { client } = createClient({ importEntries })
    const controller = new ProjectController(client)
    await controller.initialize()
    await controller.importDroppedFiles([new File(["image"], "photo.png")], "assets")

    expect(importEntries).toHaveBeenCalledWith({
      destinationPath: "assets",
      projectId: "one",
      sourceTokens: ["import:photo.png"],
    })
    expect(controller.getSnapshot().selectedPaths).toEqual(["assets/photo.png"])
    controller.dispose()
  })

  test("reconciles a forget response against the project active when it resolves", async () => {
    let resolveForget: ((value: { projects: ProjectRecord[]; removed: boolean }) => void) | undefined
    const forgetResult = new Promise<{ projects: ProjectRecord[]; removed: boolean }>((resolve) => { resolveForget = resolve })
    const { client } = createClient({
      forgetProject: mock(async () => forgetResult),
      listDirectory: mock(async (input) => listing(input.projectId, "", [entry(`${input.projectId}.txt`)])),
    })
    const controller = new ProjectController(client)
    await controller.initialize()

    const forgetting = controller.forgetProject("two")
    await controller.activate("two")
    resolveForget?.({ projects: [projects[0]!], removed: true })
    await forgetting

    expect(controller.getSnapshot().activeProjectId).toBe("one")
    expect(controller.getSnapshot().projects.map((project) => project.id)).toEqual(["one"])
    expect(controller.getSnapshot().listings[""]?.projectId).toBe("one")
    controller.dispose()
  })

  test("reloads a collapsed directory when it is expanded again", async () => {
    let assetLoads = 0
    const { client } = createClient({
      listDirectory: mock(async (input) => {
        if (input.path !== "assets") return listing(input.projectId, "", [entry("assets", "directory")])
        assetLoads += 1
        return listing(input.projectId, "assets", [entry(`assets/${assetLoads}.txt`)])
      }),
    })
    const controller = new ProjectController(client)
    await controller.initialize()
    await controller.toggleDirectory("assets")
    await controller.toggleDirectory("assets")
    await controller.toggleDirectory("assets")

    expect(assetLoads).toBe(2)
    expect(controller.getSnapshot().listings.assets?.entries[0]?.name).toBe("2.txt")
    controller.dispose()
  })

  test("does not apply a completed mutation after switching projects", async () => {
    let resolveCreate: ((value: ProjectMutationResult) => void) | undefined
    const createResult = new Promise<ProjectMutationResult>((resolve) => { resolveCreate = resolve })
    const { client } = createClient({
      createEntry: mock(async () => createResult),
      listDirectory: mock(async (input) => listing(input.projectId, "", [entry(`${input.projectId}.txt`)])),
    })
    const controller = new ProjectController(client)
    await controller.initialize()
    const creating = controller.createEntry({ kind: "file", name: "late.txt" })
    await controller.activate("two")
    resolveCreate?.({ affectedPaths: ["late.txt"], operation: "create", projectId: "one", targetPaths: ["late.txt"] })
    await creating

    expect(controller.getSnapshot().activeProjectId).toBe("two")
    expect(controller.getSnapshot().selectedPaths).toEqual([])
    expect(controller.getSnapshot().listings[""]?.projectId).toBe("two")
    controller.dispose()
  })

  test("waits for the active project transition guard before switching", async () => {
    let release: (() => void) | undefined
    const pendingSave = new Promise<void>((resolve) => { release = resolve })
    const beforeActiveProjectChange = mock(async (currentProjectId: string | null, nextProjectId: string | null) => {
      if (currentProjectId === "one" && nextProjectId === "two") await pendingSave
    })
    const { client } = createClient()
    const controller = new ProjectController(client, { beforeActiveProjectChange })
    await controller.initialize()

    const switching = controller.activate("two")
    await Promise.resolve()
    expect(controller.getSnapshot().activeProjectId).toBe("one")
    expect(controller.getSnapshot().changingActiveProject).toBe(true)

    release?.()
    await switching
    expect(controller.getSnapshot().activeProjectId).toBe("two")
    expect(controller.getSnapshot().changingActiveProject).toBe(false)
    controller.dispose()
  })

  test("keeps the current project mounted when its transition guard fails", async () => {
    const onActiveProjectChangeCanceled = mock(() => undefined)
    const { client } = createClient()
    const controller = new ProjectController(client, {
      beforeActiveProjectChange: async (currentProjectId, nextProjectId) => {
        if (currentProjectId === "one" && nextProjectId === "two") throw new Error("Canvas is not saved")
      },
      onActiveProjectChangeCanceled,
    })
    await controller.initialize()
    await controller.activate("two")

    expect(controller.getSnapshot().activeProjectId).toBe("one")
    expect(controller.getSnapshot().changingActiveProject).toBe(false)
    expect(controller.getSnapshot().error).toBe("Canvas is not saved")
    expect(onActiveProjectChangeCanceled).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  test("waits for the active canvas transition guard before switching", async () => {
    let release: (() => void) | undefined
    const pendingSave = new Promise<void>((resolve) => { release = resolve })
    const canvases = [canvas("one-main"), canvas("one-secondary")]
    const activateCanvas = mock(async (input: Parameters<ProjectClient["activateCanvas"]>[0]) => (
      workspace(input.projectId, input.canvasId, canvases)
    ))
    const beforeActiveCanvasChange = mock(async (_projectId: string, currentCanvasId: string | null, nextCanvasId: string | null) => {
      if (currentCanvasId === "one-main" && nextCanvasId === "one-secondary") await pendingSave
    })
    const { client } = createClient({
      activateCanvas,
      getWorkspace: mock(async () => workspace("one", "one-main", canvases)),
    })
    const controller = new ProjectController(client, { beforeActiveCanvasChange })
    await controller.initialize()

    const switching = controller.activateCanvas("one-secondary")
    await Promise.resolve()
    expect(controller.getSnapshot().activeCanvasId).toBe("one-main")
    expect(controller.getSnapshot().changingActiveCanvas).toBe(true)
    expect(activateCanvas).not.toHaveBeenCalled()

    release?.()
    await switching
    expect(activateCanvas).toHaveBeenCalledWith({ canvasId: "one-secondary", projectId: "one" })
    expect(controller.getSnapshot().activeCanvasId).toBe("one-secondary")
    expect(controller.getSnapshot().changingActiveCanvas).toBe(false)
    controller.dispose()
  })

  test("keeps the current canvas mounted when its transition guard fails", async () => {
    const canvases = [canvas("one-main"), canvas("one-secondary")]
    const activateCanvas = mock(async (input: Parameters<ProjectClient["activateCanvas"]>[0]) => (
      workspace(input.projectId, input.canvasId, canvases)
    ))
    const onActiveCanvasChangeCanceled = mock(() => undefined)
    const { client } = createClient({
      activateCanvas,
      getWorkspace: mock(async () => workspace("one", "one-main", canvases)),
    })
    const controller = new ProjectController(client, {
      beforeActiveCanvasChange: async () => { throw new Error("Canvas is not saved") },
      onActiveCanvasChangeCanceled,
    })
    await controller.initialize()
    await controller.activateCanvas("one-secondary")

    expect(activateCanvas).not.toHaveBeenCalled()
    expect(controller.getSnapshot().activeCanvasId).toBe("one-main")
    expect(controller.getSnapshot().changingActiveCanvas).toBe(false)
    expect(controller.getSnapshot().error).toBe("Canvas is not saved")
    expect(onActiveCanvasChangeCanceled).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  test("rolls back a newly created canvas when the transition guard fails", async () => {
    let current = workspace("one", "one-main", [canvas("one-main", "Main")])
    const deleteCanvas = mock(async (input: Parameters<ProjectClient["deleteCanvas"]>[0]) => {
      current = workspace(input.projectId, "one-main", current.canvases.filter((item) => item.id !== input.canvasId))
      return { deleted: true, workspace: current }
    })
    const { client } = createClient({
      createCanvas: mock(async (input) => {
        const created = canvas("one-draft", input.name ?? "Untitled")
        current = workspace(input.projectId, current.activeCanvasId, [...current.canvases, created])
        return { canvas: created, workspace: current }
      }),
      deleteCanvas,
      getWorkspace: mock(async () => current),
    })
    const controller = new ProjectController(client, {
      beforeActiveCanvasChange: async () => { throw new Error("Canvas is not saved") },
    })
    await controller.initialize()
    await controller.createCanvas("Draft")

    expect(deleteCanvas).toHaveBeenCalledWith({ canvasId: "one-draft", projectId: "one" })
    expect(controller.getSnapshot().canvases.map((item) => item.id)).toEqual(["one-main"])
    expect(controller.getSnapshot().activeCanvasId).toBe("one-main")
    expect(controller.getSnapshot().error).toBe("Canvas is not saved")
    controller.dispose()
  })

  test("creates, activates, renames, and deletes canvases through the workspace boundary", async () => {
    let current = workspace("one", "one-main", [canvas("one-main", "Main")])
    const createCanvas = mock(async (input: Parameters<ProjectClient["createCanvas"]>[0]) => {
      const created = canvas("one-notes", input.name ?? "Untitled")
      current = workspace("one", current.activeCanvasId, [...current.canvases, created])
      return { canvas: created, workspace: current }
    })
    const activateCanvas = mock(async (input: Parameters<ProjectClient["activateCanvas"]>[0]) => {
      current = workspace(input.projectId, input.canvasId, current.canvases)
      return current
    })
    const renameCanvas = mock(async (input: Parameters<ProjectClient["renameCanvas"]>[0]) => {
      const renamed = { ...current.canvases.find((item) => item.id === input.canvasId)!, name: input.name }
      current = workspace(input.projectId, current.activeCanvasId, current.canvases.map((item) => item.id === input.canvasId ? renamed : item))
      return { canvas: renamed, workspace: current }
    })
    const deleteCanvas = mock(async (input: Parameters<ProjectClient["deleteCanvas"]>[0]) => {
      const remaining = current.canvases.filter((item) => item.id !== input.canvasId)
      current = workspace(input.projectId, remaining[0]!.id, remaining)
      return { deleted: true, workspace: current }
    })
    const beforeActiveCanvasChange = mock(async () => undefined)
    const { client } = createClient({
      activateCanvas,
      createCanvas,
      deleteCanvas,
      getWorkspace: mock(async () => current),
      renameCanvas,
    })
    const controller = new ProjectController(client, { beforeActiveCanvasChange })
    await controller.initialize()

    await controller.createCanvas("  Notes  ")
    expect(createCanvas).toHaveBeenCalledWith({ name: "Notes", projectId: "one" })
    expect(controller.getSnapshot().activeCanvasId).toBe("one-notes")
    await controller.renameCanvas("one-notes", "  Ideas  ")
    expect(controller.getSnapshot().canvases.find((item) => item.id === "one-notes")?.name).toBe("Ideas")
    await controller.deleteCanvas("one-notes")
    expect(controller.getSnapshot().activeCanvasId).toBe("one-main")
    expect(controller.getSnapshot().canvases.map((item) => item.id)).toEqual(["one-main"])
    expect(beforeActiveCanvasChange).toHaveBeenNthCalledWith(1, "one", "one-main", "one-notes")
    expect(beforeActiveCanvasChange).toHaveBeenNthCalledWith(2, "one", "one-notes", "one-main")
    controller.dispose()
  })

  test("refreshes canvas state on workspace change events", async () => {
    let current = workspace("one", "one-main", [canvas("one-main")])
    const { client, emit } = createClient({ getWorkspace: mock(async () => current) })
    const controller = new ProjectController(client)
    await controller.initialize()

    current = workspace("one", "one-review", [canvas("one-main"), canvas("one-review")])
    emit({ kind: "workspace", projectId: "one" })
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(controller.getSnapshot().activeCanvasId).toBe("one-review")
    expect(controller.getSnapshot().canvases).toEqual(current.canvases)
    controller.dispose()
  })

  test("ignores a workspace event refresh that resolves after switching projects", async () => {
    let resolveRefresh: ((value: ProjectWorkspace) => void) | undefined
    const pendingRefresh = new Promise<ProjectWorkspace>((resolve) => { resolveRefresh = resolve })
    let oneRequests = 0
    const { client, emit } = createClient({
      getWorkspace: mock(async ({ projectId }) => {
        if (projectId === "two") return workspace("two", "two-main")
        oneRequests += 1
        return oneRequests === 1 ? workspace("one", "one-main") : pendingRefresh
      }),
    })
    const controller = new ProjectController(client)
    await controller.initialize()

    emit({ kind: "workspace", projectId: "one" })
    await new Promise((resolve) => setTimeout(resolve, 130))
    await controller.activate("two")
    resolveRefresh?.(workspace("one", "one-stale"))
    await pendingRefresh

    expect(controller.getSnapshot().activeProjectId).toBe("two")
    expect(controller.getSnapshot().activeCanvasId).toBe("two-main")
    controller.dispose()
  })

  test("flushes the active canvas before forgetting its project", async () => {
    let release: (() => void) | undefined
    const pendingSave = new Promise<void>((resolve) => { release = resolve })
    const forgetProject = mock(async () => ({ projects: [projects[1]!], removed: true }))
    const { client } = createClient({ forgetProject })
    const controller = new ProjectController(client, {
      beforeActiveProjectChange: async (currentProjectId, nextProjectId) => {
        if (currentProjectId === "one" && nextProjectId === null) await pendingSave
      },
    })
    await controller.initialize()

    const forgetting = controller.forgetProject("one")
    await Promise.resolve()
    expect(forgetProject).not.toHaveBeenCalled()
    expect(controller.getSnapshot().changingActiveProject).toBe(true)

    release?.()
    await forgetting
    expect(forgetProject).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot().activeProjectId).toBe("two")
    expect(controller.getSnapshot().changingActiveProject).toBe(false)
    controller.dispose()
  })

  test("resumes the active canvas when forgetting its project fails", async () => {
    const onActiveProjectChangeCanceled = mock(() => undefined)
    const { client } = createClient({
      forgetProject: mock(async () => { throw new Error("Registry is read-only") }),
    })
    const controller = new ProjectController(client, { onActiveProjectChangeCanceled })
    await controller.initialize()
    await controller.forgetProject("one")

    expect(controller.getSnapshot().activeProjectId).toBe("one")
    expect(controller.getSnapshot().changingActiveProject).toBe(false)
    expect(controller.getSnapshot().error).toBe("Registry is read-only")
    expect(onActiveProjectChangeCanceled).toHaveBeenCalledTimes(1)
    controller.dispose()
  })
})
