import { describe, expect, mock, test } from "bun:test"
import { desktopPluginHostProtocol, type DesktopPluginHostCommand } from "../plugin-host-protocol"
import { DesktopPluginFrameRegistry } from "./plugin-frame-registry"

const ref = {
  canvasId: "canvas-1",
  nodeId: "node-1",
  pluginId: "director-stage",
  projectId: "project-1",
}

describe("DesktopPluginFrameRegistry", () => {
  test("routes toolbar commands only to the exact scoped frame", () => {
    const registry = new DesktopPluginFrameRegistry()
    const send = mock(() => undefined)
    const dispose = registry.register({ ...ref, send })
    const command = {
      command: "scene.focus",
      protocol: desktopPluginHostProtocol,
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
})
