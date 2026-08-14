import { Button, Input, LoadingSpinner, cn } from "@convax/ui"
import { Download, PackagePlus, Pause, Play, RefreshCw, Store, Trash2, Wrench } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import type {
  MarketplaceAddPreview,
  MarketplaceCatalogCard,
  MarketplaceCatalogSourceChoice,
  MarketplaceClient,
  MarketplaceInstalledCapability,
  MarketplacePluginCategory,
  MarketplaceSettingsSource,
} from "../marketplace-contracts"
import {
  getMarketplaceProjection,
  preloadMarketplaceProjection,
  refreshMarketplaceProjection,
} from "./marketplace-projection-cache"

export interface MarketplaceSurfaceProps {
  className?: string
  client: MarketplaceClient
  locale: "en" | "zh-CN"
}

type Page = "catalog" | "installed" | "marketplaces"
type PluginCategoryFilter = "all" | MarketplacePluginCategory

const pluginCategoryOrder: readonly MarketplacePluginCategory[] = ["service", "video", "image", "skill"]

interface SourceChoiceRequest {
  mode: "install" | "update"
  pendingKey: string
}

type CapabilityAction = "disable" | "enable" | "install" | "setup" | "uninstall" | "update"

interface CapabilityOperation {
  action: CapabilityAction
  label: string
}

function capabilityPendingKey(kind: MarketplaceCatalogCard["kind"], id: string) {
  return `capability:${kind}:${id}`
}

export function MarketplaceSurface({ className, client, locale }: MarketplaceSurfaceProps) {
  const initialProjection = getMarketplaceProjection(client)
  const [page, setPage] = useState<Page>("catalog")
  const [pluginCategoryFilter, setPluginCategoryFilter] = useState<PluginCategoryFilter>("all")
  const [projection, setProjection] = useState(initialProjection ?? null)
  const [loading, setLoading] = useState(initialProjection === null)
  const [sourceChoices, setSourceChoices] = useState<MarketplaceCatalogSourceChoice[]>([])
  const [selectedChoice, setSelectedChoice] = useState<MarketplaceCatalogSourceChoice>()
  const [sourceChoiceRequest, setSourceChoiceRequest] = useState<SourceChoiceRequest>()
  const [marketplaceUrl, setMarketplaceUrl] = useState("")
  const [preview, setPreview] = useState<MarketplaceAddPreview>()
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [capabilityOperations, setCapabilityOperations] = useState<ReadonlyMap<string, CapabilityOperation>>(
    () => new Map(),
  )
  const [capabilityErrors, setCapabilityErrors] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [visibleCapabilityErrorKey, setVisibleCapabilityErrorKey] = useState<string>()
  const [error, setError] = useState<string>()
  const capabilityErrorRefs = useRef(new Map<string, HTMLParagraphElement>())
  const latestRefreshPromiseRef = useRef<Promise<void> | null>(null)
  const pendingKeysRef = useRef(new Set<string>())
  const refreshRequestRef = useRef(0)
  const safeFailure =
    locale === "zh-CN"
      ? "无法完成此操作。请重试或在 Marketplace 设置中检查状态。"
      : "The operation could not be completed. Try again or check Marketplace settings."

  const refresh = useCallback(
    (force = true) => {
      const request = ++refreshRequestRef.current
      if (getMarketplaceProjection(client) === null) setLoading(true)
      let current!: Promise<void>
      current = (async () => {
        try {
          const nextProjection = await (force
            ? refreshMarketplaceProjection(client)
            : preloadMarketplaceProjection(client))
          if (request !== refreshRequestRef.current) {
            const latest = latestRefreshPromiseRef.current
            if (latest && latest !== current) await latest
            return
          }
          setProjection(nextProjection)
          setError(undefined)
        } finally {
          if (request === refreshRequestRef.current) setLoading(false)
        }
      })()
      latestRefreshPromiseRef.current = current
      return current
    },
    [client],
  )

  const catalog = projection?.catalog ?? []
  const visibleCatalog =
    pluginCategoryFilter === "all"
      ? catalog
      : catalog.filter((card) => card.kind === "plugin" && card.categories?.includes(pluginCategoryFilter))
  const installed = projection?.installed ?? []
  const pluginRuntimeState = projection?.pluginRuntimeState ?? "available"
  const sources = projection?.sources ?? []

  useEffect(() => {
    void refresh(false).catch(() => setError(safeFailure))
    return client.onDidChange(() => {
      void refresh().catch(() => setError(safeFailure))
    })
  }, [client, refresh, safeFailure])

  useEffect(() => {
    if (!visibleCapabilityErrorKey) return
    const element = capabilityErrorRefs.current.get(visibleCapabilityErrorKey)
    if (!element) return
    element.scrollIntoView?.({ block: "nearest" })
    element.focus({ preventScroll: true })
  }, [capabilityErrors, page, visibleCapabilityErrorKey])

  const mutate = async (key: string, operation: () => Promise<unknown>, capabilityOperation?: CapabilityOperation) => {
    if (pendingKeysRef.current.has(key)) return
    pendingKeysRef.current.add(key)
    setPendingKeys(new Set(pendingKeysRef.current))
    if (capabilityOperation) {
      setCapabilityOperations((current) => {
        const next = new Map(current)
        next.set(key, capabilityOperation)
        return next
      })
      setCapabilityErrors((current) => {
        const next = new Map(current)
        next.delete(key)
        return next
      })
      setVisibleCapabilityErrorKey((current) => (current === key ? undefined : current))
    }
    setError(undefined)
    try {
      await operation()
      await refresh()
    } catch {
      if (capabilityOperation) {
        setCapabilityErrors((current) => {
          const next = new Map(current)
          next.set(key, safeFailure)
          return next
        })
        setVisibleCapabilityErrorKey(key)
      } else {
        setError(safeFailure)
      }
    } finally {
      pendingKeysRef.current.delete(key)
      setPendingKeys(new Set(pendingKeysRef.current))
      if (capabilityOperation) {
        setCapabilityOperations((current) => {
          const next = new Map(current)
          next.delete(key)
          return next
        })
      }
    }
  }

  const text =
    locale === "zh-CN"
      ? {
          add: "添加 Marketplace",
          allCategories: "全部",
          catalog: "扩展",
          choose: "选择来源",
          filterByCategory: "按插件分类筛选",
          import: "导入…",
          install: "安装",
          installed: "已安装",
          loading: "正在加载扩展…",
          marketplaceUrl: "Marketplace URL",
          marketplaces: "Marketplace",
          noCategoryMatches: "没有符合此分类的插件。",
          preview: "预览",
          progressDisable: "正在停用…",
          progressEnable: "正在启用…",
          progressInstall: "正在安装…",
          progressPrepareInstall: "正在准备安装…",
          progressPrepareUpdate: "正在准备更新…",
          progressSetup: "正在完成设置…",
          progressUninstall: "正在卸载…",
          progressUpdate: "正在更新…",
          update: "更新",
        }
      : {
          add: "Add Marketplace",
          allCategories: "All",
          catalog: "Extensions",
          choose: "Choose a source",
          filterByCategory: "Filter by Plugin category",
          import: "Import…",
          install: "Install",
          installed: "Installed",
          loading: "Loading extensions…",
          marketplaceUrl: "Marketplace URL",
          marketplaces: "Marketplaces",
          noCategoryMatches: "No Plugins match this category.",
          preview: "Preview",
          progressDisable: "Disabling…",
          progressEnable: "Enabling…",
          progressInstall: "Installing…",
          progressPrepareInstall: "Preparing install…",
          progressPrepareUpdate: "Preparing update…",
          progressSetup: "Completing setup…",
          progressUninstall: "Uninstalling…",
          progressUpdate: "Updating…",
          update: "Update",
        }
  const kindLabel = (kind: MarketplaceCatalogCard["kind"]) =>
    kind === "plugin" ? "Plugin" : kind === "skill" ? "Skill" : "MCP Server"
  const pluginCategoryLabel = (category: MarketplacePluginCategory) =>
    locale === "zh-CN"
      ? category === "service"
        ? "服务"
        : category === "video"
          ? "视频"
          : category === "image"
            ? "图片"
            : "技能"
      : category === "service"
        ? "Service"
        : category === "video"
          ? "Video"
          : category === "image"
            ? "Image"
            : "Skill"
  const installedStateLabel = (capability: MarketplaceInstalledCapability) =>
    capability.updateRecoveryAvailable
      ? locale === "zh-CN"
        ? "协议过期，可更新修复"
        : "Protocol update available"
      : capability.attention === "plugin-runtime-unavailable-for-session"
        ? locale === "zh-CN"
          ? "本会话不可用"
          : "Unavailable for this session"
        : capability.attention === "plugin-runtime-inactive"
          ? locale === "zh-CN"
            ? "未进入当前运行集"
            : "Not active in this session"
          : capability.attention === "plugin-owned-skill-legacy"
            ? locale === "zh-CN"
              ? "旧版独立 Skill，现由 Plugin 管理"
              : "Legacy standalone Skill, now managed by its Plugin"
            : capability.attention === "managed-skill-recovery"
              ? locale === "zh-CN"
                ? "Skill 发布中断，可重试或卸载"
                : "Skill publication interrupted; retry or uninstall"
              : capability.attention === "integrity-or-authorization"
                ? locale === "zh-CN"
                  ? "需要重新安装"
                  : "Reinstall required"
                : capability.attention === "setup-required-before-enable"
                  ? locale === "zh-CN"
                    ? "启用前需要设置"
                    : "Setup required before enabling"
                  : locale === "zh-CN"
                    ? capability.state === "ready"
                      ? "可用"
                      : capability.state === "disabled"
                        ? "已停用"
                        : capability.state === "setup-required"
                          ? "需要设置"
                          : "需要处理"
                    : capability.state === "ready"
                      ? "Ready"
                      : capability.state === "disabled"
                        ? "Disabled"
                        : capability.state === "setup-required"
                          ? "Setup required"
                          : "Needs attention"
  const sourceHealthLabel = (health: MarketplaceSettingsSource["health"]) =>
    locale === "zh-CN"
      ? health === "available"
        ? "可用"
        : health === "refreshing"
          ? "正在刷新"
          : health === "offline"
            ? "离线"
            : "需要处理"
      : health === "available"
        ? "Available"
        : health === "refreshing"
          ? "Refreshing"
          : health === "offline"
            ? "Offline"
            : "Needs attention"

  return (
    <section aria-busy={loading || undefined} className={cn("space-y-5", className)} data-marketplace-surface="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-control-background p-1">
          {(
            [
              ["catalog", text.catalog],
              ["installed", text.installed],
              ["marketplaces", text.marketplaces],
            ] as const
          ).map(([value, label]) => (
            <Button
              aria-pressed={page === value}
              key={value}
              onClick={() => setPage(value)}
              size="sm"
              variant={page === value ? "secondary" : "ghost"}
            >
              {label}
            </Button>
          ))}
        </div>
        <Button
          aria-busy={pendingKeys.has("import")}
          disabled={loading || pendingKeys.has("import") || pluginRuntimeState === "unavailable-for-session"}
          onClick={() => void mutate("import", () => client.importCapability())}
          size="sm"
          variant="outline"
        >
          {pendingKeys.has("import") ? <LoadingSpinner className="text-current" size="sm" /> : <PackagePlus />}
          {text.import}
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div
          className="flex min-h-40 items-center justify-center gap-2 rounded-xl border border-border-subtle bg-surface-panel text-sm text-text-secondary"
          data-marketplace-loading="true"
          role="status"
        >
          <LoadingSpinner size="sm" />
          {text.loading}
        </div>
      ) : null}

      {!loading && pluginRuntimeState === "unavailable-for-session" ? (
        <p
          className="rounded-lg border border-border-subtle bg-control-background px-3 py-2 text-sm text-text-secondary"
          data-plugin-runtime-unavailable="true"
          role="status"
        >
          {installed.some((capability) => capability.updateRecoveryAvailable)
            ? locale === "zh-CN"
              ? "检测到旧 Host API 协议的 Plugin。它们本会话不会运行，但仍可通过 Update 安装当前协议版本；其他 Plugin 变更和本地导入保持停用。完成更新后请重启 Convax。"
              : "Plugins using a retired Host API were detected. They will not run in this session, but Update can install current-protocol versions. Other Plugin changes and local imports remain disabled. Restart Convax after updating."
            : locale === "zh-CN"
              ? "Plugin 子系统本会话不可用。已安装的 Plugin 不会运行，Plugin 变更和本地导入也已停用。修复 Plugin 状态并重启 Convax 后可重试。"
              : "The Plugin subsystem is unavailable for this session. Installed Plugins will not run, and Plugin changes and local imports are disabled. Repair the Plugin state, then restart Convax."}
        </p>
      ) : null}

      {!loading && page === "catalog" ? (
        <div className="space-y-3">
          <div aria-label={text.filterByCategory} className="flex flex-wrap items-center gap-2" role="group">
            {(["all", ...pluginCategoryOrder] as const).map((category) => (
              <Button
                aria-pressed={pluginCategoryFilter === category}
                key={category}
                onClick={() => setPluginCategoryFilter(category)}
                size="sm"
                variant={pluginCategoryFilter === category ? "secondary" : "outline"}
              >
                {category === "all" ? text.allCategories : pluginCategoryLabel(category)}
              </Button>
            ))}
          </div>
          {visibleCatalog.length === 0 ? (
            <p
              className="rounded-xl border border-border-subtle bg-surface-panel px-4 py-8 text-center text-sm text-text-secondary"
              data-marketplace-category-empty="true"
              role="status"
            >
              {text.noCategoryMatches}
            </p>
          ) : (
            <div className="grid gap-3">
              {visibleCatalog.map((card) => {
                const pendingKey = capabilityPendingKey(card.kind, card.id)
                const pendingOperation = capabilityOperations.get(pendingKey)
                const installing = pendingOperation?.action === "install"
                const capabilityError = capabilityErrors.get(pendingKey)
                const pluginUnavailable = card.kind === "plugin" && pluginRuntimeState === "unavailable-for-session"
                return (
                  <article
                    className="rounded-xl border border-border-subtle bg-surface-panel p-4"
                    key={`${card.kind}:${card.id}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{card.name}</h3>
                          <span className="rounded bg-control-background px-1.5 py-0.5 text-[10px] uppercase text-text-tertiary">
                            {kindLabel(card.kind)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-text-secondary">{card.description}</p>
                        {card.categories?.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {card.categories.map((category) => (
                              <span
                                className="rounded-full bg-control-background px-2 py-0.5 text-xs text-text-secondary"
                                data-plugin-category={category}
                                key={category}
                              >
                                {pluginCategoryLabel(category)}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {card.otherSourceCount > 0 ? (
                          <p className="mt-2 text-xs text-text-tertiary">
                            {locale === "zh-CN"
                              ? `另有 ${card.otherSourceCount} 个来源`
                              : `${card.otherSourceCount} other source${card.otherSourceCount === 1 ? "" : "s"}`}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {card.installed ? (
                          <>
                            {card.updateAvailable ? (
                              <Button
                                aria-busy={pendingOperation?.action === "update"}
                                aria-label={`${text.update} ${card.name}`}
                                disabled={Boolean(pendingOperation) || pluginUnavailable}
                                onClick={() =>
                                  void mutate(
                                    pendingKey,
                                    async () => {
                                      const choices = await client.beginUpdate({
                                        id: card.id,
                                        kind: card.kind,
                                      })
                                      if (choices.length === 0) throw new Error("No update source is available")
                                      setSourceChoiceRequest({ mode: "update", pendingKey })
                                      setSourceChoices(choices)
                                      setSelectedChoice(choices.length === 1 ? choices[0] : undefined)
                                    },
                                    { action: "update", label: text.progressPrepareUpdate },
                                  )
                                }
                                size="icon"
                                variant="outline"
                              >
                                {pendingOperation?.action === "update" ? (
                                  <LoadingSpinner className="text-current" size="sm" />
                                ) : (
                                  <RefreshCw />
                                )}
                              </Button>
                            ) : null}
                            <Button
                              aria-busy={pendingOperation?.action === "uninstall"}
                              aria-label={`${locale === "zh-CN" ? "卸载" : "Uninstall"} ${card.name}`}
                              disabled={Boolean(pendingOperation) || pluginUnavailable}
                              onClick={() =>
                                void mutate(pendingKey, () => client.uninstall({ id: card.id, kind: card.kind }), {
                                  action: "uninstall",
                                  label: text.progressUninstall,
                                })
                              }
                              size="icon"
                              variant="outline"
                            >
                              {pendingOperation?.action === "uninstall" ? (
                                <LoadingSpinner className="text-current" size="sm" />
                              ) : (
                                <Trash2 />
                              )}
                            </Button>
                          </>
                        ) : (
                          <Button
                            aria-busy={installing}
                            aria-label={`${text.install} ${card.name}`}
                            disabled={installing || pluginUnavailable}
                            onClick={() =>
                              void mutate(
                                pendingKey,
                                async () => {
                                  const choices = await client.beginInstall({ id: card.id, kind: card.kind })
                                  if (choices.length === 0) throw new Error("No installable source is available")
                                  setSourceChoiceRequest({ mode: "install", pendingKey })
                                  setSourceChoices(choices)
                                  setSelectedChoice(choices.length === 1 ? choices[0] : undefined)
                                },
                                { action: "install", label: text.progressPrepareInstall },
                              )
                            }
                            size="icon"
                            variant="outline"
                          >
                            {installing ? <LoadingSpinner className="text-current" size="sm" /> : <Download />}
                          </Button>
                        )}
                      </div>
                    </div>
                    {pendingOperation ? (
                      <p
                        aria-live="polite"
                        className="mt-3 text-xs text-text-secondary"
                        data-capability-progress={`${card.kind}:${card.id}`}
                        role="status"
                      >
                        {pendingOperation.label}
                      </p>
                    ) : null}
                    {capabilityError ? (
                      <p
                        className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive outline-none"
                        data-capability-error={`${card.kind}:${card.id}`}
                        ref={(element) => {
                          if (element) capabilityErrorRefs.current.set(pendingKey, element)
                          else capabilityErrorRefs.current.delete(pendingKey)
                        }}
                        role="alert"
                        tabIndex={-1}
                      >
                        {capabilityError}
                      </p>
                    ) : null}
                  </article>
                )
              })}
            </div>
          )}
        </div>
      ) : null}

      {!loading && page === "installed" ? (
        <div className="grid gap-3">
          {installed.map((capability) => {
            const pendingKey = capabilityPendingKey(capability.kind, capability.id)
            const pendingOperation = capabilityOperations.get(pendingKey)
            const capabilityError = capabilityErrors.get(pendingKey)
            const pluginUnavailable = capability.kind === "plugin" && pluginRuntimeState === "unavailable-for-session"
            return (
              <article
                className="rounded-xl border border-border-subtle bg-surface-panel p-4"
                key={`${capability.kind}:${capability.id}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">{capability.name}</h3>
                    <p className="text-xs text-text-tertiary">
                      {capability.sourceLabel} · {capability.version} · {installedStateLabel(capability)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {capability.updateAvailable ? (
                      <Button
                        aria-busy={pendingOperation?.action === "update"}
                        aria-label={`${text.update} ${capability.name}`}
                        disabled={
                          Boolean(pendingOperation) || (pluginUnavailable && !capability.updateRecoveryAvailable)
                        }
                        onClick={() => {
                          void mutate(
                            pendingKey,
                            async () => {
                              const choices = await client.beginUpdate({
                                id: capability.id,
                                kind: capability.kind,
                              })
                              if (choices.length === 0) throw new Error("No update source is available")
                              setSourceChoiceRequest({ mode: "update", pendingKey })
                              setSourceChoices(choices)
                              setSelectedChoice(choices.length === 1 ? choices[0] : undefined)
                            },
                            { action: "update", label: text.progressPrepareUpdate },
                          )
                        }}
                        size="icon"
                        variant="outline"
                      >
                        {pendingOperation?.action === "update" ? (
                          <LoadingSpinner className="text-current" size="sm" />
                        ) : (
                          <RefreshCw />
                        )}
                      </Button>
                    ) : null}
                    {!pluginUnavailable &&
                    capability.kind !== "plugin" &&
                    capability.runtimeScope &&
                    capability.attention !== "plugin-runtime-inactive" &&
                    (capability.state === "setup-required" ||
                      capability.attention === "setup-required-before-enable") ? (
                      <Button
                        aria-busy={pendingOperation?.action === "setup"}
                        aria-label={`${locale === "zh-CN" ? "完成设置" : "Complete setup"} ${capability.name}`}
                        disabled={Boolean(pendingOperation)}
                        onClick={() =>
                          void mutate(pendingKey, () => client.setup({ id: capability.id, kind: capability.kind }), {
                            action: "setup",
                            label: text.progressSetup,
                          })
                        }
                        size="icon"
                        variant="outline"
                      >
                        {pendingOperation?.action === "setup" ? (
                          <LoadingSpinner className="text-current" size="sm" />
                        ) : (
                          <Wrench />
                        )}
                      </Button>
                    ) : null}
                    {capability.state === "disabled" ? (
                      <Button
                        aria-busy={pendingOperation?.action === "enable"}
                        aria-label={`${locale === "zh-CN" ? "启用" : "Enable"} ${capability.name}`}
                        disabled={Boolean(pendingOperation) || pluginUnavailable}
                        onClick={() =>
                          void mutate(pendingKey, () => client.enable({ id: capability.id, kind: capability.kind }), {
                            action: "enable",
                            label: text.progressEnable,
                          })
                        }
                        size="icon"
                        variant="outline"
                      >
                        {pendingOperation?.action === "enable" ? (
                          <LoadingSpinner className="text-current" size="sm" />
                        ) : (
                          <Play />
                        )}
                      </Button>
                    ) : capability.runtimeScope ? (
                      <Button
                        aria-busy={pendingOperation?.action === "disable"}
                        aria-label={`${locale === "zh-CN" ? "停用" : "Disable"} ${capability.name}`}
                        disabled={Boolean(pendingOperation) || pluginUnavailable}
                        onClick={() =>
                          void mutate(pendingKey, () => client.disable({ id: capability.id, kind: capability.kind }), {
                            action: "disable",
                            label: text.progressDisable,
                          })
                        }
                        size="icon"
                        variant="outline"
                      >
                        {pendingOperation?.action === "disable" ? (
                          <LoadingSpinner className="text-current" size="sm" />
                        ) : (
                          <Pause />
                        )}
                      </Button>
                    ) : null}
                    <Button
                      aria-busy={pendingOperation?.action === "uninstall"}
                      aria-label={`${locale === "zh-CN" ? "卸载" : "Uninstall"} ${capability.name}`}
                      disabled={Boolean(pendingOperation) || pluginUnavailable}
                      onClick={() =>
                        void mutate(pendingKey, () => client.uninstall({ id: capability.id, kind: capability.kind }), {
                          action: "uninstall",
                          label: text.progressUninstall,
                        })
                      }
                      size="icon"
                      variant="outline"
                    >
                      {pendingOperation?.action === "uninstall" ? (
                        <LoadingSpinner className="text-current" size="sm" />
                      ) : (
                        <Trash2 />
                      )}
                    </Button>
                  </div>
                </div>
                {pendingOperation ? (
                  <p
                    aria-live="polite"
                    className="mt-3 text-xs text-text-secondary"
                    data-capability-progress={`${capability.kind}:${capability.id}`}
                    role="status"
                  >
                    {pendingOperation.label}
                  </p>
                ) : null}
                {capabilityError ? (
                  <p
                    className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive outline-none"
                    data-capability-error={`${capability.kind}:${capability.id}`}
                    ref={(element) => {
                      if (element) capabilityErrorRefs.current.set(pendingKey, element)
                      else capabilityErrorRefs.current.delete(pendingKey)
                    }}
                    role="alert"
                    tabIndex={-1}
                  >
                    {capabilityError}
                  </p>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : null}

      {!loading && page === "marketplaces" ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-border-subtle bg-surface-panel p-4">
            <label className="text-sm font-medium" htmlFor="marketplace-url">
              {text.marketplaceUrl}
            </label>
            <div className="mt-2 flex gap-2">
              <Input
                id="marketplace-url"
                onChange={(event) => {
                  setMarketplaceUrl(event.currentTarget.value)
                  setPreview(undefined)
                }}
                placeholder="https://…/marketplace.json"
                value={marketplaceUrl}
              />
              <Button
                onClick={() =>
                  void mutate("preview", async () =>
                    setPreview(await client.previewMarketplace({ url: marketplaceUrl })),
                  )
                }
                variant="outline"
              >
                {text.preview}
              </Button>
            </div>
            {preview ? (
              <div className="mt-3 flex items-center justify-between rounded-lg bg-control-background p-3">
                <div>
                  <p className="font-medium">{preview.label}</p>
                  <p className="text-xs text-text-tertiary">
                    {preview.publisher} · {preview.repository} · {preview.packageCount}
                  </p>
                </div>
                <Button
                  onClick={() =>
                    void mutate("add", async () => {
                      await client.addMarketplace({ previewToken: preview.previewToken })
                      setMarketplaceUrl("")
                      setPreview(undefined)
                    })
                  }
                  size="sm"
                >
                  <Store />
                  {text.add}
                </Button>
              </div>
            ) : null}
          </div>
          {sources.map((source) => (
            <article
              className="flex items-center justify-between gap-4 rounded-xl border border-border-subtle bg-surface-panel p-4"
              key={source.id}
            >
              <div>
                <h3 className="font-semibold">{source.label}</h3>
                <p className="text-xs text-text-tertiary">
                  {source.publisher} · {source.repository} · {source.packageCount} · {sourceHealthLabel(source.health)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  aria-label={`${locale === "zh-CN" ? "刷新" : "Refresh"} ${source.label}`}
                  onClick={() =>
                    void mutate(`refresh:${source.id}`, () => client.refreshMarketplace({ id: source.id }))
                  }
                  size="icon"
                  variant="ghost"
                >
                  <RefreshCw />
                </Button>
                {source.removable ? (
                  <Button
                    aria-label={`${locale === "zh-CN" ? "移除" : "Remove"} ${source.label}`}
                    onClick={() =>
                      void mutate(`remove:${source.id}`, () => client.removeMarketplace({ id: source.id }))
                    }
                    size="icon"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {sourceChoices.length > 0 ? (
        <div aria-modal="true" className="fixed inset-0 z-[200] grid place-items-center bg-black/40 p-6" role="dialog">
          <div className="w-full max-w-md rounded-xl bg-surface-panel p-5 shadow-xl">
            <h3 className="text-lg font-semibold">{text.choose}</h3>
            <div className="mt-4 grid gap-2">
              {sourceChoices.map((choice) => (
                <Button
                  className="h-auto justify-start py-3 text-left"
                  aria-pressed={selectedChoice?.confirmationToken === choice.confirmationToken}
                  key={choice.confirmationToken}
                  onClick={() => setSelectedChoice(choice)}
                  variant={selectedChoice?.confirmationToken === choice.confirmationToken ? "secondary" : "outline"}
                >
                  <span>
                    <span className="block font-medium">
                      {choice.marketplaceLabel} · {choice.version}
                    </span>
                    <span className="block text-xs font-normal text-text-tertiary">{choice.description}</span>
                    {choice.permissionSummary.map((permission) => (
                      <span className="block text-xs font-normal text-text-tertiary" key={permission}>
                        {permission}
                      </span>
                    ))}
                  </span>
                </Button>
              ))}
            </div>
            <Button
              className="mt-4 w-full"
              disabled={!selectedChoice || !sourceChoiceRequest || pendingKeys.has(sourceChoiceRequest.pendingKey)}
              onClick={() =>
                sourceChoiceRequest
                  ? void mutate(
                      sourceChoiceRequest.pendingKey,
                      async () => {
                        if (!selectedChoice) return
                        const request = sourceChoiceRequest
                        const choice = selectedChoice
                        setSelectedChoice(undefined)
                        setSourceChoices([])
                        setSourceChoiceRequest(undefined)
                        const confirmed =
                          request.mode === "update"
                            ? await client.confirmUpdate({
                                confirmationToken: choice.confirmationToken,
                              })
                            : await client.confirmInstall({
                                confirmationToken: choice.confirmationToken,
                              })
                        if (request.mode === "update") await client.update(confirmed)
                        else await client.install(confirmed)
                      },
                      {
                        action: sourceChoiceRequest.mode,
                        label: sourceChoiceRequest.mode === "update" ? text.progressUpdate : text.progressInstall,
                      },
                    )
                  : undefined
              }
            >
              {sourceChoiceRequest?.mode === "update"
                ? locale === "zh-CN"
                  ? "确认并更新"
                  : "Confirm and update"
                : locale === "zh-CN"
                  ? "确认并安装"
                  : "Confirm and install"}
            </Button>
            <Button
              className="mt-4 w-full"
              onClick={() => {
                setSelectedChoice(undefined)
                setSourceChoices([])
                setSourceChoiceRequest(undefined)
              }}
              variant="ghost"
            >
              {locale === "zh-CN" ? "取消" : "Cancel"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
