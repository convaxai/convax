import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createMediaNode } from "./document"
import { CanvasVisualHistoryCoordinator, type CanvasVisualHistoryAuthority } from "./visual-history"

function authority(ids: readonly string[]): CanvasVisualHistoryAuthority {
  return {
    document: createCanvasDocument({
      id: "canvas-a",
      nodes: ids.map((id, index) => createMediaNode({
        id,
        position: { x: index * 400, y: 0 },
        resource: { id, kind: "image", metadata: {}, name: id, state: { status: "ready" } },
      })),
    }),
    nodeEntities: ids.map((id) => ({ nodeId: id, entity: { id, incarnation: `${id}-incarnation`, kind: "node" } })),
  }
}

describe("Canvas visual history", () => {
  test("predicts inverse presentation and reconciles only the actual Main root", () => {
    const history = new CanvasVisualHistoryCoordinator()
    const before = authority(["source"])
    const after = authority(["source", "duplicate"])
    history.record("root-duplicate", before, after)

    const prediction = history.begin("undo", after, "session-a")
    expect(prediction).not.toBeNull()
    expect(history.overlay.getSnapshot().operations[0]?.items).toEqual([
      {
        kind: "hide-entity",
        entity: { entityId: "duplicate", incarnation: "duplicate-incarnation", kind: "node" },
      },
    ])
    expect(history.reconcile(prediction, { direction: "undo", rootOperationId: "root-duplicate" })).toBeTrue()
    expect(history.overlay.getSnapshot().pendingOperationCount).toBe(0)
  })

  test("clears the speculative suffix when Main reports a different transition", () => {
    const history = new CanvasVisualHistoryCoordinator()
    const before = authority(["source"])
    const after = authority(["source", "duplicate"])
    history.record("root-duplicate", before, after)
    const prediction = history.begin("undo", after, "session-a")

    expect(history.reconcile(prediction, { direction: "undo", rootOperationId: "another-root" })).toBeFalse()
    expect(history.overlay.getSnapshot().pendingOperationCount).toBe(0)
    expect(history.begin("redo", before, "session-a")).toBeNull()
  })
})
