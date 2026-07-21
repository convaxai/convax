import { describe, expect, test } from "bun:test"
import {
  agentCanvasNodeResourceUri,
  agentCanvasResourceUri,
  createAgentCanvasNodeResource,
  createAgentCanvasInstructions,
  isAgentCanvasResource,
  shouldFlushAgentCanvasContext,
} from "./agent-canvas-context"

describe("desktop Canvas Agent context", () => {
  test("uses generic structured resources for full canvases and opaque node ids", () => {
    expect(agentCanvasResourceUri("canvas main")).toBe("convax://canvas/canvas%20main")
    expect(agentCanvasNodeResourceUri("canvas", "plugin/folder:item")).toBe(
      "convax://canvas/canvas/node/plugin%2Ffolder%3Aitem",
    )
    expect(createAgentCanvasNodeResource("canvas", "node", "Reference")).toEqual({
      kind: "resource",
      name: "Reference",
      uri: "convax://canvas/canvas/node/node",
    })
    expect(isAgentCanvasResource({ kind: "resource", uri: "convax://canvas/canvas/node/node" })).toBeTrue()
    expect(isAgentCanvasResource({ kind: "resource", uri: "https://example.com" })).toBeFalse()
  })

  test("supplies exact host identity and read-only snapshot guidance outside the generic runtime", () => {
    const instructions = createAgentCanvasInstructions({
      activeCanvas: { id: "canvas-main", name: "Canvas 1" },
      resources: [{ kind: "resource", uri: "convax://canvas/canvas-main/node/file" }],
    })

    expect(instructions.join("\n")).toContain('Active Canvas ID: "canvas-main"')
    expect(instructions.join("\n")).toContain('Active Canvas name: "Canvas 1"')
    expect(instructions.join("\n")).toContain(
      'call convax_canvas_query_nodes immediately with canvasId "canvas-main"',
    )
    expect(instructions.join("\n")).toContain("Do not search the filesystem for Canvas instructions")
    expect(instructions.join("\n")).toContain("read-only snapshots")
  })

  test("flushes active-Canvas-only prompts without adding guidance outside Canvas context", () => {
    expect(shouldFlushAgentCanvasContext({
      activeCanvas: { id: "canvas-main" },
      resources: [],
    })).toBeTrue()
    expect(shouldFlushAgentCanvasContext({
      resources: [{ kind: "resource", uri: "convax://canvas/canvas-main" }],
    })).toBeTrue()
    expect(shouldFlushAgentCanvasContext({ resources: [] })).toBeFalse()
    expect(createAgentCanvasInstructions({ resources: [] })).toEqual([])
  })
})
