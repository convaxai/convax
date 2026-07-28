export type WorkspaceLayoutTier = "wide" | "medium" | "small"
export type WorkspacePanelPresentation = "hidden" | "dock" | "overlay" | "sheet"

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
}

/**
 * Desktop-owned viewport policy. Workbench remains responsible only for generic
 * part visibility and resize state; this model decides how visible parts present.
 */
export function resolveWorkspaceLayout(input: WorkspaceLayoutInput): WorkspaceLayoutModel {
  const viewportWidth = Number.isFinite(input.viewportWidth) && input.viewportWidth >= 0 ? input.viewportWidth : 0
  const tier: WorkspaceLayoutTier = viewportWidth >= 1360 ? "wide" : viewportWidth >= 900 ? "medium" : "small"

  const projectSidebar: WorkspacePanelPresentation = input.projectSidebarVisible ? "dock" : "hidden"
  const agent: WorkspacePanelPresentation = !input.agentVisible
    ? "hidden"
    : tier === "small"
      ? "sheet"
      : tier === "medium"
        ? "overlay"
        : "dock"

  return {
    agent,
    canvasHasFullWidth: projectSidebar !== "dock" && agent !== "dock",
    projectSidebar,
    tier,
  }
}
