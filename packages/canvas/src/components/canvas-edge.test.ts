import { describe, expect, test } from "bun:test"
import { Position } from "@xyflow/react"
import { resolveCanvasConnectionStatus, resolveCanvasEdgeGeometry, shouldAnimateCanvasEdge } from "./canvas-edge"
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
  test("animates persisted flow edges and edges incident to one focused node", () => {
    expect(shouldAnimateCanvasEdge(edge)).toBeFalse()
    expect(shouldAnimateCanvasEdge({ ...edge, animated: false })).toBeFalse()
    expect(shouldAnimateCanvasEdge({ ...edge, animated: true })).toBeTrue()
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

  test("keeps handleless and legacy edges right-to-left regardless of card placement", () => {
    for (const targetBounds of [
      { x: 100, y: -300, width: 160, height: 100 },
      { x: 100, y: 500, width: 160, height: 100 },
      { x: -400, y: 50, width: 160, height: 100 },
    ]) {
      expect(
        resolveCanvasEdgeGeometry({
          sourceBounds: { x: 100, y: 50, width: 200, height: 120 },
          sourceHandleId: null,
          targetBounds,
          targetHandleId: "legacy-target-top",
          fallback: {
            sourceX: 200,
            sourceY: 50,
            sourcePosition: Position.Top,
            targetX: 180,
            targetY: 500,
            targetPosition: Position.Bottom,
          },
        }),
      ).toEqual({
        sourceX: 300,
        sourceY: 110,
        sourcePosition: Position.Right,
        targetX: targetBounds.x,
        targetY: targetBounds.y + targetBounds.height / 2,
        targetPosition: Position.Left,
      })
    }
  })

  test("keeps fallback curves horizontal while node bounds are unavailable", () => {
    expect(
      resolveCanvasEdgeGeometry({
        fallback: {
          sourceX: 20,
          sourceY: 40,
          sourcePosition: Position.Bottom,
          targetX: 80,
          targetY: 120,
          targetPosition: Position.Top,
        },
      }),
    ).toEqual({
      sourceX: 20,
      sourceY: 40,
      sourcePosition: Position.Right,
      targetX: 80,
      targetY: 120,
      targetPosition: Position.Left,
    })
  })

  test("marks live connection previews by pending, valid, and invalid status", () => {
    expect(resolveCanvasConnectionStatus(undefined)).toBe("pending")
    expect(resolveCanvasConnectionStatus(null)).toBe("pending")
    expect(resolveCanvasConnectionStatus("valid")).toBe("valid")
    expect(resolveCanvasConnectionStatus("invalid")).toBe("invalid")
  })
})
