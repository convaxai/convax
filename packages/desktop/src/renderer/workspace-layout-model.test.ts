import { describe, expect, test } from "bun:test"
import { resolveWorkspaceLayout } from "./workspace-layout-model"

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
    })
  })

  test("keeps the restored Project sidebar docked on the left", () => {
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
    })
  })

  test("keeps Project navigation on the left while adapting the Agent panel", () => {
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectSidebarVisible: true,
        viewportWidth: 1100,
      }),
    ).toMatchObject({
      agent: "overlay",
      canvasHasFullWidth: false,
      projectSidebar: "dock",
      tier: "medium",
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
