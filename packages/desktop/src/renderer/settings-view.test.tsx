import { describe, expect, mock, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { WebPluginClient } from "../plugin-contracts"
import type { DesktopSkillClient } from "../skill-management-contracts"
import { appMessage } from "./app-language"
import { SettingsView } from "./settings-view"

const noop = () => undefined

const skillClient: DesktopSkillClient = {
  getSkillDetails: mock(async () => {
    throw new Error("not used")
  }),
  getSkillShowcase: mock(async () => null),
  importSkill: mock(async () => null),
  installCatalogSkill: mock(async () => ({
    location: "/managed/storyboard/SKILL.md",
    managed: true,
    name: "storyboard",
    source: "managed" as const,
  })),
  installPluginSkill: mock(async () => ({
    location: "/managed/plugin/SKILL.md",
    managed: true,
    name: "plugin",
    source: "managed" as const,
  })),
  listSkills: mock(async () => ({ catalog: [], skills: [] })),
  onDidChange: mock(() => noop),
  uninstallSkill: mock(async () => true),
}

const pluginClient: WebPluginClient = {
  importPlugin: mock(async () => null),
  installCatalogPlugin: mock(async () => {
    throw new Error("not used")
  }),
  listPlugins: mock(async () => ({ catalog: [], installed: [] })),
  onDidChange: mock(() => noop),
  uninstallPlugin: mock(async () => true),
}

describe("SettingsView", () => {
  test("renders a controlled global language preference and return action", () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        languagePreference="en"
        locale="en"
        onClose={noop}
        onLanguageChange={noop}
        pluginClient={pluginClient}
        skillClient={skillClient}
      />,
    )

    expect(markup).toContain('data-settings-view="true"')
    expect(markup).toContain(appMessage("en", "settings.back"))
    expect(markup).toContain(appMessage("en", "settings.languageDescription"))
    expect(markup).toContain('data-slot="select-trigger"')
    expect(markup).toContain('role="combobox"')
    expect(markup).toContain('aria-haspopup="listbox"')
    expect(markup).toContain(">English</span>")
    expect(markup).not.toContain("<select")
    expect(markup).not.toContain("localStorage")
  })

  test("uses the resolved locale while retaining the explicit preference", () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        languagePreference="zh-CN"
        locale="zh-CN"
        onClose={noop}
        onLanguageChange={noop}
        pluginClient={pluginClient}
        skillClient={skillClient}
      />,
    )

    expect(markup).toContain(appMessage("zh-CN", "settings.title"))
    expect(markup).toContain(appMessage("zh-CN", "settings.general"))
    expect(markup).toContain(">简体中文</span>")
  })

  test("embeds Skill and Plugin management as a settings page", () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        initialSection="capabilities"
        languagePreference="en"
        locale="en"
        onClose={noop}
        onLanguageChange={noop}
        pluginClient={pluginClient}
        skillClient={skillClient}
      />,
    )

    expect(markup).toContain(appMessage("en", "settings.capabilities").replace("&", "&amp;"))
    expect(markup).toContain(`aria-label="${appMessage("en", "capabilities.title").replace("&", "&amp;")}"`)
    expect(markup).toContain('role="tablist"')
    expect(markup).not.toContain('role="dialog"')
    expect(markup).not.toContain('id="settings-language"')
  })
})
