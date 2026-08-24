import { getCanvasNodePresentationSize } from "../document"
import { isCanvasGroupFolded } from "../group-fold"
import {
  appendCanvasPlacementIndex,
  bindCanvasDocumentPlacementIndex,
  createCanvasPlacementIndex,
  primeCanvasDocumentPlacementIndexes,
  queryCanvasPlacementViewport,
  type CanvasPlacementIndex,
} from "../resource-placement"
import type { CanvasDocument, CanvasEdge, CanvasNode } from "../types"

export const CANVAS_RENDERER_VIEWPORT_MAX_NODES = 256
export const CANVAS_RENDERER_VIEWPORT_MAX_EDGES = 512

export interface CanvasRendererViewportRect {
  readonly height: number
  readonly width: number
  readonly x: number
  readonly y: number
}

export interface CanvasRendererViewportQuery {
  readonly focusedGroupId?: string | null
  readonly pinnedNodeIds?: readonly string[]
  readonly rect: CanvasRendererViewportRect
}

export interface CanvasRendererViewportProjection {
  readonly edges: readonly CanvasEdge[]
  readonly nodes: readonly CanvasNode[]
  readonly truncated: boolean
}

interface CanvasRendererViewportNodeRecord {
  readonly depth: number
  readonly node: CanvasNode
}

interface CanvasRendererViewportIndexState {
  readonly document: CanvasDocument
  readonly edgesByEndpointPair: Map<string, Map<string, CanvasEdge[]>>
  readonly nodesById: Map<string, CanvasRendererViewportNodeRecord>
  readonly scopes: Map<string, CanvasPlacementIndex>
}

let coldNodeVisits = 0
let coldEdgeVisits = 0
let patchNodeVisits = 0
let patchEdgeVisits = 0
let viewportNodeVisits = 0
let viewportEdgeVisits = 0
let viewportAncestryVisits = 0

/** Package-private structural evidence. */
export function canvasRendererViewportWorkCounts() {
  return Object.freeze({
    coldEdgeVisits,
    coldNodeVisits,
    patchEdgeVisits,
    patchNodeVisits,
    viewportAncestryVisits,
    viewportEdgeVisits,
    viewportNodeVisits,
  })
}

export class CanvasRendererViewportIndex {
  #state: CanvasRendererViewportIndexState

  constructor(document: CanvasDocument) {
    this.#state = buildState(document)
  }

  reset(document: CanvasDocument) {
    this.#state = buildState(document)
  }

  append(input: Readonly<{ readonly edges: readonly CanvasEdge[]; readonly nodes: readonly CanvasNode[] }>) {
    const state = this.#state
    for (const node of input.nodes) {
      patchNodeVisits += 1
      if (state.nodesById.has(node.id)) throw new TypeError(`Canvas viewport append overwrote node ${node.id}`)
      const parent = node.parentId ? state.nodesById.get(node.parentId) : undefined
      if (node.parentId && !parent) throw new TypeError(`Canvas viewport append parent is unavailable ${node.parentId}`)
      state.nodesById.set(node.id, Object.freeze({ depth: (parent?.depth ?? -1) + 1, node }))
      const scopeKey = node.parentId ?? ""
      const obstacle = { key: node.id, ...node.position, ...getCanvasNodePresentationSize(node) }
      const current = state.scopes.get(scopeKey) ?? createCanvasPlacementIndex([])
      const next = appendCanvasPlacementIndex(current, [obstacle])
      state.scopes.set(scopeKey, next)
      bindCanvasDocumentPlacementIndex(state.document, next, node.parentId)
    }
    for (const edge of input.edges) {
      patchEdgeVisits += 1
      if (!state.nodesById.has(edge.source) || !state.nodesById.has(edge.target)) {
        throw new TypeError(`Canvas viewport append edge endpoint is unavailable ${edge.id}`)
      }
      const targets = state.edgesByEndpointPair.get(edge.source) ?? new Map<string, CanvasEdge[]>()
      const bucket = targets.get(edge.target) ?? []
      bucket.push(edge)
      targets.set(edge.target, bucket)
      state.edgesByEndpointPair.set(edge.source, targets)
    }
  }

  resolveNode(nodeId: string) {
    return this.#state.nodesById.get(nodeId)?.node
  }

  query(input: CanvasRendererViewportQuery): CanvasRendererViewportProjection {
    const rect = requireViewportRect(input.rect)
    const focusedGroupId = input.focusedGroupId ?? null
    const focused = focusedGroupId ? this.#state.nodesById.get(focusedGroupId)?.node : undefined
    const rootScope = focused?.data.kind === "group" ? focused.id : undefined
    const selected = new Map<string, CanvasRendererViewportNodeRecord>()
    let truncated = false
    let remainingAncestryVisits = CANVAS_RENDERER_VIEWPORT_MAX_NODES

    const include = (record: CanvasRendererViewportNodeRecord | undefined) => {
      if (!record || selected.has(record.node.id)) return true
      if (selected.size >= CANVAS_RENDERER_VIEWPORT_MAX_NODES) {
        truncated = true
        return false
      }
      viewportNodeVisits += 1
      selected.set(record.node.id, record)
      return true
    }

    if (focused) include(this.#state.nodesById.get(focused.id))
    for (const nodeId of normalizePins(input.pinnedNodeIds)) {
      const chain: CanvasRendererViewportNodeRecord[] = []
      const visited = new Set<string>()
      let current = this.#state.nodesById.get(nodeId)
      let admitted = rootScope === undefined
      while (current && !visited.has(current.node.id)) {
        if (remainingAncestryVisits === 0) {
          truncated = true
          break
        }
        remainingAncestryVisits -= 1
        viewportAncestryVisits += 1
        visited.add(current.node.id)
        chain.push(current)
        if (current.node.id === rootScope) {
          admitted = true
          break
        }
        const parent = current.node.parentId ? this.#state.nodesById.get(current.node.parentId) : undefined
        if (parent && isCanvasGroupFolded(parent.node) && parent.node.id !== rootScope) {
          chain.length = 0
          chain.push(parent)
          admitted = rootScope === undefined || parent.node.id === rootScope
          break
        }
        current = parent
      }
      if (!admitted) continue
      for (let index = chain.length - 1; index >= 0; index -= 1) {
        if (!include(chain[index])) break
      }
    }

    const scopes: Array<{ parentId: string | undefined; rect: CanvasRendererViewportRect }> = [
      { parentId: rootScope, rect },
    ]
    const visitedScopes = new Set<string>()
    while (scopes.length > 0 && selected.size < CANVAS_RENDERER_VIEWPORT_MAX_NODES) {
      const scope = scopes.shift()!
      const scopeKey = scope.parentId ?? ""
      if (visitedScopes.has(scopeKey)) continue
      visitedScopes.add(scopeKey)
      const index = this.#state.scopes.get(scopeKey)
      if (!index) continue
      const remaining = CANVAS_RENDERER_VIEWPORT_MAX_NODES - selected.size
      const ids = queryCanvasPlacementViewport(index, scope.rect, remaining)
      if (ids.length === remaining && index.size > ids.length) truncated = true
      for (const id of ids) {
        const record = this.#state.nodesById.get(id)
        if (!include(record) || !record || record.node.data.kind !== "group" || isCanvasGroupFolded(record.node)) continue
        scopes.push({
          parentId: record.node.id,
          rect: Object.freeze({
            height: scope.rect.height,
            width: scope.rect.width,
            x: scope.rect.x - record.node.position.x,
            y: scope.rect.y - record.node.position.y,
          }),
        })
      }
    }

    const nodes = [...selected.values()]
      .sort((left, right) => left.depth - right.depth || compareId(left.node.id, right.node.id))
      .map(({ node }) => node)
    const nodeIds = new Set(nodes.map((node) => node.id))
    const edges: CanvasEdge[] = []
    outer: for (const source of nodes) {
      const targets = this.#state.edgesByEndpointPair.get(source.id)
      if (!targets) continue
      // Both loops are bounded by V. Exact pair lookup avoids traversing a
      // visible source's unbounded degree toward off-screen targets.
      for (const target of nodes) {
        const bucket = targets.get(target.id)
        if (!bucket) continue
        for (const edge of bucket) {
          viewportEdgeVisits += 1
          if (!nodeIds.has(edge.target)) continue
          if (edges.length >= CANVAS_RENDERER_VIEWPORT_MAX_EDGES) {
            truncated = true
            break outer
          }
          edges.push(edge)
        }
      }
    }
    return Object.freeze({
      edges: Object.freeze(edges),
      nodes: Object.freeze(nodes),
      truncated,
    })
  }
}

function buildState(document: CanvasDocument): CanvasRendererViewportIndexState {
  const nodesById = new Map<string, CanvasRendererViewportNodeRecord>()
  const sourceNodes = new Map(document.nodes.map((node) => [node.id, node]))
  const depthById = new Map<string, number>()
  const depthFor = (node: CanvasNode): number => {
    const cached = depthById.get(node.id)
    if (cached !== undefined) return cached
    const path: CanvasNode[] = []
    const seen = new Set<string>()
    let current: CanvasNode | undefined = node
    while (current && !seen.has(current.id) && depthById.get(current.id) === undefined) {
      path.push(current)
      seen.add(current.id)
      current = current.parentId ? sourceNodes.get(current.parentId) : undefined
    }
    let depth = current ? (depthById.get(current.id) ?? -1) + 1 : 0
    for (let index = path.length - 1; index >= 0; index -= 1) {
      const item = path[index]!
      depthById.set(item.id, depth)
      depth += 1
    }
    return depthById.get(node.id) ?? 0
  }
  for (const node of document.nodes) {
    coldNodeVisits += 1
    nodesById.set(node.id, Object.freeze({ depth: depthFor(node), node }))
  }
  const edgesByEndpointPair = new Map<string, Map<string, CanvasEdge[]>>()
  for (const edge of document.edges) {
    coldEdgeVisits += 1
    const targets = edgesByEndpointPair.get(edge.source) ?? new Map<string, CanvasEdge[]>()
    const bucket = targets.get(edge.target) ?? []
    bucket.push(edge)
    targets.set(edge.target, bucket)
    edgesByEndpointPair.set(edge.source, targets)
  }
  const scopes = new Map(primeCanvasDocumentPlacementIndexes(document))
  return { document, edgesByEndpointPair, nodesById, scopes }
}

function requireViewportRect(value: CanvasRendererViewportRect): CanvasRendererViewportRect {
  if (
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(value.width) ||
    !Number.isFinite(value.height) ||
    value.width <= 0 ||
    value.height <= 0
  ) throw new TypeError("Canvas renderer viewport rectangle is invalid")
  return Object.freeze({ ...value })
}

function normalizePins(value: readonly string[] | undefined) {
  const result = new Set<string>()
  for (const id of value ?? []) {
    if (typeof id === "string" && id.length > 0 && result.size < CANVAS_RENDERER_VIEWPORT_MAX_NODES) result.add(id)
  }
  return result
}

function compareId(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}
