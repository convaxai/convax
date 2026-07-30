import { Button, cn } from "@convax/ui"
import {
  Bot,
  ChevronRight,
  Download,
  ExternalLink,
  FolderInput,
  LoaderCircle,
  LogIn,
  PanelsTopLeft,
  Plug,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  WebPluginAgentMcpConnectionStatus,
  WebPluginAgentMcpConnectionStatuses,
  WebPluginCatalogItem,
  WebPluginClient,
  WebPluginInventory,
  WebPluginManifest,
} from "../plugin-contracts"
import type {
  DesktopSkillCatalogItem,
  DesktopSkillClient,
  DesktopSkillDetails,
  DesktopSkillInventory,
  DesktopSkillShowcase,
  DesktopSkillShowcaseMedia,
  DesktopSkillSummary,
  DesktopSkillTarget,
} from "../skill-management-contracts"
import { appMessage, type AppLocale } from "./app-language"
import { SkillDetailDialog, SkillShowcaseMedia } from "./skill-catalog-preview"

export type CapabilityCenterTab = "skills" | "plugins"

export interface CapabilityCenterProps {
  activeCanvasId?: string
  activeProjectId?: string
  className?: string
  defaultOpen?: boolean
  initialSkillName?: string
  initialTab?: CapabilityCenterTab
  locale?: AppLocale
  onUsePluginOnCanvas?(plugin: WebPluginManifest): void
  onUsePluginInAgent?(plugin: WebPluginManifest): void
  pluginClient: WebPluginClient
  skillClient: DesktopSkillClient
}

export interface CapabilityManagementSurfaceProps {
  activeCanvasId?: string
  activeProjectId?: string
  className?: string
  initialSkillName?: string
  initialTab?: CapabilityCenterTab
  locale?: AppLocale
  onUsePluginOnCanvas?(plugin: WebPluginManifest): void
  onUsePluginInAgent?(plugin: WebPluginManifest): void
  pluginClient: WebPluginClient
  skillClient: DesktopSkillClient
}

type CapabilityAction =
  | "plugin.import"
  | "skill.import"
  | `plugin.connect:${string}`
  | `plugin.install:${string}`
  | `plugin.release:${string}`
  | `plugin.uninstall:${string}`
  | `skill.install:${string}`
  | `skill.uninstall:${string}`

export interface CapabilityCenterDialogProps {
  agentMcpStatuses: WebPluginAgentMcpConnectionStatuses
  busy: CapabilityAction | null
  canUseCanvas: boolean
  canUseAgent: boolean
  error: string | null
  initialSkillName?: string
  loading: boolean
  locale?: AppLocale
  onClose(): void
  onConnectPlugin(id: string): void
  onImportPlugin(): void
  onImportSkill(): void
  onInstallPlugin(id: string): void
  onInstallSkill(id: string): void
  onLoadSkillDetails(target: DesktopSkillTarget): Promise<DesktopSkillDetails>
  onLoadSkillShowcase(
    target: DesktopSkillTarget,
    media: DesktopSkillShowcaseMedia,
  ): Promise<DesktopSkillShowcase | null>
  onOpenPluginRelease(id: string): void
  onTabChange(tab: CapabilityCenterTab): void
  onUninstallPlugin(id: string): void
  onUninstallSkill(name: string): void
  onUsePluginOnCanvas(plugin: WebPluginManifest): void
  onUsePluginInAgent(plugin: WebPluginManifest): void
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

export function formatPluginDownloadBytes(bytes: number, locale: AppLocale) {
  if (bytes < 1_000) return `${bytes} B`
  const units = ["KB", "MB", "GB"] as const
  let value = bytes / 1_000
  let unit: (typeof units)[number] = units[0]
  for (const candidate of units.slice(1)) {
    if (value < 1_000) break
    value /= 1_000
    unit = candidate
  }
  return `${new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 1,
  }).format(value)} ${unit}`
}

type PluginCardItem = WebPluginManifest & Partial<Pick<WebPluginCatalogItem, "download" | "releaseAvailable">>

function PluginActions({
  agentMcpStatus,
  busy,
  canUseCanvas,
  canUseAgent,
  installed,
  locale,
  onConnect,
  onInstall,
  onUninstall,
  onUseOnCanvas,
  onUseInAgent,
  plugin,
  updateAvailable,
}: {
  agentMcpStatus?: WebPluginAgentMcpConnectionStatus
  busy: CapabilityAction | null
  canUseCanvas: boolean
  canUseAgent: boolean
  installed: boolean
  locale: AppLocale
  onConnect(): void
  onInstall(): void
  onUninstall(): void
  onUseOnCanvas(): void
  onUseInAgent(): void
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
      {plugin.entry && plugin.contributes.canvas?.renderer?.create === true ? (
        <Button
          disabled={disabled || !canUseCanvas}
          onClick={onUseOnCanvas}
          size="sm"
          title={canUseCanvas ? undefined : appMessage(locale, "capabilities.openCanvasToUsePlugin")}
        >
          <PanelsTopLeft />
          {appMessage(locale, "capabilities.useOnCanvas")}
        </Button>
      ) : null}
      {plugin.contributes.agent?.mcp ? (
        agentMcpStatus === "connected" ? (
          <Button
            disabled={disabled || !canUseAgent}
            onClick={onUseInAgent}
            size="sm"
            title={canUseAgent ? undefined : appMessage(locale, "capabilities.openProjectToUseAgent")}
            variant="outline"
          >
            <Bot />
            {appMessage(locale, "capabilities.useInAgent")}
          </Button>
        ) : agentMcpStatus === "disabled" || agentMcpStatus === "needs_client_registration" ? null : (
          <Button disabled={disabled} onClick={onConnect} size="sm" variant="outline">
            <BusyIcon active={busy === `plugin.connect:${plugin.id}`} />
            <LogIn />
            {busy === `plugin.connect:${plugin.id}`
              ? appMessage(locale, "capabilities.connectingPlugin")
              : appMessage(
                  locale,
                  agentMcpStatus === "failed" || agentMcpStatus === "unavailable"
                    ? "capabilities.reconnectPlugin"
                    : "capabilities.connectPlugin",
                )}
          </Button>
        )
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
  agentMcpStatus,
  busy,
  canUseCanvas,
  canUseAgent,
  installed,
  installedPlugin,
  installedVersion,
  locale,
  onConnect,
  onInstall,
  onOpenRelease,
  onUninstall,
  onUseOnCanvas,
  onUseInAgent,
  plugin,
  updateAvailable,
}: {
  agentMcpStatus?: WebPluginAgentMcpConnectionStatus
  busy: CapabilityAction | null
  canUseCanvas: boolean
  canUseAgent: boolean
  installed: boolean
  installedPlugin?: WebPluginManifest
  installedVersion?: string
  locale: AppLocale
  onConnect(): void
  onInstall(): void
  onOpenRelease(): void
  onUninstall(): void
  onUseOnCanvas(): void
  onUseInAgent(): void
  plugin: PluginCardItem
  updateAvailable?: boolean
}) {
  const runtimePlugin = installedPlugin ?? plugin
  const agentMcpMessage = (() => {
    if (!installed || !runtimePlugin.contributes.agent?.mcp) return null
    if (agentMcpStatus === "connected") {
      const [skill] = runtimePlugin.contributes.skills ?? []
      return skill && runtimePlugin.contributes.skills?.length === 1
        ? appMessage(locale, "capabilities.agentMcpConnectedSkill", { skill: `$${skill.name}` })
        : appMessage(locale, "capabilities.agentMcpConnected")
    }
    if (agentMcpStatus === "disabled") return appMessage(locale, "capabilities.agentMcpDisabled")
    if (agentMcpStatus === "needs_client_registration") return appMessage(locale, "capabilities.agentMcpClientSetup")
    if (agentMcpStatus === "failed") return appMessage(locale, "capabilities.agentMcpFailed")
    if (agentMcpStatus === "unavailable") return appMessage(locale, "capabilities.agentMcpUnavailable")
    return appMessage(locale, "capabilities.agentMcpNeedsConnection")
  })()
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
      {plugin.download || plugin.releaseAvailable ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {plugin.download ? (
            <span
              className="inline-flex items-center gap-1.5"
              title={appMessage(locale, "capabilities.downloadBreakdown", {
                companionSize: formatPluginDownloadBytes(plugin.download.companionBytes, locale),
                packageSize: formatPluginDownloadBytes(plugin.download.packageBytes, locale),
              })}
            >
              <Download className="size-3.5" />
              {appMessage(locale, "capabilities.downloadSize", {
                size: formatPluginDownloadBytes(plugin.download.totalBytes, locale),
              })}
            </span>
          ) : null}
          {plugin.releaseAvailable ? (
            <Button
              disabled={busy !== null}
              onClick={onOpenRelease}
              size="sm"
              title={appMessage(locale, "capabilities.githubRelease")}
              variant="ghost"
            >
              <BusyIcon active={busy === `plugin.release:${plugin.id}`} />
              <ExternalLink />
              {appMessage(locale, "capabilities.githubRelease")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {(!installed || updateAvailable) && plugin.runtime ? (
        <p
          className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-foreground"
          role="note"
        >
          {appMessage(locale, "capabilities.installToolConsent", { command: plugin.runtime.command })}
        </p>
      ) : null}
      {installed && plugin.contributes.canvas?.renderer?.create ? (
        <p
          className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-medium text-primary"
          role="status"
        >
          {appMessage(locale, "capabilities.pluginReady", { name: plugin.name })}
        </p>
      ) : null}
      {agentMcpMessage ? (
        <p
          className={cn(
            "mt-3 rounded-lg border px-3 py-2 text-xs font-medium",
            agentMcpStatus === "connected"
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-border bg-muted/40 text-foreground",
          )}
          role="status"
        >
          {agentMcpMessage}
          {agentMcpStatus === "connected" && !canUseAgent ? (
            <span className="mt-1 block text-muted-foreground">
              {appMessage(locale, "capabilities.openProjectToUseAgent")}
            </span>
          ) : null}
        </p>
      ) : null}
      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {plugin.capabilities.map((capability) => (
            <StatusPill key={capability}>{capability}</StatusPill>
          ))}
        </div>
        <PluginActions
          agentMcpStatus={agentMcpStatus}
          busy={busy}
          canUseCanvas={canUseCanvas}
          canUseAgent={canUseAgent}
          installed={installed}
          locale={locale}
          onConnect={onConnect}
          onInstall={onInstall}
          onUninstall={onUninstall}
          onUseOnCanvas={onUseOnCanvas}
          onUseInAgent={onUseInAgent}
          plugin={runtimePlugin}
          updateAvailable={updateAvailable}
        />
      </div>
    </article>
  )
}

function SkillCatalogCard({
  busy,
  installAction,
  installLabel,
  locale,
  managedName,
  onInstall,
  onLoadShowcase,
  onOpen,
  onUninstall,
  readOnly,
  skill,
  statusLabel,
  target,
}: {
  busy: CapabilityAction | null
  installAction?: CapabilityAction
  installLabel?: string
  locale: AppLocale
  managedName?: string
  onInstall?(): void
  onLoadShowcase(target: DesktopSkillTarget, media: DesktopSkillShowcaseMedia): Promise<DesktopSkillShowcase | null>
  onOpen(): void
  onUninstall?(): void
  readOnly?: boolean
  skill: DesktopSkillCatalogItem
  statusLabel?: string
  target: DesktopSkillTarget
}) {
  const stableTarget = useMemo<DesktopSkillTarget>(
    () =>
      target.kind === "catalog"
        ? { id: target.id, kind: "catalog" }
        : { kind: "installed", name: target.name, source: target.source },
    [target.kind, target.kind === "catalog" ? target.id : target.name, target.kind === "installed" && target.source],
  )
  const loadShowcase = useCallback(
    (media: DesktopSkillShowcaseMedia) => onLoadShowcase(stableTarget, media),
    [onLoadShowcase, stableTarget],
  )
  const action = managedName
    ? (`skill.uninstall:${managedName}` as const)
    : (installAction ?? (`skill.install:${skill.id}` as const))
  return (
    <article className="group flex min-h-72 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-primary/35">
      <button
        aria-label={`${appMessage(locale, "capabilities.viewDetails")}: ${skill.name}`}
        className="relative block w-full overflow-hidden border-b border-border text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
        onClick={onOpen}
        type="button"
      >
        <SkillShowcaseMedia load={loadShowcase} name={skill.name} />
        <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/45 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-semibold">{skill.name}</h4>
          {skill.installed ? <StatusPill>{appMessage(locale, "capabilities.installed")}</StatusPill> : null}
          {statusLabel ? <StatusPill>{statusLabel}</StatusPill> : null}
        </div>
        <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{skill.description}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <Button onClick={onOpen} size="sm" variant="ghost">
            {appMessage(locale, "capabilities.viewDetails")}
            <ChevronRight />
          </Button>
          {readOnly ? null : managedName ? (
            <Button disabled={busy !== null} onClick={onUninstall} size="sm" variant="ghost">
              <BusyIcon active={busy === action} />
              <Trash2 />
              {appMessage(locale, "capabilities.uninstall")}
            </Button>
          ) : (
            <Button disabled={busy !== null || skill.installed} onClick={onInstall} size="sm" variant="outline">
              <BusyIcon active={busy === action} />
              <Download />
              {skill.installed
                ? appMessage(locale, "capabilities.installed")
                : (installLabel ?? appMessage(locale, "capabilities.installSkill"))}
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}

interface SelectedSkillDetails {
  installLabel?: string
  managedName?: string
  ownerPluginId?: string
  readOnly: boolean
  readOnlyLabel?: string
  skill: DesktopSkillCatalogItem
  target: DesktopSkillTarget
}

function skillTargetKey(target: DesktopSkillTarget) {
  return target.kind === "catalog" ? `catalog:${target.id}` : `installed:${target.source}:${target.name}`
}

export function catalogSkillDetailsTarget(
  id: string,
  managed?: Pick<DesktopSkillSummary, "name" | "source">,
): DesktopSkillTarget {
  return managed ? { kind: "installed", name: managed.name, source: managed.source } : { id, kind: "catalog" }
}

function selectedSkillDetailsByName(
  inventory: DesktopSkillInventory,
  name: string,
  locale: AppLocale,
): SelectedSkillDetails | undefined {
  const installed = inventory.skills.find((skill) => skill.name === name)
  if (installed) {
    const catalog = inventory.catalog.find((candidate) => candidate.id === installed.name)
    const card: DesktopSkillCatalogItem = {
      description: installed.description ?? catalog?.description ?? "",
      id: installed.name,
      installed: installed.managed,
      name: installed.displayName ?? catalog?.name ?? installed.name,
      ...(installed.management.kind === "plugin"
        ? {
            ownerPluginId: installed.management.pluginId,
            ownerPluginName: installed.management.pluginName,
          }
        : {}),
    }
    return {
      managedName: installed.managed ? installed.name : undefined,
      readOnly: installed.source === "global" || installed.management.kind === "plugin",
      readOnlyLabel:
        installed.management.kind === "plugin"
          ? appMessage(locale, "capabilities.providedByPlugin", { name: installed.management.pluginName })
          : undefined,
      skill: card,
      target: { kind: "installed", name: installed.name, source: installed.source },
    }
  }

  const catalog = inventory.catalog.find((skill) => skill.id === name)
  if (!catalog) return undefined
  return {
    installLabel: catalog.ownerPluginId ? appMessage(locale, "capabilities.installProvidingPlugin") : undefined,
    ownerPluginId: catalog.ownerPluginId,
    readOnly: false,
    skill: catalog,
    target: { id: catalog.id, kind: "catalog" },
  }
}

function SkillsPanel({
  busy,
  initialSkillName,
  inventory,
  locale,
  onImport,
  onInstall,
  onInstallPlugin,
  onLoadDetails,
  onLoadShowcase,
  onUninstall,
}: {
  busy: CapabilityAction | null
  initialSkillName?: string
  inventory: DesktopSkillInventory
  locale: AppLocale
  onImport(): void
  onInstall(id: string): void
  onInstallPlugin(id: string): void
  onLoadDetails(target: DesktopSkillTarget): Promise<DesktopSkillDetails>
  onLoadShowcase(target: DesktopSkillTarget, media: DesktopSkillShowcaseMedia): Promise<DesktopSkillShowcase | null>
  onUninstall(name: string): void
}) {
  const [selected, setSelected] = useState<SelectedSkillDetails>()
  const [details, setDetails] = useState<DesktopSkillDetails | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const detailRequest = useRef(0)
  const openedInitialSkill = useRef<string | undefined>(undefined)
  const openDetails = useCallback(
    async (next: SelectedSkillDetails) => {
      const current = ++detailRequest.current
      setSelected(next)
      setDetails(null)
      setDetailError(null)
      setDetailLoading(true)
      try {
        const result = await onLoadDetails(next.target)
        if (detailRequest.current === current) setDetails(result)
      } catch (loadError) {
        if (detailRequest.current === current) setDetailError(errorMessage(loadError))
      } finally {
        if (detailRequest.current === current) setDetailLoading(false)
      }
    },
    [onLoadDetails],
  )
  useEffect(() => {
    if (!initialSkillName || openedInitialSkill.current === initialSkillName) return
    const selection = selectedSkillDetailsByName(inventory, initialSkillName, locale)
    if (!selection) return
    openedInitialSkill.current = initialSkillName
    void openDetails(selection)
  }, [initialSkillName, inventory, locale, openDetails])
  const closeDetails = useCallback(() => {
    detailRequest.current += 1
    setSelected(undefined)
    setDetails(null)
    setDetailError(null)
    setDetailLoading(false)
  }, [])
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {inventory.catalog.map((skill) => {
              const managed = inventory.skills.find((candidate) => candidate.name === skill.id && candidate.managed)
              const pluginManaged = managed?.management.kind === "plugin"
              const ownerName =
                managed?.management.kind === "plugin"
                  ? managed.management.pluginName
                  : (skill.ownerPluginName ?? skill.ownerPluginId)
              const installLabel = skill.ownerPluginId
                ? appMessage(locale, "capabilities.installProvidingPlugin")
                : undefined
              const target = catalogSkillDetailsTarget(skill.id, managed)
              const selection: SelectedSkillDetails = {
                installLabel,
                managedName: managed?.name,
                ownerPluginId: skill.ownerPluginId,
                readOnly: pluginManaged,
                readOnlyLabel:
                  pluginManaged && ownerName
                    ? appMessage(locale, "capabilities.providedByPlugin", { name: ownerName })
                    : undefined,
                skill,
                target,
              }
              return (
                <SkillCatalogCard
                  busy={busy}
                  installAction={skill.ownerPluginId ? (`plugin.install:${skill.ownerPluginId}` as const) : undefined}
                  installLabel={installLabel}
                  key={skill.id}
                  locale={locale}
                  managedName={managed?.name}
                  onInstall={() => (skill.ownerPluginId ? onInstallPlugin(skill.ownerPluginId) : onInstall(skill.id))}
                  onLoadShowcase={onLoadShowcase}
                  onOpen={() => void openDetails(selection)}
                  onUninstall={() => managed && onUninstall(managed.name)}
                  readOnly={pluginManaged}
                  skill={skill}
                  statusLabel={
                    ownerName ? appMessage(locale, "capabilities.providedByPlugin", { name: ownerName }) : undefined
                  }
                  target={target}
                />
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
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {inventory.skills.map((skill) => {
              const catalog = inventory.catalog.find((candidate) => candidate.id === skill.name)
              const target = { kind: "installed", name: skill.name, source: skill.source } as const
              const card: DesktopSkillCatalogItem = {
                description: skill.description ?? catalog?.description ?? "",
                id: skill.name,
                installed: skill.managed,
                name: skill.displayName ?? catalog?.name ?? skill.name,
                ...(skill.management.kind === "plugin"
                  ? {
                      ownerPluginId: skill.management.pluginId,
                      ownerPluginName: skill.management.pluginName,
                    }
                  : {}),
              }
              const readOnly = skill.source === "global" || skill.management.kind === "plugin"
              const selection: SelectedSkillDetails = {
                managedName: skill.managed ? skill.name : undefined,
                readOnly,
                readOnlyLabel:
                  skill.management.kind === "plugin"
                    ? appMessage(locale, "capabilities.providedByPlugin", { name: skill.management.pluginName })
                    : undefined,
                skill: card,
                target,
              }
              return (
                <SkillCatalogCard
                  busy={busy}
                  key={`${skill.source}:${skill.name}`}
                  locale={locale}
                  managedName={skill.managed ? skill.name : undefined}
                  onLoadShowcase={onLoadShowcase}
                  onOpen={() => void openDetails(selection)}
                  onUninstall={() => onUninstall(skill.name)}
                  readOnly={readOnly}
                  skill={card}
                  statusLabel={
                    skill.management.kind === "plugin"
                      ? appMessage(locale, "capabilities.providedByPlugin", { name: skill.management.pluginName })
                      : appMessage(locale, readOnly ? "capabilities.globalReadOnly" : "capabilities.managed")
                  }
                  target={target}
                />
              )
            })}
          </div>
        ) : (
          <EmptySection>{appMessage(locale, "capabilities.noSkills")}</EmptySection>
        )}
      </section>

      {selected ? (
        <SkillDetailDialog
          busy={busy !== null}
          details={details}
          error={detailError}
          installed={selected.skill.installed}
          key={skillTargetKey(selected.target)}
          loading={detailLoading}
          locale={locale}
          installLabel={selected.installLabel}
          managedName={selected.managedName}
          onClose={closeDetails}
          onInstall={() => {
            if (selected.ownerPluginId) onInstallPlugin(selected.ownerPluginId)
            else if (selected.target.kind === "catalog") onInstall(selected.target.id)
          }}
          onRetry={() => void openDetails(selected)}
          onUninstall={() => selected.managedName && onUninstall(selected.managedName)}
          readOnly={selected.readOnly}
          readOnlyLabel={selected.readOnlyLabel}
          skill={selected.skill}
        />
      ) : null}
    </div>
  )
}

function PluginsPanel({
  agentMcpStatuses,
  busy,
  canUseCanvas,
  canUseAgent,
  inventory,
  locale,
  onConnect,
  onImport,
  onInstall,
  onOpenRelease,
  onUninstall,
  onUseOnCanvas,
  onUseInAgent,
}: {
  agentMcpStatuses: WebPluginAgentMcpConnectionStatuses
  busy: CapabilityAction | null
  canUseCanvas: boolean
  canUseAgent: boolean
  inventory: WebPluginInventory
  locale: AppLocale
  onConnect(id: string): void
  onImport(): void
  onInstall(id: string): void
  onOpenRelease(id: string): void
  onUninstall(id: string): void
  onUseOnCanvas(plugin: WebPluginManifest): void
  onUseInAgent(plugin: WebPluginManifest): void
}) {
  const catalogIds = new Set(inventory.catalog.map((plugin) => plugin.id))
  const installedById = new Map(inventory.installed.map((plugin) => [plugin.id, plugin]))
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
                agentMcpStatus={agentMcpStatuses[plugin.id]}
                busy={busy}
                canUseCanvas={canUseCanvas}
                canUseAgent={canUseAgent}
                installed={plugin.installed}
                installedPlugin={installedById.get(plugin.id)}
                installedVersion={plugin.installedVersion}
                key={plugin.id}
                locale={locale}
                onConnect={() => onConnect(plugin.id)}
                onInstall={() => onInstall(plugin.id)}
                onOpenRelease={() => onOpenRelease(plugin.id)}
                onUninstall={() => onUninstall(plugin.id)}
                onUseOnCanvas={() => onUseOnCanvas(installedById.get(plugin.id) ?? plugin)}
                onUseInAgent={() => onUseInAgent(installedById.get(plugin.id) ?? plugin)}
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
                agentMcpStatus={agentMcpStatuses[plugin.id]}
                busy={busy}
                canUseCanvas={canUseCanvas}
                canUseAgent={canUseAgent}
                installed
                installedPlugin={plugin}
                key={plugin.id}
                locale={locale}
                onConnect={() => onConnect(plugin.id)}
                onInstall={() => undefined}
                onOpenRelease={() => undefined}
                onUninstall={() => onUninstall(plugin.id)}
                onUseOnCanvas={() => onUseOnCanvas(plugin)}
                onUseInAgent={() => onUseInAgent(plugin)}
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
            initialSkillName={props.initialSkillName}
            inventory={props.skills}
            locale={locale}
            onImport={props.onImportSkill}
            onInstall={props.onInstallSkill}
            onInstallPlugin={props.onInstallPlugin}
            onLoadDetails={props.onLoadSkillDetails}
            onLoadShowcase={props.onLoadSkillShowcase}
            onUninstall={props.onUninstallSkill}
          />
        ) : props.tab === "plugins" && props.plugins ? (
          <PluginsPanel
            agentMcpStatuses={props.agentMcpStatuses}
            busy={props.busy}
            canUseCanvas={props.canUseCanvas}
            canUseAgent={props.canUseAgent}
            inventory={props.plugins}
            locale={locale}
            onConnect={props.onConnectPlugin}
            onImport={props.onImportPlugin}
            onInstall={props.onInstallPlugin}
            onOpenRelease={props.onOpenPluginRelease}
            onUninstall={props.onUninstallPlugin}
            onUseOnCanvas={props.onUsePluginOnCanvas}
            onUseInAgent={props.onUsePluginInAgent}
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
  activeCanvasId,
  activeProjectId,
  enabled,
  initialTab,
  onUsePluginOnCanvas,
  onUsePluginInAgent,
  pluginClient,
  skillClient,
}: CapabilityManagementSurfaceProps & { enabled: boolean }): CapabilityManagementController {
  const [tab, setTab] = useState<CapabilityCenterTab>(initialTab ?? "skills")
  const [skills, setSkills] = useState<DesktopSkillInventory | null>(null)
  const [plugins, setPlugins] = useState<WebPluginInventory | null>(null)
  const [agentMcpStatuses, setAgentMcpStatuses] = useState<WebPluginAgentMcpConnectionStatuses>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<CapabilityAction | null>(null)
  const request = useRef(0)

  const refresh = useCallback(async () => {
    const current = ++request.current
    setLoading(true)
    try {
      const [skillsResult, pluginsResult, agentMcpStatusesResult] = await Promise.allSettled([
        skillClient.listSkills(activeProjectId ? { scopeId: activeProjectId } : undefined),
        pluginClient.listPlugins(),
        pluginClient.listAgentMcpStatuses(),
      ])
      if (current !== request.current) return
      const failures: unknown[] = []
      if (skillsResult.status === "fulfilled") setSkills(skillsResult.value)
      else failures.push(skillsResult.reason)
      if (pluginsResult.status === "fulfilled") setPlugins(pluginsResult.value)
      else failures.push(pluginsResult.reason)
      if (agentMcpStatusesResult.status === "fulfilled") setAgentMcpStatuses(agentMcpStatusesResult.value)
      else failures.push(agentMcpStatusesResult.reason)
      setError(failures.length ? errorMessage(failures[0]) : null)
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
    async (action: CapabilityAction, operation: () => Promise<unknown>, refreshAfter = true) => {
      if (busy) return
      setBusy(action)
      setError(null)
      let mutationError: string | null = null
      try {
        await operation()
      } catch (cause) {
        mutationError = errorMessage(cause)
      } finally {
        // A failed or partially successful mutation may still change an external
        // connection state. Always reconcile the read model before releasing the
        // busy state, then preserve the host-authored mutation error if there was one.
        if (refreshAfter) await refresh()
        if (mutationError) setError(mutationError)
        setBusy(null)
      }
    },
    [busy, refresh],
  )
  const loadSkillDetails = useCallback(
    (target: DesktopSkillTarget) => skillClient.getSkillDetails({ target }),
    [skillClient],
  )
  const loadSkillShowcase = useCallback(
    (target: DesktopSkillTarget, media: DesktopSkillShowcaseMedia) => skillClient.getSkillShowcase({ media, target }),
    [skillClient],
  )

  return {
    agentMcpStatuses,
    busy,
    canUseCanvas: Boolean(activeProjectId && activeCanvasId),
    canUseAgent: Boolean(activeProjectId),
    error,
    loading,
    onImportPlugin: () => void mutate("plugin.import", () => pluginClient.importPlugin()),
    onConnectPlugin: (id) => void mutate(`plugin.connect:${id}`, () => pluginClient.connectAgentMcp({ id })),
    onImportSkill: () => void mutate("skill.import", () => skillClient.importSkill()),
    onInstallPlugin: (id) => void mutate(`plugin.install:${id}`, () => pluginClient.installCatalogPlugin({ id })),
    onInstallSkill: (id) => void mutate(`skill.install:${id}`, () => skillClient.installCatalogSkill({ id })),
    onLoadSkillDetails: loadSkillDetails,
    onLoadSkillShowcase: loadSkillShowcase,
    onOpenPluginRelease: (id) =>
      void mutate(`plugin.release:${id}`, () => pluginClient.openCatalogPluginRelease({ id }), false),
    onTabChange: setTab,
    onUninstallPlugin: (id) => void mutate(`plugin.uninstall:${id}`, () => pluginClient.uninstallPlugin({ id })),
    onUninstallSkill: (name) => void mutate(`skill.uninstall:${name}`, () => skillClient.uninstallSkill({ name })),
    onUsePluginOnCanvas: (plugin) => onUsePluginOnCanvas?.(plugin),
    onUsePluginInAgent: (plugin) => onUsePluginInAgent?.(plugin),
    plugins,
    skills,
    tab,
  }
}

export function CapabilityManagementSurface({
  activeCanvasId,
  activeProjectId,
  className,
  initialSkillName,
  initialTab = "skills",
  locale = "en",
  onUsePluginOnCanvas,
  onUsePluginInAgent,
  pluginClient,
  skillClient,
}: CapabilityManagementSurfaceProps) {
  const management = useCapabilityManagement({
    activeCanvasId,
    activeProjectId,
    enabled: true,
    initialTab,
    onUsePluginOnCanvas,
    onUsePluginInAgent,
    pluginClient,
    skillClient,
  })
  return (
    <section
      aria-label={appMessage(locale, "capabilities.title")}
      className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card", className)}
    >
      <CapabilityManagementView {...management} initialSkillName={initialSkillName} locale={locale} />
    </section>
  )
}

export function CapabilityCenter({
  activeCanvasId,
  activeProjectId,
  className,
  defaultOpen = false,
  initialSkillName,
  initialTab = "skills",
  locale = "en",
  onUsePluginOnCanvas,
  onUsePluginInAgent,
  pluginClient,
  skillClient,
}: CapabilityCenterProps) {
  const [open, setOpen] = useState(defaultOpen)
  const management = useCapabilityManagement({
    activeCanvasId,
    activeProjectId,
    enabled: open,
    initialTab,
    onUsePluginOnCanvas,
    onUsePluginInAgent,
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
      {open ? (
        <CapabilityCenterDialog
          {...management}
          initialSkillName={initialSkillName}
          locale={locale}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}
