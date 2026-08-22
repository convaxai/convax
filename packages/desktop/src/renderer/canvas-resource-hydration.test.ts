import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createTextNode } from "@convax/canvas/core"
import { collectStaleCanvasResourceNodeIds } from "./canvas-resource-hydration"

describe("Canvas resource hydration targeting", () => {
  test("collects only stale resources from a mixed mounted document", () => {
    const document = createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "target",
          metadata: {},
          position: { x: 0, y: 0 },
          resourceState: { status: "stale" },
        }),
        createTextNode({
          id: "ready",
          metadata: {},
          position: { x: 20, y: 0 },
          resourceState: { status: "ready", text: "ready" },
        }),
      ],
    })

    expect(collectStaleCanvasResourceNodeIds(document)).toEqual(["target"])
  })

  test("fails closed when the stale target set exceeds the Desktop bridge bound", () => {
    const template = createTextNode({
      id: "template",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "stale" },
    })
    const document = createCanvasDocument({
      id: "canvas-over-bound",
      nodes: Array.from({ length: 4_097 }, (_, index) => ({ ...template, id: `node-${index}` })),
    })

    expect(() => collectStaleCanvasResourceNodeIds(document)).toThrow("exceeds the Desktop bridge limit")
  })
})
