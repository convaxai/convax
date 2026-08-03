import {
  pluginServiceUsageSchema,
  type PluginServiceClient,
  type PluginServiceStatus,
  type PluginServiceSummary,
  type PluginServiceUsageHistory,
} from "../plugin-service-contracts"
import type { WebPluginServiceAction } from "../plugin-contracts"
import {
  readPluginServiceProjection,
  rendererPluginServiceProjectionStorage,
  writePluginServiceProjection,
  type PluginServiceProjectionStorage,
} from "./plugin-service-projection-cache"

export interface PluginServiceViewEntry extends PluginServiceSummary {
  error?: string
  loading: boolean
  status?: PluginServiceStatus
  usageHistory?: PluginServiceUsageHistory
}

export interface PluginServicesSnapshot {
  action?: { action: WebPluginServiceAction; pluginId: string }
  error?: string
  loading: boolean
  services: readonly PluginServiceViewEntry[]
}

function summaryFingerprint(summary: PluginServiceSummary) {
  return JSON.stringify({
    actions: [...summary.actions],
    capabilities: [...summary.capabilities],
    description: summary.description,
    models: summary.models.map((model) => ({ ...model })),
    pluginId: summary.pluginId,
    pluginName: summary.pluginName,
    version: summary.version,
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class PluginServicesController {
  readonly #listeners = new Set<() => void>()
  readonly #storage: PluginServiceProjectionStorage | undefined
  #actionEpoch = 0
  #disposed = false
  #generation = 0
  #snapshot: PluginServicesSnapshot
  #unsubscribe?: () => void

  constructor(
    private readonly client: PluginServiceClient,
    options: { storage?: PluginServiceProjectionStorage } = {},
  ) {
    this.#storage = options.storage ?? rendererPluginServiceProjectionStorage()
    const cached = readPluginServiceProjection(this.#storage)
    this.#snapshot = {
      loading: cached === null,
      services:
        cached?.services.map((service) => ({
          ...service,
          actions: [...service.actions],
          capabilities: [...service.capabilities],
          loading: service.status === undefined,
          models: service.models.map((model) => ({ ...model })),
        })) ?? [],
    }
  }

  readonly getSnapshot = () => this.#snapshot

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  start() {
    if (this.#disposed || this.#unsubscribe) return
    this.#unsubscribe = this.client.onDidChange(() => {
      void this.refresh()
    })
    void this.refresh()
  }

  async refresh() {
    if (this.#disposed) return
    const generation = ++this.#generation
    this.#actionEpoch += 1
    this.#setSnapshot({ loading: true, services: this.#snapshot.services })
    let services: readonly PluginServiceSummary[]
    try {
      services = await this.client.listServices()
    } catch (error) {
      if (this.#disposed || generation !== this.#generation) return
      this.#setSnapshot({ error: errorMessage(error), loading: false, services: this.#snapshot.services })
      return
    }
    if (this.#disposed || generation !== this.#generation) return
    const previousByPluginId = new Map(this.#snapshot.services.map((service) => [service.pluginId, service]))
    const entries = services.map((service) => {
      const previous = previousByPluginId.get(service.pluginId)
      const unchanged = previous && summaryFingerprint(previous) === summaryFingerprint(service) ? previous : undefined
      return {
        ...service,
        actions: [...service.actions],
        capabilities: [...service.capabilities],
        loading: unchanged?.status === undefined,
        models: service.models.map((model) => ({ ...model })),
        ...(unchanged?.status === undefined ? {} : { status: unchanged.status }),
        ...(unchanged?.usageHistory === undefined ? {} : { usageHistory: unchanged.usageHistory }),
      }
    })
    this.#setSnapshot({ loading: false, services: entries })
    this.#writeProjection()
    await Promise.all(entries.map((entry) => this.#loadStatus(entry, generation)))
  }

  async perform(pluginId: string, action: WebPluginServiceAction) {
    if (this.#disposed) return
    if (action === "checkout") throw new Error("Plugin service Checkout requires a Plan")
    const activeAction = this.#snapshot.action
    const supersedesAuthorization =
      action === "authorization.cancel" &&
      activeAction?.pluginId === pluginId &&
      (activeAction.action === "authorize" || activeAction.action === "reauthorize")
    if (activeAction?.pluginId === pluginId && !supersedesAuthorization) {
      throw new Error("Plugin service action is already active")
    }
    const entry = this.#snapshot.services.find((service) => service.pluginId === pluginId)
    if (!entry || !entry.actions.includes(action)) throw new Error("Plugin service action is no longer available")
    const generation = this.#generation
    const fingerprint = summaryFingerprint(entry)
    const actionEpoch = ++this.#actionEpoch
    this.#setSnapshot({ ...this.#snapshot, action: { action, pluginId } })
    try {
      const target = { pluginId }
      const status =
        action === "authorize"
          ? await this.client.authorize(target)
          : action === "reauthorize"
            ? await this.client.reauthorize(target)
            : action === "authorization.cancel"
              ? await this.client.cancelAuthorization(target)
              : await this.client.signOut(target)
      if (this.#isCurrent(entry, fingerprint, generation, actionEpoch)) {
        const clearsUsage = action === "authorize" || action === "reauthorize" || action === "sign_out"
        this.#replace(pluginId, (current) => ({
          ...current,
          error: undefined,
          loading: false,
          status,
          ...(clearsUsage ? { usageHistory: undefined } : {}),
        }))
        this.#writeProjection()
      }
      await this.#refreshUsageHistory(entry, fingerprint, generation, actionEpoch)
    } catch (error) {
      if (this.#isCurrent(entry, fingerprint, generation, actionEpoch)) {
        this.#replace(pluginId, (current) => ({ ...current, error: errorMessage(error), loading: false }))
      }
    } finally {
      if (!this.#disposed && actionEpoch === this.#actionEpoch) {
        const { action: _action, ...snapshot } = this.#snapshot
        this.#setSnapshot(snapshot)
      }
    }
  }

  async checkout(pluginId: string, planKey: string) {
    if (this.#disposed) return
    if (this.#snapshot.action?.pluginId === pluginId) throw new Error("Plugin service action is already active")
    const entry = this.#snapshot.services.find((service) => service.pluginId === pluginId)
    if (!entry || !entry.actions.includes("checkout")) {
      throw new Error("Plugin service Checkout is no longer available")
    }
    const checkout = entry.status?.billing.availability === "available" ? entry.status.billing.checkout : undefined
    if (checkout?.availability !== "available" || !checkout.plans.some(({ key }) => key === planKey)) {
      throw new Error("Plugin service Checkout Plan is no longer available")
    }
    const generation = this.#generation
    const fingerprint = summaryFingerprint(entry)
    const actionEpoch = ++this.#actionEpoch
    this.#setSnapshot({ ...this.#snapshot, action: { action: "checkout", pluginId } })
    try {
      const status = await this.client.checkout({ planKey, pluginId })
      if (this.#isCurrent(entry, fingerprint, generation, actionEpoch)) {
        this.#replace(pluginId, (current) => ({ ...current, error: undefined, loading: false, status }))
        this.#writeProjection()
      }
      await this.#refreshUsageHistory(entry, fingerprint, generation, actionEpoch)
    } catch (error) {
      if (this.#isCurrent(entry, fingerprint, generation, actionEpoch)) {
        this.#replace(pluginId, (current) => ({ ...current, error: errorMessage(error), loading: false }))
      }
    } finally {
      if (!this.#disposed && actionEpoch === this.#actionEpoch) {
        const { action: _action, ...snapshot } = this.#snapshot
        this.#setSnapshot(snapshot)
      }
    }
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#generation += 1
    this.#actionEpoch += 1
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#listeners.clear()
  }

  async #loadStatus(entry: PluginServiceViewEntry, generation: number) {
    const fingerprint = summaryFingerprint(entry)
    const status = this.client
      .getStatus({ pluginId: entry.pluginId })
      .then((nextStatus) => {
        if (!this.#isCurrent(entry, fingerprint, generation)) return
        this.#replace(entry.pluginId, (current) => ({
          ...current,
          error: undefined,
          loading: false,
          status: nextStatus,
        }))
        this.#writeProjection()
      })
      .catch((error: unknown) => {
        if (!this.#isCurrent(entry, fingerprint, generation)) return
        this.#replace(entry.pluginId, (current) => ({ ...current, error: errorMessage(error), loading: false }))
      })
    const usage = this.#refreshUsageHistory(entry, fingerprint, generation)
    await Promise.all([status, usage])
  }

  async #usageHistory(pluginId: string): Promise<PluginServiceUsageHistory> {
    return (
      (await this.client.getUsageHistory?.({ pluginId })) ?? {
        availability: "unavailable",
        schema: pluginServiceUsageSchema,
      }
    )
  }

  async #refreshUsageHistory(
    entry: PluginServiceSummary,
    fingerprint: string,
    generation: number,
    actionEpoch?: number,
  ) {
    try {
      const usageHistory = await this.#usageHistory(entry.pluginId)
      if (!this.#isCurrent(entry, fingerprint, generation, actionEpoch)) return
      this.#replace(entry.pluginId, (current) => ({ ...current, usageHistory }))
      this.#writeProjection()
    } catch {
      // Usage history is optional. Keep the last complete projection visible
      // when its independent background refresh fails.
    }
  }

  #isCurrent(entry: PluginServiceSummary, fingerprint: string, generation: number, actionEpoch?: number) {
    if (this.#disposed || generation !== this.#generation) return false
    if (actionEpoch !== undefined && actionEpoch !== this.#actionEpoch) return false
    const current = this.#snapshot.services.find((service) => service.pluginId === entry.pluginId)
    return Boolean(current && summaryFingerprint(current) === fingerprint)
  }

  #replace(pluginId: string, update: (entry: PluginServiceViewEntry) => PluginServiceViewEntry) {
    this.#setSnapshot({
      ...this.#snapshot,
      services: this.#snapshot.services.map((entry) => (entry.pluginId === pluginId ? update(entry) : entry)),
    })
  }

  #setSnapshot(snapshot: PluginServicesSnapshot) {
    this.#snapshot = snapshot
    for (const listener of this.#listeners) listener()
  }

  #writeProjection() {
    writePluginServiceProjection(this.#storage, {
      services: this.#snapshot.services.map(({ error: _error, loading: _loading, ...service }) => service),
    })
  }
}
