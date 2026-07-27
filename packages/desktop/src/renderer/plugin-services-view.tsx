import { Button, cn } from "@convax/ui"
import { Bot, CircleAlert, Cloud, LoaderCircle, LogOut, RefreshCw, Settings2 } from "lucide-react"
import { useState } from "react"

import type { PluginServiceStatus, ServiceCapability } from "../plugin-service-contracts"
import type { WebPluginServiceAction } from "../plugin-contracts"
import { appMessage, type AppLocale } from "./app-language"
import { type ServiceCatalogEntry, type ServiceCatalogSnapshot } from "./service-catalog-controller"

function stateLabel(locale: AppLocale, state: PluginServiceStatus["state"]) {
  return appMessage(
    locale,
    state === "connected"
      ? "services.connected"
      : state === "disconnected"
        ? "services.disconnected"
        : state === "attention"
          ? "services.attention"
          : "services.unknown",
  )
}

function credentialLabel(locale: AppLocale, status: PluginServiceStatus) {
  if (!status.credential.configured) return appMessage(locale, "services.notConfigured")
  return appMessage(
    locale,
    status.credential.verification === "verified"
      ? "services.verified"
      : status.credential.verification === "failed"
        ? "services.failed"
        : status.credential.verification === "unverified"
          ? "services.unverified"
          : "services.unknown",
  )
}

function metricValue(value: number, locale: AppLocale) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value)
}

function capabilityLabel(locale: AppLocale, capability: ServiceCapability) {
  return appMessage(locale, `services.capability.${capability}`)
}

function billingLabel(locale: AppLocale, service: ServiceCatalogEntry) {
  if (service.billing.kind === "free") return appMessage(locale, "services.free")
  if (service.billing.kind === "subscription") {
    return service.billing.name ?? appMessage(locale, "services.subscription")
  }
  if (service.billing.kind === "credits" && service.billing.remaining !== undefined && service.billing.unit) {
    return appMessage(locale, "services.remaining", {
      unit: service.billing.unit,
      value: metricValue(service.billing.remaining, locale),
    })
  }
  return appMessage(locale, "services.unavailableData")
}

function authenticationLabel(locale: AppLocale, service: ServiceCatalogEntry) {
  return appMessage(
    locale,
    service.authentication === "authenticated"
      ? "services.authenticated"
      : service.authentication === "required"
        ? "services.authRequired"
        : service.authentication === "not-applicable"
          ? "services.authNotApplicable"
          : "services.unknown",
  )
}

function StatusPill({ children, state }: { children: React.ReactNode; state?: PluginServiceStatus["state"] }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-medium",
        state === "connected"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : state === "attention"
            ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : "border-border bg-muted/70 text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm text-foreground">{value}</dd>
    </div>
  )
}

export function PluginServiceSignOutConfirmation({
  busy,
  locale,
  onCancel,
  onConfirm,
}: {
  busy: boolean
  locale: AppLocale
  onCancel(): void
  onConfirm(): void
}) {
  return (
    <div
      aria-label={appMessage(locale, "services.signOutConfirm")}
      className="mt-4 rounded-lg border border-destructive/25 bg-destructive/5 p-3"
      role="alertdialog"
    >
      <p className="text-xs text-foreground">{appMessage(locale, "services.signOutConfirm")}</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button disabled={busy} onClick={onCancel} size="sm" variant="ghost">
          {appMessage(locale, "services.signOutCancel")}
        </Button>
        <Button disabled={busy} onClick={onConfirm} size="sm" variant="destructive">
          {appMessage(locale, "services.signOutConfirmAction")}
        </Button>
      </div>
    </div>
  )
}

function ServiceCard({
  busy,
  locale,
  onAction,
  service,
}: {
  busy?: WebPluginServiceAction
  locale: AppLocale
  onAction(action: WebPluginServiceAction): void
  service: ServiceCatalogEntry
}) {
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const actions = service.kind === "plugin" ? service.actions : []
  const status = service.kind === "plugin" ? service.status : undefined
  const canAuthorize = actions.includes("authorize") && !status?.credential.configured
  const canReauthorize = actions.includes("reauthorize") && Boolean(status?.credential.configured)
  const authorizationPending = busy === "authorize" || busy === "reauthorize"
  const canCancel = actions.includes("authorization.cancel") && (authorizationPending || status?.state === "attention")
  const canSignOut = actions.includes("sign_out") && Boolean(status?.credential.configured)
  const unavailable = appMessage(locale, "services.unavailableData")
  return (
    <article className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          {service.kind === "builtin" ? <Bot className="size-5" /> : <Cloud className="size-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{service.name}</h3>
            {service.kind === "plugin" ? (
              <StatusPill>{appMessage(locale, "services.version", { version: service.version })}</StatusPill>
            ) : null}
            <StatusPill state={service.state}>{stateLabel(locale, service.state)}</StatusPill>
            {service.billing.kind === "free" ? <StatusPill>{appMessage(locale, "services.free")}</StatusPill> : null}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {service.kind === "builtin" ? appMessage(locale, "services.openCodeDescription") : service.description}
          </p>
        </div>
      </div>

      {service.loading ? (
        <div
          className="mt-4 flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-3 text-xs text-muted-foreground"
          role="status"
        >
          <LoaderCircle className="size-4 animate-spin" />
          {appMessage(locale, "services.loadingStatus")}
        </div>
      ) : service.error ? (
        <div
          className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-3 text-xs text-destructive"
          role="alert"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="break-words">{service.error}</span>
        </div>
      ) : service.kind === "plugin" && status ? (
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          <Detail
            label={appMessage(locale, "services.account")}
            value={status.account.availability === "available" ? status.account.displayName : unavailable}
          />
          <Detail label={appMessage(locale, "services.credential")} value={credentialLabel(locale, status)} />
          <Detail
            label={appMessage(locale, "services.credits")}
            value={
              status.credits.availability === "available"
                ? appMessage(locale, "services.remaining", {
                    unit: status.credits.unit,
                    value: metricValue(status.credits.remaining, locale),
                  })
                : unavailable
            }
          />
          <Detail
            label={appMessage(locale, "services.usage")}
            value={
              status.usage.availability === "available"
                ? appMessage(locale, "services.consumed", {
                    period: status.usage.period ? ` · ${status.usage.period}` : "",
                    unit: status.usage.unit,
                    value: metricValue(status.usage.consumed, locale),
                  })
                : unavailable
            }
          />
        </dl>
      ) : service.kind === "builtin" ? (
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          <Detail label={appMessage(locale, "services.billing")} value={billingLabel(locale, service)} />
          <Detail label={appMessage(locale, "services.authentication")} value={authenticationLabel(locale, service)} />
        </dl>
      ) : null}

      <div className="mt-4 border-t border-border pt-4">
        <h4 className="text-xs font-semibold text-foreground">{appMessage(locale, "services.capabilities")}</h4>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {service.capabilities.length ? (
            service.capabilities.map((capability) => (
              <span
                className="rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
                key={capability}
              >
                {capabilityLabel(locale, capability)}
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">{unavailable}</span>
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-xs font-semibold text-foreground">{appMessage(locale, "services.models")}</h4>
          <span className="text-[11px] tabular-nums text-muted-foreground">{service.models.length}</span>
        </div>
        {service.models.length ? (
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/10 p-1.5">
            {service.models.map((model) => (
              <li className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs" key={model.id}>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{model.name}</span>
                {model.providerName ? (
                  <span className="truncate text-[11px] text-muted-foreground">{model.providerName}</span>
                ) : null}
                {model.default ? <StatusPill>{appMessage(locale, "services.defaultModel")}</StatusPill> : null}
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {capabilityLabel(locale, model.capability)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {service.loading ? appMessage(locale, "services.loadingModels") : appMessage(locale, "services.noModels")}
          </p>
        )}
      </div>

      {service.kind === "plugin" && !actions.includes("authorize") && !actions.includes("reauthorize") ? (
        <p className="mt-3 text-xs text-muted-foreground">{appMessage(locale, "services.authorizationUnavailable")}</p>
      ) : null}

      {confirmSignOut ? (
        <PluginServiceSignOutConfirmation
          busy={Boolean(busy)}
          locale={locale}
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={() => {
            setConfirmSignOut(false)
            onAction("sign_out")
          }}
        />
      ) : null}

      {canAuthorize || canReauthorize || canCancel || canSignOut ? (
        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          {canCancel ? (
            <Button
              disabled={Boolean(busy) && !authorizationPending}
              onClick={() => onAction("authorization.cancel")}
              size="sm"
              variant="outline"
            >
              {busy === "authorization.cancel" ? <LoaderCircle className="animate-spin" /> : null}
              {appMessage(locale, "services.cancelAuthorization")}
            </Button>
          ) : null}
          {canAuthorize || canReauthorize ? (
            <Button
              disabled={Boolean(busy)}
              onClick={() => onAction(canAuthorize ? "authorize" : "reauthorize")}
              size="sm"
              variant="outline"
            >
              {busy === "authorize" || busy === "reauthorize" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Settings2 />
              )}
              {appMessage(locale, canAuthorize ? "services.configure" : "services.reconfigure")}
            </Button>
          ) : null}
          {canSignOut ? (
            <Button disabled={Boolean(busy)} onClick={() => setConfirmSignOut(true)} size="sm" variant="outline">
              {busy === "sign_out" ? <LoaderCircle className="animate-spin" /> : <LogOut />}
              {appMessage(locale, "services.signOut")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export function ServicesSurface({
  className,
  locale,
  onAction,
  onInstallServices,
  onRefresh,
  snapshot,
}: {
  className?: string
  locale: AppLocale
  onAction(pluginId: string, action: WebPluginServiceAction): void
  onInstallServices?: () => void
  onRefresh(): void
  snapshot: ServiceCatalogSnapshot
}) {
  return (
    <section aria-label={appMessage(locale, "services.title")} className={cn("space-y-5", className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{appMessage(locale, "services.description")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onInstallServices ? (
            <Button onClick={onInstallServices} size="sm">
              <Cloud />
              {appMessage(locale, "services.install")}
            </Button>
          ) : null}
          <Button disabled={snapshot.loading} onClick={onRefresh} size="sm" variant="outline">
            <RefreshCw className={snapshot.loading ? "animate-spin" : undefined} />
            {appMessage(locale, "services.retry")}
          </Button>
        </div>
      </div>
      {snapshot.error ? (
        <div
          className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {snapshot.error}
        </div>
      ) : null}
      {snapshot.loading && snapshot.services.length === 0 ? (
        <div
          className="flex min-h-32 items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground"
          role="status"
        >
          <LoaderCircle className="size-4 animate-spin" />
          {appMessage(locale, "services.loading")}
        </div>
      ) : snapshot.services.length === 0 ? (
        <div className="grid min-h-32 place-items-center rounded-xl border border-dashed border-border px-5 text-center text-sm text-muted-foreground">
          {appMessage(locale, "services.empty")}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {snapshot.services.map((service) => (
            <ServiceCard
              busy={
                service.kind === "plugin" && snapshot.action?.pluginId === service.pluginId
                  ? snapshot.action.action
                  : undefined
              }
              key={service.serviceId}
              locale={locale}
              onAction={(action) => {
                if (service.kind === "plugin") onAction(service.pluginId, action)
              }}
              service={service}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/** @deprecated Kept as a source-compatible name while callers migrate to ServicesSurface. */
export const PluginServicesSurface = ServicesSurface
