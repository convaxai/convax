import { Button, Input, LoadingSpinner, cn } from "@convax/ui"
import { Download, PackagePlus, RefreshCw, Store, Trash2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import type {
  MarketplaceAddPreview,
  MarketplaceCatalogCard,
  MarketplaceCatalogSourceChoice,
  MarketplaceClient,
  MarketplaceInstalledCapability,
  MarketplacePluginRuntimeState,
  MarketplaceSettingsSource,
} from "../marketplace-contracts"

export interface MarketplaceSurfaceProps {
  className?: string
  client: MarketplaceClient
  locale: "en" | "zh-CN"
}

type Page = "catalog" | "installed" | "marketplaces"

interface SourceChoiceRequest {
  mode: "install" | "update"
  pendingKey: string
}

function capabilityPendingKey(kind: MarketplaceCatalogCard["kind"], id: string) {
  return `capability:${kind}:${id}`
}

export function MarketplaceSurface({ className, client, locale }: MarketplaceSurfaceProps) {
  const [page, setPage] = useState<Page>("catalog")
  const [catalog, setCatalog] = useState<MarketplaceCatalogCard[]>([])
  const [installed, setInstalled] = useState<MarketplaceInstalledCapability[]>([])
  const [pluginRuntimeState, setPluginRuntimeState] = useState<MarketplacePluginRuntimeState>("available")
  const [sources, setSources] = useState<MarketplaceSettingsSource[]>([])
  const [sourceChoices, setSourceChoices] = useState<MarketplaceCatalogSourceChoice[]>([])
  const [selectedChoice, setSelectedChoice] = useState<MarketplaceCatalogSourceChoice>()
  const [sourceChoiceRequest, setSourceChoiceRequest] = useState<SourceChoiceRequest>()
  const [marketplaceUrl, setMarketplaceUrl] = useState("")
  const [preview, setPreview] = useState<MarketplaceAddPreview>()
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState<string>()
  const pendingKeysRef = useRef(new Set<string>())
  const refreshRequestRef = useRef(0)
  const safeFailure =
    locale === "zh-CN"
      ? "无法完成此操作。请重试或在 Marketplace 设置中检查状态。"
      : "The operation could not be completed. Try again or check Marketplace settings."

  const refresh = useCallback(async () => {
    const request = ++refreshRequestRef.current
    const [nextCatalog, nextInstalled, nextSources] = await Promise.all([
      client.listCatalog(),
      client.listInstalled(),
      client.listMarketplaces(),
    ])
    if (request !== refreshRequestRef.current) return
    setCatalog(nextCatalog.cards)
    setInstalled(nextInstalled.capabilities)
    setPluginRuntimeState(nextInstalled.pluginRuntimeState)
    setSources(nextSources)
  }, [client])

  useEffect(() => {
    void refresh().catch(() => setError(safeFailure))
    return client.onDidChange(() => void refresh())
  }, [client, refresh, safeFailure])

  const mutate = async (key: string, operation: () => Promise<unknown>) => {
    if (pendingKeysRef.current.has(key)) return
    pendingKeysRef.current.add(key)
    setPendingKeys(new Set(pendingKeysRef.current))
    setError(undefined)
    try {
      await operation()
      await refresh()
    } catch {
      setError(safeFailure)
    } finally {
      pendingKeysRef.current.delete(key)
      setPendingKeys(new Set(pendingKeysRef.current))
    }
  }

  const text =
    locale === "zh-CN"
      ? {
          add: "添加 Marketplace",
          catalog: "扩展",
          choose: "选择来源",
          import: "导入…",
          install: "安装",
          installed: "已安装",
          marketplaceUrl: "Marketplace URL",
          marketplaces: "Marketplace",
          preview: "预览",
          update: "更新",
        }
      : {
          add: "Add Marketplace",
          catalog: "Extensions",
          choose: "Choose a source",
          import: "Import…",
          install: "Install",
          installed: "Installed",
          marketplaceUrl: "Marketplace URL",
          marketplaces: "Marketplaces",
          preview: "Preview",
          update: "Update",
        }
  const kindLabel = (kind: MarketplaceCatalogCard["kind"]) =>
    kind === "plugin" ? "Plugin" : kind === "skill" ? "Skill" : "MCP Server"
  const installedStateLabel = (capability: MarketplaceInstalledCapability) =>
    capability.attention === "plugin-runtime-unavailable-for-session"
      ? locale === "zh-CN"
        ? "本会话不可用"
        : "Unavailable for this session"
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
    <section className={cn("space-y-5", className)} data-marketplace-surface="true">
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
          disabled={pendingKeys.has("import") || pluginRuntimeState === "unavailable-for-session"}
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

      {pluginRuntimeState === "unavailable-for-session" ? (
        <p
          className="rounded-lg border border-border-subtle bg-control-background px-3 py-2 text-sm text-text-secondary"
          data-plugin-runtime-unavailable="true"
          role="status"
        >
          {locale === "zh-CN"
            ? "Plugin 子系统本会话不可用。已安装的 Plugin 不会运行，Plugin 变更和本地导入也已停用。修复 Plugin 状态并重启 Convax 后可重试。"
            : "The Plugin subsystem is unavailable for this session. Installed Plugins will not run, and Plugin changes and local imports are disabled. Repair the Plugin state, then restart Convax."}
        </p>
      ) : null}

      {page === "catalog" ? (
        <div className="grid gap-3">
          {catalog.map((card) => {
            const pendingKey = capabilityPendingKey(card.kind, card.id)
            const installing = pendingKeys.has(pendingKey)
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
                    {card.otherSourceCount > 0 ? (
                      <p className="mt-2 text-xs text-text-tertiary">
                        {locale === "zh-CN"
                          ? `另有 ${card.otherSourceCount} 个来源`
                          : `${card.otherSourceCount} other source${card.otherSourceCount === 1 ? "" : "s"}`}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    aria-busy={installing}
                    aria-label={`${text.install} ${card.name}`}
                    disabled={installing || card.installed !== undefined || pluginUnavailable}
                    onClick={() =>
                      void mutate(pendingKey, async () => {
                        const choices = await client.beginInstall({ id: card.id, kind: card.kind })
                        if (choices.length === 0) throw new Error("No installable source is available")
                        setSourceChoiceRequest({ mode: "install", pendingKey })
                        setSourceChoices(choices)
                        setSelectedChoice(choices.length === 1 ? choices[0] : undefined)
                      })
                    }
                    size="sm"
                  >
                    {installing ? <LoadingSpinner className="text-current" size="sm" /> : <Download />}
                    {text.install}
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      ) : null}

      {page === "installed" ? (
        <div className="grid gap-3">
          {installed.map((capability) => {
            const pluginUnavailable = capability.kind === "plugin" && pluginRuntimeState === "unavailable-for-session"
            return (
              <article
                className="flex items-center justify-between gap-4 rounded-xl border border-border-subtle bg-surface-panel p-4"
                key={`${capability.kind}:${capability.id}`}
              >
                <div>
                  <h3 className="font-semibold">{capability.name}</h3>
                  <p className="text-xs text-text-tertiary">
                    {capability.sourceLabel} · {capability.version} · {installedStateLabel(capability)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {capability.updateAvailable ? (
                    <Button
                      disabled={pluginUnavailable}
                      onClick={() => {
                        const pendingKey = capabilityPendingKey(capability.kind, capability.id)
                        void mutate(pendingKey, async () => {
                          const choices = await client.beginUpdate({
                            id: capability.id,
                            kind: capability.kind,
                          })
                          if (choices.length === 0) throw new Error("No update source is available")
                          setSourceChoiceRequest({ mode: "update", pendingKey })
                          setSourceChoices(choices)
                          setSelectedChoice(choices.length === 1 ? choices[0] : undefined)
                        })
                      }}
                      size="sm"
                      variant="outline"
                    >
                      {text.update}
                    </Button>
                  ) : null}
                  {!pluginUnavailable &&
                  (capability.state === "setup-required" || capability.attention === "setup-required-before-enable") ? (
                    <Button
                      onClick={() =>
                        void mutate(`setup:${capability.kind}:${capability.id}`, () =>
                          client.setup({ id: capability.id, kind: capability.kind }),
                        )
                      }
                      size="sm"
                    >
                      {locale === "zh-CN" ? "完成设置" : "Complete setup"}
                    </Button>
                  ) : null}
                  {capability.state === "disabled" ? (
                    <Button
                      disabled={pluginUnavailable}
                      onClick={() =>
                        void mutate(`enable:${capability.kind}:${capability.id}`, () =>
                          client.enable({ id: capability.id, kind: capability.kind }),
                        )
                      }
                      size="sm"
                      variant="outline"
                    >
                      {locale === "zh-CN" ? "启用" : "Enable"}
                    </Button>
                  ) : capability.runtimeScope ? (
                    <Button
                      disabled={pluginUnavailable}
                      onClick={() =>
                        void mutate(`disable:${capability.kind}:${capability.id}`, () =>
                          client.disable({ id: capability.id, kind: capability.kind }),
                        )
                      }
                      size="sm"
                      variant="outline"
                    >
                      {locale === "zh-CN" ? "停用" : "Disable"}
                    </Button>
                  ) : null}
                  <Button
                    aria-label={`${locale === "zh-CN" ? "卸载" : "Uninstall"} ${capability.name}`}
                    disabled={pluginUnavailable}
                    onClick={() =>
                      void mutate(`uninstall:${capability.kind}:${capability.id}`, () =>
                        client.uninstall({ id: capability.id, kind: capability.kind }),
                      )
                    }
                    size="icon"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </article>
            )
          })}
        </div>
      ) : null}

      {page === "marketplaces" ? (
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
                  ? void mutate(sourceChoiceRequest.pendingKey, async () => {
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
                    })
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
