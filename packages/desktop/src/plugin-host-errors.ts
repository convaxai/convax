import {
  getPluginApiDefinition,
  isPluginApiErrorCode,
  type PluginApiErrorCode,
  type PluginApiId,
} from "@convax/plugin-api"
import {
  pluginCapabilityRemoteErrors,
  pluginHostProtocolRemoteErrors,
  type PluginCapabilityRemoteErrorCode,
  type PluginHostProtocolRemoteErrorCode,
  type PluginHostRemoteFailure,
} from "@convax/plugin-sdk/client"

const apiFailureMessages = Object.freeze({
  "partial-success": "Plugin Host API completed only the reported durable file publication",
  "permission-denied": "Plugin Host API permission was denied",
  "resource-unavailable": "Plugin Host API resource is unavailable",
  "stale-context": "Plugin Host API context is stale",
} satisfies Readonly<Record<PluginApiErrorCode, string>>)

const capabilityFailureMessages = Object.freeze({
  canceled: "Plugin capability call was canceled",
  "contract-mismatch": "Plugin capability contract does not match the active provider",
  "depth-exceeded": "Plugin capability call depth was exceeded",
  "duplicate-request": "Plugin capability request id is already in flight",
  "execution-failed": "Plugin capability provider execution failed",
  "invalid-input": "Plugin capability input is invalid",
  "invalid-output": "Plugin capability output is invalid",
  overloaded: "Plugin capability broker is overloaded",
  "provider-unavailable": "Plugin capability provider is unavailable",
  "reentrant-call": "Plugin capability re-entry is forbidden",
} satisfies Readonly<Record<PluginCapabilityRemoteErrorCode, string>>)

const protocolFailureMessages = Object.freeze({
  canceled: "Plugin Host request was canceled",
  "internal-error": "Plugin Host request failed",
  "invalid-request": "Plugin Host request is invalid",
  overloaded: "Plugin Host transport is overloaded",
  "transport-closed": "Plugin Host transport is closed",
} satisfies Readonly<Record<PluginHostProtocolRemoteErrorCode, string>>)

/**
 * Main-private typed Host API failure. Its internal message/cause is diagnostic;
 * the portable response is derived only from the Catalog code and fixed safe text.
 */
export class PluginHostApiError extends Error {
  constructor(
    readonly code: PluginApiErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "PluginHostApiError"
  }
}

export class PluginHostApiResourceUnavailableError extends PluginHostApiError {
  constructor(message: string, options?: ErrorOptions) {
    super("resource-unavailable", message, options)
    this.name = "PluginHostApiResourceUnavailableError"
  }
}

export class PluginHostApiPartialSuccessError extends PluginHostApiError {
  constructor(message: string, options?: ErrorOptions) {
    super("partial-success", message, options)
    this.name = "PluginHostApiPartialSuccessError"
  }
}

/** Typed transport failure used only at an admitted protocol boundary. */
export class PluginHostProtocolError extends Error {
  constructor(
    readonly code: PluginHostProtocolRemoteErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "PluginHostProtocolError"
  }
}

export function pluginHostApiRemoteFailure(method: PluginApiId, error: unknown): PluginHostRemoteFailure {
  if (error instanceof PluginHostApiError && isPluginApiErrorCode(method, error.code)) {
    const definition = getPluginApiDefinition(method).errors.find(({ code }) => code === error.code)!
    return Object.freeze({
      code: error.code,
      kind: "api",
      message: apiFailureMessages[error.code],
      recoverable: definition.recoverable,
    })
  }
  return pluginHostProtocolRemoteFailure(error)
}

export function pluginHostCapabilityRemoteFailure(
  code: PluginCapabilityRemoteErrorCode,
): PluginHostRemoteFailure {
  return Object.freeze({
    code,
    kind: "capability",
    message: capabilityFailureMessages[code],
    recoverable: pluginCapabilityRemoteErrors[code].recoverable,
  })
}

export function pluginHostProtocolRemoteFailure(error: unknown): PluginHostRemoteFailure {
  const code =
    error instanceof PluginHostProtocolError
      ? error.code
      : error instanceof DOMException && error.name === "AbortError"
        ? "canceled"
        : "internal-error"
  return Object.freeze({
    code,
    kind: "protocol",
    message: protocolFailureMessages[code],
    recoverable: pluginHostProtocolRemoteErrors[code].recoverable,
  })
}
