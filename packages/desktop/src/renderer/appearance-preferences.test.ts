import { describe, expect, test } from "bun:test"
import {
  appearancePreferencesStorageKey,
  applyAppearancePreferences,
  defaultAppearancePreferences,
  legacyAppearancePreferencesStorageKey,
  previousAppearancePreferencesStorageKey,
  readAppearancePreferences,
  writeAppearancePreferences,
} from "./appearance-preferences"

function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries))
  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    values,
  }
}

describe("appearance preferences", () => {
  test("persists one workspace theme and accent preference in a versioned record", () => {
    const storage = memoryStorage()
    const preferences = {
      accent: "custom",
      customAccent: "#d98f60",
      highContrast: true,
      reducedMotion: false,
      theme: "midnight",
    } as const

    expect(writeAppearancePreferences(storage, preferences)).toBe(true)
    expect(JSON.parse(storage.values.get(appearancePreferencesStorageKey)!)).toEqual({
      ...preferences,
      version: 3,
    })
    expect(readAppearancePreferences(storage)).toEqual(preferences)
  })

  test("migrates v2 presets without discarding the rollback record", () => {
    const storedV2 = JSON.stringify({
      accent: "cyan",
      highContrast: true,
      reducedMotion: false,
      theme: "studio",
      version: 2,
    })
    const storage = memoryStorage({ [previousAppearancePreferencesStorageKey]: storedV2 })

    expect(readAppearancePreferences(storage)).toEqual({
      accent: "cyan",
      customAccent: "#d98f60",
      highContrast: true,
      reducedMotion: false,
      theme: "studio",
    })
    expect(storage.values.get(previousAppearancePreferencesStorageKey)).toBe(storedV2)
  })

  test("migrates legacy theme preferences to the Purple accent without losing accessibility choices", () => {
    const storage = memoryStorage({
      [legacyAppearancePreferencesStorageKey]: JSON.stringify({
        highContrast: true,
        reducedMotion: true,
        theme: "graphite",
        version: 1,
      }),
    })

    expect(readAppearancePreferences(storage)).toEqual({
      accent: "violet",
      customAccent: "#d98f60",
      highContrast: true,
      reducedMotion: true,
      theme: "graphite",
    })
  })

  test("returns Paper and Purple defaults for missing, malformed, unknown, old, or partial records", () => {
    const invalidValues = [
      null,
      "{",
      JSON.stringify({
        accent: "violet",
        customAccent: "#d98f60",
        highContrast: false,
        reducedMotion: false,
        theme: "removed",
        version: 3,
      }),
      JSON.stringify({
        accent: "removed",
        customAccent: "#d98f60",
        highContrast: false,
        reducedMotion: false,
        theme: "paper",
        version: 3,
      }),
      JSON.stringify({
        accent: "custom",
        customAccent: "nope",
        highContrast: false,
        reducedMotion: false,
        theme: "paper",
        version: 3,
      }),
      JSON.stringify({ version: 3, theme: "paper" }),
    ]
    for (const value of invalidValues) {
      const storage = value === null ? memoryStorage() : memoryStorage({ [appearancePreferencesStorageKey]: value })
      expect(readAppearancePreferences(storage)).toEqual(defaultAppearancePreferences)
    }
  })

  test("tolerates unavailable browser storage without throwing", () => {
    expect(
      readAppearancePreferences({
        getItem() {
          throw new Error("blocked")
        },
      }),
    ).toEqual(defaultAppearancePreferences)
    expect(
      writeAppearancePreferences(
        {
          setItem() {
            throw new Error("blocked")
          },
        },
        defaultAppearancePreferences,
      ),
    ).toBe(false)
  })

  test("applies the same workspace theme to app and Canvas without touching domain data", () => {
    const attributes = new Map<string, string>()
    const styles = new Map<string, string>()
    const target = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      style: {
        removeProperty: (name: string) => styles.delete(name),
        setProperty: (name: string, value: string) => styles.set(name, value),
      },
    }
    applyAppearancePreferences(target, {
      accent: "custom",
      customAccent: "#d98f60",
      highContrast: true,
      reducedMotion: true,
      theme: "graphite",
    })
    expect(Object.fromEntries(attributes)).toEqual({
      "data-app-accent": "custom",
      "data-app-theme": "graphite",
      "data-canvas-theme": "graphite",
      "data-high-contrast": "true",
      "data-reduced-motion": "true",
    })
    expect(styles.get("--ui-brand")).toBe("#d98f60")
    expect(styles.get("--ui-on-brand")).toMatch(/^#[0-9a-f]{6}$/)
    expect(styles.get("--ui-selection")).toMatch(/^#[0-9a-f]{6}$/)

    applyAppearancePreferences(target, {
      ...defaultAppearancePreferences,
      accent: "orange",
    })
    expect(styles.size).toBe(0)
  })
})
