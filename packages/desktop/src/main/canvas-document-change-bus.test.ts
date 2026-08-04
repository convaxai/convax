import { describe, expect, mock, test } from "bun:test"

import { CanvasDocumentChangeBus } from "./canvas-document-change-bus"

const receipt = (operationId: string) => ({ actorId: "actor", operationId }) as never
const event = (projectId: string, canvasId: string, operationId: string, source: "host" | "plugin" | "renderer") => ({
  operationReceipt: receipt(operationId),
  ref: { canvasId, projectId },
  source,
})

describe("CanvasDocumentChangeBus", () => {
  test("filters duplicate operation invalidations and stops after close", () => {
    const bus = new CanvasDocumentChangeBus()
    const projectListener = mock(() => undefined)
    const canvasListener = mock(() => undefined)
    const projectSubscription = bus.subscribe({ projectId: "one" }, projectListener)
    const canvasSubscription = bus.subscribe({ canvasId: "main", projectId: "one" }, canvasListener)

    bus.publish(event("one", "other", "operation-1", "renderer"))
    bus.publish(event("one", "main", "operation-2", "plugin"))
    bus.publish(event("one", "main", "operation-2", "host"))
    bus.publish(event("one", "main", "operation-1", "renderer"))
    bus.publish(event("two", "main", "operation-3", "host"))

    expect(projectListener).toHaveBeenCalledTimes(3)
    expect(canvasListener).toHaveBeenCalledTimes(2)
    expect(canvasListener).toHaveBeenNthCalledWith(1, event("one", "main", "operation-2", "plugin"))
    expect(canvasListener).toHaveBeenNthCalledWith(2, event("one", "main", "operation-1", "renderer"))

    projectSubscription.close()
    canvasSubscription.close()
    bus.publish(event("one", "main", "operation-4", "plugin"))
    expect(projectListener).toHaveBeenCalledTimes(3)
    expect(canvasListener).toHaveBeenCalledTimes(2)
  })

  test("publishes every new Main operation to the unscoped Renderer projection listener", () => {
    const bus = new CanvasDocumentChangeBus()
    const listener = mock(() => undefined)
    const subscription = bus.subscribeAll(listener)

    bus.publish(event("one", "main", "operation-1", "renderer"))
    bus.publish(event("two", "other", "operation-3", "host"))
    bus.publish(event("two", "other", "operation-3", "plugin"))

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenLastCalledWith(event("two", "other", "operation-3", "host"))
    subscription.close()
    bus.publish(event("three", "third", "operation-4", "host"))
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
