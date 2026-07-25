export const desktopPluginHostProtocolV1 = "convax.plugin-host/1" as const
export const desktopPluginHostProtocolV2 = "convax.plugin-host/2" as const
export const desktopPluginHostProtocolV3 = "convax.plugin-host/3" as const
export const desktopPluginHostProtocolV4 = "convax.plugin-host/4" as const
/**
 * Transport-neutral capability protocol introduced with manifest v5. Unlike
 * legacy plugin-host/1-4, future manifest schemas may negotiate this protocol
 * independently instead of creating another Web-host protocol version.
 */
export const pluginCapabilityProtocolV1 = "convax.plugin-capability/1" as const
/** Compatibility name for callers that still index protocols by manifest generation. */
export const desktopPluginHostProtocolV5 = pluginCapabilityProtocolV1
/** Backwards-compatible name for the original static Plugin protocol. */
export const desktopPluginHostProtocol = desktopPluginHostProtocolV1
export const desktopPluginConnectedImagesChangedCommand = "canvas.connectedImages.changed"
export const desktopPluginConnectedInputsChangedCommand = "canvas.connectedInputs.changed"
export const pluginCanvasDocumentChangedCommand = "canvas.document.changed"

export type DesktopPluginHostProtocol =
  | typeof desktopPluginHostProtocolV1
  | typeof desktopPluginHostProtocolV2
  | typeof desktopPluginHostProtocolV3
  | typeof desktopPluginHostProtocolV4
  | typeof desktopPluginHostProtocolV5

export type DesktopPluginHostMethodV1 =
  | "host.context.get"
  | "canvas.connectedImages.list"
  | "canvas.connectedImage.read"
  | "canvas.connectedInputs.list"
  | "canvas.node.get"
  | "canvas.node.updateState"
  | "canvas.image.create"
  | "project.file.readText"
  | "agent.prompt"

export type DesktopPluginHostMethodV2 =
  | DesktopPluginHostMethodV1
  | "generation.tools.list"
  | "generation.canvas.execute"

export type DesktopPluginHostMethodV3 = DesktopPluginHostMethodV2
export type DesktopPluginHostMethodV4 = DesktopPluginHostMethodV3
export type DesktopPluginHostMethodV5 =
  | DesktopPluginHostMethodV4
  | "projects.list"
  | "canvas.catalog.list"
  | "canvas.document.get"
  | "canvas.nodes.query"
  | "canvas.transaction.execute"
  | "canvas.events.subscribe"
  | "canvas.events.unsubscribe"

export type DesktopPluginHostMethod = DesktopPluginHostMethodV5

export interface DesktopPluginHostRequest {
  id: string
  method: DesktopPluginHostMethod
  params?: unknown
  protocol: DesktopPluginHostProtocol
  type: "request"
}

export type DesktopPluginHostResponse =
  | {
      id: string
      ok: true
      protocol: DesktopPluginHostProtocol
      result: unknown
      type: "response"
    }
  | {
      error: string
      id: string
      ok: false
      protocol: DesktopPluginHostProtocol
      type: "response"
    }

export interface DesktopPluginHostCommand {
  command: string
  params?: unknown
  protocol: DesktopPluginHostProtocol
  type: "command"
}

export interface DesktopPluginHostConnect {
  pluginId: string
  protocol: DesktopPluginHostProtocol
  type: "connect"
}

const methodsV1 = new Set<DesktopPluginHostMethodV1>([
  "host.context.get",
  "canvas.connectedImages.list",
  "canvas.connectedImage.read",
  "canvas.connectedInputs.list",
  "canvas.node.get",
  "canvas.node.updateState",
  "canvas.image.create",
  "project.file.readText",
  "agent.prompt",
])

const methodsV2 = new Set<DesktopPluginHostMethodV2>([
  ...methodsV1,
  "generation.tools.list",
  "generation.canvas.execute",
])

const methodsV3 = new Set<DesktopPluginHostMethodV3>(methodsV2)
const methodsV4 = new Set<DesktopPluginHostMethodV4>(methodsV3)
const methodsV5 = new Set<DesktopPluginHostMethodV5>([
  ...methodsV4,
  "projects.list",
  "canvas.catalog.list",
  "canvas.document.get",
  "canvas.nodes.query",
  "canvas.transaction.execute",
  "canvas.events.subscribe",
  "canvas.events.unsubscribe",
])

export function desktopPluginHostProtocolForManifestSchema(
  schema:
    | "convax.plugin/1"
    | "convax.plugin/2"
    | "convax.plugin/3"
    | "convax.plugin/4"
    | "convax.plugin/5"
    | "convax.plugin/6"
    | "convax.plugin/7",
): DesktopPluginHostProtocol {
  return schema === "convax.plugin/5" || schema === "convax.plugin/6" || schema === "convax.plugin/7"
    ? desktopPluginHostProtocolV5
    : schema === "convax.plugin/4"
      ? desktopPluginHostProtocolV4
      : schema === "convax.plugin/3"
        ? desktopPluginHostProtocolV3
        : schema === "convax.plugin/2"
          ? desktopPluginHostProtocolV2
          : desktopPluginHostProtocolV1
}

export function isDesktopPluginHostProtocol(value: unknown): value is DesktopPluginHostProtocol {
  return (
    value === desktopPluginHostProtocolV1 ||
    value === desktopPluginHostProtocolV2 ||
    value === desktopPluginHostProtocolV3 ||
    value === desktopPluginHostProtocolV4 ||
    value === desktopPluginHostProtocolV5
  )
}

export function isDesktopPluginHostRequest(value: unknown): value is DesktopPluginHostRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  if (
    request.type !== "request" ||
    typeof request.id !== "string" ||
    request.id.length === 0 ||
    request.id.length > 128 ||
    typeof request.method !== "string" ||
    !isDesktopPluginHostProtocol(request.protocol)
  )
    return false
  return request.protocol === desktopPluginHostProtocolV1
    ? methodsV1.has(request.method as DesktopPluginHostMethodV1)
    : request.protocol === desktopPluginHostProtocolV2
      ? methodsV2.has(request.method as DesktopPluginHostMethodV2)
      : request.protocol === desktopPluginHostProtocolV3
        ? methodsV3.has(request.method as DesktopPluginHostMethodV3)
        : request.protocol === desktopPluginHostProtocolV4
          ? methodsV4.has(request.method as DesktopPluginHostMethodV4)
          : methodsV5.has(request.method as DesktopPluginHostMethodV5)
}

export function pluginHostSuccess(
  id: string,
  result: unknown,
  protocol: DesktopPluginHostProtocol = desktopPluginHostProtocolV1,
): DesktopPluginHostResponse {
  return { id, ok: true, protocol, result, type: "response" }
}

export function pluginHostFailure(
  id: string,
  error: unknown,
  protocol: DesktopPluginHostProtocol = desktopPluginHostProtocolV1,
): DesktopPluginHostResponse {
  return {
    error: error instanceof Error ? error.message : String(error),
    id,
    ok: false,
    protocol,
    type: "response",
  }
}
