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
