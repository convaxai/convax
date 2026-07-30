import type { CanvasViewportInsets } from "@convax/canvas"
import { workspaceShellMetrics, type WorkspaceVisiblePanelPresentation } from "./workspace-layout-model"

/**
 * Converts Desktop layout into geometry only. Canvas never learns which utility
 * owns the overlay; it receives only the unavailable viewport edge.
 */
export function resolveWorkspaceCanvasViewportInsets(input: {
  presentation: WorkspaceVisiblePanelPresentation
  primarySidebarSize: number
  utilityPanelSize: number
  utilityVisible: boolean
  viewportWidth: number
}): CanvasViewportInsets {
  if (!input.utilityVisible || input.presentation !== "overlay") return {}
  const canvasWidth = Math.max(0, normalize(input.viewportWidth) - normalize(input.primarySidebarSize))
  const unavailableRight = normalize(input.utilityPanelSize) + workspaceShellMetrics.utilityOverlayInset * 2
  return {
    right: Math.min(unavailableRight, Math.max(0, canvasWidth - workspaceShellMetrics.minimumCanvasPeekSize)),
  }
}

function normalize(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0
}
