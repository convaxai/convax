import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createMediaNode } from "./document"
import { CanvasVisualHistoryCoordinator, type CanvasVisualHistoryAuthority } from "./visual-history"

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
})
