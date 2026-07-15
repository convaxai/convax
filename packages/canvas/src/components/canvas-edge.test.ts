import { describe, expect, test } from "bun:test"
import { Position } from "@xyflow/react"
import { resolveCanvasEdgeGeometry, shouldAnimateCanvasEdge } from "./canvas-edge"
import type { CanvasEdge, CanvasSelection } from "../types"

const edge: CanvasEdge = {
  id: "edge_a",
  source: "node_a",
  target: "node_b",
}

function selection(nodeIds: string[], edgeIds: string[] = []): CanvasSelection {
  return { nodeIds: new Set(nodeIds), edgeIds: new Set(edgeIds) }
}

describe("canvas edge presentation", () => {
  test("animates only beside one focused node while the edge is not selected", () => {
    expect(shouldAnimateCanvasEdge(edge, selection([]))).toBeFalse()
    expect(shouldAnimateCanvasEdge(edge, selection(["node_a"]))).toBeTrue()
    expect(shouldAnimateCanvasEdge(edge, selection(["node_b"]))).toBeTrue()
    expect(shouldAnimateCanvasEdge(edge, selection(["node_c"]))).toBeFalse()
    expect(shouldAnimateCanvasEdge(edge, selection(["node_a", "node_b"]))).toBeFalse()
    expect(shouldAnimateCanvasEdge(edge, selection(["node_a"], [edge.id]))).toBeFalse()
    expect(shouldAnimateCanvasEdge({ ...edge, animated: false }, selection(["node_a"]))).toBeFalse()
  })

  test("anchors persisted handle edges to node boundaries instead of plus buttons", () => {
    const geometry = resolveCanvasEdgeGeometry({
      sourceBounds: { x: 100, y: 50, width: 200, height: 120 },
      sourceHandleId: "source-right",
      targetBounds: { x: 500, y: 200, width: 160, height: 100 },
      targetHandleId: "target-left",
      fallback: {
        sourceX: 330,
        sourceY: 110,
        sourcePosition: Position.Right,
        targetX: 470,
        targetY: 250,
        targetPosition: Position.Left,
      },
    })

    expect(geometry).toEqual({
      sourceX: 300,
      sourceY: 110,
      sourcePosition: Position.Right,
      targetX: 500,
      targetY: 250,
      targetPosition: Position.Left,
    })
  })
})
