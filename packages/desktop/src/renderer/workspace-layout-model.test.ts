import { describe, expect, test } from "bun:test"
import { resolveWorkspaceLayout } from "./workspace-layout-model"

describe("workspace layout policy", () => {
  test("keeps a wide Canvas full width when optional panels are closed", () => {
    expect(
      resolveWorkspaceLayout({
        agentVisible: false,
        projectDetailsPinned: false,
        projectDetailsVisible: false,
        viewportWidth: 1600,
      }),
    ).toEqual({
      agent: "hidden",
      canvasHasFullWidth: true,
      projectDetails: "hidden",
      tier: "wide",
    })
  })

  test("docks only explicitly pinned Project Details on wide viewports", () => {
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectDetailsPinned: true,
        projectDetailsVisible: true,
        viewportWidth: 1440,
      }),
    ).toMatchObject({
      agent: "dock",
      canvasHasFullWidth: false,
      projectDetails: "dock",
      tier: "wide",
    })
    expect(
      resolveWorkspaceLayout({
        agentVisible: false,
        projectDetailsPinned: false,
        projectDetailsVisible: true,
        viewportWidth: 1440,
      }).projectDetails,
    ).toBe("overlay")
  })

  test("uses temporary overlays at medium width and sheets at the minimum window width", () => {
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectDetailsPinned: true,
        projectDetailsVisible: true,
        viewportWidth: 1100,
      }),
    ).toMatchObject({
      agent: "overlay",
      canvasHasFullWidth: true,
      projectDetails: "overlay",
      tier: "medium",
    })
    expect(
      resolveWorkspaceLayout({
        agentVisible: true,
        projectDetailsPinned: true,
        projectDetailsVisible: true,
        viewportWidth: 720,
      }),
    ).toMatchObject({
      agent: "sheet",
      canvasHasFullWidth: true,
      projectDetails: "sheet",
      tier: "small",
    })
  })

  test("normalizes non-finite and negative widths to the small policy", () => {
    for (const viewportWidth of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(
        resolveWorkspaceLayout({
          agentVisible: false,
          projectDetailsPinned: false,
          projectDetailsVisible: true,
          viewportWidth,
        }).tier,
      ).toBe("small")
    }
  })
})
