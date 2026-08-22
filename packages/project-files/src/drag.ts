import type { ProjectEntry } from "./contracts"

export const PROJECT_ENTRY_DRAG_TYPE = "application/x-convax-project-entry"

export interface ProjectEntryDragPresentation {
  intrinsicHeight: number
  intrinsicWidth: number
  mediaKind: "audio" | "image" | "video"
  thumbnailDataUrl: string
}

export interface ProjectEntryDragEntry extends Pick<ProjectEntry, "kind" | "name" | "path"> {
  /** Renderer-only hint. Project/Main remains the resource and geometry authority. */
  presentation?: ProjectEntryDragPresentation
}

export interface ProjectEntryDragPayload {
  entries: ProjectEntryDragEntry[]
  projectId: string
  version: 1
}

const maximumDragEntries = 128
const maximumEntryNameCharacters = 512
const maximumEntryPathCharacters = 32 * 1024
const maximumProjectIdCharacters = 512
const maximumIntrinsicDimension = 1_000_000
const maximumThumbnailDataUrlCharacters = 256 * 1024
const maximumDragPayloadCharacters = 512 * 1024

export function serializeProjectEntryDrag(payload: ProjectEntryDragPayload) {
  const normalized = normalizeProjectEntryDragPayload(payload)
  if (!normalized || exceedsDragPayloadBudget(normalized)) {
    throw new Error("Project entry drag payload exceeds its bounded contract")
  }
  const value = JSON.stringify(normalized)
  if (value.length > maximumDragPayloadCharacters) {
    throw new Error("Project entry drag payload exceeds its bounded contract")
  }
  return value
}

export function parseProjectEntryDrag(value: string): ProjectEntryDragPayload | null {
  if (value.length > maximumDragPayloadCharacters) return null
  try {
    return normalizeProjectEntryDragPayload(JSON.parse(value))
  } catch {
    return null
  }
}

function normalizeProjectEntryDragPayload(value: unknown): ProjectEntryDragPayload | null {
  if (!value || typeof value !== "object") return null
  const parsed = value as Partial<ProjectEntryDragPayload>
  if (
    parsed.version !== 1 ||
    !boundedString(parsed.projectId, maximumProjectIdCharacters) ||
    !Array.isArray(parsed.entries) ||
    parsed.entries.length > maximumDragEntries
  )
    return null
  const entries = parsed.entries.flatMap<ProjectEntryDragEntry>((entry) => {
    if (
      !entry ||
      (entry.kind !== "directory" && entry.kind !== "file") ||
      !boundedString(entry.name, maximumEntryNameCharacters) ||
      !boundedString(entry.path, maximumEntryPathCharacters)
    )
      return []
    const presentation = entry.kind === "file" ? parsePresentation(entry.presentation) : null
    return [
      {
        kind: entry.kind,
        name: entry.name,
        path: entry.path,
        ...(presentation ? { presentation } : {}),
      },
    ]
  })
  if (entries.length === 0) return null
  return { entries, projectId: parsed.projectId, version: 1 }
}

function exceedsDragPayloadBudget(payload: ProjectEntryDragPayload) {
  let characters = payload.projectId.length + 64
  for (const entry of payload.entries) {
    characters += entry.name.length + entry.path.length + 64
    characters += entry.presentation?.thumbnailDataUrl.length ?? 0
    if (characters > maximumDragPayloadCharacters) return true
  }
  return false
}

function parsePresentation(value: unknown): ProjectEntryDragPresentation | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as Partial<ProjectEntryDragPresentation>
  if (
    (candidate.mediaKind !== "audio" && candidate.mediaKind !== "image" && candidate.mediaKind !== "video") ||
    !boundedDimension(candidate.intrinsicWidth) ||
    !boundedDimension(candidate.intrinsicHeight) ||
    !validThumbnailDataUrl(candidate.thumbnailDataUrl)
  )
    return null
  return {
    intrinsicHeight: candidate.intrinsicHeight,
    intrinsicWidth: candidate.intrinsicWidth,
    mediaKind: candidate.mediaKind,
    thumbnailDataUrl: candidate.thumbnailDataUrl,
  }
}

function boundedString(value: unknown, maximumCharacters: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumCharacters
}

function boundedDimension(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= maximumIntrinsicDimension
}

function validThumbnailDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximumThumbnailDataUrlCharacters &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
}
