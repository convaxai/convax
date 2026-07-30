import { createHash } from "node:crypto"

import {
  assertPluginCapabilityRuntimeTools,
  assertPluginCapabilityValue,
  type PluginCapabilityAvailability,
  type PluginCapabilityExport,
  type PluginCapabilityRuntimeToolDefinition,
  type PluginCapabilityRuntimeUnavailableReason,
} from "@convax/plugin-sdk"
import {
  verifyPluginCapabilityBindingPlan,
  type PluginCapabilityBindingPlan,
  type PluginCapabilityPluginIdentity,
} from "./plugin-capability-binding-plan"

const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/

export type { PluginCapabilityPluginIdentity } from "./plugin-capability-binding-plan"

function sameIdentity(left: PluginCapabilityPluginIdentity, right: PluginCapabilityPluginIdentity) {
  return (
    left.activeRevision === right.activeRevision &&
    left.activeSetDigest === right.activeSetDigest &&
    left.pluginId === right.pluginId &&
    left.pluginVersion === right.pluginVersion &&
    left.snapshotDigest === right.snapshotDigest
  )
}

export interface PluginCapabilityLease {
  readonly activeRevision: number
  readonly activeSetDigest: string
  readonly caller: PluginCapabilityPluginIdentity
  readonly provider: PluginCapabilityPluginIdentity
  /** The underlying lease retains the complete immutable ActiveSet closure. */
  readonly coversActiveSet?: true
  readonly released: boolean
  release(): void
}

export interface PluginCapabilityLeasePort {
  /**
   * Atomically verifies the current ActiveSet generation and pins both exact
   * snapshots. A switch before this operation must reject the new call; a
   * switch after it may not invalidate this already-started call.
   */
  acquireBoundPair(input: {
    readonly activeRevision: number
    readonly activeSetDigest: string
    readonly caller: PluginCapabilityPluginIdentity
    readonly provider: PluginCapabilityPluginIdentity
    readonly signal?: AbortSignal
  }): Promise<PluginCapabilityLease>
}

export interface PluginCapabilityReadinessPort {
  /**
   * Returns the complete tools/list projection from the exact verified
   * provider runtime. The broker itself matches the selected manifest export's
   * operation, inputSchema and outputSchema before reporting ready or calling.
   */
  evaluate(input: {
    readonly capability: PluginCapabilityExport
    readonly provider: PluginCapabilityPluginIdentity
    readonly signal?: AbortSignal
  }): Promise<
    | {
        readonly available: true
        /**
         * Opaque Host-owned lease for the exact sidecar process generation
         * whose tools/list result follows. The broker passes it unchanged to
         * the executor and releases it after the call. It is never exposed to
         * either Plugin.
         */
        readonly runtime: PluginCapabilityRuntimeLease
        readonly tools: readonly PluginCapabilityRuntimeToolDefinition[]
      }
    | {
        readonly available: false
        readonly reason: PluginCapabilityRuntimeUnavailableReason
        readonly recoverable: boolean
      }
  >
}

export interface PluginCapabilityRuntimeLease {
  readonly generation: string
  readonly provider: PluginCapabilityPluginIdentity
  readonly released: boolean
  release(): void
}

export interface PluginCapabilityNestedCall {
  readonly capabilityId: string
  readonly input: unknown
  readonly requestId: string
  /** Host-internal cancellation from a reverse sidecar request. */
  readonly signal?: AbortSignal
}

export interface PluginCapabilityInvocationAuthority {
  readonly consumerPluginId: string
  readonly operationId: string
  readonly providerPluginId: string
  readonly signal?: AbortSignal
  /**
   * Revalidates the exact accepted ActiveSet call lease and this one invocation.
   * The authority expires when execute() settles even if an outer nested-call
   * chain still retains the complete ActiveSet.
   */
  assertActive(): Promise<void>
}

export interface PluginCapabilityExecutorPort {
  execute(input: {
    /** Main-only authority for reverse Host API calls made by this provider invocation. */
    readonly authority: PluginCapabilityInvocationAuthority
    readonly capability: PluginCapabilityExport
    readonly input: unknown
    /**
     * Stable identity derived from the published binding plan and request chain.
     *
     * The broker rejects only a concurrent duplicate. A provider that must make
     * completed retries idempotent (especially billable or long-running work)
     * persists this operation id through its durable operation/LRO contract.
     */
    readonly operationId: string
    readonly provider: PluginCapabilityPluginIdentity
    /** Exact process generation that produced the validated tools/list. */
    readonly runtime: PluginCapabilityRuntimeLease
    readonly signal?: AbortSignal
    /**
     * A provider may call only its own declared imports through this closure.
     * The nested callee receives no authority from the outer caller.
     */
    readonly invoke: (call: PluginCapabilityNestedCall) => Promise<unknown>
  }): Promise<unknown>
}

export interface PluginCapabilityBrokerLimits {
  readonly maximumDepth?: number
  readonly maximumInFlight?: number
  readonly maximumInFlightPerCaller?: number
  readonly maximumInputBytes?: number
  readonly maximumOutputBytes?: number
}

export interface PublishedPluginCapabilityPlanPort {
  /**
   * Loads only the binding plan stored with the currently published ActiveSet.
   * Implementations must reconstruct and verify it from immutable snapshot data.
   */
  loadPublished(): Promise<PluginCapabilityBindingPlan>
}

export type PluginCapabilityBrokerErrorCode =
  | "aborted"
  | "caller-stale"
  | "duplicate-request"
  | "invalid-request"
  | "invalid-response"
  | "lease-mismatch"
  | "overloaded"
  | "provider-failed"
  | "reentrant-call"
  | "depth-exceeded"
  | "unavailable"

export class PluginCapabilityBrokerError extends Error {
  readonly code: PluginCapabilityBrokerErrorCode
  readonly availability?: Extract<PluginCapabilityAvailability<PluginCapabilityPluginIdentity>, { available: false }>

  constructor(
    code: PluginCapabilityBrokerErrorCode,
    message: string,
    options?: ErrorOptions & {
      availability?: Extract<PluginCapabilityAvailability<PluginCapabilityPluginIdentity>, { available: false }>
    },
  ) {
    super(message, options)
    this.name = "PluginCapabilityBrokerError"
    this.code = code
    this.availability = options?.availability
  }
}

interface CallFrame {
  callerPluginId: string
  capabilityId: string
  providerPluginId: string
}

function jsonBytes(value: unknown, label: string) {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    throw new PluginCapabilityBrokerError("invalid-request", `${label} is not JSON serializable`, { cause: error })
  }
  if (serialized === undefined) {
    throw new PluginCapabilityBrokerError("invalid-request", `${label} is not JSON serializable`)
  }
  return new TextEncoder().encode(serialized).byteLength
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new PluginCapabilityBrokerError("aborted", "Plugin capability call was aborted")
}

function waitForLease(pending: Promise<PluginCapabilityLease>, signal?: AbortSignal): Promise<PluginCapabilityLease> {
  if (!signal) return pending
  if (signal.aborted) {
    void pending.then(
      (lease) => lease.release(),
      () => undefined,
    )
    return Promise.reject(new PluginCapabilityBrokerError("aborted", "Plugin capability call was aborted"))
  }
  return new Promise<PluginCapabilityLease>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener("abort", onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      void pending.then(
        (lease) => lease.release(),
        () => undefined,
      )
      reject(new PluginCapabilityBrokerError("aborted", "Plugin capability call was aborted"))
    }
    signal.addEventListener("abort", onAbort, { once: true })
    void pending.then(
      (lease) => {
        if (settled) {
          lease.release()
          return
        }
        settled = true
        cleanup()
        resolve(lease)
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

function operationId(planDigest: string, callerSnapshotDigest: string, requestId: string, parentOperationId?: string) {
  return createHash("sha256")
    .update(`${planDigest}\0${parentOperationId ?? "root"}\0${callerSnapshotDigest}\0${requestId}`)
    .digest("hex")
}

export class PluginCapabilityBroker {
  readonly #executor: PluginCapabilityExecutorPort
  readonly #leases: PluginCapabilityLeasePort
  readonly #plan: PluginCapabilityBindingPlan
  readonly #readiness: PluginCapabilityReadinessPort
  readonly #maximumDepth: number
  readonly #maximumInFlight: number
  readonly #maximumInFlightPerCaller: number
  readonly #maximumInputBytes: number
  readonly #maximumOutputBytes: number
  /**
   * Process-local concurrency guard, not a replay ledger. Entries are removed
   * when their call settles; completed replay safety belongs to the provider's
   * durable operationId/LRO implementation.
   */
  readonly #inFlightRequests = new Set<string>()
  readonly #inFlightByCaller = new Map<string, number>()
  #inFlight = 0

  private constructor(input: {
    readonly executor: PluginCapabilityExecutorPort
    readonly leases: PluginCapabilityLeasePort
    readonly plan: PluginCapabilityBindingPlan
    readonly readiness: PluginCapabilityReadinessPort
    readonly limits?: PluginCapabilityBrokerLimits
  }) {
    this.#executor = input.executor
    this.#leases = input.leases
    this.#plan = input.plan
    this.#readiness = input.readiness
    this.#maximumDepth = input.limits?.maximumDepth ?? 8
    this.#maximumInFlight = input.limits?.maximumInFlight ?? 128
    this.#maximumInFlightPerCaller = input.limits?.maximumInFlightPerCaller ?? 16
    this.#maximumInputBytes = input.limits?.maximumInputBytes ?? 1024 * 1024
    this.#maximumOutputBytes = input.limits?.maximumOutputBytes ?? 4 * 1024 * 1024
  }

  static async fromPublishedActiveSet(input: {
    readonly executor: PluginCapabilityExecutorPort
    readonly leases: PluginCapabilityLeasePort
    readonly plans: PublishedPluginCapabilityPlanPort
    readonly readiness: PluginCapabilityReadinessPort
    readonly limits?: PluginCapabilityBrokerLimits
  }) {
    const plan = await input.plans.loadPublished()
    if (!Object.isFrozen(plan) || !verifyPluginCapabilityBindingPlan(plan)) {
      throw new PluginCapabilityBrokerError("caller-stale", "Published Plugin capability binding plan is invalid")
    }
    return new PluginCapabilityBroker({
      executor: input.executor,
      leases: input.leases,
      plan,
      readiness: input.readiness,
      ...(input.limits === undefined ? {} : { limits: input.limits }),
    })
  }

  async getAvailability(
    caller: PluginCapabilityPluginIdentity,
    capabilityId: string,
    signal?: AbortSignal,
  ): Promise<PluginCapabilityAvailability<PluginCapabilityPluginIdentity>> {
    throwIfAborted(signal)
    const binding = this.#binding(caller, capabilityId)
    if (!binding) {
      return {
        available: false,
        capabilityId,
        reason: "not-declared",
        recoverable: false,
      }
    }
    if (!binding.availability.available) return binding.availability
    this.#reserveInFlight(caller.snapshotDigest)
    let lease: PluginCapabilityLease | undefined
    let runtime: PluginCapabilityRuntimeLease | undefined
    try {
      lease = await waitForLease(
        this.#leases.acquireBoundPair({
          activeRevision: this.#plan.activeRevision,
          activeSetDigest: this.#plan.activeSetDigest,
          caller,
          provider: binding.provider!,
          ...(signal === undefined ? {} : { signal }),
        }),
        signal,
      )
      this.#assertLease(lease, caller, binding.provider!)
      throwIfAborted(signal)
      let readiness: Awaited<ReturnType<PluginCapabilityReadinessPort["evaluate"]>>
      try {
        readiness = await this.#readiness.evaluate({
          capability: binding.export!,
          provider: binding.provider!,
          ...(signal === undefined ? {} : { signal }),
        })
      } catch (error) {
        if (signal?.aborted) throwIfAborted(signal)
        throw error
      }
      if (!readiness.available) {
        throwIfAborted(signal)
        return {
          available: false,
          capabilityId,
          requirement: binding.requirement,
          reason: readiness.reason,
          recoverable: readiness.recoverable,
        }
      }
      runtime = readiness.runtime
      this.#assertRuntimeLease(runtime, binding.provider!)
      throwIfAborted(signal)
      try {
        assertPluginCapabilityRuntimeTools([binding.export!], readiness.tools)
      } catch {
        return {
          available: false,
          capabilityId,
          requirement: binding.requirement,
          reason: "contract-mismatch",
          recoverable: false,
        }
      }
      throwIfAborted(signal)
      return binding.availability
    } finally {
      runtime?.release()
      lease?.release()
      this.#releaseInFlight(caller.snapshotDigest)
    }
  }

  invoke(input: {
    readonly caller: PluginCapabilityPluginIdentity
    readonly capabilityId: string
    readonly input: unknown
    readonly requestId: string
    readonly signal?: AbortSignal
  }) {
    return this.#invoke(input, [])
  }

  async #invoke(
    input: {
      readonly caller: PluginCapabilityPluginIdentity
      readonly capabilityId: string
      readonly input: unknown
      readonly requestId: string
      readonly signal?: AbortSignal
    },
    trace: readonly CallFrame[],
    parentOperationId?: string,
    inheritedLease?: PluginCapabilityLease,
  ): Promise<unknown> {
    throwIfAborted(input.signal)
    if (!requestIdPattern.test(input.requestId)) {
      throw new PluginCapabilityBrokerError("invalid-request", "Plugin capability requestId is invalid")
    }
    const binding = this.#binding(input.caller, input.capabilityId)
    if (!binding) {
      const availability = {
        available: false as const,
        capabilityId: input.capabilityId,
        reason: "not-declared" as const,
        recoverable: false,
      }
      throw new PluginCapabilityBrokerError("unavailable", "Plugin capability import is not declared", {
        availability,
      })
    }
    if (!binding.availability.available) {
      throw new PluginCapabilityBrokerError("unavailable", "Plugin capability provider is unavailable", {
        availability: binding.availability,
      })
    }
    if (!binding.provider || !binding.export) {
      throw new PluginCapabilityBrokerError(
        "caller-stale",
        "Published Plugin capability provider binding is incomplete",
      )
    }
    if (trace.length >= this.#maximumDepth) {
      throw new PluginCapabilityBrokerError("depth-exceeded", "Plugin capability call depth exceeded")
    }
    const frame: CallFrame = {
      callerPluginId: input.caller.pluginId,
      capabilityId: input.capabilityId,
      providerPluginId: binding.provider.pluginId,
    }
    if (
      trace.some(
        (entry) =>
          entry.callerPluginId === frame.callerPluginId &&
          entry.capabilityId === frame.capabilityId &&
          entry.providerPluginId === frame.providerPluginId,
      )
    ) {
      throw new PluginCapabilityBrokerError("reentrant-call", "Plugin capability edge re-entry is forbidden")
    }
    try {
      assertPluginCapabilityValue(binding.export.inputSchema, input.input, "Plugin capability request")
    } catch (error) {
      throw new PluginCapabilityBrokerError("invalid-request", "Plugin capability request failed schema validation", {
        cause: error,
      })
    }
    if (jsonBytes(input.input, "Plugin capability request") > this.#maximumInputBytes) {
      throw new PluginCapabilityBrokerError("invalid-request", "Plugin capability request exceeds the byte limit")
    }

    const currentOperationId = operationId(
      this.#plan.bindingDigest,
      input.caller.snapshotDigest,
      input.requestId,
      parentOperationId,
    )
    const requestKey = `${input.caller.snapshotDigest}\0${currentOperationId}`
    this.#reserveInFlightRequest(requestKey)
    try {
      this.#reserveInFlight(input.caller.snapshotDigest)
    } catch (error) {
      this.#inFlightRequests.delete(requestKey)
      throw error
    }

    let lease: PluginCapabilityLease | undefined
    let ownsLease = false
    let runtime: PluginCapabilityRuntimeLease | undefined
    try {
      if (inheritedLease?.coversActiveSet) {
        this.#assertActiveSetLease(inheritedLease)
        lease = inheritedLease
      } else {
        lease = await waitForLease(
          this.#leases.acquireBoundPair({
            activeRevision: this.#plan.activeRevision,
            activeSetDigest: this.#plan.activeSetDigest,
            caller: input.caller,
            provider: binding.provider,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          }),
          input.signal,
        )
        ownsLease = true
        this.#assertLease(lease, input.caller, binding.provider)
      }
      throwIfAborted(input.signal)
      let readiness: Awaited<ReturnType<PluginCapabilityReadinessPort["evaluate"]>>
      try {
        readiness = await this.#readiness.evaluate({
          capability: binding.export,
          provider: binding.provider,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        })
      } catch (error) {
        if (input.signal?.aborted) throwIfAborted(input.signal)
        throw error
      }
      if (!readiness.available) {
        const availability = {
          available: false as const,
          capabilityId: input.capabilityId,
          requirement: binding.requirement,
          reason: readiness.reason,
          recoverable: readiness.recoverable,
        }
        throw new PluginCapabilityBrokerError("unavailable", "Plugin capability provider is unavailable", {
          availability,
        })
      }
      runtime = readiness.runtime
      this.#assertRuntimeLease(runtime, binding.provider)
      try {
        assertPluginCapabilityRuntimeTools([binding.export], readiness.tools)
      } catch (error) {
        const availability = {
          available: false as const,
          capabilityId: input.capabilityId,
          requirement: binding.requirement,
          reason: "contract-mismatch" as const,
          recoverable: false,
        }
        throw new PluginCapabilityBrokerError(
          "unavailable",
          "Plugin capability provider runtime contract does not match its manifest export",
          { availability, cause: error },
        )
      }
      throwIfAborted(input.signal)
      let output: unknown
      let invocationActive = true
      const authority: PluginCapabilityInvocationAuthority = Object.freeze({
        assertActive: async () => {
          throwIfAborted(input.signal)
          if (!invocationActive || !lease || lease.released) {
            throw new PluginCapabilityBrokerError(
              "lease-mismatch",
              "Plugin capability invocation authority is no longer active",
            )
          }
        },
        consumerPluginId: input.caller.pluginId,
        operationId: currentOperationId,
        providerPluginId: binding.provider.pluginId,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
      try {
        try {
          output = await this.#executor.execute({
            authority,
            capability: binding.export,
            input: input.input,
            operationId: currentOperationId,
            provider: binding.provider,
            runtime,
            signal: input.signal,
            invoke: (call) =>
              this.#invoke(
                {
                  caller: binding.provider!,
                  capabilityId: call.capabilityId,
                  input: call.input,
                  requestId: call.requestId,
                  signal:
                    input.signal && call.signal
                      ? AbortSignal.any([input.signal, call.signal])
                      : (call.signal ?? input.signal),
                },
                [...trace, frame],
                currentOperationId,
                lease,
              ),
          })
        } finally {
          invocationActive = false
        }
      } catch (error) {
        if (error instanceof PluginCapabilityBrokerError) throw error
        if (input.signal?.aborted) throwIfAborted(input.signal)
        throw new PluginCapabilityBrokerError("provider-failed", "Plugin capability provider failed", { cause: error })
      }
      throwIfAborted(input.signal)
      try {
        assertPluginCapabilityValue(binding.export.outputSchema, output, "Plugin capability response")
      } catch (error) {
        throw new PluginCapabilityBrokerError(
          "invalid-response",
          "Plugin capability response failed schema validation",
          { cause: error },
        )
      }
      if (jsonBytes(output, "Plugin capability response") > this.#maximumOutputBytes) {
        throw new PluginCapabilityBrokerError("invalid-response", "Plugin capability response exceeds the byte limit")
      }
      return output
    } finally {
      runtime?.release()
      if (ownsLease) lease?.release()
      this.#releaseInFlight(input.caller.snapshotDigest)
      this.#inFlightRequests.delete(requestKey)
    }
  }

  #assertRuntimeLease(runtime: PluginCapabilityRuntimeLease, provider: PluginCapabilityPluginIdentity) {
    if (runtime.released || !runtime.generation || !sameIdentity(runtime.provider, provider)) {
      runtime.release()
      throw new PluginCapabilityBrokerError(
        "lease-mismatch",
        "Plugin capability runtime lease does not match the exact provider process generation",
      )
    }
  }

  #binding(caller: PluginCapabilityPluginIdentity, capabilityId: string) {
    const plugin = this.#plan.plugins.find(({ identity }) => identity.pluginId === caller.pluginId)
    if (!plugin || !sameIdentity(plugin.identity, caller)) {
      throw new PluginCapabilityBrokerError("caller-stale", "Plugin capability caller identity is stale")
    }
    return this.#plan.bindings.find(
      (binding) => binding.caller.pluginId === caller.pluginId && binding.capabilityId === capabilityId,
    )
  }

  #assertActiveSetLease(lease: PluginCapabilityLease) {
    if (
      lease.released ||
      !lease.coversActiveSet ||
      lease.activeRevision !== this.#plan.activeRevision ||
      lease.activeSetDigest !== this.#plan.activeSetDigest
    ) {
      throw new PluginCapabilityBrokerError(
        "lease-mismatch",
        "Plugin capability inherited ActiveSet lease does not match the binding plan",
      )
    }
  }

  #assertLease(
    lease: PluginCapabilityLease,
    caller: PluginCapabilityPluginIdentity,
    provider: PluginCapabilityPluginIdentity,
  ) {
    if (
      lease.released ||
      lease.activeRevision !== this.#plan.activeRevision ||
      lease.activeSetDigest !== this.#plan.activeSetDigest ||
      !sameIdentity(lease.caller, caller) ||
      !sameIdentity(lease.provider, provider)
    ) {
      lease.release()
      throw new PluginCapabilityBrokerError(
        "lease-mismatch",
        "Plugin capability bound lease does not match the ActiveSet plan",
      )
    }
  }

  #reserveInFlightRequest(key: string) {
    if (this.#inFlightRequests.has(key)) {
      throw new PluginCapabilityBrokerError(
        "duplicate-request",
        "Plugin capability requestId is already running in this operation chain",
      )
    }
    this.#inFlightRequests.add(key)
  }

  #reserveInFlight(callerSnapshotDigest: string) {
    const callerCount = this.#inFlightByCaller.get(callerSnapshotDigest) ?? 0
    if (this.#inFlight >= this.#maximumInFlight || callerCount >= this.#maximumInFlightPerCaller) {
      throw new PluginCapabilityBrokerError("overloaded", "Plugin capability broker is at its concurrency limit")
    }
    this.#inFlight += 1
    this.#inFlightByCaller.set(callerSnapshotDigest, callerCount + 1)
  }

  #releaseInFlight(callerSnapshotDigest: string) {
    this.#inFlight -= 1
    const nextCallerCount = (this.#inFlightByCaller.get(callerSnapshotDigest) ?? 1) - 1
    if (nextCallerCount <= 0) this.#inFlightByCaller.delete(callerSnapshotDigest)
    else this.#inFlightByCaller.set(callerSnapshotDigest, nextCallerCount)
  }
}
