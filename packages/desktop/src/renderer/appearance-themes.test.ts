import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { resolveCanvasAppearance } from "@convax/canvas"
import { semanticThemeTokenNames, semanticThemeVariableName } from "@convax/ui"
import {
  appAppearanceThemes,
  appearanceAccentIds,
  appearanceAccents,
  appearancePresetIds,
  canvasAppearancePalettes,
  canvasAppearanceThemes,
  normalizeCustomAccentColor,
  resolveAppAppearanceTheme,
  resolveAppAppearanceTokens,
  resolveAppearanceAccentId,
  resolveAppearanceAccentTokens,
  resolveAppearancePresetId,
  resolveCanvasAppearancePalette,
} from "./appearance-themes"

function channel(value: string) {
  const normalized = Number.parseInt(value, 16) / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function contrast(foreground: string, background: string) {
  const channels = [foreground, background].map((color) => {
    const hex = color.slice(1)
    const values = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map(channel)
    return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722
  })
  const lighter = Math.max(...channels)
  const darker = Math.min(...channels)
  return (lighter + 0.05) / (darker + 0.05)
}

describe("appearance themes", () => {
  test("resolves every built-in App preset to a complete semantic token set", () => {
    expect(Object.keys(appAppearanceThemes)).toEqual([...appearancePresetIds])
    expect(Object.keys(canvasAppearanceThemes)).toEqual([...appearancePresetIds])
    expect(Object.keys(canvasAppearancePalettes)).toEqual([...appearancePresetIds])
    for (const preset of Object.values(appAppearanceThemes)) {
      expect(Object.keys(preset.tokens).sort()).toEqual([...semanticThemeTokenNames].sort())
      expect(
        Object.entries(preset.tokens).every(
          ([token, value]) =>
            /^#[0-9a-f]{6}$/i.test(value) ||
            (token === "backdrop" && /^rgb\(.+\/ \d+%\)$/.test(value)) ||
            (token.startsWith("interactive-") && value.startsWith("color-mix(")) ||
            (token === "drop-target" && value.startsWith("color-mix(")),
        ),
      ).toBe(true)
    }
    for (const palette of Object.values(canvasAppearancePalettes)) {
      expect(
        Object.entries(palette).every(([key, value]) => key === "colorScheme" || /^#[0-9a-f]{6}$/i.test(value)),
      ).toBe(true)
      const resolved = resolveCanvasAppearance({ palette })
      expect(resolved.background).toBe(palette.background)
      expect(resolved.accent).toBe(palette.accent)
      expect(resolved.accentForeground).toBe(palette.accentForeground)
      expect(contrast(palette.accentForeground, palette.accent)).toBeGreaterThanOrEqual(4.5)
    }
  })

  test("falls back unknown preset identifiers to the default Graphite theme", () => {
    expect(resolveAppearancePresetId("midnight")).toBe("midnight")
    expect(resolveAppearancePresetId("removed-theme")).toBe("graphite")
    expect(resolveAppearancePresetId(null)).toBe("graphite")
    expect(resolveAppAppearanceTheme("removed-theme")).toBe(appAppearanceThemes.graphite)
  })

  test("resolves six scheme-aware accents across App and Canvas without weakening contrast", () => {
    expect(Object.keys(appearanceAccents)).toEqual([...appearanceAccentIds])
    expect(appearanceAccentIds).toHaveLength(6)
    expect(resolveAppearanceAccentId("cyan")).toBe("cyan")
    expect(resolveAppearanceAccentId("removed-accent")).toBe("lime")

    for (const themeId of appearancePresetIds) {
      const theme = appAppearanceThemes[themeId]
      for (const accentId of appearanceAccentIds) {
        const tokens = resolveAppAppearanceTokens(themeId, accentId)
        const palette = resolveCanvasAppearancePalette(themeId, accentId)
        const accent = appearanceAccents[accentId][theme.scheme]
        expect(tokens.brand).toBe(accent.brand)
        expect(tokens["on-brand"]).toBe(accent.onBrand)
        expect(tokens.selection).toBe(accent.selection)
        expect(tokens["focus-ring"]).toBe(accent.focusRing)
        expect(palette.accent).toBe(accent.brand)
        expect(palette.accentForeground).toBe(accent.onBrand)
        expect(palette.edgeActive).toBe(accent.selection)
        expect(contrast(tokens["on-brand"], tokens.brand)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(tokens["focus-ring"], tokens["surface-canvas"])).toBeGreaterThanOrEqual(3)
        expect(resolveCanvasAppearance({ palette }).accent).toBe(accent.brand)
      }
    }
  })

  test("normalizes custom hex colors and derives accessible App and Canvas accents", () => {
    expect(normalizeCustomAccentColor("#D86")).toBe("#dd8866")
    expect(normalizeCustomAccentColor("D98F60")).toBe("#d98f60")
    expect(normalizeCustomAccentColor("#d98f6z")).toBeNull()

    for (const themeId of appearancePresetIds) {
      const theme = appAppearanceThemes[themeId]
      const accent = resolveAppearanceAccentTokens(themeId, "custom", "#f8d9c4")
      const tokens = resolveAppAppearanceTokens(themeId, "custom", "#f8d9c4")
      const palette = resolveCanvasAppearancePalette(themeId, "custom", "#f8d9c4")

      expect(contrast(accent.brand, theme.tokens["surface-canvas"])).toBeGreaterThanOrEqual(4.5)
      expect(tokens.brand).toBe(accent.brand)
      expect(palette.accent).toBe(accent.brand)
      expect(contrast(accent.onBrand, accent.brand)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(accent.focusRing, theme.tokens["surface-canvas"])).toBeGreaterThanOrEqual(3)
      expect(contrast(accent.selection, theme.tokens["surface-canvas"])).toBeGreaterThanOrEqual(3)
    }
  })

  test("keeps Midnight active when a custom accent sits near the contrast boundary", () => {
    const palette = resolveCanvasAppearancePalette("midnight", "custom", "#463eb1")
    const resolved = resolveCanvasAppearance({ palette })

    expect(contrast(palette.accent, palette.background)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(palette.accentForeground, palette.accent)).toBeGreaterThanOrEqual(4.5)
    expect(resolved.background).toBe(canvasAppearancePalettes.midnight.background)
    expect(resolved.colorScheme).toBe("dark")
  })

  test("falls back to the branded custom accent when custom input is invalid", () => {
    expect(resolveAppearanceAccentTokens("paper", "custom", "not-a-color")).toEqual(
      resolveAppearanceAccentTokens("paper", "custom", "#d98f60"),
    )
  })

  test("keeps all text levels ordered and distinguishable in dark themes", () => {
    for (const id of ["graphite", "midnight"] as const) {
      const tokens = appAppearanceThemes[id].tokens
      const ratios = (["text-primary", "text-secondary", "text-tertiary", "text-disabled"] as const).map((token) =>
        contrast(tokens[token], tokens["surface-canvas"]),
      )
      expect(ratios[0]!).toBeGreaterThan(ratios[1]!)
      expect(ratios[1]!).toBeGreaterThan(ratios[2]!)
      expect(ratios[2]!).toBeGreaterThan(ratios[3]!)
      expect(new Set(ratios.map((value) => value.toFixed(2))).size).toBe(4)
    }
  })

  test("maintains accessible focus and semantic status contrast in every preset", () => {
    const roles = ["focus-ring", "selection", "status-danger", "status-warning", "status-success"] as const
    for (const preset of Object.values(appAppearanceThemes)) {
      for (const role of roles) {
        expect(contrast(preset.tokens[role], preset.tokens["surface-canvas"])).toBeGreaterThanOrEqual(3)
      }
      expect(contrast(preset.tokens["text-primary"], preset.tokens["surface-canvas"])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(preset.tokens["text-secondary"], preset.tokens["surface-canvas"])).toBeGreaterThanOrEqual(4.5)
    }
  })

  test("ships CSS selectors containing every semantic variable for all presets", () => {
    const css = readFileSync(join(import.meta.dir, "appearance-themes.css"), "utf8")
    const html = readFileSync(join(import.meta.dir, "index.html"), "utf8")
    expect(css).toContain(":root[data-app-theme]")
    expect(css).toContain(':root,\n:root[data-app-theme="graphite"]')
    expect(css).not.toContain(':root,\n:root[data-app-theme="paper"]')
    expect(html).toContain('<meta name="color-scheme" content="dark light" />')
    expect(css).toContain("--background: var(--ui-surface-canvas)")
    expect(css).toContain("--accent: var(--ui-interactive-selected)")
    expect(css).not.toContain("--accent: var(--ui-status-info-surface)")
    expect(css).toContain("--canvas-interactive-hover: var(--ui-interactive-hover)")
    expect(css).toContain("--canvas-surface: var(--ui-surface-raised)")
    expect(css).toContain("--ring: var(--ui-focus-ring)")
    for (const preset of appearancePresetIds) {
      expect(css).toContain(`[data-app-theme="${preset}"]`)
      const selector = `:root[data-app-theme="${preset}"]`
      const start = css.indexOf(selector)
      const block = css.slice(start, css.indexOf("}", start))
      for (const token of semanticThemeTokenNames) {
        expect(block).toContain(`${semanticThemeVariableName(token)}: ${appAppearanceThemes[preset].tokens[token]}`)
      }
    }
    for (const token of semanticThemeTokenNames) {
      expect(css).toContain(semanticThemeVariableName(token))
    }
    for (const accent of appearanceAccentIds) {
      expect(css).toContain(`[data-app-accent="${accent}"]`)
      for (const scheme of ["light", "dark"] as const) {
        const values = appearanceAccents[accent][scheme]
        expect(css).toContain(`--ui-brand: ${values.brand}`)
        expect(css).toContain(`--ui-on-brand: ${values.onBrand}`)
        expect(css).toContain(`--ui-selection: ${values.selection}`)
        expect(css).toContain(`--ui-on-selection: ${values.onSelection}`)
        expect(css).toContain(`--ui-focus-ring: ${values.focusRing}`)
      }
    }
  })
})
