import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createGroupNode, createTextNode } from "./document"
import {
  createCanvasNodeSnapSession,
  resolveCanvasNodeSnap,
  resolveCanvasNodeSnapScopeNodeIds,
} from "./snapping"

function text(id: string, x: number, y: number, width = 120, height = 80) {
  return {
    ...createTextNode({
      id,
      metadata: {},
      position: { x, y },
      resourceState: { status: "ready" as const },
    }),
    measured: { height, width },
  }
}

describe("Canvas node snapping", () => {
  test("snaps the dragged edge and center to the closest node anchors on both axes", () => {
    const source = text("source", 100, 100)
    const target = text("target", 300, 200)
    const session = createCanvasNodeSnapSession(createCanvasDocument({ nodes: [source, target] }), [source.id])

    const result = resolveCanvasNodeSnap(session, new Map([[source.id, { x: 176, y: 118 }]]), 8)

    expect(result.offset).toEqual({ x: 4, y: 2 })
    expect(result.lines).toEqual([
      { axis: "x", value: 300 },
      { axis: "y", value: 200 },
    ])
  })

  test("does not snap outside the requested tolerance", () => {
    const source = text("source", 0, 0)
    const target = text("target", 300, 300)
    const session = createCanvasNodeSnapSession(createCanvasDocument({ nodes: [source, target] }), [source.id])

    expect(resolveCanvasNodeSnap(session, new Map([[source.id, { x: 170, y: 170 }]]), 8)).toEqual({
      lines: [],
      offset: { x: 0, y: 0 },
    })
  })

  test("uses one shared correction for a multi-node drag", () => {
    const first = text("first", 0, 0)
    const second = text("second", 160, 100)
    const target = text("target", 400, 300)
    const session = createCanvasNodeSnapSession(createCanvasDocument({ nodes: [first, second, target] }), [
      first.id,
      second.id,
    ])

    const result = resolveCanvasNodeSnap(
      session,
      new Map([
        [first.id, { x: 116, y: 118 }],
        [second.id, { x: 276, y: 218 }],
      ]),
      8,
    )

    expect(result.offset).toEqual({ x: 4, y: 2 })
    expect(result.lines).toEqual([
      { axis: "x", value: 400 },
      { axis: "y", value: 300 },
    ])
  })

  test("resolves nested world positions and excludes descendants of a dragged group", () => {
    const group = createGroupNode({ height: 220, id: "group", position: { x: 100, y: 100 }, width: 260 })
    const child = { ...text("child", 20, 30), extent: "parent" as const, parentId: group.id }
    const target = text("target", 500, 200)
    const document = createCanvasDocument({ nodes: [group, child, target] })

    const groupSession = createCanvasNodeSnapSession(document, [group.id])
    expect(groupSession.candidates.map((candidate) => candidate.id)).toEqual([target.id])

    const childSession = createCanvasNodeSnapSession(document, [child.id])
    const result = resolveCanvasNodeSnap(childSession, new Map([[child.id, { x: 276, y: 100 }]]), 8)
    expect(result.offset.x).toBe(4)
    expect(result.lines).toContainEqual({ axis: "x", value: 500 })
  })

  test("only snaps to nodes in the current visible group scope", () => {
    const group = createGroupNode({ height: 220, id: "group", position: { x: 100, y: 100 }, width: 260 })
    const hiddenChild = { ...text("hidden-child", 300, 0), extent: "parent" as const, parentId: group.id }
    const rootSource = text("root-source", 0, 0)
    const rootTarget = text("root-target", 600, 0)
    const document = createCanvasDocument({ nodes: [group, hiddenChild, rootSource, rootTarget] })

    const overview = createCanvasNodeSnapSession(
      document,
      [rootSource.id],
      new Set([group.id, rootSource.id, rootTarget.id]),
    )
    expect(overview.candidates.map((candidate) => candidate.id)).toEqual([group.id, rootTarget.id])

    const focused = createCanvasNodeSnapSession(document, [hiddenChild.id], new Set([hiddenChild.id]))
    expect(focused.candidates).toEqual([])
  })

  test("keeps expanded Group children snapping within their own hierarchy level", () => {
    const group = createGroupNode({ height: 220, id: "group", position: { x: 100, y: 100 }, width: 260 })
    const firstChild = { ...text("first-child", 20, 30), extent: "parent" as const, parentId: group.id }
    const secondChild = { ...text("second-child", 160, 30), extent: "parent" as const, parentId: group.id }
    const rootTarget = text("root-target", 500, 200)
    const document = createCanvasDocument({ nodes: [group, firstChild, secondChild, rootTarget] })

    const childSession = createCanvasNodeSnapSession(
      document,
      [firstChild.id],
      resolveCanvasNodeSnapScopeNodeIds(document, [firstChild.id]),
    )
    expect(childSession.candidates.map((candidate) => candidate.id)).toEqual([secondChild.id])

    const rootSession = createCanvasNodeSnapSession(
      document,
      [rootTarget.id],
      resolveCanvasNodeSnapScopeNodeIds(document, [rootTarget.id]),
    )
    expect(rootSession.candidates.map((candidate) => candidate.id)).toEqual([group.id])
    expect(resolveCanvasNodeSnapScopeNodeIds(document, [firstChild.id, rootTarget.id])).toEqual(new Set())
  })
})
