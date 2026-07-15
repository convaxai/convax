import type { CanvasDocument, CanvasPoint } from "../types"

export interface CanvasNodeQuery {
  ids?: readonly string[]
  kinds?: readonly string[]
  limit?: number
  relatedToNodeIds?: readonly string[]
  text?: string
}

export interface CanvasNodeSummary {
  id: string
  incomingNodeIds: string[]
  kind: string
  label: string
  outgoingNodeIds: string[]
  parentId?: string
  position: CanvasPoint
  text?: string
  type?: string
}

export function queryCanvasNodes(document: CanvasDocument, query: CanvasNodeQuery = {}): CanvasNodeSummary[] {
  const ids = query.ids ? new Set(query.ids) : null
  const kinds = query.kinds ? new Set(query.kinds) : null
  const related = query.relatedToNodeIds ? new Set(query.relatedToNodeIds) : null
  const needle = query.text?.trim().toLowerCase() ?? ""
  const limit = Math.max(0, Math.min(query.limit ?? 50, 1_000))
  if (limit === 0) return []

  const incoming = new Map<string, string[]>()
  const outgoing = new Map<string, string[]>()
  for (const edge of document.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source])
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
  }

  return document.nodes.flatMap((node) => {
    if (ids && !ids.has(node.id)) return []
    if (kinds && !kinds.has(node.data.kind)) return []
    const incomingNodeIds = incoming.get(node.id) ?? []
    const outgoingNodeIds = outgoing.get(node.id) ?? []
    if (related && ![...incomingNodeIds, ...outgoingNodeIds].some((id) => related.has(id))) return []
    const text = "text" in node.data && typeof node.data.text === "string" ? node.data.text : undefined
    const name = "name" in node.data && typeof node.data.name === "string" ? node.data.name : undefined
    const description = typeof node.data.description === "string" ? node.data.description : undefined
    if (needle && ![node.id, node.data.kind, node.data.label, description, name, text]
      .some((value) => value?.toLowerCase().includes(needle))) return []
    return [{
      id: node.id,
      incomingNodeIds: [...incomingNodeIds],
      kind: node.data.kind,
      label: node.data.label,
      outgoingNodeIds: [...outgoingNodeIds],
      parentId: node.parentId,
      position: { ...node.position },
      text,
      type: node.type,
    }]
  }).slice(0, limit)
}
