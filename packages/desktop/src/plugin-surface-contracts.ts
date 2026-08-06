import type { BoundedOperationReceipt } from "@convax/canvas/collaboration"
import type { CanvasDocument } from "@convax/canvas/core"

export const pluginSurfaceIpcChannels = {
  create: "canvas:plugin-surface-create",
} as const

/** Renderer may submit only these three opaque ids. */
export interface PluginSurfaceCreateInput {
  canvasId: string
  pluginId: string
  projectId: string
}

export interface PluginSurfaceCreateResult {
  createdNodeId: string
  operationReceipt: BoundedOperationReceipt
  projection: CanvasDocument
}

export interface PluginSurfaceRendererClient {
  create(input: PluginSurfaceCreateInput): Promise<PluginSurfaceCreateResult>
}
