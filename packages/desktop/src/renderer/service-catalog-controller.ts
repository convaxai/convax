import type { AgentClient, AgentModelCatalog } from "@convax/agent-runtime"

import type {
  PluginServiceClient,
  PluginServiceState,
  PluginServiceStatus,
  PluginServiceUsageHistory,
  ServiceCapability,
  ServiceModelSummary,
} from "../plugin-service-contracts"
import type { WebPluginServiceAction } from "../plugin-contracts"
import {
  PluginServicesController,
  type PluginServicesSnapshot,
  type PluginServiceViewEntry,
} from "./plugin-services-controller"

export type ServiceBilling =
  | { kind: "credits"; remaining?: number; unit?: string }
  | { kind: "subscription"; name?: string }
  | { kind: "free" }
  | { kind: "unknown" }

export type ServiceAuthentication = "authenticated" | "required" | "not-applicable" | "unknown"

export interface ServiceCatalogModel extends ServiceModelSummary {
  default?: boolean
  providerName?: string
}

interface ServiceCatalogEntryBase {
  authentication: ServiceAuthentication
  billing: ServiceBilling
  capabilities: readonly ServiceCapability[]
  description: string
  error?: string
  loading: boolean
  models: readonly ServiceCatalogModel[]
  name: string
  serviceId: string
  state: PluginServiceState
}

export interface PluginServiceCatalogEntry extends ServiceCatalogEntryBase {
  actions: readonly WebPluginServiceAction[]
  kind: "plugin"
  pluginId: string
  status?: PluginServiceStatus
  usageHistory?: PluginServiceUsageHistory
  version: string
}

export interface BuiltinServiceCatalogEntry extends ServiceCatalogEntryBase {
  kind: "builtin"
}

export type ServiceCatalogEntry = PluginServiceCatalogEntry | BuiltinServiceCatalogEntry

export interface ServiceCatalogAgentModelState {
  catalog?: AgentModelCatalog
  error?: string
  loading: boolean
  scopeId?: string
}

export interface ServiceCatalogSnapshot {
  action?: { action: WebPluginServiceAction; pluginId: string }
  agentModels?: ServiceCatalogAgentModelState
  error?: string
  loading: boolean
  services: readonly ServiceCatalogEntry[]
}

export function serviceCatalogAgentModelsForScope(
  snapshot: ServiceCatalogSnapshot,
  scopeId?: string,
): ServiceCatalogAgentModelState {
  const current = snapshot.agentModels
  return current && current.scopeId === scopeId ? current : { loading: Boolean(scopeId), scopeId }
}

/**
 * Generation model discovery is stricter than the display catalog: Main exposes
 * models only after the owning service reports connected. Keep a small renderer
 * invalidation key that changes with settled authority availability, not with
 * transient refresh/loading presentation state.
 */
export function serviceGenerationAvailabilityVersion(
  snapshot: ServiceCatalogSnapshot,
  generationPluginIds: readonly string[],
) {
  const included = new Set(generationPluginIds)
  return JSON.stringify(
    snapshot.services
      .flatMap((service) =>
        service.kind === "plugin" && included.has(service.pluginId)
          ? [{ pluginId: service.pluginId, state: service.state }]
          : [],
      )
      .sort((left, right) => left.pluginId.localeCompare(right.pluginId)),
  )
}

function pluginAuthentication(service: PluginServiceViewEntry): ServiceAuthentication {
  if (!service.status) return "unknown"
  if (service.status.credential.configured) return "authenticated"
  return service.actions.includes("authorize") || service.actions.includes("reauthorize") ? "required" : "unknown"
}

function pluginBilling(service: PluginServiceViewEntry): ServiceBilling {
  const plan = service.status?.plan
  if (plan?.availability === "available") {
    return plan.key === "free" ? { kind: "free" } : { kind: "subscription", name: plan.name }
  }
  const credits = service.status?.credits
  return credits?.availability === "available"
    ? { kind: "credits", remaining: credits.remaining, unit: credits.unit }
    : { kind: "unknown" }
}

function pluginProviderPrefix(pluginId: string) {
  return `plugin-${pluginId}-`
}

function pluginEntry(
  service: PluginServiceViewEntry,
  catalog?: AgentModelCatalog,
  stableState?: PluginServiceState,
): PluginServiceCatalogEntry {
  const connectedLlmProviders =
    catalog?.providers.filter(
      (provider) => provider.connected && provider.providerId.startsWith(pluginProviderPrefix(service.pluginId)),
    ) ?? []
  const models =
    connectedLlmProviders.length === 0
      ? service.models
      : [
          ...service.models.filter((model) => model.capability !== "llm"),
          ...connectedLlmProviders.flatMap((provider) =>
            provider.models.map((model) => ({
              capability: "llm" as const,
              default: model.default,
              id: model.modelId,
              name: model.modelName,
            })),
          ),
        ]
  return {
    actions: service.actions,
    authentication: pluginAuthentication(service),
    billing: pluginBilling(service),
    capabilities: [...new Set(models.map((model) => model.capability))],
    description: service.description,
    error: service.error,
    kind: "plugin",
    loading: service.loading,
    models,
    name: service.pluginName,
    pluginId: service.pluginId,
    serviceId: `plugin:${service.pluginId}`,
    state: service.status?.state ?? stableState ?? "unknown",
    status: service.status,
    usageHistory: service.usageHistory,
    version: service.version,
  }
}

function openCodeEntry(input: {
  catalog?: AgentModelCatalog
  error?: string
  loading: boolean
}): BuiltinServiceCatalogEntry {
  const connectedProviders =
    input.catalog?.providers.filter(
      (provider) => provider.connected && provider.models.length > 0 && !provider.providerId.startsWith("plugin-"),
    ) ?? []
  const models = connectedProviders.flatMap((provider) =>
    provider.models.map((model) => ({
      capability: "llm" as const,
      default: model.default,
      id: JSON.stringify([provider.providerId, model.modelId]),
      name: model.modelName,
      providerName: provider.providerName,
    })),
  )
  return {
    authentication: "not-applicable",
    billing: { kind: "free" },
    capabilities: ["llm"],
    description: "OpenCode agent runtime",
    error: input.error,
    kind: "builtin",
    loading: input.loading,
    models,
    name: "OpenCode",
    serviceId: "builtin:opencode",
    state: input.error ? "attention" : input.loading ? "unknown" : models.length > 0 ? "connected" : "disconnected",
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Desktop-only read model joining installed Plugin services with the existing
 * OpenCode Agent runtime. Execution remains owned by Plugin generation tools and
 * Agent Runtime respectively; this catalog deliberately has no execute method.
 */
export class ServiceCatalogController {
  readonly #listeners = new Set<() => void>()
  readonly #plugins: PluginServicesController
  #agentCatalog?: AgentModelCatalog
  #agentError?: string
  #agentLoading = false
  #agentRefreshQueued = false
  #agentRequest?: { promise: Promise<AgentModelCatalog | undefined>; scopeId: string }
  #disposed = false
  #modelGeneration = 0
  #pluginSnapshot: PluginServicesSnapshot
  #scopeId?: string
  #snapshot: ServiceCatalogSnapshot
  readonly #stablePluginStates = new Map<string, PluginServiceState>()
  #started = false
  #unsubscribeModelChanges?: () => void
  #unsubscribePlugins?: () => void

  constructor(
    private readonly pluginClient: PluginServiceClient,
    private readonly agentClient: Pick<AgentClient, "listModels">,
  ) {
    this.#plugins = new PluginServicesController(this.pluginClient)
    this.#pluginSnapshot = this.#plugins.getSnapshot()
    this.#snapshot = this.#compose()
  }

  readonly getSnapshot = () => this.#snapshot

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  start() {
    if (this.#disposed || this.#started) return
    this.#started = true
    this.#unsubscribePlugins = this.#plugins.subscribe(() => {
      this.#pluginSnapshot = this.#plugins.getSnapshot()
      this.#rememberStablePluginStates()
      this.#publish()
    })
    this.#unsubscribeModelChanges = this.pluginClient.onDidChange(() => {
      this.#refreshModelsAfterInFlight()
    })
    this.#plugins.start()
    void this.#refreshModels().catch(() => undefined)
  }

  setScopeId(scopeId?: string) {
    if (this.#disposed || scopeId === this.#scopeId) return
    this.#scopeId = scopeId
    this.#agentCatalog = undefined
    this.#agentError = undefined
    this.#agentRefreshQueued = false
    this.#agentRequest = undefined
    this.#modelGeneration += 1
    if (this.#started) void this.#refreshModels().catch(() => undefined)
    else this.#publish()
  }

  async refresh() {
    if (this.#disposed) return
    await Promise.all([this.#plugins.refresh(), this.#refreshModelsIncludingQueued().catch(() => undefined)])
  }

  readonly refreshAgentModels = () => this.#refreshModelsIncludingQueued()

  async perform(pluginId: string, action: WebPluginServiceAction) {
    await this.#plugins.perform(pluginId, action)
    await this.#refreshModelsIncludingQueued().catch(() => undefined)
  }

  async checkout(pluginId: string, planKey: string) {
    return this.#plugins.checkout(pluginId, planKey)
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#modelGeneration += 1
    this.#agentRefreshQueued = false
    this.#agentRequest = undefined
    this.#unsubscribePlugins?.()
    this.#unsubscribePlugins = undefined
    this.#unsubscribeModelChanges?.()
    this.#unsubscribeModelChanges = undefined
    this.#plugins.dispose()
    this.#listeners.clear()
  }

  #refreshModels(): Promise<AgentModelCatalog | undefined> {
    if (this.#disposed) return Promise.resolve(undefined)
    const scopeId = this.#scopeId
    if (!scopeId) {
      this.#modelGeneration += 1
      this.#agentRefreshQueued = false
      this.#agentRequest = undefined
      this.#agentCatalog = undefined
      this.#agentError = undefined
      this.#agentLoading = false
      this.#publish()
      return Promise.resolve(undefined)
    }
    if (this.#agentRequest?.scopeId === scopeId) return this.#agentRequest.promise
    const generation = ++this.#modelGeneration
    this.#agentLoading = true
    this.#agentError = undefined
    this.#publish()
    const request = this.agentClient
      .listModels({ scopeId })
      .then((catalog) => {
        if (this.#disposed || generation !== this.#modelGeneration || scopeId !== this.#scopeId) return undefined
        this.#agentCatalog = catalog
        this.#agentLoading = false
        this.#publish()
        return catalog
      })
      .catch((error: unknown) => {
        if (!this.#disposed && generation === this.#modelGeneration && scopeId === this.#scopeId) {
          this.#agentError = errorMessage(error)
          this.#agentLoading = false
          this.#publish()
        }
        throw error
      })
      .finally(() => {
        if (this.#agentRequest?.promise !== request) return
        this.#agentRequest = undefined
        const refreshAgain = this.#agentRefreshQueued && !this.#disposed && scopeId === this.#scopeId
        this.#agentRefreshQueued = false
        if (refreshAgain) void this.#refreshModels().catch(() => undefined)
      })
    this.#agentRequest = { promise: request, scopeId }
    return request
  }

  async #refreshModelsIncludingQueued(): Promise<AgentModelCatalog | undefined> {
    const scopeId = this.#scopeId
    let request = this.#refreshModels()
    for (;;) {
      let failed = false
      let failure: unknown
      let result: AgentModelCatalog | undefined
      try {
        result = await request
      } catch (error) {
        failed = true
        failure = error
      }
      const trailing =
        scopeId && this.#agentRequest?.scopeId === scopeId && this.#agentRequest.promise !== request
          ? this.#agentRequest.promise
          : undefined
      if (trailing) {
        request = trailing
        continue
      }
      if (failed) throw failure
      return result
    }
  }

  #refreshModelsAfterInFlight() {
    if (this.#disposed) return
    const scopeId = this.#scopeId
    if (scopeId && this.#agentRequest?.scopeId === scopeId) {
      this.#agentRefreshQueued = true
      return
    }
    void this.#refreshModels().catch(() => undefined)
  }

  #compose(): ServiceCatalogSnapshot {
    return {
      action: this.#pluginSnapshot.action,
      agentModels: {
        catalog: this.#agentCatalog,
        error: this.#agentError,
        loading: this.#agentLoading,
        scopeId: this.#scopeId,
      },
      error: this.#pluginSnapshot.error,
      loading: this.#pluginSnapshot.loading || this.#agentLoading,
      services: [
        openCodeEntry({ catalog: this.#agentCatalog, error: this.#agentError, loading: this.#agentLoading }),
        ...this.#pluginSnapshot.services.map((service) =>
          pluginEntry(service, this.#agentCatalog, this.#stablePluginStates.get(service.pluginId)),
        ),
      ],
    }
  }

  #rememberStablePluginStates() {
    if (!this.#pluginSnapshot.loading) {
      const presentPluginIds = new Set(this.#pluginSnapshot.services.map((service) => service.pluginId))
      for (const pluginId of this.#stablePluginStates.keys()) {
        if (!presentPluginIds.has(pluginId)) this.#stablePluginStates.delete(pluginId)
      }
    }
    for (const service of this.#pluginSnapshot.services) {
      if (!service.loading && service.status) {
        this.#stablePluginStates.set(service.pluginId, service.status.state)
      }
    }
  }

  #publish() {
    this.#snapshot = this.#compose()
    for (const listener of this.#listeners) listener()
  }
}
