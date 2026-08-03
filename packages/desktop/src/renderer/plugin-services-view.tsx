import { Button, cn } from "@convax/ui"
import { Bot, Cloud, LoaderCircle, RefreshCw } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

import type { PluginServiceStatus } from "../plugin-service-contracts"
import type { WebPluginServiceAction } from "../plugin-contracts"
import { appMessage, type AppLocale } from "./app-language"
import { ServiceDetail, PluginServiceSignOutConfirmation } from "./plugin-service-detail"
import { capabilityLabel, serviceStateLabel } from "./service-display-format"
import { type ServiceCatalogEntry, type ServiceCatalogSnapshot } from "./service-catalog-controller"

export { PluginServiceSignOutConfirmation }

function serviceStateDot(state: PluginServiceStatus["state"]) {
  return state === "connected" ? "bg-status-success" : state === "attention" ? "bg-status-warning" : "bg-text-disabled"
}

function ServiceDirectoryItem({
  controls,
  itemRef,
  locale,
  onNavigate,
  onSelect,
  selected,
  service,
  tabId,
}: {
  controls: string
  itemRef(element: HTMLButtonElement | null): void
  locale: AppLocale
  onNavigate(key: "first" | "last" | "next" | "previous"): void
  onSelect(): void
  selected: boolean
  service: ServiceCatalogEntry
  tabId: string
}) {
  return (
    <button
      aria-controls={controls}
      aria-current={selected ? "page" : undefined}
      aria-selected={selected}
      className={cn(
        "convax-service-directory-item group flex min-w-0 items-start gap-2.5 rounded-md px-2.5 py-2.5 text-left outline-none",
        "hover:bg-interactive-hover focus-visible:ring-2 focus-visible:ring-focus-ring/55",
        selected && "bg-interactive-selected",
      )}
      data-service-directory-item={service.serviceId}
      id={tabId}
      onClick={onSelect}
      onKeyDown={(event) => {
        const navigationKey =
          event.key === "ArrowDown" || event.key === "ArrowRight"
            ? "next"
            : event.key === "ArrowUp" || event.key === "ArrowLeft"
              ? "previous"
              : event.key === "Home"
                ? "first"
                : event.key === "End"
                  ? "last"
                  : undefined
        if (!navigationKey) return
        event.preventDefault()
        onNavigate(navigationKey)
      }}
      ref={itemRef}
      role="tab"
      tabIndex={selected ? 0 : -1}
      title={service.name}
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md bg-surface-inset text-text-secondary [&>svg]:size-3.5",
          selected && "text-primary",
        )}
      >
        {service.kind === "builtin" ? <Bot /> : <Cloud />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-5 text-text-primary">
            {service.name}
          </span>
          {service.kind === "plugin" ? (
            <span className="shrink-0 text-[10px] tabular-nums text-text-tertiary">
              {appMessage(locale, "services.version", { version: service.version })}
            </span>
          ) : null}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-text-tertiary">
          <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", serviceStateDot(service.state))} />
          <span>{serviceStateLabel(locale, service.state)}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate tabular-nums">
            {appMessage(locale, "services.modelCount", { count: service.models.length })}
          </span>
        </span>
        <span className="sr-only">
          {service.capabilities.map((capability) => capabilityLabel(locale, capability)).join(", ")}
        </span>
      </span>
    </button>
  )
}

export function ServicesSurface({
  className,
  initialServiceId,
  locale,
  onAction,
  onCheckout,
  onInstallServices,
  onRefresh,
  snapshot,
}: {
  className?: string
  initialServiceId?: string
  locale: AppLocale
  onAction(pluginId: string, action: WebPluginServiceAction): void
  onCheckout?(pluginId: string, planKey: string): void
  onInstallServices?: () => void
  onRefresh(): void
  snapshot: ServiceCatalogSnapshot
}) {
  const initialServiceAvailable = Boolean(
    initialServiceId && snapshot.services.some((service) => service.serviceId === initialServiceId),
  )
  const [selectedServiceId, setSelectedServiceId] = useState(
    initialServiceAvailable ? initialServiceId : snapshot.services[0]?.serviceId,
  )
  const selectedService =
    snapshot.services.find((service) => service.serviceId === selectedServiceId) ?? snapshot.services[0]
  const totalModels = snapshot.services.reduce((total, service) => total + service.models.length, 0)
  const generatedId = useId()
  const panelId = `${generatedId}-service-detail`
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    if (selectedService?.serviceId !== selectedServiceId) setSelectedServiceId(selectedService?.serviceId)
  }, [selectedService?.serviceId, selectedServiceId])

  useEffect(() => {
    if (initialServiceAvailable) setSelectedServiceId(initialServiceId)
  }, [initialServiceAvailable, initialServiceId])

  function navigateFrom(serviceId: string, key: "first" | "last" | "next" | "previous") {
    const index = snapshot.services.findIndex((service) => service.serviceId === serviceId)
    if (index < 0 || snapshot.services.length === 0) return
    const nextIndex =
      key === "first"
        ? 0
        : key === "last"
          ? snapshot.services.length - 1
          : key === "next"
            ? (index + 1) % snapshot.services.length
            : (index - 1 + snapshot.services.length) % snapshot.services.length
    const nextService = snapshot.services[nextIndex]
    if (!nextService) return
    setSelectedServiceId(nextService.serviceId)
    itemRefs.current.get(nextService.serviceId)?.focus()
  }

  return (
    <section
      aria-label={appMessage(locale, "services.title")}
      className={cn("convax-services-surface space-y-3", className)}
      data-services-layout="adaptive-master-detail"
    >
      <div className="convax-services-toolbar flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-xs tabular-nums text-text-tertiary">
          {appMessage(locale, "services.inventorySummary", {
            models: totalModels,
            services: snapshot.services.length,
          })}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {onInstallServices ? (
            <Button onClick={onInstallServices} size="sm">
              <Cloud />
              {appMessage(locale, "services.install")}
            </Button>
          ) : null}
          <Button disabled={snapshot.loading} onClick={onRefresh} size="sm" variant="outline">
            <RefreshCw className={snapshot.loading ? "animate-spin motion-reduce:animate-none" : undefined} />
            {appMessage(locale, "services.retry")}
          </Button>
        </div>
      </div>

      {snapshot.error ? (
        <div
          className="border-l-2 border-status-danger bg-status-danger-surface px-3 py-3 text-sm text-status-danger"
          role="alert"
        >
          {snapshot.error}
        </div>
      ) : null}

      {snapshot.loading && snapshot.services.length === 0 ? (
        <div
          className="flex items-center justify-center gap-2 border-y border-border-subtle bg-surface-raised px-5 py-12 text-sm text-text-tertiary"
          role="status"
        >
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
          {appMessage(locale, "services.loading")}
        </div>
      ) : snapshot.services.length === 0 ? (
        <div
          className="border-y border-border-subtle bg-surface-raised px-5 py-12 text-center text-sm text-text-tertiary"
          role="status"
        >
          {appMessage(locale, "services.empty")}
        </div>
      ) : selectedService ? (
        <div className="convax-services-workspace">
          <nav aria-label={appMessage(locale, "services.catalog")} className="convax-services-directory">
            <h3 className="px-3 pb-2 pt-3 text-[11px] font-semibold text-text-tertiary">
              {appMessage(locale, "services.catalog")}
            </h3>
            <div
              aria-label={appMessage(locale, "services.catalog")}
              className="convax-service-directory-tabs"
              role="tablist"
            >
              {snapshot.services.map((service, index) => {
                const tabId = `${generatedId}-service-tab-${index}`
                return (
                  <ServiceDirectoryItem
                    controls={panelId}
                    itemRef={(element) => {
                      if (element) itemRefs.current.set(service.serviceId, element)
                      else itemRefs.current.delete(service.serviceId)
                    }}
                    key={service.serviceId}
                    locale={locale}
                    onNavigate={(key) => navigateFrom(service.serviceId, key)}
                    onSelect={() => setSelectedServiceId(service.serviceId)}
                    selected={service.serviceId === selectedService.serviceId}
                    service={service}
                    tabId={tabId}
                  />
                )
              })}
            </div>
          </nav>
          <ServiceDetail
            busy={
              selectedService.kind === "plugin" && snapshot.action?.pluginId === selectedService.pluginId
                ? snapshot.action.action
                : undefined
            }
            key={selectedService.serviceId}
            labelledBy={`${generatedId}-service-tab-${snapshot.services.indexOf(selectedService)}`}
            locale={locale}
            onAction={(action) => {
              if (selectedService.kind === "plugin") onAction(selectedService.pluginId, action)
            }}
            onCheckout={(planKey) => {
              if (selectedService.kind === "plugin") onCheckout?.(selectedService.pluginId, planKey)
            }}
            panelId={panelId}
            service={selectedService}
          />
        </div>
      ) : null}
    </section>
  )
}

/** @deprecated Kept as a source-compatible name while callers migrate to ServicesSurface. */
export const PluginServicesSurface = ServicesSurface
