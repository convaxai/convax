import { describe, expect, test } from "bun:test"
import { duplicateCanvasSelection } from "./commands"
import { createCanvasDocument, createTextNode as createCanvasTextNode, parseCanvasDocument } from "./document"
import {
  canvasNodeGenerationPreferenceKey,
  canvasNodeGenerationPreferenceSchema,
  getCanvasNodeGenerationToolId,
  setCanvasNodeGenerationToolId,
} from "./generation-preference"

function createTextNode(input: Omit<Parameters<typeof createCanvasTextNode>[0], "metadata" | "resourceState"> & {
  metadata?: Record<string, unknown>
}) {
  return createCanvasTextNode({
    ...input,
    metadata: input.metadata ?? {},
    resourceState: { status: "ready" },
  })
}

describe("Canvas node generation preference", () => {
  test("stores one opaque tool override while preserving unrelated node metadata", () => {
    const first = createTextNode({
      id: "first",
      metadata: { source: "brief.md" },
      position: { x: 0, y: 0 },
    })
    const second = createTextNode({ id: "second", position: { x: 100, y: 0 } })
    const document = createCanvasDocument({ id: "canvas", nodes: [first, second] })
    const updated = setCanvasNodeGenerationToolId(document, first.id, "plugin.example:image.generate")

    expect(getCanvasNodeGenerationToolId(updated.nodes[0])).toBe("plugin.example:image.generate")
    expect(updated.nodes[0]?.data.metadata).toMatchObject({
      [canvasNodeGenerationPreferenceKey]: {
        schema: canvasNodeGenerationPreferenceSchema,
        toolId: "plugin.example:image.generate",
      },
      source: "brief.md",
    })
    expect(updated.nodes[1]).toBe(second)
    expect(setCanvasNodeGenerationToolId(updated, first.id, "plugin.example:image.generate")).toBe(updated)
  })

  test("clears only the override so the node can inherit again", () => {
    const node = createTextNode({
      id: "first",
      metadata: { source: "brief.md" },
      position: { x: 0, y: 0 },
    })
    const stored = setCanvasNodeGenerationToolId(createCanvasDocument({ id: "canvas", nodes: [node] }), node.id, "tool")
    const cleared = setCanvasNodeGenerationToolId(stored, node.id)

    expect(getCanvasNodeGenerationToolId(cleared.nodes[0])).toBeUndefined()
    expect(cleared.nodes[0]?.data.metadata).toEqual({ source: "brief.md" })
  })

  test("fails closed on malformed metadata and invalid ids", () => {
    const malformed = createTextNode({
      id: "first",
      metadata: {
        [canvasNodeGenerationPreferenceKey]: {
          schema: canvasNodeGenerationPreferenceSchema,
          toolId: " bad ",
        },
      },
      position: { x: 0, y: 0 },
    })
    const document = createCanvasDocument({ id: "canvas", nodes: [malformed] })

    expect(getCanvasNodeGenerationToolId(malformed)).toBeUndefined()
    expect(() => setCanvasNodeGenerationToolId(document, malformed.id, "bad\nmodel")).toThrow("bounded printable")
  })

  test("keeps a manual override with a duplicated node", () => {
    const node = createTextNode({ id: "first", position: { x: 0, y: 0 } })
    const stored = setCanvasNodeGenerationToolId(createCanvasDocument({ id: "canvas", nodes: [node] }), node.id, "tool")
    const duplicated = duplicateCanvasSelection(stored, [node.id])
    const clone = duplicated.document.nodes.find((candidate) => candidate.id !== node.id)

    expect(clone && getCanvasNodeGenerationToolId(clone)).toBe("tool")
  })

  test("round trips the node override through the read-only Canvas projection parser", () => {
    const node = createTextNode({ id: "first", position: { x: 0, y: 0 } })
    const stored = setCanvasNodeGenerationToolId(createCanvasDocument({ id: "canvas", nodes: [node] }), node.id, "tool")
    const restored = parseCanvasDocument(structuredClone(stored), stored.id)

    expect(restored && getCanvasNodeGenerationToolId(restored.nodes[0])).toBe("tool")
  })
})
