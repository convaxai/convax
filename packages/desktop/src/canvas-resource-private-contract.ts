export const canvasResourcePartialFailureKind = "canvas-resource-partial-failure" as const
export const canvasTextResourceConflictKind = "canvas-text-resource-conflict" as const

export interface CanvasResourcePartialFailureResponse {
  kind: typeof canvasResourcePartialFailureKind
  retainedLabels: readonly string[]
}

export interface CanvasTextResourceConflictResponse {
  actualRevision: string | null
  kind: typeof canvasTextResourceConflictKind
}

export function isCanvasTextResourceConflictResponse(value: unknown): value is CanvasTextResourceConflictResponse {
  if (!isRecord(value) || value.kind !== canvasTextResourceConflictKind) return false
  return value.actualRevision === null || isSha256(value.actualRevision)
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

export function isCanvasResourcePartialFailureResponse(value: unknown): value is CanvasResourcePartialFailureResponse {
  if (!isRecord(value) || Object.keys(value).length !== 2) return false
  if (value.kind !== canvasResourcePartialFailureKind || !Array.isArray(value.retainedLabels)) return false
  return (
    value.retainedLabels.length > 0 &&
    value.retainedLabels.every(
      (label) =>
        typeof label === "string" &&
        label.startsWith("Notes/") &&
        label.endsWith(".md") &&
        label.length > "Notes/.md".length &&
        label.slice("Notes/".length, -".md".length).length > 0 &&
        !label.slice("Notes/".length).includes("/"),
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
