import {
  matchesCanvasSelectionProjectionScope,
  type CanvasSelectionProjection,
} from "@convax/canvas"
import type { WorkbenchController } from "@convax/workbench"

export function publishCanvasSelectionToWorkbench(input: {
  activeCanvasId?: string
  activeProjectId?: string
  controller: WorkbenchController
  expectedViewId: string
  projection: CanvasSelectionProjection
}): boolean {
  const activeInput = input.controller.getSnapshot().activeInput
  if (
    activeInput?.kind !== "canvas" ||
    activeInput.projectId !== input.activeProjectId ||
    activeInput.canvasId !== input.activeCanvasId ||
    !matchesCanvasSelectionProjectionScope(input.projection, {
      documentId: activeInput.canvasId,
      scopeId: activeInput.projectId,
      viewId: input.expectedViewId,
    })
  ) {
    return false
  }

  input.controller.setSelection(
    activeInput,
    input.projection.nodeIds.length > 0
      ? { kind: "canvas-nodes", nodeIds: input.projection.nodeIds }
      : null,
  )
  return true
}
