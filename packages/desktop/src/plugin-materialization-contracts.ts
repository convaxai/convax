export const pluginMaterializationIpcChannels = {
  materialize: "plugin:materialize-own-node",
} as const

export interface PluginMaterializationInput {
  actionId: string
  canvasId: string
  expectedRevision: number
  pluginId: string
  pluginVersion: string
  projectId: string
  sourceNodeId: string
}

export interface PluginMaterializationResult {
  createdNodeId: string
  revision: number
}

export interface PluginMaterializationRendererClient {
  materialize(input: PluginMaterializationInput): Promise<PluginMaterializationResult>
}
