import { describe, expect, mock, test } from "bun:test"

import type { PluginCapabilityEvent, PluginCapabilityRendererClient } from "../plugin-capability-ipc"
import { pluginCapabilityProtocolV1 } from "../plugin-host-protocol"
import { RendererPluginHostConnection } from "./plugin-host-connection"

describe("RendererPluginHostConnection", () => {
  test("binds calls and events to one opaque main connection and disconnects", async () => {
    let listener: ((event: PluginCapabilityEvent) => void) | undefined
    const disconnect = mock(async () => true)
    const call = mock(async () => ({
      id: "request-1",
      ok: true as const,
      protocol: pluginCapabilityProtocolV1,
      result: { projects: [] },
      type: "response" as const,
    }))
    const client: PluginCapabilityRendererClient = {
      call,
      async connect() {
        return { connectionId: "opaque-1", protocol: pluginCapabilityProtocolV1 }
      },
      disconnect,
      onEvent(next) {
        listener = next
        return () => {
          listener = undefined
        }
      },
    }
    const onCommand = mock(() => undefined)
    const connection = new RendererPluginHostConnection(
      client,
      { pluginId: "one", pluginVersion: "1.0.0", projectId: "project", runtime: "web" },
      onCommand,
    )
    const request = {
      id: "request-1",
      method: "projects.list",
      protocol: pluginCapabilityProtocolV1,
      type: "request",
    }

    expect(await connection.dispatch(request)).toMatchObject({ ok: true })
    expect(call).toHaveBeenCalledWith({ connectionId: "opaque-1", request })
    listener?.({
      command: { command: "canvas.document.changed", protocol: pluginCapabilityProtocolV1, type: "command" },
      connectionId: "other",
    })
    listener?.({
      command: { command: "canvas.document.changed", protocol: pluginCapabilityProtocolV1, type: "command" },
      connectionId: "opaque-1",
    })
    expect(onCommand).toHaveBeenCalledTimes(1)

    connection.close()
    expect(disconnect).toHaveBeenCalledWith({ connectionId: "opaque-1" })
  })

  test("rejects oversized iframe requests before copying them across preload IPC", async () => {
    const call = mock(async () => null)
    const connection = new RendererPluginHostConnection(
      {
        call,
        async connect() {
          return { connectionId: "opaque-1", protocol: pluginCapabilityProtocolV1 }
        },
        async disconnect() {
          return true
        },
        onEvent() {
          return () => undefined
        },
      },
      { pluginId: "one", pluginVersion: "1.0.0", projectId: "project", runtime: "web" },
      () => undefined,
    )

    await expect(
      connection.dispatch({
        id: "oversized",
        method: "canvas.nodes.query",
        params: { query: { text: "x".repeat(1024 * 1024) } },
        protocol: pluginCapabilityProtocolV1,
        type: "request",
      }),
    ).resolves.toMatchObject({ error: expect.stringContaining("exceeds 1048576 bytes"), ok: false })
    expect(call).not.toHaveBeenCalled()
    connection.close()
  })
})
