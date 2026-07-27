export type WorkspaceUtilityMode = "agent" | "closed" | "generate" | "inspector"

export type WorkspaceUtilityDrawerState =
  | { mode: "closed" }
  | { mode: "agent"; projectId: string }
  | { canvasId: string; mode: "generate"; projectId: string }
  | { canvasId: string; mode: "inspector"; projectId: string; selectionKey: string }

export interface WorkspaceUtilityScope {
  canvasId?: string
  projectId?: string
}

export const closedWorkspaceUtilityDrawer: WorkspaceUtilityDrawerState = { mode: "closed" }

export function openAgentUtility(projectId: string): WorkspaceUtilityDrawerState {
  return projectId ? { mode: "agent", projectId } : closedWorkspaceUtilityDrawer
}

export function openGenerateUtility(scope: Required<WorkspaceUtilityScope>): WorkspaceUtilityDrawerState {
  return scope.projectId && scope.canvasId
    ? { canvasId: scope.canvasId, mode: "generate", projectId: scope.projectId }
    : closedWorkspaceUtilityDrawer
}

export function openInspectorUtility(
  scope: Required<WorkspaceUtilityScope>,
  selectionKey: string,
): WorkspaceUtilityDrawerState {
  return scope.projectId && scope.canvasId && selectionKey
    ? { canvasId: scope.canvasId, mode: "inspector", projectId: scope.projectId, selectionKey }
    : closedWorkspaceUtilityDrawer
}

/**
 * Reconciles product presentation with the authoritative Project/Canvas scope.
 * Agent survives Canvas switches within its Project; Canvas utilities do not.
 */
export function reconcileWorkspaceUtilityDrawer(
  state: WorkspaceUtilityDrawerState,
  scope: WorkspaceUtilityScope,
): WorkspaceUtilityDrawerState {
  if (state.mode === "closed") return state
  if (!scope.projectId || state.projectId !== scope.projectId) return closedWorkspaceUtilityDrawer
  if (state.mode === "agent") return state
  if (!scope.canvasId || state.canvasId !== scope.canvasId) return closedWorkspaceUtilityDrawer
  return state
}
