import type { GenerationOutputModality, GenerationToolSummary } from "../generation-contracts"
import type { PluginServiceStatus, PluginServiceSummary } from "../plugin-service-contracts"
import type { GenerationToolExecutionPort, PreparedGenerationToolExecution } from "./generation-canvas-service"

export interface GenerationPluginServiceAvailabilityPort {
  getStatus(pluginId: string, signal?: AbortSignal): Promise<PluginServiceStatus>
  listServices(): Promise<readonly PluginServiceSummary[]>
}

export interface GenerationModelCatalogExpansionPort extends GenerationToolExecutionPort {
  expandModelTool?(tool: GenerationToolSummary, signal?: AbortSignal): Promise<readonly GenerationToolSummary[]>
}

function isAvailable(status: PluginServiceStatus) {
  return status.state === "connected"
}

const defaultAvailabilityTimeoutMs = 15_000
const maximumConcurrentStatusChecks = 4

function serviceProvidesModel(service: PluginServiceSummary, tool: GenerationToolSummary) {
  return service.models.some((model) => model.capability === tool.output && model.id === tool.toolId)
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
 * Keeps manifest discovery separate from live service availability. Operations
 * remain manifest-driven; a model is exposed only when the owning Plugin declares
 * it through its service surface and that service currently reports connected.
 */
export class ServiceAwareGenerationTools implements GenerationToolExecutionPort {
  readonly #availabilityTimeoutMs: number
  readonly prepareRecoveryTool: GenerationToolExecutionPort["prepareRecoveryTool"]
  readonly releaseRecoveryTool: GenerationToolExecutionPort["releaseRecoveryTool"]

  constructor(
    private readonly tools: GenerationModelCatalogExpansionPort,
    private readonly services: GenerationPluginServiceAvailabilityPort,
    options: { availabilityTimeoutMs?: number } = {},
  ) {
    this.#availabilityTimeoutMs = options.availabilityTimeoutMs ?? defaultAvailabilityTimeoutMs
    this.prepareRecoveryTool = tools.prepareRecoveryTool?.bind(tools)
    this.releaseRecoveryTool = tools.releaseRecoveryTool?.bind(tools)
  }

  async isPluginAvailable(pluginId: string, signal?: AbortSignal) {
    const service = (await this.services.listServices()).find((candidate) => candidate.pluginId === pluginId)
    if (!service) return false
    return this.#isServiceAvailable(service, signal)
  }

  async listTools(options: { output?: GenerationOutputModality } = {}): Promise<readonly GenerationToolSummary[]> {
    const tools = await this.tools.listTools(options)
    const models = tools.filter((tool) => tool.kind === "model")
    if (models.length === 0) return tools

    const services = await this.services.listServices()
    const serviceByPluginId = new Map(services.map((service) => [service.pluginId, service]))
    const relevantServices = [
      ...new Set(
        models
          .map((tool) => {
            const service = serviceByPluginId.get(tool.pluginId)
            return service && serviceProvidesModel(service, tool) ? service : undefined
          })
          .filter((service): service is PluginServiceSummary => service !== undefined),
      ),
    ]
    const availablePluginIds = await this.#availablePluginIds(relevantServices)
    const expandableModels = models.filter((tool) => {
      const service = serviceByPluginId.get(tool.pluginId)
      return Boolean(service && serviceProvidesModel(service, tool) && availablePluginIds.has(tool.pluginId))
    })
    const expandedByBaseId = new Map<string, readonly GenerationToolSummary[]>()
    for (let index = 0; index < expandableModels.length; index += maximumConcurrentStatusChecks) {
      const batch = expandableModels.slice(index, index + maximumConcurrentStatusChecks)
      const expanded = await Promise.all(
        batch.map(async (tool) => [tool.id, await this.#expandModelTool(tool)] as const),
      )
      for (const [toolId, variants] of expanded) expandedByBaseId.set(toolId, variants)
    }
    const expandedPluginIds = new Set(
      expandableModels.filter((tool) => (expandedByBaseId.get(tool.id)?.length ?? 0) > 0).map((tool) => tool.pluginId),
    )
    const stillAvailablePluginIds = await this.#availablePluginIds(
      relevantServices.filter((service) => expandedPluginIds.has(service.pluginId)),
    )
    return tools.flatMap((tool) => {
      if (tool.kind !== "model") return [tool]
      if (!stillAvailablePluginIds.has(tool.pluginId)) return []
      return expandedByBaseId.get(tool.id) ?? []
    })
  }

  async describeTool(toolId: string, signal?: AbortSignal) {
    if (signal?.aborted) throw abortReason(signal)
    const declared = (await this.tools.listTools()).find((candidate) => candidate.id === toolId)
    if (declared) {
      await this.#assertModelAvailable(declared, signal)
      return this.tools.describeTool(toolId, signal)
    }
    const tool = (await this.listTools()).find((candidate) => candidate.id === toolId)
    if (!tool) throw new Error(`Generation tool is not installed: ${toolId}`)
    if (signal?.aborted) throw abortReason(signal)
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
    const service = (await this.services.listServices()).find(
      (candidate) => candidate.pluginId === tool.pluginId && serviceProvidesModel(candidate, tool),
    )
    if (!service || !(await this.#isServiceAvailable(service, signal))) throw unavailableModelError()
  }

  async #expandModelTool(tool: GenerationToolSummary): Promise<readonly GenerationToolSummary[]> {
    if (!this.tools.expandModelTool) return [tool]
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(new DOMException("Plugin model catalog timed out", "AbortError")),
      this.#availabilityTimeoutMs,
    )
    timeout.unref?.()
    let rejectCanceled!: (reason: Error) => void
    const canceled = new Promise<never>((_resolve, reject) => {
      rejectCanceled = reject
    })
    const onAbort = () => rejectCanceled(abortReason(controller.signal))
    controller.signal.addEventListener("abort", onAbort, { once: true })
    try {
      const variants = await Promise.race([this.tools.expandModelTool(tool, controller.signal), canceled])
      if (
        variants.length === 0 ||
        variants.some(
          (variant) =>
            variant.kind !== "model" ||
            variant.pluginId !== tool.pluginId ||
            variant.toolId !== tool.toolId ||
            variant.output !== tool.output,
        ) ||
        new Set(variants.map(({ id }) => id)).size !== variants.length
      ) {
        throw new Error("Generation model catalog expansion is invalid")
      }
      return variants
    } catch {
      return []
    } finally {
      clearTimeout(timeout)
      controller.signal.removeEventListener("abort", onAbort)
    }
  }

  async #availablePluginIds(services: readonly PluginServiceSummary[]) {
    const availablePluginIds = new Set<string>()
    for (let index = 0; index < services.length; index += maximumConcurrentStatusChecks) {
      const batch = services.slice(index, index + maximumConcurrentStatusChecks)
      const availability = await Promise.all(
        batch.map(async (service) => [service.pluginId, await this.#isServiceAvailable(service)] as const),
      )
      for (const [pluginId, available] of availability) {
        if (available) availablePluginIds.add(pluginId)
      }
    }
    return availablePluginIds
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
    timeout.unref?.()
    let rejectCanceled!: (reason: Error) => void
    const canceled = new Promise<never>((_resolve, reject) => {
      rejectCanceled = reject
    })
    const onAvailabilityAbort = () => rejectCanceled(abortReason(controller.signal))
    controller.signal.addEventListener("abort", onAvailabilityAbort, { once: true })
    try {
      const status = await Promise.race([this.services.getStatus(service.pluginId, controller.signal), canceled])
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
