import type { CanvasDocument, CanvasNode } from "./types"

export function isCanvasFileNode(node: CanvasNode) {
  return node.type === "file" && node.data.kind !== "agent" && node.data.kind !== "group"
}

/**
 * Returns every file connected to an Agent, regardless of edge direction.
 * Duplicate edges are intentionally collapsed while document edge order stays stable.
 */
export function getConnectedCanvasFileNodeIds(document: CanvasDocument, agentNodeId: string) {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const result: string[] = []
  const seen = new Set<string>()
  for (const edge of document.edges) {
    const candidateId = edge.source === agentNodeId
      ? edge.target
      : edge.target === agentNodeId
        ? edge.source
        : undefined
    if (!candidateId || candidateId === agentNodeId || seen.has(candidateId)) continue
    const candidate = nodes.get(candidateId)
    if (!candidate || !isCanvasFileNode(candidate)) continue
    seen.add(candidateId)
    result.push(candidateId)
  }
  return result
}
