import {
  parsePluginServiceStatus,
  parsePluginServiceUsageHistory,
  type PluginServiceStatus,
  type PluginServiceSummary,
  type PluginServiceUsageHistory,
  type ServiceCapability,
  type ServiceModelSummary,
} from "../plugin-service-contracts"
import { webPluginServiceActions, type WebPluginServiceAction } from "../plugin-contracts"

export interface PluginServiceDisplayProjectionEntry extends PluginServiceSummary {
  status?: PluginServiceStatus
  usageHistory?: PluginServiceUsageHistory
}

export interface PluginServiceDisplayProjection {
  services: readonly PluginServiceDisplayProjectionEntry[]
}

export interface PluginServiceProjectionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const pluginServiceProjectionStorageKey = "convax.desktop.plugin-service-display.v1"

const pluginServiceProjectionSchema = "convax.plugin-service-display-cache/1"
const maximumCacheBytes = 512 * 1024
const maximumServices = 128
const maximumModelsPerService = 512
const utf8Encoder = new TextEncoder()
const serviceActions = new Set<unknown>(webPluginServiceActions)
const serviceCapabilities = new Set<unknown>(["llm", "text", "image", "video", "audio"])
const pluginIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key))
}

function isSafeDisplayString(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/[a-z][a-z0-9+.-]*:\/\//i.test(value) &&
    !/(?:^|\s)(?:file:|mailto:|data:|\.{1,2}[\\/]|\/{1,2}(?:[^\s]|$)|[A-Za-z]:[\\/]|\\\\)/i.test(value) &&
    !/\b(?:bearer|cookie|token|access[ _-]?key|secret[ _-]?key|ak|sk)\b\s*[:=]?\s*\S{8,}/i.test(value) &&
    !/\b[A-Za-z0-9_-]{48,}\b/.test(value)
  )
}

function isServiceCapability(value: unknown): value is ServiceCapability {
  return serviceCapabilities.has(value)
}

function isServiceModel(value: unknown): value is ServiceModelSummary {
  return (
    hasExactKeys(value, ["capability", "id", "name"]) &&
    isServiceCapability(value.capability) &&
    isSafeDisplayString(value.id, 256) &&
    isSafeDisplayString(value.name, 160)
  )
}

function isServiceAction(value: unknown): value is WebPluginServiceAction {
  return serviceActions.has(value)
}

function parseProjectionEntry(value: unknown): PluginServiceDisplayProjectionEntry | null {
  if (
    !hasExactKeys(
      value,
      ["actions", "capabilities", "description", "models", "pluginId", "pluginName", "version"],
      ["status", "usageHistory"],
    )
  ) {
    return null
  }
  if (
    !Array.isArray(value.actions) ||
    value.actions.length > webPluginServiceActions.length ||
    !value.actions.every(isServiceAction) ||
    new Set(value.actions).size !== value.actions.length ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length > serviceCapabilities.size ||
    !value.capabilities.every(isServiceCapability) ||
    new Set(value.capabilities).size !== value.capabilities.length ||
    !isSafeDisplayString(value.description, 2_000) ||
    !Array.isArray(value.models) ||
    value.models.length > maximumModelsPerService ||
    !value.models.every(isServiceModel) ||
    new Set(value.models.map((model) => `${model.capability}:${model.id}`)).size !== value.models.length ||
    typeof value.pluginId !== "string" ||
    value.pluginId.length > 128 ||
    !pluginIdPattern.test(value.pluginId) ||
    !isSafeDisplayString(value.pluginName, 160) ||
    typeof value.version !== "string" ||
    !semanticVersionPattern.test(value.version)
  ) {
    return null
  }
  let status: PluginServiceStatus | undefined
  let usageHistory: PluginServiceUsageHistory | undefined
  try {
    status = value.status === undefined ? undefined : parsePluginServiceStatus(value.status)
    usageHistory = value.usageHistory === undefined ? undefined : parsePluginServiceUsageHistory(value.usageHistory)
  } catch {
    return null
  }
  return {
    actions: [...value.actions],
    capabilities: [...value.capabilities],
    description: value.description,
    models: value.models.map((model) => ({ ...model })),
    pluginId: value.pluginId,
    pluginName: value.pluginName,
    ...(status === undefined ? {} : { status }),
    ...(usageHistory === undefined ? {} : { usageHistory }),
    version: value.version,
  }
}

function parseProjection(value: unknown): PluginServiceDisplayProjection | null {
  if (!hasExactKeys(value, ["services"]) || !Array.isArray(value.services) || value.services.length > maximumServices) {
    return null
  }
  const services = value.services.map(parseProjectionEntry)
  if (services.some((service) => service === null)) return null
  const parsed = services as PluginServiceDisplayProjectionEntry[]
  if (new Set(parsed.map(({ pluginId }) => pluginId)).size !== parsed.length) return null
  return { services: parsed }
}

export function rendererPluginServiceProjectionStorage(): PluginServiceProjectionStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

export function readPluginServiceProjection(
  storage: PluginServiceProjectionStorage | undefined,
): PluginServiceDisplayProjection | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(pluginServiceProjectionStorageKey)
    if (!raw || raw.length > maximumCacheBytes || utf8Encoder.encode(raw).byteLength > maximumCacheBytes) return null
    const value: unknown = JSON.parse(raw)
    if (!hasExactKeys(value, ["projection", "schema"]) || value.schema !== pluginServiceProjectionSchema) return null
    return parseProjection(value.projection)
  } catch {
    return null
  }
}

export function writePluginServiceProjection(
  storage: PluginServiceProjectionStorage | undefined,
  projection: PluginServiceDisplayProjection,
) {
  if (!storage) return false
  const parsed = parseProjection(projection)
  if (!parsed) return false
  try {
    const raw = JSON.stringify({ projection: parsed, schema: pluginServiceProjectionSchema })
    if (raw.length > maximumCacheBytes || utf8Encoder.encode(raw).byteLength > maximumCacheBytes) return false
    storage.setItem(pluginServiceProjectionStorageKey, raw)
    return true
  } catch {
    return false
  }
}
