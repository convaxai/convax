import type { PluginServiceCatalogEntry, ServiceCatalogSnapshot } from "./service-catalog-controller"

export const convaxOnboardingStorageKey = "convax.desktop.onboarding.v1"
const maxConvaxOnboardingStorageBytes = 256
const convaxOnboardingProgressKeys = new Set(["completed", "step", "version"])

export type ConvaxOnboardingStep = "account" | "plan" | "ready"

export interface ConvaxOnboardingProgress {
  completed: boolean
  step: ConvaxOnboardingStep
  version: 1
}

export interface ConvaxOnboardingStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type ConvaxOnboardingServiceResolution =
  | { kind: "available"; service: PluginServiceCatalogEntry }
  | { error?: string; kind: "unavailable"; reason: "ambiguous" | "missing" }
  | { kind: "loading" }

export type ConvaxOnboardingRoute = "account" | "complete" | "plan" | "ready"

export function defaultConvaxOnboardingProgress(): ConvaxOnboardingProgress {
  return { completed: false, step: "account", version: 1 }
}

export function readConvaxOnboardingProgress(
  storage: Pick<ConvaxOnboardingStorage, "getItem">,
): ConvaxOnboardingProgress {
  try {
    const serialized = storage.getItem(convaxOnboardingStorageKey)
    if (serialized === null || serialized.length > maxConvaxOnboardingStorageBytes) {
      return defaultConvaxOnboardingProgress()
    }
    const value = JSON.parse(serialized) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaultConvaxOnboardingProgress()
    const keys = Object.keys(value)
    if (
      keys.length !== convaxOnboardingProgressKeys.size ||
      keys.some((key) => !convaxOnboardingProgressKeys.has(key))
    ) {
      return defaultConvaxOnboardingProgress()
    }
    const candidate = value as Partial<ConvaxOnboardingProgress>
    if (
      candidate.version !== 1 ||
      typeof candidate.completed !== "boolean" ||
      (candidate.step !== "account" && candidate.step !== "plan" && candidate.step !== "ready")
    ) {
      return defaultConvaxOnboardingProgress()
    }
    return { completed: candidate.completed, step: candidate.step, version: 1 }
  } catch {
    return defaultConvaxOnboardingProgress()
  }
}

export function writeConvaxOnboardingProgress(
  storage: Pick<ConvaxOnboardingStorage, "setItem">,
  progress: ConvaxOnboardingProgress,
) {
  try {
    storage.setItem(convaxOnboardingStorageKey, JSON.stringify(progress))
    return true
  } catch {
    return false
  }
}

function isAccountOnboardingCandidate(service: PluginServiceCatalogEntry) {
  const canAuthorize = service.actions.includes("authorize") || service.actions.includes("reauthorize")
  return canAuthorize && service.actions.includes("checkout")
}

/**
 * The product account is selected by its generic Service capabilities, never by a
 * concrete Plugin id or vendor name. Product provisioning must expose exactly one
 * authorization + Checkout service during first-run onboarding.
 */
export function resolveConvaxOnboardingService(snapshot: ServiceCatalogSnapshot): ConvaxOnboardingServiceResolution {
  const candidates = snapshot.services.filter(
    (service): service is PluginServiceCatalogEntry =>
      service.kind === "plugin" && isAccountOnboardingCandidate(service),
  )
  if (candidates.length === 1) return { kind: "available", service: candidates[0] }
  if (snapshot.loading && candidates.length === 0) return { kind: "loading" }
  return {
    ...(snapshot.error ? { error: snapshot.error } : {}),
    kind: "unavailable",
    reason: candidates.length === 0 ? "missing" : "ambiguous",
  }
}

export function isConvaxOnboardingAccountConnected(service: PluginServiceCatalogEntry) {
  return (
    service.state === "connected" &&
    service.status?.credential.verification === "verified" &&
    service.status.account.availability === "available"
  )
}

export function isConvaxOnboardingPaidPlan(service: PluginServiceCatalogEntry) {
  const plan = service.status?.plan
  return plan?.availability === "available" && plan.key !== "free"
}

export function resolveConvaxOnboardingRoute(
  progress: ConvaxOnboardingProgress,
  resolution: ConvaxOnboardingServiceResolution,
): ConvaxOnboardingRoute {
  if (progress.completed) return "complete"
  if (resolution.kind !== "available" || !isConvaxOnboardingAccountConnected(resolution.service)) {
    return "account"
  }
  if (progress.step === "ready" || isConvaxOnboardingPaidPlan(resolution.service)) return "ready"
  return "plan"
}

export function nextConvaxOnboardingProgress(
  progress: ConvaxOnboardingProgress,
  step: ConvaxOnboardingStep,
): ConvaxOnboardingProgress {
  return { ...progress, completed: false, step }
}

export function completeConvaxOnboarding(progress: ConvaxOnboardingProgress): ConvaxOnboardingProgress {
  return { ...progress, completed: true, step: "ready" }
}
