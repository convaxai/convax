import type { CanvasDocument, CanvasNode } from "./types"

export function isCanvasFileNode(node: CanvasNode) {
  return node.type === "file" && node.data.kind !== "agent" && node.data.kind !== "group"
}

/**
 * Returns every file connected to an owning node, regardless of edge direction.
 * Duplicate edges are intentionally collapsed while document edge order stays stable.
 */
export function getConnectedCanvasFileNodeIds(document: CanvasDocument, ownerNodeId: string) {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const result: string[] = []
  const seen = new Set<string>()
  for (const edge of document.edges) {
    const candidateId = edge.source === ownerNodeId
      ? edge.target
      : edge.target === ownerNodeId
        ? edge.source
        : undefined
    if (!candidateId || candidateId === ownerNodeId || seen.has(candidateId)) continue
    const candidate = nodes.get(candidateId)
    if (!candidate || !isCanvasFileNode(candidate)) continue
    seen.add(candidateId)
    result.push(candidateId)
  }
  return result
}

/** Returns file nodes that feed an owning node through incoming edges, in edge order. */
export function getIncomingConnectedCanvasFileNodeIds(document: CanvasDocument, ownerNodeId: string) {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const result: string[] = []
  const seen = new Set<string>()
  for (const edge of document.edges) {
    if (edge.target !== ownerNodeId || edge.source === ownerNodeId || seen.has(edge.source)) continue
    const candidate = nodes.get(edge.source)
    if (!candidate || !isCanvasFileNode(candidate)) continue
    seen.add(edge.source)
    result.push(edge.source)
  }
  return result
}
