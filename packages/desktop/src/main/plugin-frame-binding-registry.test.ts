import { describe, expect, test } from "bun:test"

import { PluginFrameBindingRegistry } from "./plugin-frame-binding-registry"

class FakeFrame {
  detached = false
  destroyed = false

  constructor(
    readonly frameTreeNodeId: number,
    public frameToken: string,
    public processId: number,
    public routingId: number,
  ) {}

  isDestroyed() {
    return this.destroyed
  }
}

describe("PluginFrameBindingRegistry", () => {
  test("binds authority to the exact WebContents and complete Electron frame identity", () => {
    const owner = {}
    const otherOwner = {}
    const registry = new PluginFrameBindingRegistry(owner)
    const oldFrame = new FakeFrame(7, "old-token", 11, 13)
    const oldIdentity = registry.bind(owner, oldFrame, "plugin-a@1")

    expect(registry.bindingFor(owner, oldFrame)).toBe("plugin-a@1")
    expect(() => registry.bindingFor(otherOwner, oldFrame)).toThrow("another WebContents")

    const replacement = new FakeFrame(7, "replacement-token", 17, 19)
    expect(registry.bindingFor(owner, replacement)).toBeUndefined()
    registry.bind(owner, replacement, "plugin-b@2")
    expect(registry.bindingFor(owner, replacement)).toBe("plugin-b@2")

    expect(registry.retire(oldIdentity)).toBeFalse()
    expect(registry.bindingFor(owner, replacement)).toBe("plugin-b@2")
    expect(registry.activeBindingCount).toBe(1)
  })

  test("retires destroyed, detached, and navigated frames individually", () => {
    const owner = {}
    const registry = new PluginFrameBindingRegistry(owner)
    const destroyed = new FakeFrame(1, "destroyed-token", 3, 5)
    const detached = new FakeFrame(2, "detached-token", 3, 7)
    const navigated = new FakeFrame(3, "old-document-token", 3, 9)
    const live = new FakeFrame(4, "live-token", 3, 11)
    const navigatedIdentity = registry.bind(owner, navigated, "plugin-c@1")
    registry.bind(owner, destroyed, "plugin-a@1")
    registry.bind(owner, detached, "plugin-b@1")
    registry.bind(owner, live, "plugin-d@1")

    destroyed.destroyed = true
    detached.detached = true
    navigated.frameToken = "new-document-token"
    navigated.routingId = 10
    expect(registry.retireUnavailable(owner)).toBe(3)
    expect(registry.activeBindingCount).toBe(1)
    expect(registry.bindingFor(owner, live)).toBe("plugin-d@1")

    registry.bind(owner, navigated, "plugin-c@2")
    expect(registry.retire(navigatedIdentity)).toBeFalse()
    expect(registry.bindingFor(owner, navigated)).toBe("plugin-c@2")
  })

  test("clears a renderer-process generation and permanently retires a destroyed WebContents registry", () => {
    const owner = {}
    const registry = new PluginFrameBindingRegistry(owner)
    const first = new FakeFrame(1, "first", 3, 5)
    const second = new FakeFrame(2, "second", 3, 7)
    registry.bind(owner, first, "plugin-a@1")
    registry.bind(owner, second, "plugin-b@1")

    expect(registry.clear(owner)).toBe(2)
    expect(registry.activeBindingCount).toBe(0)
    registry.bind(owner, first, "plugin-a@1")
    registry.dispose(owner)
    registry.dispose(owner)
    expect(registry.bindingFor(owner, first)).toBeUndefined()
    expect(() => registry.bind(owner, first, "plugin-a@2")).toThrow("disposed")
  })
})
