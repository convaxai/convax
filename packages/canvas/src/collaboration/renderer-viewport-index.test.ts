import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createGroupNode, createTextNode } from "../document"
import {
  canvasDocumentPlacementIndex,
  canvasPlacementWorkCounts,
} from "../resource-placement"
import type { CanvasDocument, CanvasEdge, CanvasNode } from "../types"
import {
  CANVAS_RENDERER_VIEWPORT_MAX_NODES,
  CanvasRendererViewportIndex,
  canvasRendererViewportWorkCounts,
} from "./renderer-viewport-index"

describe("Canvas bounded Renderer viewport index", () => {
  test("keeps 1/1k/10k viewport work at O(log N + V) and primes every placement scope", () => {
    for (const nodeCount of [1, 1_000, 10_000]) {
      const document = linearDocument(nodeCount)
      const coldBefore = canvasRendererViewportWorkCounts()
      const index = new CanvasRendererViewportIndex(document)
      const coldAfter = canvasRendererViewportWorkCounts()
      expect(coldAfter.coldNodeVisits - coldBefore.coldNodeVisits).toBe(nodeCount)
      expect(coldAfter.coldEdgeVisits - coldBefore.coldEdgeVisits).toBe(Math.max(0, nodeCount - 1))

      const placementBefore = canvasPlacementWorkCounts()
      canvasDocumentPlacementIndex(document)
      const placementAfter = canvasPlacementWorkCounts()
      expect(placementAfter.optimisticFullNodeVisits - placementBefore.optimisticFullNodeVisits).toBe(0)
      expect(placementAfter.fullObstacleTraversals - placementBefore.fullObstacleTraversals).toBe(0)

      const queryBefore = canvasRendererViewportWorkCounts()
      const spatialBefore = canvasPlacementWorkCounts()
      const projection = index.query({ rect: { height: 240, width: 1_800, x: 0, y: 0 } })
      const queryAfter = canvasRendererViewportWorkCounts()
      const spatialAfter = canvasPlacementWorkCounts()
      expect(projection.nodes.length).toBeLessThanOrEqual(CANVAS_RENDERER_VIEWPORT_MAX_NODES)
      expect(queryAfter.viewportNodeVisits - queryBefore.viewportNodeVisits).toBe(projection.nodes.length)
      expect(queryAfter.viewportEdgeVisits - queryBefore.viewportEdgeVisits).toBeLessThanOrEqual(
        projection.nodes.length,
      )
      expect(spatialAfter.viewportQueryVisits - spatialBefore.viewportQueryVisits).toBeLessThanOrEqual(
        projection.nodes.length + 64,
      )

      const appended = createTextNode({
        id: `new-editable-${nodeCount}`,
        metadata: { resource: `Notes/new-${nodeCount}.md` },
        position: { x: nodeCount * 400 + 10_000, y: 0 },
        resourceState: {
          contentRevision: "a".repeat(64),
          editableText: true,
          status: "ready",
          text: "",
        },
      })
      const patchBefore = canvasRendererViewportWorkCounts()
      index.append({ edges: [], nodes: [appended] })
      const patchAfter = canvasRendererViewportWorkCounts()
      expect(patchAfter.patchNodeVisits - patchBefore.patchNodeVisits).toBe(1)
      expect(patchAfter.patchEdgeVisits - patchBefore.patchEdgeVisits).toBe(0)

      const pinned = index.query({
        pinnedNodeIds: [appended.id],
        rect: { height: 240, width: 1_800, x: 0, y: 0 },
      })
      expect(pinned.nodes.length).toBeLessThanOrEqual(CANVAS_RENDERER_VIEWPORT_MAX_NODES)
      const ready = pinned.nodes.find((node) => node.id === appended.id)
      expect(ready).toBe(appended)
      expect(ready?.data.resourceState).toMatchObject({
        editableText: true,
        status: "ready",
        text: "",
      })
    }
  })

  test("binds focused-Group placement during cold bootstrap and never scans history on its first ghost", () => {
    const group = createGroupNode({ id: "group", height: 720, position: { x: 400, y: 300 }, width: 960 })
    const children = Array.from({ length: 10_000 }, (_, index) =>
      createTextNode({
        id: `child-${index}`,
        metadata: {},
        position: { x: index * 400, y: 0 },
        resourceState: { status: "ready", text: String(index) },
      }),
    ).map((node) => ({ ...node, parentId: group.id }))
    const document = createCanvasDocument({ id: "focused-group-placement", nodes: [group, ...children] })
    const index = new CanvasRendererViewportIndex(document)

    const before = canvasPlacementWorkCounts()
    canvasDocumentPlacementIndex(document, group.id)
    const after = canvasPlacementWorkCounts()
    expect(after.optimisticFullNodeVisits - before.optimisticFullNodeVisits).toBe(0)
    expect(after.fullObstacleTraversals - before.fullObstacleTraversals).toBe(0)

    const projection = index.query({
      focusedGroupId: group.id,
      rect: { height: 240, width: 1_800, x: 0, y: 0 },
    })
    expect(projection.nodes[0]).toBe(group)
    expect(projection.nodes.length).toBeLessThanOrEqual(CANVAS_RENDERER_VIEWPORT_MAX_NODES)
  })

  test("does not traverse a visible node's 1/1k/10k off-screen edge degree", () => {
    for (const edgeCount of [1, 1_000, 10_000]) {
      const source = createTextNode({
        id: `source-${edgeCount}`,
        metadata: {},
        position: { x: 0, y: 0 },
        resourceState: { status: "ready", text: "source" },
      })
      const targets = Array.from({ length: edgeCount }, (_, index) =>
        createTextNode({
          id: `target-${edgeCount}-${index}`,
          metadata: {},
          position: { x: 100_000 + index * 400, y: 0 },
          resourceState: { status: "ready", text: "target" },
        }),
      )
      const edges = targets.map((target, index) => ({
        data: {},
        id: `fanout-${edgeCount}-${index}`,
        source: source.id,
        target: target.id,
      }))
      const index = new CanvasRendererViewportIndex(
        createCanvasDocument({ id: `fanout-${edgeCount}`, edges, nodes: [source, ...targets] }),
      )
      const before = canvasRendererViewportWorkCounts()
      const projection = index.query({ rect: { height: 240, width: 1_800, x: 0, y: 0 } })
      const after = canvasRendererViewportWorkCounts()
      expect(projection.nodes.map((node) => node.id)).toEqual([source.id])
      expect(projection.edges).toEqual([])
      expect(after.viewportEdgeVisits - before.viewportEdgeVisits).toBe(0)

      const pinnedBefore = canvasRendererViewportWorkCounts()
      const pinned = index.query({
        pinnedNodeIds: [targets.at(-1)!.id],
        rect: { height: 240, width: 1_800, x: 0, y: 0 },
      })
      const pinnedAfter = canvasRendererViewportWorkCounts()
      expect(pinned.edges).toHaveLength(1)
      expect(pinnedAfter.viewportEdgeVisits - pinnedBefore.viewportEdgeVisits).toBe(1)
    }
  })

  test("bounds deep pin ancestry and stops at the focused Group scope at depth 256/1k/4k", () => {
    for (const depth of [256, 1_000, 4_000]) {
      const { child, document, focusedGroup } = deepGroupDocument(depth)
      const index = new CanvasRendererViewportIndex(document)
      const focusedBefore = canvasRendererViewportWorkCounts()
      const focused = index.query({
        focusedGroupId: focusedGroup.id,
        pinnedNodeIds: [child.id],
        rect: { height: 240, width: 1_800, x: 0, y: 0 },
      })
      const focusedAfter = canvasRendererViewportWorkCounts()
      expect(focusedAfter.viewportAncestryVisits - focusedBefore.viewportAncestryVisits).toBe(2)
      expect(focused.nodes.map((node) => node.id)).toContain(focusedGroup.id)
      expect(focused.nodes.map((node) => node.id)).toContain(child.id)
      expect(focused.nodes.length).toBeLessThanOrEqual(CANVAS_RENDERER_VIEWPORT_MAX_NODES)

      const rootBefore = canvasRendererViewportWorkCounts()
      const root = index.query({
        pinnedNodeIds: [child.id],
        rect: { height: 240, width: 1_800, x: 0, y: 0 },
      })
      const rootAfter = canvasRendererViewportWorkCounts()
      expect(rootAfter.viewportAncestryVisits - rootBefore.viewportAncestryVisits)
        .toBe(CANVAS_RENDERER_VIEWPORT_MAX_NODES)
      expect(root.nodes.map((node) => node.id)).toContain(child.id)
      expect(root.nodes.length).toBeLessThanOrEqual(CANVAS_RENDERER_VIEWPORT_MAX_NODES)
      expect(root.truncated).toBeTrue()
    }
  })
})

function linearDocument(nodeCount: number): CanvasDocument {
  const nodes: CanvasNode[] = Array.from({ length: nodeCount }, (_, index) =>
    createTextNode({
      id: `node-${index}`,
      metadata: {},
      position: { x: index * 400, y: 0 },
      resourceState: { status: "ready", text: String(index) },
    }),
  )
  const edges: CanvasEdge[] = nodes.slice(1).map((node, index) => ({
    data: {},
    id: `edge-${index}`,
    source: nodes[index]!.id,
    target: node.id,
  }))
  return createCanvasDocument({ edges, id: `linear-${nodeCount}`, nodes })
}

function deepGroupDocument(depth: number): {
  readonly child: CanvasNode
  readonly document: CanvasDocument
  readonly focusedGroup: CanvasNode
} {
  const groups: CanvasNode[] = []
  for (let index = 0; index < depth; index += 1) {
    const group = createGroupNode({
      height: 720,
      id: `deep-group-${depth}-${index}`,
      position: { x: 100_000, y: 100_000 },
      width: 960,
    })
    groups.push(index === 0 ? group : { ...group, parentId: groups[index - 1]!.id })
  }
  const child = {
    ...createTextNode({
      id: `deep-child-${depth}`,
      metadata: {},
      position: { x: 100_000, y: 100_000 },
      resourceState: { status: "ready", text: "new" },
    }),
    parentId: groups.at(-1)!.id,
  }
  return {
    child,
    document: createCanvasDocument({ id: `deep-groups-${depth}`, nodes: [...groups, child] }),
    focusedGroup: groups.at(-1)!,
  }
}
