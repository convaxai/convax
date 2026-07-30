import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider, useTranslation } from "react-i18next"
import {
  appLanguageStorageKey,
  appI18n,
  appMessage,
  changeAppLanguage,
  readAppLanguagePreference,
  resolveAppLocale,
  writeAppLanguagePreference,
} from "./app-language"

function TranslationProbe() {
  const { t } = useTranslation()
  return createElement("span", null, t("settings.title"))
}

describe("desktop language preference", () => {
  test("defaults missing or invalid preferences to English", () => {
    expect(readAppLanguagePreference({ getItem: () => null })).toBe("en")
    expect(readAppLanguagePreference({ getItem: () => "not-json" })).toBe("en")
    expect(readAppLanguagePreference({ getItem: () => JSON.stringify({ language: "fr", version: 1 }) })).toBe("en")
    expect(readAppLanguagePreference({ getItem: () => JSON.stringify({ language: "zh-CN", version: 2 }) })).toBe("en")
  })

  test("migrates the removed system preference to English", () => {
    expect(
      readAppLanguagePreference({
        getItem: () => JSON.stringify({ language: "system", version: 1 }),
      }),
    ).toBe("en")
  })

  test("round trips a versioned preference and tolerates unavailable storage", () => {
    let stored = ""
    expect(
      writeAppLanguagePreference(
        {
          setItem: (key, value) => {
            expect(key).toBe(appLanguageStorageKey)
            stored = value
          },
        },
        "zh-CN",
      ),
    ).toBe(true)
    expect(readAppLanguagePreference({ getItem: () => stored })).toBe("zh-CN")
    expect(
      writeAppLanguagePreference(
        {
          setItem: () => {
            throw new Error("unavailable")
          },
        },
        "en",
      ),
    ).toBe(false)
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

  test("uses i18next interpolation without escaping desktop text", () => {
    expect(appMessage("en", "capabilities.pluginReady", { name: "<Storyboard>" })).toBe(
      "Ready to add <Storyboard> to the current Canvas.",
    )
    expect(appMessage("zh-CN", "services.modelResultsLimited", { shown: 10, total: 42 })).toBe(
      "当前显示前 10 / 42 个模型，请搜索以缩小范围。",
    )
  })

  test("synchronizes the shared React i18next instance", async () => {
    await changeAppLanguage("zh-CN")
    expect(appI18n.resolvedLanguage).toBe("zh-CN")
    expect(appI18n.t("settings.title")).toBe("设置")
    expect(
      renderToStaticMarkup(createElement(I18nextProvider, { i18n: appI18n }, createElement(TranslationProbe))),
    ).toBe("<span>设置</span>")

    await changeAppLanguage("en")
    expect(appI18n.resolvedLanguage).toBe("en")
  })
})
