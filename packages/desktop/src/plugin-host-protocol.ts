import { pluginApiCatalog, type PluginApiId } from "@convax/plugin-api"
import {
  isPluginHostCapabilityAvailabilityRequest,
  isPluginHostCapabilityInvokeRequest,
  isPluginHostCommand,
  isPluginHostConnect,
  isPluginHostRequest,
  isPluginHostResponse,
  pluginHostFailure as sdkPluginHostFailure,
  pluginHostProtocolV8,
  pluginHostSuccess as sdkPluginHostSuccess,
  type PluginHostCapabilityAvailabilityRequest,
  type PluginHostCapabilityInvokeRequest,
  type PluginHostCommand,
  type PluginHostConnect,
  type PluginHostRequest,
  type PluginHostResponse,
  type PluginHostRemoteFailure,
} from "@convax/plugin-sdk/client"
import {
  pluginHostApiRemoteFailure,
  pluginHostProtocolRemoteFailure,
} from "./plugin-host-errors"

/**
 * Sandboxed iframe/Web MessagePort ABI.
 *
 * This protocol is intentionally independent from the renderer-to-main
 * principal transport below. Host API additions are versioned by the
 * @convax/plugin-api Catalog rather than by another transport token.
 */
export const desktopPluginHostProtocolV8 = pluginHostProtocolV8
export type DesktopPluginHostProtocol = typeof desktopPluginHostProtocolV8

/**
 * Principal-bound renderer/main and verified-sidecar transport.
 *
 * This is not an alias for the iframe ABI. The renderer adapter translates
 * between the two envelopes at the process boundary.
 */
export const pluginCapabilityProtocolV3 = "convax.plugin-capability/3" as const
export type PluginCapabilityProtocol = typeof pluginCapabilityProtocolV3

export const desktopPluginConnectedImagesChangedCommand = "canvas.connectedImages.changed"
export const desktopPluginConnectedInputsChangedCommand = "canvas.connectedInputs.changed"
export const pluginCanvasInputsChangedCommand = "canvas.inputs.changed"
export const pluginCanvasDocumentChangedCommand = "canvas.document.changed"

export type DesktopPluginHostMethod = PluginApiId

interface PluginCapabilityProtocolRequest {
  id: string
  method: DesktopPluginHostMethod
  params?: unknown
  protocol: PluginCapabilityProtocol
  type: "request"
}

type PluginCapabilityProtocolResponse =
  | {
      id: string
      ok: true
      protocol: PluginCapabilityProtocol
      result: unknown
      type: "response"
    }
  | {
      error: PluginHostRemoteFailure
      id: string
      ok: false
      protocol: PluginCapabilityProtocol
      type: "response"
    }

interface PluginCapabilityProtocolCommand {
  command: string
  params?: unknown
  protocol: PluginCapabilityProtocol
  type: "command"
}

export type DesktopPluginHostRequest = PluginHostRequest
export type DesktopPluginHostResponse = PluginHostResponse
export type DesktopPluginHostCommand = PluginHostCommand
export type DesktopPluginHostConnect = PluginHostConnect
export type DesktopPluginCapabilityInvokeRequest = PluginHostCapabilityInvokeRequest
export type DesktopPluginCapabilityAvailabilityRequest = PluginHostCapabilityAvailabilityRequest

export type PluginCapabilityRequest = PluginCapabilityProtocolRequest
export type PluginCapabilityResponse = PluginCapabilityProtocolResponse
export type PluginCapabilityCommand = PluginCapabilityProtocolCommand

export const isDesktopPluginHostConnect = isPluginHostConnect
export const isDesktopPluginHostRequest = isPluginHostRequest
export const isDesktopPluginHostResponse = isPluginHostResponse
export const isDesktopPluginHostCommand = isPluginHostCommand
export const isDesktopPluginCapabilityInvokeRequest = isPluginHostCapabilityInvokeRequest
export const isDesktopPluginCapabilityAvailabilityRequest = isPluginHostCapabilityAvailabilityRequest
export const pluginHostSuccess = sdkPluginHostSuccess
export function pluginHostFailure(id: string, error: unknown): DesktopPluginHostResponse {
  return sdkPluginHostFailure(id, pluginHostProtocolRemoteFailure(error))
}

const hostApiMethods = new Set<DesktopPluginHostMethod>(pluginApiCatalog.apis.map((definition) => definition.id))

function isPrincipalProtocolRequest(value: unknown): value is PluginCapabilityProtocolRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  return (
    request.type === "request" &&
    typeof request.id === "string" &&
    request.id.length > 0 &&
    request.id.length <= 128 &&
    request.protocol === pluginCapabilityProtocolV3 &&
    typeof request.method === "string" &&
    hostApiMethods.has(request.method as DesktopPluginHostMethod)
  )
}

export function isPluginCapabilityRequest(value: unknown): value is PluginCapabilityRequest {
  return isPrincipalProtocolRequest(value)
}

export function pluginCapabilitySuccess(id: string, result: unknown): PluginCapabilityResponse {
  return { id, ok: true, protocol: pluginCapabilityProtocolV3, result, type: "response" }
}

export function pluginCapabilityFailure(
  id: string,
  error: PluginHostRemoteFailure,
): PluginCapabilityResponse {
  return {
    error,
    id,
    ok: false,
    protocol: pluginCapabilityProtocolV3,
    type: "response",
  }
}

export function pluginCapabilityApiFailure(
  id: string,
  method: PluginApiId,
  error: unknown,
): PluginCapabilityResponse {
  return pluginCapabilityFailure(id, pluginHostApiRemoteFailure(method, error))
}

export function pluginCapabilityProtocolFailure(
  id: string,
  error: unknown,
): PluginCapabilityResponse {
  return pluginCapabilityFailure(id, pluginHostProtocolRemoteFailure(error))
}
