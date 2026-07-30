import { describe, expect, mock, spyOn, test } from "bun:test"

import { parseWebPluginManifest } from "../plugin-contracts"
import { PluginAgentMcpConnectionService } from "./plugin-agent-mcp-connection"

const plugin = parseWebPluginManifest({
  capabilities: [],
  contributes: {
    agent: {
      mcp: {
        type: "remote",
        url: "https://example.com/mcp",
      },
    },
  },
  description: "Remote Agent MCP",
  hostApi: { major: 1, optional: [], required: [] },
  id: "video-editor",
  name: "Video Editor",
  schema: "convax.plugin/8",
  version: "1.0.0",
})

describe("Plugin Agent MCP connection service", () => {
  test("maps only a validated installed Plugin to OpenCode status and OAuth", async () => {
    const listMcpStatuses = mock(async () => ({
      plugin_video_editor: { status: "needs_auth" as const },
    }))
    const authenticateMcp = mock(async () => ({ status: "connected" as const }))
    const connectMcp = mock(async () => undefined)
    const refreshCapabilities = mock(async () => undefined)
    const service = new PluginAgentMcpConnectionService(
      { authenticateMcp, connectMcp, listMcpStatuses, refreshCapabilities },
      "/host/user-data",
    )

    await service.connect(plugin)

    expect(listMcpStatuses).toHaveBeenCalledWith({ directory: "/host/user-data" })
    expect(authenticateMcp).toHaveBeenCalledWith({
      directory: "/host/user-data",
      name: "plugin_video_editor",
    })
    expect(connectMcp).not.toHaveBeenCalled()
    expect(refreshCapabilities).toHaveBeenCalledTimes(1)
  })

  test("does not restart OAuth when OpenCode is already connected", async () => {
    const authenticateMcp = mock(async () => ({ status: "connected" as const }))
    const service = new PluginAgentMcpConnectionService(
      {
        authenticateMcp,
        connectMcp: async () => undefined,
        listMcpStatuses: async () => ({ plugin_video_editor: { status: "connected" } }),
        refreshCapabilities: async () => undefined,
      },
      "/host/user-data",
    )

    await service.connect(plugin)

    expect(authenticateMcp).not.toHaveBeenCalled()
  })

  test("projects installed Plugin connection status without exposing OpenCode server names or errors", async () => {
    const service = new PluginAgentMcpConnectionService(
      {
        authenticateMcp: async () => ({ status: "connected" }),
        connectMcp: async () => undefined,
        listMcpStatuses: async () => ({
          plugin_video_editor: { error: "client registration required", status: "needs_client_registration" },
          unrelated_server: { error: "private diagnostic", status: "failed" },
        }),
        refreshCapabilities: async () => undefined,
      },
      "/host/user-data",
    )

    await expect(service.listStatuses([plugin])).resolves.toEqual({
      "video-editor": "needs_client_registration",
    })
  })

  test("reconnects a failed server before deciding whether OAuth is required", async () => {
    let connected = false
    const connectMcp = mock(async () => {
      connected = true
    })
    const authenticateMcp = mock(async () => ({ status: "connected" as const }))
    const service = new PluginAgentMcpConnectionService(
      {
        authenticateMcp,
        connectMcp,
        listMcpStatuses: async () => ({
          plugin_video_editor: connected ? { status: "needs_auth" } : { error: "offline", status: "failed" },
        }),
        refreshCapabilities: async () => undefined,
      },
      "/host/user-data",
    )

    await service.connect(plugin)

    expect(connectMcp).toHaveBeenCalledWith({
      directory: "/host/user-data",
      name: "plugin_video_editor",
    })
    expect(authenticateMcp).toHaveBeenCalledTimes(1)
  })

  test("does not expose raw OpenCode diagnostics through the connection action", async () => {
    const service = new PluginAgentMcpConnectionService(
      {
        authenticateMcp: async () => ({ status: "connected" }),
        connectMcp: async () => {
          throw new Error("internal /private/runtime/path and server details")
        },
        listMcpStatuses: async () => ({
          plugin_video_editor: { error: "offline", status: "failed" },
        }),
        refreshCapabilities: async () => undefined,
      },
      "/host/user-data",
    )

    await expect(service.connect(plugin)).rejects.toThrow("Plugin Agent MCP reconnect failed: video-editor")
    await expect(service.connect(plugin)).rejects.not.toHaveProperty(
      "message",
      expect.stringContaining("/private/runtime/path"),
    )
  })

  test("does not expose failed or client-registration status details", async () => {
    const failedService = new PluginAgentMcpConnectionService(
      {
        authenticateMcp: async () => ({ status: "connected" }),
        connectMcp: async () => undefined,
        listMcpStatuses: async () => ({
          plugin_video_editor: {
            error: "private failed detail at /host/user-data/opencode",
            status: "failed",
          },
        }),
        refreshCapabilities: async () => undefined,
      },
      "/host/user-data",
    )
    const registrationService = new PluginAgentMcpConnectionService(
      {
        authenticateMcp: async () => ({
          error: "private OAuth registration payload",
          status: "needs_client_registration",
        }),
        connectMcp: async () => undefined,
        listMcpStatuses: async () => ({
          plugin_video_editor: {
            error: "private registration detail",
            status: "needs_client_registration",
          },
        }),
        refreshCapabilities: async () => undefined,
      },
      "/host/user-data",
    )

    await expect(failedService.connect(plugin)).rejects.toThrow("Plugin Agent MCP connection failed: video-editor")
    await expect(failedService.connect(plugin)).rejects.not.toHaveProperty(
      "message",
      expect.stringContaining("/host/user-data"),
    )
    await expect(registrationService.connect(plugin)).rejects.toThrow(
      "Plugin Agent MCP client registration is required: video-editor",
    )
    await expect(registrationService.connect(plugin)).rejects.not.toHaveProperty(
      "message",
      expect.stringContaining("private OAuth registration payload"),
    )
  })

  test("does not wait for or reject a successful connection when deferred refresh fails", async () => {
    let rejectRefresh: ((reason: unknown) => void) | undefined
    const refreshCapabilities = mock(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRefresh = reject
        }),
    )
    const warning = spyOn(console, "warn").mockImplementation(() => undefined)
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason)
    }
    process.on("unhandledRejection", onUnhandledRejection)
    const service = new PluginAgentMcpConnectionService(
      {
        authenticateMcp: async () => ({ status: "connected" }),
        connectMcp: async () => undefined,
        listMcpStatuses: async () => ({ plugin_video_editor: { status: "needs_auth" } }),
        refreshCapabilities,
      },
      "/host/user-data",
    )

    try {
      const outcome = await Promise.race([
        service.connect(plugin).then(() => "connected" as const),
        new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 50)),
      ])
      expect(outcome).toBe("connected")
      await Promise.resolve()
      expect(refreshCapabilities).toHaveBeenCalledTimes(1)
      expect(rejectRefresh).toBeDefined()

      rejectRefresh?.(new Error("private refresh failure"))
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(unhandledRejections).toEqual([])
      expect(warning).toHaveBeenCalledWith(
        "Plugin Agent MCP connected but deferred Agent refresh failed: video-editor",
        expect.any(Error),
      )
    } finally {
      process.off("unhandledRejection", onUnhandledRejection)
      warning.mockRestore()
    }
  })

  test("fails closed for non-MCP Plugins", async () => {
    const service = new PluginAgentMcpConnectionService(
      {
        authenticateMcp: async () => ({ status: "connected" }),
        connectMcp: async () => undefined,
        listMcpStatuses: async () => ({ plugin_video_editor: { status: "connected" } }),
        refreshCapabilities: async () => undefined,
      },
      "/host/user-data",
    )
    const staticPlugin = {
      ...plugin,
      contributes: {},
      id: "static",
      schema: "convax.plugin/7",
    } as unknown as typeof plugin

    await expect(service.connect(staticPlugin)).rejects.toThrow("does not contribute")
  })
})
