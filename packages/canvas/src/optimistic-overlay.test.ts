import { describe, expect, test } from "bun:test"
import {
  CanvasCombinedPresentationStore,
  CanvasOptimisticOverlayCoordinator,
  createCanvasOptimisticOperationToken,
} from "./optimistic-overlay"

const ghost = (key: string) => ({
  kind: "ghost-node" as const,
  presentationKey: key,
  position: { x: 0, y: 0 },
  presentation: { nodeType: "text" as const, title: key },
  size: { height: 100, width: 100 },
})

describe("Canvas optimistic overlay", () => {
  test("uses non-serializable operation tokens and enforces both bounds", () => {
    expect(typeof createCanvasOptimisticOperationToken()).toBe("symbol")
    const overlay = new CanvasOptimisticOverlayCoordinator({
      maximumGhostEntities: 2,
      maximumPendingOperations: 2,
    })
    const first = overlay.begin("scope", [ghost("one"), ghost("two")])
    const second = overlay.begin("scope", [ghost("three")])
    expect(first.status).toBe("shown")
    expect(second.status).toBe("bounded")
    expect(overlay.getSnapshot()).toMatchObject({
      ghostEntityCount: 2,
      pendingOperationCount: 2,
      savingWithoutPrediction: 1,
    })
    expect(JSON.stringify(overlay.getSnapshot())).not.toContain("canvas-optimistic-operation")
    overlay.settle(first.token)
    overlay.settle(second.token)
    expect(overlay.getSnapshot().pendingOperationCount).toBe(0)
  })

  test("coalesces authority installation and overlay reconciliation into one snapshot", () => {
    let authority = "before"
    const authorityListeners = new Set<() => void>()
    const overlay = new CanvasOptimisticOverlayCoordinator()
    const scheduled: Array<() => void> = []
    const store = new CanvasCombinedPresentationStore({
      authoritative: {
        getSnapshot: () => authority,
        subscribe(listener) { authorityListeners.add(listener); return () => authorityListeners.delete(listener) },
      },
      overlay,
      schedule: (task) => scheduled.push(task),
    })
    const notifications: Array<ReturnType<typeof store.getSnapshot>> = []
    store.subscribe(() => notifications.push(store.getSnapshot()))
    const operation = overlay.begin("scope", [ghost("saving")])
    scheduled.splice(0).forEach((task) => task())
    notifications.splice(0)

    authority = "after"
    for (const listener of authorityListeners) listener()
    overlay.settle(operation.token)
    expect(scheduled).toHaveLength(1)
    scheduled.shift()!()
    expect(notifications).toEqual([{ authoritative: "after", overlay: expect.objectContaining({ pendingOperationCount: 0 }) }])
    store.dispose()
  })
})
