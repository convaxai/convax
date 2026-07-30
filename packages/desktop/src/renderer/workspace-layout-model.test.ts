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
      utilityPresentation: "dock",
    })
  })

  test("docks both sidebars independently in a wide three-column workspace", () => {
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectSidebarVisible: true,
        viewportWidth: 1440,
      }),
    ).toMatchObject({
      agent: "dock",
      canvasHasFullWidth: false,
      projectSidebar: "dock",
      tier: "wide",
      utilityPresentation: "dock",
    })
  })

  test("keeps a pinned Project sidebar in layout while the utility adapts on small windows", () => {
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectSidebarVisible: true,
        viewportWidth: 1100,
      }),
    ).toMatchObject({
      agent: "dock",
      canvasHasFullWidth: false,
      projectSidebar: "dock",
      tier: "medium",
      utilityPresentation: "dock",
    })
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectSidebarVisible: true,
        viewportWidth: 720,
      }),
    ).toMatchObject({
      agent: "sheet",
      canvasHasFullWidth: false,
      projectSidebar: "dock",
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
    ).toBe("dock")
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectSidebarVisible: false,
        viewportWidth: 1359,
      }).utilityPresentation,
    ).toBe("dock")
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectSidebarVisible: false,
        viewportWidth: 1360,
      }).utilityPresentation,
    ).toBe("dock")
  })

  test("keeps click-pinned Project navigation docked at every responsive boundary", () => {
    expect(
      resolveWorkspaceLayout({
        agentVisible: false,
        projectSidebarVisible: true,
        viewportWidth: 1359,
      }).projectSidebar,
    ).toBe("dock")
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
      utilityPresentation: "dock",
    })
  })

  test("publishes the Desktop-owned shell measurements", () => {
    expect(workspaceShellMetrics).toMatchObject({
      primarySidebar: { defaultSize: 240, maxSize: 480, minSize: 220 },
      sidebarOverlayInset: 12,
      titlebarHeight: 44,
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
