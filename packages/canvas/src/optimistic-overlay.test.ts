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

  test("fills an existing opaque operation without changing its token or order", () => {
    const overlay = new CanvasOptimisticOverlayCoordinator()
    const first = overlay.begin("scope", [])
    const second = overlay.begin("scope", [ghost("second")])

    expect(overlay.replace(first.token, [ghost("first")])).toBeTrue()
    expect(overlay.getSnapshot().operations.map((operation) => operation.token)).toEqual([first.token, second.token])
    expect(overlay.getSnapshot().operations[0]?.items).toEqual([ghost("first")])
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

  test("invokes the presentation scheduler without rebinding its receiver", () => {
    const overlay = new CanvasOptimisticOverlayCoordinator()
    const scheduled: Array<() => void> = []
    let receiver: unknown = "not-called"
    const schedule = function (this: unknown, task: () => void) {
      receiver = this
      scheduled.push(task)
    }
    const store = new CanvasCombinedPresentationStore({
      authoritative: {
        getSnapshot: () => "authority",
        subscribe: () => () => undefined,
      },
      overlay,
      schedule,
    })
    store.subscribe(() => undefined)

    overlay.begin("scope", [ghost("saving")])

    expect(receiver).toBeUndefined()
    expect(scheduled).toHaveLength(1)
    scheduled[0]!()
    store.dispose()
  })

  test("does not strand the coalescing latch when scheduling throws", () => {
    const overlay = new CanvasOptimisticOverlayCoordinator()
    let attempts = 0
    const scheduled: Array<() => void> = []
    const store = new CanvasCombinedPresentationStore({
      authoritative: {
        getSnapshot: () => "authority",
        subscribe: () => () => undefined,
      },
      overlay,
      schedule: (task) => {
        attempts += 1
        if (attempts === 1) throw new Error("scheduler unavailable")
        scheduled.push(task)
      },
    })
    store.subscribe(() => undefined)

    expect(() => overlay.begin("scope", [ghost("first")])).toThrow("scheduler unavailable")
    overlay.begin("scope", [ghost("second")])

    expect(attempts).toBe(2)
    expect(scheduled).toHaveLength(1)
    scheduled[0]!()
    store.dispose()
  })
})
