import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const theme = readFileSync(join(import.meta.dir, "..", "src", "theme.css"), "utf8")

describe("portable Plugin UI theme", () => {
  test("ships a self-contained light and dark semantic foundation", () => {
    expect(theme).toContain(":root {")
    expect(theme).toContain("@media (prefers-color-scheme: dark)")
    expect(theme).toContain("--ui-surface-canvas: #f4f2ec")
    expect(theme).toContain("--ui-surface-canvas: #151619")
    expect(theme).toContain("--ui-text-primary: #1b1d1a")
    expect(theme).toContain("--ui-text-primary: #f1f2f4")
    expect(theme).toContain("--ui-brand: #6254c7")
    expect(theme).toContain("--ui-brand: #9992ff")
    expect(theme).toContain("outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring)")
  })

  test("contains no Host selector, remote asset, or executable import", () => {
    expect(theme).not.toContain("data-app-theme")
    expect(theme).not.toContain("@import")
    expect(theme).not.toContain("url(")
    expect(theme).not.toMatch(/https?:\/\//u)
  })

  test("publishes the semantic tokens used by Plugin-owned surfaces", () => {
    for (const token of [
      "surface-canvas",
      "surface-panel",
      "surface-raised",
      "surface-inset",
      "text-primary",
      "text-secondary",
      "text-tertiary",
      "brand",
      "on-brand",
      "interactive-hover",
      "interactive-selected",
      "border-subtle",
      "border-default",
      "status-danger",
      "status-success",
      "focus-ring",
    ]) {
      expect(theme).toContain(`--ui-${token}:`)
    }
  })

  test("provides product-agnostic accessible component recipes", () => {
    for (const recipe of [
      "data-plugin-ui-button",
      "data-plugin-ui-icon-button",
      "data-plugin-ui-card",
      "data-plugin-ui-badge",
      "data-plugin-ui-field",
      "data-plugin-ui-notice",
      "data-plugin-ui-empty",
    ]) {
      expect(theme).toContain(recipe)
    }
    expect(theme).toContain('[data-plugin-ui-button]:disabled')
    expect(theme).toContain('[data-plugin-ui-card][aria-selected="true"]')
  })
})
