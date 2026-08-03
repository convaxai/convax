import { setCanvasNodeGeometry } from "../commands"
import { getCanvasNodePresentationSize, getCanvasNodeSize } from "../document"
import type { CanvasDocument, CanvasPoint, CanvasSize } from "../types"

export type CanvasAutoLayoutStrategy = "component-packing" | "horizontal-directed-cluster" | "vertical-directed-cluster"
export type CanvasIsolatedNodePlacement = "left" | "preserve"

export interface CanvasAutoLayoutOptions {
  componentGap?: number
  componentPackingScale?: number
  crossGap?: number
  isolatedPlacement?: CanvasIsolatedNodePlacement
  mainGap?: number
  nodeGap?: number
  nodePackingScale?: number
  strategy?: CanvasAutoLayoutStrategy
}

export interface CanvasLayoutNodeSnapshot {
  id: string
  parentId?: string
  position: CanvasPoint
  size: CanvasSize
}

export interface CanvasLayoutEdgeSnapshot {
  source: string
  target: string
}

/** Geometry-only input that is safe to compute outside a mounted Canvas view. */
export interface CanvasLayoutSnapshot {
  edges: readonly CanvasLayoutEdgeSnapshot[]
  nodes: readonly CanvasLayoutNodeSnapshot[]
  revision: number
}

export interface CanvasLayoutPosition {
  nodeId: string
  position: CanvasPoint
  size?: CanvasSize
}

/**
 * A provider proposes positions against one immutable revision. The host still
 * validates and applies the plan as one Canvas mutation.
 */
export interface CanvasLayoutPlan {
  positions: readonly CanvasLayoutPosition[]
  providerId: string
  sourceRevision: number
}

export interface CanvasLayoutProviderRequest<TOptions = unknown> {
  layoutNodeIds?: readonly string[]
  options: TOptions
  snapshot: CanvasLayoutSnapshot
}

/** Transport-neutral contract for built-in or future host-provided layout engines. */
export interface CanvasLayoutProvider<TOptions = unknown> {
  readonly id: string
  compute(
    request: CanvasLayoutProviderRequest<TOptions>,
    signal?: AbortSignal,
  ): CanvasLayoutPlan | Promise<CanvasLayoutPlan>
}

export class CanvasLayoutValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CanvasLayoutValidationError"
  }
}

interface LayoutItem extends CanvasLayoutNodeSnapshot {
  bounds: LayoutRect
}

interface LayoutRect {
  maxX: number
  maxY: number
  minX: number
  minY: number
}

interface LayoutEdge {
  source: string
  target: string
}

interface LayoutComponent {
  bounds: LayoutRect
  center: CanvasPoint
  edges: LayoutEdge[]
  ids: string[]
  isolated: boolean
  items: LayoutItem[]
}

interface ComponentLayout {
  bounds: LayoutRect
  component: LayoutComponent
  positions: Map<string, CanvasPoint>
}

interface LayoutBox extends LayoutRect {
  id: string
}

interface DirectedGraph {
  incoming: Map<string, string[]>
  outgoing: Map<string, string[]>
}

const BUILTIN_LAYOUT_PROVIDER_ID = "convax.directed-cluster"
// Tuned for the real 280-420px Canvas cards. Smaller values made connected
// layers technically non-overlapping but visually read like a compressed grid.
const DEFAULT_COMPONENT_GAP = 240
const DEFAULT_COMPONENT_PACKING_SCALE = 0.78
const DEFAULT_NODE_GAP = 40
const DEFAULT_NODE_PACKING_SCALE = 0.86
const DEFAULT_DIRECTED_ISOLATED_NODE_GAP = 80
const DEFAULT_HORIZONTAL_MAIN_GAP = 240
const DEFAULT_HORIZONTAL_CROSS_GAP = 96
const DEFAULT_VERTICAL_MAIN_GAP = 480
const DEFAULT_VERTICAL_CROSS_GAP = 48
const DIRECTED_ORDER_SWEEPS = 4
const DIRECTED_ALIGN_ITERATIONS = 6

export function createCanvasLayoutSnapshot(document: CanvasDocument): CanvasLayoutSnapshot {
  return {
    edges: document.edges.map((edge) => ({ source: edge.source, target: edge.target })),
    nodes: document.nodes.map((node) => ({
      id: node.id,
      parentId: node.parentId,
      position: { ...node.position },
      size: getCanvasNodePresentationSize(node),
    })),
    revision: document.revision,
  }
}

export const builtinCanvasLayoutProvider: CanvasLayoutProvider<CanvasAutoLayoutOptions> = {
  id: BUILTIN_LAYOUT_PROVIDER_ID,
  compute(request, signal) {
    return computeBuiltinCanvasLayoutPlan(request, signal)
  },
}

export function planCanvasLayout(
  document: CanvasDocument,
  input: { nodeIds?: readonly string[]; options?: CanvasAutoLayoutOptions } = {},
): CanvasLayoutPlan {
  return computeBuiltinCanvasLayoutPlan({
    layoutNodeIds: input.nodeIds,
    options: input.options ?? {},
    snapshot: createCanvasLayoutSnapshot(document),
  })
}

export function computeBuiltinCanvasLayoutPlan(
  request: CanvasLayoutProviderRequest<CanvasAutoLayoutOptions>,
  signal?: AbortSignal,
): CanvasLayoutPlan {
  throwIfAborted(signal)
  validateOptions(request.options)
  const nodeById = validateSnapshot(request.snapshot)
  const layoutIds = resolveLayoutNodeIds(nodeById, request.layoutNodeIds)
  requireSharedCoordinateSpace(layoutIds, nodeById)
  if (layoutIds.length < 2) {
    return {
      positions: layoutIds.map((id) => ({ nodeId: id, position: { ...nodeById.get(id)!.position } })),
      providerId: BUILTIN_LAYOUT_PROVIDER_ID,
      sourceRevision: request.snapshot.revision,
    }
  }

  const ownerEdges = createLayoutOwnerEdges(request.snapshot.edges, nodeById, layoutIds)
  const components = createLayoutComponents(layoutIds, ownerEdges, nodeById)
  const strategy = request.options.strategy ?? "horizontal-directed-cluster"
  const axis = strategy === "vertical-directed-cluster" ? "vertical" : "horizontal"
  const mainGap =
    request.options.mainGap ?? (axis === "horizontal" ? DEFAULT_HORIZONTAL_MAIN_GAP : DEFAULT_VERTICAL_MAIN_GAP)
  const crossGap =
    request.options.crossGap ?? (axis === "horizontal" ? DEFAULT_HORIZONTAL_CROSS_GAP : DEFAULT_VERTICAL_CROSS_GAP)
  const componentGap = request.options.componentGap ?? DEFAULT_COMPONENT_GAP
  const isolatedPlacement =
    request.options.isolatedPlacement ?? (strategy === "component-packing" ? "preserve" : "left")
  const isolatedNodeGap =
    request.options.nodeGap ??
    (strategy === "component-packing" ? DEFAULT_NODE_GAP : DEFAULT_DIRECTED_ISOLATED_NODE_GAP)
  const componentLayouts = components.map((component) => {
    throwIfAborted(signal)
    const positions =
      strategy === "component-packing"
        ? computeConservativeComponentPositions(
            component,
            request.options.nodeGap ?? DEFAULT_NODE_GAP,
            request.options.nodePackingScale ?? DEFAULT_NODE_PACKING_SCALE,
            signal,
          )
        : computeDirectedComponentPositions(component, axis, mainGap, crossGap)
    return {
      bounds:
        getPositionsBounds(positions, new Map(component.items.map((item) => [item.id, item]))) ?? component.bounds,
      component,
      positions,
    }
  })
  const positions = packComponents(
    componentLayouts,
    componentGap,
    request.options.componentPackingScale ?? DEFAULT_COMPONENT_PACKING_SCALE,
    axis,
    isolatedPlacement,
    isolatedNodeGap,
    strategy === "component-packing",
    signal,
  )

  return {
    positions: [...positions]
      .sort(([left], [right]) => compareIds(left, right))
      .map(([nodeId, position]) => ({
        nodeId,
        position: preserveEquivalentRoundedPoint(roundPoint(position), nodeById.get(nodeId)!.position),
      })),
    providerId: BUILTIN_LAYOUT_PROVIDER_ID,
    sourceRevision: request.snapshot.revision,
  }
}

export function applyCanvasLayoutPlan(document: CanvasDocument, plan: CanvasLayoutPlan): CanvasDocument {
  if (plan.sourceRevision !== document.revision) {
    throw new CanvasLayoutValidationError(
      `Canvas layout plan revision conflict: expected ${plan.sourceRevision}, received ${document.revision}`,
    )
  }
  if (!plan.providerId.trim()) throw new CanvasLayoutValidationError("Canvas layout provider id is required")
  const existing = new Set(document.nodes.map((node) => node.id))
  const seen = new Set<string>()
  const geometryById = new Map<string, Omit<CanvasLayoutPosition, "nodeId">>()
  for (const entry of plan.positions) {
    if (!existing.has(entry.nodeId)) {
      throw new CanvasLayoutValidationError(`Canvas layout node was not found: ${entry.nodeId}`)
    }
    if (seen.has(entry.nodeId)) {
      throw new CanvasLayoutValidationError(`Canvas layout contains a duplicate node: ${entry.nodeId}`)
    }
    if (!isFinitePoint(entry.position)) {
      throw new CanvasLayoutValidationError(`Canvas layout position must be finite: ${entry.nodeId}`)
    }
    if (entry.size && !isFiniteSize(entry.size)) {
      throw new CanvasLayoutValidationError(`Canvas layout size must be finite and positive: ${entry.nodeId}`)
    }
    seen.add(entry.nodeId)
    geometryById.set(entry.nodeId, {
      position: { ...entry.position },
      size: entry.size ? { ...entry.size } : undefined,
    })
  }
  return setCanvasNodeGeometry(
    document,
    [...geometryById].map(([nodeId, geometry]) => ({ nodeId, ...geometry })),
  )
}

/** Applies an auto-layout plan and exactly refits its containing group chain. */
export function applyCanvasAutoLayoutPlan(document: CanvasDocument, plan: CanvasLayoutPlan): CanvasDocument {
  const laidOut = applyCanvasLayoutPlan(document, plan)
  if (plan.positions.length < 2) return laidOut
  const nodeById = new Map(laidOut.nodes.map((node) => [node.id, node]))
  const parentIds = new Set(
    plan.positions.flatMap((entry) => {
      const parentId = nodeById.get(entry.nodeId)?.parentId
      return parentId ? [parentId] : []
    }),
  )
  if (parentIds.size !== 1) return laidOut
  return fitCanvasGroupChainToChildren(laidOut, [...parentIds][0]!)
}

function fitCanvasGroupChainToChildren(document: CanvasDocument, startingGroupId: string, padding = 40) {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]))
  const changed = new Set<string>()
  const visited = new Set<string>()
  let groupId: string | undefined = startingGroupId
  while (groupId) {
    if (visited.has(groupId)) throw new CanvasLayoutValidationError("Canvas layout parent cycle detected")
    visited.add(groupId)
    const group = nodeById.get(groupId)
    if (!group || group.data.kind !== "group") break
    const children = [...nodeById.values()].filter((node) => node.parentId === groupId)
    if (children.length === 0) break
    const childBounds = unionRects(
      children.map((child) => {
        const size = getCanvasNodeSize(child)
        return {
          maxX: child.position.x + size.width,
          maxY: child.position.y + size.height,
          minX: child.position.x,
          minY: child.position.y,
        }
      }),
    )!
    const offset = { x: childBounds.minX - padding, y: childBounds.minY - padding }
    const size = {
      height: rectHeight(childBounds) + padding * 2,
      width: rectWidth(childBounds) + padding * 2,
    }
    const nextGroupPosition = { x: group.position.x + offset.x, y: group.position.y + offset.y }
    const groupChanged =
      group.position.x !== nextGroupPosition.x ||
      group.position.y !== nextGroupPosition.y ||
      group.style?.height !== size.height ||
      group.style?.width !== size.width ||
      group.height !== undefined ||
      group.width !== undefined ||
      group.measured !== undefined
    const nextGroup = groupChanged
      ? {
          ...group,
          height: undefined,
          measured: undefined,
          position: nextGroupPosition,
          style: { ...group.style, height: size.height, width: size.width },
          width: undefined,
        }
      : group
    nodeById.set(groupId, nextGroup)
    if (groupChanged) changed.add(groupId)
    for (const child of children) {
      const nextPosition = { x: child.position.x - offset.x, y: child.position.y - offset.y }
      const childChanged = child.position.x !== nextPosition.x || child.position.y !== nextPosition.y
      const nextChild = childChanged ? { ...child, position: nextPosition } : child
      nodeById.set(child.id, nextChild)
      if (childChanged) changed.add(child.id)
    }
    groupId = group.parentId
  }
  if (changed.size === 0) return document
  const nodes = document.nodes.map((node) => nodeById.get(node.id) ?? node)
  const unchanged = nodes.every((node, index) => node === document.nodes[index])
  return unchanged ? document : { ...document, nodes }
}

function validateOptions(options: CanvasAutoLayoutOptions) {
  if (
    options.strategy !== undefined &&
    !["component-packing", "horizontal-directed-cluster", "vertical-directed-cluster"].includes(options.strategy)
  ) {
    throw new CanvasLayoutValidationError(`Canvas layout strategy is not supported: ${String(options.strategy)}`)
  }
  if (options.isolatedPlacement !== undefined && !["left", "preserve"].includes(options.isolatedPlacement)) {
    throw new CanvasLayoutValidationError(
      `Canvas layout isolated placement is not supported: ${String(options.isolatedPlacement)}`,
    )
  }
  for (const [name, value] of [
    ["componentGap", options.componentGap],
    ["crossGap", options.crossGap],
    ["mainGap", options.mainGap],
    ["nodeGap", options.nodeGap],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new CanvasLayoutValidationError(`Canvas layout ${name} must be a finite non-negative number`)
    }
  }
  if (
    options.componentPackingScale !== undefined &&
    (!Number.isFinite(options.componentPackingScale) ||
      options.componentPackingScale <= 0 ||
      options.componentPackingScale > 1)
  ) {
    throw new CanvasLayoutValidationError("Canvas layout componentPackingScale must be greater than 0 and at most 1")
  }
  if (
    options.nodePackingScale !== undefined &&
    (!Number.isFinite(options.nodePackingScale) || options.nodePackingScale <= 0 || options.nodePackingScale > 1)
  ) {
    throw new CanvasLayoutValidationError("Canvas layout nodePackingScale must be greater than 0 and at most 1")
  }
}

function validateSnapshot(snapshot: CanvasLayoutSnapshot) {
  if (!Number.isFinite(snapshot.revision) || snapshot.revision < 0) {
    throw new CanvasLayoutValidationError("Canvas layout revision must be a finite non-negative number")
  }
  const nodeById = new Map<string, CanvasLayoutNodeSnapshot>()
  for (const node of snapshot.nodes) {
    if (!node.id || nodeById.has(node.id)) {
      throw new CanvasLayoutValidationError(`Canvas layout node id is invalid or duplicated: ${node.id}`)
    }
    if (!isFinitePoint(node.position) || !isFiniteSize(node.size)) {
      throw new CanvasLayoutValidationError(`Canvas layout geometry is invalid: ${node.id}`)
    }
    nodeById.set(node.id, node)
  }
  for (const node of snapshot.nodes) {
    if (node.parentId !== undefined && !nodeById.has(node.parentId)) {
      throw new CanvasLayoutValidationError(`Canvas layout parent was not found: ${node.parentId}`)
    }
  }
  return nodeById
}

function resolveLayoutNodeIds(
  nodeById: ReadonlyMap<string, CanvasLayoutNodeSnapshot>,
  requestedIds: readonly string[] | undefined,
) {
  const requested =
    requestedIds === undefined
      ? [...nodeById.values()].filter((node) => node.parentId === undefined).map((node) => node.id)
      : [...new Set(requestedIds)]
  const missing = requested.find((id) => !nodeById.has(id))
  if (missing) throw new CanvasLayoutValidationError(`Canvas layout node was not found: ${missing}`)
  const selected = new Set(requested)
  return requested
    .filter((id) => {
      const visited = new Set<string>()
      let parentId = nodeById.get(id)?.parentId
      while (parentId) {
        if (visited.has(parentId)) throw new CanvasLayoutValidationError("Canvas layout parent cycle detected")
        if (selected.has(parentId)) return false
        visited.add(parentId)
        parentId = nodeById.get(parentId)?.parentId
      }
      return true
    })
    .sort((left, right) => compareItems(nodeToItem(nodeById.get(left)!), nodeToItem(nodeById.get(right)!)))
}

function requireSharedCoordinateSpace(ids: readonly string[], nodeById: ReadonlyMap<string, CanvasLayoutNodeSnapshot>) {
  const parentIds = new Set(ids.map((id) => nodeById.get(id)?.parentId ?? null))
  if (parentIds.size > 1) {
    throw new CanvasLayoutValidationError("Canvas auto-layout nodes must share one parent coordinate space")
  }
}

function resolveLayoutOwnerId(
  id: string,
  layoutIds: ReadonlySet<string>,
  nodeById: ReadonlyMap<string, CanvasLayoutNodeSnapshot>,
) {
  const visited = new Set<string>()
  let currentId: string | undefined = id
  while (currentId) {
    if (layoutIds.has(currentId)) return currentId
    if (visited.has(currentId)) return undefined
    visited.add(currentId)
    currentId = nodeById.get(currentId)?.parentId
  }
  return undefined
}

function createLayoutOwnerEdges(
  edges: readonly CanvasLayoutEdgeSnapshot[],
  nodeById: ReadonlyMap<string, CanvasLayoutNodeSnapshot>,
  ids: readonly string[],
): LayoutEdge[] {
  const layoutIds = new Set(ids)
  const seen = new Set<string>()
  const result: LayoutEdge[] = []
  for (const edge of edges) {
    const source = resolveLayoutOwnerId(edge.source, layoutIds, nodeById)
    const target = resolveLayoutOwnerId(edge.target, layoutIds, nodeById)
    if (!source || !target || source === target) continue
    const key = JSON.stringify([source, target])
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ source, target })
  }
  return result.sort((left, right) => compareIds(left.source, right.source) || compareIds(left.target, right.target))
}

function createLayoutComponents(
  ids: readonly string[],
  edges: readonly LayoutEdge[],
  nodeById: ReadonlyMap<string, CanvasLayoutNodeSnapshot>,
): LayoutComponent[] {
  const itemById = new Map(ids.map((id) => [id, nodeToItem(nodeById.get(id)!)]))
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]))
  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target)
    adjacency.get(edge.target)?.add(edge.source)
  }
  const visited = new Set<string>()
  const components: LayoutComponent[] = []
  for (const id of ids) {
    if (visited.has(id)) continue
    const componentIds: string[] = []
    const stack = [id]
    visited.add(id)
    while (stack.length > 0) {
      const current = stack.pop()!
      componentIds.push(current)
      const neighbors = [...(adjacency.get(current) ?? [])]
        .filter((neighbor) => !visited.has(neighbor))
        .sort((left, right) => compareItems(itemById.get(left)!, itemById.get(right)!))
      for (const neighbor of neighbors.reverse()) {
        visited.add(neighbor)
        stack.push(neighbor)
      }
    }
    componentIds.sort((left, right) => compareItems(itemById.get(left)!, itemById.get(right)!))
    const items = componentIds.map((componentId) => itemById.get(componentId)!)
    const bounds = unionRects(items.map((item) => item.bounds))!
    const componentIdsSet = new Set(componentIds)
    const componentEdges = edges.filter((edge) => componentIdsSet.has(edge.source) && componentIdsSet.has(edge.target))
    components.push({
      bounds,
      center: rectCenter(bounds),
      edges: componentEdges,
      ids: componentIds,
      isolated: componentIds.length === 1 && componentEdges.length === 0,
      items,
    })
  }
  return components
}

function nodeToItem(node: CanvasLayoutNodeSnapshot): LayoutItem {
  return {
    ...node,
    bounds: {
      maxX: node.position.x + node.size.width,
      maxY: node.position.y + node.size.height,
      minX: node.position.x,
      minY: node.position.y,
    },
  }
}

function computeDirectedComponentPositions(
  component: LayoutComponent,
  axis: "horizontal" | "vertical",
  mainGap: number,
  crossGap: number,
) {
  if (component.items.length < 2 || component.edges.length === 0) {
    return new Map(component.items.map((item) => [item.id, { x: 0, y: 0 }]))
  }
  const itemById = new Map(component.items.map((item) => [item.id, item]))
  const graph = createAcyclicDirectedGraph(component.ids, component.edges)
  const layers = createDirectedLayers(component.ids, graph)
  const crossById = assignLayerCrossPositions(layers, graph, itemById, axis, crossGap)
  const mainByLayer: number[] = []
  let main = 0
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index]!
    mainByLayer[index] = main
    main += Math.max(0, ...layer.map((id) => getMainSize(itemById.get(id)!, axis))) + mainGap
  }
  const positions = new Map<string, CanvasPoint>()
  layers.forEach((layer, layerIndex) => {
    for (const id of layer) {
      const cross = crossById.get(id) ?? 0
      positions.set(
        id,
        axis === "horizontal" ? { x: mainByLayer[layerIndex]!, y: cross } : { x: cross, y: mainByLayer[layerIndex]! },
      )
    }
  })
  return positions
}

/** Conservative alternative that preserves the current mental map. */
function computeConservativeComponentPositions(
  component: LayoutComponent,
  nodeGap: number,
  packingScale: number,
  signal?: AbortSignal,
) {
  if (component.items.length < 2) {
    return new Map(component.items.map((item) => [item.id, { ...item.position }]))
  }
  const boxes = component.items.map((item) => createBox(item.id, item.bounds))
  packBoxesForward(boxes, nodeGap * packingScale, "vertical", signal)
  return new Map(boxes.map((box) => [box.id, { x: box.minX, y: box.minY }]))
}

/** DFS omits only gray-target back edges, retaining a deterministic DAG subset. */
function createAcyclicDirectedGraph(ids: readonly string[], edges: readonly LayoutEdge[]): DirectedGraph {
  const adjacency = new Map(ids.map((id) => [id, [] as string[]]))
  const seen = new Set<string>()
  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target) || edge.source === edge.target) continue
    const key = JSON.stringify([edge.source, edge.target])
    if (seen.has(key)) continue
    seen.add(key)
    adjacency.get(edge.source)!.push(edge.target)
  }
  for (const neighbors of adjacency.values()) {
    neighbors.sort(compareIds)
  }
  const incoming = new Map(ids.map((id) => [id, [] as string[]]))
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]))
  const state = new Map(ids.map((id) => [id, 0 as 0 | 1 | 2]))
  const order = [...ids].sort(compareIds)
  for (const start of order) {
    if (state.get(start) !== 0) continue
    const stack: Array<{ id: string; index: number }> = [{ id: start, index: 0 }]
    state.set(start, 1)
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!
      const neighbors = adjacency.get(frame.id)!
      if (frame.index >= neighbors.length) {
        state.set(frame.id, 2)
        stack.pop()
        continue
      }
      const next = neighbors[frame.index++]!
      if (state.get(next) === 1) continue
      outgoing.get(frame.id)!.push(next)
      incoming.get(next)!.push(frame.id)
      if (state.get(next) === 0) {
        state.set(next, 1)
        stack.push({ id: next, index: 0 })
      }
    }
  }
  return { incoming, outgoing }
}

function createDirectedLayers(ids: readonly string[], graph: DirectedGraph) {
  const indegree = new Map(ids.map((id) => [id, graph.incoming.get(id)?.length ?? 0]))
  const ranks = new Map(ids.map((id) => [id, 0]))
  const queue = ids.filter((id) => indegree.get(id) === 0).sort(compareIds)
  let head = 0
  while (head < queue.length) {
    const id = queue[head++]!
    for (const next of graph.outgoing.get(id) ?? []) {
      ranks.set(next, Math.max(ranks.get(next) ?? 0, (ranks.get(id) ?? 0) + 1))
      const remaining = (indegree.get(next) ?? 0) - 1
      indegree.set(next, remaining)
      if (remaining === 0) queue.push(next)
    }
  }
  const layers = Array.from({ length: Math.max(0, ...ranks.values()) + 1 }, () => [] as string[])
  for (const id of ids) layers[ranks.get(id) ?? 0]!.push(id)
  for (const layer of layers) {
    layer.sort(compareIds)
  }
  orderLayers(layers, graph)
  return layers
}

function orderLayers(layers: string[][], graph: DirectedGraph) {
  const indexById = new Map<string, number>()
  const reindex = (layer: readonly string[]) => layer.forEach((id, index) => indexById.set(id, index))
  layers.forEach(reindex)
  for (let sweep = 0; sweep < DIRECTED_ORDER_SWEEPS; sweep += 1) {
    const downward = sweep % 2 === 0
    const indexes = downward
      ? Array.from({ length: Math.max(0, layers.length - 1) }, (_, index) => index + 1)
      : Array.from({ length: Math.max(0, layers.length - 1) }, (_, index) => layers.length - index - 2)
    for (const layerIndex of indexes) {
      const layer = layers[layerIndex]!
      const currentIndex = new Map(layer.map((id, index) => [id, index]))
      const keyById = new Map<string, number>()
      for (const id of layer) {
        const neighbors = downward ? (graph.incoming.get(id) ?? []) : (graph.outgoing.get(id) ?? [])
        const median = medianOf(
          neighbors.flatMap((neighbor) => {
            const index = indexById.get(neighbor)
            return index === undefined ? [] : [index]
          }),
        )
        keyById.set(id, median < 0 ? (currentIndex.get(id) ?? 0) : median)
      }
      layer.sort((left, right) => (keyById.get(left) ?? 0) - (keyById.get(right) ?? 0) || compareIds(left, right))
      reindex(layer)
    }
  }
}

function assignLayerCrossPositions(
  layers: readonly string[][],
  graph: DirectedGraph,
  itemById: ReadonlyMap<string, LayoutItem>,
  axis: "horizontal" | "vertical",
  crossGap: number,
) {
  const start = new Map<string, number>()
  const center = new Map<string, number>()
  for (const layer of layers) {
    let offset = 0
    for (const id of layer) {
      const size = getCrossSize(itemById.get(id)!, axis)
      start.set(id, offset)
      center.set(id, offset + size / 2)
      offset += size + crossGap
    }
  }
  for (let iteration = 0; iteration < DIRECTED_ALIGN_ITERATIONS; iteration += 1) {
    const downward = iteration % 2 === 0
    const orderedLayers = downward ? layers : [...layers].reverse()
    for (const layer of orderedLayers) {
      if (layer.length === 0) continue
      const desiredCenter = new Map<string, number>()
      for (const id of layer) {
        const primary = downward ? (graph.incoming.get(id) ?? []) : (graph.outgoing.get(id) ?? [])
        const fallback = [...(graph.incoming.get(id) ?? []), ...(graph.outgoing.get(id) ?? [])]
        const references = primary.length > 0 ? primary : fallback
        const centers = references.flatMap((neighbor) => {
          const value = center.get(neighbor)
          return value === undefined ? [] : [value]
        })
        desiredCenter.set(id, centers.length > 0 ? meanOf(centers) : (center.get(id) ?? 0))
      }
      const starts = layer.map(
        (id) => (desiredCenter.get(id) ?? center.get(id) ?? 0) - getCrossSize(itemById.get(id)!, axis) / 2,
      )
      for (let index = 1; index < starts.length; index += 1) {
        starts[index] = Math.max(
          starts[index]!,
          starts[index - 1]! + getCrossSize(itemById.get(layer[index - 1]!)!, axis) + crossGap,
        )
      }
      const currentCenters = layer.map((id, index) => starts[index]! + getCrossSize(itemById.get(id)!, axis) / 2)
      const desiredCenters = layer.map((id) => desiredCenter.get(id) ?? center.get(id) ?? 0)
      const shift = meanOf(desiredCenters) - meanOf(currentCenters)
      layer.forEach((id, index) => {
        const nextStart = starts[index]! + shift
        start.set(id, nextStart)
        center.set(id, nextStart + getCrossSize(itemById.get(id)!, axis) / 2)
      })
    }
  }
  return start
}

function packComponents(
  layouts: readonly ComponentLayout[],
  gap: number,
  packingScale: number,
  axis: "horizontal" | "vertical",
  isolatedPlacement: CanvasIsolatedNodePlacement,
  isolatedNodeGap: number,
  preserveComponentPositions: boolean,
  signal?: AbortSignal,
) {
  const connected = layouts.filter((layout) => !layout.component.isolated)
  const isolated = layouts.filter((layout) => layout.component.isolated)
  const packedConnected = packConnectedLayouts(connected, gap * packingScale, axis, preserveComponentPositions, signal)
  const boxes = packedConnected.map((entry) => entry.box)
  const result = new Map<string, CanvasPoint>()
  packedConnected.forEach(({ layout }, index) => {
    const box = boxes[index]!
    translateComponentPositions(layout, box, result)
  })

  if (isolatedPlacement === "left" && isolated.length > 0) {
    const connectedBounds = unionRects(boxes)
    const originalBounds = unionRects(layouts.map((layout) => layout.component.bounds))
    const isolatedBoxes = connectedBounds
      ? placeIsolatedLayoutsLeft(isolated, connectedBounds, gap, isolatedNodeGap)
      : placeOnlyIsolatedLayouts(isolated, originalBounds!, axis, isolatedNodeGap)
    isolated.forEach((layout, index) => {
      throwIfAborted(signal)
      translateComponentPositions(layout, isolatedBoxes[index]!, result)
    })
    return result
  }

  const placedBoxes = [...boxes]
  const packingAxis = axis === "horizontal" ? "vertical" : "horizontal"
  for (let index = 0; index < isolated.length; index += 1) {
    throwIfAborted(signal)
    const layout = isolated[index]!
    const source = createBox(`isolated-${index}`, layout.component.bounds)
    const box = packBoxForward(source, placedBoxes, gap, packingAxis)
    translateComponentPositions(layout, box, result)
    placedBoxes.push(box)
  }
  return result
}

/**
 * Directed clusters use a deterministic cross-axis shelf. Conservative
 * component packing keeps the current component centers and resolves only
 * collisions. Both are canonical after one pass and cannot drift on repeat.
 */
function packConnectedLayouts(
  layouts: readonly ComponentLayout[],
  gap: number,
  axis: "horizontal" | "vertical",
  preservePositions: boolean,
  signal?: AbortSignal,
) {
  if (layouts.length === 0) return []
  const sorted = [...layouts].sort((left, right) => {
    const leftCenter = left.component.center
    const rightCenter = right.component.center
    return axis === "horizontal"
      ? leftCenter.y - rightCenter.y ||
          leftCenter.x - rightCenter.x ||
          compareIds(componentStableId(left.component), componentStableId(right.component))
      : leftCenter.x - rightCenter.x ||
          leftCenter.y - rightCenter.y ||
          compareIds(componentStableId(left.component), componentStableId(right.component))
  })
  const originalBounds = unionRects(sorted.map((layout) => layout.component.bounds))!
  const entries = sorted.map((layout, index) => {
    const currentCenter = rectCenter(layout.bounds)
    return {
      box: createBox(
        `connected-${index}`,
        translateRect(
          layout.bounds,
          layout.component.center.x - currentCenter.x,
          layout.component.center.y - currentCenter.y,
        ),
      ),
      layout,
    }
  })
  if (preservePositions) {
    const boxes = entries.map((entry) => entry.box)
    packBoxesForward(boxes, gap, axis === "horizontal" ? "vertical" : "horizontal", signal)
    return entries.map((entry, index) => ({ ...entry, box: boxes[index]! }))
  }
  let x = originalBounds.minX
  let y = originalBounds.minY
  return entries.map((entry, index) => {
    throwIfAborted(signal)
    const width = rectWidth(entry.box)
    const height = rectHeight(entry.box)
    const box = createBox(`connected-${index}`, {
      maxX: x + width,
      maxY: y + height,
      minX: x,
      minY: y,
    })
    if (axis === "horizontal") y += height + gap
    else x += width + gap
    return { box, layout: entry.layout }
  })
}

/**
 * Directed layout treats unrelated cards as an explicit shelf to the left of
 * the connected graph. This makes tidy useful on real media canvases where
 * many cards have no edge yet, while avoiding a whole-canvas grid fallback.
 */
function placeIsolatedLayoutsLeft(
  layouts: readonly ComponentLayout[],
  region: LayoutRect,
  columnGap: number,
  nodeGap: number,
) {
  const sorted = sortIsolatedLayouts(layouts)
  const targetHeight = Math.max(rectHeight(region), ...sorted.map((layout) => rectHeight(layout.bounds)))
  const columns: ComponentLayout[][] = []
  let column: ComponentLayout[] = []
  let columnHeight = 0
  for (const layout of sorted) {
    const height = rectHeight(layout.bounds)
    if (column.length > 0 && columnHeight + nodeGap + height > targetHeight) {
      columns.push(column)
      column = []
      columnHeight = 0
    }
    column.push(layout)
    columnHeight += (column.length > 1 ? nodeGap : 0) + height
  }
  if (column.length > 0) columns.push(column)

  const boxById = new Map<string, LayoutBox>()
  let columnRight = region.minX - columnGap
  columns.forEach((current, columnIndex) => {
    const width = Math.max(...current.map((layout) => rectWidth(layout.bounds)))
    const left = columnRight - width
    let top = region.minY
    current.forEach((layout, rowIndex) => {
      const id = isolatedLayoutId(layout)
      const itemWidth = rectWidth(layout.bounds)
      const itemHeight = rectHeight(layout.bounds)
      boxById.set(
        id,
        createBox(`isolated-${columnIndex}-${rowIndex}`, {
          maxX: left + itemWidth,
          maxY: top + itemHeight,
          minX: left,
          minY: top,
        }),
      )
      top += itemHeight + nodeGap
    })
    columnRight = left - columnGap
  })
  return layouts.map((layout) => boxById.get(isolatedLayoutId(layout))!)
}

/** With no graph at all, compact cards along the directed layout's cross axis. */
function placeOnlyIsolatedLayouts(
  layouts: readonly ComponentLayout[],
  originalBounds: LayoutRect,
  axis: "horizontal" | "vertical",
  nodeGap: number,
) {
  const sorted = sortIsolatedLayouts(layouts)
  let x = originalBounds.minX
  let y = originalBounds.minY
  const boxById = new Map<string, LayoutBox>()
  sorted.forEach((layout, index) => {
    const id = isolatedLayoutId(layout)
    const width = rectWidth(layout.bounds)
    const height = rectHeight(layout.bounds)
    boxById.set(
      id,
      createBox(`isolated-only-${index}`, {
        maxX: x + width,
        maxY: y + height,
        minX: x,
        minY: y,
      }),
    )
    if (axis === "horizontal") y += height + nodeGap
    else x += width + nodeGap
  })
  return layouts.map((layout) => boxById.get(isolatedLayoutId(layout))!)
}

function sortIsolatedLayouts(layouts: readonly ComponentLayout[]) {
  return [...layouts].sort((left, right) => compareIds(isolatedLayoutId(left), isolatedLayoutId(right)))
}

function isolatedLayoutId(layout: ComponentLayout) {
  return layout.component.ids[0]!
}

function componentStableId(component: LayoutComponent) {
  return [...component.ids].sort(compareIds)[0]!
}

function translateComponentPositions(layout: ComponentLayout, box: LayoutBox, target: Map<string, CanvasPoint>) {
  const dx = box.minX - layout.bounds.minX
  const dy = box.minY - layout.bounds.minY
  for (const [id, position] of layout.positions) target.set(id, { x: position.x + dx, y: position.y + dy })
}

function packBoxForward(source: LayoutBox, placed: readonly LayoutBox[], gap: number, axis: "horizontal" | "vertical") {
  const packed = { ...source }
  const blockers = placed
    .filter((candidate) =>
      axis === "vertical"
        ? packed.minX < candidate.maxX + gap && packed.maxX + gap > candidate.minX
        : packed.minY < candidate.maxY + gap && packed.maxY + gap > candidate.minY,
    )
    .sort((left, right) =>
      axis === "vertical"
        ? left.minY - right.minY || left.maxY - right.maxY || compareIds(left.id, right.id)
        : left.minX - right.minX || left.maxX - right.maxX || compareIds(left.id, right.id),
    )
  for (const blocker of blockers) {
    if (axis === "vertical") {
      if (packed.maxY + gap <= blocker.minY) break
      if (packed.minY >= blocker.maxY + gap) continue
      translateBox(packed, 0, ceilLayoutCoordinate(blocker.maxY + gap) - packed.minY)
    } else {
      if (packed.maxX + gap <= blocker.minX) break
      if (packed.minX >= blocker.maxX + gap) continue
      translateBox(packed, ceilLayoutCoordinate(blocker.maxX + gap) - packed.minX, 0)
    }
  }
  return packed
}

/**
 * Preserve existing boxes when possible and move only colliding boxes forward
 * on one axis. The interval sweep is bounded, deterministic and idempotent;
 * unlike pairwise relaxation it cannot oscillate or freeze the renderer.
 */
function packBoxesForward(boxes: LayoutBox[], gap: number, axis: "horizontal" | "vertical", signal?: AbortSignal) {
  const entries = boxes
    .map((box, index) => ({ box: { ...box }, index }))
    .sort((left, right) => {
      if (axis === "vertical") {
        return left.box.minY - right.box.minY || left.box.minX - right.box.minX || compareIds(left.box.id, right.box.id)
      }
      return left.box.minX - right.box.minX || left.box.minY - right.box.minY || compareIds(left.box.id, right.box.id)
    })
  const placed: LayoutBox[] = []
  for (const entry of entries) {
    throwIfAborted(signal)
    const packed = packBoxForward(entry.box, placed, gap, axis)
    boxes[entry.index] = packed
    placed.push(packed)
  }
}

function getPositionsBounds(positions: ReadonlyMap<string, CanvasPoint>, itemById: ReadonlyMap<string, LayoutItem>) {
  return unionRects(
    [...positions].flatMap(([id, position]) => {
      const item = itemById.get(id)
      return item
        ? [
            {
              maxX: position.x + item.size.width,
              maxY: position.y + item.size.height,
              minX: position.x,
              minY: position.y,
            },
          ]
        : []
    }),
  )
}

function unionRects(rects: readonly LayoutRect[]) {
  if (rects.length === 0) return undefined
  return {
    maxX: Math.max(...rects.map((rect) => rect.maxX)),
    maxY: Math.max(...rects.map((rect) => rect.maxY)),
    minX: Math.min(...rects.map((rect) => rect.minX)),
    minY: Math.min(...rects.map((rect) => rect.minY)),
  }
}

function createBox(id: string, rect: LayoutRect): LayoutBox {
  return { id, ...rect }
}

function translateRect<T extends LayoutRect>(rect: T, x: number, y: number): T {
  return { ...rect, maxX: rect.maxX + x, maxY: rect.maxY + y, minX: rect.minX + x, minY: rect.minY + y }
}

function translateBox(box: LayoutBox, x: number, y: number) {
  box.maxX += x
  box.maxY += y
  box.minX += x
  box.minY += y
}

function rectCenter(rect: LayoutRect) {
  return { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 }
}

function rectWidth(rect: LayoutRect) {
  return rect.maxX - rect.minX
}

function rectHeight(rect: LayoutRect) {
  return rect.maxY - rect.minY
}

function getMainSize(item: LayoutItem, axis: "horizontal" | "vertical") {
  return axis === "horizontal" ? item.size.width : item.size.height
}

function getCrossSize(item: LayoutItem, axis: "horizontal" | "vertical") {
  return axis === "horizontal" ? item.size.height : item.size.width
}

function compareItems(left: LayoutItem, right: LayoutItem) {
  return left.position.y - right.position.y || left.position.x - right.position.x || compareIds(left.id, right.id)
}

function compareIds(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function medianOf(values: readonly number[]) {
  if (values.length === 0) return -1
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function meanOf(values: readonly number[]) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function isFinitePoint(point: CanvasPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function isFiniteSize(size: CanvasSize) {
  return Number.isFinite(size.width) && size.width > 0 && Number.isFinite(size.height) && size.height > 0
}

function roundPoint(point: CanvasPoint) {
  return { x: roundCoordinate(point.x), y: roundCoordinate(point.y) }
}

function roundCoordinate(value: number) {
  return Math.round(value * 1_000) / 1_000
}

function ceilLayoutCoordinate(value: number) {
  const rounded = roundCoordinate(value)
  return rounded + 1e-9 < value ? rounded + 0.001 : rounded
}

function preserveEquivalentRoundedPoint(next: CanvasPoint, current: CanvasPoint): CanvasPoint {
  const epsilon = 0.001_001
  return {
    x: Math.abs(next.x - current.x) <= epsilon ? current.x : next.x,
    y: Math.abs(next.y - current.y) <= epsilon ? current.y : next.y,
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Canvas layout was cancelled", "AbortError")
}
