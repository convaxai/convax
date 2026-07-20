export const desktopPluginHostProtocolV1 = "convax.plugin-host/1" as const
export const desktopPluginHostProtocolV2 = "convax.plugin-host/2" as const
/** Backwards-compatible name for the original static Plugin protocol. */
export const desktopPluginHostProtocol = desktopPluginHostProtocolV1
export const desktopPluginConnectedImagesChangedCommand = "canvas.connectedImages.changed"

export type DesktopPluginHostProtocol =
  | typeof desktopPluginHostProtocolV1
  | typeof desktopPluginHostProtocolV2

export type DesktopPluginHostMethodV1 =
  | "host.context.get"
  | "canvas.connectedImages.list"
  | "canvas.connectedImage.read"
  | "canvas.node.get"
  | "canvas.node.updateState"
  | "project.file.readText"
  | "agent.prompt"

export type DesktopPluginHostMethodV2 =
  | DesktopPluginHostMethodV1
  | "generation.tools.list"
  | "generation.canvas.execute"

export type DesktopPluginHostMethod = DesktopPluginHostMethodV2

export interface DesktopPluginHostRequest {
  id: string
  method: DesktopPluginHostMethod
  params?: unknown
  protocol: DesktopPluginHostProtocol
  type: "request"
}

export type DesktopPluginHostResponse = {
  id: string
  ok: true
  protocol: DesktopPluginHostProtocol
  result: unknown
  type: "response"
} | {
  error: string
  id: string
  ok: false
  protocol: DesktopPluginHostProtocol
  type: "response"
}

export interface DesktopPluginHostCommand {
  command: string
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
  "canvas.node.get",
  "canvas.node.updateState",
  "project.file.readText",
  "agent.prompt",
])

const methodsV2 = new Set<DesktopPluginHostMethodV2>([
  ...methodsV1,
  "generation.tools.list",
  "generation.canvas.execute",
])

export function desktopPluginHostProtocolForManifestSchema(
  schema: "convax.plugin/1" | "convax.plugin/2",
): DesktopPluginHostProtocol {
  return schema === "convax.plugin/2" ? desktopPluginHostProtocolV2 : desktopPluginHostProtocolV1
}

export function isDesktopPluginHostProtocol(value: unknown): value is DesktopPluginHostProtocol {
  return value === desktopPluginHostProtocolV1 || value === desktopPluginHostProtocolV2
}

export function isDesktopPluginHostRequest(value: unknown): value is DesktopPluginHostRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  if (
    request.type !== "request"
    || typeof request.id !== "string"
    || request.id.length === 0
    || request.id.length > 128
    || typeof request.method !== "string"
    || !isDesktopPluginHostProtocol(request.protocol)
  ) return false
  return request.protocol === desktopPluginHostProtocolV1
    ? methodsV1.has(request.method as DesktopPluginHostMethodV1)
    : methodsV2.has(request.method as DesktopPluginHostMethodV2)
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
