import { afterEach, describe, expect, mock, test } from "bun:test"

type InvokeHandler = (event: { sender: { id: number } }, value: unknown) => unknown

const handlers = new Map<string, InvokeHandler>()

void mock.module("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: InvokeHandler) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}))

afterEach(() => handlers.clear())

describe("plugin surface IPC", () => {
  test("forwards only trusted create requests", async () => {
    const { pluginSurfaceIpcChannels } = await import("../plugin-surface-contracts")
    const { registerPluginSurfaceIpc } = await import("./plugin-surface-ipc")
    const create = mock(async (_input: unknown) => ({
      createdNodeId: "node-1",
      operationReceipt: { operationId: "op" },
      projection: { id: "canvas", nodes: [], edges: [] },
    }))
    const dispose = registerPluginSurfaceIpc({
      isTrustedSender: (event) => event.sender.id === 1,
      service: { create } as any,
    })
    const handler = handlers.get(pluginSurfaceIpcChannels.create)
    if (!handler) throw new Error("Plugin surface handler is missing")

    const input = { canvasId: "canvas-1", pluginId: "surface-plugin", projectId: "project-1" }
    await expect(handler({ sender: { id: 1 } }, input)).resolves.toMatchObject({
      createdNodeId: "node-1",
    })
    expect(create).toHaveBeenCalledWith(input)
    await expect(handler({ sender: { id: 2 } }, input)).rejects.toThrow("Untrusted Plugin surface sender")
    dispose()
    expect(handlers.has(pluginSurfaceIpcChannels.create)).toBeFalse()
  })
})
