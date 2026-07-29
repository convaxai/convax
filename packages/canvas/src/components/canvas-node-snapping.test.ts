import { describe, expect, test } from "bun:test"
import type { NodeChange } from "@xyflow/react"
import { createCanvasDocument, createTextNode } from "../document"
import { createCanvasNodeSnapSession } from "../snapping"
import type { CanvasNode } from "../types"
import { snapCanvasNodePositionChanges } from "./canvas-node-snapping"

function text(id: string, x: number, y: number) {
  return {
    ...createTextNode({
      id,
      metadata: {},
      position: { x, y },
      resourceState: { status: "ready" as const },
    }),
    measured: { height: 80, width: 120 },
  }
}

describe("React Flow Canvas node snapping adapter", () => {
  test("adds the shared node snap offset to local and absolute position changes", () => {
    const source = text("source", 100, 100)
    const target = text("target", 300, 200)
    const session = createCanvasNodeSnapSession(createCanvasDocument({ nodes: [source, target] }), [source.id])
    const changes: NodeChange<CanvasNode>[] = [
      {
        dragging: true,
        id: source.id,
        position: { x: 176, y: 118 },
        positionAbsolute: { x: 176, y: 118 },
        type: "position",
      },
      { id: target.id, selected: true, type: "select" },
    ]

    expect(snapCanvasNodePositionChanges(changes, session, 8)).toEqual({
      changes: [
        {
          dragging: true,
          id: source.id,
          position: { x: 180, y: 120 },
          positionAbsolute: { x: 180, y: 120 },
          type: "position",
        },
        changes[1],
      ],
      lines: [
        { axis: "x", value: 300 },
        { axis: "y", value: 200 },
      ],
    })
  })

  test("leaves unrelated changes untouched when no dragged position is present", () => {
    const source = text("source", 100, 100)
    const target = text("target", 300, 200)
    const session = createCanvasNodeSnapSession(createCanvasDocument({ nodes: [source, target] }), [source.id])
    const changes: NodeChange<CanvasNode>[] = [{ id: target.id, selected: true, type: "select" }]

    expect(snapCanvasNodePositionChanges(changes, session, 8)).toEqual({ changes, lines: [] })
  })
})
