import { createCanvasId, createGroupNode, getCanvasNodePresentationSize, getCanvasNodeSize } from "./document"
import { cloneCanvasNodeGenerationRunData } from "./generation-run"
import { setCanvasGroupFolded } from "./group-fold"
import { CANVAS_NODE_INPUT_HANDLE_ID, CANVAS_NODE_OUTPUT_HANDLE_ID } from "./connections"
import type { CanvasDocument, CanvasEdge, CanvasNode, CanvasPoint, CanvasSize } from "./types"

export type CanvasAlign = "left" | "center" | "right" | "top" | "middle" | "bottom"
export type CanvasDistribute = "horizontal" | "vertical"
export type CanvasLayout = "grid" | "horizontal" | "vertical"

export interface CanvasCommandResult {
  document: CanvasDocument
  selectedNodeIds: string[]
}

export interface CanvasNodeGeometryUpdate {
  nodeId: string
  position: CanvasPoint
  size?: CanvasSize
}

export type CanvasDuplicateEdgeScope = "connected" | "internal"

export interface CanvasDuplicateOptions {
  edgeScope?: CanvasDuplicateEdgeScope
}

export interface CanvasDuplicateResult extends CanvasCommandResult {
  duplicatedNodeIdBySourceId: ReadonlyMap<string, string>
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

function getCanvasGroupableNodes(document: CanvasDocument, nodeIds: readonly string[]) {
  const topLevelIds = getTopLevelNodeIds(document, nodeIds)
  const selected = document.nodes.filter((node) => topLevelIds.includes(node.id))
  if (selected.length < 2) return []
  const parentId = selected[0]?.parentId
  return selected.every((node) => node.parentId === parentId) ? selected : []
}

export function canGroupCanvasNodes(document: CanvasDocument, nodeIds: readonly string[]) {
  return getCanvasGroupableNodes(document, nodeIds).length >= 2
}

function getNodeWorldPosition(document: CanvasDocument, nodeId: string): CanvasPoint {
  const nodes = nodeMap(document)
  const visited = new Set<string>()
  let current = nodes.get(nodeId)
  let x = 0
  let y = 0
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    x += current.position.x
    y += current.position.y
    current = current.parentId ? nodes.get(current.parentId) : undefined
  }
  return { x, y }
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
    (edge) => edge.source === connection.source && edge.target === connection.target,
  )
  if (duplicate) return document
  const edge: CanvasEdge = {
    id: connection.id ?? createCanvasId("edge"),
    source: connection.source,
    target: connection.target,
    sourceHandle: CANVAS_NODE_OUTPUT_HANDLE_ID,
    targetHandle: CANVAS_NODE_INPUT_HANDLE_ID,
    animated: connection.animated,
    type: connection.type ?? "canvas",
    data: connection.data,
  }
  return { ...document, edges: [...document.edges, edge] }
}

export function mentionCanvasResource(
  document: CanvasDocument,
  input: { mentionedNodeId: string; textNodeId: string },
): CanvasDocument {
  if (input.mentionedNodeId === input.textNodeId) return document
  const mentionedNode = document.nodes.find((node) => node.id === input.mentionedNodeId)
  const textNode = document.nodes.find((node) => node.id === input.textNodeId)
  if (
    !mentionedNode ||
    mentionedNode.type !== "file" ||
    mentionedNode.data.kind === "group" ||
    mentionedNode.data.kind === "folder" ||
    !textNode ||
    textNode.type !== "file" ||
    textNode.data.kind !== "text"
  ) {
    return document
  }
  return connectCanvasNodes(document, {
    source: mentionedNode.id,
    target: textNode.id,
  })
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

export function normalizeCanvasTextNodeTitle(title: string) {
  return title.trim().slice(0, 200) || "Untitled"
}

export function setCanvasTextNodeTitle(document: CanvasDocument, nodeId: string, title: string): CanvasDocument {
  const normalized = normalizeCanvasTextNodeTitle(title)
  const node = document.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || node.type !== "file" || node.data.kind !== "text" || node.data.label === normalized) return document
  return updateCanvasNodeData(document, nodeId, (data) => ({ ...data, label: normalized }))
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

/** Absolute, batched geometry replacement used by layout and advanced callers. */
export function setCanvasNodeGeometry(
  document: CanvasDocument,
  updates: readonly CanvasNodeGeometryUpdate[],
): CanvasDocument {
  if (updates.length === 0) return document
  const updateById = new Map(updates.map((update) => [update.nodeId, update]))
  let changed = false
  const nodes = document.nodes.map((node) => {
    const update = updateById.get(node.id)
    if (!update) return node
    const positionChanged = node.position.x !== update.position.x || node.position.y !== update.position.y
    const sizeChanged =
      Boolean(update.size) &&
      (node.style?.width !== update.size?.width ||
        node.style?.height !== update.size?.height ||
        node.width !== undefined ||
        node.height !== undefined ||
        node.measured !== undefined)
    if (!positionChanged && !sizeChanged) return node
    changed = true
    return {
      ...node,
      height: update.size ? undefined : node.height,
      measured: update.size ? undefined : node.measured,
      position: { ...update.position },
      style: update.size ? { ...node.style, height: update.size.height, width: update.size.width } : node.style,
      width: update.size ? undefined : node.width,
    }
  })
  return changed ? { ...document, nodes } : document
}

export function duplicateCanvasSelection(
  document: CanvasDocument,
  nodeIds: readonly string[],
  offset: CanvasPoint = { x: 32, y: 32 },
  options: CanvasDuplicateOptions = {},
): CanvasDuplicateResult {
  const included = collectNodeIds(document, nodeIds)
  if (included.size === 0) return { document, duplicatedNodeIdBySourceId: new Map(), selectedNodeIds: [] }
  const ids = new Map([...included].map((id) => [id, createCanvasId("node")]))
  const clones = document.nodes
    .filter((node) => included.has(node.id))
    .map((node) => {
      const parentId = node.parentId && ids.has(node.parentId) ? ids.get(node.parentId) : node.parentId
      const isNestedClone = Boolean(node.parentId && ids.has(node.parentId))
      return {
        ...structuredClone(node),
        data: cloneCanvasNodeGenerationRunData(structuredClone(node.data)),
        id: ids.get(node.id) ?? createCanvasId("node"),
        parentId,
        position: isNestedClone ? node.position : { x: node.position.x + offset.x, y: node.position.y + offset.y },
        selected: false,
      } satisfies CanvasNode
    })
  const edges = document.edges
    .filter((edge) => {
      const sourceIncluded = included.has(edge.source)
      const targetIncluded = included.has(edge.target)
      return options.edgeScope === "internal" ? sourceIncluded && targetIncluded : sourceIncluded || targetIncluded
    })
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
    duplicatedNodeIdBySourceId: ids,
    selectedNodeIds,
  }
}

export function groupCanvasNodes(
  document: CanvasDocument,
  nodeIds: readonly string[],
  label = "Group",
): CanvasCommandResult {
  const topLevelIds = getTopLevelNodeIds(document, nodeIds)
  const selected = getCanvasGroupableNodes(document, topLevelIds)
  if (selected.length < 2) return { document, selectedNodeIds: topLevelIds }
  const parentId = selected[0]!.parentId
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

export function foldCanvasNodes(
  document: CanvasDocument,
  nodeIds: readonly string[],
  label = "Group",
): CanvasCommandResult {
  const grouped = groupCanvasNodes(document, nodeIds, label)
  if (grouped.document === document || grouped.selectedNodeIds.length !== 1) return grouped
  return {
    ...grouped,
    document: setCanvasGroupFolded(grouped.document, grouped.selectedNodeIds[0]!, true),
  }
}

export function ungroupCanvasNode(document: CanvasDocument, groupId: string): CanvasCommandResult {
  const group = document.nodes.find((node) => node.id === groupId && node.data.kind === "group")
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
  return {
    document: {
      ...document,
      edges: document.edges.filter((edge) => edge.source !== groupId && edge.target !== groupId),
      nodes,
    },
    selectedNodeIds: childIds,
  }
}

export function reparentCanvasNodes(
  document: CanvasDocument,
  nodeIds: readonly string[],
  parentId: string | undefined,
  options: { preserveWorldPosition?: boolean } = {},
): CanvasCommandResult {
  const topLevelIds = getTopLevelNodeIds(document, nodeIds)
  if (topLevelIds.length === 0) return { document, selectedNodeIds: [] }
  const nodes = nodeMap(document)
  const parent = parentId ? nodes.get(parentId) : undefined
  if (parentId && parent?.data.kind !== "group") return { document, selectedNodeIds: topLevelIds }
  if (parentId) {
    for (const nodeId of topLevelIds) {
      let ancestor: CanvasNode | undefined = parent
      const visited = new Set<string>()
      while (ancestor && !visited.has(ancestor.id)) {
        if (ancestor.id === nodeId) return { document, selectedNodeIds: topLevelIds }
        visited.add(ancestor.id)
        ancestor = ancestor.parentId ? nodes.get(ancestor.parentId) : undefined
      }
    }
  }
  if (topLevelIds.every((nodeId) => nodes.get(nodeId)?.parentId === parentId)) {
    return { document, selectedNodeIds: topLevelIds }
  }

  const preserveWorldPosition = options.preserveWorldPosition ?? true
  const worldPositions = preserveWorldPosition
    ? new Map(topLevelIds.map((nodeId) => [nodeId, getNodeWorldPosition(document, nodeId)]))
    : new Map<string, CanvasPoint>()
  const parentWorldPosition = parentId ? getNodeWorldPosition(document, parentId) : { x: 0, y: 0 }
  const reparentedIds = new Set(topLevelIds)
  const nextNodes = document.nodes.map((node) => {
    if (!reparentedIds.has(node.id)) return node
    const worldPosition = worldPositions.get(node.id)
    return {
      ...node,
      extent: parentId ? ("parent" as const) : undefined,
      parentId,
      position:
        preserveWorldPosition && worldPosition
          ? {
              x: worldPosition.x - parentWorldPosition.x,
              y: worldPosition.y - parentWorldPosition.y,
            }
          : node.position,
    }
  })
  return {
    document: { ...document, nodes: nextNodes },
    selectedNodeIds: topLevelIds,
  }
}

export function layoutCanvasNodes(
  document: CanvasDocument,
  input?: { nodeIds?: readonly string[]; layout?: CanvasLayout; gap?: number },
): CanvasDocument {
  const candidates = input?.nodeIds?.length
    ? document.nodes.filter((node) => input.nodeIds?.includes(node.id))
    : document.nodes.filter((node) => !node.parentId)
  const selected = candidates
  if (selected.length < 2) return document
  const ids = new Set(selected.map((node) => node.id))
  const gap = input?.gap ?? 80
  const startX = Math.min(...selected.map((node) => node.position.x))
  const startY = Math.min(...selected.map((node) => node.position.y))
  const maxWidth = Math.max(...selected.map((node) => getCanvasNodePresentationSize(node).width))
  const maxHeight = Math.max(...selected.map((node) => getCanvasNodePresentationSize(node).height))
  const layout = input?.layout ?? "grid"
  const columns =
    layout === "grid" ? Math.ceil(Math.sqrt(selected.length)) : layout === "horizontal" ? selected.length : 1
  const positions = new Map(
    selected.map((node, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      return [node.id, { x: startX + column * (maxWidth + gap), y: startY + row * (maxHeight + gap) }]
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
  const right = Math.max(...selected.map((node) => node.position.x + getCanvasNodePresentationSize(node).width))
  const bottom = Math.max(...selected.map((node) => node.position.y + getCanvasNodePresentationSize(node).height))
  return updateNodes(document, (node) => {
    if (!ids.has(node.id)) return node
    const size = getCanvasNodePresentationSize(node)
    const x =
      direction === "left"
        ? left
        : direction === "center"
          ? (left + right - size.width) / 2
          : direction === "right"
            ? right - size.width
            : node.position.x
    const y =
      direction === "top"
        ? top
        : direction === "middle"
          ? (top + bottom - size.height) / 2
          : direction === "bottom"
            ? bottom - size.height
            : node.position.y
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
    .sort((left, right) =>
      axis === "horizontal" ? left.position.x - right.position.x : left.position.y - right.position.y,
    )
  if (selected.length < 3) return document
  const first = selected[0]
  const last = selected.at(-1)
  if (!last) return document
  const firstSize = getCanvasNodePresentationSize(first)
  const start = axis === "horizontal" ? first.position.x + firstSize.width : first.position.y + firstSize.height
  const end = axis === "horizontal" ? last.position.x : last.position.y
  const middleSize = selected
    .slice(1, -1)
    .reduce(
      (total, node) =>
        total +
        (axis === "horizontal" ? getCanvasNodePresentationSize(node).width : getCanvasNodePresentationSize(node).height),
      0,
    )
  const gap = (end - start - middleSize) / (selected.length - 1)
  const positions = new Map<string, number>()
  selected.slice(1, -1).reduce((cursor, node) => {
    positions.set(node.id, cursor + gap)
    return (
      cursor +
      gap +
      (axis === "horizontal" ? getCanvasNodePresentationSize(node).width : getCanvasNodePresentationSize(node).height)
    )
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
