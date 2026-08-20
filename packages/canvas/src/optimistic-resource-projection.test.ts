import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createMediaNode, isCanvasEmptyMediaNodeData } from "./document"
import { isCanvasOptimisticGhostNodeData } from "./optimistic-overlay-react-flow"
import {
  createOptimisticEmptyNodeGhosts,
  createOptimisticResourceGhosts,
  isEmptyLocalCanvasResourceCreate,
  projectCanvasResourceGhostForReactFlow,
} from "./optimistic-resource-projection"

describe("optimistic resource overlay", () => {
  test("centers the first presentation ghost on a pointer anchor", () => {
    const ghosts = createOptimisticResourceGhosts({
      anchor: { x: 400, y: 260 },
      anchorOrigin: "center",
      document: createCanvasDocument({ id: "canvas-centered" }),
      files: [new File(["image"], "frame.png", { type: "image/png" })],
      intrinsicSizes: [{ height: 900, width: 1_600 }],
      createPresentationKey: () => "presentation-centered",
    })

    expect(ghosts[0]).toMatchObject({
      position: { x: 240, y: 170 },
      size: { height: 180, width: 320 },
    })
  })

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

  test("projects an empty pending image as an idle empty card without inventing a File", () => {
    expect(
      isEmptyLocalCanvasResourceCreate({
        files: [],
        pending: { kind: "image" },
        sources: [],
      }),
    ).toBeTrue()
    expect(
      isEmptyLocalCanvasResourceCreate({
        files: [new File(["image"], "frame.png", { type: "image/png" })],
        sources: [],
      }),
    ).toBeFalse()

    const ghosts = createOptimisticEmptyNodeGhosts({
      anchor: { x: 400, y: 260 },
      document: createCanvasDocument({ id: "canvas-empty" }),
      kind: "image",
      createPresentationKey: () => "presentation-empty-image",
    })

    expect(ghosts).toHaveLength(1)
    expect(ghosts[0]).toMatchObject({
      presentation: {
        emptyCard: true,
        mediaKind: "image",
        nodeType: "file",
        title: "Image",
      },
      size: { height: 240, width: 320 },
    })
    expect(ghosts[0]?.presentation).not.toHaveProperty("mimeType")

    const adapted = projectCanvasResourceGhostForReactFlow(ghosts[0]!)
    expect(adapted.data.status).toBe("idle")
    expect(adapted.data.name).toBeUndefined()
    expect(adapted.data.mimeType).toBeUndefined()
    expect(isCanvasEmptyMediaNodeData(adapted.data)).toBeTrue()
    expect(adapted.connectable).toBeFalse()
    expect(isCanvasOptimisticGhostNodeData(adapted.data)).toBeTrue()
    expect(adapted.style?.opacity).toBeUndefined()
  })

  test("projects an empty new-text node as an idle card without inventing a File", () => {
    expect(
      isEmptyLocalCanvasResourceCreate({
        files: [],
        sources: [{ kind: "new-text" }],
      }),
    ).toBeTrue()

    const ghosts = createOptimisticEmptyNodeGhosts({
      anchor: { x: 80, y: 40 },
      document: createCanvasDocument({ id: "canvas-empty-text" }),
      kind: "text",
      createPresentationKey: () => "presentation-empty-text",
    })
    const adapted = projectCanvasResourceGhostForReactFlow(ghosts[0]!)
    expect(adapted.data.kind).toBe("text")
    expect(adapted.data.status).toBe("idle")
    expect(adapted.data.name).toBeUndefined()
    expect(adapted.data.mimeType).toBeUndefined()
    expect(isCanvasOptimisticGhostNodeData(adapted.data)).toBeTrue()
    expect(adapted.style?.opacity).toBeUndefined()
  })
})
