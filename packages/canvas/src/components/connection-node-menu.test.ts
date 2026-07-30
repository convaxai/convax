import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createDefaultCanvasFileRendererRegistry, createDefaultCanvasNodeRegistry } from "../builtin-registry"
import { CANVAS_NODE_INPUT_HANDLE_ID, CANVAS_NODE_OUTPUT_HANDLE_ID } from "../connections"
import { ConnectionNodeMenu, createCanvasCardConnection } from "./connection-node-menu"
import { getCanvasNodeInsertionItems } from "./insertion-items"

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

  test("offers empty image and video cards from a connection endpoint", () => {
    const items = [
      { label: "Text", type: "text" },
      ...getCanvasNodeInsertionItems(createDefaultCanvasFileRendererRegistry(), createDefaultCanvasNodeRegistry()),
    ]
    const markup = renderToStaticMarkup(createElement(ConnectionNodeMenu, { items, onSelect() {} }))

    expect(markup).toContain("Text")
    expect(markup).toContain("Image")
    expect(markup).toContain("Video")
    expect(markup).toContain("convax-motion-menu")
    expect(markup).not.toContain("Audio")
  })
})
