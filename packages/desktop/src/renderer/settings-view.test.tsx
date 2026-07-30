import { describe, expect, mock, test } from "bun:test"
import { Window } from "happy-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { webPluginAssetUrl } from "../plugin-asset-contract"
import type { WebPluginClient } from "../plugin-contracts"
import type { MarketplaceClient } from "../marketplace-contracts"
import type { DesktopSkillClient } from "../skill-management-contracts"
import { appMessage } from "./app-language"
import type { PetSettingsHostClient, PetSettingsProvider, PetSettingsProviderSnapshot } from "./pet-settings-host"
import type { ServiceCatalogSnapshot } from "./service-catalog-controller"
import { defaultAppearancePreferences } from "./appearance-preferences"
import { SettingsView } from "./settings-view"

const noop = () => undefined
const marketplaceClient = {} as MarketplaceClient

const petSettingsUrl = webPluginAssetUrl(
  {
    activeRevision: 7,
    activeSetDigest: "a".repeat(64),
    id: "soft-companion",
    snapshotDigest: "b".repeat(64),
    version: "1.0.0",
  },
  "settings/index.html",
)

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
  listSkills: mock(async () => ({ catalog: [], skills: [] })),
  onDidChange: mock(() => noop),
  openSkill: mock(async () => undefined),
  uninstallSkill: mock(async () => true),
}

const pluginClient: WebPluginClient = {
  connectAgentMcp: mock(async () => undefined),
  importPlugin: mock(async () => null),
  installCatalogPlugin: mock(async () => {
    throw new Error("not used")
  }),
  listAgentMcpStatuses: mock(async () => ({})),
  listPlugins: mock(async () => ({ catalog: [], installed: [] })),
  onDidChange: mock(() => noop),
  openCatalogPluginRelease: mock(async () => true),
  uninstallPlugin: mock(async () => true),
}

const petProvider: PetSettingsProvider = {
  generation: 7,
  pluginId: "soft-companion",
  settingsUrl: petSettingsUrl,
}

const petClient: PetSettingsHostClient = {
  connectSettings: mock(async () => undefined),
  disconnectSettings: mock(() => undefined),
  getProvider: mock(async () => undefined),
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

function installTestWindow() {
  const testWindow = new Window({ url: "https://convax.test/" })
  const globals = {
    Element: testWindow.Element,
    Event: testWindow.Event,
    HTMLElement: testWindow.HTMLElement,
    Node: testWindow.Node,
    document: testWindow.document,
    window: testWindow,
  }
  const originalDescriptors = new Map<string, PropertyDescriptor | undefined>()
  for (const [name, value] of Object.entries(globals)) {
    originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true })
  }
  originalDescriptors.set(
    "IS_REACT_ACT_ENVIRONMENT",
    Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"),
  )
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  })
  return async () => {
    await testWindow.happyDOM.close()
    for (const [name, descriptor] of originalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
}

describe("SettingsView", () => {
  test("renders Appearance as a dedicated full-page settings section", () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        appearancePreferences={{ ...defaultAppearancePreferences, theme: "midnight" }}
        appearanceSaveState="saved"
        initialSection="appearance"
        languagePreference="en"
        locale="en"
        onAppearancePreferencesChange={noop}
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

    expect(markup).toContain("Appearance")
    expect(markup).toContain('data-appearance-settings="true"')
    expect(markup).toContain('aria-label="Search settings"')
    expect(markup).toContain("Saved automatically")
    expect(markup).toContain('data-settings-layout="rail-content"')
    expect(markup).toContain("convax-settings-shell")
    expect(markup).toContain("convax-settings-rail")
    expect(markup).toContain("convax-settings-content")
    expect(markup).toContain("grid-cols-[13rem_minmax(0,1fr)]")
    expect(markup).toContain("<aside")
    expect(markup).toContain("min-w-0")
    expect(markup).not.toContain("w-64")
    expect(markup).not.toContain('role="dialog"')
    expect(markup).not.toContain("localStorage")
  })

  test("renders a controlled global language preference and return action", () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        appearancePreferences={defaultAppearancePreferences}
        languagePreference="en"
        locale="en"
        onClose={noop}
        onAppearancePreferencesChange={noop}
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
    expect(markup).toContain('data-settings-layout="rail-content"')
    expect(markup).toContain("grid-cols-[13rem_minmax(0,1fr)]")
    expect(markup).toContain("md:grid-cols-[15rem_minmax(0,1fr)]")
    expect(markup).not.toContain("min-w-[45rem]")
    expect(markup).not.toContain("sm:flex-row")
    expect(markup).toContain(appMessage("en", "settings.back"))
    expect(markup).toContain(appMessage("en", "settings.languageDescription"))
    expect(markup).toContain('data-slot="select-trigger"')
    expect(markup).toContain('role="combobox"')
    expect(markup).toContain('aria-haspopup="listbox"')
    expect(markup).toContain('data-slot="settings-row"')
    expect(markup).toContain(">English</span>")
    expect(markup).not.toContain("<select")
    expect(markup).not.toContain("localStorage")
    expect(markup).not.toContain("Open at login")
    expect(markup).not.toContain("Autosave")
    expect(markup).not.toContain("Default project location")
    expect(markup).not.toContain("Updates")
  })

  test("syncs a new initial section target while remaining mounted", async () => {
    const window = new Window()
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    const reactGlobal = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean
    }
    const previousActEnvironment = reactGlobal.IS_REACT_ACT_ENVIRONMENT
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      document: window.document,
      window,
    })
    let root: Root | undefined

    const renderSettings = (initialSection: "general" | "appearance") => (
      <SettingsView
        appearancePreferences={defaultAppearancePreferences}
        initialSection={initialSection}
        languagePreference="en"
        locale="en"
        onClose={noop}
        onAppearancePreferencesChange={noop}
        onLanguageChange={noop}
        onRefreshServices={noop}
        onServiceAction={noop}
        petClient={petClient}
        petProviderSnapshot={{ status: "absent" }}
        pluginClient={pluginClient}
        serviceSnapshot={serviceSnapshot}
        skillClient={skillClient}
      />
    )

    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => root?.render(renderSettings("general")))
      expect(document.querySelector('[data-settings-navigation-item="general"]')?.getAttribute("aria-current")).toBe(
        "page",
      )
      expect(document.querySelector("main h2")?.textContent).toBe("General")

      await act(async () => root?.render(renderSettings("appearance")))
      expect(document.querySelector('[data-settings-navigation-item="appearance"]')?.getAttribute("aria-current")).toBe(
        "page",
      )
      expect(document.querySelector("main h2")?.textContent).toBe("Appearance")
    } finally {
      if (root) await act(async () => root?.unmount())
      Object.assign(globalThis, {
        IS_REACT_ACT_ENVIRONMENT: previousActEnvironment,
        document: previousDocument,
        window: previousWindow,
      })
    }
  })

  test("uses the resolved locale while retaining the explicit preference", () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        appearancePreferences={defaultAppearancePreferences}
        languagePreference="zh-CN"
        locale="zh-CN"
        onClose={noop}
        onAppearancePreferencesChange={noop}
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

  test("embeds the unified Marketplace surface as the capabilities settings page", () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        appearancePreferences={defaultAppearancePreferences}
        initialSection="capabilities"
        languagePreference="en"
        locale="en"
        marketplaceClient={marketplaceClient}
        onClose={noop}
        onAppearancePreferencesChange={noop}
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
    expect(markup).toContain("Extensions")
    expect(markup).toContain("Marketplaces")
    expect(markup).toContain("Import…")
    expect(markup).not.toContain('role="dialog"')
    expect(markup).not.toContain('id="settings-language"')
  })

  test("exposes installed Plugin services as a host-rendered settings section", () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        appearancePreferences={defaultAppearancePreferences}
        initialSection="services"
        languagePreference="en"
        locale="en"
        onClose={noop}
        onAppearancePreferencesChange={noop}
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
    expect(markup).toContain(`>${appMessage("en", "services.install")}</button>`)
    expect(markup).toContain('data-settings-section="services"')
    expect(markup).toContain("max-w-none px-5 py-6")
    expect(markup).toContain("mb-4 pb-4")
    expect(markup).not.toContain("iframe")
  })

  test("routes the Services install action to the Plugin catalog", async () => {
    const restoreWindow = installTestWindow()
    let root: Root | undefined
    try {
      const container = document.createElement("div")
      document.body.append(container)
      root = createRoot(container)
      await act(async () => {
        root?.render(
          <SettingsView
            appearancePreferences={defaultAppearancePreferences}
            initialSection="services"
            languagePreference="en"
            locale="en"
            onAppearancePreferencesChange={noop}
            onClose={noop}
            onLanguageChange={noop}
            onRefreshServices={noop}
            onServiceAction={noop}
            petClient={petClient}
            petProviderSnapshot={{ status: "absent" }}
            pluginClient={pluginClient}
            serviceSnapshot={serviceSnapshot}
            skillClient={skillClient}
          />,
        )
      })

      const install = [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === appMessage("en", "services.install"),
      )
      expect(install).toBeDefined()
      await act(async () => {
        install?.click()
        await Promise.resolve()
      })
      const pluginTab = [...document.querySelectorAll<HTMLButtonElement>('button[role="tab"]')].find(
        (button) => button.textContent?.trim() === appMessage("en", "capabilities.plugins"),
      )
      expect(pluginTab?.getAttribute("aria-selected")).toBe("true")
    } finally {
      if (root) await act(async () => root?.unmount())
      await restoreWindow()
    }
  })

  test("hides disabled build-time sections and falls back to General", () => {
    const markup = renderToStaticMarkup(
      <SettingsView
        appearancePreferences={defaultAppearancePreferences}
        featureFlags={{ services: false, skillsAndPlugins: false }}
        initialSection="services"
        languagePreference="en"
        locale="en"
        onClose={noop}
        onAppearancePreferencesChange={noop}
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

  test("keeps the requested Pet section in a generic shell while provider discovery is loading", () => {
    const markup = renderPetSettings({ status: "loading" })

    expect(markup).toContain('data-pet-provider-status="loading"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).not.toContain("iframe")
    expect(markup).not.toContain('id="settings-language"')
  })

  test("hides Pet settings and falls back to General when the provider is absent or failed", () => {
    for (const snapshot of [{ status: "absent" }, { status: "error" }] as const) {
      const markup = renderPetSettings(snapshot)

      expect(markup).not.toContain("Pets")
      expect(markup).not.toContain("iframe")
      expect(markup).toContain('id="settings-language"')
    }
  })

  test("mounts only the installed Plugin-owned Pet settings surface", () => {
    const markup = renderPetSettings({ provider: petProvider, status: "ready" })

    expect(markup).toContain("Pets")
    expect(markup).toContain(`src="${petSettingsUrl}"`)
    expect(markup).toContain('sandbox="allow-scripts"')
    expect(markup).not.toContain("allow-same-origin")
    expect(markup).not.toContain('type="file"')
    expect(markup).not.toContain("pet-card")
    expect(markup).not.toContain("Import")
    expect(markup).not.toContain("Delete")
    expect(markup).not.toContain("Upload")
  })

  function renderPetSettings(petProviderSnapshot: PetSettingsProviderSnapshot) {
    return renderToStaticMarkup(
      <SettingsView
        appearancePreferences={defaultAppearancePreferences}
        initialSection="pets"
        languagePreference="en"
        locale="en"
        onClose={noop}
        onAppearancePreferencesChange={noop}
        onLanguageChange={noop}
        onRefreshServices={noop}
        onServiceAction={noop}
        petClient={petClient}
        petProviderSnapshot={petProviderSnapshot}
        pluginClient={pluginClient}
        serviceSnapshot={serviceSnapshot}
        skillClient={skillClient}
      />,
    )
  }
})
