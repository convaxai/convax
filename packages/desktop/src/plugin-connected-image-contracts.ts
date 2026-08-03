import type { PluginApiConnectedImageOpenResult } from "@convax/plugin-api"

import type { PluginConnectedMediaFrameRef } from "./plugin-connected-media-contracts"

export interface PluginConnectedImageOpenInput extends PluginConnectedMediaFrameRef {
  sourceNodeId: string
}

export interface PluginConnectedImageCloseInput extends PluginConnectedMediaFrameRef {
  sessionId: string
}

export type PluginConnectedImageOpenResult = PluginApiConnectedImageOpenResult
