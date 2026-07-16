const lastCanvasPreferenceKey = "convax.workbench.last-canvas.v1"

export interface WorkbenchPreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function readPreferenceMap(storage: WorkbenchPreferenceStorage) {
  try {
    const value = JSON.parse(storage.getItem(lastCanvasPreferenceKey) ?? "{}")
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

export function readLastCanvasPreference(storage: WorkbenchPreferenceStorage, projectId: string) {
  const value = readPreferenceMap(storage)[projectId]
  return typeof value === "string" && value ? value : undefined
}

export function migrateLastCanvasPreference(
  storage: WorkbenchPreferenceStorage,
  projectId: string,
  legacyCanvasId?: string,
) {
  const current = readLastCanvasPreference(storage, projectId)
  if (current || !legacyCanvasId) return current
  writeLastCanvasPreference(storage, projectId, legacyCanvasId)
  return legacyCanvasId
}

export function writeLastCanvasPreference(
  storage: WorkbenchPreferenceStorage,
  projectId: string,
  canvasId: string,
) {
  if (!projectId || !canvasId) return false
  const value = readPreferenceMap(storage)
  value[projectId] = canvasId
  try {
    storage.setItem(lastCanvasPreferenceKey, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
