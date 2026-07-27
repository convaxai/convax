import { WorkbenchLayoutParts, type WorkbenchLayoutSnapshot } from "@convax/workbench"

const layoutPreferenceKey = "convax.workbench.layout.v2"
const legacyLayoutPreferenceKey = "convax.workbench.layout.v1"
const legacyAgentPanelOpenKey = "convax:agent-panel:open"
const legacyAgentPanelWidthKey = "convax:agent-panel:width"

export interface WorkbenchLayoutPreferenceBounds {
  primarySidebar: { defaultSize: number; defaultVisible: boolean; maxSize: number; minSize: number }
  secondarySidebar: { defaultSize: number; defaultVisible: boolean; maxSize: number; minSize: number }
}

export interface WorkbenchLayoutPreferences {
  primarySidebar: { pinned: boolean; size: number; visible: boolean }
  secondarySidebar: { size: number; visible: boolean }
}

interface StoredWorkbenchLayout {
  parts?: Record<string, { pinned?: unknown; size?: unknown; visible?: unknown }>
  version?: unknown
}

export function readWorkbenchLayoutPreferences(
  storage: Pick<Storage, "getItem">,
  bounds: WorkbenchLayoutPreferenceBounds,
): WorkbenchLayoutPreferences {
  const stored = readStoredLayout(storage, layoutPreferenceKey, 2)
  const legacyStored = stored ? null : readStoredLayout(storage, legacyLayoutPreferenceKey, 1)
  const source = stored ?? legacyStored
  const primary = source?.parts?.[WorkbenchLayoutParts.PrimarySidebar]
  const secondary = source?.parts?.[WorkbenchLayoutParts.SecondarySidebar]
  const legacyWidth = numberValue(safeGetItem(storage, legacyAgentPanelWidthKey))
  const legacyOpen = safeGetItem(storage, legacyAgentPanelOpenKey)
  return {
    primarySidebar: {
      pinned: stored
        ? primary?.pinned === true
        : legacyStored
          ? primary?.visible === true
          : false,
      size: clampSize(primary?.size, bounds.primarySidebar),
      visible: typeof primary?.visible === "boolean" ? primary.visible : bounds.primarySidebar.defaultVisible,
    },
    secondarySidebar: {
      size: clampSize(secondary?.size ?? legacyWidth, bounds.secondarySidebar),
      visible: typeof secondary?.visible === "boolean"
        ? secondary.visible
        : legacyOpen === null
          ? bounds.secondarySidebar.defaultVisible
          : legacyOpen !== "false",
    },
  }
}

export function writeWorkbenchLayoutPreferences(
  storage: Pick<Storage, "setItem">,
  snapshot: WorkbenchLayoutSnapshot,
  options: { projectDetailsPinned: boolean } = {
    projectDetailsPinned: snapshot.parts[WorkbenchLayoutParts.PrimarySidebar]?.visible ?? false,
  },
) {
  const primary = snapshot.parts[WorkbenchLayoutParts.PrimarySidebar]
  const secondary = snapshot.parts[WorkbenchLayoutParts.SecondarySidebar]
  if (!primary || !secondary) return false
  try {
    storage.setItem(layoutPreferenceKey, JSON.stringify({
      parts: {
        [WorkbenchLayoutParts.PrimarySidebar]: {
          pinned: options.projectDetailsPinned,
          size: primary.size,
          visible: primary.visible,
        },
        [WorkbenchLayoutParts.SecondarySidebar]: { size: secondary.size, visible: secondary.visible },
      },
      version: 2,
    }))
    return true
  } catch {
    return false
  }
}

function readStoredLayout(
  storage: Pick<Storage, "getItem">,
  key: string,
  version: number,
): StoredWorkbenchLayout | null {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.version !== version) return null
    const parts: StoredWorkbenchLayout["parts"] = {}
    if (isRecord(value.parts)) {
      for (const [partId, part] of Object.entries(value.parts)) {
        if (!isRecord(part)) continue
        parts[partId] = {
          pinned: part.pinned,
          size: part.size,
          visible: part.visible,
        }
      }
    }
    return { parts, version }
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeGetItem(storage: Pick<Storage, "getItem">, key: string) {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function clampSize(
  value: unknown,
  bounds: { defaultSize: number; maxSize: number; minSize: number },
) {
  const size = typeof value === "number" ? value : numberValue(value)
  if (size === null || !Number.isFinite(size)) return bounds.defaultSize
  return Math.min(bounds.maxSize, Math.max(bounds.minSize, size))
}

function numberValue(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
