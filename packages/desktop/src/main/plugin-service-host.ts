import { createHash } from "node:crypto"

import {
  parsePluginServiceUsageHistory,
  parsePluginServiceStatus,
  pluginServiceTargetKey,
  pluginServiceUsageSchema,
  type PluginServiceStatus,
  type PluginServiceSummary,
  type PluginServiceTarget,
  type PluginServiceUsageHistory,
} from "../plugin-service-contracts"
import type { WebPluginServiceAction } from "../plugin-contracts"
import { parsePluginServiceCheckoutResult, type PluginServiceCheckoutNavigation } from "./plugin-service-checkout"
import {
  parsePluginServiceBrowserAuthorizationRequest,
  pluginServiceBrowserAuthorizationRequestSchema,
  type PluginServiceBrowserAuthorizationBroker,
  type PluginServiceBrowserAuthorizationCompletion,
} from "./plugin-service-browser-authorization"
import {
  parsePluginServiceExternalAuthorizationRequest,
  pluginServiceExternalAuthorizationRequestSchema,
  type PluginServiceExternalAuthorizationBroker,
  type PluginServiceExternalAuthorizationCompletion,
} from "./plugin-service-external-authorization"

interface PluginServiceToolCallResult {
  authorizationIdentity?: string
  snapshotDigest?: string
  completeAuthorization?: (
    input: PluginServiceBrowserAuthorizationCompletion | PluginServiceExternalAuthorizationCompletion,
    signal?: AbortSignal,
  ) => Promise<{ isError?: boolean; structuredContent?: Record<string, unknown> }>
  isError?: boolean
  structuredContent?: Record<string, unknown>
}

interface ActivePluginServiceAuthorization {
  controller: AbortController
  finished: Promise<void>
  finish(): void
  target: PluginServiceTarget
}

interface ActivePluginServiceControl {
  controller: AbortController
  finished: Promise<void>
  finish(): void
  target: PluginServiceTarget
}

export interface PluginServiceToolRuntime {
  callService(
    target: PluginServiceTarget,
    call: "status" | "usage" | WebPluginServiceAction,
    signal?: AbortSignal,
    input?: { readonly planKey: string },
  ): Promise<PluginServiceToolCallResult>
  listServices(): Promise<readonly PluginServiceSummary[]>
}

export interface PluginServiceBrowserAuthorizationHost {
  authorize(
    target: PluginServiceTarget,
    request: ReturnType<typeof parsePluginServiceBrowserAuthorizationRequest>,
    options: {
      action: "authorize" | "reauthorize"
      isCurrent(): Promise<boolean>
      serviceIdentity: string
      snapshotDigest: string
      signal?: AbortSignal
    },
  ): Promise<PluginServiceBrowserAuthorizationCompletion>
  clearPlugin?(target: PluginServiceTarget): Promise<void>
  commitPlugin?(target: PluginServiceTarget): Promise<void>
  disposePlugin(target: PluginServiceTarget): Promise<void>
}

function summaryFingerprint(summary: PluginServiceSummary) {
  return JSON.stringify({
    actions: [...summary.actions],
    capabilities: [...summary.capabilities],
    description: summary.description,
    llmProviderIds: [...summary.llmProviderIds],
    models: summary.models.map((model) => ({ ...model })),
    pluginId: summary.pluginId,
    pluginName: summary.pluginName,
    serviceId: summary.serviceId,
    version: summary.version,
  })
}

function serviceTarget(summary: PluginServiceSummary): PluginServiceTarget {
  return { pluginId: summary.pluginId, serviceId: summary.serviceId }
}

function serviceLabel(target: PluginServiceTarget) {
  return `${target.pluginId}/${target.serviceId}`
}

function authorizationIdentity(result: PluginServiceToolCallResult, summary: PluginServiceSummary) {
  if (result.authorizationIdentity !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(result.authorizationIdentity)) {
      throw new Error(`Plugin service returned an invalid authorization identity: ${serviceLabel(summary)}`)
    }
    return result.authorizationIdentity
  }
  // Structural test/fake runtimes do not own executable bytes. Production's
  // GenerationPluginRuntime always supplies the stronger manifest + verified
  // executable identity above.
  return createHash("sha256").update(summaryFingerprint(summary)).digest("hex")
}

function requireSnapshotDigest(value: unknown, target: PluginServiceTarget) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Plugin service is not bound to an immutable snapshot: ${serviceLabel(target)}`)
  }
  return value
}

function abortError(message: string) {
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

const failedAuthorizationCleanupTimeoutMs = 5_000

/**
 * Converts fixed service MCP calls into a display-only status contract. Raw MCP
 * content and diagnostics never leave main, even when the sidecar fails.
 */
export class PluginServiceHost {
  readonly #authorizations = new Map<string, ActivePluginServiceAuthorization>()
  readonly #activeControls = new Set<ActivePluginServiceControl>()
  readonly #controlActions = new Map<string, Promise<void>>()
  #disposed = false

  constructor(
    private readonly runtime: PluginServiceToolRuntime,
    private readonly browserAuthorization?:
      | PluginServiceBrowserAuthorizationBroker
      | PluginServiceBrowserAuthorizationHost,
    private readonly externalAuthorization?: PluginServiceExternalAuthorizationBroker,
    private readonly checkoutNavigation?: PluginServiceCheckoutNavigation,
    private readonly onServiceMutation?: (pluginId: string) => Promise<void> | void,
    private readonly onExternalAuthorizationComplete?: () => Promise<void> | void,
  ) {}

  listServices() {
    return this.runtime.listServices()
  }

  async getStatus(target: PluginServiceTarget, signal?: AbortSignal) {
    return this.#call(target, "status", signal)
  }

  async getUsageHistory(target: PluginServiceTarget, signal?: AbortSignal): Promise<PluginServiceUsageHistory> {
    const before = await this.#installed(target)
    try {
      const result = await this.runtime.callService(target, "usage", signal)
      if (result.isError || !result.structuredContent) throw new Error("Plugin service usage history is unavailable")
      await this.#assertCurrent(before)
      return parsePluginServiceUsageHistory(result.structuredContent)
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error
      await this.#assertCurrent(before)
      return { availability: "unavailable", schema: pluginServiceUsageSchema }
    }
  }

  async authorize(target: PluginServiceTarget, signal?: AbortSignal) {
    return this.#withServiceMutationNotification(target.pluginId, () =>
      this.#callAuthorization(target, "authorize", signal),
    )
  }

  async reauthorize(target: PluginServiceTarget, signal?: AbortSignal) {
    return this.#withServiceMutationNotification(target.pluginId, () =>
      this.#callAuthorization(target, "reauthorize", signal),
    )
  }

  async cancelAuthorization(target: PluginServiceTarget, signal?: AbortSignal) {
    return this.#withServiceMutationNotification(target.pluginId, () =>
      this.#withExclusiveControl(target, signal, async (controlSignal) => {
        await this.#discardService(target)
        return this.#call(target, "authorization.cancel", controlSignal)
      }),
    )
  }

  async signOut(target: PluginServiceTarget, signal?: AbortSignal) {
    return this.#withServiceMutationNotification(target.pluginId, () =>
      this.#withExclusiveControl(target, signal, async (controlSignal) => {
        await this.#discardService(target)
        return this.#call(target, "sign_out", controlSignal)
      }),
    )
  }

  async #withServiceMutationNotification<T>(pluginId: string, operation: () => Promise<T>) {
    try {
      return await operation()
    } finally {
      // A sidecar or remote service may have committed a mutation before a
      // transport, parsing, cleanup, or final status failure became visible.
      this.#notifyServiceMutation(pluginId)
    }
  }

  #notifyServiceMutation(pluginId: string) {
    try {
      void Promise.resolve(this.onServiceMutation?.(pluginId)).catch((error) => {
        console.warn("Could not refresh host state after a Plugin service mutation", error)
      })
    } catch (error) {
      console.warn("Could not refresh host state after a Plugin service mutation", error)
    }
  }

  async checkout(target: PluginServiceTarget, planKey: string, signal?: AbortSignal) {
    return this.#withServiceMutationNotification(target.pluginId, () =>
      this.#withExclusiveControl(target, signal, async (controlSignal) => {
        if (!this.checkoutNavigation) throw new Error("Plugin service Checkout navigation is unavailable")
        const before = await this.#installed(target)
        if (!before.actions.includes("checkout"))
          throw new Error(`Plugin service Checkout is not declared: ${serviceLabel(target)}`)
        const result = await this.runtime.callService(target, "checkout", controlSignal, { planKey })
        if (result.isError || !result.structuredContent) {
          throw new Error(`Plugin service Checkout failed: ${serviceLabel(target)}`)
        }
        await this.#assertCurrent(before)
        let checkout: ReturnType<typeof parsePluginServiceCheckoutResult>
        try {
          checkout = parsePluginServiceCheckoutResult(result.structuredContent)
        } catch {
          throw new Error(`Plugin service returned an invalid Checkout result: ${serviceLabel(target)}`)
        }
        await this.checkoutNavigation.open(checkout.checkoutUrl)
        await this.#assertCurrent(before)
        return this.#call(target, "status", controlSignal)
      }),
    )
  }

  /** Explicit Plugin lifecycle changes must not hand old Cookies to new bytes. */
  async discardPlugin(pluginId: string) {
    const listed = (await this.runtime.listServices())
      .filter((service) => service.pluginId === pluginId)
      .map(serviceTarget)
    const active = [...this.#authorizations.values()]
      .map(({ target }) => target)
      .filter((target) => target.pluginId === pluginId)
    const controlling = [...this.#activeControls]
      .map(({ target }) => target)
      .filter((target) => target.pluginId === pluginId)
    const targets = new Map(
      [...listed, ...active, ...controlling].map((target) => [pluginServiceTargetKey(target), target]),
    )
    await Promise.all(
      [...targets.values()].map((target) =>
        this.#withExclusiveControl(target, undefined, () => this.#discardService(target)),
      ),
    )
  }

  async #discardService(target: PluginServiceTarget) {
    await this.disposePlugin(target)
    await this.browserAuthorization?.clearPlugin?.(target)
  }

  async #withExclusiveControl<T>(
    target: PluginServiceTarget,
    callerSignal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ) {
    if (this.#disposed) throw new Error("Plugin service host is disposed")
    if (callerSignal?.aborted) throw abortError("Plugin service control action was canceled")
    const controller = new AbortController()
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const active: ActivePluginServiceControl = { controller, finish, finished, target }
    this.#activeControls.add(active)
    const onCallerAbort = () => controller.abort(abortError("Plugin service control action was canceled"))
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true })
    const targetKey = pluginServiceTargetKey(target)
    const preceding = this.#controlActions.get(targetKey) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = preceding.catch(() => undefined).then(() => gate)
    this.#controlActions.set(targetKey, tail)
    await preceding.catch(() => undefined)
    try {
      if (controller.signal.aborted) throw abortError("Plugin service control action was canceled")
      return await operation(controller.signal)
    } finally {
      callerSignal?.removeEventListener("abort", onCallerAbort)
      release()
      if (this.#controlActions.get(targetKey) === tail) this.#controlActions.delete(targetKey)
      this.#activeControls.delete(active)
      finish()
    }
  }

  async disposePlugin(target: PluginServiceTarget) {
    const active = this.#authorizations.get(pluginServiceTargetKey(target))
    if (active) {
      active.controller.abort(abortError("Plugin service authorization was canceled"))
      await active.finished
    }
    await this.browserAuthorization?.disposePlugin(target)
    await this.externalAuthorization?.disposePlugin(target)
  }

  async dispose() {
    if (this.#disposed) return
    this.#disposed = true
    for (const control of this.#activeControls) {
      control.controller.abort(abortError("Plugin service host is disposed"))
    }
    const targets = [...this.#authorizations.values()].map(({ target }) => target)
    await Promise.all(targets.map((target) => this.disposePlugin(target)))
    await Promise.all([...this.#activeControls].map(({ finished }) => finished))
  }

  async #callAuthorization(
    target: PluginServiceTarget,
    call: "authorize" | "reauthorize",
    signal?: AbortSignal,
  ): Promise<PluginServiceStatus> {
    if (this.#disposed) throw new Error("Plugin service host is disposed")
    const targetKey = pluginServiceTargetKey(target)
    if (this.#controlActions.has(targetKey)) {
      throw new Error(`Plugin service control action is active: ${serviceLabel(target)}`)
    }
    if (this.#authorizations.has(targetKey))
      throw new Error(`Plugin service authorization is already active: ${serviceLabel(target)}`)
    if (signal?.aborted) throw abortError("Plugin service authorization was canceled")
    const controller = new AbortController()
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const active: ActivePluginServiceAuthorization = { controller, finish, finished, target }
    this.#authorizations.set(targetKey, active)
    const onCallerAbort = () => controller.abort(abortError("Plugin service authorization was canceled"))
    signal?.addEventListener("abort", onCallerAbort, { once: true })
    try {
      return await this.#runAuthorization(target, call, controller.signal)
    } finally {
      signal?.removeEventListener("abort", onCallerAbort)
      if (this.#authorizations.get(targetKey) === active) this.#authorizations.delete(targetKey)
      finish()
    }
  }

  async #runAuthorization(
    target: PluginServiceTarget,
    call: "authorize" | "reauthorize",
    signal: AbortSignal,
  ): Promise<PluginServiceStatus> {
    const before = await this.#installed(target)
    try {
      if (call === "reauthorize") await this.browserAuthorization?.clearPlugin?.(target)
      const result = await this.runtime.callService(target, call, signal)
      await this.#assertCurrent(before)
      if (result.isError || !result.structuredContent) {
        throw new Error(`Plugin service action failed: ${serviceLabel(target)}`)
      }
      if (
        result.structuredContent.schema !== pluginServiceBrowserAuthorizationRequestSchema &&
        result.structuredContent.schema !== pluginServiceExternalAuthorizationRequestSchema
      ) {
        return this.#parseStatus(target, result.structuredContent)
      }
      if (!result.completeAuthorization) {
        throw new Error(`Plugin service authorization completion is unavailable: ${serviceLabel(target)}`)
      }

      let completion: PluginServiceBrowserAuthorizationCompletion | PluginServiceExternalAuthorizationCompletion
      let commitBrowserCheckpoint = false
      if (result.structuredContent.schema === pluginServiceBrowserAuthorizationRequestSchema) {
        if (!this.browserAuthorization) {
          throw new Error(`Plugin service browser authorization is unavailable: ${serviceLabel(target)}`)
        }
        let request: ReturnType<typeof parsePluginServiceBrowserAuthorizationRequest>
        try {
          request = parsePluginServiceBrowserAuthorizationRequest(result.structuredContent)
        } catch {
          throw new Error(`Plugin service returned an invalid browser authorization request: ${serviceLabel(target)}`)
        }
        completion = await this.browserAuthorization.authorize(target, request, {
          action: call,
          isCurrent: async () => this.#isCurrent(before),
          serviceIdentity: authorizationIdentity(result, before),
          snapshotDigest: requireSnapshotDigest(result.snapshotDigest, target),
          signal,
        })
        commitBrowserCheckpoint = true
      } else {
        if (!this.externalAuthorization) {
          throw new Error(`Plugin service external authorization is unavailable: ${serviceLabel(target)}`)
        }
        let request: ReturnType<typeof parsePluginServiceExternalAuthorizationRequest>
        try {
          request = parsePluginServiceExternalAuthorizationRequest(result.structuredContent)
        } catch {
          throw new Error(`Plugin service returned an invalid external authorization request: ${serviceLabel(target)}`)
        }
        completion = await this.#openExternalAuthorization(target, request, before, signal)
      }
      // completeAuthorization is an in-process one-shot closure bound by the
      // runtime to the exact manifest, executable snapshot and MCP client that
      // created the request. No renderer can select this method or payload.
      const completed = await result.completeAuthorization(completion, signal)
      await this.#assertCurrent(before)
      if (completed.isError || !completed.structuredContent) {
        throw new Error(`Plugin service authorization completion failed: ${serviceLabel(target)}`)
      }
      const status = this.#parseStatus(target, completed.structuredContent)
      if (!status.credential.configured) {
        throw new Error(`Plugin service authorization did not persist a credential: ${serviceLabel(target)}`)
      }
      if (commitBrowserCheckpoint) await this.browserAuthorization?.commitPlugin?.(target)
      if (result.structuredContent.schema === pluginServiceExternalAuthorizationRequestSchema) {
        this.#notifyExternalAuthorizationComplete()
      }
      return status
    } catch (error) {
      await this.#cancelFailedAuthorization(before)
      throw error
    }
  }

  async #openExternalAuthorization(
    target: PluginServiceTarget,
    request: ReturnType<typeof parsePluginServiceExternalAuthorizationRequest>,
    before: PluginServiceSummary,
    signal: AbortSignal,
  ) {
    const controller = new AbortController()
    const forwardAbort = () => controller.abort(signal.reason)
    signal.addEventListener("abort", forwardAbort, { once: true })
    const timeout = setTimeout(
      () => controller.abort(abortError("Plugin service external authorization timed out")),
      request.timeoutSeconds * 1_000,
    )
    timeout.unref?.()
    try {
      if (!(await this.#isCurrent(before))) {
        throw new Error(`Plugin service changed before external authorization opened: ${serviceLabel(target)}`)
      }
      return await this.externalAuthorization!.authorize(target, request, { signal: controller.signal })
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener("abort", forwardAbort)
    }
  }

  async #cancelFailedAuthorization(before: PluginServiceSummary) {
    if (!before.actions.includes("authorization.cancel")) return
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(abortError("Plugin service authorization cleanup timed out")),
      failedAuthorizationCleanupTimeoutMs,
    )
    timeout.unref?.()
    try {
      // Never send cleanup to a replacement Plugin. GenerationPluginRuntime
      // repeats the same fingerprint check immediately before the fixed call.
      if (!(await this.#isCurrent(before))) return
      await this.runtime.callService(serviceTarget(before), "authorization.cancel", controller.signal)
    } catch {
      // Cleanup is best effort and must never replace the original failure.
    } finally {
      clearTimeout(timeout)
    }
  }

  #notifyExternalAuthorizationComplete() {
    try {
      void Promise.resolve(this.onExternalAuthorizationComplete?.()).catch((error) => {
        console.warn("Could not focus Convax after external Plugin service authorization", error)
      })
    } catch (error) {
      console.warn("Could not focus Convax after external Plugin service authorization", error)
    }
  }

  async #call(
    target: PluginServiceTarget,
    call: "status" | WebPluginServiceAction,
    signal?: AbortSignal,
  ): Promise<PluginServiceStatus> {
    const before = await this.#installed(target)
    const result = await this.runtime.callService(target, call, signal)
    if (result.isError || !result.structuredContent) {
      throw new Error(`Plugin service ${call === "status" ? "status" : "action"} failed: ${serviceLabel(target)}`)
    }
    await this.#assertCurrent(before)
    return this.#parseStatus(target, result.structuredContent)
  }

  async #installed(target: PluginServiceTarget) {
    const installed = (await this.runtime.listServices()).find(
      (service) => service.pluginId === target.pluginId && service.serviceId === target.serviceId,
    )
    if (!installed) throw new Error(`Plugin service is not installed: ${serviceLabel(target)}`)
    return installed
  }

  async #isCurrent(before: PluginServiceSummary) {
    const after = (await this.runtime.listServices()).find(
      (service) => service.pluginId === before.pluginId && service.serviceId === before.serviceId,
    )
    return Boolean(after && summaryFingerprint(after) === summaryFingerprint(before))
  }

  async #assertCurrent(before: PluginServiceSummary) {
    if (!(await this.#isCurrent(before))) {
      throw new Error(`Plugin service changed while the request was running: ${serviceLabel(before)}`)
    }
  }

  #parseStatus(target: PluginServiceTarget, value: Record<string, unknown>) {
    try {
      return parsePluginServiceStatus(value)
    } catch {
      throw new Error(`Plugin service returned an invalid bounded status: ${serviceLabel(target)}`)
    }
  }
}
