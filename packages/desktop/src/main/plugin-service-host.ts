import { createHash } from "node:crypto"

import {
  parsePluginServiceStatus,
  type PluginServiceStatus,
  type PluginServiceSummary,
} from "../plugin-service-contracts"
import type { WebPluginServiceAction } from "../plugin-contracts"
import type { GenerationPluginRuntime } from "./generation-plugin-runtime"
import {
  parsePluginServiceBrowserAuthorizationRequest,
  pluginServiceBrowserAuthorizationRequestSchema,
  type PluginServiceBrowserAuthorizationBroker,
  type PluginServiceBrowserAuthorizationCompletion,
} from "./plugin-service-browser-authorization"

interface PluginServiceToolCallResult {
  authorizationIdentity?: string
  completeAuthorization?: (
    input: PluginServiceBrowserAuthorizationCompletion,
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
    description: summary.description,
    pluginId: summary.pluginId,
    pluginName: summary.pluginName,
    version: summary.version,
  })
}

function authorizationIdentity(
  result: PluginServiceToolCallResult,
  summary: PluginServiceSummary,
) {
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
  ) {}

  listServices() {
    return this.runtime.listServices()
  }

  async getStatus(pluginId: string, signal?: AbortSignal) {
    return this.#call(pluginId, "status", signal)
  }

  authorize(pluginId: string, signal?: AbortSignal) {
    return this.#callAuthorization(pluginId, "authorize", signal)
  }

  reauthorize(pluginId: string, signal?: AbortSignal) {
    return this.#callAuthorization(pluginId, "reauthorize", signal)
  }

  async cancelAuthorization(pluginId: string, signal?: AbortSignal) {
    return this.#withExclusiveControl(pluginId, signal, async (controlSignal) => {
      await this.#discardPlugin(pluginId)
      return this.#call(pluginId, "authorization.cancel", controlSignal)
    })
  }

  async signOut(pluginId: string, signal?: AbortSignal) {
    return this.#withExclusiveControl(pluginId, signal, async (controlSignal) => {
      await this.#discardPlugin(pluginId)
      return this.#call(pluginId, "sign_out", controlSignal)
    })
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
    const finished = new Promise<void>((resolve) => { finish = resolve })
    const active: ActivePluginServiceControl = { controller, finish, finished }
    this.#activeControls.add(active)
    const onCallerAbort = () => controller.abort(abortError("Plugin service control action was canceled"))
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true })
    const preceding = this.#controlActions.get(pluginId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
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
    if (this.#authorizations.has(pluginId)) throw new Error(`Plugin service authorization is already active: ${pluginId}`)
    if (signal?.aborted) throw abortError("Plugin service authorization was canceled")
    const controller = new AbortController()
    let finish!: () => void
    const finished = new Promise<void>((resolve) => { finish = resolve })
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
      if (result.structuredContent.schema !== pluginServiceBrowserAuthorizationRequestSchema) {
        return this.#parseStatus(pluginId, result.structuredContent)
      }
      if (!this.browserAuthorization || !result.completeAuthorization) {
        throw new Error(`Plugin service browser authorization is unavailable: ${pluginId}`)
      }

      let request: ReturnType<typeof parsePluginServiceBrowserAuthorizationRequest>
      try {
        request = parsePluginServiceBrowserAuthorizationRequest(result.structuredContent)
      } catch {
        throw new Error(`Plugin service returned an invalid browser authorization request: ${pluginId}`)
      }
      const completion = await this.browserAuthorization.authorize(pluginId, request, {
        action: call,
        isCurrent: async () => this.#isCurrent(before),
        serviceIdentity: authorizationIdentity(result, before),
        signal,
      })
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
      await this.browserAuthorization.commitPlugin?.(pluginId)
      return status
    } catch (error) {
      await this.#cancelFailedAuthorization(before)
      throw error
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
