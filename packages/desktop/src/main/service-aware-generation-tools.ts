import type {
  GenerationOutputModality,
  GenerationToolDescription,
  GenerationToolSummary,
} from "../generation-contracts"
import type { PluginServiceStatus, PluginServiceSummary, PluginServiceTarget } from "../plugin-service-contracts"
import type {
  GenerationToolExecutionPort,
  InspectedGenerationModel,
  PreparedGenerationToolExecution,
} from "./generation-canvas-service"

export interface GenerationPluginServiceAvailabilityPort {
  getStatus(target: PluginServiceTarget, signal?: AbortSignal): Promise<PluginServiceStatus>
  listServices(): Promise<readonly PluginServiceSummary[]>
}

export interface GenerationModelCatalogExpansionPort extends GenerationToolExecutionPort {
  expandModelTool?(tool: GenerationToolSummary, signal?: AbortSignal): Promise<readonly GenerationToolSummary[]>
  inspectModelCatalog?(
    tools: readonly GenerationToolSummary[],
    signal?: AbortSignal,
  ): Promise<readonly InspectedGenerationModel[]>
  /** Null means this tool belongs to a v9 top-level runtime, not a Service profile. */
  serviceStatusTarget?(tool: GenerationToolSummary): Promise<PluginServiceTarget | null>
}

function isAvailable(status: PluginServiceStatus) {
  return status.state === "connected"
}

const defaultAvailabilityTimeoutMs = 15_000
const defaultCatalogRefreshAgeMs = 5 * 60_000
const maximumCatalogRefreshAgeMs = 24 * 60 * 60_000
const maximumConcurrentCatalogInspections = 4

interface GenerationToolCatalogSnapshot {
  descriptions: ReadonlyMap<string, GenerationToolDescription>
  epoch: number
  refreshedAt: number
  tools: readonly GenerationToolSummary[]
}

interface GenerationToolCatalogRefresh {
  epoch: number
  promise: Promise<void>
}

function serviceProvidesModel(service: PluginServiceSummary, tool: GenerationToolSummary) {
  return (
    service.pluginId === tool.pluginId &&
    service.serviceId === tool.serviceId &&
    service.models.some((model) => model.capability === tool.output && model.id === tool.toolId)
  )
}

function serviceKey(value: Pick<PluginServiceTarget, "pluginId" | "serviceId">) {
  return JSON.stringify([value.pluginId, value.serviceId])
}

function belongsToModelFamily(candidate: GenerationToolSummary, base: GenerationToolSummary) {
  return (
    candidate.kind === "model" &&
    baseGenerationToolId(candidate.id) === base.id &&
    candidate.pluginId === base.pluginId &&
    candidate.serviceId === base.serviceId &&
    candidate.toolId === base.toolId &&
    candidate.output === base.output &&
    candidate.pluginName === base.pluginName &&
    candidate.title === base.title &&
    candidate.description === base.description &&
    candidate.agentId === base.agentId &&
    candidate.delivery === base.delivery &&
    candidate.inputBinding === base.inputBinding &&
    candidate.recovery === base.recovery &&
    JSON.stringify(candidate.acceptedInputs) === JSON.stringify(base.acceptedInputs)
  )
}

function baseGenerationToolId(selectionId: string) {
  const marker = ".model-selection-"
  const markerIndex = selectionId.lastIndexOf(marker)
  if (markerIndex < 0) return selectionId
  const digest = selectionId.slice(markerIndex + marker.length)
  return /^[a-f0-9]{64}$/u.test(digest) ? selectionId.slice(0, markerIndex) : selectionId
}

function unavailableModelError() {
  return new Error("Generation model service is unavailable. Open Services to install or configure it.")
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Plugin service availability check was canceled", "AbortError")
}

/**
 * Owns the bounded, display-only generation catalog for one Main session. Model
 * preparation and dispatch remain live, fail-closed checks outside this snapshot.
 */
export class ServiceAwareGenerationTools implements GenerationToolExecutionPort {
  readonly #availabilityTimeoutMs: number
  readonly #now: () => number
  readonly #refreshAfterMs: number
  readonly prepareRecoveryTool: GenerationToolExecutionPort["prepareRecoveryTool"]
  readonly releaseRecoveryTool: GenerationToolExecutionPort["releaseRecoveryTool"]
  #epoch = 0
  #refreshing?: GenerationToolCatalogRefresh
  #snapshot?: GenerationToolCatalogSnapshot

  constructor(
    private readonly tools: GenerationModelCatalogExpansionPort,
    private readonly services: GenerationPluginServiceAvailabilityPort,
    options: { availabilityTimeoutMs?: number; now?: () => number; refreshAfterMs?: number } = {},
  ) {
    this.#availabilityTimeoutMs = options.availabilityTimeoutMs ?? defaultAvailabilityTimeoutMs
    this.#now = options.now ?? Date.now
    this.#refreshAfterMs = options.refreshAfterMs ?? defaultCatalogRefreshAgeMs
    if (
      !Number.isFinite(this.#refreshAfterMs) ||
      this.#refreshAfterMs < 1 ||
      this.#refreshAfterMs > maximumCatalogRefreshAgeMs
    ) {
      throw new Error("Generation model catalog refresh age is invalid")
    }
    this.prepareRecoveryTool = tools.prepareRecoveryTool?.bind(tools)
    this.releaseRecoveryTool = tools.releaseRecoveryTool?.bind(tools)
  }

  async isPluginAvailable(pluginId: string, signal?: AbortSignal) {
    return this.isServiceAvailable({ pluginId, serviceId: pluginId }, signal)
  }

  async isServiceAvailable(target: PluginServiceTarget, signal?: AbortSignal) {
    const service = (await this.services.listServices()).find(
      (candidate) => candidate.pluginId === target.pluginId && candidate.serviceId === target.serviceId,
    )
    if (!service) return false
    return this.#isServiceAvailable(service, signal)
  }

  /** Invalidates display-only catalog state without affecting accepted operations. */
  invalidate() {
    this.#epoch += 1
    this.#snapshot = undefined
  }

  /**
   * Refreshes one complete display snapshot. Concurrent callers share one refresh,
   * while readers continue using the previous same-epoch snapshot until commit.
   */
  refresh(): Promise<void> {
    const epoch = this.#epoch
    if (this.#refreshing?.epoch === epoch) return this.#refreshing.promise
    const promise = this.#loadSnapshot(epoch).then((snapshot) => {
      if (this.#epoch === epoch) this.#snapshot = snapshot
    })
    const refresh = { epoch, promise }
    this.#refreshing = refresh
    const clear = () => {
      if (this.#refreshing === refresh) this.#refreshing = undefined
    }
    void promise.then(clear, clear)
    return promise
  }

  async listTools(
    options: { output?: GenerationOutputModality; refresh?: boolean } = {},
  ): Promise<readonly GenerationToolSummary[]> {
    if (options.refresh) await this.refresh()
    const snapshot = await this.#readSnapshot()
    this.#refreshIfStale(snapshot)
    return options.output === undefined
      ? snapshot.tools
      : snapshot.tools.filter((tool) => tool.output === options.output)
  }

  async describeTool(toolId: string, signal?: AbortSignal) {
    if (signal?.aborted) throw abortReason(signal)
    const snapshot = await this.#readSnapshot()
    this.#refreshIfStale(snapshot)
    if (signal?.aborted) throw abortReason(signal)
    const tool = snapshot.tools.find((candidate) => candidate.id === toolId)
    if (!tool) throw new Error(`Generation tool is not installed: ${toolId}`)
    const cached = snapshot.descriptions.get(toolId)
    if (cached) return cached
    if (tool.kind === "model") throw new Error(`Generation model configuration is unavailable: ${toolId}`)
    return this.tools.describeTool(toolId, signal)
  }

  async prepareTool(tool: GenerationToolSummary, signal?: AbortSignal): Promise<PreparedGenerationToolExecution> {
    await this.#assertModelAvailable(tool, signal)
    const prepared = await this.tools.prepareTool(tool, signal)
    if (tool.kind !== "model") return prepared
    const guarded: PreparedGenerationToolExecution = {
      call: async (input, callSignal, lifecycleObserver, operation, dispatchHooks) => {
        await this.#assertModelAvailable(tool, callSignal)
        return prepared.call(input, callSignal, lifecycleObserver, operation, {
          ...(dispatchHooks?.validate === undefined ? {} : { validate: dispatchHooks.validate }),
          guard: async () => {
            await dispatchHooks?.guard?.()
            await this.#assertModelAvailable(tool, callSignal)
          },
        })
      },
      ...(prepared.recovery === undefined ? {} : { recovery: prepared.recovery }),
      validateInput: (input) => prepared.validateInput(input),
    }
    return guarded
  }

  async #assertModelAvailable(tool: GenerationToolSummary, signal?: AbortSignal) {
    if (tool.kind !== "model") return
    const target = await this.#serviceStatusTarget(tool)
    if (!target) return
    const service = (await this.services.listServices()).find(
      (candidate) =>
        candidate.pluginId === target.pluginId &&
        candidate.serviceId === target.serviceId &&
        serviceProvidesModel(candidate, tool),
    )
    if (!service || !(await this.#isServiceAvailable(service, signal))) throw unavailableModelError()
  }

  async #readSnapshot(): Promise<GenerationToolCatalogSnapshot> {
    while (!this.#snapshot || this.#snapshot.epoch !== this.#epoch) {
      await this.refresh()
    }
    return this.#snapshot
  }

  async #loadSnapshot(epoch: number): Promise<GenerationToolCatalogSnapshot> {
    const previous = this.#snapshot?.epoch === epoch ? this.#snapshot : undefined
    const declaredTools = await this.tools.listTools()
    const models = declaredTools.filter((tool) => tool.kind === "model")
    if (models.length === 0) {
      return {
        descriptions: new Map(),
        epoch,
        refreshedAt: this.#now(),
        tools: declaredTools,
      }
    }
    const services = await this.services.listServices()
    const serviceById = new Map(services.map((service) => [serviceKey(service), service]))
    const modelsByService = new Map<string, GenerationToolSummary[]>()
    for (const model of models) {
      const target = await this.#serviceStatusTarget(model)
      const key = target ? `service:${serviceKey(target)}` : `runtime:${model.pluginId}`
      if (target) {
        const service = serviceById.get(serviceKey(target))
        if (!service || !serviceProvidesModel(service, model)) continue
      }
      const grouped = modelsByService.get(key) ?? []
      grouped.push(model)
      modelsByService.set(key, grouped)
    }
    const inspectedByBaseId = new Map<string, readonly InspectedGenerationModel[]>()
    const groups = [...modelsByService.values()]
    for (let index = 0; index < groups.length; index += maximumConcurrentCatalogInspections) {
      const batch = groups.slice(index, index + maximumConcurrentCatalogInspections)
      const inspected = await Promise.all(batch.map((tools) => this.#inspectModelCatalog(tools)))
      for (let groupIndex = 0; groupIndex < batch.length; groupIndex += 1) {
        const expected = batch[groupIndex]
        const entries =
          inspected[groupIndex] ??
          expected.flatMap((base) =>
            (previous?.tools ?? []).flatMap((summary) => {
              const description = previous?.descriptions.get(summary.id)
              return description && belongsToModelFamily(summary, base) ? [{ description, summary }] : []
            }),
          )
        for (const tool of expected) {
          inspectedByBaseId.set(
            tool.id,
            entries.filter(
              ({ summary }) =>
                summary.pluginId === tool.pluginId &&
                summary.serviceId === tool.serviceId &&
                summary.toolId === tool.toolId,
            ),
          )
        }
      }
    }
    const descriptions = new Map<string, GenerationToolDescription>()
    const tools = declaredTools.flatMap((tool) => {
      if (tool.kind !== "model") return [tool]
      const entries = inspectedByBaseId.get(tool.id) ?? []
      for (const { description, summary } of entries) descriptions.set(summary.id, description)
      return entries.map(({ summary }) => summary)
    })
    return { descriptions, epoch, refreshedAt: this.#now(), tools }
  }

  #refreshIfStale(snapshot: GenerationToolCatalogSnapshot) {
    if (this.#now() - snapshot.refreshedAt < this.#refreshAfterMs) return
    void this.refresh().catch(() => undefined)
  }

  #serviceStatusTarget(tool: GenerationToolSummary): Promise<PluginServiceTarget | null> {
    return this.tools.serviceStatusTarget
      ? this.tools.serviceStatusTarget(tool)
      : Promise.resolve({ pluginId: tool.pluginId, serviceId: tool.serviceId })
  }

  async #inspectModelCatalog(
    tools: readonly GenerationToolSummary[],
  ): Promise<readonly InspectedGenerationModel[] | undefined> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(new DOMException("Plugin model catalog timed out", "AbortError")),
      this.#availabilityTimeoutMs,
    )
    let rejectCanceled!: (reason: Error) => void
    const canceled = new Promise<never>((_resolve, reject) => {
      rejectCanceled = reject
    })
    const onAbort = () => rejectCanceled(abortReason(controller.signal))
    controller.signal.addEventListener("abort", onAbort, { once: true })
    try {
      const inspected = await Promise.race([
        this.tools.inspectModelCatalog
          ? this.tools.inspectModelCatalog(tools, controller.signal)
          : Promise.all(
              tools.map(async (tool) => {
                const summaries = this.tools.expandModelTool
                  ? await this.tools.expandModelTool(tool, controller.signal)
                  : [tool]
                return Promise.all(
                  summaries.map(async (summary) => ({
                    description: await this.tools.describeTool(summary.id, controller.signal),
                    summary,
                  })),
                )
              }),
            ).then((groups) => groups.flat()),
        canceled,
      ])
      if (
        inspected.length === 0 ||
        inspected.some(
          ({ description, summary }) =>
            summary.kind !== "model" ||
            description.toolId !== summary.id ||
            !tools.some((tool) => belongsToModelFamily(summary, tool)),
        ) ||
        tools.some((tool) => !inspected.some(({ summary }) => belongsToModelFamily(summary, tool))) ||
        new Set(inspected.map(({ summary }) => summary.id)).size !== inspected.length
      ) {
        throw new Error("Generation model catalog expansion is invalid")
      }
      return inspected
    } catch {
      return undefined
    } finally {
      clearTimeout(timeout)
      controller.signal.removeEventListener("abort", onAbort)
    }
  }

  async #isServiceAvailable(service: PluginServiceSummary, signal?: AbortSignal) {
    if (signal?.aborted) throw abortReason(signal)
    const controller = new AbortController()
    const onAbort = () => controller.abort(signal ? abortReason(signal) : undefined)
    signal?.addEventListener("abort", onAbort, { once: true })
    const timeout = setTimeout(
      () => controller.abort(new DOMException("Plugin service availability check timed out", "AbortError")),
      this.#availabilityTimeoutMs,
    )
    let rejectCanceled!: (reason: Error) => void
    const canceled = new Promise<never>((_resolve, reject) => {
      rejectCanceled = reject
    })
    const onAvailabilityAbort = () => rejectCanceled(abortReason(controller.signal))
    controller.signal.addEventListener("abort", onAvailabilityAbort, { once: true })
    try {
      const status = await Promise.race([
        this.services.getStatus({ pluginId: service.pluginId, serviceId: service.serviceId }, controller.signal),
        canceled,
      ])
      return isAvailable(status)
    } catch {
      if (signal?.aborted) throw abortReason(signal)
      return false
    } finally {
      clearTimeout(timeout)
      controller.signal.removeEventListener("abort", onAvailabilityAbort)
      signal?.removeEventListener("abort", onAbort)
    }
  }
}
