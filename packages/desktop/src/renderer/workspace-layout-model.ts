export type WorkspaceLayoutTier = "wide" | "medium" | "small"
export type WorkspacePanelPresentation = "hidden" | "dock" | "overlay" | "sheet"
export type WorkspaceVisiblePanelPresentation = Exclude<WorkspacePanelPresentation, "hidden">

export const workspaceShellMetrics = {
  minimumCanvasPeekSize: 160,
  primarySidebar: { defaultSize: 240, defaultVisible: true, maxSize: 480, minSize: 220 },
  sidebarOverlayInset: 12,
  titlebarHeight: 44,
  utilityOverlayInset: 16,
  utilitySidebar: { defaultSize: 380, defaultVisible: false, maxSize: 4096, minSize: 300 },
} as const

export interface WorkspaceLayoutInput {
  agentVisible: boolean
  projectSidebarVisible: boolean
  viewportWidth: number
}

export interface WorkspaceLayoutModel {
  agent: WorkspacePanelPresentation
  canvasHasFullWidth: boolean
  projectSidebar: WorkspacePanelPresentation
  tier: WorkspaceLayoutTier
  utilityPresentation: WorkspaceVisiblePanelPresentation
}

/**
 * Desktop-owned viewport policy. Workbench remains responsible only for generic
 * part visibility and resize state; this model decides how visible parts present.
 */
export function resolveWorkspaceLayout(input: WorkspaceLayoutInput): WorkspaceLayoutModel {
  const viewportWidth = Number.isFinite(input.viewportWidth) && input.viewportWidth >= 0 ? input.viewportWidth : 0
  const tier: WorkspaceLayoutTier = viewportWidth >= 1360 ? "wide" : viewportWidth >= 900 ? "medium" : "small"
  const utilityPresentation: WorkspaceVisiblePanelPresentation = tier === "small" ? "sheet" : "dock"

  const projectSidebar: WorkspacePanelPresentation = input.projectSidebarVisible ? "dock" : "hidden"
  const agent: WorkspacePanelPresentation = input.agentVisible ? utilityPresentation : "hidden"

  return {
    agent,
    canvasHasFullWidth: projectSidebar !== "dock",
    projectSidebar,
    tier,
    utilityPresentation,
  }
}
