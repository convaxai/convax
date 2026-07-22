import { describe, expect, test } from "bun:test"
import { applyReactFlowEdgeSelectionChanges, applyReactFlowNodeSelectionChanges } from "./canvas-selection-sync"

describe("Canvas React Flow selection synchronization", () => {
  test("keeps edge identity while applying node selection changes", () => {
    const edgeIds = new Set(["edge-a"])
    const current = { edgeIds, nodeIds: new Set(["copy-a"]) }
    const next = applyReactFlowNodeSelectionChanges(current, [
      { id: "copy-a", selected: false },
      { id: "copy-b", selected: true },
    ])

    expect([...next.nodeIds]).toEqual(["copy-b"])
    expect(next.edgeIds).toBe(edgeIds)
  })

  test("applies node and edge selection changes without replacing the other set", () => {
    const empty = { edgeIds: new Set<string>(), nodeIds: new Set<string>() }
    const nodes = applyReactFlowNodeSelectionChanges(empty, [
      { id: "image-a", selected: true },
      { id: "image-b", selected: true },
    ])
    const withImplicitEdges = applyReactFlowEdgeSelectionChanges(nodes, [
      { id: "edge-a", selected: true },
      { id: "edge-b", selected: true },
    ])
    expect([...withImplicitEdges.nodeIds]).toEqual(["image-a", "image-b"])
    expect([...withImplicitEdges.edgeIds]).toEqual(["edge-a", "edge-b"])
    expect(withImplicitEdges.nodeIds).toBe(nodes.nodeIds)
  })

  test("preserves intentional mixed selection outside a box gesture", () => {
    const selection = applyReactFlowEdgeSelectionChanges(
      { edgeIds: new Set<string>(), nodeIds: new Set(["image-a"]) },
      [{ id: "edge-a", selected: true }],
    )

    expect([...selection.nodeIds]).toEqual(["image-a"])
    expect([...selection.edgeIds]).toEqual(["edge-a"])
  })

  test("permits replacing a node selection with an edge selection", () => {
    const nodes = { edgeIds: new Set<string>(), nodeIds: new Set(["image-a"]) }
    const edgeFirst = applyReactFlowEdgeSelectionChanges(nodes, [{ id: "edge-a", selected: true }])
    const selection = applyReactFlowNodeSelectionChanges(edgeFirst, [{ id: "image-a", selected: false }])

    expect([...selection.nodeIds]).toEqual([])
    expect([...selection.edgeIds]).toEqual(["edge-a"])
  })
})
