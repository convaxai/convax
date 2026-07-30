import { describe, expect, test } from "bun:test"
import {
  closedWorkspaceUtilityDrawer,
  openAgentUtility,
  openInspectorUtility,
  reconcileWorkspaceUtilityDrawer,
} from "./workspace-utility-drawer-state"

describe("workspace utility drawer state", () => {
  test("opens exactly one explicit utility mode", () => {
    expect(openAgentUtility("project-1")).toEqual({ mode: "agent", projectId: "project-1" })
    expect(openInspectorUtility({ canvasId: "canvas-1", projectId: "project-1" }, "node:one")).toEqual({
      canvasId: "canvas-1",
      mode: "inspector",
      projectId: "project-1",
      selectionKey: "node:one",
    })
  })

  test("fails closed when required scope is absent", () => {
    expect(openAgentUtility("")).toEqual(closedWorkspaceUtilityDrawer)
    expect(openInspectorUtility({ canvasId: "canvas-1", projectId: "project-1" }, "")).toEqual(
      closedWorkspaceUtilityDrawer,
    )
  })

  test("keeps Agent across Canvas changes but closes Canvas-scoped modes", () => {
    expect(
      reconcileWorkspaceUtilityDrawer(openAgentUtility("project-1"), {
        canvasId: "canvas-2",
        projectId: "project-1",
      }),
    ).toEqual(openAgentUtility("project-1"))
    expect(
      reconcileWorkspaceUtilityDrawer(
        openInspectorUtility({ canvasId: "canvas-1", projectId: "project-1" }, "node:one"),
        {
          canvasId: "canvas-2",
          projectId: "project-1",
        },
      ),
    ).toEqual(closedWorkspaceUtilityDrawer)
  })

  test("closes every scoped mode when Project changes", () => {
    expect(
      reconcileWorkspaceUtilityDrawer(openAgentUtility("project-1"), {
        canvasId: "canvas-1",
        projectId: "project-2",
      }),
    ).toEqual(closedWorkspaceUtilityDrawer)
  })
})
