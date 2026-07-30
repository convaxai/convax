import { describe, expect, test } from "bun:test"
import { resolveWorkspaceCanvasViewportInsets } from "./canvas-viewport-occlusion"

describe("Desktop Canvas viewport occlusion adapter", () => {
  test("passes overlay geometry without utility or Agent identity", () => {
    expect(
      resolveWorkspaceCanvasViewportInsets({
        presentation: "overlay",
        primarySidebarSize: 240,
        utilityPanelSize: 380,
        utilityVisible: true,
        viewportWidth: 1440,
      }),
    ).toEqual({ right: 412 })
  })

  test("keeps closed and modal utilities out of the mounted Canvas safe rectangle", () => {
    const base = {
      primarySidebarSize: 240,
      utilityPanelSize: 380,
      utilityVisible: true,
      viewportWidth: 1440,
    }
    expect(resolveWorkspaceCanvasViewportInsets({ ...base, presentation: "sheet" })).toEqual({})
    expect(resolveWorkspaceCanvasViewportInsets({ ...base, presentation: "overlay", utilityVisible: false })).toEqual(
      {},
    )
  })

  test("preserves a minimum navigable Canvas peek for oversized overlays", () => {
    expect(
      resolveWorkspaceCanvasViewportInsets({
        presentation: "overlay",
        primarySidebarSize: 300,
        utilityPanelSize: 1200,
        utilityVisible: true,
        viewportWidth: 1000,
      }),
    ).toEqual({ right: 540 })
  })
})
