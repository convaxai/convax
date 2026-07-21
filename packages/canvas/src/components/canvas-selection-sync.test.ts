import { describe, expect, test } from "bun:test"
import {
  applyReactFlowEdgeSelectionChanges,
  applyReactFlowNodeSelectionChanges,
  createReactFlowSelectionSnapshot,
} from "./canvas-selection-sync"

describe("Canvas React Flow selection synchronization", () => {
  test("replaces Option-drag originals with the duplicated node snapshot", () => {
    const duplicated = createReactFlowSelectionSnapshot(["copy-a", "copy-b"], [])
    const raced = applyReactFlowNodeSelectionChanges(duplicated, [
      { id: "original-a", selected: true },
      { id: "original-b", selected: true },
    ])

    expect([...raced.nodeIds]).toEqual(["copy-a", "copy-b", "original-a", "original-b"])

    const settled = createReactFlowSelectionSnapshot(["copy-a", "copy-b"], [])
    expect([...settled.nodeIds]).toEqual(["copy-a", "copy-b"])
  })

  test("keeps a box-selected node set node-only when React Flow selects connected edges", () => {
    const nodes = applyReactFlowNodeSelectionChanges(createReactFlowSelectionSnapshot([], []), [
      { id: "image-a", selected: true },
      { id: "image-b", selected: true },
    ])
    const withImplicitEdges = applyReactFlowEdgeSelectionChanges(nodes, [
      { id: "edge-a", selected: true },
      { id: "edge-b", selected: true },
    ])
    const settled = createReactFlowSelectionSnapshot(["image-a", "image-b"], ["edge-a", "edge-b"], {
      discardImplicitEdges: true,
    })

    expect([...withImplicitEdges.nodeIds]).toEqual(["image-a", "image-b"])
    expect([...withImplicitEdges.edgeIds]).toEqual(["edge-a", "edge-b"])
    expect([...settled.edgeIds]).toEqual([])
  })

  test("preserves intentional mixed selection outside a box gesture", () => {
    const selection = createReactFlowSelectionSnapshot(["image-a"], ["edge-a"])

    expect([...selection.nodeIds]).toEqual(["image-a"])
    expect([...selection.edgeIds]).toEqual(["edge-a"])
  })

  test("permits replacing a node selection with an edge selection", () => {
    const nodes = createReactFlowSelectionSnapshot(["image-a"], [])
    const edgeFirst = applyReactFlowEdgeSelectionChanges(nodes, [{ id: "edge-a", selected: true }])
    const selection = applyReactFlowNodeSelectionChanges(edgeFirst, [{ id: "image-a", selected: false }])

    expect([...selection.nodeIds]).toEqual([])
    expect([...selection.edgeIds]).toEqual(["edge-a"])
  })
})
