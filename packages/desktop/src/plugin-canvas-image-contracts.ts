export const pluginCanvasImageIpcChannels = {
  cancel: "plugin-canvas:image-cancel",
  create: "plugin-canvas:image-create",
} as const
export const pluginCanvasImageIpcChannel = pluginCanvasImageIpcChannels.create

export interface PluginCanvasImageCreateRequest {
  dataUrl: string
  expectedRevision: number
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
  revision: number
}

export interface PluginCanvasImageClient {
  cancel(input: { operationId: string }): void
  create(request: PluginCanvasImageCreateRequest): Promise<PluginCanvasImageCreateResult>
}
