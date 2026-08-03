import { describe, expect, test } from "bun:test"
import { foldCanvasNodes, groupCanvasNodes } from "./commands"
import {
  createCanvasDocument,
  createGroupNode,
  createTextNode,
  getCanvasNodePresentationSize,
  getCanvasNodeSize,
  parseCanvasDocument,
} from "./document"
import {
  canvasGroupFoldKey,
  canvasGroupFoldSchema,
  hasUnsupportedCanvasGroupFold,
  isCanvasGroupFolded,
  setCanvasGroupFolded,
} from "./group-fold"

describe("Canvas group folding", () => {
  test("keeps legacy Groups expanded and round-trips an explicit Fold state", () => {
    const group = createGroupNode({ height: 360, id: "group", position: { x: 0, y: 0 }, width: 520 })
    const document = createCanvasDocument({ id: "canvas", nodes: [group] })

    expect(isCanvasGroupFolded(group)).toBe(false)
    expect(getCanvasNodePresentationSize(group)).toEqual({ height: 360, width: 520 })

    const folded = setCanvasGroupFolded(document, group.id, true)
    expect(isCanvasGroupFolded(folded.nodes[0])).toBe(true)
    expect(getCanvasNodePresentationSize(folded.nodes[0]!)).toEqual({ height: 160, width: 200 })
    expect(folded.nodes[0]?.data.metadata).toEqual({
      [canvasGroupFoldKey]: { folded: true, schema: canvasGroupFoldSchema },
    })
    expect(parseCanvasDocument(folded, document.id)).toEqual(folded)

    const unfolded = setCanvasGroupFolded(folded, group.id, false)
    expect(isCanvasGroupFolded(unfolded.nodes[0])).toBe(false)
    expect(unfolded.nodes[0]?.data).not.toHaveProperty("metadata")
  })

  test("creates a folded Group from a multi-node selection in one command result", () => {
    const first = createTextNode({
      id: "first",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready" },
    })
    const second = createTextNode({
      id: "second",
      metadata: {},
      position: { x: 320, y: 0 },
      resourceState: { status: "ready" },
    })
    const document = createCanvasDocument({ nodes: [first, second] })

    const result = foldCanvasNodes(document, [first.id, second.id], "References")
    const group = result.document.nodes.find((node) => node.data.kind === "group")

    expect(group).toBeDefined()
    if (!group) throw new Error("Fold did not create a Group")
    expect(result.selectedNodeIds).toEqual([group.id])
    expect(group.data.label).toBe("References")
    expect(isCanvasGroupFolded(group)).toBe(true)
    expect(result.document.nodes.filter((node) => node.parentId === group.id)).toHaveLength(2)
  })

  test("keeps a newly created parent large enough for a folded child to unfold", () => {
    const inner = createGroupNode({ height: 600, id: "inner", position: { x: 0, y: 0 }, width: 800 })
    const peer = createTextNode({
      id: "peer",
      metadata: {},
      position: { x: 900, y: 0 },
      resourceState: { status: "ready" },
    })
    const folded = setCanvasGroupFolded(createCanvasDocument({ nodes: [inner, peer] }), inner.id, true)

    const grouped = groupCanvasNodes(folded, [inner.id, peer.id])
    const outer = grouped.document.nodes.find((node) => node.data.kind === "group" && node.id !== inner.id)
    const nestedInner = grouped.document.nodes.find((node) => node.id === inner.id)

    expect(outer).toBeDefined()
    expect(nestedInner).toBeDefined()
    if (!outer || !nestedInner) throw new Error("Nested Group was not created")
    expect(nestedInner.position.x + getCanvasNodeSize(nestedInner).width).toBeLessThanOrEqual(
      getCanvasNodeSize(outer).width - 40,
    )
    const unfolded = setCanvasGroupFolded(grouped.document, inner.id, false)
    expect(getCanvasNodePresentationSize(unfolded.nodes.find((node) => node.id === inner.id)!)).toEqual({
      height: 600,
      width: 800,
    })
  })

  test("preserves and rejects an unsupported Fold namespace", () => {
    const group = createGroupNode({ height: 360, id: "group", position: { x: 0, y: 0 }, width: 520 })
    group.data.metadata = {
      [canvasGroupFoldKey]: { folded: false, schema: "convax.group-fold/99" },
      source: "legacy",
    }
    const document = createCanvasDocument({ nodes: [group] })

    expect(hasUnsupportedCanvasGroupFold(group)).toBe(true)
    expect(isCanvasGroupFolded(group)).toBe(false)
    expect(() => setCanvasGroupFolded(document, group.id, true)).toThrow("Canvas group fold schema is unsupported")
    expect(document.nodes[0]?.data.metadata).toEqual(group.data.metadata)
  })
})
