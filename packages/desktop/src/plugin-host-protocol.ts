export const desktopPluginHostProtocol = "convax.plugin-host/1"
export const desktopPluginConnectedImagesChangedCommand = "canvas.connectedImages.changed"

export type DesktopPluginHostMethod =
  | "host.context.get"
  | "canvas.connectedImages.list"
  | "canvas.connectedImage.read"
  | "canvas.node.get"
  | "canvas.node.updateState"
  | "project.file.readText"
  | "agent.prompt"

export interface DesktopPluginHostRequest {
  id: string
  method: DesktopPluginHostMethod
  params?: unknown
  protocol: typeof desktopPluginHostProtocol
  type: "request"
}

export type DesktopPluginHostResponse = {
  id: string
  ok: true
  protocol: typeof desktopPluginHostProtocol
  result: unknown
  type: "response"
} | {
  error: string
  id: string
  ok: false
  protocol: typeof desktopPluginHostProtocol
  type: "response"
}

export interface DesktopPluginHostCommand {
  command: string
  protocol: typeof desktopPluginHostProtocol
  type: "command"
}

export interface DesktopPluginHostConnect {
  pluginId: string
  protocol: typeof desktopPluginHostProtocol
  type: "connect"
}

const methods = new Set<DesktopPluginHostMethod>([
  "host.context.get",
  "canvas.connectedImages.list",
  "canvas.connectedImage.read",
  "canvas.node.get",
  "canvas.node.updateState",
  "project.file.readText",
  "agent.prompt",
])

export function isDesktopPluginHostRequest(value: unknown): value is DesktopPluginHostRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  return request.protocol === desktopPluginHostProtocol
    && request.type === "request"
    && typeof request.id === "string"
    && request.id.length > 0
    && request.id.length <= 128
    && typeof request.method === "string"
    && methods.has(request.method as DesktopPluginHostMethod)
}

export function pluginHostSuccess(id: string, result: unknown): DesktopPluginHostResponse {
  return { id, ok: true, protocol: desktopPluginHostProtocol, result, type: "response" }
}

export function pluginHostFailure(id: string, error: unknown): DesktopPluginHostResponse {
  return {
    error: error instanceof Error ? error.message : String(error),
    id,
    ok: false,
    protocol: desktopPluginHostProtocol,
    type: "response",
  }
}
