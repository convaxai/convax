import type { CanvasDocument } from "@convax/canvas/core"

export const projectFileReferenceKey = "convaxProjectFile"

export interface ProjectFileReference {
  path: string
}

export function getProjectFileReference(metadata: unknown): ProjectFileReference | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[projectFileReferenceKey]
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const reference = value as Record<string, unknown>
  return typeof reference.path === "string" ? { path: reference.path } : null
}

export function dehydrateProjectCanvasDocument(document: CanvasDocument): CanvasDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const metadata = "metadata" in node.data ? node.data.metadata : undefined
      if (!getProjectFileReference(metadata)) return node
      return { ...node, data: { ...node.data, posterUrl: undefined, url: "" } }
    }),
  }
}

export function hydrateProjectCanvasDocument(
  document: CanvasDocument,
  resolveFileUrl: (reference: ProjectFileReference) => string,
): CanvasDocument {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const metadata = "metadata" in node.data ? node.data.metadata : undefined
      const reference = getProjectFileReference(metadata)
      if (!reference) return node
      return { ...node, data: { ...node.data, url: resolveFileUrl(reference) } }
    }),
  }
}
