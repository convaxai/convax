import { describe, expect, test } from "bun:test"

import {
  parsePortablePluginI18n,
  parsePortablePluginLocale,
  parsePortablePluginLocalizedText,
  resolvePortablePluginDescription,
  resolvePortablePluginLocalizedText,
  resolvePortablePluginMessage,
  resolvePortablePluginName,
} from "./localization"
import { parsePortablePluginManifestV8 } from "./manifest"

const i18n = parsePortablePluginI18n({
  defaultLocale: "en",
  messages: {
    en: {
      "action.export": "Export",
      "error.export_failed": "Export failed",
      "plugin.description": "Localized description",
      "plugin.name": "Localized name",
    },
    zh: { "action.export": "导出" },
    "zh-CN": { "plugin.name": "本地化名称" },
  },
})

describe("portable Plugin localization", () => {
  test("uses exact, parent, default, and source fallbacks in a fixed order", () => {
    expect(resolvePortablePluginMessage(i18n, "zh-CN", "plugin.name", "Source name")).toBe("本地化名称")
    expect(resolvePortablePluginMessage(i18n, "zh-CN", "action.export", "Source export")).toBe("导出")
    expect(resolvePortablePluginMessage(i18n, "fr-CA", "action.export", "Source export")).toBe("Export")
    expect(resolvePortablePluginMessage(i18n, "fr-CA", "missing.key", "Source fallback")).toBe("Source fallback")
  })

  test("localizes reserved metadata and keyed Host-rendered text", () => {
    const plugin = { description: "Source description", i18n, name: "Source name" }
    expect(resolvePortablePluginName(plugin, "zh-CN")).toBe("本地化名称")
    expect(resolvePortablePluginDescription(plugin, "zh-CN")).toBe("Localized description")
    expect(resolvePortablePluginMessage(i18n, "fr-CA", "error.export_failed", "Source error")).toBe(
      "Export failed",
    )
    expect(
      resolvePortablePluginLocalizedText(
        { default: "Source export", key: "action.export", "zh-CN": "Legacy export" },
        "zh-CN",
        i18n,
      ),
    ).toBe("导出")
    expect(resolvePortablePluginLocalizedText({ default: "Open", "zh-CN": "打开" }, "zh-CN")).toBe("打开")
  })

  test("bounds and freezes resource declarations while rejecting ambiguous tags and keys", () => {
    expect(Object.isFrozen(i18n)).toBeTrue()
    expect(Object.isFrozen(i18n.messages.en)).toBeTrue()
    expect(parsePortablePluginLocale("zh-Hans-CN")).toBe("zh-Hans-CN")
    expect(() => parsePortablePluginLocale("zh_CN")).toThrow("BCP-47")
    expect(() => parsePortablePluginI18n({ defaultLocale: "en", messages: { fr: {} } })).toThrow(
      "declared defaultLocale",
    )
    expect(() => parsePortablePluginLocalizedText({ default: "Open", key: "Action.Open" }, "Title", 120)).toThrow(
      "lowercase message key",
    )
  })

  test("keeps old manifests valid and requires locale negotiation only when i18n is declared", () => {
    const base = {
      capabilities: ["canvas.connectedInputs.read"],
      contributes: { canvas: { renderer: { create: true } } },
      description: "Fixture",
      entry: "web/index.html",
      hostApi: { major: 3, optional: [], required: ["host.context.get"] },
      id: "localized-fixture",
      name: "Fixture",
      schema: "convax.plugin/8",
      version: "1.0.0",
    }
    expect(parsePortablePluginManifestV8(base).i18n).toBeUndefined()
    expect(() => parsePortablePluginManifestV8({ ...base, i18n })).toThrow("must require host.locale.get")
    expect(
      parsePortablePluginManifestV8({
        ...base,
        hostApi: { ...base.hostApi, required: ["host.context.get", "host.locale.get"] },
        i18n,
      }).i18n,
    ).toEqual(i18n)
  })
})
