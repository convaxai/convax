import type { PluginNodeInvocationRef } from "./plugin-host-types"

export const pluginConnectedMediaScheme = "convax-connected-media" as const

export const pluginConnectedMediaIpcChannels = {
  close: "plugin:connected-media-close",
  open: "plugin:connected-media-open",
  revokeFrame: "plugin:connected-media-revoke-frame",
} as const

export interface PluginConnectedMediaFrameRef extends PluginNodeInvocationRef {
  frameId: string
  pluginVersion: string
}

export interface PluginConnectedMediaOpenInput extends PluginConnectedMediaFrameRef {
  expectedRevision: number
  sourceNodeId: string
}

export interface PluginConnectedMediaCloseInput extends PluginConnectedMediaFrameRef {
  sessionId: string
}

export interface PluginConnectedMediaProbe {
  duration: { estimated: boolean; milliseconds: number }
  height?: number
  kind: "audio" | "video"
  mediaRevision: string
  mimeType: string
  size: number
  width?: number
}

export interface PluginConnectedMediaOpenResult {
  probe: PluginConnectedMediaProbe
  sessionId: string
  url: string
}

export interface PluginConnectedMediaRendererClient {
  close(input: PluginConnectedMediaCloseInput): Promise<boolean>
  open(input: PluginConnectedMediaOpenInput): Promise<PluginConnectedMediaOpenResult>
  revokeFrame(input: PluginConnectedMediaFrameRef): Promise<number>
}

export const pluginConnectedMediaPrivileges = {
  corsEnabled: true,
  secure: true,
  standard: true,
  stream: true,
  supportFetchAPI: true,
} as const
