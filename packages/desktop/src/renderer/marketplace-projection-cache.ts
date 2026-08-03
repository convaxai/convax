import type {
  MarketplaceCatalogCard,
  MarketplaceClient,
  MarketplaceInstalledCapability,
  MarketplacePluginRuntimeState,
  MarketplaceSettingsSource,
} from "../marketplace-contracts"

export interface MarketplaceViewProjection {
  catalog: MarketplaceCatalogCard[]
  installed: MarketplaceInstalledCapability[]
  pluginRuntimeState: MarketplacePluginRuntimeState
  sources: MarketplaceSettingsSource[]
}

interface MarketplaceProjectionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface MarketplaceProjectionCacheEntry {
  generation: number
  projection: MarketplaceViewProjection | null
  request?: Promise<MarketplaceViewProjection>
}

export const marketplaceProjectionStorageKey = "convax.desktop.marketplace-display.v1"

const marketplaceProjectionSchema = "convax.marketplace-display-cache/1"
const maxCacheBytes = 2 * 1024 * 1024
const maxCapabilities = 4_096
const maxSources = 64
const entries = new WeakMap<MarketplaceClient, MarketplaceProjectionCacheEntry>()

const capabilityKinds = new Set(["mcp-server", "plugin", "skill"])
const capabilityStates = new Set(["attention", "disabled", "ready", "setup-required"])
const pluginRuntimeStates = new Set(["available", "unavailable-for-session"])
const runtimeScopes = new Set(["agent", "agent-and-convax"])
const sourceHealthStates = new Set(["attention", "available", "offline", "refreshing"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
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

function isBoundedString(value: unknown, maxLength = 2_048): value is string {
  return typeof value === "string" && value.length <= maxLength
}

function isNaturalNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isOneOf(value: unknown, values: ReadonlySet<string>): value is string {
  return typeof value === "string" && values.has(value)
}

function isCatalogCard(value: unknown): value is MarketplaceCatalogCard {
  if (!hasExactKeys(value, ["description", "id", "kind", "name", "otherSourceCount"], ["installed", "runtimeScope"])) {
    return false
  }
  if (
    !isBoundedString(value.description, 8_192) ||
    !isBoundedString(value.id, 256) ||
    !isOneOf(value.kind, capabilityKinds) ||
    !isBoundedString(value.name, 1_024) ||
    !isNaturalNumber(value.otherSourceCount) ||
    (value.runtimeScope !== undefined && !isOneOf(value.runtimeScope, runtimeScopes))
  ) {
    return false
  }
  if (value.installed === undefined) return true
  return (
    hasExactKeys(value.installed, ["sourceLabel", "state", "version"]) &&
    isBoundedString(value.installed.sourceLabel, 1_024) &&
    isOneOf(value.installed.state, capabilityStates) &&
    isBoundedString(value.installed.version, 256)
  )
}

function isInstalledCapability(value: unknown): value is MarketplaceInstalledCapability {
  if (
    !hasExactKeys(
      value,
      ["id", "kind", "name", "sourceLabel", "state", "updateAvailable", "version"],
      ["attention", "runtimeScope", "updateRecoveryAvailable"],
    )
  ) {
    return false
  }
  return (
    isBoundedString(value.id, 256) &&
    isOneOf(value.kind, capabilityKinds) &&
    isBoundedString(value.name, 1_024) &&
    isBoundedString(value.sourceLabel, 1_024) &&
    isOneOf(value.state, capabilityStates) &&
    typeof value.updateAvailable === "boolean" &&
    isBoundedString(value.version, 256) &&
    (value.attention === undefined || isBoundedString(value.attention, 1_024)) &&
    (value.runtimeScope === undefined || isOneOf(value.runtimeScope, runtimeScopes)) &&
    (value.updateRecoveryAvailable === undefined || value.updateRecoveryAvailable === true)
  )
}

function isMarketplaceSource(value: unknown): value is MarketplaceSettingsSource {
  if (!hasExactKeys(value, ["health", "id", "label", "packageCount", "publisher", "removable", "repository"])) {
    return false
  }
  return (
    isOneOf(value.health, sourceHealthStates) &&
    isBoundedString(value.id, 256) &&
    isBoundedString(value.label, 1_024) &&
    isNaturalNumber(value.packageCount) &&
    isBoundedString(value.publisher, 1_024) &&
    typeof value.removable === "boolean" &&
    isBoundedString(value.repository, 2_048)
  )
}

function isMarketplaceProjection(value: unknown): value is MarketplaceViewProjection {
  if (!hasExactKeys(value, ["catalog", "installed", "pluginRuntimeState", "sources"])) return false
  return (
    Array.isArray(value.catalog) &&
    value.catalog.length <= maxCapabilities &&
    value.catalog.every(isCatalogCard) &&
    Array.isArray(value.installed) &&
    value.installed.length <= maxCapabilities &&
    value.installed.every(isInstalledCapability) &&
    isOneOf(value.pluginRuntimeState, pluginRuntimeStates) &&
    Array.isArray(value.sources) &&
    value.sources.length <= maxSources &&
    value.sources.every(isMarketplaceSource)
  )
}

export function rendererMarketplaceProjectionStorage(): MarketplaceProjectionStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

export function readMarketplaceProjection(
  storage: MarketplaceProjectionStorage | undefined,
): MarketplaceViewProjection | null {
  // This cache is presentation-only. Unknown fields fail closed so Main-only
  // authority cannot accidentally become durable renderer state.
  if (!storage) return null
  try {
    const raw = storage.getItem(marketplaceProjectionStorageKey)
    if (!raw || raw.length > maxCacheBytes) return null
    const value: unknown = JSON.parse(raw)
    if (!hasExactKeys(value, ["projection", "schema"])) return null
    if (value.schema !== marketplaceProjectionSchema || !isMarketplaceProjection(value.projection)) return null
    return value.projection
  } catch {
    return null
  }
}

export function writeMarketplaceProjection(
  storage: MarketplaceProjectionStorage | undefined,
  projection: MarketplaceViewProjection,
) {
  if (!storage || !isMarketplaceProjection(projection)) return false
  try {
    const raw = JSON.stringify({ projection, schema: marketplaceProjectionSchema })
    if (raw.length > maxCacheBytes) return false
    storage.setItem(marketplaceProjectionStorageKey, raw)
    return true
  } catch {
    return false
  }
}

function entryFor(client: MarketplaceClient, storage: MarketplaceProjectionStorage | undefined) {
  const current = entries.get(client)
  if (current) return current
  const entry: MarketplaceProjectionCacheEntry = {
    generation: 0,
    projection: readMarketplaceProjection(storage),
  }
  entries.set(client, entry)
  return entry
}

export function getMarketplaceProjection(client: MarketplaceClient, storage = rendererMarketplaceProjectionStorage()) {
  return entryFor(client, storage).projection
}

async function fetchMarketplaceProjection(client: MarketplaceClient): Promise<MarketplaceViewProjection> {
  const [catalog, installed, sources] = await Promise.all([
    client.listCatalog(),
    client.listInstalled(),
    client.listMarketplaces(),
  ])
  return {
    catalog: catalog.cards,
    installed: installed.capabilities,
    pluginRuntimeState: installed.pluginRuntimeState,
    sources,
  }
}

function requestMarketplaceProjection(
  client: MarketplaceClient,
  storage: MarketplaceProjectionStorage | undefined,
  force: boolean,
) {
  const entry = entryFor(client, storage)
  if (!force && entry.request) return entry.request
  const generation = ++entry.generation
  let request!: Promise<MarketplaceViewProjection>
  request = fetchMarketplaceProjection(client)
    .then((projection) => {
      if (generation === entry.generation) {
        entry.projection = projection
        writeMarketplaceProjection(storage, projection)
      }
      return projection
    })
    .finally(() => {
      if (entry.request === request) entry.request = undefined
    })
  entry.request = request
  return request
}

export function preloadMarketplaceProjection(
  client: MarketplaceClient,
  storage = rendererMarketplaceProjectionStorage(),
) {
  return requestMarketplaceProjection(client, storage, false)
}

export function refreshMarketplaceProjection(
  client: MarketplaceClient,
  storage = rendererMarketplaceProjectionStorage(),
) {
  return requestMarketplaceProjection(client, storage, true)
}
