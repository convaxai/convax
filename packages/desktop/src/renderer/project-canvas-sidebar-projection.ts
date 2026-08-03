import {
  getCanvasGroupAppearance,
  isCanvasGroupFolded,
  projectCanvasOutline,
  type CanvasDocument,
  type CanvasOutlineEntry,
} from "@convax/canvas"
import type {
  ProjectCanvasSidebarNode,
  ProjectCanvasSidebarNodeProjection,
} from "@convax/project/canvas"

export function projectCanvasSidebarNodes(document: CanvasDocument): ProjectCanvasSidebarNode[] {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]))
  const projectEntry = (entry: CanvasOutlineEntry): ProjectCanvasSidebarNode => {
    const node = nodesById.get(entry.id)
    const name = typeof node?.data.name === "string" ? node.data.name.trim() : ""
    const label = node?.data.label.trim() || name || "Untitled node"
    const folderAppearance =
      node?.data.kind === "group" && isCanvasGroupFolded(node) ? getCanvasGroupAppearance(node) : null
    return {
      children: entry.children.map(projectEntry),
      id: entry.id,
      kind: entry.kind,
      label,
      ...(folderAppearance
        ? { folderColor: folderAppearance.color, folderEmoji: folderAppearance.emoji }
        : {}),
      ...(node ? projectCanvasSidebarNodePreview(node) : {}),
    }
  }
  return projectCanvasOutline(document).map(projectEntry)
}

function projectCanvasSidebarNodePreview(node: CanvasDocument["nodes"][number]) {
  const resourceState = node.data.resourceState
  if (!resourceState || typeof resourceState !== "object") return {}
  const state = resourceState as { posterUrl?: unknown; url?: unknown }
  if (node.data.kind === "image" && typeof state.url === "string" && state.url.trim()) {
    return { previewType: "image" as const, previewUrl: state.url.trim() }
  }
  if (node.data.kind === "video") {
    if (typeof state.posterUrl === "string" && state.posterUrl.trim()) {
      return { previewType: "image" as const, previewUrl: state.posterUrl.trim() }
    }
    if (typeof state.url === "string" && state.url.trim()) {
      return { previewType: "video" as const, previewUrl: state.url.trim() }
    }
  }
  return {}
}

export function sameProjectCanvasNodeProjection(
  left: ProjectCanvasSidebarNodeProjection | null,
  right: ProjectCanvasSidebarNodeProjection,
) {
  if (!left || left.canvasId !== right.canvasId || left.projectId !== right.projectId) return false
  return sameProjectCanvasNodes(left.nodes, right.nodes)
}

function sameProjectCanvasNodes(
  left: readonly ProjectCanvasSidebarNode[],
  right: readonly ProjectCanvasSidebarNode[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((node, index) => {
    const other = right[index]
    return (
      other?.id === node.id &&
      other.folderColor === node.folderColor &&
      other.folderEmoji === node.folderEmoji &&
      other.kind === node.kind &&
      other.label === node.label &&
      other.previewType === node.previewType &&
      other.previewUrl === node.previewUrl &&
      sameProjectCanvasNodes(node.children ?? [], other.children ?? [])
    )
  })
}
