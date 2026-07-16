import { describe, expect, test } from "bun:test"
import type { ProjectCanvas, ProjectCanvasControllerSnapshot } from "@convax/project/canvas"
import { WorkbenchController } from "@convax/workbench"
import {
  ProjectCanvasWorkbenchCoordinator,
  projectCanvasInput,
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
    workbenchPreferenceMigration: null,
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
        events.push(`leave:${current?.kind === "canvas" ? current.canvasId : "none"}->${next?.kind === "canvas" ? next.canvasId : "none"}`)
      },
    })
    workbench.setProject("project-one", projectCanvasInput("project-one", "canvas-one"))
    const coordinator = new ProjectCanvasWorkbenchCoordinator(catalog.controller, workbench)

    expect(await coordinator.deleteCanvas("project-one", "canvas-one")).toBe(true)
    expect(events).toEqual(["leave:canvas-one->canvas-two", "delete:canvas-one"])
    expect(workbench.getSnapshot().activeInput).toEqual(projectCanvasInput("project-one", "canvas-two"))
  })
})
