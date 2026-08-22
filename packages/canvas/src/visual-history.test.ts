import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createMediaNode, createTextNode } from "./document"
import { applyCanvasReplacePresentation } from "./optimistic-overlay-react-flow"
import { CanvasVisualHistoryCoordinator, type CanvasVisualHistoryAuthority } from "./visual-history"
import type { CanvasDocument } from "./types"

function authority(ids: readonly string[]): CanvasVisualHistoryAuthority {
  return {
    document: createCanvasDocument({
      id: "canvas-a",
      nodes: ids.map((id, index) =>
        createMediaNode({
          id,
          position: { x: index * 400, y: 0 },
          resource: { id, kind: "image", metadata: {}, name: id, state: { status: "ready" } },
        }),
      ),
    }),
    edgeEntities: [],
    nodeEntities: ids.map((id) => ({ nodeId: id, entity: { id, incarnation: `${id}-incarnation`, kind: "node" } })),
  }
}

function guardCompleteDocumentAccess(document: CanvasDocument): CanvasDocument {
  const fail = () => {
    throw new Error("visual history synchronously inspected the complete Canvas document")
  }
  return new Proxy(document, {
    get: fail,
    getOwnPropertyDescriptor: fail,
    getPrototypeOf: fail,
    has: fail,
    ownKeys: fail,
  })
}

describe("Canvas visual history", () => {
  test("predicts inverse presentation and reconciles only the actual Main root", () => {
    const history = new CanvasVisualHistoryCoordinator()
    const before = authority(["source"])
    const after = authority(["source", "duplicate"])
    history.record("root-duplicate", before, after)

    const prediction = history.begin("undo", "session-a")
    expect(prediction).not.toBeNull()
    expect(history.overlay.getSnapshot().operations[0]?.items).toEqual([
      {
        kind: "hide-entity",
        entity: { entityId: "duplicate", incarnation: "duplicate-incarnation", kind: "node" },
      },
    ])
    expect(history.reconcile(prediction, { direction: "undo", rootOperationId: "root-duplicate" }, before)).toBeTrue()
    expect(history.overlay.getSnapshot().pendingOperationCount).toBe(0)
  })

  test("clears the speculative suffix when Main reports a different transition", () => {
    const history = new CanvasVisualHistoryCoordinator()
    const before = authority(["source"])
    const after = authority(["source", "duplicate"])
    history.record("root-duplicate", before, after)
    const prediction = history.begin("undo", "session-a")

    expect(history.reconcile(prediction, { direction: "undo", rootOperationId: "another-root" }, before)).toBeFalse()
    expect(history.overlay.getSnapshot().pendingOperationCount).toBe(0)
    expect(history.begin("redo", "session-a")).toBeNull()
  })

  test("stages an opaque root without running business semantics and fills its inverse from Main authority", () => {
    const history = new CanvasVisualHistoryCoordinator()
    const before = authority(["source", "target"])
    const staged = history.stagePendingRoot("create-command", before)

    expect(staged).toBe("provisional:create-command")
    expect(history.canUndo()).toBeTrue()
    const undo = history.begin("undo", "session-a")
    expect(history.overlay.getSnapshot().operations[0]?.items).toEqual([])

    const actualAfter = authority(["source", "target", "owner-derived-node"])
    expect(history.bindStagedRoot(staged!, "root-create", before, actualAfter)).toBeTrue()
    expect(history.overlay.getSnapshot().operations[0]?.items).toEqual([
      {
        kind: "hide-entity",
        entity: {
          entityId: "owner-derived-node",
          incarnation: "owner-derived-node-incarnation",
          kind: "node",
        },
      },
    ])
    expect(history.reconcile(undo, { direction: "undo", rootOperationId: "root-create" }, before)).toBeTrue()
  })

  test("stages and binds an opaque root without reading or cloning the complete Canvas document", () => {
    const history = new CanvasVisualHistoryCoordinator()
    const source = authority(["source"])
    const guarded: CanvasVisualHistoryAuthority = {
      ...source,
      document: guardCompleteDocumentAccess(source.document),
    }

    const staged = history.stagePendingRoot("opaque-command", guarded)

    expect(staged).toBe("provisional:opaque-command")
    expect(history.bindStagedRoot(staged!, "root-opaque", guarded, guarded)).toBeTrue()
    expect(history.canUndo()).toBeTrue()
  })

  test("does not stage a visual root for a geometry command that changes nothing", () => {
    const history = new CanvasVisualHistoryCoordinator()
    const current = authority(["source"])

    expect(
      history.stageRendererCommand(
        "same-geometry",
        {
          format: "convax.canvas-renderer-command",
          kind: "canvas.nodes.set-geometry",
          body: {
            updates: [
              {
                node: { id: "source", incarnation: "source-incarnation", kind: "node" },
                position: { x: 0, y: 0 },
              },
            ],
          },
        },
        current,
      ),
    ).toBeNull()
    expect(history.canUndo()).toBeFalse()
  })

  test("tracks the authoritative incarnation created by redo for the next immediate undo", () => {
    const history = new CanvasVisualHistoryCoordinator()
    const before = authority([])
    const firstCreation = authority(["created-first"])
    history.record("root-create", before, firstCreation)

    const undo = history.begin("undo", "session-a")
    expect(history.reconcile(undo, { direction: "undo", rootOperationId: "root-create" }, before)).toBeTrue()
    const redo = history.begin("redo", "session-a")
    const recreated = authority(["created-again"])
    expect(history.reconcile(redo, { direction: "redo", rootOperationId: "root-create" }, recreated)).toBeTrue()

    history.begin("undo", "session-a")
    expect(history.overlay.getSnapshot().operations[0]?.items).toEqual([
      {
        kind: "hide-entity",
        entity: { entityId: "created-again", incarnation: "created-again-incarnation", kind: "node" },
      },
    ])
  })

  test("drops only the failed provisional suffix and retains earlier durable history", () => {
    const history = new CanvasVisualHistoryCoordinator()
    const before = authority(["source"])
    const committed = authority(["source", "durable"])
    history.record("root-durable", before, committed)
    const staged = history.stagePendingRoot("pending-command", committed)

    history.rejectStagedRoot(staged)

    expect(history.canUndo()).toBeTrue()
    const undo = history.begin("undo", "session-a")
    expect(history.reconcile(undo, { direction: "undo", rootOperationId: "root-durable" }, before)).toBeTrue()
  })

  test("projects complete node data and exact edge removal/restoration", () => {
    const history = new CanvasVisualHistoryCoordinator()
    const beforeNode = createMediaNode({
      id: "source",
      position: { x: 0, y: 0 },
      resource: { id: "source", kind: "image", metadata: { version: 1 }, name: "Before", state: { status: "ready" } },
    })
    const afterNode = {
      ...beforeNode,
      position: { x: 40, y: 20 },
      data: { ...beforeNode.data, fit: "cover" as const, label: "After", metadata: { version: 2 } },
    }
    const target = createMediaNode({
      id: "target",
      position: { x: 400, y: 0 },
      resource: { id: "target", kind: "image", metadata: {}, name: "Target", state: { status: "ready" } },
    })
    const nodeEntities = [beforeNode, target].map((node) => ({
      nodeId: node.id,
      entity: { id: node.id, incarnation: `${node.id}-incarnation`, kind: "node" as const },
    }))
    const before: CanvasVisualHistoryAuthority = {
      document: createCanvasDocument({ id: "canvas-a", nodes: [beforeNode, target] }),
      edgeEntities: [],
      nodeEntities,
    }
    const after: CanvasVisualHistoryAuthority = {
      document: createCanvasDocument({
        id: "canvas-a",
        nodes: [afterNode, target],
        edges: [{ id: "edge-a", source: "source", target: "target", data: { label: "input" } }],
      }),
      edgeEntities: [{ edgeId: "edge-a", entity: { id: "edge-a", incarnation: "edge-incarnation", kind: "edge" } }],
      nodeEntities,
    }
    history.record("root-complete", before, after)

    const undo = history.begin("undo", "session-a")
    expect(history.overlay.getSnapshot().operations[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "replace-presentation",
          snapshot: expect.objectContaining({
            data: expect.objectContaining({ label: "Before", metadata: { version: 1 } }),
          }),
        }),
        {
          kind: "hide-entity",
          entity: { entityId: "edge-a", incarnation: "edge-incarnation", kind: "edge" },
        },
      ]),
    )
    expect(history.reconcile(undo, { direction: "undo", rootOperationId: "root-complete" }, before)).toBeTrue()

    const redo = history.begin("redo", "session-a")
    expect(history.overlay.getSnapshot().operations[0]?.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "ghost-edge", label: "input" })]),
    )
    expect(redo).not.toBeNull()
  })

  test("keeps live text and media data mounted while predicting a geometry-only undo", () => {
    const history = new CanvasVisualHistoryCoordinator()
    const beforeText = createTextNode({
      id: "text",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "loading" },
    })
    const beforeImage = createMediaNode({
      id: "image",
      position: { x: 400, y: 0 },
      resource: {
        id: "image-resource",
        kind: "image",
        metadata: {},
        name: "Image",
        state: { status: "loading" },
      },
    })
    const beforeNodes = [beforeText, beforeImage]
    const afterNodes = beforeNodes.map((node) => ({
      ...node,
      position: { x: node.position.x + 240, y: node.position.y + 160 },
    }))
    const nodeEntities = beforeNodes.map((node) => ({
      nodeId: node.id,
      entity: { id: node.id, incarnation: `${node.id}-incarnation`, kind: "node" as const },
    }))
    const before: CanvasVisualHistoryAuthority = {
      document: createCanvasDocument({ id: "canvas-a", nodes: beforeNodes }),
      edgeEntities: [],
      nodeEntities,
    }
    const after: CanvasVisualHistoryAuthority = {
      document: createCanvasDocument({ id: "canvas-a", nodes: afterNodes }),
      edgeEntities: [],
      nodeEntities,
    }
    history.record("root-move", before, after)

    history.begin("undo", "session-a")
    const replacements = history.overlay
      .getSnapshot()
      .operations[0]?.items.filter((item) => item.kind === "replace-presentation")
    expect(replacements).toHaveLength(2)
    for (const [index, afterNode] of afterNodes.entries()) {
      const replacement = replacements?.find((item) => item.entity.entityId === afterNode.id)
      expect(replacement?.snapshot).toBeUndefined()
      if (!replacement) throw new Error(`missing ${afterNode.id} replacement`)
      const liveData = {
        ...afterNode.data,
        resourceState:
          afterNode.data.kind === "text"
            ? { status: "ready" as const, text: "live text" }
            : { status: "ready" as const, url: "blob:live-image" },
      }
      const projected = applyCanvasReplacePresentation({ ...afterNode, data: liveData }, replacement)
      expect(projected.position).toEqual(beforeNodes[index]?.position)
      expect(projected.data).toBe(liveData)
    }
  })
})
