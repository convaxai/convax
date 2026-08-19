import type { PluginServiceCheckoutStatus, PluginServiceStatus, ServiceCapability } from "../plugin-service-contracts"
import { appMessage, type AppLocale } from "./app-language"
import type { ServiceCatalogEntry } from "./service-catalog-controller"

export function serviceStateLabel(locale: AppLocale, state: PluginServiceStatus["state"]) {
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

export function credentialLabel(locale: AppLocale, status: PluginServiceStatus) {
  if (!status.credential.configured) return appMessage(locale, "services.notConfigured")
  return appMessage(
    locale,
    status.credential.verification === "verified"
      ? "services.verified"
      : status.credential.verification === "failed"
        ? "services.authenticationExpired"
        : status.credential.verification === "unverified"
          ? "services.unverified"
          : "services.unknown",
  )
}

export function metricValue(value: number, locale: AppLocale) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value)
}

export function capabilityLabel(locale: AppLocale, capability: ServiceCapability) {
  return appMessage(locale, `services.capability.${capability}`)
}

export function billingLabel(locale: AppLocale, service: ServiceCatalogEntry) {
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

export function authenticationLabel(locale: AppLocale, service: ServiceCatalogEntry) {
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

export function checkoutStatusLabel(locale: AppLocale, status: PluginServiceCheckoutStatus) {
  return appMessage(locale, `services.checkoutStatus.${status}`)
}

export function serviceDescription(locale: AppLocale, service: ServiceCatalogEntry) {
  return service.kind === "builtin" ? appMessage(locale, "services.dshDescription") : service.description
}
