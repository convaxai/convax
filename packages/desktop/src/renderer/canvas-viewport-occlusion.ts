import type { CanvasViewportInsets } from "@convax/canvas"
import { workspaceShellMetrics, type WorkspaceVisiblePanelPresentation } from "./workspace-layout-model"

/**
 * Converts Desktop layout into geometry only. Canvas never learns which utility
 * owns the overlay; it receives only the unavailable viewport edge.
 */
export function resolveWorkspaceCanvasViewportInsets(input: {
  presentation: WorkspaceVisiblePanelPresentation
  projectSidebarOverlaySize: number
  utilityPanelSize: number
  utilityVisible: boolean
  viewportWidth: number
}): CanvasViewportInsets {
  const left = normalize(input.projectSidebarOverlaySize)
    ? normalize(input.projectSidebarOverlaySize) + workspaceShellMetrics.sidebarOverlayInset
    : 0
  const canvasWidth = Math.max(0, normalize(input.viewportWidth))
  const unavailableRight =
    input.utilityVisible && input.presentation === "overlay"
      ? normalize(input.utilityPanelSize) + workspaceShellMetrics.utilityOverlayInset * 2
      : 0
  const right = unavailableRight
    ? Math.min(unavailableRight, Math.max(0, canvasWidth - left - workspaceShellMetrics.minimumCanvasPeekSize))
    : 0
  return {
    ...(left ? { left } : {}),
    ...(right ? { right } : {}),
  }
}

function normalize(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0
}
