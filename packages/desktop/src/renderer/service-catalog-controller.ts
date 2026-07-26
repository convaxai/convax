import type { AgentClient, AgentModelCatalog } from "@convax/agent-runtime"

import type {
  PluginServiceClient,
  PluginServiceState,
  PluginServiceStatus,
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
  version: string
}

export interface BuiltinServiceCatalogEntry extends ServiceCatalogEntryBase {
  kind: "builtin"
}

export type ServiceCatalogEntry = PluginServiceCatalogEntry | BuiltinServiceCatalogEntry

export interface ServiceCatalogSnapshot {
  action?: { action: WebPluginServiceAction; pluginId: string }
  error?: string
  loading: boolean
  services: readonly ServiceCatalogEntry[]
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

function pluginEntry(service: PluginServiceViewEntry, catalog?: AgentModelCatalog): PluginServiceCatalogEntry {
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
    state: service.status?.state ?? "unknown",
    status: service.status,
    version: service.version,
  }
}

function openCodeEntry(input: {
  catalog?: AgentModelCatalog
  error?: string
  loading: boolean
}): BuiltinServiceCatalogEntry {
  const connectedProviders =
    input.catalog?.providers.filter((provider) => provider.connected && !provider.providerId.startsWith("plugin-")) ??
    []
  return {
    authentication: "not-applicable",
    billing: { kind: "free" },
    capabilities: ["llm"],
    description: "OpenCode agent runtime",
    error: input.error,
    kind: "builtin",
    loading: input.loading,
    models: connectedProviders.flatMap((provider) =>
      provider.models.map((model) => ({
        capability: "llm" as const,
        default: model.default,
        id: JSON.stringify([provider.providerId, model.modelId]),
        name: model.modelName,
        providerName: provider.providerName,
      })),
    ),
    name: "OpenCode",
    serviceId: "builtin:opencode",
    state: input.error ? "attention" : "connected",
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
  #disposed = false
  #modelGeneration = 0
  #pluginSnapshot: PluginServicesSnapshot
  #scopeId?: string
  #snapshot: ServiceCatalogSnapshot
  #started = false
  #unsubscribePlugins?: () => void

  constructor(
    pluginClient: PluginServiceClient,
    private readonly agentClient: Pick<AgentClient, "listModels">,
  ) {
    this.#plugins = new PluginServicesController(pluginClient)
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
      this.#publish()
    })
    this.#plugins.start()
    void this.#refreshModels()
  }

  setScopeId(scopeId?: string) {
    if (this.#disposed || scopeId === this.#scopeId) return
    this.#scopeId = scopeId
    this.#agentCatalog = undefined
    this.#agentError = undefined
    this.#modelGeneration += 1
    if (this.#started) void this.#refreshModels()
    else this.#publish()
  }

  async refresh() {
    if (this.#disposed) return
    await Promise.all([this.#plugins.refresh(), this.#refreshModels()])
  }

  async perform(pluginId: string, action: WebPluginServiceAction) {
    return this.#plugins.perform(pluginId, action)
  }

  async checkout(pluginId: string, planKey: string) {
    return this.#plugins.checkout(pluginId, planKey)
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#modelGeneration += 1
    this.#unsubscribePlugins?.()
    this.#unsubscribePlugins = undefined
    this.#plugins.dispose()
    this.#listeners.clear()
  }

  async #refreshModels() {
    if (this.#disposed) return
    const scopeId = this.#scopeId
    const generation = ++this.#modelGeneration
    if (!scopeId) {
      this.#agentCatalog = undefined
      this.#agentError = undefined
      this.#agentLoading = false
      this.#publish()
      return
    }
    this.#agentLoading = true
    this.#agentError = undefined
    this.#publish()
    try {
      const catalog = await this.agentClient.listModels({ scopeId })
      if (this.#disposed || generation !== this.#modelGeneration || scopeId !== this.#scopeId) return
      this.#agentCatalog = catalog
      this.#agentLoading = false
      this.#publish()
    } catch (error) {
      if (this.#disposed || generation !== this.#modelGeneration || scopeId !== this.#scopeId) return
      this.#agentCatalog = undefined
      this.#agentError = errorMessage(error)
      this.#agentLoading = false
      this.#publish()
    }
  }

  #compose(): ServiceCatalogSnapshot {
    return {
      action: this.#pluginSnapshot.action,
      error: this.#pluginSnapshot.error,
      loading: this.#pluginSnapshot.loading || this.#agentLoading,
      services: [
        openCodeEntry({ catalog: this.#agentCatalog, error: this.#agentError, loading: this.#agentLoading }),
        ...this.#pluginSnapshot.services.map((service) => pluginEntry(service, this.#agentCatalog)),
      ],
    }
  }

  #publish() {
    this.#snapshot = this.#compose()
    for (const listener of this.#listeners) listener()
  }
}
