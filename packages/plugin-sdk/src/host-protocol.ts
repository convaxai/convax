import {
  isPluginApiId,
  maximumPluginApiRequestBytes,
  maximumPluginApiResultBytes,
  parsePluginApiParams,
  pluginApiCatalog,
  type PluginApiCall,
  type PluginApiErrorCode,
} from "@convax/plugin-api"

import {
  isPluginCapabilityId,
  type PluginCapabilityImportRequirement,
  type PluginCapabilityUnavailableReason,
  type PluginCapabilityVersion,
} from "./capabilities"
import { parsePortablePluginId } from "./primitives"
import { parsePortablePluginLocale, type PortablePluginLocale } from "./localization"

/**
 * The only author-facing sandboxed Web Plugin MessagePort ABI.
 * `convax.plugin-capability/3` is deliberately absent: it is Host-internal.
 */
export const pluginHostProtocolV8 = "convax.plugin-host/8" as const
export type PluginHostProtocol = typeof pluginHostProtocolV8

/** Largest Catalog Host API envelope. Per-API limits remain authoritative. */
export const maximumPluginHostRequestBytes = maximumPluginApiRequestBytes
/** Largest Catalog Host API result. Per-API limits remain authoritative. */
export const maximumPluginHostResponseBytes = maximumPluginApiResultBytes
/** P2P capabilities deliberately retain a smaller independent attack surface. */
export const maximumPluginCapabilityRequestBytes = 1024 * 1024
export const maximumPluginCapabilityResponseBytes = 4 * 1024 * 1024
/** Fixed control envelopes contain no caller-selected identifiers or payloads. */
export const maximumPluginHostControlBytes = 128
export const maximumPluginHostInFlightRequests = 16
export const maximumPluginHostRequestIdLength = 128
export const maximumPluginHostIngressDepth = 64
/**
 * Any JSON tree inside the global byte limit has fewer entries than this
 * conservative two-byte-per-entry ceiling. It therefore cannot reject a
 * Catalog-valid payload independently of the byte limit.
 */
export const maximumPluginHostIngressEntries = Math.ceil(maximumPluginHostRequestBytes / 2)

export interface PluginHostConnect {
  readonly pluginId: string
  readonly protocol: PluginHostProtocol
  readonly type: "connect"
}

export type PluginHostRequest = PluginApiCall & {
  readonly id: string
  readonly protocol: PluginHostProtocol
  readonly type: "request"
}

export interface PluginHostCapabilityInvokeRequest {
  readonly capabilityId: string
  readonly id: string
  readonly input: unknown
  readonly protocol: PluginHostProtocol
  readonly type: "capability-invoke"
}

export interface PluginHostCapabilityAvailabilityRequest {
  readonly capabilityId: string
  readonly id: string
  readonly protocol: PluginHostProtocol
  readonly type: "capability-availability"
}

/**
 * Cancels one request previously sent by the same MessagePort.
 * The id is never resolved outside that sender-scoped connection.
 */
export interface PluginHostCancel {
  readonly id: string
  readonly protocol: PluginHostProtocol
  readonly type: "cancel"
}

/**
 * Closes only the exact sender-scoped MessagePort connection.
 *
 * This is protocol lifecycle control, not a Host API or Plugin capability. It
 * deliberately carries no caller-selected identity, scope, or payload.
 */
export interface PluginHostDisconnect {
  readonly protocol: PluginHostProtocol
  readonly type: "disconnect"
}

export type PluginCapabilityRemoteErrorCode =
  | "canceled"
  | "contract-mismatch"
  | "depth-exceeded"
  | "duplicate-request"
  | "execution-failed"
  | "invalid-input"
  | "invalid-output"
  | "overloaded"
  | "provider-unavailable"
  | "reentrant-call"

export type PluginHostProtocolRemoteErrorCode =
  | "canceled"
  | "internal-error"
  | "invalid-request"
  | "overloaded"
  | "transport-closed"

export type PluginHostRemoteFailure =
  | {
      readonly code: PluginApiErrorCode
      readonly kind: "api"
      readonly message: string
      readonly recoverable: boolean
    }
  | {
      readonly code: PluginCapabilityRemoteErrorCode
      readonly kind: "capability"
      readonly message: string
      readonly recoverable: boolean
    }
  | {
      readonly code: PluginHostProtocolRemoteErrorCode
      readonly kind: "protocol"
      readonly message: string
      readonly recoverable: boolean
    }

export type PluginHostResponse =
  | {
      readonly id: string
      readonly ok: true
      readonly protocol: PluginHostProtocol
      readonly result: unknown
      readonly type: "response"
    }
  | {
      readonly error: PluginHostRemoteFailure
      readonly id: string
      readonly ok: false
      readonly protocol: PluginHostProtocol
      readonly type: "response"
    }

export interface PluginHostCommand {
  readonly command: string
  readonly params?: unknown
  readonly protocol: PluginHostProtocol
  readonly type: "command"
}

export const pluginHostLocaleChangedCommand = "host.locale.changed" as const

export interface PluginHostLocaleChangedCommand extends PluginHostCommand {
  readonly command: typeof pluginHostLocaleChangedCommand
  readonly params: { readonly locale: PortablePluginLocale }
}

/**
 * Portable availability deliberately excludes provider Plugin and snapshot
 * identity. ActiveSet routing is Host-owned and opaque to Web Plugins.
 */
export type PluginHostCapabilityAvailability =
  | {
      readonly available: true
      readonly capabilityId: string
      readonly requirement: PluginCapabilityImportRequirement
      readonly version: PluginCapabilityVersion
    }
  | {
      readonly available: false
      readonly capabilityId: string
      readonly reason: PluginCapabilityUnavailableReason
      readonly recoverable: boolean
      readonly requirement: PluginCapabilityImportRequirement
    }

const pluginCapabilityVersions = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const unavailableReasons = new Set<PluginCapabilityUnavailableReason>([
  "not-declared",
  "provider-missing",
  "provider-incompatible",
  "provider-ambiguous",
  "self-provider",
  "dependency-cycle",
  "setup-required",
  "disabled",
  "recovering",
  "contract-mismatch",
])
export const pluginCapabilityRemoteErrors = Object.freeze({
  canceled: { recoverable: true },
  "contract-mismatch": { recoverable: false },
  "depth-exceeded": { recoverable: false },
  "duplicate-request": { recoverable: false },
  "execution-failed": { recoverable: false },
  "invalid-input": { recoverable: false },
  "invalid-output": { recoverable: false },
  overloaded: { recoverable: true },
  "provider-unavailable": { recoverable: true },
  "reentrant-call": { recoverable: false },
} satisfies Readonly<Record<PluginCapabilityRemoteErrorCode, { readonly recoverable: boolean }>>)
const capabilityRemoteErrorCodes = new Set<PluginCapabilityRemoteErrorCode>(
  Object.keys(pluginCapabilityRemoteErrors) as PluginCapabilityRemoteErrorCode[],
)
export const pluginHostProtocolRemoteErrors = Object.freeze({
  canceled: { recoverable: true },
  "internal-error": { recoverable: false },
  "invalid-request": { recoverable: false },
  overloaded: { recoverable: true },
  "transport-closed": { recoverable: true },
} satisfies Readonly<Record<PluginHostProtocolRemoteErrorCode, { readonly recoverable: boolean }>>)
const protocolRemoteErrorCodes = new Set<PluginHostProtocolRemoteErrorCode>(
  Object.keys(pluginHostProtocolRemoteErrors) as PluginHostProtocolRemoteErrorCode[],
)
const hostApiRemoteErrorCodes = new Set(
  pluginApiCatalog.apis.flatMap((definition) => definition.errors.map(({ code }) => code)),
)

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null ? (value as Record<string, unknown>) : undefined
}

function jsonStringByteLength(value: string) {
  let bytes = 2
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (
      unit === 0x22 ||
      unit === 0x5c ||
      unit === 0x08 ||
      unit === 0x09 ||
      unit === 0x0a ||
      unit === 0x0c ||
      unit === 0x0d
    ) {
      bytes += 2
    } else if (unit <= 0x1f || (unit >= 0xd800 && unit <= 0xdfff)) {
      const next = value.charCodeAt(index + 1)
      if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else {
        bytes += 6
      }
    } else if (unit < 0x80) {
      bytes += 1
    } else if (unit < 0x800) {
      bytes += 2
    } else {
      bytes += 3
    }
  }
  return bytes
}

/**
 * Performs a non-recursive, fail-closed JSON-tree and byte preflight before any
 * method or result schema walks an untrusted Web MessagePort value.
 */
export function assertPluginHostMessageByteLength(value: unknown, maximumBytes: number, label = "Plugin Host message") {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError(`${label} byte limit is invalid`)
  }
  const stack: Array<{ readonly depth: number; readonly value: unknown }> = [{ depth: 0, value }]
  const seen = new WeakSet<object>()
  let bytes = 0
  let entries = 0
  const addBytes = (amount: number) => {
    bytes += amount
    if (bytes > maximumBytes) throw new RangeError(`${label} exceeds ${maximumBytes} bytes`)
  }

  while (stack.length > 0) {
    const current = stack.pop()!
    const entry = current.value
    if (entry === null) {
      addBytes(4)
      continue
    }
    if (typeof entry === "string") {
      addBytes(jsonStringByteLength(entry))
      continue
    }
    if (typeof entry === "boolean") {
      addBytes(entry ? 4 : 5)
      continue
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) throw new TypeError(`${label} must contain finite JSON numbers`)
      addBytes(Object.is(entry, -0) ? 1 : String(entry).length)
      continue
    }
    if (!entry || typeof entry !== "object") {
      throw new TypeError(`${label} must be a JSON value`)
    }
    if (current.depth > maximumPluginHostIngressDepth || seen.has(entry)) {
      throw new TypeError(`${label} must be a bounded acyclic JSON tree`)
    }
    seen.add(entry)

    if (Array.isArray(entry)) {
      entries += entry.length
      if (entries > maximumPluginHostIngressEntries) {
        throw new RangeError(`${label} exceeds ${maximumPluginHostIngressEntries} JSON entries`)
      }
      addBytes(2 + Math.max(0, entry.length - 1))
      if (Object.getOwnPropertySymbols(entry).length > 0) {
        throw new TypeError(`${label} arrays must not contain symbol properties`)
      }
      let itemCount = 0
      for (const key in entry) {
        if (!Object.prototype.hasOwnProperty.call(entry, key)) continue
        if (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= entry.length) {
          throw new TypeError(`${label} arrays must contain only indexed entries`)
        }
        const descriptor = Object.getOwnPropertyDescriptor(entry, key)
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError(`${label} arrays must contain enumerable data properties`)
        }
        itemCount += 1
        stack.push({ depth: current.depth + 1, value: descriptor.value })
      }
      if (itemCount !== entry.length) throw new TypeError(`${label} arrays must be dense JSON arrays`)
      continue
    }

    const prototype = Object.getPrototypeOf(entry)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} must contain plain JSON objects`)
    }
    if (Object.getOwnPropertySymbols(entry).length > 0) {
      throw new TypeError(`${label} must not contain symbol properties`)
    }
    addBytes(2)
    let keyCount = 0
    for (const key in entry) {
      if (!Object.prototype.hasOwnProperty.call(entry, key)) continue
      const descriptor = Object.getOwnPropertyDescriptor(entry, key)
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${label} objects must contain enumerable data properties`)
      }
      keyCount += 1
      entries += 1
      if (entries > maximumPluginHostIngressEntries) {
        throw new RangeError(`${label} exceeds ${maximumPluginHostIngressEntries} JSON entries`)
      }
      addBytes((keyCount === 1 ? 0 : 1) + jsonStringByteLength(key) + 1)
      stack.push({ depth: current.depth + 1, value: descriptor.value })
    }
  }
  return bytes
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  const admitted = new Set([...required, ...optional])
  return (
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => admitted.has(key))
  )
}

export function isPluginHostRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumPluginHostRequestIdLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  )
}

function isBoundedName(value: unknown) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  )
}

export function isPluginHostConnect(value: unknown): value is PluginHostConnect {
  const input = record(value)
  if (
    !input ||
    !exactKeys(input, ["pluginId", "protocol", "type"]) ||
    input.protocol !== pluginHostProtocolV8 ||
    input.type !== "connect"
  ) {
    return false
  }
  try {
    parsePortablePluginId(input.pluginId)
    return true
  } catch {
    return false
  }
}

export function isPluginHostRequest(value: unknown): value is PluginHostRequest {
  const input = record(value)
  if (
    !input ||
    !exactKeys(input, ["id", "method", "protocol", "type"], ["params"]) ||
    input.protocol !== pluginHostProtocolV8 ||
    input.type !== "request" ||
    !isPluginHostRequestId(input.id) ||
    !isPluginApiId(input.method)
  ) {
    return false
  }
  try {
    parsePluginApiParams(input.method, input.params)
    return true
  } catch {
    return false
  }
}

export function isPluginHostCapabilityInvokeRequest(value: unknown): value is PluginHostCapabilityInvokeRequest {
  const input = record(value)
  return Boolean(
    input &&
      exactKeys(input, ["capabilityId", "id", "input", "protocol", "type"]) &&
      input.protocol === pluginHostProtocolV8 &&
      input.type === "capability-invoke" &&
      isPluginHostRequestId(input.id) &&
      isPluginCapabilityId(input.capabilityId),
  )
}

export function isPluginHostCapabilityAvailabilityRequest(
  value: unknown,
): value is PluginHostCapabilityAvailabilityRequest {
  const input = record(value)
  return Boolean(
    input &&
      exactKeys(input, ["capabilityId", "id", "protocol", "type"]) &&
      input.protocol === pluginHostProtocolV8 &&
      input.type === "capability-availability" &&
      isPluginHostRequestId(input.id) &&
      isPluginCapabilityId(input.capabilityId),
  )
}

export function isPluginHostCancel(value: unknown): value is PluginHostCancel {
  const input = record(value)
  return Boolean(
    input &&
      exactKeys(input, ["id", "protocol", "type"]) &&
      input.protocol === pluginHostProtocolV8 &&
      input.type === "cancel" &&
      isPluginHostRequestId(input.id),
  )
}

export function isPluginHostDisconnect(value: unknown): value is PluginHostDisconnect {
  const input = record(value)
  return Boolean(
    input &&
      exactKeys(input, ["protocol", "type"]) &&
      input.protocol === pluginHostProtocolV8 &&
      input.type === "disconnect",
  )
}

export function isPluginHostResponse(value: unknown): value is PluginHostResponse {
  const input = record(value)
  if (
    !input ||
    input.protocol !== pluginHostProtocolV8 ||
    input.type !== "response" ||
    !isPluginHostRequestId(input.id)
  ) {
    return false
  }
  if (input.ok === true) return exactKeys(input, ["id", "ok", "protocol", "result", "type"])
  if (input.ok !== false || !exactKeys(input, ["error", "id", "ok", "protocol", "type"])) return false
  const error = record(input.error)
  return Boolean(
    error &&
      exactKeys(error, ["code", "kind", "message", "recoverable"]) &&
      typeof error.code === "string" &&
      ((error.kind === "api" && hostApiRemoteErrorCodes.has(error.code as PluginApiErrorCode)) ||
        (error.kind === "capability" &&
          capabilityRemoteErrorCodes.has(error.code as PluginCapabilityRemoteErrorCode)) ||
        (error.kind === "protocol" && protocolRemoteErrorCodes.has(error.code as PluginHostProtocolRemoteErrorCode))) &&
      typeof error.message === "string" &&
      error.message.length > 0 &&
      error.message.length <= 4_096 &&
      typeof error.recoverable === "boolean",
  )
}

export function isPluginHostCommand(value: unknown): value is PluginHostCommand {
  const input = record(value)
  return Boolean(
    input &&
      exactKeys(input, ["command", "protocol", "type"], ["params"]) &&
      input.protocol === pluginHostProtocolV8 &&
      input.type === "command" &&
      isBoundedName(input.command),
  )
}

export function isPluginHostLocaleChangedCommand(value: unknown): value is PluginHostLocaleChangedCommand {
  if (!isPluginHostCommand(value) || value.command !== pluginHostLocaleChangedCommand) return false
  const params = record(value.params)
  if (!params || !exactKeys(params, ["locale"])) return false
  try {
    parsePortablePluginLocale(params.locale)
    return true
  } catch {
    return false
  }
}

export function parsePluginHostCapabilityAvailability(value: unknown): PluginHostCapabilityAvailability {
  const input = record(value)
  if (!input || typeof input.available !== "boolean") {
    throw new TypeError("Plugin capability availability must be a closed object")
  }
  const requirement = input.requirement
  if (requirement !== "required" && requirement !== "optional") {
    throw new TypeError("Plugin capability availability requirement is invalid")
  }
  if (!isPluginCapabilityId(input.capabilityId)) {
    throw new TypeError("Plugin capability availability id is invalid")
  }
  if (input.available) {
    if (
      !exactKeys(input, ["available", "capabilityId", "requirement", "version"]) ||
      typeof input.version !== "string" ||
      !pluginCapabilityVersions.test(input.version)
    ) {
      throw new TypeError("Available Plugin capability result is invalid")
    }
    return Object.freeze({
      available: true,
      capabilityId: input.capabilityId,
      requirement,
      version: input.version as PluginCapabilityVersion,
    })
  }
  if (
    !exactKeys(input, ["available", "capabilityId", "reason", "recoverable", "requirement"]) ||
    typeof input.reason !== "string" ||
    !unavailableReasons.has(input.reason as PluginCapabilityUnavailableReason) ||
    typeof input.recoverable !== "boolean"
  ) {
    throw new TypeError("Unavailable Plugin capability result is invalid")
  }
  return Object.freeze({
    available: false,
    capabilityId: input.capabilityId,
    reason: input.reason as PluginCapabilityUnavailableReason,
    recoverable: input.recoverable,
    requirement,
  })
}

export function parsePluginCapabilityRemoteFailure(value: unknown): PluginHostRemoteFailure {
  const input = record(value)
  if (
    !input ||
    !exactKeys(input, ["code", "kind", "message", "recoverable"]) ||
    input.kind !== "capability" ||
    typeof input.code !== "string" ||
    !capabilityRemoteErrorCodes.has(input.code as PluginCapabilityRemoteErrorCode) ||
    typeof input.message !== "string" ||
    input.message.length < 1 ||
    input.message.length > 4_096 ||
    typeof input.recoverable !== "boolean"
  ) {
    throw new TypeError("Plugin capability failure is invalid")
  }
  const code = input.code as PluginCapabilityRemoteErrorCode
  if (input.recoverable !== pluginCapabilityRemoteErrors[code].recoverable) {
    throw new TypeError("Plugin capability failure recoverability is invalid")
  }
  return Object.freeze({ code, kind: "capability", message: input.message, recoverable: input.recoverable })
}

export function parsePluginHostProtocolRemoteFailure(value: unknown): PluginHostRemoteFailure {
  const input = record(value)
  if (
    !input ||
    !exactKeys(input, ["code", "kind", "message", "recoverable"]) ||
    input.kind !== "protocol" ||
    typeof input.code !== "string" ||
    !protocolRemoteErrorCodes.has(input.code as PluginHostProtocolRemoteErrorCode) ||
    typeof input.message !== "string" ||
    input.message.length < 1 ||
    input.message.length > 4_096 ||
    typeof input.recoverable !== "boolean"
  ) {
    throw new TypeError("Plugin Host protocol failure is invalid")
  }
  const code = input.code as PluginHostProtocolRemoteErrorCode
  if (input.recoverable !== pluginHostProtocolRemoteErrors[code].recoverable) {
    throw new TypeError("Plugin Host protocol failure recoverability is invalid")
  }
  return Object.freeze({ code, kind: "protocol", message: input.message, recoverable: input.recoverable })
}

export function pluginHostConnect(pluginId: string): PluginHostConnect {
  const envelope = { pluginId, protocol: pluginHostProtocolV8, type: "connect" } as const
  if (!isPluginHostConnect(envelope)) throw new TypeError("Plugin Host connect envelope is invalid")
  return envelope
}

export function pluginHostSuccess(id: string, result: unknown): PluginHostResponse {
  if (!isPluginHostRequestId(id)) throw new TypeError("Plugin Host response id is invalid")
  return { id, ok: true, protocol: pluginHostProtocolV8, result, type: "response" }
}

export function pluginHostFailure(id: string, error: PluginHostRemoteFailure): PluginHostResponse {
  if (!isPluginHostRequestId(id)) throw new TypeError("Plugin Host response id is invalid")
  const response = {
    error,
    id,
    ok: false,
    protocol: pluginHostProtocolV8,
    type: "response",
  } as const
  if (!isPluginHostResponse(response)) throw new TypeError("Plugin Host failure is invalid")
  return response
}
