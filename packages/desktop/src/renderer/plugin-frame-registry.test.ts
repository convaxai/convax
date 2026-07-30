import { describe, expect, mock, test } from "bun:test"
import { desktopPluginHostProtocolV8, type DesktopPluginHostCommand } from "../plugin-host-protocol"
import { DesktopPluginFrameRegistry } from "./plugin-frame-registry"

const ref = {
  activeRevision: 7,
  activeSetDigest: "a".repeat(64),
  canvasId: "canvas-1",
  nodeId: "node-1",
  pluginId: "director-stage",
  pluginVersion: "1.2.3",
  projectId: "project-1",
  snapshotDigest: "b".repeat(64),
}

describe("DesktopPluginFrameRegistry", () => {
  test("routes toolbar commands only to the exact scoped frame", () => {
    const registry = new DesktopPluginFrameRegistry()
    const send = mock(() => undefined)
    const dispose = registry.register({ ...ref, send })
    const command = {
      command: "scene.focus",
      protocol: desktopPluginHostProtocolV8,
      type: "command",
    } satisfies DesktopPluginHostCommand

    expect(registry.send(ref, command)).toBe(true)
    expect(send).toHaveBeenCalledWith(command)
    expect(registry.send({ ...ref, nodeId: "node-2" }, command)).toBe(false)
    expect(registry.send({ ...ref, projectId: "project-2" }, command)).toBe(false)

    dispose()
    expect(registry.send(ref, command)).toBe(false)
  })

  test("rejects a second live frame for the same scoped node", () => {
    const registry = new DesktopPluginFrameRegistry()
    const registration = { ...ref, send: () => undefined }
    registry.register(registration)
    expect(() => registry.register({ ...registration })).toThrow("already registered")
  })

  test("refuses to deliver a stale command after the same scoped frame is replaced", () => {
    const registry = new DesktopPluginFrameRegistry()
    const oldSend = mock(() => undefined)
    const disposeOld = registry.register({ ...ref, send: oldSend })
    const oldLease = registry.capture(ref)
    expect(oldLease).toBeDefined()

    disposeOld()
    const newSend = mock(() => undefined)
    registry.register({ ...ref, send: newSend })
    const newLease = registry.capture(ref)
    expect(newLease).toBeDefined()
    const command = {
      command: "scene.focus",
      protocol: desktopPluginHostProtocolV8,
      type: "command",
    } satisfies DesktopPluginHostCommand

    expect(registry.sendExact(oldLease!, command)).toBe(false)
    expect(oldSend).not.toHaveBeenCalled()
    expect(newSend).not.toHaveBeenCalled()
    expect(registry.sendExact(newLease!, command)).toBe(true)
    expect(newSend).toHaveBeenCalledWith(command)
  })

  test("keeps same-version snapshot generations as distinct frame registrations", () => {
    const registry = new DesktopPluginFrameRegistry()
    const oldSend = mock(() => undefined)
    const next = {
      ...ref,
      activeRevision: ref.activeRevision + 1,
      activeSetDigest: "c".repeat(64),
      snapshotDigest: "d".repeat(64),
    }
    const disposeOld = registry.register({ ...ref, send: oldSend })
    const oldLease = registry.capture(ref)
    expect(oldLease).toBeDefined()
    expect(registry.has(next)).toBeFalse()

    disposeOld()
    const nextSend = mock(() => undefined)
    registry.register({ ...next, send: nextSend })
    const command = {
      command: "scene.focus",
      protocol: desktopPluginHostProtocolV8,
      type: "command",
    } satisfies DesktopPluginHostCommand
    expect(registry.sendExact(oldLease!, command)).toBeFalse()
    expect(registry.send(next, command)).toBeTrue()
    expect(oldSend).not.toHaveBeenCalled()
    expect(nextSend).toHaveBeenCalledWith(command)
  })

  test("keeps opaque frame leases bound to the registry that issued them", () => {
    const first = new DesktopPluginFrameRegistry()
    const second = new DesktopPluginFrameRegistry()
    const send = mock(() => undefined)
    first.register({ ...ref, send })
    second.register({ ...ref, send })
    const lease = first.capture(ref)
    const command = {
      command: "scene.focus",
      protocol: desktopPluginHostProtocolV8,
      type: "command",
    } satisfies DesktopPluginHostCommand

    expect(second.sendExact(lease!, command)).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
