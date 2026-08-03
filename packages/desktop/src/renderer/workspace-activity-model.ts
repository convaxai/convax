import {
  getCanvasNodeGenerationRun,
  isCanvasNodeGenerationRunActive,
  type CanvasDocument,
} from "@convax/canvas"

export interface WorkspaceActivitySummary {
  active: number
  attention: number
  total: number
}

export function summarizeWorkspaceCanvasActivity(
  document: CanvasDocument | null | undefined,
): WorkspaceActivitySummary {
  if (!document) return { active: 0, attention: 0, total: 0 }
  let active = 0
  let attention = 0
  for (const node of document.nodes) {
    const run = getCanvasNodeGenerationRun(node)
    if (!run) continue
    if (isCanvasNodeGenerationRunActive(run)) active += 1
    else if (run.status === "failed") attention += 1
  }
  return { active, attention, total: active + attention }
}
