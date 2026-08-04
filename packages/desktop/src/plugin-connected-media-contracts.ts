import type { PluginNodeInvocationRef } from "./plugin-host-types"

export const pluginConnectedMediaScheme = "convax-connected-media" as const

export interface PluginConnectedMediaFrameRef extends PluginNodeInvocationRef {
  frameId: string
  pluginVersion: string
}

export interface PluginConnectedMediaOpenInput extends PluginConnectedMediaFrameRef {
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
  /**
   * Opaque bearer URL. Electron's protocol Request has no trusted sender/frame
   * identity, so possession authorizes GET/HEAD until the Host revokes the
   * frame/session or a principal/Canvas revalidation fails.
   */
  url: string
}

export const pluginConnectedMediaPrivileges = {
  corsEnabled: true,
  secure: true,
  standard: true,
  stream: true,
  supportFetchAPI: true,
} as const
