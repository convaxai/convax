import type { CanvasDocument, CanvasNode } from "./types"

/** Every connectable Canvas card receives data on the left and emits it on the right. */
export const CANVAS_NODE_INPUT_HANDLE_ID = "target-left"
export const CANVAS_NODE_OUTPUT_HANDLE_ID = "source-right"

/** Structural groups organize cards but never participate in Canvas data flow. */
export function isCanvasConnectableNode(node: CanvasNode) {
  return node.data.kind !== "group"
}
export function isCanvasFileNode(node: CanvasNode) {
  return node.type === "file" && node.data.kind !== "agent" && node.data.kind !== "group"
}

/**
 * Returns every topological file neighbor, regardless of edge direction.
 * Never use this helper to infer inputs; inputs are direct incoming edge sources.
 * Duplicate edges are intentionally collapsed while document edge order stays stable.
 */
export function getConnectedCanvasFileNodeIds(document: CanvasDocument, ownerNodeId: string) {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]))
  const result: string[] = []
  const seen = new Set<string>()
  for (const edge of document.edges) {
    const candidateId =
      edge.source === ownerNodeId ? edge.target : edge.target === ownerNodeId ? edge.source : undefined
    if (!candidateId || candidateId === ownerNodeId || seen.has(candidateId)) continue
    const candidate = nodes.get(candidateId)
    if (!candidate || !isCanvasFileNode(candidate)) continue
    seen.add(candidateId)
    result.push(candidateId)
  }
  return result
}

/**
 * Returns file nodes that feed an owning node through direct incoming edges, in edge order.
 * Canvas direction is always `edge.source` (right/output) -> `edge.target` (left/input).
 */
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
