import type {
  PluginCapabilityCommand,
  PluginCapabilityProtocol,
  PluginCapabilityResponse,
} from "./plugin-host-protocol"

export const pluginCapabilityIpcChannels = {
  cancel: "plugin:capability-cancel",
  call: "plugin:capability-call",
  changed: "plugin:capability-event",
  connect: "plugin:capability-connect",
  disconnect: "plugin:capability-disconnect",
  getPluginAvailability: "plugin:capability-plugin-availability",
  invokePlugin: "plugin:capability-invoke-plugin",
} as const

export interface PluginCapabilityConnectInput {
  activeRevision: number
  activeSetDigest: string
  canvasId: string
  nodeId: string
  pluginId: string
  pluginVersion: string
  /** Owning Project; a projects.read grant may widen only Catalog APIs. */
  projectId: string
  runtime: "web"
  snapshotDigest: string
}

export interface PluginCapabilityConnectResult {
  connectionId: string
  protocol: PluginCapabilityProtocol
}

export interface PluginCapabilityCallInput {
  connectionId: string
  operationId: string
  request: unknown
}

export interface PluginCapabilityCancelInput {
  connectionId: string
  operationId: string
}

/**
 * Independent Plugin-to-Plugin broker ingress. `request` deliberately carries
 * no principal, provider Plugin id, or Host API method.
 */
export interface PluginCapabilityInvokePluginInput {
  connectionId: string
  operationId: string
  request: {
    capabilityId: string
    input: unknown
    requestId: string
  }
}

export interface PluginCapabilityGetPluginAvailabilityInput {
  capabilityId: string
  connectionId: string
  operationId: string
}

export interface PluginCapabilityDisconnectInput {
  connectionId: string
}

export interface PluginCapabilityEvent {
  command: PluginCapabilityCommand
  connectionId: string
}

export interface PluginCapabilityRendererClient {
  cancel(input: PluginCapabilityCancelInput): Promise<boolean>
  call(input: PluginCapabilityCallInput): Promise<PluginCapabilityResponse | null>
  connect(input: PluginCapabilityConnectInput): Promise<PluginCapabilityConnectResult>
  disconnect(input: PluginCapabilityDisconnectInput): Promise<boolean>
  getPluginAvailability(input: PluginCapabilityGetPluginAvailabilityInput): Promise<unknown>
  invokePlugin(input: PluginCapabilityInvokePluginInput): Promise<PluginCapabilityResponse>
  onEvent(listener: (event: PluginCapabilityEvent) => void): () => void
}
