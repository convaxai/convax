import { describe, expect, test } from "bun:test"
import { parseStoredCanvasDocument, serializeCanvasDocument } from "./application/persistence"
import { duplicateCanvasSelection } from "./commands"
import { createCanvasDocument, createGroupNode, createTextNode } from "./document"
import {
  canvasGroupAppearanceKey,
  canvasGroupAppearanceSchema,
  defaultCanvasGroupAppearance,
  getCanvasGroupAppearance,
  setCanvasGroupAppearance,
} from "./group-appearance"
import { canvasHistoryReducer, createCanvasHistory } from "./history"

function groupNode(id = "group") {
  return createGroupNode({
    height: 160,
    id,
    position: { x: 0, y: 0 },
    width: 200,
  })
}

describe("Canvas group appearance", () => {
  test("stores one bounded appearance while preserving unrelated metadata", () => {
    const group = groupNode()
    group.data.metadata = { source: "brief.md" }
    const document = createCanvasDocument({ id: "canvas", nodes: [group] })
    const updated = setCanvasGroupAppearance(document, group.id, {
      color: "orange",
      emoji: "sparkles",
    })

    expect(getCanvasGroupAppearance(updated.nodes[0])).toEqual({
      color: "orange",
      emoji: "sparkles",
    })
    expect(updated.nodes[0]?.data.metadata).toMatchObject({
      [canvasGroupAppearanceKey]: {
        color: "orange",
        emoji: "sparkles",
        schema: canvasGroupAppearanceSchema,
      },
      source: "brief.md",
    })
    expect(setCanvasGroupAppearance(updated, group.id, { color: "orange", emoji: "sparkles" })).toBe(updated)
  })

  test("keeps the default implicit and changes only structural groups", () => {
    const group = groupNode()
    const text = createTextNode({
      id: "text",
      metadata: {},
      position: { x: 240, y: 0 },
      resourceState: { status: "ready" },
    })
    const document = createCanvasDocument({ id: "canvas", nodes: [group, text] })

    expect(getCanvasGroupAppearance(group)).toEqual(defaultCanvasGroupAppearance)
    expect(setCanvasGroupAppearance(document, group.id, defaultCanvasGroupAppearance)).toBe(document)
    expect(
      setCanvasGroupAppearance(document, text.id, {
        color: "green",
        emoji: "leaf",
      }),
    ).toBe(document)
  })

  test("clears the namespace when returning to the default", () => {
    const group = groupNode()
    group.data.metadata = { source: "brief.md" }
    const document = createCanvasDocument({ id: "canvas", nodes: [group] })
    const stored = setCanvasGroupAppearance(document, group.id, {
      color: "blue",
      emoji: "camera",
    })
    const cleared = setCanvasGroupAppearance(stored, group.id, defaultCanvasGroupAppearance)

    expect(getCanvasGroupAppearance(cleared.nodes[0])).toEqual(defaultCanvasGroupAppearance)
    expect(cleared.nodes[0]?.data.metadata).toEqual({ source: "brief.md" })
  })

  test("fails closed on unknown schemas and invalid choices", () => {
    const group = groupNode()
    group.data.metadata = {
      [canvasGroupAppearanceKey]: {
        color: "future",
        emoji: "future",
        schema: "convax.group-appearance/99",
      },
    }
    const document = createCanvasDocument({ id: "canvas", nodes: [group] })

    expect(getCanvasGroupAppearance(group)).toEqual(defaultCanvasGroupAppearance)
    expect(() =>
      setCanvasGroupAppearance(document, group.id, {
        color: "green",
        emoji: "leaf",
      }),
    ).toThrow("unsupported")
    expect(() =>
      setCanvasGroupAppearance(document, group.id, {
        color: "neon" as "green",
        emoji: "leaf",
      }),
    ).toThrow("invalid")
  })

  test("preserves an extended v1 namespace instead of silently deleting unknown fields", () => {
    const group = groupNode()
    const storedAppearance = {
      color: "blue",
      emoji: "camera",
      futureField: "preserve me",
      schema: canvasGroupAppearanceSchema,
    }
    group.data.metadata = { [canvasGroupAppearanceKey]: storedAppearance }
    const document = createCanvasDocument({ id: "canvas", nodes: [group] })

    expect(getCanvasGroupAppearance(group)).toEqual(defaultCanvasGroupAppearance)
    expect(() =>
      setCanvasGroupAppearance(document, group.id, {
        color: "green",
        emoji: "leaf",
      }),
    ).toThrow("unsupported")
    expect(document.nodes[0]?.data.metadata).toEqual({
      [canvasGroupAppearanceKey]: storedAppearance,
    })
  })

  test("is undoable, duplicated, and portable", () => {
    const group = groupNode()
    const document = createCanvasDocument({ id: "canvas", nodes: [group] })
    const history = canvasHistoryReducer(createCanvasHistory(document), {
      type: "commit-update",
      update: (current) =>
        setCanvasGroupAppearance(current, group.id, {
          color: "pink",
          emoji: "heart",
        }),
    })
    const duplicated = duplicateCanvasSelection(history.document, [group.id])
    const clone = duplicated.document.nodes.find((node) => node.id !== group.id)
    const restored = parseStoredCanvasDocument(serializeCanvasDocument(duplicated.document), duplicated.document.id)

    expect(history.document.revision).toBe(1)
    expect(history.past).toEqual([document])
    expect(clone && getCanvasGroupAppearance(clone)).toEqual({
      color: "pink",
      emoji: "heart",
    })
    expect(restored.nodes.map(getCanvasGroupAppearance)).toEqual([
      { color: "pink", emoji: "heart" },
      { color: "pink", emoji: "heart" },
    ])
  })
})
