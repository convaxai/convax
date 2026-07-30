import {
  assertPluginCapabilityRuntimeTools,
  type PluginCapabilityRuntimeToolDefinition,
  type PluginCapabilityRuntimeUnavailableReason,
} from "@convax/plugin-sdk"

import type { PluginCapabilityPluginIdentity, PluginCapabilityReadinessPort } from "./plugin-capability-broker"

export type PluginCapabilityRuntimeInspection =
  | {
      readonly state: Exclude<PluginCapabilityRuntimeUnavailableReason, "contract-mismatch">
    }
  | {
      readonly provider: PluginCapabilityPluginIdentity
      readonly generation: string
      readonly released: boolean
      release(): void
      readonly state: "ready"
      /** Complete tools/list projection from this exact connected snapshot. */
      readonly tools: readonly PluginCapabilityRuntimeToolDefinition[]
    }

/**
 * Production wiring port still required from the executable Plugin runtime.
 * Implementations must inspect only the lease-bound provider snapshot and must
 * not resolve by Plugin id, PATH, mutable install directory, or current latest.
 */
export interface PluginCapabilityRuntimeInspectionPort {
  inspect(provider: PluginCapabilityPluginIdentity, signal?: AbortSignal): Promise<PluginCapabilityRuntimeInspection>
}

function sameProvider(left: PluginCapabilityPluginIdentity, right: PluginCapabilityPluginIdentity) {
  return (
    left.activeRevision === right.activeRevision &&
    left.activeSetDigest === right.activeSetDigest &&
    left.pluginId === right.pluginId &&
    left.pluginVersion === right.pluginVersion &&
    left.snapshotDigest === right.snapshotDigest
  )
}

/**
 * Desktop adapter that turns exact-snapshot runtime inspection into the
 * broker's structured readiness contract.
 *
 * The broker repeats the schema check before execution. This adapter performs
 * it first so `getAvailability` and UI projections fail closed consistently.
 */
export class PluginCapabilityRuntimeReadinessAdapter implements PluginCapabilityReadinessPort {
  readonly #runtime: PluginCapabilityRuntimeInspectionPort

  constructor(runtime: PluginCapabilityRuntimeInspectionPort) {
    this.#runtime = runtime
  }

  async evaluate(
    input: Parameters<PluginCapabilityReadinessPort["evaluate"]>[0],
  ): ReturnType<PluginCapabilityReadinessPort["evaluate"]> {
    let inspection: PluginCapabilityRuntimeInspection
    try {
      inspection = await this.#runtime.inspect(input.provider, input.signal)
    } catch (error) {
      if (input.signal?.aborted) throw error
      return { available: false, reason: "recovering", recoverable: true }
    }
    if (inspection.state !== "ready") {
      return {
        available: false,
        reason: inspection.state,
        recoverable: true,
      }
    }
    if (!sameProvider(inspection.provider, input.provider)) {
      inspection.release()
      return {
        available: false,
        reason: "contract-mismatch",
        recoverable: false,
      }
    }
    try {
      assertPluginCapabilityRuntimeTools([input.capability], inspection.tools)
    } catch {
      inspection.release()
      return {
        available: false,
        reason: "contract-mismatch",
        recoverable: false,
      }
    }
    return {
      available: true,
      runtime: {
        generation: inspection.generation,
        provider: inspection.provider,
        get released() {
          return inspection.released
        },
        release() {
          inspection.release()
        },
      },
      tools: inspection.tools,
    }
  }
}
