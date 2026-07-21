import { describe, expect, test } from "bun:test"
import { createCanvasCardConnection } from "./connection-node-menu"

describe("card-level canvas connections", () => {
  test("uses only the dragged endpoint and the card released under the pointer", () => {
    expect(createCanvasCardConnection("source", "right", "target")).toEqual({
      source: "source",
      sourceHandle: "source-right",
      target: "target",
      targetHandle: "target-left",
    })
    expect(createCanvasCardConnection("target", "left", "source")).toEqual({
      source: "source",
      sourceHandle: "source-right",
      target: "target",
      targetHandle: "target-left",
    })
  })
})
