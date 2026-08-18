import {
  isInvalidPluginServiceAuthorizationCheckpoint,
  pluginServiceAuthorizationCheckpointSchema,
  type PluginServiceAuthorizationAction,
  type PluginServiceAuthorizationCheckpoint,
  type PluginServiceAuthorizationCheckpointBinding,
  type PluginServiceAuthorizationCheckpointStore,
} from "./plugin-service-authorization-checkpoints"
import { pluginServiceTargetKey, type PluginServiceTarget } from "../plugin-service-contracts"

export const pluginServiceBrowserAuthorizationRequestSchema = "convax.plugin-service-browser-authorization/1" as const
export const pluginServiceBrowserAuthorizationCompletionSchema =
  "convax.plugin-service-browser-authorization-completion/1" as const

const authorizationIdPattern = /^[A-Za-z0-9_-]{16,128}$/
const cookieNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/
const minimumTimeoutSeconds = 30
const maximumTimeoutSeconds = 1_800
const defaultTimeoutSeconds = 300
const maximumCookieNames = 32
const maximumCookieValueBytes = 16 * 1024
const maximumCookieBytes = 32 * 1024

export interface PluginServiceBrowserAuthorizationRequest {
  authorizationId: string
  cookieNames: readonly string[]
  cookieOrigin: string
  loginUrl: string
  schema: typeof pluginServiceBrowserAuthorizationRequestSchema
  timeoutSeconds: number
}

export interface PluginServiceBrowserAuthorizationCompletion {
  authorization_id: string
  cookie_origin: string
  cookies: readonly { name: string; value: string }[]
  schema: typeof pluginServiceBrowserAuthorizationCompletionSchema
}

export interface PluginServiceBrowserAuthorizationSession {
  /** Closes the native surface without treating the close as user confirmation. */
  close(): void
  /** Clears every storage type in the isolated, temporary Electron session. */
  clear(): Promise<void>
  /** Reads cookies visible to exactly the already-validated HTTPS origin. */
  readCookies(origin: string): Promise<readonly { expiresAt?: number; name: string; value: string }[]>
  /** Resolves only after a host-owned explicit confirmation. */
  waitForConfirmation(signal: AbortSignal): Promise<void>
}

export type PluginServiceBrowserAuthorizationSessionFactory = (
  target: PluginServiceTarget,
  request: PluginServiceBrowserAuthorizationRequest,
) => Promise<PluginServiceBrowserAuthorizationSession> | PluginServiceBrowserAuthorizationSession

interface ActiveAuthorization {
  controller: AbortController
  finished: Promise<void>
  finish(): void
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
) {
  const allowedKeys = new Set(allowed)
  if (Object.keys(value).some((key) => !allowedKeys.has(key)) || required.some((key) => !(key in value))) {
    throw new Error(`${label} contains unsupported or missing fields`)
  }
}

function requireCanonicalHttpsOrigin(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 2_048 || value !== value.trim()) {
    throw new Error("Browser authorization cookie origin is invalid")
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error("Browser authorization cookie origin is invalid")
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== value ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Browser authorization cookie origin must be one canonical HTTPS origin")
  }
  return parsed
}

function requireLoginUrl(value: unknown, cookieOrigin: string) {
  if (typeof value !== "string" || !value || value.length > 4_096 || value !== value.trim()) {
    throw new Error("Browser authorization login URL is invalid")
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error("Browser authorization login URL is invalid")
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== cookieOrigin ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.href !== value
  ) {
    throw new Error("Browser authorization login URL must be canonical HTTPS on the cookie origin")
  }
  return parsed.href
}

/** Parses the only main-only authorization request accepted from a service sidecar. */
export function parsePluginServiceBrowserAuthorizationRequest(
  value: unknown,
): PluginServiceBrowserAuthorizationRequest {
  const input = requireRecord(value, "Plugin service browser authorization request")
  requireExactKeys(
    input,
    ["authorization_id", "cookie_names", "cookie_origin", "login_url", "schema", "timeout_seconds"],
    ["authorization_id", "cookie_names", "cookie_origin", "login_url", "schema"],
    "Plugin service browser authorization request",
  )
  if (input.schema !== pluginServiceBrowserAuthorizationRequestSchema) {
    throw new Error("Plugin service browser authorization schema is invalid")
  }
  if (typeof input.authorization_id !== "string" || !authorizationIdPattern.test(input.authorization_id)) {
    throw new Error("Plugin service browser authorization id is invalid")
  }
  const origin = requireCanonicalHttpsOrigin(input.cookie_origin)
  const loginUrl = requireLoginUrl(input.login_url, origin.origin)
  if (
    !Array.isArray(input.cookie_names) ||
    input.cookie_names.length < 1 ||
    input.cookie_names.length > maximumCookieNames
  ) {
    throw new Error("Plugin service browser authorization cookie names are invalid")
  }
  const cookieNames = input.cookie_names.map((name) => {
    if (typeof name !== "string" || !cookieNamePattern.test(name)) {
      throw new Error("Plugin service browser authorization cookie name is invalid")
    }
    return name
  })
  if (new Set(cookieNames).size !== cookieNames.length) {
    throw new Error("Plugin service browser authorization cookie names must be unique")
  }
  const timeoutSeconds = input.timeout_seconds ?? defaultTimeoutSeconds
  if (
    !Number.isSafeInteger(timeoutSeconds) ||
    Number(timeoutSeconds) < minimumTimeoutSeconds ||
    Number(timeoutSeconds) > maximumTimeoutSeconds
  ) {
    throw new Error("Plugin service browser authorization timeout is invalid")
  }
  return {
    authorizationId: input.authorization_id,
    cookieNames,
    cookieOrigin: origin.origin,
    loginUrl,
    schema: pluginServiceBrowserAuthorizationRequestSchema,
    timeoutSeconds: Number(timeoutSeconds),
  }
}

function abortError(message: string) {
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

function cookieValueBytes(value: string) {
  return new TextEncoder().encode(value).byteLength
}

/**
 * Owns the transient browser authorization lifetime. It filters the native
 * session result again before a secret can be sent to the fixed completion tool.
 */
export class PluginServiceBrowserAuthorizationBroker {
  readonly #active = new Map<string, ActiveAuthorization>()
  #disposed = false

  constructor(
    private readonly createSession: PluginServiceBrowserAuthorizationSessionFactory,
    private readonly checkpoints?: PluginServiceAuthorizationCheckpointStore,
  ) {}

  async authorize(
    target: PluginServiceTarget,
    request: PluginServiceBrowserAuthorizationRequest,
    options: {
      action: PluginServiceAuthorizationAction
      isCurrent(): Promise<boolean>
      serviceIdentity: string
      snapshotDigest: string
      signal?: AbortSignal
    },
  ): Promise<PluginServiceBrowserAuthorizationCompletion> {
    if (this.#disposed) throw new Error("Plugin service browser authorization is disposed")
    const targetKey = pluginServiceTargetKey(target)
    if (this.#active.has(targetKey)) throw new Error("Plugin service browser authorization is already active")
    if (options.signal?.aborted) throw abortError("Plugin service browser authorization was canceled")

    const controller = new AbortController()
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const active: ActiveAuthorization = { controller, finish, finished }
    this.#active.set(targetKey, active)
    const onCallerAbort = () => controller.abort(abortError("Plugin service browser authorization was canceled"))
    options.signal?.addEventListener("abort", onCallerAbort, { once: true })
    const timeout = setTimeout(
      () => controller.abort(abortError("Plugin service browser authorization timed out")),
      request.timeoutSeconds * 1_000,
    )
    timeout.unref?.()

    let browserSession: PluginServiceBrowserAuthorizationSession | undefined
    try {
      const checkpointBinding: PluginServiceAuthorizationCheckpointBinding = {
        cookieNames: request.cookieNames,
        cookieOrigin: request.cookieOrigin,
        ...target,
        serviceIdentity: options.serviceIdentity,
        snapshotDigest: options.snapshotDigest,
      }
      let checkpoint: PluginServiceAuthorizationCheckpoint | null = null
      if (this.checkpoints) {
        try {
          checkpoint = await this.checkpoints.read(checkpointBinding)
        } catch (error) {
          // A checkpoint for a changed identity/contract must never cross that
          // boundary. Transient I/O failures stay recoverable and fail closed
          // instead of turning a momentary disk error into another login.
          if (!isInvalidPluginServiceAuthorizationCheckpoint(error)) throw error
          await this.checkpoints.remove(target)
        }
      }
      if (checkpoint) {
        if (!(await options.isCurrent())) throw new Error("Plugin service changed during browser authorization")
        return {
          authorization_id: request.authorizationId,
          cookie_origin: request.cookieOrigin,
          cookies: checkpoint.cookies.map(({ name, value }) => ({ name, value })),
          schema: pluginServiceBrowserAuthorizationCompletionSchema,
        }
      }

      browserSession = await this.createSession(target, request)
      if (controller.signal.aborted) throw abortError("Plugin service browser authorization was canceled")
      await browserSession.waitForConfirmation(controller.signal)
      if (controller.signal.aborted) throw abortError("Plugin service browser authorization was canceled")
      if (!(await options.isCurrent())) throw new Error("Plugin service changed during browser authorization")

      const allowlist = new Set(request.cookieNames)
      const seen = new Set<string>()
      const checkpointCookies: Array<{ expiresAt?: number; name: string; value: string }> = []
      let totalBytes = 0
      for (const cookie of await browserSession.readCookies(request.cookieOrigin)) {
        if (!allowlist.has(cookie.name)) continue
        if (seen.has(cookie.name)) throw new Error("Browser authorization returned an ambiguous cookie")
        if (typeof cookie.value !== "string" || cookie.value.includes("\0")) {
          throw new Error("Browser authorization returned an invalid cookie")
        }
        const valueBytes = cookieValueBytes(cookie.value)
        if (valueBytes > maximumCookieValueBytes) throw new Error("Browser authorization cookie is too large")
        totalBytes += cookieValueBytes(cookie.name) + valueBytes
        if (totalBytes > maximumCookieBytes) throw new Error("Browser authorization cookies are too large")
        seen.add(cookie.name)
        checkpointCookies.push({
          ...(cookie.expiresAt === undefined ? {} : { expiresAt: cookie.expiresAt }),
          name: cookie.name,
          value: cookie.value,
        })
      }
      if (!checkpointCookies.length) throw new Error("Browser authorization did not produce an approved cookie")
      if (!(await options.isCurrent())) throw new Error("Plugin service changed during browser authorization")
      await this.checkpoints?.write({
        action: options.action,
        capturedAt: Date.now(),
        ...checkpointBinding,
        cookies: checkpointCookies,
        schema: pluginServiceAuthorizationCheckpointSchema,
      })
      const cookies = checkpointCookies.map(({ name, value }) => ({ name, value }))
      return {
        authorization_id: request.authorizationId,
        cookie_origin: request.cookieOrigin,
        cookies,
        schema: pluginServiceBrowserAuthorizationCompletionSchema,
      }
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener("abort", onCallerAbort)
      try {
        browserSession?.close()
      } catch {
        // Closing an already destroyed native window is harmless.
      }
      try {
        await browserSession?.clear()
      } catch {
        // The non-persistent partition is abandoned even if Electron cleanup fails.
      }
      if (this.#active.get(targetKey) === active) this.#active.delete(targetKey)
      finish()
    }
  }

  async disposePlugin(target: PluginServiceTarget) {
    const active = this.#active.get(pluginServiceTargetKey(target))
    if (!active) return
    active.controller.abort(abortError("Plugin service browser authorization was canceled"))
    await active.finished
  }

  /** Removes a captured handoff only after the sidecar made it authoritative. */
  commitPlugin(target: PluginServiceTarget) {
    return this.checkpoints?.remove(target) ?? Promise.resolve()
  }

  /** Explicit cancel/sign-out/update discards any recoverable Cookie handoff. */
  clearPlugin(target: PluginServiceTarget) {
    return this.checkpoints?.remove(target) ?? Promise.resolve()
  }

  async dispose() {
    if (this.#disposed) return
    this.#disposed = true
    const active = [...this.#active.values()]
    for (const item of active) item.controller.abort(abortError("Plugin service browser authorization was canceled"))
    await Promise.all(active.map((item) => item.finished))
  }
}
