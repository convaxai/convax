export const pluginMaterializationIpcChannels = {
  materialize: "plugin:materialize-own-node",
} as const

export interface PluginMaterializationInput {
  actionId: string
  canvasId: string
  pluginId: string
  pluginVersion: string
  projectId: string
  sourceNodeId: string
}

export interface PluginMaterializationResult {
  createdNodeId: string
  operationReceipt: BoundedOperationReceiptV2
  projection: CanvasDocument
}

export interface PluginMaterializationRendererClient {
  materialize(input: PluginMaterializationInput): Promise<PluginMaterializationResult>
}
import type { BoundedOperationReceiptV2 } from "@convax/canvas/collaboration"
import type { CanvasDocument } from "@convax/canvas/core"
