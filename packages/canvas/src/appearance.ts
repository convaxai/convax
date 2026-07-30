import type { CSSProperties } from "react"

export type CanvasGridStyle = "dots" | "lines" | "none"
export type CanvasColorScheme = "light" | "dark"

export interface CanvasAppearancePalette {
  accent: string
  accentForeground: string
  background: string
  colorScheme: CanvasColorScheme
  edge: string
  edgeActive: string
  gridColor?: string
  nodeBackground: string
  nodeBorder: string
  surface: string
  text: string
  textMuted: string
}

export interface CanvasAppearanceInput {
  gridGap?: number
  gridSize?: number
  gridStyle?: CanvasGridStyle
  nodeRadius?: number
  /**
   * A complete semantic palette supplied atomically by the host. Invalid,
   * incomplete, or unreadable palettes fall back as a unit.
   */
  palette?: CanvasAppearancePalette
}

export interface ResolvedCanvasAppearance extends CanvasAppearancePalette {
  gridColor: string
  gridGap: number
  gridSize: number
  gridStyle: CanvasGridStyle
  nodeRadius: number
}

const DEFAULT_PALETTE: CanvasAppearancePalette = {
  accent: "#6656d9",
  accentForeground: "#ffffff",
  background: "#f7f6f2",
  colorScheme: "light",
  edge: "#b9bcc3",
  edgeActive: "#7464dc",
  gridColor: "#d6d4ce",
  nodeBackground: "#fffefa",
  nodeBorder: "#deddd7",
  surface: "#fffefa",
  text: "#242424",
  textMuted: "#6f706c",
}

const HEX_COLOR = /^#([\da-f]{6})$/i

function colorRgb(value: string) {
  const match = value.match(HEX_COLOR)
  if (!match) return undefined
  const hex = match[1]!
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
}

function relativeLuminance(value: string) {
  const rgb = colorRgb(value)
  if (!rgb) return undefined
  const [red, green, blue] = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722
}

function contrastRatio(left: string, right: string) {
  const leftLuminance = relativeLuminance(left)
  const rightLuminance = relativeLuminance(right)
  if (leftLuminance === undefined || rightLuminance === undefined) return 0
  const lighter = Math.max(leftLuminance, rightLuminance)
  const darker = Math.min(leftLuminance, rightLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function safePalette(value: CanvasAppearancePalette | undefined): CanvasAppearancePalette {
  if (!value || (value.colorScheme !== "light" && value.colorScheme !== "dark")) return DEFAULT_PALETTE
  const colors = [
    value.accent,
    value.accentForeground,
    value.background,
    value.edge,
    value.edgeActive,
    value.gridColor ?? value.edge,
    value.nodeBackground,
    value.nodeBorder,
    value.surface,
    value.text,
    value.textMuted,
  ]
  if (!colors.every((color) => typeof color === "string" && HEX_COLOR.test(color))) return DEFAULT_PALETTE
  if (
    contrastRatio(value.text, value.nodeBackground) < 4.5 ||
    contrastRatio(value.text, value.surface) < 4.5 ||
    contrastRatio(value.textMuted, value.background) < 3 ||
    contrastRatio(value.edge, value.background) < 1.15 ||
    contrastRatio(value.edgeActive, value.background) < 2 ||
    contrastRatio(value.gridColor ?? value.edge, value.background) < 1.1 ||
    contrastRatio(value.accent, value.background) < 2 ||
    contrastRatio(value.accentForeground, value.accent) < 4.5
  ) {
    return DEFAULT_PALETTE
  }
  return { ...value, gridColor: value.gridColor ?? value.edge }
}

function safeNumber(value: number | undefined, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function resolveCanvasAppearance(input?: CanvasAppearanceInput): ResolvedCanvasAppearance {
  const palette = safePalette(input?.palette)
  const gridStyle =
    input?.gridStyle === "dots" || input?.gridStyle === "lines" || input?.gridStyle === "none"
      ? input.gridStyle
      : "dots"
  return {
    ...palette,
    gridColor: palette.gridColor ?? palette.edge,
    gridGap: safeNumber(input?.gridGap, 24, 8, 96),
    gridSize: safeNumber(input?.gridSize, 1.5, 0.5, 3),
    gridStyle,
    nodeRadius: safeNumber(input?.nodeRadius, 10, 0, 24),
  }
}

export function canvasAppearanceStyle(appearance: ResolvedCanvasAppearance): CSSProperties {
  return {
    "--accent": `color-mix(in oklab, ${appearance.accent} 14%, transparent)`,
    "--accent-foreground": appearance.text,
    "--background": appearance.background,
    "--border": appearance.nodeBorder,
    "--card": appearance.nodeBackground,
    "--card-foreground": appearance.text,
    "--canvas-accent": appearance.accent,
    "--canvas-accent-foreground": appearance.accentForeground,
    "--canvas-background": appearance.background,
    "--canvas-edge": appearance.edge,
    "--canvas-edge-active": appearance.edgeActive,
    "--canvas-edge-flow": appearance.accent,
    "--canvas-grid": appearance.gridColor,
    "--canvas-interactive-hover": `color-mix(in oklab, ${appearance.accent} 8%, ${appearance.surface})`,
    "--canvas-interactive-pressed": `color-mix(in oklab, ${appearance.accent} 20%, ${appearance.surface})`,
    "--canvas-interactive-selected": `color-mix(in oklab, ${appearance.accent} 14%, ${appearance.surface})`,
    "--canvas-node-background": appearance.nodeBackground,
    "--canvas-node-border": appearance.nodeBorder,
    "--canvas-node-radius": `${appearance.nodeRadius}px`,
    "--canvas-surface": appearance.surface,
    "--canvas-text": appearance.text,
    "--canvas-text-muted": appearance.textMuted,
    "--foreground": appearance.text,
    "--input": appearance.nodeBorder,
    "--muted": `color-mix(in oklab, ${appearance.text} 8%, transparent)`,
    "--muted-foreground": appearance.textMuted,
    "--popover": appearance.surface,
    "--popover-foreground": appearance.text,
    "--primary": appearance.accent,
    "--primary-foreground": appearance.accentForeground,
    "--ring": appearance.accent,
  } as CSSProperties
}
