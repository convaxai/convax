import type { ProjectCanvas, ProjectEntry } from "./contracts"

export const PROJECT_CANVAS_DRAG_TYPE = "application/x-convax-project-canvas"
export const PROJECT_ENTRY_DRAG_TYPE = "application/x-convax-project-entry"

export interface ProjectCanvasDragPayload {
  canvas: Pick<ProjectCanvas, "id" | "name">
  projectId: string
  version: 1
}

export interface ProjectEntryDragPayload {
  entries: Array<Pick<ProjectEntry, "kind" | "name" | "path">>
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

export function serializeProjectEntryDrag(payload: ProjectEntryDragPayload) {
  return JSON.stringify(payload)
}

export function parseProjectEntryDrag(value: string): ProjectEntryDragPayload | null {
  try {
    const parsed = JSON.parse(value) as Partial<ProjectEntryDragPayload>
    if (parsed.version !== 1 || typeof parsed.projectId !== "string" || !Array.isArray(parsed.entries)) return null
    const entries = parsed.entries.filter((entry): entry is ProjectEntryDragPayload["entries"][number] =>
      Boolean(
        entry
        && (entry.kind === "directory" || entry.kind === "file")
        && typeof entry.name === "string"
        && typeof entry.path === "string",
      ))
    if (entries.length === 0) return null
    return { entries, projectId: parsed.projectId, version: 1 }
  } catch {
    return null
  }
}
