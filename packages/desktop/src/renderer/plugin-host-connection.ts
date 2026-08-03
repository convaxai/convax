import { getPluginApiWireContract, isPluginApiId } from "@convax/plugin-api"
import {
  assertPluginHostMessageByteLength,
  isPluginHostCancel,
  isPluginHostDisconnect,
  isPluginHostRequestId,
  maximumPluginHostControlBytes,
  maximumPluginCapabilityRequestBytes,
  maximumPluginHostInFlightRequests,
  maximumPluginHostRequestBytes,
} from "@convax/plugin-sdk/client"
import type { PluginCapabilityConnectInput, PluginCapabilityRendererClient } from "../plugin-capability-ipc"
import { PluginHostProtocolError } from "../plugin-host-errors"
import {
  desktopPluginHostProtocolV8,
  isDesktopPluginCapabilityAvailabilityRequest,
  isDesktopPluginCapabilityInvokeRequest,
  isDesktopPluginHostRequest,
  pluginCapabilityProtocolV3,
  pluginHostFailure,
  pluginHostSuccess,
  type DesktopPluginHostCommand,
  type DesktopPluginHostResponse,
  type PluginCapabilityResponse,
} from "../plugin-host-protocol"

interface ActivePluginHostRequest {
  controller: AbortController
  operationId: string
}

/**
 * Renderer adapter for one principal-bound main connection. It contains no
 * Canvas or Web-node policy; a Web MessagePort is merely one possible sink.
 */
export class RendererPluginHostConnection {
  private closed = false
  private closePromise: Promise<boolean> | undefined
  private readonly activeRequests = new Map<string, ActivePluginHostRequest>()
  private connectionId: string | undefined
  private readonly connectPromise: Promise<string>
  private readonly requestOperationIds = new Map<string, string>()
  private unsubscribe: () => void = () => undefined

  constructor(
    private readonly client: PluginCapabilityRendererClient,
    input: PluginCapabilityConnectInput,
    private readonly onCommand: (command: DesktopPluginHostCommand) => void,
  ) {
    this.connectPromise = client.connect(input).then(({ connectionId, protocol }) => {
      if (protocol !== pluginCapabilityProtocolV3) {
        void client.disconnect({ connectionId }).catch(() => undefined)
        throw new PluginHostProtocolError("transport-closed", "Plugin capability protocol mismatch")
      }
      this.connectionId = connectionId
      return connectionId
    })
    void this.connectPromise.catch(() => undefined)
    this.unsubscribe = client.onEvent((event) => {
      if (this.closed || event.connectionId !== this.connectionId) return
      if (event.command.protocol !== pluginCapabilityProtocolV3) {
        this.close()
        return
      }
      this.onCommand({
        ...event.command,
        protocol: desktopPluginHostProtocolV8,
      })
    })
  }

  async dispatch(request: unknown, signal?: AbortSignal): Promise<DesktopPluginHostResponse | null> {
    const id = requestId(request)
    const disconnectIntent = hasDisconnectType(request)
    try {
      const requestBytes = preflightWebRequest(request)
      assertMaximumBytes(requestBytes, maximumRequestBytesForEnvelope(request))
      if (disconnectIntent) {
        // A malformed lifecycle envelope cannot fall through into a callable
        // surface. Both valid and hostile forms fail closed on this exact
        // sender-scoped connection and carry no routing identity.
        if (!isPluginHostDisconnect(request)) {
          await this.closeAndWait().catch(() => undefined)
          return null
        }
        await this.closeAndWait().catch(() => undefined)
        return null
      }
      if (isPluginHostCancel(request)) {
        if (this.closed) return null
        const active = this.activeRequests.get(request.id)
        if (active && !active.controller.signal.aborted) {
          active.controller.abort(new DOMException("Plugin request was canceled", "AbortError"))
        }
        return null
      }
      if (this.closed) {
        throw new PluginHostProtocolError("transport-closed", "Plugin capability connection was closed")
      }
      throwIfAborted(signal)
      const hostRequest = isDesktopPluginHostRequest(request) ? request : null
      const invokeRequest = isDesktopPluginCapabilityInvokeRequest(request) ? request : null
      const availabilityRequest = isDesktopPluginCapabilityAvailabilityRequest(request) ? request : null
      if (!hostRequest && !invokeRequest && !availabilityRequest) {
        throw new PluginHostProtocolError("invalid-request", "Invalid Plugin host request")
      }
      const requestId = hostRequest?.id ?? invokeRequest?.id ?? availabilityRequest!.id
      if (this.activeRequests.has(requestId)) {
        throw new PluginHostProtocolError("invalid-request", "Plugin host request id is already in flight")
      }
      if (this.activeRequests.size >= maximumPluginHostInFlightRequests) {
        throw new PluginHostProtocolError(
          "overloaded",
          `Plugin host connection permits at most ${maximumPluginHostInFlightRequests} in-flight requests`,
        )
      }
      const operationId = this.operationId(requestId)
      const requestController = new AbortController()
      const active = { controller: requestController, operationId }
      this.activeRequests.set(requestId, active)
      try {
        const requestSignal = signal ? AbortSignal.any([signal, requestController.signal]) : requestController.signal
        const connectionId = await this.connectPromise
        throwIfAborted(requestSignal)
        const cancel = () => {
          void this.client.cancel({ connectionId, operationId }).catch(() => undefined)
        }
        requestSignal.addEventListener("abort", cancel, { once: true })
        try {
          const response = availabilityRequest
            ? pluginHostSuccess(
                availabilityRequest.id,
                await this.client.getPluginAvailability({
                  capabilityId: availabilityRequest.capabilityId,
                  connectionId,
                  operationId,
                }),
              )
            : await (invokeRequest
                ? this.client
                    .invokePlugin({
                      connectionId,
                      operationId,
                      request: {
                        capabilityId: invokeRequest.capabilityId,
                        input: invokeRequest.input,
                        requestId: invokeRequest.id,
                      },
                    })
                    .then(translateCapabilityResponse)
                : this.client
                    .call({
                      connectionId,
                      operationId,
                      request: {
                        ...hostRequest!,
                        protocol: pluginCapabilityProtocolV3,
                      },
                    })
                    .then(translateCapabilityResponse))
          if (requestController.signal.aborted) return null
          throwIfAborted(signal)
          return response
        } catch (error) {
          if (requestController.signal.aborted) return null
          throw error
        } finally {
          requestSignal.removeEventListener("abort", cancel)
        }
      } finally {
        if (this.activeRequests.get(requestId) === active) {
          this.activeRequests.delete(requestId)
        }
      }
    } catch (error) {
      if (disconnectIntent) {
        await this.closeAndWait().catch(() => undefined)
        return null
      }
      if (!id) return null
      return pluginHostFailure(id, error)
    }
  }

  close() {
    void this.closeAndWait().catch(() => undefined)
  }

  private closeAndWait() {
    if (this.closePromise) return this.closePromise
    this.closed = true
    this.unsubscribe()
    for (const request of this.activeRequests.values()) {
      if (!request.controller.signal.aborted) {
        request.controller.abort(new Error("Plugin capability connection was closed"))
      }
    }
    this.activeRequests.clear()
    this.closePromise = this.disconnectExactConnection()
    return this.closePromise
  }

  private async disconnectExactConnection() {
    let connectionId = this.connectionId
    if (!connectionId) {
      try {
        connectionId = await this.connectPromise
      } catch {
        return false
      }
    }
    return this.client.disconnect({ connectionId })
  }

  private operationId(requestId: string) {
    const existing = this.requestOperationIds.get(requestId)
    if (existing) return existing
    const operationId = globalThis.crypto.randomUUID()
    if (this.requestOperationIds.size >= 1_024) {
      this.requestOperationIds.delete(this.requestOperationIds.keys().next().value!)
    }
    this.requestOperationIds.set(requestId, operationId)
    return operationId
  }
}

function translateCapabilityResponse(response: PluginCapabilityResponse | null): DesktopPluginHostResponse | null {
  if (!response) return null
  if (response.protocol !== pluginCapabilityProtocolV3) {
    throw new PluginHostProtocolError("internal-error", "Plugin capability response protocol mismatch")
  }
  return {
    ...response,
    protocol: desktopPluginHostProtocolV8,
  }
}

function assertMaximumBytes(actualBytes: number, maximumBytes: number) {
  if (actualBytes > maximumBytes) {
    throw new PluginHostProtocolError("invalid-request", `Plugin capability request exceeds ${maximumBytes} bytes`)
  }
}

function preflightWebRequest(value: unknown) {
  try {
    return assertPluginHostMessageByteLength(value, maximumPluginHostRequestBytes, "Plugin Host Web request")
  } catch (cause) {
    throw new PluginHostProtocolError(
      "invalid-request",
      cause instanceof Error ? cause.message : "Plugin Host Web request is invalid",
    )
  }
}

function maximumRequestBytesForEnvelope(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return maximumPluginCapabilityRequestBytes
  }
  const type = Reflect.get(value, "type")
  const method = Reflect.get(value, "method")
  if (type === "disconnect") return maximumPluginHostControlBytes
  return type === "request" && isPluginApiId(method)
    ? getPluginApiWireContract(method).request.maxBytes
    : maximumPluginCapabilityRequestBytes
}

function hasDisconnectType(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "type")
    return Boolean(descriptor && "value" in descriptor && descriptor.value === "disconnect")
  } catch {
    return false
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw new DOMException("Plugin Host API request was canceled", "AbortError")
}

function requestId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const id = Reflect.get(value, "id")
  return isPluginHostRequestId(id) ? id : null
}
