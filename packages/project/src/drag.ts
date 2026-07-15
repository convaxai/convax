import type { ProjectEntry } from "./contracts"

export const PROJECT_ENTRY_DRAG_TYPE = "application/x-convax-project-entry"

export interface ProjectEntryDragPayload {
  entries: Array<Pick<ProjectEntry, "kind" | "name" | "path">>
  projectId: string
  version: 1
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
