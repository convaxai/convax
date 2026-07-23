import { describe, expect, mock, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { WebPluginClient } from "../plugin-contracts"
import type { DesktopSkillClient } from "../skill-management-contracts"
import { appMessage } from "./app-language"
import type { PetSettingsHostClient, PetSettingsProvider } from "./pet-settings-host"
import type { ServiceCatalogSnapshot } from "./service-catalog-controller"
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
    management: { kind: "standalone" as const },
    managed: true,
    name: "storyboard",
    source: "managed" as const,
  })),
  installPluginSkill: mock(async () => ({
    location: "/managed/storyboard/SKILL.md",
    management: { kind: "standalone" as const },
    managed: true,
    name: "storyboard",
    source: "managed" as const,
  })),
  listSkills: mock(async () => ({ catalog: [], skills: [] })),
  onDidChange: mock(() => noop),
  openSkill: mock(async () => undefined),
  uninstallSkill: mock(async () => true),
}

const pluginClient: WebPluginClient = {
  importPlugin: mock(async () => null),
  installCatalogPlugin: mock(async () => {
    throw new Error("not used")
  }),
  listPlugins: mock(async () => ({ catalog: [], installed: [] })),
  onDidChange: mock(() => noop),
  openCatalogPluginRelease: mock(async () => true),
  uninstallPlugin: mock(async () => true),
}

const petProvider: PetSettingsProvider = {
  generation: 7,
  pluginId: "soft-companion",
  settingsUrl: "convax-plugin://soft-companion/settings/index.html",
}

const petClient: PetSettingsHostClient = {
  connectSettings: mock(async () => undefined),
  disconnectSettings: mock(() => undefined),
  getProvider: mock(async () => petProvider),
  onProviderChanged: mock(() => noop),
}

const serviceSnapshot: ServiceCatalogSnapshot = {
  loading: false,
  services: [
    {
      authentication: "not-applicable",
      billing: { kind: "free" },
      capabilities: ["llm"],
      description: "OpenCode agent runtime",
      kind: "builtin",
      loading: false,
      models: [],
      name: "OpenCode",
      serviceId: "builtin:opencode",
      state: "connected",
    },
  ],
}

describe("SettingsView", () => {
  test("renders a controlled global language preference and return action", () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        languagePreference="en"
        locale="en"
        onClose={noop}
        onLanguageChange={noop}
        onRefreshServices={noop}
        onServiceAction={noop}
        petClient={petClient}
        pluginClient={pluginClient}
        serviceSnapshot={serviceSnapshot}
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
        onRefreshServices={noop}
        onServiceAction={noop}
        petClient={petClient}
        pluginClient={pluginClient}
        serviceSnapshot={serviceSnapshot}
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
        onRefreshServices={noop}
        onServiceAction={noop}
        petClient={petClient}
        pluginClient={pluginClient}
        serviceSnapshot={serviceSnapshot}
        skillClient={skillClient}
      />,
    )

    expect(markup).toContain(appMessage("en", "settings.capabilities").replace("&", "&amp;"))
    expect(markup).toContain(`aria-label="${appMessage("en", "capabilities.title").replace("&", "&amp;")}"`)
    expect(markup).toContain('role="tablist"')
    expect(markup).not.toContain('role="dialog"')
    expect(markup).not.toContain('id="settings-language"')
  })

  test("exposes installed Plugin services as a host-rendered settings section", () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        initialSection="services"
        languagePreference="en"
        locale="en"
        onClose={noop}
        onLanguageChange={noop}
        onRefreshServices={noop}
        onServiceAction={noop}
        petClient={petClient}
        pluginClient={pluginClient}
        serviceSnapshot={serviceSnapshot}
        skillClient={skillClient}
      />,
    )

    expect(markup).toContain(appMessage("en", "settings.services"))
    expect(markup).toContain(`aria-label="${appMessage("en", "services.title")}"`)
    expect(markup).toContain("OpenCode")
    expect(markup).toContain(appMessage("en", "services.free"))
    expect(markup).not.toContain("iframe")
  })

  test("hides disabled build-time sections and falls back to General", () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        featureFlags={{ services: false, skillsAndPlugins: false }}
        initialSection="services"
        languagePreference="en"
        locale="en"
        onClose={noop}
        onLanguageChange={noop}
        onRefreshServices={noop}
        onServiceAction={noop}
        petClient={petClient}
        pluginClient={pluginClient}
        serviceSnapshot={serviceSnapshot}
        skillClient={skillClient}
      />,
    )

    expect(markup).toContain(appMessage("en", "settings.general"))
    expect(markup).toContain('id="settings-language"')
    expect(markup).not.toContain(appMessage("en", "settings.services"))
    expect(markup).not.toContain(appMessage("en", "settings.capabilities").replace("&", "&amp;"))
    expect(markup).not.toContain("OpenCode")
  })

  test("hides Pet settings navigation and content when no provider is installed", () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        initialSection="pets"
        languagePreference="en"
        locale="en"
        onClose={noop}
        onLanguageChange={noop}
        onRefreshServices={noop}
        onServiceAction={noop}
        petClient={petClient}
        pluginClient={pluginClient}
        serviceSnapshot={serviceSnapshot}
        skillClient={skillClient}
      />,
    )

    expect(markup).not.toContain("Pets")
    expect(markup).not.toContain("iframe")
    expect(markup).toContain('id="settings-language"')
  })

  test("mounts only the installed Plugin-owned Pet settings surface", () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        initialSection="pets"
        languagePreference="en"
        locale="en"
        onClose={noop}
        onLanguageChange={noop}
        onRefreshServices={noop}
        onServiceAction={noop}
        petClient={petClient}
        petProvider={petProvider}
        pluginClient={pluginClient}
        serviceSnapshot={serviceSnapshot}
        skillClient={skillClient}
      />,
    )

    expect(markup).toContain("Pets")
    expect(markup).toContain('src="convax-plugin://soft-companion/settings/index.html"')
    expect(markup).toContain('sandbox="allow-scripts"')
    expect(markup).not.toContain("allow-same-origin")
    expect(markup).not.toContain('type="file"')
    expect(markup).not.toContain("pet-card")
    expect(markup).not.toContain("Import")
    expect(markup).not.toContain("Delete")
    expect(markup).not.toContain("Upload")
  })
})
