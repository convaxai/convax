import type { GenerationOutputModality, GenerationToolSummary } from "../generation-contracts"
import type { PluginServiceStatus, PluginServiceSummary } from "../plugin-service-contracts"
import type { GenerationToolExecutionPort, PreparedGenerationToolExecution } from "./generation-canvas-service"

export interface GenerationPluginServiceAvailabilityPort {
  getStatus(pluginId: string, signal?: AbortSignal): Promise<PluginServiceStatus>
  listServices(): Promise<readonly PluginServiceSummary[]>
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
    private readonly tools: GenerationToolExecutionPort,
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
    const availablePluginIds = new Set<string>()
    for (let index = 0; index < relevantServices.length; index += maximumConcurrentStatusChecks) {
      const batch = relevantServices.slice(index, index + maximumConcurrentStatusChecks)
      const availability = await Promise.all(
        batch.map(async (service) => [service.pluginId, await this.#isServiceAvailable(service)] as const),
      )
      for (const [pluginId, available] of availability) {
        if (available) availablePluginIds.add(pluginId)
      }
    }
    return tools.filter((tool) => {
      if (tool.kind !== "model") return true
      const service = serviceByPluginId.get(tool.pluginId)
      return Boolean(service && serviceProvidesModel(service, tool) && availablePluginIds.has(tool.pluginId))
    })
  }

  async describeTool(toolId: string, signal?: AbortSignal) {
    const tool = (await this.tools.listTools()).find((candidate) => candidate.id === toolId)
    if (!tool) throw new Error(`Generation tool is not installed: ${toolId}`)
    await this.#assertModelAvailable(tool, signal)
    return this.tools.describeTool(toolId, signal)
  }

  async prepareTool(tool: GenerationToolSummary, signal?: AbortSignal): Promise<PreparedGenerationToolExecution> {
    await this.#assertModelAvailable(tool, signal)
    return this.tools.prepareTool(tool, signal)
  }

  async #assertModelAvailable(tool: GenerationToolSummary, signal?: AbortSignal) {
    if (tool.kind !== "model") return
    const service = (await this.services.listServices()).find(
      (candidate) => candidate.pluginId === tool.pluginId && serviceProvidesModel(candidate, tool),
    )
    if (!service || !(await this.#isServiceAvailable(service, signal))) throw unavailableModelError()
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
