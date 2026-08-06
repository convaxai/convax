import {
  defaultAppearancePresetId,
  defaultCustomAccentColor,
  isAppearanceAccentSelectionId,
  isAppearancePresetId,
  normalizeCustomAccentColor,
  resolveAppearanceAccentTokens,
  type AppearanceAccentSelectionId,
  type AppearancePresetId,
} from "./appearance-themes"

export const appearancePreferencesStorageKey = "convax.desktop.appearance.v3"
export const previousAppearancePreferencesStorageKey = "convax.desktop.appearance.v2"
export const legacyAppearancePreferencesStorageKey = "convax.desktop.appearance.v1"

export interface AppearancePreferences {
  readonly accent: AppearanceAccentSelectionId
  readonly customAccent: string
  readonly highContrast: boolean
  readonly reducedMotion: boolean
  readonly theme: AppearancePresetId
}

export const defaultAppearancePreferences: AppearancePreferences = Object.freeze({
  accent: "lime",
  customAccent: defaultCustomAccentColor,
  highContrast: false,
  reducedMotion: false,
  theme: defaultAppearancePresetId,
})

interface AppearanceStorageReader {
  getItem(key: string): string | null
}

interface AppearanceStorageWriter {
  setItem(key: string, value: string): void
}

interface AppearanceAttributeTarget {
  setAttribute(name: string, value: string): void
  readonly style?: {
    removeProperty(name: string): unknown
    setProperty(name: string, value: string): unknown
  }
}

export function readAppearancePreferences(storage: AppearanceStorageReader): AppearancePreferences {
  try {
    const raw = storage.getItem(appearancePreferencesStorageKey)
    if (raw) {
      const value = JSON.parse(raw) as unknown
      if (!isStoredAppearancePreferences(value)) return defaultAppearancePreferences
      return {
        accent: value.accent,
        customAccent: normalizeCustomAccentColor(value.customAccent) ?? defaultCustomAccentColor,
        highContrast: value.highContrast,
        reducedMotion: value.reducedMotion,
        theme: value.theme,
      }
    }

    const previousRaw = storage.getItem(previousAppearancePreferencesStorageKey)
    if (previousRaw) {
      const previousValue = JSON.parse(previousRaw) as unknown
      if (!isPreviousStoredAppearancePreferences(previousValue)) return defaultAppearancePreferences
      return {
        accent: previousValue.accent,
        customAccent: defaultCustomAccentColor,
        highContrast: previousValue.highContrast,
        reducedMotion: previousValue.reducedMotion,
        theme: previousValue.theme,
      }
    }

    const legacyRaw = storage.getItem(legacyAppearancePreferencesStorageKey)
    if (!legacyRaw) return defaultAppearancePreferences
    const legacyValue = JSON.parse(legacyRaw) as unknown
    if (!isLegacyStoredAppearancePreferences(legacyValue)) return defaultAppearancePreferences
    return {
      accent: "lime",
      customAccent: defaultCustomAccentColor,
      highContrast: legacyValue.highContrast,
      reducedMotion: legacyValue.reducedMotion,
      theme: legacyValue.theme,
    }
  } catch {
    return defaultAppearancePreferences
  }
}

export function writeAppearancePreferences(storage: AppearanceStorageWriter, preferences: AppearancePreferences) {
  if (!isAppearancePreferences(preferences)) return false
  try {
    storage.setItem(
      appearancePreferencesStorageKey,
      JSON.stringify({
        ...preferences,
        customAccent: normalizeCustomAccentColor(preferences.customAccent),
        version: 3,
      }),
    )
    return true
  } catch {
    return false
  }
}

export function applyAppearancePreferences(target: AppearanceAttributeTarget, preferences: AppearancePreferences) {
  const safePreferences = isAppearancePreferences(preferences) ? preferences : defaultAppearancePreferences
  target.setAttribute("data-app-accent", safePreferences.accent)
  target.setAttribute("data-app-theme", safePreferences.theme)
  target.setAttribute("data-canvas-theme", safePreferences.theme)
  target.setAttribute("data-high-contrast", String(safePreferences.highContrast))
  target.setAttribute("data-reduced-motion", String(safePreferences.reducedMotion))
  const customProperties = [
    "--ui-brand",
    "--ui-focus-ring",
    "--ui-on-brand",
    "--ui-on-selection",
    "--ui-selection",
  ] as const
  if (safePreferences.accent !== "custom") {
    for (const property of customProperties) target.style?.removeProperty(property)
    return
  }
  const accent = resolveAppearanceAccentTokens(
    safePreferences.theme,
    safePreferences.accent,
    safePreferences.customAccent,
  )
  target.style?.setProperty("--ui-brand", accent.brand)
  target.style?.setProperty("--ui-focus-ring", accent.focusRing)
  target.style?.setProperty("--ui-on-brand", accent.onBrand)
  target.style?.setProperty("--ui-on-selection", accent.onSelection)
  target.style?.setProperty("--ui-selection", accent.selection)
}

function isAppearancePreferences(value: unknown): value is AppearancePreferences {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<Record<keyof AppearancePreferences, unknown>>
  return (
    isAppearanceAccentSelectionId(candidate.accent) &&
    normalizeCustomAccentColor(candidate.customAccent) !== null &&
    typeof candidate.highContrast === "boolean" &&
    typeof candidate.reducedMotion === "boolean" &&
    isAppearancePresetId(candidate.theme)
  )
}

function isStoredAppearancePreferences(value: unknown): value is AppearancePreferences & { readonly version: 3 } {
  if (!isAppearancePreferences(value)) return false
  return (value as { version?: unknown }).version === 3
}

function isPreviousStoredAppearancePreferences(
  value: unknown,
): value is Omit<AppearancePreferences, "customAccent"> & { readonly version: 2 } {
  if (!value || typeof value !== "object") return false
  const candidate = value as {
    accent?: unknown
    highContrast?: unknown
    reducedMotion?: unknown
    theme?: unknown
    version?: unknown
  }
  return (
    candidate.version === 2 &&
    candidate.accent !== "custom" &&
    isAppearanceAccentSelectionId(candidate.accent) &&
    typeof candidate.highContrast === "boolean" &&
    typeof candidate.reducedMotion === "boolean" &&
    isAppearancePresetId(candidate.theme)
  )
}

function isLegacyStoredAppearancePreferences(
  value: unknown,
): value is Omit<AppearancePreferences, "accent" | "customAccent"> & { readonly version: 1 } {
  if (!value || typeof value !== "object") return false
  const candidate = value as {
    highContrast?: unknown
    reducedMotion?: unknown
    theme?: unknown
    version?: unknown
  }
  return (
    candidate.version === 1 &&
    typeof candidate.highContrast === "boolean" &&
    typeof candidate.reducedMotion === "boolean" &&
    isAppearancePresetId(candidate.theme)
  )
}
