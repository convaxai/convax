import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument, createGroupNode, createTextNode } from "../document"
import {
  activateCanvasOutlineEntry,
  projectCanvasOutline,
} from "./canvas-outline"

function text(id: string, label: string, x: number, y: number, parentId?: string) {
  return {
    ...createTextNode({
      id,
      label,
      metadata: {},
      position: { x, y },
      resourceState: { status: "ready" },
    }),
    parentId,
  }
}

describe("Canvas outline", () => {
  test("projects nested groups and nodes in deterministic spatial order", () => {
    const group = createGroupNode({
      height: 400,
      id: "group",
      label: "Research",
      position: { x: 20, y: 100 },
      width: 500,
    })
    const nested = createGroupNode({
      height: 200,
      id: "nested",
      label: "Evidence",
      parentId: group.id,
      position: { x: 40, y: 80 },
      width: 240,
    })
    const document = createCanvasDocument({
      nodes: [
        text("later", "Later", 600, 100),
        text("nested-note", "Source", 20, 20, nested.id),
        text("first-child", "Question", 20, 20, group.id),
        nested,
        group,
        text("first", "Opening", 0, 0),
      ],
    })

    expect(projectCanvasOutline(document)).toEqual([
      expect.objectContaining({ depth: 0, id: "first" }),
      expect.objectContaining({
        children: [
          expect.objectContaining({ depth: 1, id: "first-child" }),
          expect.objectContaining({
            children: [expect.objectContaining({ depth: 2, id: "nested-note" })],
            depth: 1,
            id: "nested",
          }),
        ],
        depth: 0,
        id: "group",
      }),
      expect.objectContaining({ depth: 0, id: "later" }),
    ])
  })

  test("treats a missing parent as a root without throwing", () => {
    const document = createCanvasDocument({ nodes: [text("orphan", "Orphan", 0, 0, "missing")] })
    const [entry] = projectCanvasOutline(document)
    expect(entry).toMatchObject({ depth: 0, id: "orphan" })
    expect(entry).not.toHaveProperty("parentId")
  })

  test("activates through the existing reveal and selection view command", async () => {
    const execute = mock(async () => ({ foundNodeIds: [], missingNodeIds: [], snapshot: {} as never }))
    await activateCanvasOutlineEntry({ execute }, "node-1")
    expect(execute).toHaveBeenCalledWith({
      animation: "smooth",
      fit: "center",
      nodeIds: ["node-1"],
      select: true,
      type: "nodes.reveal",
    })
  })
})
