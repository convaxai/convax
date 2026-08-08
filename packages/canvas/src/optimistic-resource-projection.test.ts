import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createMediaNode } from "./document"
import {
  createOptimisticResourceGhosts,
  projectCanvasResourceGhostForReactFlow,
} from "./optimistic-resource-projection"

describe("optimistic resource overlay", () => {
  test("creates presentation ghosts without changing the authoritative document", () => {
    const authoritative = createCanvasDocument({
      id: "canvas-a",
      nodes: [
        createMediaNode({
          id: "existing",
          position: { x: 20, y: 40 },
          resource: { id: "existing", kind: "image", metadata: {}, state: { status: "ready" } },
        }),
      ],
    })
    let nextKey = 0
    const ghosts = createOptimisticResourceGhosts({
      anchor: { x: 20, y: 40 },
      document: authoritative,
      files: [
        new File(["image"], "frame.png", { type: "image/png" }),
        new File(["# Brief"], "brief.md", { type: "text/markdown" }),
      ],
      intrinsicSizes: [{ height: 900, width: 1_600 }, null],
      parentPresentationKey: "group-a",
      createPresentationKey: () => `presentation-${++nextKey}`,
    })

    expect(authoritative.nodes.map((node) => node.id)).toEqual(["existing"])
    expect(
      ghosts.map((ghost) => ({
        kind: ghost.kind,
        nodeType: ghost.presentation.nodeType,
        title: ghost.presentation.title,
      })),
    ).toEqual([
      { kind: "ghost-node", nodeType: "file", title: "frame.png" },
      { kind: "ghost-node", nodeType: "text", title: "brief.md" },
    ])
    expect(ghosts.every((ghost) => ghost.parentPresentationKey === "group-a")).toBeTrue()
    expect(ghosts.map((ghost) => ghost.size)).toEqual([
      { height: 180, width: 320 },
      { height: 180, width: 320 },
    ])
    expect(ghosts[0]?.position).not.toEqual(ghosts[1]?.position)

    const adapted = ghosts.map(projectCanvasResourceGhostForReactFlow)
    expect(
      adapted.every(
        (node) =>
          node.connectable === false &&
          node.deletable === false &&
          node.draggable === false &&
          node.focusable === false &&
          node.selectable === false &&
          node.data.status === "pending",
      ),
    ).toBeTrue()
    expect(JSON.stringify(ghosts)).not.toContain("connectable")
  })
})
