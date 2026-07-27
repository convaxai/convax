import { describe, expect, test } from "bun:test"
import type { CanvasSelectionProjection } from "@convax/canvas"
import { WorkbenchController } from "@convax/workbench"
import { publishCanvasSelectionToWorkbench } from "./canvas-workbench-selection"

function projection(overrides: Partial<CanvasSelectionProjection> = {}): CanvasSelectionProjection {
  return {
    documentId: "canvas-1",
    inspector: null,
    kind: "single-node",
    nodeIds: ["node-1"],
    revision: 1,
    scopeId: "project-1",
    viewId: "desktop-main",
    ...overrides,
  }
}

describe("Canvas to Workbench selection adapter", () => {
  test("publishes node selection only to the matching active Canvas input", async () => {
    const controller = new WorkbenchController()
    controller.setProject("project-1")
    await controller.open({ canvasId: "canvas-1", kind: "canvas", projectId: "project-1" })

    expect(
      publishCanvasSelectionToWorkbench({
        activeCanvasId: "canvas-1",
        activeProjectId: "project-1",
        controller,
        expectedViewId: "desktop-main",
        projection: projection(),
      }),
    ).toBe(true)
    expect(controller.getSnapshot().selection?.selection).toEqual({
      kind: "canvas-nodes",
      nodeIds: ["node-1"],
    })
  })

  test("ignores a late projection from the previous Canvas", async () => {
    const controller = new WorkbenchController()
    controller.setProject("project-1")
    await controller.open({ canvasId: "canvas-2", kind: "canvas", projectId: "project-1" })

    expect(
      publishCanvasSelectionToWorkbench({
        activeCanvasId: "canvas-2",
        activeProjectId: "project-1",
        controller,
        expectedViewId: "desktop-main",
        projection: projection(),
      }),
    ).toBe(false)
    expect(controller.getSnapshot().selection).toBeNull()
  })

  test("clears Workbench selection when Canvas publishes no nodes", async () => {
    const controller = new WorkbenchController()
    const input = { canvasId: "canvas-1", kind: "canvas", projectId: "project-1" } as const
    controller.setProject("project-1")
    await controller.open(input)
    controller.setSelection(input, { kind: "canvas-nodes", nodeIds: ["node-1"] })

    publishCanvasSelectionToWorkbench({
      activeCanvasId: "canvas-1",
      activeProjectId: "project-1",
      controller,
      expectedViewId: "desktop-main",
      projection: projection({ kind: "none", nodeIds: [] }),
    })

    expect(controller.getSnapshot().selection).toBeNull()
  })

  test("ignores a late projection from a replaced view of the same Canvas", async () => {
    const controller = new WorkbenchController()
    controller.setProject("project-1")
    await controller.open({ canvasId: "canvas-1", kind: "canvas", projectId: "project-1" })

    expect(
      publishCanvasSelectionToWorkbench({
        activeCanvasId: "canvas-1",
        activeProjectId: "project-1",
        controller,
        expectedViewId: "desktop-main",
        projection: projection({ viewId: "stale-view" }),
      }),
    ).toBe(false)
    expect(controller.getSnapshot().selection).toBeNull()
  })
})
