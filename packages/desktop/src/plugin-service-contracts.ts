import type { WebPluginServiceAction } from "./plugin-contracts"

export const pluginServiceStatusSchema = "convax.plugin-service-status/1" as const

export const pluginServiceIpcChannels = {
  authorize: "plugin-service:authorize",
  cancelAuthorization: "plugin-service:authorization-cancel",
  changed: "plugin-service:changed",
  getStatus: "plugin-service:status",
  listServices: "plugin-service:list",
  reauthorize: "plugin-service:reauthorize",
  signOut: "plugin-service:sign-out",
} as const

export const pluginServiceMcpTools = {
  authorize: "service.authorize",
  cancelAuthorization: "service.authorization.cancel",
  completeAuthorization: "service.authorization.complete",
  reauthorize: "service.reauthorize",
  signOut: "service.sign_out",
  status: "service.status",
} as const

export type PluginServiceState = "connected" | "disconnected" | "attention" | "unknown"
export type PluginServiceCredentialVerification = "verified" | "unverified" | "failed" | "unknown"
export type ServiceCapability = "llm" | "text" | "image" | "video" | "audio"

export interface ServiceModelSummary {
  capability: ServiceCapability
  id: string
  name: string
}

export interface PluginServiceSummary {
  actions: readonly WebPluginServiceAction[]
  capabilities: readonly ServiceCapability[]
  description: string
  models: readonly ServiceModelSummary[]
  pluginId: string
  pluginName: string
  version: string
}

export interface PluginServiceStatus {
  account: { availability: "available"; displayName: string } | { availability: "unavailable" }
  credential: {
    configured: boolean
    verification: PluginServiceCredentialVerification
  }
  credits: { availability: "available"; remaining: number; unit: string } | { availability: "unavailable" }
  schema: typeof pluginServiceStatusSchema
  state: PluginServiceState
  usage:
    | { availability: "available"; consumed: number; period?: string; unit: string }
    | { availability: "unavailable" }
}

export interface PluginServiceTarget {
  pluginId: string
}

/** Renderer-facing bridge with one fixed method per allowed sidecar action. */
export interface PluginServiceClient {
  authorize(input: PluginServiceTarget): Promise<PluginServiceStatus>
  cancelAuthorization(input: PluginServiceTarget): Promise<PluginServiceStatus>
  getStatus(input: PluginServiceTarget): Promise<PluginServiceStatus>
  listServices(): Promise<readonly PluginServiceSummary[]>
  onDidChange(listener: () => void): () => void
  reauthorize(input: PluginServiceTarget): Promise<PluginServiceStatus>
  signOut(input: PluginServiceTarget): Promise<PluginServiceStatus>
}

const states = new Set<unknown>(["connected", "disconnected", "attention", "unknown"])
const verifications = new Set<unknown>(["verified", "unverified", "failed", "unknown"])

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
) {
  const allowedKeys = new Set(allowed)
  if (Object.keys(value).some((key) => !allowedKeys.has(key)) || required.some((key) => !(key in value))) {
    throw new Error(`${label} contains unsupported or missing fields`)
  }
}

function requireDisplayString(value: unknown, label: string, maximumLength: number) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !value ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    /[a-z][a-z0-9+.-]*:\/\//i.test(value) ||
    /(?:^|\s)(?:file:|mailto:|data:|\.{1,2}[\\/]|\/{1,2}(?:[^\s]|$)|[A-Za-z]:[\\/]|\\\\)/i.test(value) ||
    /\b(?:bearer|cookie|token|access[ _-]?key|secret[ _-]?key|ak|sk)\b\s*[:=]?\s*\S{8,}/i.test(value) ||
    /\b[A-Za-z0-9_-]{48,}\b/.test(value)
  ) {
    throw new Error(`${label} must be bounded display text without a URL or native path`)
  }
  return value
}

function requireMetric(value: unknown, label: string, field: "remaining" | "consumed") {
  const metric = requireRecord(value, label)
  if (metric.availability === "unavailable") {
    requireExactKeys(metric, ["availability"], ["availability"], label)
    return null
  }
  requireExactKeys(metric, ["availability", field, "unit"], ["availability", field, "unit"], label)
  if (metric.availability !== "available") throw new Error(`${label} availability is invalid`)
  const numericValue = metric[field]
  if (typeof numericValue !== "number" || !Number.isFinite(numericValue) || numericValue < 0 || numericValue > 1e15) {
    throw new Error(`${label} value is invalid`)
  }
  return { unit: requireDisplayString(metric.unit, `${label} unit`, 32), value: numericValue }
}

/**
 * Reduces an untrusted MCP result to a small display-only status. Unknown fields,
 * URLs, paths and arbitrary diagnostic strings fail closed before preload.
 */
export function parsePluginServiceStatus(value: unknown): PluginServiceStatus {
  const status = requireRecord(value, "Plugin service status")
  requireExactKeys(
    status,
    ["account", "credential", "credits", "schema", "state", "usage"],
    ["account", "credential", "credits", "schema", "state", "usage"],
    "Plugin service status",
  )
  if (status.schema !== pluginServiceStatusSchema) throw new Error("Plugin service status schema is invalid")
  if (!states.has(status.state)) throw new Error("Plugin service state is invalid")

  const credential = requireRecord(status.credential, "Plugin service credential")
  requireExactKeys(
    credential,
    ["configured", "verification"],
    ["configured", "verification"],
    "Plugin service credential",
  )
  if (typeof credential.configured !== "boolean" || !verifications.has(credential.verification)) {
    throw new Error("Plugin service credential is invalid")
  }
  if (!credential.configured && credential.verification === "verified") {
    throw new Error("Plugin service credential cannot be verified when it is not configured")
  }
  if (status.state === "connected" && !credential.configured) {
    throw new Error("Connected Plugin service must have a configured credential")
  }

  const account = requireRecord(status.account, "Plugin service account")
  let parsedAccount: PluginServiceStatus["account"]
  if (account.availability === "unavailable") {
    requireExactKeys(account, ["availability"], ["availability"], "Plugin service account")
    parsedAccount = { availability: "unavailable" }
  } else {
    requireExactKeys(
      account,
      ["availability", "displayName"],
      ["availability", "displayName"],
      "Plugin service account",
    )
    if (account.availability !== "available") throw new Error("Plugin service account availability is invalid")
    parsedAccount = {
      availability: "available",
      displayName: requireDisplayString(account.displayName, "Plugin service account name", 120),
    }
  }

  const creditsMetric = requireMetric(status.credits, "Plugin service credits", "remaining")
  const credits: PluginServiceStatus["credits"] = creditsMetric
    ? { availability: "available", remaining: creditsMetric.value, unit: creditsMetric.unit }
    : { availability: "unavailable" }
  const usageValue = requireRecord(status.usage, "Plugin service usage")
  let usage: PluginServiceStatus["usage"]
  if (usageValue.availability === "unavailable") {
    requireExactKeys(usageValue, ["availability"], ["availability"], "Plugin service usage")
    usage = { availability: "unavailable" }
  } else {
    requireExactKeys(
      usageValue,
      ["availability", "consumed", "period", "unit"],
      ["availability", "consumed", "unit"],
      "Plugin service usage",
    )
    if (usageValue.availability !== "available") throw new Error("Plugin service usage availability is invalid")
    const base = requireMetric(
      { availability: usageValue.availability, consumed: usageValue.consumed, unit: usageValue.unit },
      "Plugin service usage",
      "consumed",
    )
    if (!base) throw new Error("Plugin service usage is invalid")
    usage = {
      availability: "available",
      consumed: base.value,
      ...(usageValue.period === undefined
        ? {}
        : { period: requireDisplayString(usageValue.period, "Plugin service usage period", 64) }),
      unit: base.unit,
    }
  }

  return {
    account: parsedAccount,
    credential: {
      configured: credential.configured,
      verification: credential.verification as PluginServiceCredentialVerification,
    },
    credits,
    schema: pluginServiceStatusSchema,
    state: status.state as PluginServiceState,
    usage,
  }
}
