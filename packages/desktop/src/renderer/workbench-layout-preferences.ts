import { WorkbenchLayoutParts, type WorkbenchLayoutSnapshot } from "@convax/workbench"

const layoutPreferenceKey = "convax.workbench.layout.v1"
const legacyAgentPanelOpenKey = "convax:agent-panel:open"
const legacyAgentPanelWidthKey = "convax:agent-panel:width"

export interface WorkbenchLayoutPreferenceBounds {
  primarySidebar: { defaultSize: number; defaultVisible: boolean; maxSize: number; minSize: number }
  secondarySidebar: { defaultSize: number; defaultVisible: boolean; maxSize: number; minSize: number }
}

export interface WorkbenchLayoutPreferences {
  primarySidebar: { size: number; visible: boolean }
  secondarySidebar: { size: number; visible: boolean }
}

interface StoredWorkbenchLayout {
  parts?: Record<string, { size?: unknown; visible?: unknown }>
  version?: unknown
}

export function readWorkbenchLayoutPreferences(
  storage: Pick<Storage, "getItem">,
  bounds: WorkbenchLayoutPreferenceBounds,
): WorkbenchLayoutPreferences {
  const stored = readStoredLayout(storage)
  const primary = stored?.parts?.[WorkbenchLayoutParts.PrimarySidebar]
  const secondary = stored?.parts?.[WorkbenchLayoutParts.SecondarySidebar]
  const legacyWidth = numberValue(storage.getItem(legacyAgentPanelWidthKey))
  const legacyOpen = storage.getItem(legacyAgentPanelOpenKey)
  return {
    primarySidebar: {
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
) {
  const primary = snapshot.parts[WorkbenchLayoutParts.PrimarySidebar]
  const secondary = snapshot.parts[WorkbenchLayoutParts.SecondarySidebar]
  if (!primary || !secondary) return false
  try {
    storage.setItem(layoutPreferenceKey, JSON.stringify({
      parts: {
        [WorkbenchLayoutParts.PrimarySidebar]: { size: primary.size, visible: primary.visible },
        [WorkbenchLayoutParts.SecondarySidebar]: { size: secondary.size, visible: secondary.visible },
      },
      version: 1,
    }))
    return true
  } catch {
    return false
  }
}

function readStoredLayout(storage: Pick<Storage, "getItem">): StoredWorkbenchLayout | null {
  try {
    const raw = storage.getItem(layoutPreferenceKey)
    if (!raw) return null
    const value = JSON.parse(raw) as StoredWorkbenchLayout
    return value && typeof value === "object" && value.version === 1 ? value : null
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
