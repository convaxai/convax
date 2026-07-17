import { Button, cn } from "@convax/ui"
import { Download, FolderInput, LoaderCircle, Plug, RefreshCw, Sparkles, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import type { WebPluginClient, WebPluginInventory, WebPluginManifest } from "../plugin-contracts"
import type { DesktopSkillClient, DesktopSkillInventory } from "../skill-management-contracts"
import { appMessage, type AppLocale } from "./app-language"

export type CapabilityCenterTab = "skills" | "plugins"

export interface CapabilityCenterProps {
  activeProjectId?: string
  className?: string
  defaultOpen?: boolean
  initialTab?: CapabilityCenterTab
  locale?: AppLocale
  pluginClient: WebPluginClient
  skillClient: DesktopSkillClient
}

export interface CapabilityManagementSurfaceProps {
  activeProjectId?: string
  className?: string
  initialTab?: CapabilityCenterTab
  locale?: AppLocale
  pluginClient: WebPluginClient
  skillClient: DesktopSkillClient
}

type CapabilityAction =
  | "plugin.import"
  | "skill.import"
  | `plugin.install:${string}`
  | `plugin.skill:${string}`
  | `plugin.uninstall:${string}`
  | `skill.install:${string}`
  | `skill.uninstall:${string}`

export interface CapabilityCenterDialogProps {
  busy: CapabilityAction | null
  error: string | null
  loading: boolean
  locale?: AppLocale
  onClose(): void
  onImportPlugin(): void
  onImportSkill(): void
  onInstallPlugin(id: string): void
  onInstallPluginSkill(id: string): void
  onInstallSkill(id: string): void
  onTabChange(tab: CapabilityCenterTab): void
  onUninstallPlugin(id: string): void
  onUninstallSkill(name: string): void
  plugins: WebPluginInventory | null
  skills: DesktopSkillInventory | null
  tab: CapabilityCenterTab
}

type CapabilityManagementViewProps = Omit<CapabilityCenterDialogProps, "onClose">
type CapabilityManagementController = Omit<CapabilityManagementViewProps, "locale">

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function BusyIcon({ active }: { active: boolean }) {
  return active ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null
}

function StatusPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-muted/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  )
}

function EmptySection({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-28 place-items-center rounded-xl border border-dashed border-border bg-muted/20 px-5 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{children}</h3>
}

function PluginActions({
  busy,
  installed,
  locale,
  onInstall,
  onInstallSkill,
  onUninstall,
  plugin,
  updateAvailable,
}: {
  busy: CapabilityAction | null
  installed: boolean
  locale: AppLocale
  onInstall(): void
  onInstallSkill(): void
  onUninstall(): void
  plugin: WebPluginManifest
  updateAvailable?: boolean
}) {
  const disabled = busy !== null
  if (!installed) {
    return (
      <Button disabled={disabled} onClick={onInstall} size="sm" variant="outline">
        <BusyIcon active={busy === `plugin.install:${plugin.id}`} />
        <Download />
        {appMessage(locale, "capabilities.installPlugin")}
      </Button>
    )
  }
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {updateAvailable ? (
        <Button disabled={disabled} onClick={onInstall} size="sm" variant="outline">
          <BusyIcon active={busy === `plugin.install:${plugin.id}`} />
          <RefreshCw />
          {appMessage(locale, "capabilities.updatePlugin")}
        </Button>
      ) : null}
      {plugin.skill ? (
        <Button disabled={disabled} onClick={onInstallSkill} size="sm" variant="outline">
          <BusyIcon active={busy === `plugin.skill:${plugin.id}`} />
          <Sparkles />
          {appMessage(locale, "capabilities.installCompanionSkill")}
        </Button>
      ) : null}
      <Button
        aria-label={`${appMessage(locale, "capabilities.uninstall")} ${plugin.name}`}
        disabled={disabled}
        onClick={onUninstall}
        size="icon-sm"
        variant="ghost"
      >
        {busy === `plugin.uninstall:${plugin.id}` ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
      </Button>
    </div>
  )
}

function PluginCard({
  busy,
  installed,
  installedVersion,
  locale,
  onInstall,
  onInstallSkill,
  onUninstall,
  plugin,
  updateAvailable,
}: {
  busy: CapabilityAction | null
  installed: boolean
  installedVersion?: string
  locale: AppLocale
  onInstall(): void
  onInstallSkill(): void
  onUninstall(): void
  plugin: WebPluginManifest
  updateAvailable?: boolean
}) {
  return (
    <article className="flex min-h-40 flex-col rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Plug className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-semibold">{plugin.name}</h4>
            <StatusPill>{`v${plugin.version}`}</StatusPill>
            {installed ? (
              <StatusPill>
                {installedVersion
                  ? appMessage(locale, "capabilities.installedVersion", { version: installedVersion })
                  : appMessage(locale, "capabilities.pluginInstalled")}
              </StatusPill>
            ) : null}
            {updateAvailable ? <StatusPill>{appMessage(locale, "capabilities.updateAvailable")}</StatusPill> : null}
            {installed ? <StatusPill>{appMessage(locale, "capabilities.globalThisDevice")}</StatusPill> : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{plugin.id}</p>
        </div>
      </div>
      <p className="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">{plugin.description}</p>
      {installed && plugin.contributes.canvas.renderer.create ? (
        <p
          className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-medium text-primary"
          role="status"
        >
          {appMessage(locale, "capabilities.pluginReady", { name: plugin.name })}
        </p>
      ) : null}
      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {plugin.capabilities.map((capability) => (
            <StatusPill key={capability}>{capability}</StatusPill>
          ))}
        </div>
        <PluginActions
          busy={busy}
          installed={installed}
          locale={locale}
          onInstall={onInstall}
          onInstallSkill={onInstallSkill}
          onUninstall={onUninstall}
          plugin={plugin}
          updateAvailable={updateAvailable}
        />
      </div>
    </article>
  )
}

function SkillsPanel({
  busy,
  inventory,
  locale,
  onImport,
  onInstall,
  onUninstall,
}: {
  busy: CapabilityAction | null
  inventory: DesktopSkillInventory
  locale: AppLocale
  onImport(): void
  onInstall(id: string): void
  onUninstall(name: string): void
}) {
  return (
    <div className="space-y-6" role="tabpanel">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {appMessage(locale, "capabilities.skillsDescription")}
        </p>
        <Button disabled={busy !== null} onClick={onImport} size="sm" variant="outline">
          <BusyIcon active={busy === "skill.import"} />
          <FolderInput />
          {appMessage(locale, "capabilities.importSkill")}
        </Button>
      </div>

      <section className="space-y-3">
        <SectionTitle>{appMessage(locale, "capabilities.includedSkills")}</SectionTitle>
        {inventory.catalog.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {inventory.catalog.map((skill) => {
              const managed = inventory.skills.find((candidate) => candidate.name === skill.id && candidate.managed)
              const action = managed
                ? (`skill.uninstall:${managed.name}` as const)
                : (`skill.install:${skill.id}` as const)
              return (
                <article
                  className="flex min-h-32 flex-col rounded-xl border border-border bg-card p-4 shadow-sm"
                  key={skill.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-semibold">{skill.name}</h4>
                        {skill.installed ? (
                          <StatusPill>{appMessage(locale, "capabilities.installed")}</StatusPill>
                        ) : null}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">{skill.description}</p>
                    </div>
                    {managed ? (
                      <Button
                        disabled={busy !== null}
                        onClick={() => onUninstall(managed.name)}
                        size="sm"
                        variant="ghost"
                      >
                        <BusyIcon active={busy === action} />
                        <Trash2 />
                        {appMessage(locale, "capabilities.uninstall")}
                      </Button>
                    ) : (
                      <Button
                        disabled={busy !== null || skill.installed}
                        onClick={() => onInstall(skill.id)}
                        size="sm"
                        variant="outline"
                      >
                        <BusyIcon active={busy === action} />
                        <Download />
                        {appMessage(locale, skill.installed ? "capabilities.installed" : "capabilities.installSkill")}
                      </Button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <EmptySection>{appMessage(locale, "capabilities.noIncludedSkills")}</EmptySection>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>{appMessage(locale, "capabilities.availableSkills")}</SectionTitle>
        {inventory.skills.length ? (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {inventory.skills.map((skill) => {
              const action = `skill.uninstall:${skill.name}` as const
              return (
                <div
                  className="flex items-center justify-between gap-4 px-4 py-3"
                  key={`${skill.source}:${skill.name}`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{skill.name}</p>
                      <StatusPill>
                        {appMessage(
                          locale,
                          skill.source === "global" ? "capabilities.globalReadOnly" : "capabilities.managed",
                        )}
                      </StatusPill>
                    </div>
                    {skill.description ? (
                      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{skill.description}</p>
                    ) : null}
                  </div>
                  {skill.managed ? (
                    <Button disabled={busy !== null} onClick={() => onUninstall(skill.name)} size="sm" variant="ghost">
                      <BusyIcon active={busy === action} />
                      <Trash2 />
                      {appMessage(locale, "capabilities.uninstall")}
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <EmptySection>{appMessage(locale, "capabilities.noSkills")}</EmptySection>
        )}
      </section>
    </div>
  )
}

function PluginsPanel({
  busy,
  inventory,
  locale,
  onImport,
  onInstall,
  onInstallSkill,
  onUninstall,
}: {
  busy: CapabilityAction | null
  inventory: WebPluginInventory
  locale: AppLocale
  onImport(): void
  onInstall(id: string): void
  onInstallSkill(id: string): void
  onUninstall(id: string): void
}) {
  const catalogIds = new Set(inventory.catalog.map((plugin) => plugin.id))
  const imported = inventory.installed.filter((plugin) => !catalogIds.has(plugin.id))
  return (
    <div className="space-y-6" role="tabpanel">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          {appMessage(locale, "capabilities.pluginsDescription")}
        </p>
        <Button disabled={busy !== null} onClick={onImport} size="sm" variant="outline">
          <BusyIcon active={busy === "plugin.import"} />
          <FolderInput />
          {appMessage(locale, "capabilities.importPlugin")}
        </Button>
      </div>

      <section className="space-y-3">
        <SectionTitle>{appMessage(locale, "capabilities.pluginCatalog")}</SectionTitle>
        {inventory.catalog.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {inventory.catalog.map((plugin) => (
              <PluginCard
                busy={busy}
                installed={plugin.installed}
                installedVersion={plugin.installedVersion}
                key={plugin.id}
                locale={locale}
                onInstall={() => onInstall(plugin.id)}
                onInstallSkill={() => onInstallSkill(plugin.id)}
                onUninstall={() => onUninstall(plugin.id)}
                plugin={plugin}
                updateAvailable={plugin.updateAvailable}
              />
            ))}
          </div>
        ) : (
          <EmptySection>{appMessage(locale, "capabilities.noCatalogPlugins")}</EmptySection>
        )}
      </section>

      {imported.length ? (
        <section className="space-y-3">
          <SectionTitle>{appMessage(locale, "capabilities.importedPlugins")}</SectionTitle>
          <div className="grid gap-3 lg:grid-cols-2">
            {imported.map((plugin) => (
              <PluginCard
                busy={busy}
                installed
                key={plugin.id}
                locale={locale}
                onInstall={() => undefined}
                onInstallSkill={() => onInstallSkill(plugin.id)}
                onUninstall={() => onUninstall(plugin.id)}
                plugin={plugin}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function CapabilityManagementView(props: CapabilityManagementViewProps) {
  const locale = props.locale ?? "en"
  return (
    <>
      <div className="flex items-center gap-1 border-b border-border px-5" role="tablist">
        {(["skills", "plugins"] as const).map((tab) => (
          <button
            aria-selected={props.tab === tab}
            className={cn(
              "relative px-4 py-3 text-sm font-medium capitalize text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              props.tab === tab &&
                "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground",
            )}
            key={tab}
            onClick={() => props.onTabChange(tab)}
            role="tab"
            type="button"
          >
            {appMessage(locale, tab === "skills" ? "capabilities.skills" : "capabilities.plugins")}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {props.error ? (
          <div
            className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {props.error}
          </div>
        ) : null}
        {props.loading && (!props.skills || !props.plugins) ? (
          <div className="grid min-h-72 place-items-center" role="status">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              {appMessage(locale, "capabilities.loading")}
            </div>
          </div>
        ) : props.tab === "skills" && props.skills ? (
          <SkillsPanel
            busy={props.busy}
            inventory={props.skills}
            locale={locale}
            onImport={props.onImportSkill}
            onInstall={props.onInstallSkill}
            onUninstall={props.onUninstallSkill}
          />
        ) : props.tab === "plugins" && props.plugins ? (
          <PluginsPanel
            busy={props.busy}
            inventory={props.plugins}
            locale={locale}
            onImport={props.onImportPlugin}
            onInstall={props.onInstallPlugin}
            onInstallSkill={props.onInstallPluginSkill}
            onUninstall={props.onUninstallPlugin}
          />
        ) : (
          <EmptySection>{appMessage(locale, "capabilities.unavailable")}</EmptySection>
        )}
      </div>
    </>
  )
}

export function CapabilityCenterDialog(props: CapabilityCenterDialogProps) {
  const locale = props.locale ?? "en"
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/20 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !props.busy) props.onClose()
      }}
      role="presentation"
    >
      <section
        aria-labelledby="capability-center-title"
        aria-modal="true"
        className="flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl"
        role="dialog"
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold" id="capability-center-title">
                {appMessage(locale, "capabilities.title")}
              </h2>
              <p className="text-xs text-muted-foreground">{appMessage(locale, "capabilities.description")}</p>
            </div>
          </div>
          <Button
            aria-label={appMessage(locale, "capabilities.close")}
            disabled={props.busy !== null}
            onClick={props.onClose}
            size="icon-sm"
            variant="ghost"
          >
            <X />
          </Button>
        </header>

        <CapabilityManagementView {...props} />
      </section>
    </div>
  )
}

function useCapabilityManagement({
  activeProjectId,
  enabled,
  initialTab,
  pluginClient,
  skillClient,
}: CapabilityManagementSurfaceProps & { enabled: boolean }): CapabilityManagementController {
  const [tab, setTab] = useState<CapabilityCenterTab>(initialTab ?? "skills")
  const [skills, setSkills] = useState<DesktopSkillInventory | null>(null)
  const [plugins, setPlugins] = useState<WebPluginInventory | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<CapabilityAction | null>(null)
  const request = useRef(0)

  const refresh = useCallback(async () => {
    const current = ++request.current
    setLoading(true)
    try {
      const [nextSkills, nextPlugins] = await Promise.all([
        skillClient.listSkills(activeProjectId ? { scopeId: activeProjectId } : undefined),
        pluginClient.listPlugins(),
      ])
      if (current !== request.current) return
      setSkills(nextSkills)
      setPlugins(nextPlugins)
      setError(null)
    } catch (loadError) {
      if (current === request.current) setError(errorMessage(loadError))
    } finally {
      if (current === request.current) setLoading(false)
    }
  }, [activeProjectId, pluginClient, skillClient])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    const disposeSkills = skillClient.onDidChange(() => void refresh())
    const disposePlugins = pluginClient.onDidChange(() => void refresh())
    return () => {
      request.current += 1
      disposePlugins()
      disposeSkills()
    }
  }, [enabled, pluginClient, refresh, skillClient])

  const mutate = useCallback(
    async (action: CapabilityAction, operation: () => Promise<unknown>) => {
      if (busy) return
      setBusy(action)
      setError(null)
      try {
        await operation()
        await refresh()
      } catch (mutationError) {
        setError(errorMessage(mutationError))
      } finally {
        setBusy(null)
      }
    },
    [busy, refresh],
  )

  return {
    busy,
    error,
    loading,
    onImportPlugin: () => void mutate("plugin.import", () => pluginClient.importPlugin()),
    onImportSkill: () => void mutate("skill.import", () => skillClient.importSkill()),
    onInstallPlugin: (id) => void mutate(`plugin.install:${id}`, () => pluginClient.installCatalogPlugin({ id })),
    onInstallPluginSkill: (pluginId) =>
      void mutate(`plugin.skill:${pluginId}`, () => skillClient.installPluginSkill({ pluginId })),
    onInstallSkill: (id) => void mutate(`skill.install:${id}`, () => skillClient.installCatalogSkill({ id })),
    onTabChange: setTab,
    onUninstallPlugin: (id) => void mutate(`plugin.uninstall:${id}`, () => pluginClient.uninstallPlugin({ id })),
    onUninstallSkill: (name) => void mutate(`skill.uninstall:${name}`, () => skillClient.uninstallSkill({ name })),
    plugins,
    skills,
    tab,
  }
}

export function CapabilityManagementSurface({
  activeProjectId,
  className,
  initialTab = "skills",
  locale = "en",
  pluginClient,
  skillClient,
}: CapabilityManagementSurfaceProps) {
  const management = useCapabilityManagement({
    activeProjectId,
    enabled: true,
    initialTab,
    pluginClient,
    skillClient,
  })
  return (
    <section
      aria-label={appMessage(locale, "capabilities.title")}
      className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card", className)}
    >
      <CapabilityManagementView {...management} locale={locale} />
    </section>
  )
}

export function CapabilityCenter({
  activeProjectId,
  className,
  defaultOpen = false,
  initialTab = "skills",
  locale = "en",
  pluginClient,
  skillClient,
}: CapabilityCenterProps) {
  const [open, setOpen] = useState(defaultOpen)
  const management = useCapabilityManagement({
    activeProjectId,
    enabled: open,
    initialTab,
    pluginClient,
    skillClient,
  })

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !management.busy) setOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [management.busy, open])

  return (
    <>
      <Button className={className} onClick={() => setOpen(true)} size="sm" variant="outline">
        <Sparkles />
        {appMessage(locale, "capabilities.title")}
      </Button>
      {open ? <CapabilityCenterDialog {...management} locale={locale} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
