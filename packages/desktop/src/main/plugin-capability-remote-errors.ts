import type { PluginHostRemoteFailure } from "@convax/plugin-sdk/client"

import {
  pluginHostCapabilityRemoteFailure,
  pluginHostProtocolRemoteFailure,
} from "../plugin-host-errors"
import {
  PluginCapabilityBrokerError,
} from "./plugin-capability-broker"

/**
 * Projects only admitted broker states into the portable Plugin Host union.
 * Broker diagnostics, identities, digests, provider output and causes never
 * cross the process boundary.
 */
export function pluginCapabilityBrokerRemoteFailure(error: unknown): PluginHostRemoteFailure {
  if (!(error instanceof PluginCapabilityBrokerError)) {
    return pluginHostProtocolRemoteFailure(error)
  }
  switch (error.code) {
    case "aborted":
      return pluginHostCapabilityRemoteFailure("canceled")
    case "caller-stale":
    case "lease-mismatch":
      return pluginHostCapabilityRemoteFailure("provider-unavailable")
    case "depth-exceeded":
      return pluginHostCapabilityRemoteFailure("depth-exceeded")
    case "duplicate-request":
      return pluginHostCapabilityRemoteFailure("duplicate-request")
    case "invalid-request":
      return pluginHostCapabilityRemoteFailure("invalid-input")
    case "invalid-response":
      return pluginHostCapabilityRemoteFailure("invalid-output")
    case "overloaded":
      return pluginHostCapabilityRemoteFailure("overloaded")
    case "provider-failed":
      return pluginHostCapabilityRemoteFailure("execution-failed")
    case "reentrant-call":
      return pluginHostCapabilityRemoteFailure("reentrant-call")
    case "unavailable":
      return pluginHostCapabilityRemoteFailure(
        error.availability?.reason === "contract-mismatch"
          ? "contract-mismatch"
          : "provider-unavailable",
      )
    default:
      return assertNeverBrokerCode(error.code)
  }
}

function assertNeverBrokerCode(code: never): never {
  throw new Error(`Unhandled Plugin capability broker error code: ${String(code)}`)
}
