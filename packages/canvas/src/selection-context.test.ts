import { describe, expect, test } from "bun:test"
import {
  canShowNodeLocalMutationSurface,
  deriveCanvasSelectionContext,
  isNodeOnlySelectionContext,
  isSingleNodeSelectionContext,
} from "./selection-context"
import type { CanvasSelection } from "./types"

function selection(nodeIds: readonly string[] = [], edgeIds: readonly string[] = []): CanvasSelection {
  return { edgeIds: new Set(edgeIds), nodeIds: new Set(nodeIds) }
}

describe("canvas selection context", () => {
  test("classifies an empty selection", () => {
    expect(deriveCanvasSelectionContext(selection())).toEqual({ kind: "none" })
  })

  test("classifies a single node without inventing a primary node for multi-selection", () => {
    expect(deriveCanvasSelectionContext(selection(["node-a"]))).toEqual({
      kind: "single-node",
      nodeId: "node-a",
    })

    const nodeIds = new Set(["node-a", "node-b"])
    expect(deriveCanvasSelectionContext({ edgeIds: new Set(), nodeIds })).toEqual({
      kind: "multi-node",
      nodeIds,
    })
  })

  test("classifies single and multiple edge selections", () => {
    expect(deriveCanvasSelectionContext(selection([], ["edge-a"]))).toEqual({
      edgeId: "edge-a",
      kind: "single-edge",
    })

    const edgeIds = new Set(["edge-a", "edge-b"])
    expect(deriveCanvasSelectionContext({ edgeIds, nodeIds: new Set() })).toEqual({
      edgeIds,
      kind: "multi-edge",
    })
  })

  test("classifies any node and edge combination as mixed", () => {
    const nodeIds = new Set(["node-a"])
    const edgeIds = new Set(["edge-a"])
    expect(deriveCanvasSelectionContext({ edgeIds, nodeIds })).toEqual({
      edgeIds,
      kind: "mixed",
      nodeIds,
    })
  })

  test("grants node-local context only to the sole selected node", () => {
    const single = deriveCanvasSelectionContext(selection(["node-a"]))
    expect(isSingleNodeSelectionContext(single, "node-a")).toBeTrue()
    expect(isSingleNodeSelectionContext(single, "node-b")).toBeFalse()
    expect(
      isSingleNodeSelectionContext(deriveCanvasSelectionContext(selection(["node-a", "node-b"])), "node-a"),
    ).toBeFalse()
    expect(
      isSingleNodeSelectionContext(deriveCanvasSelectionContext(selection(["node-a"], ["edge-a"])), "node-a"),
    ).toBeFalse()
  })

  test("shows node-local mutation surfaces only for the editable sole selected node", () => {
    const single = deriveCanvasSelectionContext(selection(["node-a"]))
    const multi = deriveCanvasSelectionContext(selection(["node-a", "node-b"]))
    const mixed = deriveCanvasSelectionContext(selection(["node-a"], ["edge-a"]))

    expect(canShowNodeLocalMutationSurface(single, "node-a", false)).toBeTrue()
    expect(canShowNodeLocalMutationSurface(single, "node-b", false)).toBeFalse()
    expect(canShowNodeLocalMutationSurface(single, "node-a", true)).toBeFalse()
    expect(canShowNodeLocalMutationSurface(multi, "node-a", false)).toBeFalse()
    expect(canShowNodeLocalMutationSurface(mixed, "node-a", false)).toBeFalse()
  })

  test("allows node-only selection actions only when no edge is selected", () => {
    expect(isNodeOnlySelectionContext(deriveCanvasSelectionContext(selection(["node-a"])))).toBeTrue()
    expect(isNodeOnlySelectionContext(deriveCanvasSelectionContext(selection(["node-a", "node-b"])))).toBeTrue()
    expect(isNodeOnlySelectionContext(deriveCanvasSelectionContext(selection(["node-a"], ["edge-a"])))).toBeFalse()
    expect(isNodeOnlySelectionContext(deriveCanvasSelectionContext(selection([], ["edge-a"])))).toBeFalse()
  })
})
