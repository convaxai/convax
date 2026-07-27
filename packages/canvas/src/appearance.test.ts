import { describe, expect, test } from "bun:test"
import {
  canvasAppearanceStyle,
  resolveCanvasAppearance,
  type CanvasAppearancePalette,
} from "./appearance"

const hostPalettes = [
  {
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
  },
  {
    accent: "#818cf8",
    accentForeground: "#08090a",
    background: "#171719",
    colorScheme: "dark",
    edge: "#4a4b51",
    edgeActive: "#929bf9",
    gridColor: "#3a3b40",
    nodeBackground: "#242427",
    nodeBorder: "#38383e",
    surface: "#202023",
    text: "#f0f0f1",
    textMuted: "#999ba3",
  },
  {
    accent: "#7580e8",
    accentForeground: "#08090a",
    background: "#08090a",
    colorScheme: "dark",
    edge: "#34363d",
    edgeActive: "#8791ef",
    gridColor: "#292b31",
    nodeBackground: "#1c1c1f",
    nodeBorder: "#303137",
    surface: "#1c1c1f",
    text: "#f2f3f3",
    textMuted: "#8a8f98",
  },
  {
    accent: "#236dd7",
    accentForeground: "#ffffff",
    background: "#eef1f3",
    colorScheme: "light",
    edge: "#a8b0b9",
    edgeActive: "#3279dc",
    gridColor: "#cbd1d6",
    nodeBackground: "#ffffff",
    nodeBorder: "#d7dce0",
    surface: "#ffffff",
    text: "#18212a",
    textMuted: "#68727c",
  },
] satisfies readonly CanvasAppearancePalette[]

describe("Canvas appearance", () => {
  test("resolves complete host palettes without owning product preset names", () => {
    for (const palette of hostPalettes) {
      const appearance = resolveCanvasAppearance({ palette })
      expect(appearance).toMatchObject(palette)
      expect(appearance).not.toHaveProperty("preset")
      expect(appearance.gridGap).toBeGreaterThanOrEqual(8)
      expect(appearance.gridSize).toBeGreaterThanOrEqual(0.5)
    }
  })

  test("falls back atomically for incomplete, malformed, and unreadable palettes", () => {
    const fallback = resolveCanvasAppearance()
    const unreadable = { ...hostPalettes[0], nodeBackground: hostPalettes[0].text }
    const invisibleChrome = {
      ...hostPalettes[0],
      edgeActive: hostPalettes[0].background,
      gridColor: hostPalettes[0].background,
    }
    const malformed = { ...hostPalettes[0], edge: "#fff; background: red" }
    const unreadableAccent = {
      ...hostPalettes[0],
      accentForeground: hostPalettes[0].accent,
    }

    expect(resolveCanvasAppearance({ palette: unreadable })).toEqual(fallback)
    expect(resolveCanvasAppearance({ palette: invisibleChrome })).toEqual(fallback)
    expect(resolveCanvasAppearance({ palette: malformed })).toEqual(fallback)
    expect(resolveCanvasAppearance({ palette: unreadableAccent })).toEqual(fallback)
    expect(resolveCanvasAppearance({ palette: { text: "#111111" } as CanvasAppearancePalette })).toEqual(
      fallback,
    )
  })

  test("keeps bounded visual preferences independent from the semantic palette", () => {
    const appearance = resolveCanvasAppearance({
      gridGap: Number.NaN,
      gridSize: 200,
      gridStyle: "invalid" as never,
      nodeRadius: -10,
      palette: hostPalettes[2],
    })

    expect(appearance).toMatchObject({
      ...hostPalettes[2],
      gridGap: 20,
      gridSize: 3,
      gridStyle: "dots",
      nodeRadius: 0,
    })
  })

  test("keeps the default dot grid legible at common workspace zoom levels", () => {
    expect(resolveCanvasAppearance()).toMatchObject({
      gridGap: 20,
      gridSize: 1.3,
      gridStyle: "dots",
    })
  })

  test("maps resolved values to semantic CSS variables without document state", () => {
    const appearance = resolveCanvasAppearance({ nodeRadius: 12, palette: hostPalettes[2] })
    expect(canvasAppearanceStyle(appearance)).toMatchObject({
      "--canvas-background": "#08090a",
      "--canvas-accent-foreground": "#08090a",
      "--canvas-edge-flow": "#7580e8",
      "--canvas-interactive-hover": "color-mix(in oklab, #7580e8 8%, #1c1c1f)",
      "--canvas-interactive-pressed": "color-mix(in oklab, #7580e8 20%, #1c1c1f)",
      "--canvas-interactive-selected": "color-mix(in oklab, #7580e8 14%, #1c1c1f)",
      "--canvas-node-radius": "12px",
      "--canvas-text": "#f2f3f3",
      "--primary-foreground": "#08090a",
    })
    expect(appearance).not.toHaveProperty("revision")
    expect(appearance).not.toHaveProperty("document")
  })
})
