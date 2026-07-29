import { getCanvasNodeSize } from "./document"
import type { CanvasDocument, CanvasNode, CanvasPoint } from "./types"

type CanvasSnapAnchor = "max" | "mid" | "min"

interface CanvasSnapBounds {
  height: number
  id: string
  width: number
  x: number
  y: number
}

interface CanvasDraggingSnapBounds extends CanvasSnapBounds {
  localPosition: CanvasPoint
  parentOffset: CanvasPoint
}

export interface CanvasSnapLine {
  axis: "x" | "y"
  value: number
}

export interface CanvasNodeSnapSession {
  readonly candidates: readonly CanvasSnapBounds[]
  readonly dragging: readonly CanvasDraggingSnapBounds[]
}

export interface CanvasNodeSnapResult {
  lines: CanvasSnapLine[]
  offset: CanvasPoint
}

export function createCanvasNodeSnapSession(
  document: Readonly<CanvasDocument>,
  draggingIds: readonly string[],
): CanvasNodeSnapSession {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const worldPositionById = new Map<string, CanvasPoint>()
  const dragging = new Set(draggingIds)
  const excluded = collectCanvasSnapExcludedNodeIds(document.nodes, dragging)

  return {
    candidates: document.nodes.flatMap((node) => {
      if (excluded.has(node.id) || node.hidden) return []
      const bounds = getCanvasSnapBounds(node, nodeById, worldPositionById)
      return bounds ? [bounds] : []
    }),
    dragging: draggingIds.flatMap((id) => {
      if (!dragging.has(id)) return []
      const node = nodeById.get(id)
      if (!node) return []
      const bounds = getCanvasSnapBounds(node, nodeById, worldPositionById)
      if (!bounds) return []
      return [
        {
          ...bounds,
          localPosition: { ...node.position },
          parentOffset: {
            x: bounds.x - node.position.x,
            y: bounds.y - node.position.y,
          },
        },
      ]
    }),
  }
}

export function resolveCanvasNodeSnap(
  session: CanvasNodeSnapSession,
  localPositions: ReadonlyMap<string, CanvasPoint>,
  tolerance: number,
): CanvasNodeSnapResult {
  if (!Number.isFinite(tolerance) || tolerance <= 0 || session.dragging.length === 0) {
    return { lines: [], offset: { x: 0, y: 0 } }
  }

  const firstPositioned = session.dragging.find((node) => localPositions.has(node.id))
  const sharedDelta = firstPositioned
    ? {
        x: localPositions.get(firstPositioned.id)!.x - firstPositioned.localPosition.x,
        y: localPositions.get(firstPositioned.id)!.y - firstPositioned.localPosition.y,
      }
    : { x: 0, y: 0 }
  const movedBounds = session.dragging.map((node) => {
    const localPosition = localPositions.get(node.id)
    return {
      ...node,
      x: localPosition ? localPosition.x + node.parentOffset.x : node.x + sharedDelta.x,
      y: localPosition ? localPosition.y + node.parentOffset.y : node.y + sharedDelta.y,
    }
  })
  const x = findBestCanvasSnap("x", movedBounds, session.candidates, tolerance)
  const y = findBestCanvasSnap("y", movedBounds, session.candidates, tolerance)

  return {
    lines: [
      ...(x ? [{ axis: "x" as const, value: x.value }] : []),
      ...(y ? [{ axis: "y" as const, value: y.value }] : []),
    ],
    offset: { x: x?.offset ?? 0, y: y?.offset ?? 0 },
  }
}

function collectCanvasSnapExcludedNodeIds(nodes: readonly CanvasNode[], dragging: ReadonlySet<string>) {
  const childrenByParent = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parentId) continue
    const children = childrenByParent.get(node.parentId) ?? []
    children.push(node.id)
    childrenByParent.set(node.parentId, children)
  }
  const excluded = new Set(dragging)
  const pending = [...dragging]
  while (pending.length > 0) {
    const id = pending.pop()!
    for (const childId of childrenByParent.get(id) ?? []) {
      if (excluded.has(childId)) continue
      excluded.add(childId)
      pending.push(childId)
    }
  }
  return excluded
}

function getCanvasSnapBounds(
  node: CanvasNode,
  nodeById: ReadonlyMap<string, CanvasNode>,
  worldPositionById: Map<string, CanvasPoint>,
): CanvasSnapBounds | undefined {
  const position = getCanvasSnapWorldPosition(node, nodeById, worldPositionById)
  const size = getCanvasNodeSize(node)
  if (
    !position ||
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    return undefined
  }
  return { height: size.height, id: node.id, width: size.width, x: position.x, y: position.y }
}

function getCanvasSnapWorldPosition(
  node: CanvasNode,
  nodeById: ReadonlyMap<string, CanvasNode>,
  cache: Map<string, CanvasPoint>,
): CanvasPoint | undefined {
  const cached = cache.get(node.id)
  if (cached) return cached
  const chain: CanvasNode[] = []
  const visited = new Set<string>()
  let current: CanvasNode | undefined = node
  let origin: CanvasPoint = { x: 0, y: 0 }

  while (current) {
    if (visited.has(current.id)) return undefined
    visited.add(current.id)
    const currentCached = cache.get(current.id)
    if (currentCached) {
      origin = currentCached
      break
    }
    if (!Number.isFinite(current.position.x) || !Number.isFinite(current.position.y)) return undefined
    chain.push(current)
    current = current.parentId ? nodeById.get(current.parentId) : undefined
  }

  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const item = chain[index]
    origin = { x: origin.x + item.position.x, y: origin.y + item.position.y }
    cache.set(item.id, origin)
  }
  return cache.get(node.id)
}

function canvasSnapAnchorValues(bounds: CanvasSnapBounds, axis: "x" | "y") {
  const start = axis === "x" ? bounds.x : bounds.y
  const size = axis === "x" ? bounds.width : bounds.height
  return [
    { anchor: "min" as CanvasSnapAnchor, value: start },
    { anchor: "mid" as CanvasSnapAnchor, value: start + size / 2 },
    { anchor: "max" as CanvasSnapAnchor, value: start + size },
  ]
}

function findBestCanvasSnap(
  axis: "x" | "y",
  dragging: readonly CanvasSnapBounds[],
  candidates: readonly CanvasSnapBounds[],
  tolerance: number,
) {
  let best: { distance: number; offset: number; value: number } | undefined
  for (const moving of dragging) {
    for (const movingAnchor of canvasSnapAnchorValues(moving, axis)) {
      for (const candidate of candidates) {
        for (const candidateAnchor of canvasSnapAnchorValues(candidate, axis)) {
          const offset = candidateAnchor.value - movingAnchor.value
          const distance = Math.abs(offset)
          if (distance > tolerance || (best && distance >= best.distance)) continue
          best = { distance, offset, value: candidateAnchor.value }
        }
      }
    }
  }
  return best
}
