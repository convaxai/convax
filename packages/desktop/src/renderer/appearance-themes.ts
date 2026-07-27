import type { CanvasAppearancePalette } from "@convax/canvas"
import type { SemanticThemeTokens } from "@convax/ui"

export const appearancePresetIds = ["paper", "graphite", "midnight", "studio"] as const
export type AppearancePresetId = (typeof appearancePresetIds)[number]
export type AppearanceColorScheme = "light" | "dark"
export const appearanceAccentIds = ["violet", "blue", "cyan", "green", "orange", "rose"] as const
export type AppearanceAccentId = (typeof appearanceAccentIds)[number]
export const customAppearanceAccentId = "custom" as const
export type AppearanceAccentSelectionId = AppearanceAccentId | typeof customAppearanceAccentId
export const defaultCustomAccentColor = "#d98f60"

export interface AppearanceAccentTokens {
  readonly brand: string
  readonly focusRing: string
  readonly onBrand: string
  readonly onSelection: string
  readonly selection: string
}

export interface AppearanceAccent {
  readonly dark: AppearanceAccentTokens
  readonly id: AppearanceAccentId
  readonly label: string
  readonly light: AppearanceAccentTokens
}

export interface AppAppearanceTheme {
  readonly description: string
  readonly id: AppearancePresetId
  readonly label: string
  readonly scheme: AppearanceColorScheme
  readonly tokens: SemanticThemeTokens
}

export interface CanvasAppearanceTheme {
  readonly description: string
  readonly id: AppearancePresetId
  readonly label: string
  readonly scheme: AppearanceColorScheme
}

type InteractionRoleTokens = Pick<
  SemanticThemeTokens,
  | "backdrop"
  | "drop-target"
  | "interactive-hover"
  | "interactive-pressed"
  | "interactive-selected"
  | "interactive-selected-border"
>

function interactionRoleTokens(scheme: AppearanceColorScheme): InteractionRoleTokens {
  return {
    "interactive-hover": "color-mix(in oklab, var(--ui-brand) 8%, var(--ui-surface-raised))",
    "interactive-selected": "color-mix(in oklab, var(--ui-brand) 14%, var(--ui-surface-raised))",
    "interactive-selected-border": "color-mix(in oklab, var(--ui-brand) 56%, var(--ui-border-default))",
    "interactive-pressed": "color-mix(in oklab, var(--ui-brand) 20%, var(--ui-surface-raised))",
    "drop-target": "color-mix(in oklab, var(--ui-brand) 12%, var(--ui-surface-canvas))",
    backdrop: scheme === "dark" ? "rgb(0 0 0 / 62%)" : "rgb(16 18 17 / 44%)",
  }
}

export const appearanceAccents = {
  violet: {
    id: "violet",
    label: "Purple",
    light: {
      brand: "#6254c7",
      focusRing: "#6254c7",
      onBrand: "#ffffff",
      onSelection: "#ffffff",
      selection: "#5267ca",
    },
    dark: {
      brand: "#9992ff",
      focusRing: "#a6a0ff",
      onBrand: "#111217",
      onSelection: "#111217",
      selection: "#8e94ff",
    },
  },
  blue: {
    id: "blue",
    label: "Blue",
    light: {
      brand: "#2563eb",
      focusRing: "#2563eb",
      onBrand: "#ffffff",
      onSelection: "#ffffff",
      selection: "#1d4ed8",
    },
    dark: {
      brand: "#70a5ff",
      focusRing: "#8bb4ff",
      onBrand: "#111217",
      onSelection: "#111217",
      selection: "#5b8ff5",
    },
  },
  cyan: {
    id: "cyan",
    label: "Cyan",
    light: {
      brand: "#087f8c",
      focusRing: "#087f8c",
      onBrand: "#ffffff",
      onSelection: "#ffffff",
      selection: "#0f7280",
    },
    dark: {
      brand: "#5cc8d7",
      focusRing: "#75d4df",
      onBrand: "#111217",
      onSelection: "#111217",
      selection: "#43b7c8",
    },
  },
  green: {
    id: "green",
    label: "Green",
    light: {
      brand: "#198754",
      focusRing: "#198754",
      onBrand: "#ffffff",
      onSelection: "#ffffff",
      selection: "#147647",
    },
    dark: {
      brand: "#62c68a",
      focusRing: "#78d19b",
      onBrand: "#111217",
      onSelection: "#111217",
      selection: "#49b974",
    },
  },
  orange: {
    id: "orange",
    label: "Orange",
    light: {
      brand: "#c45116",
      focusRing: "#c45116",
      onBrand: "#ffffff",
      onSelection: "#ffffff",
      selection: "#ad4411",
    },
    dark: {
      brand: "#f2a65a",
      focusRing: "#f7b773",
      onBrand: "#111217",
      onSelection: "#111217",
      selection: "#e69545",
    },
  },
  rose: {
    id: "rose",
    label: "Rose",
    light: {
      brand: "#be3f6b",
      focusRing: "#be3f6b",
      onBrand: "#ffffff",
      onSelection: "#ffffff",
      selection: "#a9335b",
    },
    dark: {
      brand: "#f08aac",
      focusRing: "#f49fba",
      onBrand: "#111217",
      onSelection: "#111217",
      selection: "#df7398",
    },
  },
} as const satisfies Record<AppearanceAccentId, AppearanceAccent>

export const appAppearanceThemes = {
  paper: {
    id: "paper",
    label: "Paper",
    description: "Warm, quiet surfaces for long-form spatial work.",
    scheme: "light",
    tokens: {
      "surface-canvas": "#f4f2ec",
      "surface-panel": "#fbfaf7",
      "surface-raised": "#ffffff",
      "surface-inset": "#e8e5de",
      "text-primary": "#1b1d1a",
      "text-secondary": "#4d554f",
      "text-tertiary": "#68716b",
      "text-disabled": "#858c87",
      brand: "#6254c7",
      "on-brand": "#ffffff",
      selection: "#5267ca",
      "on-selection": "#ffffff",
      ...interactionRoleTokens("light"),
      "focus-ring": "#5267ca",
      "status-danger": "#b52f43",
      "status-danger-surface": "#f9e4e7",
      "status-warning": "#8b5a00",
      "status-warning-surface": "#f7ead1",
      "status-success": "#247147",
      "status-success-surface": "#ddf0e4",
      "status-info": "#3569b8",
      "status-info-surface": "#e1eafa",
      "border-subtle": "#dedbd4",
      "border-default": "#cbc8c1",
      "border-strong": "#a9ada8",
      "control-background": "#ffffff",
    },
  },
  graphite: {
    id: "graphite",
    label: "Graphite",
    description: "Neutral charcoal surfaces with crisp, restrained contrast.",
    scheme: "dark",
    tokens: {
      "surface-canvas": "#151619",
      "surface-panel": "#1c1d21",
      "surface-raised": "#24252a",
      "surface-inset": "#101114",
      "text-primary": "#f1f2f4",
      "text-secondary": "#c4c7cd",
      "text-tertiary": "#9499a2",
      "text-disabled": "#6f747d",
      brand: "#9992ff",
      "on-brand": "#111217",
      selection: "#8e94ff",
      "on-selection": "#111217",
      ...interactionRoleTokens("dark"),
      "focus-ring": "#9aa7ff",
      "status-danger": "#ff7885",
      "status-danger-surface": "#3b1c23",
      "status-warning": "#e9b24a",
      "status-warning-surface": "#352817",
      "status-success": "#52c88a",
      "status-success-surface": "#173126",
      "status-info": "#70a9ff",
      "status-info-surface": "#192a42",
      "border-subtle": "#292b31",
      "border-default": "#363840",
      "border-strong": "#50535d",
      "control-background": "#202126",
    },
  },
  midnight: {
    id: "midnight",
    label: "Midnight",
    description: "Near-black, cinema-like focus with luminous semantic color.",
    scheme: "dark",
    tokens: {
      "surface-canvas": "#08090a",
      "surface-panel": "#1c1c1f",
      "surface-raised": "#232326",
      "surface-inset": "#0e0f11",
      "text-primary": "#f7f8f8",
      "text-secondary": "#d0d6e0",
      "text-tertiary": "#8f949d",
      "text-disabled": "#62666d",
      brand: "#929cff",
      "on-brand": "#0b0c12",
      selection: "#7f8cff",
      "on-selection": "#08090a",
      ...interactionRoleTokens("dark"),
      "focus-ring": "#9aa7ff",
      "status-danger": "#ff727d",
      "status-danger-surface": "#38181e",
      "status-warning": "#f0bf52",
      "status-warning-surface": "#342816",
      "status-success": "#4fca82",
      "status-success-surface": "#142e20",
      "status-info": "#68a9ff",
      "status-info-surface": "#14263d",
      "border-subtle": "#23252a",
      "border-default": "#34343a",
      "border-strong": "#4a4b53",
      "control-background": "#202023",
    },
  },
  studio: {
    id: "studio",
    label: "Studio",
    description: "Cool daylight surfaces tuned for visual production.",
    scheme: "light",
    tokens: {
      "surface-canvas": "#edf0f6",
      "surface-panel": "#f8f9fc",
      "surface-raised": "#ffffff",
      "surface-inset": "#dfe4ee",
      "text-primary": "#171923",
      "text-secondary": "#454c5e",
      "text-tertiary": "#626b7e",
      "text-disabled": "#81899a",
      brand: "#5c4db3",
      "on-brand": "#ffffff",
      selection: "#3d64b8",
      "on-selection": "#ffffff",
      ...interactionRoleTokens("light"),
      "focus-ring": "#3d64b8",
      "status-danger": "#b52f43",
      "status-danger-surface": "#f9e3e8",
      "status-warning": "#895900",
      "status-warning-surface": "#f7ead1",
      "status-success": "#247147",
      "status-success-surface": "#dcefe5",
      "status-info": "#2f64b5",
      "status-info-surface": "#dfe9fa",
      "border-subtle": "#d5dae4",
      "border-default": "#c1c8d5",
      "border-strong": "#9ea7b7",
      "control-background": "#ffffff",
    },
  },
} as const satisfies Record<AppearancePresetId, AppAppearanceTheme>

export const canvasAppearanceThemes = {
  paper: {
    id: "paper",
    label: "Paper",
    description: "Warm canvas with a sparse graphite dot grid.",
    scheme: "light",
  },
  graphite: {
    id: "graphite",
    label: "Graphite",
    description: "Charcoal canvas with subdued cool-gray structure.",
    scheme: "dark",
  },
  midnight: {
    id: "midnight",
    label: "Midnight",
    description: "Near-black canvas optimized for focused creation.",
    scheme: "dark",
  },
  studio: {
    id: "studio",
    label: "Studio",
    description: "Cool neutral canvas with high-clarity structure.",
    scheme: "light",
  },
} as const satisfies Record<AppearancePresetId, CanvasAppearanceTheme>

export const canvasAppearancePalettes = {
  paper: {
    accent: "#6254c7",
    accentForeground: "#ffffff",
    background: "#f7f6f2",
    colorScheme: "light",
    edge: "#a9ada8",
    edgeActive: "#5267ca",
    gridColor: "#d6d4ce",
    nodeBackground: "#fffefa",
    nodeBorder: "#cbc8c1",
    surface: "#ffffff",
    text: "#1b1d1a",
    textMuted: "#68716b",
  },
  graphite: {
    accent: "#9992ff",
    accentForeground: "#08090a",
    background: "#151619",
    colorScheme: "dark",
    edge: "#50535d",
    edgeActive: "#8e94ff",
    gridColor: "#363840",
    nodeBackground: "#24252a",
    nodeBorder: "#50535d",
    surface: "#1c1d21",
    text: "#f1f2f4",
    textMuted: "#9499a2",
  },
  midnight: {
    accent: "#929cff",
    accentForeground: "#08090a",
    background: "#08090a",
    colorScheme: "dark",
    edge: "#4a4b53",
    edgeActive: "#7f8cff",
    gridColor: "#292b31",
    nodeBackground: "#1c1c1f",
    nodeBorder: "#34343a",
    surface: "#232326",
    text: "#f7f8f8",
    textMuted: "#8f949d",
  },
  studio: {
    accent: "#5c4db3",
    accentForeground: "#ffffff",
    background: "#edf0f6",
    colorScheme: "light",
    edge: "#9ea7b7",
    edgeActive: "#3d64b8",
    gridColor: "#c1c8d5",
    nodeBackground: "#ffffff",
    nodeBorder: "#c1c8d5",
    surface: "#f8f9fc",
    text: "#171923",
    textMuted: "#626b7e",
  },
} as const satisfies Record<AppearancePresetId, CanvasAppearancePalette>

export function isAppearancePresetId(value: unknown): value is AppearancePresetId {
  return typeof value === "string" && appearancePresetIds.some((preset) => preset === value)
}

export function resolveAppearancePresetId(value: unknown): AppearancePresetId {
  return isAppearancePresetId(value) ? value : "paper"
}

export function resolveAppAppearanceTheme(value: unknown): AppAppearanceTheme {
  return appAppearanceThemes[resolveAppearancePresetId(value)]
}

export function isAppearanceAccentId(value: unknown): value is AppearanceAccentId {
  return typeof value === "string" && appearanceAccentIds.some((accent) => accent === value)
}

export function resolveAppearanceAccentId(value: unknown): AppearanceAccentId {
  return isAppearanceAccentId(value) ? value : "violet"
}

export function isAppearanceAccentSelectionId(value: unknown): value is AppearanceAccentSelectionId {
  return value === customAppearanceAccentId || isAppearanceAccentId(value)
}

export function normalizeCustomAccentColor(value: unknown): string | null {
  if (typeof value !== "string") return null
  const candidate = value.trim().toLowerCase()
  const short = candidate.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  const full = candidate.match(/^#?([0-9a-f]{6})$/)
  return full ? `#${full[1]}` : null
}

export function resolveAppearanceAccentTokens(
  themeValue: unknown,
  accentValue: unknown,
  customAccentValue: unknown = defaultCustomAccentColor,
): AppearanceAccentTokens {
  const theme = resolveAppAppearanceTheme(themeValue)
  if (accentValue !== customAppearanceAccentId) {
    return appearanceAccents[resolveAppearanceAccentId(accentValue)][theme.scheme]
  }
  const source = normalizeCustomAccentColor(customAccentValue) ?? defaultCustomAccentColor
  const brand = ensureAccessibleBrand(source, theme.tokens["surface-canvas"])
  const selection = ensureMinimumContrast(source, theme.tokens["surface-canvas"], 3)
  return {
    brand,
    focusRing: selection,
    onBrand: readableForeground(brand),
    onSelection: readableForeground(selection),
    selection,
  }
}

export function resolveAppAppearanceTokens(
  themeValue: unknown,
  accentValue: unknown,
  customAccentValue?: unknown,
): SemanticThemeTokens {
  const theme = resolveAppAppearanceTheme(themeValue)
  const accent = resolveAppearanceAccentTokens(themeValue, accentValue, customAccentValue)
  return {
    ...theme.tokens,
    brand: accent.brand,
    "focus-ring": accent.focusRing,
    "on-brand": accent.onBrand,
    "on-selection": accent.onSelection,
    selection: accent.selection,
  }
}

export function resolveCanvasAppearancePalette(
  themeValue: unknown,
  accentValue: unknown,
  customAccentValue?: unknown,
): CanvasAppearancePalette {
  const themeId = resolveAppearancePresetId(themeValue)
  const palette = canvasAppearancePalettes[themeId]
  const accent = resolveAppearanceAccentTokens(themeId, accentValue, customAccentValue)
  return {
    ...palette,
    accent: accent.brand,
    accentForeground: accent.onBrand,
    edgeActive: accent.selection,
  }
}

interface RgbColor {
  readonly blue: number
  readonly green: number
  readonly red: number
}

function parseHexColor(value: string): RgbColor {
  return {
    red: Number.parseInt(value.slice(1, 3), 16),
    green: Number.parseInt(value.slice(3, 5), 16),
    blue: Number.parseInt(value.slice(5, 7), 16),
  }
}

function formatHexColor(color: RgbColor) {
  const channel = (value: number) => Math.round(value).toString(16).padStart(2, "0")
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`
}

function relativeLuminance(value: string) {
  const color = parseHexColor(value)
  const linear = (channel: number) => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return linear(color.red) * 0.2126 + linear(color.green) * 0.7152 + linear(color.blue) * 0.0722
}

function contrastRatio(foreground: string, background: string) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

function readableForeground(background: string) {
  const dark = "#111217"
  const light = "#ffffff"
  return contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light
}

function mixHexColor(color: string, target: string, amount: number) {
  const sourceRgb = parseHexColor(color)
  const targetRgb = parseHexColor(target)
  return formatHexColor({
    red: sourceRgb.red + (targetRgb.red - sourceRgb.red) * amount,
    green: sourceRgb.green + (targetRgb.green - sourceRgb.green) * amount,
    blue: sourceRgb.blue + (targetRgb.blue - sourceRgb.blue) * amount,
  })
}

function ensureMinimumContrast(color: string, background: string, minimum: number) {
  if (contrastRatio(color, background) >= minimum) return color
  const target = contrastRatio("#111217", background) >= contrastRatio("#ffffff", background) ? "#111217" : "#ffffff"
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixHexColor(color, target, step / 20)
    if (contrastRatio(candidate, background) >= minimum) return candidate
  }
  return target
}

function ensureAccessibleBrand(color: string, background: string) {
  const target = contrastRatio("#111217", background) >= contrastRatio("#ffffff", background) ? "#111217" : "#ffffff"
  for (let step = 0; step <= 100; step += 1) {
    const candidate = mixHexColor(color, target, step / 100)
    const foreground = readableForeground(candidate)
    if (contrastRatio(candidate, background) >= 4.5 && contrastRatio(foreground, candidate) >= 4.5) {
      return candidate
    }
  }
  return target
}
