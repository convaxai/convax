import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SettingsRow, cn } from "@convax/ui"
import { ArrowLeft, Cloud, Languages, Palette, PawPrint, Settings2, Sparkles } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { WebPluginClient, WebPluginManifest, WebPluginServiceAction } from "../plugin-contracts"
import type { DesktopSkillClient } from "../skill-management-contracts"
import { appMessage, type AppLanguagePreference, type AppLocale } from "./app-language"
import { AppearanceSettings, type AppearanceSaveState } from "./appearance-settings"
import type { AppearancePreferences } from "./appearance-preferences"
import { CapabilityManagementSurface, type CapabilityCenterTab } from "./capability-center"
import { desktopFeatureFlags, type DesktopFeatureFlags } from "./feature-flags"
import { ServicesSurface } from "./plugin-services-view"
import {
  PetSettingsHost,
  type PetSettingsHostClient,
  PetSettingsProviderLoader,
  type PetSettingsProviderSnapshot,
} from "./pet-settings-host"
import type { ServiceCatalogSnapshot } from "./service-catalog-controller"
import { SettingsNavigation, type SettingsNavigationEntry } from "./settings-navigation"

export type SettingsSection = "general" | "appearance" | "services" | "capabilities" | "pets"

export interface SettingsViewProps {
  activeCanvasId?: string
  activeProjectId?: string
  appearancePreferences: AppearancePreferences
  appearanceSaveState?: AppearanceSaveState
  className?: string
  featureFlags?: DesktopFeatureFlags
  initialSection?: SettingsSection
  initialSkillName?: string
  languagePreference: AppLanguagePreference
  locale: AppLocale
  onAppearancePreferencesChange: (preferences: AppearancePreferences) => void
  onClose: () => void
  onLanguageChange: (preference: AppLanguagePreference) => void
  onRefreshServices: () => void
  onServiceAction: (pluginId: string, action: WebPluginServiceAction) => void
  onUsePluginOnCanvas?: (plugin: WebPluginManifest) => void
  onUsePluginInAgent?: (plugin: WebPluginManifest) => void
  petClient: PetSettingsHostClient
  petProviderSnapshot?: PetSettingsProviderSnapshot
  pluginClient: WebPluginClient
  serviceSnapshot: ServiceCatalogSnapshot
  skillClient: DesktopSkillClient
}

function LanguageSettings({
  languagePreference,
  locale,
  onLanguageChange,
}: Pick<SettingsViewProps, "languagePreference" | "locale" | "onLanguageChange">) {
  const selectedLanguage = appMessage(
    locale,
    languagePreference === "zh-CN" ? "settings.language.zhCN" : "settings.language.en",
  )

  return (
    <section aria-labelledby="general-interface-title">
      <h3 className="mb-3 text-sm font-semibold" id="general-interface-title">
        {locale === "zh-CN" ? "界面" : "Interface"}
      </h3>
      <div className="border-y border-border-subtle">
        <SettingsRow
          action={
            <Select
              onValueChange={(value) => isLanguagePreference(value) && onLanguageChange(value)}
              value={languagePreference}
            >
              <SelectTrigger
                aria-describedby="settings-language-description"
                aria-labelledby="settings-language-label"
                className="min-w-36"
                id="settings-language"
              >
                <SelectValue>{selectedLanguage}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="en">{appMessage(locale, "settings.language.en")}</SelectItem>
                <SelectItem value="zh-CN">{appMessage(locale, "settings.language.zhCN")}</SelectItem>
              </SelectContent>
            </Select>
          }
          description={
            <span id="settings-language-description">{appMessage(locale, "settings.languageDescription")}</span>
          }
          label={<span id="settings-language-label">{appMessage(locale, "settings.language")}</span>}
        />
      </div>
    </section>
  )
}

export function SettingsView({
  activeCanvasId,
  activeProjectId,
  appearancePreferences,
  appearanceSaveState = "idle",
  className,
  featureFlags = desktopFeatureFlags,
  initialSection = "general",
  initialSkillName,
  languagePreference,
  locale,
  onAppearancePreferencesChange,
  onClose,
  onLanguageChange,
  onRefreshServices,
  onServiceAction,
  onUsePluginOnCanvas,
  onUsePluginInAgent,
  petClient,
  petProviderSnapshot: injectedPetProviderSnapshot,
  pluginClient,
  serviceSnapshot,
  skillClient,
}: SettingsViewProps) {
  const [loadedPetProviderSnapshot, setLoadedPetProviderSnapshot] = useState<PetSettingsProviderSnapshot>({
    status: "loading",
  })
  const petProviderSnapshot = injectedPetProviderSnapshot ?? loadedPetProviderSnapshot
  const hasPetProvider = petProviderSnapshot.status === "ready"
  const petProviderUnavailable = petProviderSnapshot.status === "absent" || petProviderSnapshot.status === "error"
  const enabledInitialSection =
    (initialSection === "services" && !featureFlags.services) ||
    (initialSection === "capabilities" && !featureFlags.skillsAndPlugins) ||
    (initialSection === "pets" && petProviderUnavailable)
      ? "general"
      : initialSection
  const [section, setSection] = useState<SettingsSection>(enabledInitialSection)
  const [capabilityInitialTab, setCapabilityInitialTab] = useState<CapabilityCenterTab>("skills")

  useEffect(() => {
    setSection(enabledInitialSection)
  }, [enabledInitialSection])

  useEffect(() => {
    if (injectedPetProviderSnapshot !== undefined) return undefined
    const loader = new PetSettingsProviderLoader(petClient)
    setLoadedPetProviderSnapshot(loader.getSnapshot())
    const unsubscribe = loader.subscribe(setLoadedPetProviderSnapshot)
    loader.start()
    return () => {
      unsubscribe()
      loader.dispose()
    }
  }, [injectedPetProviderSnapshot, petClient])

  useEffect(() => {
    if (petProviderUnavailable && section === "pets") setSection("general")
  }, [petProviderUnavailable, section])

  const generalTitle = appMessage(locale, "settings.general")
  const servicesTitle = appMessage(locale, "settings.services")
  const capabilitiesTitle = appMessage(locale, "settings.capabilities")
  const petsTitle = appMessage(locale, "pets.title")
  const appearanceTitle = locale === "zh-CN" ? "外观" : "Appearance"
  const sectionDescriptions: Record<SettingsSection, string> =
    locale === "zh-CN"
      ? {
          appearance: "统一调整应用界面、画布外观与辅助功能偏好。",
          capabilities: "管理可用于 Agent 与画布的技能和插件。",
          general: "配置 Convax 在此设备上的基础界面偏好。",
          pets: "配置已安装插件提供的桌面伙伴。",
          services: "查看和管理为 Convax 提供能力的连接服务。",
        }
      : {
          appearance: "Tune the app interface and Canvas together, including accessibility preferences.",
          capabilities: "Manage the Skills and Plugins available to the Agent and Canvas.",
          general: "Configure foundational Convax interface preferences for this device.",
          pets: "Configure the desktop companion supplied by an installed Plugin.",
          services: "View and manage connected services that provide capabilities to Convax.",
        }
  const navigationItems = useMemo<readonly SettingsNavigationEntry<SettingsSection>[]>(
    () => [
      {
        description: sectionDescriptions.general,
        icon: <Settings2 />,
        label: generalTitle,
        value: "general",
      },
      {
        description: sectionDescriptions.appearance,
        icon: <Palette />,
        label: appearanceTitle,
        value: "appearance",
      },
      ...(hasPetProvider
        ? [
            {
              description: sectionDescriptions.pets,
              icon: <PawPrint />,
              label: petsTitle,
              value: "pets" as const,
            },
          ]
        : []),
      ...(featureFlags.services
        ? [
            {
              description: sectionDescriptions.services,
              icon: <Cloud />,
              label: servicesTitle,
              value: "services" as const,
            },
          ]
        : []),
      ...(featureFlags.skillsAndPlugins
        ? [
            {
              description: sectionDescriptions.capabilities,
              icon: <Sparkles />,
              label: capabilitiesTitle,
              value: "capabilities" as const,
            },
          ]
        : []),
    ],
    [
      appearanceTitle,
      capabilitiesTitle,
      featureFlags.services,
      featureFlags.skillsAndPlugins,
      generalTitle,
      hasPetProvider,
      petsTitle,
      sectionDescriptions.appearance,
      sectionDescriptions.capabilities,
      sectionDescriptions.general,
      sectionDescriptions.pets,
      sectionDescriptions.services,
      servicesTitle,
    ],
  )
  const sectionTitle =
    section === "general"
      ? generalTitle
      : section === "appearance"
        ? appearanceTitle
        : section === "services"
          ? servicesTitle
          : section === "capabilities"
            ? capabilitiesTitle
            : petsTitle

  return (
    <section
      aria-labelledby="settings-view-title"
      className={cn(
        "grid size-full min-h-0 grid-cols-[13rem_minmax(0,1fr)] overflow-hidden bg-surface-canvas text-text-primary md:grid-cols-[15rem_minmax(0,1fr)]",
        className,
      )}
      data-settings-layout="rail-content"
      data-settings-view="true"
      style={{ backgroundColor: "var(--ui-surface-canvas)" }}
    >
      <aside className="flex min-h-0 min-w-0 flex-col border-r border-border-subtle bg-surface-panel px-4 py-5">
        <Button autoFocus className="mb-7 w-fit active:scale-95" onClick={onClose} size="sm" variant="ghost">
          <ArrowLeft />
          {appMessage(locale, "settings.back")}
        </Button>
        <div className="px-2">
          <h1 className="text-xl font-semibold tracking-[-0.015em]" id="settings-view-title">
            {appMessage(locale, "settings.title")}
          </h1>
          <p className="mt-1.5 text-xs leading-5 text-text-tertiary">
            {appMessage(locale, "settings.localDescription")}
          </p>
        </div>
        <SettingsNavigation<SettingsSection>
          ariaLabel={appMessage(locale, "settings.title")}
          className="mt-6"
          emptyLabel={locale === "zh-CN" ? "没有匹配的设置" : "No matching settings"}
          items={navigationItems}
          onValueChange={(value) => {
            if (value === "capabilities") setCapabilityInitialTab("skills")
            setSection(value)
          }}
          searchLabel={locale === "zh-CN" ? "搜索设置" : "Search settings"}
          value={section}
        />
        <div className="mt-auto flex items-center gap-2 px-2 py-2 text-[11px] text-text-tertiary">
          <Languages aria-hidden="true" className="size-4" />
          {locale === "zh-CN" ? "偏好仅保存在此设备" : "Preferences stay on this device"}
        </div>
      </aside>

      <main className="min-w-0 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-8 py-10 lg:px-14 lg:py-12">
          <header className="mb-7 border-b border-border-subtle pb-5">
            <h2 className="text-2xl font-semibold tracking-[-0.015em]">{sectionTitle}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">{sectionDescriptions[section]}</p>
          </header>
          {section === "general" ? (
            <LanguageSettings
              languagePreference={languagePreference}
              locale={locale}
              onLanguageChange={onLanguageChange}
            />
          ) : section === "appearance" ? (
            <AppearanceSettings
              locale={locale}
              onChange={onAppearancePreferencesChange}
              preferences={appearancePreferences}
              saveState={appearanceSaveState}
            />
          ) : section === "services" ? (
            <ServicesSurface
              locale={locale}
              onAction={onServiceAction}
              onInstallServices={
                featureFlags.skillsAndPlugins
                  ? () => {
                      setCapabilityInitialTab("plugins")
                      setSection("capabilities")
                    }
                  : undefined
              }
              onRefresh={onRefreshServices}
              snapshot={serviceSnapshot}
            />
          ) : section === "capabilities" ? (
            <CapabilityManagementSurface
              activeCanvasId={activeCanvasId}
              activeProjectId={activeProjectId}
              className="min-h-[32rem]"
              initialSkillName={initialSkillName}
              initialTab={capabilityInitialTab}
              locale={locale}
              onUsePluginOnCanvas={onUsePluginOnCanvas}
              onUsePluginInAgent={onUsePluginInAgent}
              pluginClient={pluginClient}
              skillClient={skillClient}
            />
          ) : petProviderSnapshot.status === "ready" ? (
            <PetSettingsHost client={petClient} provider={petProviderSnapshot.provider} />
          ) : petProviderSnapshot.status === "loading" ? (
            <div
              aria-busy="true"
              className="min-h-[36rem] rounded-xl border border-border-default bg-surface-raised"
              data-pet-provider-status="loading"
            />
          ) : (
            <div
              className="rounded-xl border border-border-default bg-surface-raised p-5 text-sm text-text-tertiary"
              role="status"
            >
              Pet provider unavailable.
            </div>
          )}
        </div>
      </main>
    </section>
  )
}

function isLanguagePreference(value: string): value is AppLanguagePreference {
  return value === "en" || value === "zh-CN"
}
