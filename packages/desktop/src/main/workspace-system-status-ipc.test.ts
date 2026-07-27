import { afterEach, describe, expect, mock, test } from "bun:test"

type InvokeHandler = (event: { sender: { id: number } }) => unknown

const handlers = new Map<string, InvokeHandler>()
const getAppMetrics = mock(() => [
  { cpu: { percentCPUUsage: 4.2 }, memory: { privateBytes: 256 } },
  { cpu: { percentCPUUsage: 1.3 }, memory: { workingSetSize: 128 } },
])

void mock.module("electron", () => ({
  app: { getAppMetrics },
  ipcMain: {
    handle: (channel: string, handler: InvokeHandler) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}))

afterEach(() => {
  handlers.clear()
  getAppMetrics.mockClear()
})

describe("workspace system status IPC", () => {
  test("returns only bounded aggregate metrics to a trusted renderer", async () => {
    const { workspaceSystemStatusIpcChannel } = await import("../workspace-system-status-contracts")
    const { registerWorkspaceSystemStatusIpc } = await import("./workspace-system-status-ipc")
    const dispose = registerWorkspaceSystemStatusIpc((event) => event.sender.id === 1)
    const handler = handlers.get(workspaceSystemStatusIpcChannel)
    if (!handler) throw new Error("Workspace system status handler is missing")

    expect(handler({ sender: { id: 1 } })).toMatchObject({
      appCpuPercent: 5.5,
      appMemoryBytes: 384 * 1024,
    })
    expect(getAppMetrics).toHaveBeenCalledTimes(1)
    expect(() => handler({ sender: { id: 2 } })).toThrow("untrusted renderer")

    dispose()
    expect(handlers.has(workspaceSystemStatusIpcChannel)).toBeFalse()
  })
})
