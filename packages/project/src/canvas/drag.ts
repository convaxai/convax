import type { ProjectCanvas } from "./contracts"

export const PROJECT_CANVAS_DRAG_TYPE = "application/x-convax-project-canvas"

export interface ProjectCanvasDragPayload {
  canvas: Pick<ProjectCanvas, "id" | "name">
  projectId: string
  version: 1
}

export function serializeProjectCanvasDrag(payload: ProjectCanvasDragPayload) {
  return JSON.stringify(payload)
}

export function parseProjectCanvasDrag(value: string): ProjectCanvasDragPayload | null {
  try {
    const parsed = JSON.parse(value) as Partial<ProjectCanvasDragPayload>
    if (
      parsed.version !== 1
      || typeof parsed.projectId !== "string"
      || !parsed.canvas
      || typeof parsed.canvas.id !== "string"
      || typeof parsed.canvas.name !== "string"
    ) return null
    return { canvas: { id: parsed.canvas.id, name: parsed.canvas.name }, projectId: parsed.projectId, version: 1 }
  } catch {
    return null
  }
}
