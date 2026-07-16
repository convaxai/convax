import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@convax/ui"
import { ArrowLeft, Languages, Settings2, Sparkles } from "lucide-react"
import { useState } from "react"
import type { WebPluginClient } from "../plugin-contracts"
import type { DesktopSkillClient } from "../skill-management-contracts"
import { appMessage, type AppLanguagePreference, type AppLocale } from "./app-language"
import { CapabilityManagementSurface } from "./capability-center"

export type SettingsSection = "general" | "capabilities"

export interface SettingsViewProps {
  className?: string
  initialSection?: SettingsSection
  languagePreference: AppLanguagePreference
  locale: AppLocale
  onClose(): void
  onLanguageChange(preference: AppLanguagePreference): void
  pluginClient: WebPluginClient
  skillClient: DesktopSkillClient
}

function SettingsNavigationItem({
  active,
  children,
  icon,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  icon: React.ReactNode
  onClick(): void
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium outline-none transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring/40",
      )}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className="[&>svg]:size-4">{icon}</span>
      {children}
    </button>
  )
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
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-6 px-5 py-4">
        <span className="min-w-0">
          <span className="block text-sm font-medium" id="settings-language-label">
            {appMessage(locale, "settings.language")}
          </span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground" id="settings-language-description">
            {appMessage(locale, "settings.languageDescription")}
          </span>
        </span>
        <Select
          onValueChange={(value) => onLanguageChange(value as AppLanguagePreference)}
          value={languagePreference}
        >
          <SelectTrigger
            aria-describedby="settings-language-description"
            aria-labelledby="settings-language-label"
            className="min-w-40"
            id="settings-language"
          >
            <SelectValue>{selectedLanguage}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="en">{appMessage(locale, "settings.language.en")}</SelectItem>
            <SelectItem value="zh-CN">{appMessage(locale, "settings.language.zhCN")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function SettingsView({
  className,
  initialSection = "general",
  languagePreference,
  locale,
  onClose,
  onLanguageChange,
  pluginClient,
  skillClient,
}: SettingsViewProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection)
  const generalTitle = appMessage(locale, "settings.general")
  const capabilitiesTitle = appMessage(locale, "settings.capabilities")

  return (
    <section
      aria-labelledby="settings-view-title"
      className={cn("flex size-full min-h-0 bg-background text-foreground", className)}
      data-settings-view="true"
    >
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-muted/20 px-3 py-4">
        <Button autoFocus className="mb-5 w-fit" onClick={onClose} size="sm" variant="ghost">
          <ArrowLeft />
          {appMessage(locale, "settings.back")}
        </Button>
        <div className="px-3">
          <h1 className="text-lg font-semibold" id="settings-view-title">{appMessage(locale, "settings.title")}</h1>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{appMessage(locale, "settings.localDescription")}</p>
        </div>
        <nav aria-label={appMessage(locale, "settings.title")} className="mt-5 space-y-1">
          <SettingsNavigationItem
            active={section === "general"}
            icon={<Settings2 />}
            onClick={() => setSection("general")}
          >
            {generalTitle}
          </SettingsNavigationItem>
          <SettingsNavigationItem
            active={section === "capabilities"}
            icon={<Sparkles />}
            onClick={() => setSection("capabilities")}
          >
            {capabilitiesTitle}
          </SettingsNavigationItem>
        </nav>
        <div className="mt-auto flex items-center gap-2 rounded-lg border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
          <Languages aria-hidden="true" className="size-4" />
          {appMessage(locale, "settings.language")}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-8 py-8 lg:px-12">
          <header className="mb-6">
            <h2 className="text-2xl font-semibold">{section === "general" ? generalTitle : capabilitiesTitle}</h2>
          </header>
          {section === "general" ? (
            <LanguageSettings
              languagePreference={languagePreference}
              locale={locale}
              onLanguageChange={onLanguageChange}
            />
          ) : (
            <CapabilityManagementSurface
              className="min-h-[32rem]"
              locale={locale}
              pluginClient={pluginClient}
              skillClient={skillClient}
            />
          )}
        </div>
      </main>
    </section>
  )
}
