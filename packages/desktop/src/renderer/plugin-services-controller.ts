import type { PluginServiceClient, PluginServiceStatus, PluginServiceSummary } from "../plugin-service-contracts"
import type { WebPluginServiceAction } from "../plugin-contracts"

export interface PluginServiceViewEntry extends PluginServiceSummary {
  error?: string
  loading: boolean
  status?: PluginServiceStatus
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
  #actionEpoch = 0
  #disposed = false
  #generation = 0
  #snapshot: PluginServicesSnapshot = { loading: true, services: [] }
  #unsubscribe?: () => void

  constructor(private readonly client: PluginServiceClient) {}

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
      this.#setSnapshot({ error: errorMessage(error), loading: false, services: [] })
      return
    }
    if (this.#disposed || generation !== this.#generation) return
    const entries = services.map((service) => ({ ...service, actions: [...service.actions], loading: true }))
    this.#setSnapshot({ loading: false, services: entries })
    await Promise.all(entries.map((entry) => this.#loadStatus(entry, generation)))
  }

  async perform(pluginId: string, action: WebPluginServiceAction) {
    if (this.#disposed) return
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
        this.#replace(pluginId, (current) => ({ ...current, error: undefined, loading: false, status }))
      }
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
    try {
      const status = await this.client.getStatus({ pluginId: entry.pluginId })
      if (!this.#isCurrent(entry, fingerprint, generation)) return
      this.#replace(entry.pluginId, (current) => ({ ...current, error: undefined, loading: false, status }))
    } catch (error) {
      if (!this.#isCurrent(entry, fingerprint, generation)) return
      this.#replace(entry.pluginId, (current) => ({ ...current, error: errorMessage(error), loading: false }))
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
}
