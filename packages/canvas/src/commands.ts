import { createCanvasId, createGroupNode, getCanvasNodeSize } from "./document"
import type { CanvasDocument, CanvasEdge, CanvasNode, CanvasPoint } from "./types"

export type CanvasAlign = "left" | "center" | "right" | "top" | "middle" | "bottom"
export type CanvasDistribute = "horizontal" | "vertical"
export type CanvasLayout = "grid" | "horizontal" | "vertical"

export interface CanvasCommandResult {
  document: CanvasDocument
  selectedNodeIds: string[]
}

function nodeMap(document: CanvasDocument) {
  return new Map(document.nodes.map((node) => [node.id, node]))
}

function collectNodeIds(document: CanvasDocument, nodeIds: readonly string[]) {
  const ids = new Set(nodeIds)
  const addChildren = (parentId: string) => {
    document.nodes
      .filter((node) => node.parentId === parentId && !ids.has(node.id))
      .forEach((node) => {
        ids.add(node.id)
        addChildren(node.id)
      })
  }
  nodeIds.forEach(addChildren)
  return ids
}

function getTopLevelNodeIds(document: CanvasDocument, nodeIds: readonly string[]) {
  const nodes = nodeMap(document)
  const selected = new Set(nodeIds)
  return nodeIds.filter((id) => {
    let parentId = nodes.get(id)?.parentId
    while (parentId) {
      if (selected.has(parentId)) return false
      parentId = nodes.get(parentId)?.parentId
    }
    return nodes.has(id)
  })
}

function updateNodes(document: CanvasDocument, update: (node: CanvasNode) => CanvasNode) {
  return { ...document, nodes: document.nodes.map(update) }
}

export function addCanvasNodes(document: CanvasDocument, nodes: readonly CanvasNode[]): CanvasCommandResult {
  if (nodes.length === 0) return { document, selectedNodeIds: [] }
  return {
    document: { ...document, nodes: [...document.nodes, ...nodes] },
    selectedNodeIds: nodes.map((node) => node.id),
  }
}

export function connectCanvasNodes(
  document: CanvasDocument,
  connection: Pick<CanvasEdge, "source" | "target"> & Partial<CanvasEdge>,
): CanvasDocument {
  if (connection.source === connection.target) return document
  const duplicate = document.edges.some(
    (edge) =>
      edge.source === connection.source &&
      edge.target === connection.target &&
      edge.sourceHandle === connection.sourceHandle &&
      edge.targetHandle === connection.targetHandle,
  )
  if (duplicate) return document
  const edge: CanvasEdge = {
    id: connection.id ?? createCanvasId("edge"),
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    type: connection.type ?? "smoothstep",
    data: connection.data,
  }
  return { ...document, edges: [...document.edges, edge] }
}

export function removeCanvasElements(
  document: CanvasDocument,
  input: { nodeIds?: readonly string[]; edgeIds?: readonly string[] },
): CanvasDocument {
  const nodeIds = collectNodeIds(document, input.nodeIds ?? [])
  const edgeIds = new Set(input.edgeIds ?? [])
  if (nodeIds.size === 0 && edgeIds.size === 0) return document
  return {
    ...document,
    nodes: document.nodes.filter((node) => !nodeIds.has(node.id)),
    edges: document.edges.filter(
      (edge) => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target),
    ),
  }
}

export function updateCanvasNodeData(
  document: CanvasDocument,
  nodeId: string,
  update: (data: CanvasNode["data"]) => CanvasNode["data"],
): CanvasDocument {
  return updateNodes(document, (node) => {
    if (node.id !== nodeId) return node
    return { ...node, data: update(node.data) }
  })
}

export function moveCanvasNodes(
  document: CanvasDocument,
  nodeIds: readonly string[],
  delta: CanvasPoint,
): CanvasDocument {
  const ids = new Set(getTopLevelNodeIds(document, nodeIds))
  if (ids.size === 0 || (delta.x === 0 && delta.y === 0)) return document
  return updateNodes(document, (node) => {
    if (!ids.has(node.id)) return node
    return {
      ...node,
      position: { x: node.position.x + delta.x, y: node.position.y + delta.y },
    }
  })
}

export function duplicateCanvasSelection(
  document: CanvasDocument,
  nodeIds: readonly string[],
  offset: CanvasPoint = { x: 32, y: 32 },
): CanvasCommandResult {
  const included = collectNodeIds(document, nodeIds)
  if (included.size === 0) return { document, selectedNodeIds: [] }
  const ids = new Map([...included].map((id) => [id, createCanvasId("node")]))
  const clones = document.nodes
    .filter((node) => included.has(node.id))
    .map((node) => {
      const parentId = node.parentId && ids.has(node.parentId) ? ids.get(node.parentId) : node.parentId
      const isNestedClone = Boolean(node.parentId && ids.has(node.parentId))
      return {
        ...structuredClone(node),
        id: ids.get(node.id) ?? createCanvasId("node"),
        parentId,
        position: isNestedClone
          ? node.position
          : { x: node.position.x + offset.x, y: node.position.y + offset.y },
        selected: false,
      } satisfies CanvasNode
    })
  const edges = document.edges
    .filter((edge) => included.has(edge.source) && included.has(edge.target))
    .map((edge) => ({
      ...structuredClone(edge),
      id: createCanvasId("edge"),
      source: ids.get(edge.source) ?? edge.source,
      target: ids.get(edge.target) ?? edge.target,
      selected: false,
    }))
  const selectedNodeIds = getTopLevelNodeIds(document, nodeIds).flatMap((id) => {
    const nextId = ids.get(id)
    return nextId ? [nextId] : []
  })
  return {
    document: { ...document, nodes: [...document.nodes, ...clones], edges: [...document.edges, ...edges] },
    selectedNodeIds,
  }
}

export function groupCanvasNodes(
  document: CanvasDocument,
  nodeIds: readonly string[],
  label = "Group",
): CanvasCommandResult {
  const topLevelIds = getTopLevelNodeIds(document, nodeIds)
  const selected = document.nodes.filter((node) => topLevelIds.includes(node.id))
  if (selected.length < 2) return { document, selectedNodeIds: topLevelIds }
  const parentId = selected[0].parentId
  if (!selected.every((node) => node.parentId === parentId)) return { document, selectedNodeIds: topLevelIds }
  const padding = 40
  const minX = Math.min(...selected.map((node) => node.position.x))
  const minY = Math.min(...selected.map((node) => node.position.y))
  const maxX = Math.max(...selected.map((node) => node.position.x + getCanvasNodeSize(node).width))
  const maxY = Math.max(...selected.map((node) => node.position.y + getCanvasNodeSize(node).height))
  const group = createGroupNode({
    label,
    position: { x: minX - padding, y: minY - padding },
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
    parentId,
  })
  const ids = new Set(topLevelIds)
  const children = document.nodes.map((node) => {
    if (!ids.has(node.id)) return node
    return {
      ...node,
      parentId: group.id,
      extent: "parent" as const,
      position: {
        x: node.position.x - group.position.x,
        y: node.position.y - group.position.y,
      },
    }
  })
  return {
    document: { ...document, nodes: [...children, group] },
    selectedNodeIds: [group.id],
  }
}

export function ungroupCanvasNode(document: CanvasDocument, groupId: string): CanvasCommandResult {
  const group = document.nodes.find((node) => node.id === groupId && node.type === "group")
  if (!group) return { document, selectedNodeIds: [] }
  const childIds = document.nodes.filter((node) => node.parentId === groupId).map((node) => node.id)
  const nodes = document.nodes.flatMap((node) => {
    if (node.id === groupId) return []
    if (node.parentId !== groupId) return [node]
    return [
      {
        ...node,
        parentId: group.parentId,
        extent: group.parentId ? ("parent" as const) : undefined,
        position: {
          x: node.position.x + group.position.x,
          y: node.position.y + group.position.y,
        },
      },
    ]
  })
  return { document: { ...document, nodes }, selectedNodeIds: childIds }
}

export function layoutCanvasNodes(
  document: CanvasDocument,
  input?: { nodeIds?: readonly string[]; layout?: CanvasLayout; gap?: number },
): CanvasDocument {
  const candidates = input?.nodeIds?.length
    ? document.nodes.filter((node) => input.nodeIds?.includes(node.id))
    : document.nodes.filter((node) => !node.parentId)
  const selected = candidates.filter((node) => node.type !== "group" || !document.nodes.some((item) => item.parentId === node.id))
  if (selected.length < 2) return document
  const ids = new Set(selected.map((node) => node.id))
  const gap = input?.gap ?? 80
  const startX = Math.min(...selected.map((node) => node.position.x))
  const startY = Math.min(...selected.map((node) => node.position.y))
  const maxWidth = Math.max(...selected.map((node) => getCanvasNodeSize(node).width))
  const maxHeight = Math.max(...selected.map((node) => getCanvasNodeSize(node).height))
  const layout = input?.layout ?? "grid"
  const columns = layout === "grid" ? Math.ceil(Math.sqrt(selected.length)) : layout === "horizontal" ? selected.length : 1
  const positions = new Map(
    selected.map((node, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      return [
        node.id,
        { x: startX + column * (maxWidth + gap), y: startY + row * (maxHeight + gap) },
      ]
    }),
  )
  return updateNodes(document, (node) => {
    if (!ids.has(node.id)) return node
    return { ...node, position: positions.get(node.id) ?? node.position }
  })
}

export function alignCanvasNodes(
  document: CanvasDocument,
  nodeIds: readonly string[],
  direction: CanvasAlign,
): CanvasDocument {
  const ids = new Set(getTopLevelNodeIds(document, nodeIds))
  const selected = document.nodes.filter((node) => ids.has(node.id))
  if (selected.length < 2) return document
  const left = Math.min(...selected.map((node) => node.position.x))
  const top = Math.min(...selected.map((node) => node.position.y))
  const right = Math.max(...selected.map((node) => node.position.x + getCanvasNodeSize(node).width))
  const bottom = Math.max(...selected.map((node) => node.position.y + getCanvasNodeSize(node).height))
  return updateNodes(document, (node) => {
    if (!ids.has(node.id)) return node
    const size = getCanvasNodeSize(node)
    const x = direction === "left" ? left : direction === "center" ? (left + right - size.width) / 2 : direction === "right" ? right - size.width : node.position.x
    const y = direction === "top" ? top : direction === "middle" ? (top + bottom - size.height) / 2 : direction === "bottom" ? bottom - size.height : node.position.y
    return { ...node, position: { x, y } }
  })
}

export function distributeCanvasNodes(
  document: CanvasDocument,
  nodeIds: readonly string[],
  axis: CanvasDistribute,
): CanvasDocument {
  const ids = new Set(getTopLevelNodeIds(document, nodeIds))
  const selected = document.nodes
    .filter((node) => ids.has(node.id))
    .sort((left, right) => axis === "horizontal" ? left.position.x - right.position.x : left.position.y - right.position.y)
  if (selected.length < 3) return document
  const first = selected[0]
  const last = selected.at(-1)
  if (!last) return document
  const firstSize = getCanvasNodeSize(first)
  const lastSize = getCanvasNodeSize(last)
  const start = axis === "horizontal" ? first.position.x + firstSize.width : first.position.y + firstSize.height
  const end = axis === "horizontal" ? last.position.x : last.position.y
  const middleSize = selected.slice(1, -1).reduce(
    (total, node) => total + (axis === "horizontal" ? getCanvasNodeSize(node).width : getCanvasNodeSize(node).height),
    0,
  )
  const gap = (end - start - middleSize) / (selected.length - 1)
  const positions = new Map<string, number>()
  selected.slice(1, -1).reduce((cursor, node) => {
    positions.set(node.id, cursor + gap)
    return cursor + gap + (axis === "horizontal" ? getCanvasNodeSize(node).width : getCanvasNodeSize(node).height)
  }, start)
  return updateNodes(document, (node) => {
    const position = positions.get(node.id)
    if (position === undefined) return node
    return {
      ...node,
      position: axis === "horizontal" ? { ...node.position, x: position } : { ...node.position, y: position },
    }
  })
}

