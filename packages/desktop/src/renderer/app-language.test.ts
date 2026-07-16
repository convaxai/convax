import { describe, expect, test } from "bun:test"
import {
  appLanguageStorageKey,
  appMessage,
  readAppLanguagePreference,
  resolveAppLocale,
  writeAppLanguagePreference,
} from "./app-language"

describe("desktop language preference", () => {
  test("defaults missing or invalid preferences to English", () => {
    expect(readAppLanguagePreference({ getItem: () => null })).toBe("en")
    expect(readAppLanguagePreference({ getItem: () => "not-json" })).toBe("en")
    expect(readAppLanguagePreference({ getItem: () => JSON.stringify({ language: "fr", version: 1 }) })).toBe("en")
    expect(readAppLanguagePreference({ getItem: () => JSON.stringify({ language: "zh-CN", version: 2 }) })).toBe("en")
  })

  test("migrates the removed system preference to English", () => {
    expect(readAppLanguagePreference({
      getItem: () => JSON.stringify({ language: "system", version: 1 }),
    })).toBe("en")
  })

  test("round trips a versioned preference and tolerates unavailable storage", () => {
    let stored = ""
    expect(writeAppLanguagePreference({ setItem: (key, value) => {
      expect(key).toBe(appLanguageStorageKey)
      stored = value
    } }, "zh-CN")).toBe(true)
    expect(readAppLanguagePreference({ getItem: () => stored })).toBe("zh-CN")
    expect(writeAppLanguagePreference({ setItem: () => { throw new Error("unavailable") } }, "en")).toBe(false)
  })

  test("resolves the explicit supported language", () => {
    expect(resolveAppLocale("zh-CN")).toBe("zh-CN")
    expect(resolveAppLocale("en")).toBe("en")
  })

  test("provides complete English and Chinese settings copy", () => {
    expect(appMessage("en", "settings.title")).toBe("Settings")
    expect(appMessage("zh-CN", "settings.title")).toBe("设置")
    expect(appMessage("zh-CN", "appMenu.localWorkspace")).toBe("本地工作区")
  })
})
