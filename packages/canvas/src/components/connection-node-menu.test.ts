import { describe, expect, test } from "bun:test"
import { CANVAS_NODE_INPUT_HANDLE_ID, CANVAS_NODE_OUTPUT_HANDLE_ID } from "../connections"
import { createCanvasCardConnection } from "./connection-node-menu"

describe("card-level canvas connections", () => {
  test("keeps the canonical card handle ids stable", () => {
    expect(CANVAS_NODE_INPUT_HANDLE_ID).toBe("target-left")
    expect(CANVAS_NODE_OUTPUT_HANDLE_ID).toBe("source-right")
  })

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
