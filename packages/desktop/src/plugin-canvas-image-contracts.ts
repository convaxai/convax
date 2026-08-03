import type { BoundedOperationReceiptV2 } from "@convax/canvas/collaboration"

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
  operationReceipt: BoundedOperationReceiptV2
  projection: PluginCanvasStructureDocument
}
