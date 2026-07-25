import { describe, expect, mock, test } from "bun:test"
import type { ProjectCanvas, ProjectCanvasControllerSnapshot } from "@convax/project/canvas"
import type { ProjectFilesControllerSnapshot } from "@convax/project-files"
import { WorkbenchController } from "@convax/workbench"
import {
  ProjectCanvasWorkbenchCoordinator,
  projectCanvasInput,
  resolveSelectedProjectCanvasRelinkSource,
  runProjectCanvasResourceRelink,
  type ProjectCanvasCatalogControllerPort,
} from "./project-canvas-workbench"

function canvas(id: string): ProjectCanvas {
  return { createdAt: 1, id, name: id, updatedAt: 1 }
}

function catalogHarness(initial = [canvas("canvas-one"), canvas("canvas-two")]) {
  let snapshot: ProjectCanvasControllerSnapshot = {
    busy: false,
    canvases: initial,
    error: null,
    projectId: "project-one",
  }
  const events: string[] = []
  const controller: ProjectCanvasCatalogControllerPort = {
    async createCanvas() {
      const created = canvas("canvas-created")
      snapshot = { ...snapshot, canvases: [...snapshot.canvases, created] }
      events.push(`create:${created.id}`)
      return created
    },
    async deleteCanvas(canvasId) {
      snapshot = { ...snapshot, canvases: snapshot.canvases.filter((item) => item.id !== canvasId) }
      events.push(`delete:${canvasId}`)
      return true
    },
    getSnapshot: () => snapshot,
  }
  return {
    controller,
    events,
    setCanvases(canvases: ProjectCanvas[]) {
      snapshot = { ...snapshot, canvases }
    },
  }
}

describe("Project Canvas Workbench coordination", () => {
  test("captures the selected Project resource before waiting for a slow Canvas flush", async () => {
    let snapshot: ProjectFilesControllerSnapshot = {
      error: null,
      expandedPaths: [],
      listings: {
        "": {
          entries: [
            { kind: "file", modifiedAt: 1, name: "first.png", parentPath: "", path: "first.png", size: 1 },
            { kind: "file", modifiedAt: 2, name: "later.png", parentPath: "", path: "later.png", size: 2 },
          ],
          path: "",
          projectId: "project-one",
        },
      },
      loadingPaths: [],
      projectId: "project-one",
      selectedPaths: ["first.png"],
    }
    let releaseFlush!: () => void
    let markFlushStarted!: () => void
    const flushStarted = new Promise<void>((resolve) => {
      markFlushStarted = resolve
    })
    const flushBarrier = new Promise<void>((resolve) => {
      releaseFlush = resolve
    })
    const flush = mock(async () => {
      markFlushStarted()
      await flushBarrier
    })
    const relink = mock(async (input: unknown) => ({ input, revision: 8, warnings: [] }))

    const operation = runProjectCanvasResourceRelink({
      activeCanvasId: "canvas-one",
      activeProjectId: "project-one",
      createCommandId: () => "renderer:relink",
      flush,
      projectFiles: { getSnapshot: () => snapshot },
      request: {
        expectedRevision: 7,
        nodeId: "missing-image",
        signal: new AbortController().signal,
      },
      resources: { createLocalFileToken: mock(), relink },
    })
    await flushStarted
    snapshot = { ...snapshot, selectedPaths: ["later.png"] }
    releaseFlush()
    await operation

    expect(relink).toHaveBeenCalledWith({
      canvasId: "canvas-one",
      commandId: "renderer:relink",
      expectedRevision: 7,
      nodeId: "missing-image",
      source: { kind: "host-file", path: "first.png" },
    })
  })

  test("rejects an invalid Project selection before flushing or invoking relink IPC", async () => {
    const flush = mock(async () => undefined)
    const relink = mock(async () => ({ revision: 8, warnings: [] }))

    await expect(
      runProjectCanvasResourceRelink({
        activeCanvasId: "canvas-one",
        activeProjectId: "project-one",
        createCommandId: () => "renderer:relink",
        flush,
        projectFiles: {
          getSnapshot: () => ({
            error: null,
            expandedPaths: [],
            listings: {},
            loadingPaths: [],
            projectId: "project-one",
            selectedPaths: [],
          }),
        },
        request: {
          expectedRevision: 7,
          nodeId: "missing-image",
          signal: new AbortController().signal,
        },
        resources: { createLocalFileToken: mock(), relink },
      }),
    ).rejects.toThrow("Select exactly one Project file or directory")
    expect(flush).not.toHaveBeenCalled()
    expect(relink).not.toHaveBeenCalled()
  })

  test("maps one live selected Project file or directory to a portable relink source", () => {
    const snapshot: ProjectFilesControllerSnapshot = {
      error: null,
      expandedPaths: ["Media"],
      listings: {
        "": {
          entries: [{ kind: "directory", modifiedAt: 1, name: "Media", parentPath: "", path: "Media" }],
          path: "",
          projectId: "project-one",
        },
        Media: {
          entries: [
            { kind: "file", modifiedAt: 2, name: "clip.mp4", parentPath: "Media", path: "Media/clip.mp4", size: 3 },
          ],
          path: "Media",
          projectId: "project-one",
        },
      },
      loadingPaths: [],
      projectId: "project-one",
      selectedPaths: ["Media/clip.mp4"],
    }
    const input = (next: Partial<ProjectFilesControllerSnapshot> = {}) => ({
      activeProjectId: "project-one",
      projectFiles: { getSnapshot: () => ({ ...snapshot, ...next }) },
    })

    expect(resolveSelectedProjectCanvasRelinkSource(input())).toEqual({ kind: "host-file", path: "Media/clip.mp4" })
    expect(resolveSelectedProjectCanvasRelinkSource(input({ selectedPaths: ["Media"] }))).toEqual({
      kind: "host-directory",
      path: "Media",
    })
    expect(() => resolveSelectedProjectCanvasRelinkSource(input({ selectedPaths: [] }))).toThrow(
      "Select exactly one Project file or directory",
    )
    expect(() => resolveSelectedProjectCanvasRelinkSource(input({ projectId: "project-two" }))).toThrow(
      "active Project",
    )
  })

  test("restores a valid preference and falls back when that Canvas disappears", async () => {
    const catalog = catalogHarness()
    const workbench = new WorkbenchController()
    workbench.setProject("project-one")
    const coordinator = new ProjectCanvasWorkbenchCoordinator(catalog.controller, workbench)

    expect(await coordinator.reconcile("project-one", "canvas-two")).toBe(true)
    expect(workbench.getSnapshot().activeInput).toEqual(projectCanvasInput("project-one", "canvas-two"))

    catalog.setCanvases([canvas("canvas-one")])
    expect(await coordinator.reconcile("project-one", "canvas-two")).toBe(true)
    expect(workbench.getSnapshot().activeInput).toEqual(projectCanvasInput("project-one", "canvas-one"))
  })

  test("opens a Canvas even when the Workbench currently shows a file", async () => {
    const catalog = catalogHarness()
    const workbench = new WorkbenchController()
    workbench.setProject("project-one", { kind: "file", path: "notes.md", projectId: "project-one" })
    const coordinator = new ProjectCanvasWorkbenchCoordinator(catalog.controller, workbench)

    expect(await coordinator.openCanvas("project-one", "canvas-one")).toBe(true)
    expect(workbench.getSnapshot().surface.kind).toBe("canvas")
  })

  test("rolls a created Canvas back when the Workbench cannot leave its current input", async () => {
    const catalog = catalogHarness()
    const workbench = new WorkbenchController({
      beforeInputChange(_current, next) {
        if (next?.kind === "canvas" && next.canvasId === "canvas-created") throw new Error("save failed")
      },
    })
    workbench.setProject("project-one", projectCanvasInput("project-one", "canvas-one"))
    const coordinator = new ProjectCanvasWorkbenchCoordinator(catalog.controller, workbench)

    expect(await coordinator.createCanvas("project-one")).toBeUndefined()
    expect(catalog.events).toEqual(["create:canvas-created", "delete:canvas-created"])
    expect(workbench.getSnapshot().activeInput).toEqual(projectCanvasInput("project-one", "canvas-one"))
  })

  test("switches and flushes the active Canvas before deleting it", async () => {
    const events: string[] = []
    const catalog = catalogHarness()
    const originalDelete = catalog.controller.deleteCanvas
    catalog.controller.deleteCanvas = async (canvasId) => {
      events.push(`delete:${canvasId}`)
      return originalDelete(canvasId)
    }
    const workbench = new WorkbenchController({
      beforeInputChange(current, next) {
        events.push(
          `leave:${current?.kind === "canvas" ? current.canvasId : "none"}->${next?.kind === "canvas" ? next.canvasId : "none"}`,
        )
      },
    })
    workbench.setProject("project-one", projectCanvasInput("project-one", "canvas-one"))
    const coordinator = new ProjectCanvasWorkbenchCoordinator(catalog.controller, workbench)

    expect(await coordinator.deleteCanvas("project-one", "canvas-one")).toBe(true)
    expect(events).toEqual(["leave:canvas-one->canvas-two", "delete:canvas-one"])
    expect(workbench.getSnapshot().activeInput).toEqual(projectCanvasInput("project-one", "canvas-two"))
  })
})
