import {
  getPluginApiDefinition,
  getPluginApiWireContract,
  isPluginApiDeclared,
  parsePluginApiParams,
  parsePluginApiRemoteFailure,
  parsePluginApiResult,
  pluginApiMethodContracts,
  PluginApiUnavailableError,
  type PluginApiId,
  type ApiAvailability,
  type PluginApiHostContextResult,
  type PluginApiHostLocaleResult,
  type PluginApiParams,
  type PluginApiResult,
} from "@convax/plugin-api"

import {
  assertPluginCapabilityValue,
  type PluginCapabilityImport,
  type PluginCapabilityObjectSchema,
  type PluginCapabilitySchema,
} from "./capabilities"
import {
  assertPluginHostMessageByteLength,
  isPluginHostCommand,
  isPluginHostLocaleChangedCommand,
  isPluginHostRequestId,
  isPluginHostResponse,
  maximumPluginHostControlBytes,
  maximumPluginHostInFlightRequests,
  maximumPluginHostResponseBytes,
  maximumPluginCapabilityRequestBytes,
  maximumPluginCapabilityResponseBytes,
  parsePluginCapabilityRemoteFailure,
  parsePluginHostCapabilityAvailability,
  parsePluginHostProtocolRemoteFailure,
  pluginHostLocaleChangedCommand,
  pluginHostProtocolV8,
  type PluginHostCancel,
  type PluginHostCapabilityAvailability,
  type PluginHostCapabilityAvailabilityRequest,
  type PluginHostCapabilityInvokeRequest,
  type PluginHostCommand,
  type PluginHostDisconnect,
  type PluginHostRequest,
  type PluginHostRemoteFailure,
} from "./host-protocol"
import { parsePortablePluginLocale, type PortablePluginLocale } from "./localization"
import { parsePluginManifestV8, type PortablePluginManifestV8 } from "./manifest"

export * from "./host-protocol"

export interface PluginHostMessageEvent {
  readonly data: unknown
}

/**
 * Structural subset of MessagePort used by the SDK. It intentionally avoids a
 * DOM library dependency while remaining implementable by a browser MessagePort.
 */
export interface PluginHostMessagePort {
  addEventListener(type: "message", listener: (event: PluginHostMessageEvent) => void): void
  close(): void
  removeEventListener(type: "message", listener: (event: PluginHostMessageEvent) => void): void
  postMessage(message: unknown): void
  start?(): void
}

/** Structural AbortSignal subset, avoiding a DOM type dependency in declarations. */
export interface PluginHostAbortSignal {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: "abort", listener: () => void, options?: { readonly once?: boolean }): void
  removeEventListener(type: "abort", listener: () => void): void
}

export interface PluginHostCallOptions {
  readonly signal?: PluginHostAbortSignal
}

export interface PluginHostClientOptions<Manifest extends PortablePluginManifestV8> {
  readonly manifest: Manifest
  readonly onFatalError?: (error: PluginHostProtocolError) => void
  readonly port: PluginHostMessagePort
  /**
   * Bounded diagnostic prefix only. The SDK appends a monotonic counter and
   * never reuses an id for the lifetime of this client.
   */
  readonly requestIdPrefix?: string
}

type RequiredSchemaKeys<Properties extends Readonly<Record<string, PluginCapabilitySchema>>, Required> = Extract<
  Required extends readonly string[] ? Required[number] : never,
  keyof Properties
>

/** Static value projection for the SDK's closed, bounded capability schema subset. */
export type PluginCapabilitySchemaValue<Schema extends PluginCapabilitySchema> = Schema extends {
  readonly type: "null"
}
  ? null
  : Schema extends { readonly type: "boolean" }
    ? boolean
    : Schema extends { readonly type: "number" | "integer" }
      ? number
      : Schema extends {
            readonly type: "string"
            readonly enum: readonly (infer EnumValue extends string)[]
          }
        ? EnumValue
        : Schema extends { readonly type: "string" }
          ? string
          : Schema extends {
                readonly type: "array"
                readonly items: infer Item extends PluginCapabilitySchema
              }
            ? readonly PluginCapabilitySchemaValue<Item>[]
            : Schema extends {
                  readonly type: "object"
                  readonly properties: infer Properties extends Readonly<Record<string, PluginCapabilitySchema>>
                  readonly required: infer Required extends readonly string[]
                }
              ? {
                  readonly [Key in RequiredSchemaKeys<Properties, Required>]-?: PluginCapabilitySchemaValue<
                    Properties[Key]
                  >
                } & {
                  readonly [Key in Exclude<
                    keyof Properties,
                    RequiredSchemaKeys<Properties, Required>
                  >]?: PluginCapabilitySchemaValue<Properties[Key]>
                }
              : never

type CapabilityDeclarationOf<Manifest extends PortablePluginManifestV8> = NonNullable<
  Manifest["contributes"]["capabilities"]
>

type CapabilityImportOf<Manifest extends PortablePluginManifestV8> =
  | CapabilityDeclarationOf<Manifest>["imports"]["required"][number]
  | CapabilityDeclarationOf<Manifest>["imports"]["optional"][number]

export type PluginHostImportedCapabilityId<Manifest extends PortablePluginManifestV8> =
  CapabilityImportOf<Manifest>["id"]

type CapabilityImportById<
  Manifest extends PortablePluginManifestV8,
  Id extends PluginHostImportedCapabilityId<Manifest>,
> =
  Extract<CapabilityImportOf<Manifest>, { readonly id: Id }> extends never
    ? CapabilityImportOf<Manifest>
    : Extract<CapabilityImportOf<Manifest>, { readonly id: Id }>

export type PluginHostCapabilityInput<
  Manifest extends PortablePluginManifestV8,
  Id extends PluginHostImportedCapabilityId<Manifest>,
> = PluginCapabilitySchemaValue<CapabilityImportById<Manifest, Id>["inputSchema"]>

export type PluginHostCapabilityOutput<
  Manifest extends PortablePluginManifestV8,
  Id extends PluginHostImportedCapabilityId<Manifest>,
> = PluginCapabilitySchemaValue<CapabilityImportById<Manifest, Id>["outputSchema"]>

type DeclaredApiId<Manifest extends PortablePluginManifestV8> =
  | Manifest["hostApi"]["required"][number]
  | Manifest["hostApi"]["optional"][number]

export type PluginHostDeclaredApiId<Manifest extends PortablePluginManifestV8> =
  PluginApiId extends DeclaredApiId<Manifest> ? PluginApiId : Extract<DeclaredApiId<Manifest>, PluginApiId>

export type PluginHostApiCallArguments<Id extends PluginApiId> = [PluginApiParams<Id>] extends [undefined]
  ? readonly [options?: PluginHostCallOptions]
  : undefined extends PluginApiParams<Id>
    ? readonly [params?: Exclude<PluginApiParams<Id>, undefined>, options?: PluginHostCallOptions]
    : readonly [params: PluginApiParams<Id>, options?: PluginHostCallOptions]

export class PluginHostProtocolError extends Error {
  readonly code:
    | "closed"
    | "invalid-envelope"
    | "invalid-result"
    | "request-id-exhausted"
    | "transport-failed"
    | "unknown-response"

  constructor(code: PluginHostProtocolError["code"], message: string) {
    super(message)
    this.name = "PluginHostProtocolError"
    this.code = code
  }
}

export class PluginHostRemoteError extends Error {
  readonly code: PluginHostRemoteFailure["code"]
  readonly kind: PluginHostRemoteFailure["kind"]
  readonly recoverable: boolean

  constructor(failure: PluginHostRemoteFailure) {
    super(failure.message)
    this.name = "PluginHostRemoteError"
    this.code = failure.code
    this.kind = failure.kind
    this.recoverable = failure.recoverable
  }
}

export class PluginHostAbortError extends Error {
  readonly reason: unknown

  constructor(reason: unknown) {
    super("Plugin Host request was aborted")
    this.name = "AbortError"
    this.reason = reason
  }
}

interface PendingRequest {
  readonly abort?: () => void
  readonly maximumResponseBytes: number
  readonly parseFailure: (failure: PluginHostRemoteFailure) => PluginHostRemoteError
  readonly parseResult: (result: unknown) => unknown
  readonly reject: (error: unknown) => void
  readonly resolve: (value: unknown) => void
}

export interface PluginHostClient<Manifest extends PortablePluginManifestV8> {
  readonly closed: boolean
  callHostApi<Id extends PluginHostDeclaredApiId<Manifest>>(
    method: Id,
    ...args: PluginHostApiCallArguments<Id>
  ): Promise<PluginApiResult<Id>>
  getHostApiAvailability<Id extends PluginHostDeclaredApiId<Manifest>>(
    id: Id,
    options?: PluginHostAvailabilityOptions,
  ): Promise<ApiAvailability<Id>>
  refreshHostApiContext(options?: PluginHostCallOptions): Promise<PluginApiHostContextResult>
  getLocale(options?: PluginHostCallOptions): Promise<PortablePluginLocale>
  requireHostApi<Id extends PluginHostDeclaredApiId<Manifest>>(
    id: Id,
    options?: PluginHostAvailabilityOptions,
  ): Promise<Extract<ApiAvailability<Id>, { available: true }>>
  getCapabilityAvailability<Id extends PluginHostImportedCapabilityId<Manifest>>(
    capabilityId: Id,
    options?: PluginHostCallOptions,
  ): Promise<PluginHostCapabilityAvailability>
  invokeCapability<Id extends PluginHostImportedCapabilityId<Manifest>>(
    capabilityId: Id,
    input: PluginHostCapabilityInput<Manifest, Id>,
    options?: PluginHostCallOptions,
  ): Promise<PluginHostCapabilityOutput<Manifest, Id>>
  onCommand(listener: (command: PluginHostCommand) => void): () => void
  onLocaleChange(listener: (locale: PortablePluginLocale) => void): () => void
  close(): void
}

export interface PluginHostAvailabilityOptions extends PluginHostCallOptions {
  /** Re-read host.context.get instead of using this client's last validated context. */
  readonly refresh?: boolean
}

let clientSequence = 0

function defaultRequestIdPrefix() {
  clientSequence += 1
  return `sdk-${Date.now().toString(36)}-${clientSequence.toString(36)}`
}

function assertRequestIdPrefix(value: string) {
  if (value.length < 1 || value.length > 96 || value !== value.trim() || !/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new TypeError("Plugin Host requestIdPrefix is invalid")
  }
}

function requirementFor(
  manifest: PortablePluginManifestV8,
  capabilityId: string,
): { readonly import: PluginCapabilityImport; readonly requirement: "required" | "optional" } {
  const declaration = manifest.contributes.capabilities
  const required = declaration?.imports.required.find((entry) => entry.id === capabilityId)
  if (required) return { import: required, requirement: "required" }
  const optional = declaration?.imports.optional.find((entry) => entry.id === capabilityId)
  if (optional) return { import: optional, requirement: "optional" }
  throw new TypeError(`Plugin capability import is not declared: ${capabilityId}`)
}

function protocolOrApiFailure(method: PluginApiId, failure: PluginHostRemoteFailure) {
  const parsed =
    failure.kind === "protocol"
      ? parsePluginHostProtocolRemoteFailure(failure)
      : parsePluginApiRemoteFailure(method, failure)
  return new PluginHostRemoteError(parsed)
}

function protocolOrCapabilityFailure(failure: PluginHostRemoteFailure) {
  const parsed =
    failure.kind === "protocol"
      ? parsePluginHostProtocolRemoteFailure(failure)
      : parsePluginCapabilityRemoteFailure(failure)
  return new PluginHostRemoteError(parsed)
}

export function createPluginHostClient<const Manifest extends PortablePluginManifestV8>(
  options: PluginHostClientOptions<Manifest>,
): PluginHostClient<Manifest> {
  const manifest = parsePluginManifestV8(options.manifest)
  if (manifest.entry === undefined || !manifest.hostApi.required.includes("host.context.get")) {
    throw new TypeError("Plugin Host Web client requires an entry and required host.context.get negotiation baseline")
  }
  const prefix = options.requestIdPrefix ?? defaultRequestIdPrefix()
  assertRequestIdPrefix(prefix)

  const pending = new Map<string, PendingRequest>()
  const commandListeners = new Set<(command: PluginHostCommand) => void>()
  const localeListeners = new Set<(locale: PortablePluginLocale) => void>()
  let cachedHostContext: PluginApiHostContextResult | undefined
  let cachedLocale: PortablePluginLocale | undefined
  let localeGeneration = 0
  let pendingHostContextRefresh: Promise<PluginApiHostContextResult> | undefined
  let sequence = 0
  let closed = false

  const rejectPending = (error: unknown) => {
    for (const request of pending.values()) {
      request.abort?.()
      request.reject(error)
    }
    pending.clear()
  }

  const closeWith = (error: PluginHostProtocolError, fatal = true) => {
    if (closed) return
    closed = true
    options.port.removeEventListener("message", onMessage)
    commandListeners.clear()
    localeListeners.clear()
    cachedHostContext = undefined
    cachedLocale = undefined
    pendingHostContextRefresh = undefined
    rejectPending(error)

    // MessagePort.close() does not give the renderer-to-Main connection an
    // observable lifecycle signal. Settle local callers first, then send one
    // closed, sender-scoped control envelope while the port is still usable.
    const disconnect: PluginHostDisconnect = {
      protocol: pluginHostProtocolV8,
      type: "disconnect",
    }
    try {
      assertPluginHostMessageByteLength(disconnect, maximumPluginHostControlBytes, "Plugin Host disconnect")
      post(disconnect)
    } catch {
      // Local disposal must not depend on transport delivery.
    }
    try {
      options.port.close()
    } catch {
      // A broken transport cannot keep the local client alive.
    }
    if (!fatal) return
    try {
      options.onFatalError?.(error)
    } catch {
      // Diagnostic observers do not participate in the transport trust boundary.
    }
  }

  const nextRequestId = () => {
    if (sequence >= Number.MAX_SAFE_INTEGER) {
      const error = new PluginHostProtocolError("request-id-exhausted", "Plugin Host request id space is exhausted")
      closeWith(error)
      throw error
    }
    sequence += 1
    const id = `${prefix}-${sequence.toString(36)}`
    if (!isPluginHostRequestId(id)) {
      const error = new PluginHostProtocolError("request-id-exhausted", "Plugin Host request id is invalid")
      closeWith(error)
      throw error
    }
    return id
  }

  const assertOutgoingSize = (message: unknown, maximumBytes: number) => {
    assertPluginHostMessageByteLength(message, maximumBytes, "Plugin Host request")
  }

  const post = (message: unknown) => {
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- This is a MessagePort-like ABI, not Window.postMessage.
    options.port.postMessage(message)
  }

  const dispatch = <Result>(
    envelope: PluginHostRequest | PluginHostCapabilityInvokeRequest | PluginHostCapabilityAvailabilityRequest,
    parseResult: (result: unknown) => Result,
    limits: {
      readonly maximumRequestBytes: number
      readonly maximumResponseBytes: number
      readonly parseFailure: (failure: PluginHostRemoteFailure) => PluginHostRemoteError
    },
    signal?: PluginHostAbortSignal,
  ): Promise<Result> => {
    if (closed) {
      return Promise.reject(new PluginHostProtocolError("closed", "Plugin Host client is closed"))
    }
    if (signal?.aborted) return Promise.reject(new PluginHostAbortError(signal.reason))
    if (pending.size >= maximumPluginHostInFlightRequests) {
      return Promise.reject(
        new RangeError(`Plugin Host client permits at most ${maximumPluginHostInFlightRequests} in-flight requests`),
      )
    }
    try {
      assertOutgoingSize(envelope, limits.maximumRequestBytes)
    } catch (error) {
      return Promise.reject(error)
    }
    const id = envelope.id
    return new Promise<Result>((resolve, reject) => {
      const abort = signal
        ? () => {
            const current = pending.get(id)
            if (!current) return
            pending.delete(id)
            current.abort?.()
            const cancel: PluginHostCancel = { id, protocol: pluginHostProtocolV8, type: "cancel" }
            try {
              assertOutgoingSize(cancel, maximumPluginCapabilityRequestBytes)
              post(cancel)
            } catch (cause) {
              const error = new PluginHostProtocolError(
                "transport-failed",
                cause instanceof Error ? cause.message : "Plugin Host cancel failed",
              )
              reject(error)
              closeWith(error)
              return
            }
            reject(new PluginHostAbortError(signal.reason))
          }
        : undefined
      const removeAbort = abort
        ? () => {
            signal!.removeEventListener("abort", abort)
          }
        : undefined
      pending.set(id, {
        abort: removeAbort,
        maximumResponseBytes: limits.maximumResponseBytes,
        parseFailure: limits.parseFailure,
        parseResult,
        reject,
        resolve: resolve as (value: unknown) => void,
      })
      if (abort) signal!.addEventListener("abort", abort, { once: true })
      try {
        post(envelope)
      } catch (cause) {
        closeWith(
          new PluginHostProtocolError(
            "transport-failed",
            cause instanceof Error ? cause.message : "Plugin Host transport failed",
          ),
        )
      }
    })
  }

  function onMessage(event: PluginHostMessageEvent) {
    if (closed) return
    let size: number
    try {
      size = assertPluginHostMessageByteLength(event.data, maximumPluginHostResponseBytes, "Plugin Host response")
    } catch {
      closeWith(new PluginHostProtocolError("invalid-envelope", "Plugin Host sent a non-JSON message"))
      return
    }
    if (isPluginHostCommand(event.data)) {
      try {
        if (event.data.command === pluginHostLocaleChangedCommand) {
          if (!isPluginApiDeclared(manifest.hostApi, "host.locale.get")) {
            closeWith(new PluginHostProtocolError("invalid-envelope", "Plugin Host sent an undeclared locale event"))
            return
          }
          if (!isPluginHostLocaleChangedCommand(event.data)) {
            closeWith(new PluginHostProtocolError("invalid-envelope", "Plugin Host sent an invalid locale event"))
            return
          }
          localeGeneration += 1
          cachedLocale = event.data.params.locale
          for (const listener of localeListeners) listener(cachedLocale)
          return
        }
        for (const listener of commandListeners) listener(event.data)
      } catch {
        closeWith(new PluginHostProtocolError("invalid-envelope", "Plugin Host command listener failed"))
      }
      return
    }
    if (!isPluginHostResponse(event.data)) {
      closeWith(new PluginHostProtocolError("invalid-envelope", "Plugin Host sent an invalid envelope"))
      return
    }
    const response = event.data
    const request = pending.get(response.id)
    if (!request) {
      closeWith(
        new PluginHostProtocolError(
          "unknown-response",
          `Plugin Host returned an unknown, duplicate, or late response id: ${response.id}`,
        ),
      )
      return
    }
    if (size > request.maximumResponseBytes) {
      closeWith(
        new PluginHostProtocolError(
          "invalid-envelope",
          `Plugin Host response exceeds ${request.maximumResponseBytes} bytes for this request`,
        ),
      )
      return
    }
    if (!response.ok) {
      try {
        const error = request.parseFailure(response.error)
        pending.delete(response.id)
        request.abort?.()
        request.reject(error)
      } catch (cause) {
        closeWith(
          new PluginHostProtocolError(
            "invalid-result",
            cause instanceof Error ? cause.message : "Plugin Host returned an invalid failure",
          ),
        )
      }
      return
    }
    try {
      const result = request.parseResult(response.result)
      pending.delete(response.id)
      request.abort?.()
      request.resolve(result)
    } catch (cause) {
      closeWith(
        new PluginHostProtocolError(
          "invalid-result",
          cause instanceof Error ? cause.message : "Plugin Host returned an invalid result",
        ),
      )
    }
  }

  options.port.addEventListener("message", onMessage)
  options.port.start?.()

  const callHostApiRuntime = (method: PluginApiId, args: readonly unknown[]): Promise<unknown> => {
    if (!isPluginApiDeclared(manifest.hostApi, method)) {
      return Promise.reject(new TypeError(`Plugin Host API is not declared: ${method}`))
    }
    const contract = pluginApiMethodContracts[method]
    const params = contract.params.type === "none" ? undefined : args[0]
    const callOptions = (contract.params.type === "none" ? args[0] : args[1]) as PluginHostCallOptions | undefined
    let parsedParams: unknown
    try {
      const parseParams = parsePluginApiParams as (id: PluginApiId, value: unknown) => unknown
      parsedParams = parseParams(method, params)
    } catch (error) {
      return Promise.reject(error)
    }
    const id = nextRequestId()
    const envelope = {
      id,
      method,
      ...(parsedParams === undefined ? {} : { params: parsedParams }),
      protocol: pluginHostProtocolV8,
      type: "request",
    } as unknown as PluginHostRequest
    const wire = getPluginApiWireContract(method)
    const parseResult = parsePluginApiResult as (id: PluginApiId, value: unknown) => unknown
    return dispatch(
      envelope,
      (result) => {
        const parsed = parseResult(method, result)
        if (method === "host.context.get") {
          cachedHostContext = parsed as PluginApiHostContextResult
        }
        return parsed
      },
      {
        maximumRequestBytes: wire.request.maxBytes,
        maximumResponseBytes: wire.result.maxBytes,
        parseFailure: (failure) => {
          const error = protocolOrApiFailure(method, failure)
          if (error.kind === "api" && error.code === "stale-context") cachedHostContext = undefined
          return error
        },
      },
      callOptions?.signal,
    )
  }

  const client: PluginHostClient<Manifest> = {
    get closed() {
      return closed
    },
    callHostApi(method, ...args) {
      return callHostApiRuntime(method, args) as Promise<PluginApiResult<typeof method>>
    },
    async getHostApiAvailability(apiId, availabilityOptions) {
      if (!isPluginApiDeclared(manifest.hostApi, apiId)) {
        throw new TypeError(`Plugin Host API is not declared: ${apiId}`)
      }
      const context =
        !cachedHostContext || availabilityOptions?.refresh
          ? await client.refreshHostApiContext(availabilityOptions)
          : cachedHostContext
      const definition = getPluginApiDefinition(apiId)
      return (context.hostApi.availability.find(({ id }) => id === apiId) ?? {
        available: false,
        contractSince: definition.contractSince,
        id: apiId,
        reason: "unsupported-host",
        recoverable: false,
        since: definition.since,
      }) as ApiAvailability<typeof apiId>
    },
    async getLocale(callOptions) {
      const generation = localeGeneration
      const result = (await callHostApiRuntime("host.locale.get", [callOptions])) as PluginApiHostLocaleResult
      if (generation !== localeGeneration && cachedLocale !== undefined) return cachedLocale
      cachedLocale = parsePortablePluginLocale(result.locale, "Plugin Host locale result")
      return cachedLocale
    },
    refreshHostApiContext(callOptions) {
      cachedHostContext = undefined
      if (pendingHostContextRefresh) return pendingHostContextRefresh
      const refresh = callHostApiRuntime("host.context.get", [callOptions]) as Promise<PluginApiHostContextResult>
      const tracked = refresh.finally(() => {
        if (pendingHostContextRefresh === tracked) pendingHostContextRefresh = undefined
      })
      pendingHostContextRefresh = tracked
      return pendingHostContextRefresh
    },
    async requireHostApi(apiId, availabilityOptions) {
      const availability = await client.getHostApiAvailability(apiId, availabilityOptions)
      if (!availability.available) throw new PluginApiUnavailableError(availability)
      return availability
    },
    getCapabilityAvailability(capabilityId, callOptions) {
      let imported: ReturnType<typeof requirementFor>
      try {
        imported = requirementFor(manifest, capabilityId)
      } catch (error) {
        return Promise.reject(error)
      }
      const id = nextRequestId()
      const envelope: PluginHostCapabilityAvailabilityRequest = {
        capabilityId,
        id,
        protocol: pluginHostProtocolV8,
        type: "capability-availability",
      }
      return dispatch(
        envelope,
        (result) => {
          const availability = parsePluginHostCapabilityAvailability(result)
          if (availability.capabilityId !== capabilityId || availability.requirement !== imported.requirement) {
            throw new TypeError("Plugin capability availability does not match the declared import")
          }
          return availability
        },
        {
          maximumRequestBytes: maximumPluginCapabilityRequestBytes,
          maximumResponseBytes: maximumPluginCapabilityResponseBytes,
          parseFailure: protocolOrCapabilityFailure,
        },
        callOptions?.signal,
      )
    },
    invokeCapability(capabilityId, input, callOptions) {
      let imported: ReturnType<typeof requirementFor>
      try {
        imported = requirementFor(manifest, capabilityId)
        assertPluginCapabilityValue(imported.import.inputSchema, input, `Plugin capability ${capabilityId} input`)
      } catch (error) {
        return Promise.reject(error)
      }
      const id = nextRequestId()
      const envelope: PluginHostCapabilityInvokeRequest = {
        capabilityId,
        id,
        input,
        protocol: pluginHostProtocolV8,
        type: "capability-invoke",
      }
      return dispatch(
        envelope,
        (result) => {
          assertPluginCapabilityValue(imported.import.outputSchema, result, `Plugin capability ${capabilityId} output`)
          return result as PluginCapabilitySchemaValue<PluginCapabilityObjectSchema>
        },
        {
          maximumRequestBytes: maximumPluginCapabilityRequestBytes,
          maximumResponseBytes: maximumPluginCapabilityResponseBytes,
          parseFailure: protocolOrCapabilityFailure,
        },
        callOptions?.signal,
      ) as ReturnType<PluginHostClient<Manifest>["invokeCapability"]>
    },
    onCommand(listener) {
      if (closed) throw new PluginHostProtocolError("closed", "Plugin Host client is closed")
      if (commandListeners.size >= 64) throw new RangeError("Plugin Host command listener limit exceeded")
      commandListeners.add(listener)
      return () => {
        commandListeners.delete(listener)
      }
    },
    onLocaleChange(listener) {
      if (closed) throw new PluginHostProtocolError("closed", "Plugin Host client is closed")
      if (!isPluginApiDeclared(manifest.hostApi, "host.locale.get")) {
        throw new TypeError("Plugin Host API is not declared: host.locale.get")
      }
      if (localeListeners.size >= 64) throw new RangeError("Plugin Host locale listener limit exceeded")
      localeListeners.add(listener)
      return () => {
        localeListeners.delete(listener)
      }
    },
    close() {
      closeWith(new PluginHostProtocolError("closed", "Plugin Host client was closed"), false)
    },
  }
  return client
}
