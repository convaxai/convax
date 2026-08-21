import { Button, Input, cn } from "@convax/ui"
import {
  AudioLines,
  Bot,
  CircleAlert,
  Cloud,
  ImageIcon,
  LoaderCircle,
  LogOut,
  MessageSquareText,
  Search,
  Settings2,
  Video,
} from "lucide-react"
import { useId, useMemo, useState, type ReactNode } from "react"

import type { PluginServiceStatus, ServiceCapability } from "../plugin-service-contracts"
import type { WebPluginServiceAction } from "../plugin-contracts"
import { appMessage, type AppLocale } from "./app-language"
import {
  authenticationLabel,
  billingLabel,
  capabilityLabel,
  checkoutStatusLabel,
  credentialLabel,
  metricValue,
  serviceDescription,
  serviceStateLabel,
} from "./service-display-format"
import type { ServiceCatalogEntry } from "./service-catalog-controller"
import {
  serviceModelCapabilityOrder,
  serviceModelResults,
  type ServiceModelCapabilityFilter,
} from "./service-model-filter"

function serviceStateTone(state: PluginServiceStatus["state"]) {
  return state === "connected"
    ? "text-status-success"
    : state === "attention"
      ? "text-status-warning"
      : "text-text-secondary"
}

function serviceStateDot(state: PluginServiceStatus["state"]) {
  return state === "connected" ? "bg-status-success" : state === "attention" ? "bg-status-warning" : "bg-text-disabled"
}

function ServiceState({
  label,
  locale,
  state,
}: {
  label?: string
  locale: AppLocale
  state: PluginServiceStatus["state"]
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 font-medium", serviceStateTone(state))}
      data-service-state={state}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", serviceStateDot(state))} />
      {label ?? serviceStateLabel(locale, state)}
    </span>
  )
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0" data-service-connection-detail="">
      <dt className="text-[11px] font-medium leading-4 text-text-tertiary">{label}</dt>
      <dd className="mt-1 break-words text-[13px] font-medium leading-5 text-text-primary" data-service-detail-value="">
        {value}
      </dd>
    </div>
  )
}

function Metric({ locale, period, unit, value }: { locale: AppLocale; period?: string; unit: string; value: number }) {
  return (
    <>
      <span className="tabular-nums">{metricValue(value, locale)}</span> <span dir="auto">{unit}</span>
      {period ? (
        <>
          <span aria-hidden="true"> · </span>
          <span dir="auto">{period}</span>
        </>
      ) : null}
    </>
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
      className="mt-4 border-l-2 border-status-danger bg-status-danger-surface px-3 py-3"
      role="alertdialog"
    >
      <p className="text-xs leading-5 text-text-primary">{appMessage(locale, "services.signOutConfirm")}</p>
      <div className="mt-2 flex justify-end gap-2">
        <Button autoFocus disabled={busy} onClick={onCancel} size="sm" variant="ghost">
          {appMessage(locale, "services.signOutCancel")}
        </Button>
        <Button disabled={busy} onClick={onConfirm} size="sm" variant="destructive">
          {appMessage(locale, "services.signOutConfirmAction")}
        </Button>
      </div>
    </div>
  )
}

function ServiceActions({
  busy,
  locale,
  onAction,
  onCheckout,
  service,
}: {
  busy?: WebPluginServiceAction
  locale: AppLocale
  onAction(action: WebPluginServiceAction): void
  onCheckout(planKey: string): void
  service: Extract<ServiceCatalogEntry, { kind: "plugin" }>
}) {
  const status = service.status
  const actions = service.actions
  const canAuthorize = actions.includes("authorize") && !status?.credential.configured
  const canReauthorize = actions.includes("reauthorize") && Boolean(status?.credential.configured)
  const authorizationPending = busy === "authorize" || busy === "reauthorize"
  const canCancel = actions.includes("authorization.cancel") && (authorizationPending || status?.state === "attention")
  const canSignOut = actions.includes("sign_out") && Boolean(status?.credential.configured)
  const checkout = status?.billing.availability === "available" ? status.billing.checkout : undefined
  const checkoutPlans = actions.includes("checkout") && checkout?.availability === "available" ? checkout.plans : []
  const checkoutPending = checkout?.availability === "available" ? checkout.pending : undefined
  const hasCheckout = checkoutPlans.length > 0

  if (!canAuthorize && !canReauthorize && !canCancel && !canSignOut && !hasCheckout) return null

  return (
    <div
      aria-label={appMessage(locale, "services.actions")}
      className="convax-service-actions flex flex-wrap items-center gap-2"
      role="group"
    >
      {checkoutPlans.map((plan) => (
        <Button
          data-service-action="checkout"
          data-service-action-priority="primary"
          disabled={Boolean(busy) || Boolean(checkoutPending)}
          key={plan.key}
          onClick={() => onCheckout(plan.key)}
          size="sm"
        >
          {busy === "checkout" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : null}
          {appMessage(locale, "services.upgrade", { plan: plan.name })}
        </Button>
      ))}
      {canAuthorize || canReauthorize ? (
        <Button
          data-service-action={canAuthorize ? "authorize" : "reauthorize"}
          data-service-action-priority="primary"
          disabled={Boolean(busy)}
          onClick={() => onAction(canAuthorize ? "authorize" : "reauthorize")}
          size="sm"
          variant={hasCheckout ? "outline" : "default"}
        >
          {authorizationPending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Settings2 />}
          {appMessage(
            locale,
            canAuthorize
              ? "services.configure"
              : status?.credential.verification === "failed"
                ? "services.reauthorize"
                : "services.reconfigure",
          )}
        </Button>
      ) : null}
      {canCancel ? (
        <Button
          data-service-action="authorization.cancel"
          data-service-action-priority="secondary"
          disabled={Boolean(busy) && !authorizationPending}
          onClick={() => onAction("authorization.cancel")}
          size="sm"
          variant="outline"
        >
          {busy === "authorization.cancel" ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          ) : null}
          {appMessage(locale, "services.cancelAuthorization")}
        </Button>
      ) : null}
      {canSignOut ? (
        <Button
          className="text-text-tertiary hover:text-status-danger"
          data-service-action="sign_out"
          data-service-action-priority="danger-secondary"
          disabled={Boolean(busy)}
          onClick={() => onAction("sign_out")}
          size="sm"
          variant="ghost"
        >
          {busy === "sign_out" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <LogOut />}
          {appMessage(locale, "services.signOut")}
        </Button>
      ) : null}
    </div>
  )
}

function ServiceConnectionDetails({ locale, service }: { locale: AppLocale; service: ServiceCatalogEntry }) {
  const unavailable = appMessage(locale, "services.unavailableData")
  const titleId = useId()

  return (
    <section aria-labelledby={titleId} className="convax-service-section">
      <h4 className="text-sm font-semibold text-text-primary" id={titleId}>
        {appMessage(locale, "services.connectionDetails")}
      </h4>
      {service.kind === "plugin" && service.status ? (
        <dl className="convax-service-detail-grid mt-4">
          <Detail
            label={appMessage(locale, "services.account")}
            value={
              service.status.account.availability === "available" ? (
                <span dir="auto">{service.status.account.displayName}</span>
              ) : (
                unavailable
              )
            }
          />
          <Detail label={appMessage(locale, "services.credential")} value={credentialLabel(locale, service.status)} />
          <Detail
            label={appMessage(locale, "services.plan")}
            value={
              service.status.plan.availability === "available" ? (
                <>
                  <span dir="auto">{service.status.plan.name}</span>
                  {service.status.plan.billingInterval ? (
                    <>
                      <span aria-hidden="true"> · </span>
                      {appMessage(locale, `services.interval.${service.status.plan.billingInterval}`)}
                    </>
                  ) : null}
                </>
              ) : (
                unavailable
              )
            }
          />
          <Detail
            label={appMessage(locale, "services.subscriptionStatus")}
            value={
              service.status.billing.availability === "available" ? (
                service.status.billing.subscriptionStatus ? (
                  <span dir="auto">{service.status.billing.subscriptionStatus}</span>
                ) : (
                  appMessage(locale, "services.noSubscription")
                )
              ) : (
                unavailable
              )
            }
          />
          <Detail
            label={appMessage(locale, "services.credits")}
            value={
              service.status.credits.availability === "available" ? (
                <Metric locale={locale} unit={service.status.credits.unit} value={service.status.credits.remaining} />
              ) : (
                unavailable
              )
            }
          />
          <Detail
            label={appMessage(locale, "services.usage")}
            value={
              service.status.usage.availability === "available" ? (
                <Metric
                  locale={locale}
                  period={service.status.usage.period}
                  unit={service.status.usage.unit}
                  value={service.status.usage.consumed}
                />
              ) : (
                unavailable
              )
            }
          />
        </dl>
      ) : service.kind === "builtin" ? (
        <dl className="convax-service-detail-grid mt-4">
          <Detail label={appMessage(locale, "services.billing")} value={billingLabel(locale, service)} />
          <Detail label={appMessage(locale, "services.authentication")} value={authenticationLabel(locale, service)} />
        </dl>
      ) : null}
    </section>
  )
}

function ServiceUsageHistory({ locale, service }: { locale: AppLocale; service: ServiceCatalogEntry }) {
  if (service.kind !== "plugin") return null
  const history = service.usageHistory
  const titleId = useId()
  const availableHistory = history?.availability === "available" ? history : undefined
  const records = availableHistory?.records
  const usageUnit = availableHistory?.unit ?? ""

  return (
    <section aria-labelledby={titleId} className="convax-service-section">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold text-text-primary" id={titleId}>
          {appMessage(locale, "services.usageHistory")}
        </h4>
        {records ? (
          <span className="text-[11px] tabular-nums text-text-tertiary">
            {appMessage(locale, "services.usageHistoryCount", { count: records.length })}
          </span>
        ) : null}
      </div>
      {records?.length ? (
        <ol className="convax-service-usage-list mt-3 overflow-y-auto">
          {records.map((record, index) => (
            <li className="convax-service-usage-row" data-service-usage-record="" key={`${index}:${record.amount}`}>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-text-primary" dir="auto">
                  {record.label ?? appMessage(locale, "services.usageHistoryRecord", { index: index + 1 })}
                </span>
                {record.occurredAt ? (
                  <time className="mt-0.5 block text-[10px] text-text-tertiary" dateTime={record.occurredAt}>
                    {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                      new Date(record.occurredAt),
                    )}
                  </time>
                ) : null}
              </div>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-text-primary">
                {appMessage(locale, "services.usageRecordAmount", {
                  unit: usageUnit,
                  value: metricValue(record.amount, locale),
                })}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p
          className="mt-3 rounded-lg bg-surface-inset/35 px-3 py-5 text-center text-xs text-text-tertiary"
          role="status"
        >
          {records ? appMessage(locale, "services.usageHistoryEmpty") : appMessage(locale, "services.unavailableData")}
        </p>
      )}
    </section>
  )
}

function ServiceModelDirectory({ locale, service }: { locale: AppLocale; service: ServiceCatalogEntry }) {
  const [query, setQuery] = useState("")
  const [capability, setCapability] = useState<ServiceModelCapabilityFilter>("all")
  const titleId = useId()
  const listId = useId()
  const resultId = useId()
  const result = useMemo(
    () => serviceModelResults(service.models, query, capability),
    [capability, query, service.models],
  )
  const filtering = query.trim().length > 0 || capability !== "all"
  const showSearch = service.models.length > 6

  const modelCapabilityLabel = (value: ServiceCapability) => appMessage(locale, `services.modelCapability.${value}`)

  const capabilityIcon = (value: Exclude<ServiceModelCapabilityFilter, "all">) =>
    value === "llm" ? (
      <Bot />
    ) : value === "text" ? (
      <MessageSquareText />
    ) : value === "image" ? (
      <ImageIcon />
    ) : value === "video" ? (
      <Video />
    ) : (
      <AudioLines />
    )

  return (
    <section aria-labelledby={titleId} className="convax-service-model-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold text-text-primary" id={titleId}>
          {appMessage(locale, "services.models")}
        </h4>
        <span
          aria-live="polite"
          className="shrink-0 text-[11px] tabular-nums text-text-tertiary"
          id={resultId}
          role="status"
        >
          {filtering
            ? appMessage(locale, "services.modelResultCount", { count: result.matches.length })
            : appMessage(locale, "services.modelCount", { count: service.models.length })}
        </span>
      </div>

      {showSearch ? (
        <div className="convax-service-model-toolbar mt-2.5">
          <label className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-text-tertiary"
            />
            <span className="sr-only">{appMessage(locale, "services.searchModels")}</span>
            <Input
              aria-controls={listId}
              aria-describedby={resultId}
              aria-label={appMessage(locale, "services.searchModels")}
              className="h-8 rounded-full border-border-subtle bg-control-background pl-8 text-xs shadow-none"
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder={appMessage(locale, "services.searchModelsPlaceholder")}
              type="search"
              value={query}
            />
          </label>
        </div>
      ) : null}

      {service.models.length ? (
        <div
          aria-label={appMessage(locale, "services.filterModels")}
          className="convax-service-model-filters mt-2 flex flex-wrap gap-1"
          role="group"
        >
          {(["all", ...serviceModelCapabilityOrder] as const).map((filter) => (
            <button
              aria-pressed={capability === filter}
              className="convax-service-model-filter"
              key={filter}
              onClick={() => setCapability(filter)}
              type="button"
            >
              {filter === "all" ? appMessage(locale, "services.allModels") : modelCapabilityLabel(filter)}
            </button>
          ))}
        </div>
      ) : null}

      {service.models.length ? (
        result.matches.length ? (
          <>
            <ul
              aria-label={appMessage(locale, "services.modelListLabel")}
              className="convax-service-model-list mt-2 overflow-y-auto"
              id={listId}
            >
              {result.rendered.map((model) => (
                <li
                  className="convax-service-model-row"
                  data-service-model={model.id}
                  data-service-model-type={model.capability}
                  key={model.id}
                >
                  <span className="convax-service-model-icon" data-capability={model.capability} aria-hidden="true">
                    {capabilityIcon(model.capability)}
                  </span>
                  <div className="convax-service-model-identity min-w-0">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="min-w-0 truncate text-xs font-medium leading-5 text-text-primary" dir="auto">
                        {model.name}
                      </span>
                      {model.default ? (
                        <span className="shrink-0 whitespace-nowrap text-[10px] font-medium text-primary">
                          {appMessage(locale, "services.defaultModel")}
                        </span>
                      ) : null}
                    </span>
                    {model.providerName ? (
                      <span
                        className="convax-service-model-provider block truncate text-[10px] text-text-tertiary"
                        dir="auto"
                      >
                        {model.providerName}
                      </span>
                    ) : null}
                  </div>
                  <span className="sr-only">
                    {appMessage(locale, "services.modelCapabilityLabel", {
                      capability: modelCapabilityLabel(model.capability),
                    })}
                  </span>
                  <span
                    className="convax-service-model-capabilities"
                    data-service-model-capabilities=""
                    aria-hidden="true"
                  >
                    {serviceModelCapabilityOrder.map((candidate) => (
                      <span
                        className="convax-service-model-capability"
                        data-active={candidate === model.capability}
                        data-capability={candidate}
                        data-service-model-capability={candidate}
                        key={candidate}
                      >
                        {modelCapabilityLabel(candidate)}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            {result.limited ? (
              <p className="mt-2 text-[11px] leading-4 text-text-tertiary" role="status">
                {appMessage(locale, "services.modelResultsLimited", {
                  shown: result.rendered.length,
                  total: result.matches.length,
                })}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-3 bg-surface-inset/35 py-8 text-center text-xs text-text-tertiary" role="status">
            {appMessage(locale, "services.noModelMatches")}
          </p>
        )
      ) : (
        <p className="mt-3 text-xs text-text-tertiary" role="status">
          {service.loading
            ? appMessage(locale, "services.loadingModels")
            : service.kind === "plugin" && service.authentication === "required"
              ? appMessage(locale, "services.modelsAuthorizationRequired")
              : appMessage(locale, "services.noModels")}
        </p>
      )}
    </section>
  )
}

export function ServiceDetail({
  busy,
  labelledBy,
  locale,
  onAction,
  onCheckout,
  panelId,
  service,
}: {
  busy?: WebPluginServiceAction
  labelledBy: string
  locale: AppLocale
  onAction(action: WebPluginServiceAction): void
  onCheckout(planKey: string): void
  panelId: string
  service: ServiceCatalogEntry
}) {
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const titleId = useId()
  const actions = service.kind === "plugin" ? service.actions : []
  const checkout =
    service.kind === "plugin" && service.status?.billing.availability === "available"
      ? service.status.billing.checkout
      : undefined
  const checkoutPending = checkout?.availability === "available" ? checkout.pending : undefined
  const pendingPlan =
    checkout?.availability === "available"
      ? checkout.plans.find((plan) => plan.key === checkoutPending?.planKey)?.name
      : undefined

  return (
    <article
      aria-labelledby={labelledBy}
      className="convax-services-detail min-w-0"
      data-service-detail={service.serviceId}
      id={panelId}
      role="tabpanel"
    >
      <header className="convax-service-detail-header">
        <div className="convax-service-detail-heading">
          <div className="flex min-w-0 items-start gap-3">
            <div
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-inset text-primary [&>svg]:size-5"
            >
              {service.kind === "builtin" ? <Bot /> : <Cloud />}
            </div>
            <div className="min-w-0">
              <h3 className="break-words text-lg font-semibold leading-6 tracking-[-0.01em]" id={titleId}>
                {service.name}
              </h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-text-tertiary">
                <ServiceState
                  label={
                    service.kind === "plugin" && service.status?.credential.verification === "failed"
                      ? appMessage(locale, "services.authenticationExpired")
                      : undefined
                  }
                  locale={locale}
                  state={service.state}
                />
                {service.kind === "plugin" ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{appMessage(locale, "services.version", { version: service.version })}</span>
                  </>
                ) : null}
                {service.billing.kind === "free" || service.billing.kind === "subscription" ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span dir="auto">{billingLabel(locale, service)}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <p className="mt-3 max-w-3xl break-words text-xs leading-5 text-text-secondary" dir="auto">
            {serviceDescription(locale, service)}
          </p>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px] leading-4">
            <span className="font-medium text-text-tertiary">{appMessage(locale, "services.capabilities")}</span>
            {service.capabilities.length ? (
              <ul className="flex flex-wrap gap-x-2 text-text-secondary">
                {service.capabilities.map((capability) => (
                  <li
                    className="after:ml-2 after:text-text-disabled after:content-['·'] last:after:content-none"
                    key={capability}
                  >
                    {capabilityLabel(locale, capability)}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-text-tertiary">{appMessage(locale, "services.unavailableData")}</span>
            )}
          </div>
        </div>

        {service.kind === "plugin" ? (
          <ServiceActions
            busy={busy}
            locale={locale}
            onAction={(action) => {
              if (action === "sign_out") {
                setConfirmSignOut(true)
                return
              }
              onAction(action)
            }}
            onCheckout={onCheckout}
            service={service}
          />
        ) : null}

        {confirmSignOut ? (
          <div className="convax-service-confirmation">
            <PluginServiceSignOutConfirmation
              busy={Boolean(busy)}
              locale={locale}
              onCancel={() => setConfirmSignOut(false)}
              onConfirm={() => {
                setConfirmSignOut(false)
                onAction("sign_out")
              }}
            />
          </div>
        ) : null}
      </header>

      <div className="convax-service-detail-body">
        {service.loading ? (
          <div
            className="flex items-center gap-2 border-l-2 border-status-info bg-status-info-surface px-3 py-3 text-xs text-text-secondary"
            role="status"
          >
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
            {appMessage(locale, "services.loadingStatus")}
          </div>
        ) : service.error ? (
          <div
            className="flex items-start gap-2 border-l-2 border-status-danger bg-status-danger-surface px-3 py-3 text-xs text-status-danger"
            role="alert"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span className="break-words">{service.error}</span>
          </div>
        ) : null}

        {checkoutPending ? (
          <p
            className="border-l-2 border-status-info bg-status-info-surface px-3 py-3 text-xs text-text-secondary"
            role="status"
          >
            {appMessage(locale, "services.checkoutPending", {
              plan: pendingPlan ?? checkoutPending.planKey,
              status: checkoutStatusLabel(locale, checkoutPending.status),
            })}
          </p>
        ) : null}

        <ServiceConnectionDetails locale={locale} service={service} />

        <ServiceUsageHistory locale={locale} service={service} />

        {service.kind === "plugin" && !actions.includes("authorize") && !actions.includes("reauthorize") ? (
          <p className="text-xs leading-5 text-text-tertiary">
            {appMessage(locale, "services.authorizationUnavailable")}
          </p>
        ) : null}

        <ServiceModelDirectory locale={locale} service={service} />
      </div>
    </article>
  )
}
