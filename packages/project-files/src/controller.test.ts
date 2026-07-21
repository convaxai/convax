import { describe, expect, mock, test } from "bun:test"
import type {
  ProjectChangeEvent,
  ProjectDirectoryListing,
  ProjectEntry,
  ProjectFilesClient,
  ProjectMutationResult,
} from "./contracts"
import { ProjectFilesController } from "./controller"

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

function mutation(
  operation: ProjectMutationResult["operation"],
  projectId: string,
  sourcePaths: string[] = [],
  targetPaths: string[] = [],
): ProjectMutationResult {
  return {
    affectedPaths: [...sourcePaths, ...targetPaths],
    operation,
    projectId,
    sourcePaths,
    targetPaths,
  }
}

function createClient(overrides: Partial<ProjectFilesClient> = {}) {
  let changeListener: ((event: ProjectChangeEvent) => void) | undefined
  const client: ProjectFilesClient = {
    copyEntries: mock(async (input: Parameters<ProjectFilesClient["copyEntries"]>[0]) =>
      mutation("copy", input.projectId, input.paths),
    ),
    createEntry: mock(async (input: Parameters<ProjectFilesClient["createEntry"]>[0]) =>
      mutation("create", input.projectId, [], [input.parentPath ? `${input.parentPath}/${input.name}` : input.name]),
    ),
    createImportToken: (file: File) => `import:${file.name}`,
    deleteEntries: mock(async (input: Parameters<ProjectFilesClient["deleteEntries"]>[0]) =>
      mutation("delete", input.projectId, input.paths),
    ),
    importEntries: mock(async (input: Parameters<ProjectFilesClient["importEntries"]>[0]) =>
      mutation("import", input.projectId, input.sourceTokens, [
        `${input.destinationPath ?? ""}/imported.txt`.replace(/^\//, ""),
      ]),
    ),
    listDirectory: mock(async (input: Parameters<ProjectFilesClient["listDirectory"]>[0]) =>
      listing(input.projectId, input.path ?? "", []),
    ),
    moveEntries: mock(async (input: Parameters<ProjectFilesClient["moveEntries"]>[0]) =>
      mutation(
        "move",
        input.projectId,
        input.paths,
        input.paths.map((path) => `${input.destinationPath ?? ""}/${path.split("/").at(-1)}`.replace(/^\//, "")),
      ),
    ),
    onDidChange: (listener) => {
      changeListener = listener
      return () => {
        changeListener = undefined
      }
    },
    openEntry: mock(async () => ({})),
    readFile: mock(async (input: Parameters<ProjectFilesClient["readFile"]>[0]) => ({
      dataUrl: "data:text/plain;base64,",
      mimeType: "text/plain",
      name: input.path,
      path: input.path,
      size: 0,
    })),
    readFileInfo: mock(async (input: Parameters<ProjectFilesClient["readFileInfo"]>[0]) => ({
      mimeType: "text/plain",
      name: input.path,
      path: input.path,
      size: 0,
    })),
    readTextFile: mock(async (input: Parameters<ProjectFilesClient["readTextFile"]>[0]) => ({
      content: "",
      contentRevision: "",
      exists: false,
      path: input.path,
    })),
    readTextPreview: mock(async (input: Parameters<ProjectFilesClient["readTextPreview"]>[0]) => ({
      content: input.path,
      path: input.path,
      truncated: false,
    })),
    renameEntry: mock(async (input: Parameters<ProjectFilesClient["renameEntry"]>[0]) =>
      mutation("rename", input.projectId, [input.path], [input.path.replace(/[^/]+$/, input.name)]),
    ),
    revealEntry: mock(async () => undefined),
    writeTextFile: mock(async (input: Parameters<ProjectFilesClient["writeTextFile"]>[0]) =>
      mutation("write", input.projectId, [], [input.path]),
    ),
    ...overrides,
  }
  return {
    client,
    emit: (event: ProjectChangeEvent) => changeListener?.(event),
  }
}

describe("ProjectFilesController", () => {
  test("uses setProject as its only project boundary and ignores stale directory responses", async () => {
    let resolveFirst: ((value: ProjectDirectoryListing) => void) | undefined
    const firstListing = new Promise<ProjectDirectoryListing>((resolve) => {
      resolveFirst = resolve
    })
    const { client } = createClient({
      listDirectory: mock(async (input) =>
        input.projectId === "one" ? firstListing : listing("two", "", [entry("two.txt")]),
      ),
    })
    const controller = new ProjectFilesController(client)

    const firstProject = controller.setProject("one")
    await Promise.resolve()
    await controller.setProject("two")
    resolveFirst?.(listing("one", "", [entry("stale.txt")]))
    await firstProject

    expect(controller.getSnapshot().projectId).toBe("two")
    expect(controller.getSnapshot().listings[""]?.entries.map((item) => item.path)).toEqual(["two.txt"])

    await controller.setProject(null)
    expect(controller.getSnapshot()).toEqual({
      error: null,
      expandedPaths: [],
      listings: {},
      loadingPaths: [],
      projectId: null,
      selectedPaths: [],
    })
    controller.dispose()
  })

  test("owns directory expansion and visible range selection", async () => {
    const { client } = createClient({
      listDirectory: mock(async (input) =>
        input.path === "assets"
          ? listing(input.projectId, "assets", [entry("assets/a.png"), entry("assets/b.png")])
          : listing(input.projectId, "", [entry("assets", "directory"), entry("readme.md")]),
      ),
    })
    const controller = new ProjectFilesController(client)

    await controller.setProject("one")
    await controller.toggleDirectory("assets")
    controller.selectEntry("assets/a.png", { range: false, toggle: false })
    controller.selectEntry("readme.md", { range: true, toggle: false })

    expect(controller.getSnapshot().expandedPaths).toEqual(["assets"])
    expect(controller.getSnapshot().selectedPaths).toEqual(["assets/a.png", "assets/b.png", "readme.md"])
    controller.clearSelection()
    expect(controller.getSnapshot().selectedPaths).toEqual([])
    controller.dispose()
  })

  test("scopes mutations, imports, open, and reveal to the selected project", async () => {
    const createEntry = mock(async (input: Parameters<ProjectFilesClient["createEntry"]>[0]) =>
      mutation("create", input.projectId, [], ["notes.txt"]),
    )
    const moveEntries = mock(async (input: Parameters<ProjectFilesClient["moveEntries"]>[0]) =>
      mutation("move", input.projectId, input.paths, ["archive/folder"]),
    )
    const importEntries = mock(async (input: Parameters<ProjectFilesClient["importEntries"]>[0]) =>
      mutation("import", input.projectId, input.sourceTokens, ["assets/photo.png"]),
    )
    const openEntry = mock(async () => ({ error: "No default application" }))
    const revealEntry = mock(async () => undefined)
    const { client } = createClient({ createEntry, importEntries, moveEntries, openEntry, revealEntry })
    const controller = new ProjectFilesController(client)

    await controller.setProject("one")
    await controller.createEntry({ kind: "file", name: "notes.txt" })
    expect(createEntry).toHaveBeenCalledWith({ kind: "file", name: "notes.txt", parentPath: "", projectId: "one" })
    expect(controller.getSnapshot().selectedPaths).toEqual(["notes.txt"])

    await controller.moveEntries(["folder", "folder/child.txt"], "archive")
    expect(moveEntries).toHaveBeenCalledWith({ destinationPath: "archive", paths: ["folder"], projectId: "one" })

    await controller.importEntries(["token", "token", ""], "assets")
    expect(importEntries).toHaveBeenCalledWith({ destinationPath: "assets", projectId: "one", sourceTokens: ["token"] })

    await controller.revealEntry("assets/photo.png")
    expect(revealEntry).toHaveBeenCalledWith({ path: "assets/photo.png", projectId: "one" })
    await controller.openEntry("assets/photo.png")
    expect(openEntry).toHaveBeenCalledWith({ path: "assets/photo.png", projectId: "one" })
    expect(controller.getSnapshot().error).toBe("No default application")
    controller.clearError()
    expect(controller.getSnapshot().error).toBeNull()
    controller.dispose()
  })

  test("refreshes visible directories only for events from its selected project", async () => {
    let current = [entry("first.txt")]
    const listDirectory = mock(async (input: Parameters<ProjectFilesClient["listDirectory"]>[0]) =>
      listing(input.projectId, input.path ?? "", current),
    )
    const { client, emit } = createClient({ listDirectory })
    const controller = new ProjectFilesController(client)
    await controller.setProject("one")

    current = [entry("second.txt")]
    emit({ kind: "filesystem", projectId: "two" })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(controller.getSnapshot().listings[""]?.entries[0]?.path).toBe("first.txt")

    emit({ kind: "filesystem", projectId: "one" })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(controller.getSnapshot().listings[""]?.entries[0]?.path).toBe("second.txt")

    controller.dispose()
    current = [entry("after-dispose.txt")]
    emit({ kind: "mutation", projectId: "one" })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(controller.getSnapshot().listings[""]?.entries[0]?.path).toBe("second.txt")
  })
})
