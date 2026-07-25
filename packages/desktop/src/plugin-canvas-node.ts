import type { CanvasNodeData } from "@convax/canvas/core"
import { getProjectResourceReference } from "@convax/project/canvas"
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

/**
 * Resolves only the exact Plugin identity persisted by a Plugin Canvas node.
 * Renderer matchers may additionally claim file extensions, MIME types, or
 * custom node kinds, but those broad presentation rules are not authority.
 */
export function webPluginCanvasNodeIdentity(data: CanvasNodeData) {
  const kindIdentity = data.kind.startsWith("plugin.") ? data.kind.slice("plugin.".length) : undefined
  const metadata = webPluginNodeMetadata(data)
  const metadataIdentity = metadata?.[webPluginIdentityMetadataKey]
  if (metadataIdentity !== undefined && (!isRecord(metadataIdentity) || typeof metadataIdentity.id !== "string")) {
    return undefined
  }
  const declaredIdentity =
    isRecord(metadataIdentity) && typeof metadataIdentity.id === "string" ? metadataIdentity.id : undefined
  let normalizedKindIdentity: string | undefined
  let normalizedDeclaredIdentity: string | undefined
  try {
    normalizedKindIdentity = kindIdentity === undefined ? undefined : requireWebPluginId(kindIdentity)
    normalizedDeclaredIdentity = declaredIdentity === undefined ? undefined : requireWebPluginId(declaredIdentity)
  } catch {
    return undefined
  }
  if (
    normalizedKindIdentity !== undefined &&
    normalizedDeclaredIdentity !== undefined &&
    normalizedKindIdentity !== normalizedDeclaredIdentity
  ) {
    return undefined
  }
  return normalizedDeclaredIdentity ?? normalizedKindIdentity
}

export function matchesWebPluginCanvasNodeIdentity(pluginId: string, data: CanvasNodeData) {
  return webPluginCanvasNodeIdentity(data) === requireWebPluginId(pluginId)
}

export function matchesWebPluginCanvasNode(plugin: InstalledWebPluginCanvasSurface, data: CanvasNodeData) {
  const renderer = plugin.contributes.canvas.renderer
  if (matchesWebPluginCanvasNodeIdentity(plugin.id, data)) return true
  const metadata = webPluginNodeMetadata(data)
  if (renderer.nodeKinds?.includes(data.kind)) return true
  const mimeType = typeof data.mimeType === "string" ? data.mimeType.toLowerCase() : undefined
  if (mimeType && renderer.mimeTypes?.includes(mimeType)) return true
  const reference = getProjectResourceReference(metadata)
  const projectPath = reference?.kind === "project-file" ? reference.path : undefined
  const names = [data.name, data.path, data.label, projectPath].filter(
    (value): value is string => typeof value === "string",
  )
  return Boolean(renderer.extensions?.some((extension) => names.some((name) => name.toLowerCase().endsWith(extension))))
}
