import { describe, expect, mock, test } from "bun:test"

import { CanvasDocumentChangeBus } from "./canvas-document-change-bus"

describe("CanvasDocumentChangeBus", () => {
  test("filters revision-only invalidations and stops after close", () => {
    const bus = new CanvasDocumentChangeBus()
    const projectListener = mock(() => undefined)
    const canvasListener = mock(() => undefined)
    const projectSubscription = bus.subscribe({ projectId: "one" }, projectListener)
    const canvasSubscription = bus.subscribe({ canvasId: "main", projectId: "one" }, canvasListener)

    bus.publish({ ref: { canvasId: "other", projectId: "one" }, revision: 1, source: "renderer" })
    bus.publish({ ref: { canvasId: "main", projectId: "one" }, revision: 2, source: "plugin" })
    bus.publish({ ref: { canvasId: "main", projectId: "one" }, revision: 2, source: "host" })
    bus.publish({ ref: { canvasId: "main", projectId: "one" }, revision: 1, source: "renderer" })
    bus.publish({ ref: { canvasId: "main", projectId: "two" }, revision: 3, source: "host" })

    expect(projectListener).toHaveBeenCalledTimes(2)
    expect(canvasListener).toHaveBeenCalledTimes(1)
    expect(canvasListener).toHaveBeenCalledWith({
      ref: { canvasId: "main", projectId: "one" },
      revision: 2,
      source: "plugin",
    })

    projectSubscription.close()
    canvasSubscription.close()
    bus.publish({ ref: { canvasId: "main", projectId: "one" }, revision: 4, source: "plugin" })
    expect(projectListener).toHaveBeenCalledTimes(2)
    expect(canvasListener).toHaveBeenCalledTimes(1)
  })

  test("publishes every new Main revision to the unscoped Renderer projection listener", () => {
    const bus = new CanvasDocumentChangeBus()
    const listener = mock(() => undefined)
    const subscription = bus.subscribeAll(listener)

    bus.publish({ ref: { canvasId: "main", projectId: "one" }, revision: 1, source: "renderer" })
    bus.publish({ ref: { canvasId: "other", projectId: "two" }, revision: 3, source: "host" })
    bus.publish({ ref: { canvasId: "other", projectId: "two" }, revision: 2, source: "plugin" })

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenLastCalledWith({
      ref: { canvasId: "other", projectId: "two" },
      revision: 3,
      source: "host",
    })
    subscription.close()
    bus.publish({ ref: { canvasId: "third", projectId: "three" }, revision: 1, source: "host" })
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
