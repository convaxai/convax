import { describe, expect, test } from "bun:test"
import { resolveWorkspaceLayout, workspaceShellMetrics } from "./workspace-layout-model"

describe("workspace layout policy", () => {
  test("keeps a wide Canvas full width when optional panels are closed", () => {
    expect(
      resolveWorkspaceLayout({
        agentVisible: false,
        projectSidebarVisible: false,
        viewportWidth: 1600,
      }),
    ).toEqual({
      agent: "hidden",
      canvasHasFullWidth: true,
      projectSidebar: "hidden",
      tier: "wide",
      utilityPresentation: "overlay",
    })
  })

  test("keeps the restored Project sidebar docked while the wide Agent floats", () => {
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectSidebarVisible: true,
        viewportWidth: 1440,
      }),
    ).toMatchObject({
      agent: "overlay",
      canvasHasFullWidth: false,
      projectSidebar: "dock",
      tier: "wide",
      utilityPresentation: "overlay",
    })
  })

  test("floats Project navigation below the wide tier so Canvas keeps its working width", () => {
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectSidebarVisible: true,
        viewportWidth: 1100,
      }),
    ).toMatchObject({
      agent: "overlay",
      canvasHasFullWidth: true,
      projectSidebar: "overlay",
      tier: "medium",
      utilityPresentation: "overlay",
    })
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectSidebarVisible: true,
        viewportWidth: 720,
      }),
    ).toMatchObject({
      agent: "sheet",
      canvasHasFullWidth: true,
      projectSidebar: "overlay",
      tier: "small",
      utilityPresentation: "sheet",
    })
  })

  test("switches utility presentation at the exact responsive boundaries", () => {
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectSidebarVisible: false,
        viewportWidth: 899,
      }).utilityPresentation,
    ).toBe("sheet")
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectSidebarVisible: false,
        viewportWidth: 900,
      }).utilityPresentation,
    ).toBe("overlay")
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectSidebarVisible: false,
        viewportWidth: 1359,
      }).utilityPresentation,
    ).toBe("overlay")
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectSidebarVisible: false,
        viewportWidth: 1360,
      }).utilityPresentation,
    ).toBe("overlay")
  })

  test("switches the Project sidebar between overlay and dock at the wide boundary", () => {
    expect(
      resolveWorkspaceLayout({
        agentVisible: false,
        projectSidebarVisible: true,
        viewportWidth: 1359,
      }).projectSidebar,
    ).toBe("overlay")
    expect(
      resolveWorkspaceLayout({
        agentVisible: false,
        projectSidebarVisible: true,
        viewportWidth: 1360,
      }).projectSidebar,
    ).toBe("dock")
  })

  test("keeps the responsive utility presentation available while the drawer is closed", () => {
    expect(
      resolveWorkspaceLayout({
        agentVisible: false,
        projectSidebarVisible: false,
        viewportWidth: 1100,
      }),
    ).toMatchObject({
      agent: "hidden",
      utilityPresentation: "overlay",
    })
  })

  test("publishes the Desktop-owned shell measurements", () => {
    expect(workspaceShellMetrics).toMatchObject({
      primarySidebar: { defaultSize: 240, maxSize: 480, minSize: 220 },
      utilityOverlayInset: 16,
      utilitySidebar: { defaultSize: 380 },
    })
  })

  test("normalizes non-finite and negative widths to the small policy", () => {
    for (const viewportWidth of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(
        resolveWorkspaceLayout({
          agentVisible: false,
          projectSidebarVisible: true,
          viewportWidth,
        }).tier,
      ).toBe("small")
    }
  })
})
