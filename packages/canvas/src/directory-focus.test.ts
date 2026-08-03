import { describe, expect, test } from "bun:test"
import type { CanvasFolderBrowseListing } from "./services"
import {
  createCanvasFolderFocusNodes,
  getCanvasFolderFocusEntry,
  isCanvasFolderFocusNode,
} from "./directory-focus"

const listing: CanvasFolderBrowseListing = {
  entries: [
    { id: "Design/References", kind: "folder", label: "References" },
    { id: "Design/brief.pdf", kind: "file", label: "brief.pdf" },
  ],
  path: [{ id: "Design", label: "Design" }],
  totalCount: 2,
  truncated: false,
}

describe("Canvas folder focus projection", () => {
  test("projects bounded host entries as inert temporary Canvas nodes", () => {
    const nodes = createCanvasFolderFocusNodes({
      listing,
      ownerNodeId: "folder-node",
      reservedNodeIds: ["canvas-folder-focus:folder-node:0"],
    })

    expect(nodes).toHaveLength(2)
    expect(nodes.map((node) => node.id)).toEqual([
      "canvas-folder-focus:folder-node:0:1",
      "canvas-folder-focus:folder-node:1",
    ])
    expect(nodes.map((node) => node.data.kind)).toEqual(["folder", "file"])
    for (const node of nodes) {
      expect(node).toMatchObject({
        connectable: false,
        deletable: false,
        draggable: false,
        selectable: false,
        type: "file",
      })
      expect(isCanvasFolderFocusNode(node)).toBe(true)
    }
    expect(getCanvasFolderFocusEntry(nodes[0])).toEqual({
      entryId: "Design/References",
      kind: "folder",
      ownerNodeId: "folder-node",
    })
    expect(getCanvasFolderFocusEntry(nodes[1])).toEqual({
      entryId: "Design/brief.pdf",
      kind: "file",
      ownerNodeId: "folder-node",
    })
  })

  test("caps a hostile or outdated host listing without persisting any entry", () => {
    const nodes = createCanvasFolderFocusNodes({
      listing: {
        ...listing,
        entries: Array.from({ length: 240 }, (_, index) => ({
          id: `Design/file-${index}.txt`,
          kind: "file" as const,
          label: `file-${index}.txt`,
        })),
        totalCount: 240,
        truncated: true,
      },
      ownerNodeId: "folder-node",
    })

    expect(nodes).toHaveLength(200)
    expect(nodes.every(isCanvasFolderFocusNode)).toBe(true)
  })
})
