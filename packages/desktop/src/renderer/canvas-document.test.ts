import { describe, expect, test } from "bun:test"
import { createInitialCanvasDocument, promoteCanvasDocumentProjection } from "./canvas-document"

describe("initial canvas document", () => {
  test("starts a project canvas without starter nodes", () => {
    const document = createInitialCanvasDocument({
      canvasId: "canvas-new",
      canvasName: "Canvas 2",
      projectName: "Example",
    })

    expect(document).toMatchObject({
      id: "canvas-new",
      metadata: { title: "Canvas 2" },
      revision: 0,
    })
    expect(document.nodes).toEqual([])
    expect(document.edges).toEqual([])
  })

  test("keeps only geometry previews local until the Canvas revision advances", () => {
    const initial = createInitialCanvasDocument({ canvasId: "canvas-1" })
    const current = {
      ...initial,
      nodes: [
        {
          data: {
            kind: "text",
            label: "Notes",
            metadata: {},
            resourceState: { contentRevision: "revision-a", status: "ready" as const, text: "Initial" },
          },
          height: 100,
          id: "node-1",
          measured: { height: 100, width: 200 },
          position: { x: 20, y: 10 },
          type: "file" as const,
          width: 200,
        },
      ],
    }
    const preview = {
      ...current,
      nodes: current.nodes.map((node) => ({
        ...node,
        height: 140,
        measured: { height: 140, width: 260 },
        position: { x: 200, y: 100 },
        width: 260,
      })),
    }
    const committed = { ...preview, revision: current.revision + 1 }

    expect(promoteCanvasDocumentProjection(current, preview, current.id)).toBe(current)
    expect(promoteCanvasDocumentProjection(current, committed, current.id)).toBe(committed)
    expect(promoteCanvasDocumentProjection(current, committed, "canvas-2")).toBe(current)
  })

  test("promotes same-revision node data and resource hydration projections", () => {
    const initial = createInitialCanvasDocument({ canvasId: "canvas-1" })
    const current = {
      ...initial,
      nodes: [
        {
          data: {
            kind: "text",
            label: "Notes",
            metadata: {},
            resourceState: { contentRevision: "revision-a", status: "ready" as const, text: "Initial" },
          },
          id: "node-1",
          position: { x: 20, y: 10 },
          type: "file" as const,
        },
      ],
    }
    const dataClone = {
      ...current,
      nodes: current.nodes.map((node) => ({ ...node, data: { ...node.data } })),
    }
    const hydrated = {
      ...current,
      nodes: current.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          resourceState: { contentRevision: "revision-b", status: "ready" as const, text: "Hydrated" },
        },
      })),
    }

    expect(promoteCanvasDocumentProjection(current, dataClone, current.id)).toBe(dataClone)
    expect(promoteCanvasDocumentProjection(current, hydrated, current.id)).toBe(hydrated)
  })

  test("promotes same-revision node-set, edge, and metadata changes", () => {
    const initial = createInitialCanvasDocument({ canvasId: "canvas-1" })
    const sharedData = { kind: "text", label: "Notes", metadata: {} }
    const current = {
      ...initial,
      nodes: [
        { data: sharedData, id: "node-1", position: { x: 0, y: 0 }, type: "file" as const },
        { data: sharedData, id: "node-2", position: { x: 200, y: 0 }, type: "file" as const },
      ],
      edges: [{ id: "edge-1", source: "node-1", target: "node-2" }],
    }
    const semanticClone = {
      ...current,
      metadata: { ...current.metadata },
      edges: current.edges.map((edge) => ({ ...edge })),
      nodes: current.nodes.map((node) => ({ ...node, position: { ...node.position } })),
    }
    const nodeSetChanged = { ...current, nodes: current.nodes.slice(0, 1) }
    const edgeChanged = { ...current, edges: [{ ...current.edges[0], target: "node-1" }] }
    const metadataChanged = { ...current, metadata: { ...current.metadata, title: "Renamed" } }

    expect(promoteCanvasDocumentProjection(current, semanticClone, current.id)).toBe(current)
    expect(promoteCanvasDocumentProjection(current, nodeSetChanged, current.id)).toBe(nodeSetChanged)
    expect(promoteCanvasDocumentProjection(current, edgeChanged, current.id)).toBe(edgeChanged)
    expect(promoteCanvasDocumentProjection(current, metadataChanged, current.id)).toBe(metadataChanged)
  })
})
