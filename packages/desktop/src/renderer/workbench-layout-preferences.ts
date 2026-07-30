import { WorkbenchLayoutParts, type WorkbenchLayoutSnapshot } from "@convax/workbench"

export const currentWorkbenchLayoutPreferenceKey = "convax.workbench.layout.v3"
export const previousWorkbenchLayoutPreferenceKey = "convax.workbench.layout.v2"
const currentWorkbenchLayoutPreferenceVersion = 3
const legacyLayoutPreferenceKey = "convax.workbench.layout.v1"
const legacyAgentPanelOpenKey = "convax:agent-panel:open"
const legacyAgentPanelWidthKey = "convax:agent-panel:width"
const previousPrimarySidebarDefaultSize = 292

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
  const currentRaw = safeGetItem(storage, currentWorkbenchLayoutPreferenceKey)
  const current = parseStoredLayout(currentRaw, currentWorkbenchLayoutPreferenceVersion)
  const previous =
    currentRaw === null ? parseStoredLayout(safeGetItem(storage, previousWorkbenchLayoutPreferenceKey), 2) : null
  const legacy =
    currentRaw === null && previous === null
      ? parseStoredLayout(safeGetItem(storage, legacyLayoutPreferenceKey), 1)
      : null
  const sourceKind = currentRaw !== null ? "current" : previous ? "previous" : legacy ? "legacy" : "none"
  const source = current ?? previous ?? legacy
  const primary = source?.parts?.[WorkbenchLayoutParts.PrimarySidebar]
  const secondary = source?.parts?.[WorkbenchLayoutParts.SecondarySidebar]
  const legacyWidth = sourceKind === "none" ? numberValue(safeGetItem(storage, legacyAgentPanelWidthKey)) : null
  const legacyOpen = sourceKind === "none" ? safeGetItem(storage, legacyAgentPanelOpenKey) : null
  const primarySize =
    sourceKind === "previous" && primary?.size === previousPrimarySidebarDefaultSize
      ? bounds.primarySidebar.defaultSize
      : primary?.size
  return {
    primarySidebar: {
      pinned:
        sourceKind === "current" || sourceKind === "previous"
          ? primary?.pinned === true
          : sourceKind === "legacy"
            ? primary?.visible === true
            : false,
      size: clampSize(primarySize, bounds.primarySidebar),
      visible: typeof primary?.visible === "boolean" ? primary.visible : bounds.primarySidebar.defaultVisible,
    },
    secondarySidebar: {
      size: clampSize(secondary?.size ?? legacyWidth, bounds.secondarySidebar),
      visible:
        typeof secondary?.visible === "boolean"
          ? secondary.visible
          : sourceKind !== "none" || legacyOpen === null
            ? bounds.secondarySidebar.defaultVisible
            : legacyOpen !== "false",
    },
  }
}

export function writeWorkbenchLayoutPreferences(
  storage: Pick<Storage, "getItem" | "setItem">,
  snapshot: WorkbenchLayoutSnapshot,
  options: { projectDetailsPinned: boolean } = {
    projectDetailsPinned: snapshot.parts[WorkbenchLayoutParts.PrimarySidebar]?.visible ?? false,
  },
) {
  const primary = snapshot.parts[WorkbenchLayoutParts.PrimarySidebar]
  const secondary = snapshot.parts[WorkbenchLayoutParts.SecondarySidebar]
  if (!primary || !secondary) return false
  try {
    if (hasFutureStoredLayoutVersion(safeGetItem(storage, currentWorkbenchLayoutPreferenceKey))) return false
    storage.setItem(
      currentWorkbenchLayoutPreferenceKey,
      JSON.stringify({
        parts: {
          [WorkbenchLayoutParts.PrimarySidebar]: {
            pinned: options.projectDetailsPinned,
            size: primary.size,
            visible: primary.visible,
          },
          [WorkbenchLayoutParts.SecondarySidebar]: { size: secondary.size, visible: secondary.visible },
        },
        version: currentWorkbenchLayoutPreferenceVersion,
      }),
    )
    return true
  } catch {
    return false
  }
}

function hasFutureStoredLayoutVersion(raw: string | null) {
  if (!raw) return false
  try {
    const value: unknown = JSON.parse(raw)
    return (
      isRecord(value) &&
      typeof value.version === "number" &&
      Number.isInteger(value.version) &&
      value.version > currentWorkbenchLayoutPreferenceVersion
    )
  } catch {
    return false
  }
}

function parseStoredLayout(raw: string | null, version: number): StoredWorkbenchLayout | null {
  try {
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

function clampSize(value: unknown, bounds: { defaultSize: number; maxSize: number; minSize: number }) {
  const size = typeof value === "number" ? value : numberValue(value)
  if (size === null || !Number.isFinite(size)) return bounds.defaultSize
  return Math.min(bounds.maxSize, Math.max(bounds.minSize, size))
}

function numberValue(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
