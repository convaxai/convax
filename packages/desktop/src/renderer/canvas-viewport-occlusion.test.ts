import { describe, expect, test } from "bun:test"
import { resolveWorkspaceCanvasViewportInsets } from "./canvas-viewport-occlusion"

describe("Desktop Canvas viewport occlusion adapter", () => {
  test("passes overlay geometry without utility or Agent identity", () => {
    expect(
      resolveWorkspaceCanvasViewportInsets({
        presentation: "overlay",
        projectSidebarOverlaySize: 240,
        utilityPanelSize: 380,
        utilityVisible: true,
        viewportWidth: 1440,
      }),
    ).toEqual({ left: 252, right: 412 })
  })

  test("keeps Project overlay insets while modal utilities add no right inset", () => {
    const base = {
      projectSidebarOverlaySize: 240,
      utilityPanelSize: 380,
      utilityVisible: true,
      viewportWidth: 1440,
    }
    expect(resolveWorkspaceCanvasViewportInsets({ ...base, presentation: "sheet" })).toEqual({ left: 252 })
    expect(resolveWorkspaceCanvasViewportInsets({ ...base, presentation: "overlay", utilityVisible: false })).toEqual({
      left: 252,
    })
  })

  test("keeps separated dock utilities out of Canvas-owned insets", () => {
    expect(
      resolveWorkspaceCanvasViewportInsets({
        presentation: "dock",
        projectSidebarOverlaySize: 0,
        utilityPanelSize: 380,
        utilityVisible: true,
        viewportWidth: 1440,
      }),
    ).toEqual({})
  })

  test("preserves a minimum navigable Canvas peek for oversized overlays", () => {
    expect(
      resolveWorkspaceCanvasViewportInsets({
        presentation: "overlay",
        projectSidebarOverlaySize: 300,
        utilityPanelSize: 1200,
        utilityVisible: true,
        viewportWidth: 1000,
      }),
    ).toEqual({ left: 312, right: 528 })
  })
})
