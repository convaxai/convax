import { createHash } from "node:crypto"

import {
  parsePluginServiceStatus,
  type PluginServiceStatus,
  type PluginServiceSummary,
} from "../plugin-service-contracts"
import type { WebPluginServiceAction } from "../plugin-contracts"
import type { GenerationPluginRuntime } from "./generation-plugin-runtime"
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
}

interface ActivePluginServiceControl {
  controller: AbortController
  finished: Promise<void>
  finish(): void
}

export interface PluginServiceToolRuntime {
  callService(
    pluginId: string,
    call: "status" | WebPluginServiceAction,
    signal?: AbortSignal,
    input?: { readonly planKey: string },
  ): Promise<PluginServiceToolCallResult>
  listServices(): Promise<readonly PluginServiceSummary[]>
}

export interface PluginServiceBrowserAuthorizationHost {
  authorize(
    pluginId: string,
    request: ReturnType<typeof parsePluginServiceBrowserAuthorizationRequest>,
    options: {
      action: "authorize" | "reauthorize"
      isCurrent(): Promise<boolean>
      serviceIdentity: string
      snapshotDigest: string
      signal?: AbortSignal
    },
  ): Promise<PluginServiceBrowserAuthorizationCompletion>
  clearPlugin?(pluginId: string): Promise<void>
  commitPlugin?(pluginId: string): Promise<void>
  disposePlugin(pluginId: string): Promise<void>
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

function authorizationIdentity(result: PluginServiceToolCallResult, summary: PluginServiceSummary) {
  if (result.authorizationIdentity !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(result.authorizationIdentity)) {
      throw new Error(`Plugin service returned an invalid authorization identity: ${summary.pluginId}`)
    }
    return result.authorizationIdentity
  }
  // Structural test/fake runtimes do not own executable bytes. Production's
  // GenerationPluginRuntime always supplies the stronger manifest + verified
  // executable identity above.
  return createHash("sha256").update(summaryFingerprint(summary)).digest("hex")
}

function requireSnapshotDigest(value: unknown, pluginId: string) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Plugin service is not bound to an immutable snapshot: ${pluginId}`)
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
    private readonly runtime: PluginServiceToolRuntime | GenerationPluginRuntime,
    private readonly browserAuthorization?:
      | PluginServiceBrowserAuthorizationBroker
      | PluginServiceBrowserAuthorizationHost,
    private readonly externalAuthorization?: PluginServiceExternalAuthorizationBroker,
    private readonly checkoutNavigation?: PluginServiceCheckoutNavigation,
    private readonly onServiceMutation?: () => Promise<void> | void,
    private readonly onExternalAuthorizationComplete?: () => Promise<void> | void,
  ) {}

  listServices() {
    return this.runtime.listServices()
  }

  async getStatus(pluginId: string, signal?: AbortSignal) {
    return this.#call(pluginId, "status", signal)
  }

  async authorize(pluginId: string, signal?: AbortSignal) {
    return this.#withServiceMutationNotification(() => this.#callAuthorization(pluginId, "authorize", signal))
  }

  async reauthorize(pluginId: string, signal?: AbortSignal) {
    return this.#withServiceMutationNotification(() => this.#callAuthorization(pluginId, "reauthorize", signal))
  }

  async cancelAuthorization(pluginId: string, signal?: AbortSignal) {
    return this.#withServiceMutationNotification(() =>
      this.#withExclusiveControl(pluginId, signal, async (controlSignal) => {
        await this.#discardPlugin(pluginId)
        return this.#call(pluginId, "authorization.cancel", controlSignal)
      }),
    )
  }

  async signOut(pluginId: string, signal?: AbortSignal) {
    return this.#withServiceMutationNotification(() =>
      this.#withExclusiveControl(pluginId, signal, async (controlSignal) => {
        await this.#discardPlugin(pluginId)
        return this.#call(pluginId, "sign_out", controlSignal)
      }),
    )
  }

  async #withServiceMutationNotification<T>(operation: () => Promise<T>) {
    try {
      return await operation()
    } finally {
      // A sidecar or remote service may have committed a mutation before a
      // transport, parsing, cleanup, or final status failure became visible.
      this.#notifyServiceMutation()
    }
  }

  #notifyServiceMutation() {
    try {
      void Promise.resolve(this.onServiceMutation?.()).catch((error) => {
        console.warn("Could not refresh host state after a Plugin service mutation", error)
      })
    } catch (error) {
      console.warn("Could not refresh host state after a Plugin service mutation", error)
    }
  }

  async checkout(pluginId: string, planKey: string, signal?: AbortSignal) {
    return this.#withServiceMutationNotification(() =>
      this.#withExclusiveControl(pluginId, signal, async (controlSignal) => {
        if (!this.checkoutNavigation) throw new Error("Plugin service Checkout navigation is unavailable")
        const before = await this.#installed(pluginId)
        if (!before.actions.includes("checkout"))
          throw new Error(`Plugin service Checkout is not declared: ${pluginId}`)
        const result = await this.runtime.callService(pluginId, "checkout", controlSignal, { planKey })
        if (result.isError || !result.structuredContent) {
          throw new Error(`Plugin service Checkout failed: ${pluginId}`)
        }
        await this.#assertCurrent(before)
        let checkout: ReturnType<typeof parsePluginServiceCheckoutResult>
        try {
          checkout = parsePluginServiceCheckoutResult(result.structuredContent)
        } catch {
          throw new Error(`Plugin service returned an invalid Checkout result: ${pluginId}`)
        }
        await this.checkoutNavigation.open(checkout.checkoutUrl)
        await this.#assertCurrent(before)
        return this.#call(pluginId, "status", controlSignal)
      }),
    )
  }

  /** Explicit Plugin lifecycle changes must not hand old Cookies to new bytes. */
  async discardPlugin(pluginId: string) {
    return this.#withExclusiveControl(pluginId, undefined, () => this.#discardPlugin(pluginId))
  }

  async #discardPlugin(pluginId: string) {
    await this.disposePlugin(pluginId)
    await this.browserAuthorization?.clearPlugin?.(pluginId)
  }

  async #withExclusiveControl<T>(
    pluginId: string,
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
    const active: ActivePluginServiceControl = { controller, finish, finished }
    this.#activeControls.add(active)
    const onCallerAbort = () => controller.abort(abortError("Plugin service control action was canceled"))
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true })
    const preceding = this.#controlActions.get(pluginId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = preceding.catch(() => undefined).then(() => gate)
    this.#controlActions.set(pluginId, tail)
    await preceding.catch(() => undefined)
    try {
      if (controller.signal.aborted) throw abortError("Plugin service control action was canceled")
      return await operation(controller.signal)
    } finally {
      callerSignal?.removeEventListener("abort", onCallerAbort)
      release()
      if (this.#controlActions.get(pluginId) === tail) this.#controlActions.delete(pluginId)
      this.#activeControls.delete(active)
      finish()
    }
  }

  async disposePlugin(pluginId: string) {
    const active = this.#authorizations.get(pluginId)
    if (active) {
      active.controller.abort(abortError("Plugin service authorization was canceled"))
      await active.finished
    }
    await this.browserAuthorization?.disposePlugin(pluginId)
    await this.externalAuthorization?.disposePlugin(pluginId)
  }

  async dispose() {
    if (this.#disposed) return
    this.#disposed = true
    for (const control of this.#activeControls) {
      control.controller.abort(abortError("Plugin service host is disposed"))
    }
    const pluginIds = [...this.#authorizations.keys()]
    await Promise.all(pluginIds.map((pluginId) => this.disposePlugin(pluginId)))
    await Promise.all([...this.#activeControls].map(({ finished }) => finished))
  }

  async #callAuthorization(
    pluginId: string,
    call: "authorize" | "reauthorize",
    signal?: AbortSignal,
  ): Promise<PluginServiceStatus> {
    if (this.#disposed) throw new Error("Plugin service host is disposed")
    if (this.#controlActions.has(pluginId)) {
      throw new Error(`Plugin service control action is active: ${pluginId}`)
    }
    if (this.#authorizations.has(pluginId))
      throw new Error(`Plugin service authorization is already active: ${pluginId}`)
    if (signal?.aborted) throw abortError("Plugin service authorization was canceled")
    const controller = new AbortController()
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const active: ActivePluginServiceAuthorization = { controller, finish, finished }
    this.#authorizations.set(pluginId, active)
    const onCallerAbort = () => controller.abort(abortError("Plugin service authorization was canceled"))
    signal?.addEventListener("abort", onCallerAbort, { once: true })
    try {
      return await this.#runAuthorization(pluginId, call, controller.signal)
    } finally {
      signal?.removeEventListener("abort", onCallerAbort)
      if (this.#authorizations.get(pluginId) === active) this.#authorizations.delete(pluginId)
      finish()
    }
  }

  async #runAuthorization(
    pluginId: string,
    call: "authorize" | "reauthorize",
    signal: AbortSignal,
  ): Promise<PluginServiceStatus> {
    const before = await this.#installed(pluginId)
    try {
      if (call === "reauthorize") await this.browserAuthorization?.clearPlugin?.(pluginId)
      const result = await this.runtime.callService(pluginId, call, signal)
      await this.#assertCurrent(before)
      if (result.isError || !result.structuredContent) {
        throw new Error(`Plugin service action failed: ${pluginId}`)
      }
      if (
        result.structuredContent.schema !== pluginServiceBrowserAuthorizationRequestSchema &&
        result.structuredContent.schema !== pluginServiceExternalAuthorizationRequestSchema
      ) {
        return this.#parseStatus(pluginId, result.structuredContent)
      }
      if (!result.completeAuthorization) {
        throw new Error(`Plugin service authorization completion is unavailable: ${pluginId}`)
      }

      let completion: PluginServiceBrowserAuthorizationCompletion | PluginServiceExternalAuthorizationCompletion
      let commitBrowserCheckpoint = false
      if (result.structuredContent.schema === pluginServiceBrowserAuthorizationRequestSchema) {
        if (!this.browserAuthorization) {
          throw new Error(`Plugin service browser authorization is unavailable: ${pluginId}`)
        }
        let request: ReturnType<typeof parsePluginServiceBrowserAuthorizationRequest>
        try {
          request = parsePluginServiceBrowserAuthorizationRequest(result.structuredContent)
        } catch {
          throw new Error(`Plugin service returned an invalid browser authorization request: ${pluginId}`)
        }
        completion = await this.browserAuthorization.authorize(pluginId, request, {
          action: call,
          isCurrent: async () => this.#isCurrent(before),
          serviceIdentity: authorizationIdentity(result, before),
          snapshotDigest: requireSnapshotDigest(result.snapshotDigest, pluginId),
          signal,
        })
        commitBrowserCheckpoint = true
      } else {
        if (!this.externalAuthorization) {
          throw new Error(`Plugin service external authorization is unavailable: ${pluginId}`)
        }
        let request: ReturnType<typeof parsePluginServiceExternalAuthorizationRequest>
        try {
          request = parsePluginServiceExternalAuthorizationRequest(result.structuredContent)
        } catch {
          throw new Error(`Plugin service returned an invalid external authorization request: ${pluginId}`)
        }
        completion = await this.#openExternalAuthorization(pluginId, request, before, signal)
      }
      // completeAuthorization is an in-process one-shot closure bound by the
      // runtime to the exact manifest, executable snapshot and MCP client that
      // created the request. No renderer can select this method or payload.
      const completed = await result.completeAuthorization(completion, signal)
      await this.#assertCurrent(before)
      if (completed.isError || !completed.structuredContent) {
        throw new Error(`Plugin service authorization completion failed: ${pluginId}`)
      }
      const status = this.#parseStatus(pluginId, completed.structuredContent)
      if (!status.credential.configured) {
        throw new Error(`Plugin service authorization did not persist a credential: ${pluginId}`)
      }
      if (commitBrowserCheckpoint) await this.browserAuthorization?.commitPlugin?.(pluginId)
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
    pluginId: string,
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
        throw new Error(`Plugin service changed before external authorization opened: ${pluginId}`)
      }
      return await this.externalAuthorization!.authorize(pluginId, request, { signal: controller.signal })
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
      await this.runtime.callService(before.pluginId, "authorization.cancel", controller.signal)
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
    pluginId: string,
    call: "status" | WebPluginServiceAction,
    signal?: AbortSignal,
  ): Promise<PluginServiceStatus> {
    const before = await this.#installed(pluginId)
    const result = await this.runtime.callService(pluginId, call, signal)
    if (result.isError || !result.structuredContent) {
      throw new Error(`Plugin service ${call === "status" ? "status" : "action"} failed: ${pluginId}`)
    }
    await this.#assertCurrent(before)
    return this.#parseStatus(pluginId, result.structuredContent)
  }

  async #installed(pluginId: string) {
    const installed = (await this.runtime.listServices()).find((service) => service.pluginId === pluginId)
    if (!installed) throw new Error(`Plugin service is not installed: ${pluginId}`)
    return installed
  }

  async #isCurrent(before: PluginServiceSummary) {
    const after = (await this.runtime.listServices()).find((service) => service.pluginId === before.pluginId)
    return Boolean(after && summaryFingerprint(after) === summaryFingerprint(before))
  }

  async #assertCurrent(before: PluginServiceSummary) {
    if (!(await this.#isCurrent(before))) {
      throw new Error(`Plugin service changed while the request was running: ${before.pluginId}`)
    }
  }

  #parseStatus(pluginId: string, value: Record<string, unknown>) {
    try {
      return parsePluginServiceStatus(value)
    } catch {
      throw new Error(`Plugin service returned an invalid bounded status: ${pluginId}`)
    }
  }
}
