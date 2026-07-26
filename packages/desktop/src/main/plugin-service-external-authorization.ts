export const pluginServiceExternalAuthorizationRequestSchema = "convax.plugin-service-external-authorization/1" as const
export const pluginServiceExternalAuthorizationCompletionSchema =
  "convax.plugin-service-external-authorization-completion/1" as const

const authorizationIdPattern = /^[A-Za-z0-9_-]{16,128}$/
const minimumTimeoutSeconds = 30
const maximumTimeoutSeconds = 1_800
const defaultTimeoutSeconds = 300
const loopbackHosts = new Set(["127.0.0.1", "[::1]", "::1", "localhost"])

export interface PluginServiceExternalAuthorizationRequest {
  authorizationId: string
  authorizationUrl: string
  schema: typeof pluginServiceExternalAuthorizationRequestSchema
  timeoutSeconds: number
}

export interface PluginServiceExternalAuthorizationCompletion {
  authorization_id: string
  schema: typeof pluginServiceExternalAuthorizationCompletionSchema
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

function canonicalAuthorizationUrl(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 4_096 || value !== value.trim()) {
    throw new Error("External authorization URL is invalid")
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error("External authorization URL is invalid")
  }
  const secure = parsed.protocol === "https:"
  const localDevelopment = parsed.protocol === "http:" && loopbackHosts.has(parsed.hostname)
  if ((!secure && !localDevelopment) || parsed.username || parsed.password || parsed.hash || parsed.href !== value) {
    throw new Error("External authorization URL must be canonical HTTPS or an HTTP loopback URL")
  }
  return parsed.href
}

/** Parses a bounded main-only request for the user's system browser. */
export function parsePluginServiceExternalAuthorizationRequest(
  value: unknown,
): PluginServiceExternalAuthorizationRequest {
  const input = requireRecord(value, "Plugin service external authorization request")
  requireExactKeys(
    input,
    ["authorization_id", "authorization_url", "schema", "timeout_seconds"],
    ["authorization_id", "authorization_url", "schema"],
    "Plugin service external authorization request",
  )
  if (input.schema !== pluginServiceExternalAuthorizationRequestSchema) {
    throw new Error("Plugin service external authorization schema is invalid")
  }
  if (typeof input.authorization_id !== "string" || !authorizationIdPattern.test(input.authorization_id)) {
    throw new Error("Plugin service external authorization id is invalid")
  }
  const timeoutSeconds = input.timeout_seconds ?? defaultTimeoutSeconds
  if (
    !Number.isSafeInteger(timeoutSeconds) ||
    Number(timeoutSeconds) < minimumTimeoutSeconds ||
    Number(timeoutSeconds) > maximumTimeoutSeconds
  ) {
    throw new Error("Plugin service external authorization timeout is invalid")
  }
  return {
    authorizationId: input.authorization_id,
    authorizationUrl: canonicalAuthorizationUrl(input.authorization_url),
    schema: pluginServiceExternalAuthorizationRequestSchema,
    timeoutSeconds: Number(timeoutSeconds),
  }
}

export interface PluginServiceExternalAuthorizationBroker {
  authorize(
    pluginId: string,
    request: PluginServiceExternalAuthorizationRequest,
    options: { signal?: AbortSignal },
  ): Promise<PluginServiceExternalAuthorizationCompletion>
  disposePlugin(pluginId: string): Promise<void>
}

/**
 * Opens a validated public-client authorization URL. The sidecar owns its
 * loopback callback, PKCE verifier and token exchange; no OAuth code or token
 * crosses preload or the renderer.
 */
export class DefaultPluginServiceExternalAuthorizationBroker implements PluginServiceExternalAuthorizationBroker {
  constructor(private readonly openExternal: (url: string) => Promise<void>) {}

  async authorize(
    _pluginId: string,
    request: PluginServiceExternalAuthorizationRequest,
    options: { signal?: AbortSignal },
  ): Promise<PluginServiceExternalAuthorizationCompletion> {
    if (options.signal?.aborted) throw abortError("Plugin service external authorization was canceled")
    await this.openExternal(request.authorizationUrl)
    if (options.signal?.aborted) throw abortError("Plugin service external authorization was canceled")
    return {
      authorization_id: request.authorizationId,
      schema: pluginServiceExternalAuthorizationCompletionSchema,
    }
  }

  async disposePlugin(_pluginId: string): Promise<void> {}
}

function abortError(message: string) {
  const error = new Error(message)
  error.name = "AbortError"
  return error
}
