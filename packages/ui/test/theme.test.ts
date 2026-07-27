import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { semanticThemeTokenNames, semanticThemeVariableName } from "../src/theme"

const themeCss = readFileSync(join(import.meta.dir, "..", "src", "theme.css"), "utf8")
const stylesCss = readFileSync(join(import.meta.dir, "..", "src", "styles.css"), "utf8")
const contextMenuSource = readFileSync(join(import.meta.dir, "..", "src", "components", "context-menu.tsx"), "utf8")
const selectSource = readFileSync(join(import.meta.dir, "..", "src", "components", "select.tsx"), "utf8")

describe("semantic UI theme", () => {
  test("declares every public semantic token as a root custom property and Tailwind color", () => {
    for (const token of semanticThemeTokenNames) {
      const variable = semanticThemeVariableName(token)
      expect(themeCss).toContain(`${variable}:`)
      expect(themeCss).toContain(`--color-${token}: var(${variable})`)
    }
  })

  test("keeps legacy primitive variables mapped to semantic roles", () => {
    expect(themeCss).toContain("--background: var(--ui-surface-canvas)")
    expect(themeCss).toContain("--foreground: var(--ui-text-primary)")
    expect(themeCss).toContain(
      "--accent: color-mix(in oklab, var(--ui-brand) 14%, var(--ui-surface-raised))",
    )
    expect(themeCss).not.toContain("--accent: var(--ui-status-info-surface)")
    expect(themeCss).toContain("--destructive: var(--ui-status-danger)")
    expect(themeCss).toContain("--ring: var(--ui-focus-ring)")
  })

  test("provides semantic reduced-motion and high-contrast overrides", () => {
    expect(themeCss).toContain(':root[data-reduced-motion="true"]')
    expect(themeCss).toContain(':root[data-high-contrast="true"]')
    expect(themeCss).toContain("@media (prefers-reduced-motion: reduce)")
    expect(themeCss).toContain("@media (prefers-contrast: more)")
  })

  test("themes portal-rendered menu surfaces from semantic tokens", () => {
    expect(themeCss).toContain(":where([data-ui-menu-surface], [data-ui-portal-surface])")
    expect(themeCss).toContain("color: var(--ui-text-primary)")
    expect(themeCss).toContain("background-color: var(--ui-surface-raised)")
    expect(themeCss).toContain("border-color: var(--ui-border-subtle)")
    expect(themeCss).toContain("box-shadow: var(--ui-shadow-medium)")
    expect(contextMenuSource).toContain('data-ui-menu-surface=""')
    expect(selectSource).toContain('data-ui-menu-surface=""')
  })

  test("keeps interaction roles separate from status and legacy accent roles", () => {
    expect(themeCss).toContain("--ui-interactive-hover:")
    expect(themeCss).toContain("--ui-interactive-selected:")
    expect(themeCss).toContain("--ui-interactive-selected-border:")
    expect(themeCss).toContain("--ui-interactive-pressed:")
    expect(themeCss).toContain("--ui-drop-target:")
    expect(themeCss).toContain("--ui-backdrop:")
    expect(themeCss).toContain("--color-interactive-hover: var(--ui-interactive-hover)")
    expect(themeCss).toContain("--color-drop-target: var(--ui-drop-target)")
    expect(themeCss).not.toContain("--ui-interactive-hover: var(--ui-status-info")
  })

  test("provides shared stable-footprint interaction and portal backdrop behavior", () => {
    expect(stylesCss).toContain(":where([data-ui-interactive])")
    expect(stylesCss).toContain("transform: scale(0.97)")
    expect(stylesCss).toContain(":where([data-ui-portal-backdrop])")
    expect(stylesCss).toContain("background: var(--ui-backdrop)")
  })

  test("applies the app-level reduced-motion preference to hard-coded third-party and utility motion", () => {
    expect(themeCss).toContain(':root[data-reduced-motion="true"] *')
    expect(themeCss).toContain("animation-duration: 0.001ms !important")
    expect(themeCss).toContain("transition-duration: 0ms !important")
  })

  test("maps the approved variable typography stack into Tailwind utilities", () => {
    expect(themeCss).toContain('--ui-font-sans: "Inter Variable"')
    expect(themeCss).toContain('--ui-font-mono: "Berkeley Mono"')
    expect(themeCss).toContain("--font-sans: var(--ui-font-sans)")
    expect(themeCss).toContain("--font-display: var(--ui-font-display)")
    expect(themeCss).toContain("--font-mono: var(--ui-font-mono)")
    expect(themeCss).toContain("--font-weight-medium: var(--ui-font-weight-medium)")
    expect(themeCss).toContain("--font-weight-semibold: var(--ui-font-weight-semibold)")
    expect(themeCss).toContain("--font-weight-bold: var(--ui-font-weight-bold)")
  })

  test("keeps host scrollbars transparent until their scroll region is engaged", () => {
    expect(themeCss).toContain("--ui-scrollbar-thumb:")
    expect(themeCss).toContain("--ui-scrollbar-thumb-hover:")
    expect(stylesCss).toContain("scrollbar-gutter: auto")
    expect(stylesCss).toContain("scrollbar-color: transparent transparent")
    expect(stylesCss).toContain("*:hover::-webkit-scrollbar-thumb")
    expect(stylesCss).toContain("*:focus-within::-webkit-scrollbar-thumb")
    expect(stylesCss).toContain("*::-webkit-scrollbar-track,")
    expect(stylesCss).toContain("*::-webkit-scrollbar-corner")
  })
})
