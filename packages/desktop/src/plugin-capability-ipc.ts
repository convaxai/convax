import type { DesktopPluginHostCommand, DesktopPluginHostResponse } from "./plugin-host-protocol"

export const pluginCapabilityIpcChannels = {
  call: "plugin:capability-call",
  changed: "plugin:capability-event",
  connect: "plugin:capability-connect",
  disconnect: "plugin:capability-disconnect",
} as const

export interface PluginCapabilityConnectInput {
  pluginId: string
  pluginVersion: string
  /** Presentation context; a projects.read grant may widen the issued connection. */
  projectId: string
  runtime: "web"
}

export interface PluginCapabilityConnectResult {
  connectionId: string
  protocol: "convax.plugin-capability/1"
}

export interface PluginCapabilityCallInput {
  connectionId: string
  request: unknown
}

export interface PluginCapabilityDisconnectInput {
  connectionId: string
}

export interface PluginCapabilityEvent {
  command: DesktopPluginHostCommand
  connectionId: string
}

export interface PluginCapabilityRendererClient {
  call(input: PluginCapabilityCallInput): Promise<DesktopPluginHostResponse | null>
  connect(input: PluginCapabilityConnectInput): Promise<PluginCapabilityConnectResult>
  disconnect(input: PluginCapabilityDisconnectInput): Promise<boolean>
  onEvent(listener: (event: PluginCapabilityEvent) => void): () => void
}
