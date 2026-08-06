import type { BoundedOperationReceipt } from "@convax/canvas/collaboration"

import type { PluginCanvasStructureDocument } from "./plugin-capability-contracts"

export interface PluginCanvasImageCreateRequest {
  dataUrl: string
  name: string
  operationId: string
  ownerNodeId: string
  pluginId: string
  pluginVersion: string
  ref: {
    canvasId: string
    scopeId: string
  }
}

export interface PluginCanvasImageCreateResult {
  createdNodeId: string
  operationReceipt: BoundedOperationReceipt
  projection: PluginCanvasStructureDocument
}
