import type { PluginCapabilityAvailability } from "@convax/plugin-sdk"
import type { PluginHostCapabilityAvailability } from "@convax/plugin-sdk/client"
import type { PluginPrincipal } from "../plugin-capability-contracts"
import type { InstalledPluginPrincipalResolver } from "./plugin-principal-resolver"
import {
  PluginCapabilityBroker,
  PluginCapabilityBrokerError,
  type PluginCapabilityExecutorPort,
  type PluginCapabilityBrokerLimits,
  type PluginCapabilityLease,
  type PluginCapabilityPluginIdentity,
} from "./plugin-capability-broker"
import type { PluginInstallationRuntime } from "./plugin-installation-runtime"
import { PluginCapabilityRuntimeReadinessAdapter } from "./plugin-capability-runtime-readiness"
import type { PluginCapabilityRuntimeInspectionPort } from "./plugin-capability-runtime-readiness"

export interface PluginCapabilityBrokerInvokeRequest {
  readonly capabilityId: string
  readonly input: unknown
  readonly requestId: string
}

export interface PluginCapabilityBrokerMainServiceOptions {
  readonly installations: Pick<PluginInstallationRuntime, "acquireActiveSetCallLease" | "loadPublishedCapabilityPlan">
  readonly limits?: PluginCapabilityBrokerLimits
  readonly principals: Pick<InstalledPluginPrincipalResolver, "resolve">
  readonly sidecars: PluginCapabilityExecutorPort & PluginCapabilityRuntimeInspectionPort
}

function callerIdentity(principal: PluginPrincipal): PluginCapabilityPluginIdentity {
  return Object.freeze({
    activeRevision: principal.activeRevision,
    activeSetDigest: principal.activeSetDigest,
    pluginId: principal.pluginId,
    pluginVersion: principal.pluginVersion,
    snapshotDigest: principal.snapshotDigest,
  })
}

export function projectPluginCapabilityAvailability(
  availability: PluginCapabilityAvailability<PluginCapabilityPluginIdentity>,
): PluginHostCapabilityAvailability {
  if (!availability.requirement) {
    throw new Error("Plugin capability availability does not refer to a declared import")
  }
  if (availability.available) {
    return Object.freeze({
      available: true,
      capabilityId: availability.capabilityId,
      requirement: availability.requirement,
      version: availability.version,
    })
  }
  return Object.freeze({
    available: false,
    capabilityId: availability.capabilityId,
    reason: availability.reason,
    recoverable: availability.recoverable,
    requirement: availability.requirement,
  })
}

function waitForSignal<Value>(promise: Promise<Value>, signal?: AbortSignal): Promise<Value> {
  if (!signal) return promise
  if (signal.aborted) {
    return Promise.reject(new PluginCapabilityBrokerError("aborted", "Plugin capability operation was aborted"))
  }
  return new Promise<Value>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener("abort", onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new PluginCapabilityBrokerError("aborted", "Plugin capability operation was aborted"))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    void promise.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
}

/**
 * Main composition boundary for v8 Plugin-to-Plugin calls.
 *
 * This service is deliberately separate from the Plugin Host API Catalog
 * dispatcher. The caller arrives as an exact capability/3 principal, provider
 * selection comes only from the immutable ActiveSet plan, and execution stays
 * inside the verified sidecar runtime.
 */
export class PluginCapabilityBrokerMainService {
  readonly #brokers = new Map<
    string,
    {
      promise: Promise<PluginCapabilityBroker>
      ready: boolean
    }
  >()
  readonly #installations: PluginCapabilityBrokerMainServiceOptions["installations"]
  readonly #limits?: PluginCapabilityBrokerLimits
  readonly #principals: PluginCapabilityBrokerMainServiceOptions["principals"]
  readonly #readiness: PluginCapabilityRuntimeReadinessAdapter
  readonly #sidecars: PluginCapabilityBrokerMainServiceOptions["sidecars"]

  constructor(options: PluginCapabilityBrokerMainServiceOptions) {
    this.#installations = options.installations
    this.#limits = options.limits
    this.#principals = options.principals
    this.#readiness = new PluginCapabilityRuntimeReadinessAdapter(options.sidecars)
    this.#sidecars = options.sidecars
  }

  async getAvailability(
    principal: PluginPrincipal,
    capabilityId: string,
    signal?: AbortSignal,
  ): Promise<PluginHostCapabilityAvailability> {
    await this.#assertPrincipal(principal, signal)
    return projectPluginCapabilityAvailability(
      await (await this.#broker(principal, signal)).getAvailability(callerIdentity(principal), capabilityId, signal),
    )
  }

  async invoke(principal: PluginPrincipal, request: PluginCapabilityBrokerInvokeRequest, signal?: AbortSignal) {
    await this.#assertPrincipal(principal, signal)
    return (await this.#broker(principal, signal)).invoke({
      caller: callerIdentity(principal),
      capabilityId: request.capabilityId,
      input: request.input,
      requestId: request.requestId,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async #assertPrincipal(principal: PluginPrincipal, signal?: AbortSignal) {
    const resolved = await waitForSignal(this.#principals.resolve(principal), signal)
    if (
      !resolved ||
      resolved.activeRevision !== principal.activeRevision ||
      resolved.activeSetDigest !== principal.activeSetDigest ||
      resolved.pluginId !== principal.pluginId ||
      resolved.pluginVersion !== principal.pluginVersion ||
      resolved.snapshotDigest !== principal.snapshotDigest
    ) {
      throw new Error("Plugin capability broker caller principal is stale")
    }
  }

  async #broker(principal: PluginPrincipal, signal?: AbortSignal) {
    const key = `${principal.activeRevision}:${principal.activeSetDigest}`
    const cached = this.#brokers.get(key)
    if (cached) return waitForSignal(cached.promise, signal)

    const promise = (async () => {
      const plan = await this.#installations.loadPublishedCapabilityPlan()
      if (plan.activeRevision !== principal.activeRevision || plan.activeSetDigest !== principal.activeSetDigest) {
        throw new Error("Plugin capability broker caller ActiveSet is stale")
      }
      return PluginCapabilityBroker.fromPublishedActiveSet({
        executor: this.#sidecars,
        leases: {
          acquireBoundPair: async (input): Promise<PluginCapabilityLease> => {
            const lease = await this.#installations.acquireActiveSetCallLease(
              {
                activeRevision: input.activeRevision,
                activeSetDigest: input.activeSetDigest,
              },
              input.caller.snapshotDigest,
              input.provider.snapshotDigest,
            )
            return {
              activeRevision: lease.activeRevision,
              activeSetDigest: lease.activeSetDigest,
              coversActiveSet: true,
              caller: input.caller,
              provider: input.provider,
              get released() {
                return lease.released
              },
              release() {
                lease.release()
              },
            }
          },
        },
        ...(this.#limits === undefined ? {} : { limits: this.#limits }),
        plans: { loadPublished: async () => plan },
        readiness: this.#readiness,
      })
    })()
    const entry = { promise, ready: false }
    this.#brokers.set(key, entry)
    void entry.promise.then(
      () => {
        if (this.#brokers.get(key) !== entry) return
        entry.ready = true
        this.#trimBrokerCache()
      },
      () => {
        if (this.#brokers.get(key) === entry) this.#brokers.delete(key)
      },
    )
    return waitForSignal(entry.promise, signal)
  }

  #trimBrokerCache() {
    while (this.#brokers.size > 8) {
      const oldestReady = [...this.#brokers].find(([, entry]) => entry.ready)
      if (!oldestReady) return
      this.#brokers.delete(oldestReady[0])
    }
  }
}
