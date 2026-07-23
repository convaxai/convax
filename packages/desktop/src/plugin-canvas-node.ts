import type { CanvasNodeData } from "@convax/canvas/core"
import { getProjectFileReference } from "@convax/project/canvas"
import { requireWebPluginId, type InstalledWebPluginCanvasSurface } from "./plugin-contracts"

export const webPluginStateMetadataKey = "convaxPluginState" as const
export const webPluginIdentityMetadataKey = "convaxPlugin" as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function webPluginNodeMetadata(data: unknown) {
  return isRecord(data) && isRecord(data.metadata) ? data.metadata : undefined
}

export function webPluginCanvasRendererId(pluginId: string) {
  return `plugin.${requireWebPluginId(pluginId)}`
}

export function matchesWebPluginCanvasNode(plugin: InstalledWebPluginCanvasSurface, data: CanvasNodeData) {
  const renderer = plugin.contributes.canvas.renderer
  const rendererId = webPluginCanvasRendererId(plugin.id)
  if (data.kind === rendererId) return true
  const metadata = webPluginNodeMetadata(data)
  const identity = metadata?.[webPluginIdentityMetadataKey]
  if (isRecord(identity) && identity.id === plugin.id) return true
  if (renderer.nodeKinds?.includes(data.kind)) return true
  const mimeType = typeof data.mimeType === "string" ? data.mimeType.toLowerCase() : undefined
  if (mimeType && renderer.mimeTypes?.includes(mimeType)) return true
  const projectPath = getProjectFileReference(metadata)?.path
  const names = [data.name, data.path, data.label, projectPath].filter(
    (value): value is string => typeof value === "string",
  )
  return Boolean(renderer.extensions?.some((extension) => names.some((name) => name.toLowerCase().endsWith(extension))))
}
