import { describe, expect, test } from "bun:test"

import { parseWebPluginManifest, type InstalledWebPluginSummary } from "../plugin-contracts"
import {
  installedPluginAgentMcpServer,
  installedPluginAgentMcpServers,
  pluginAgentMcpServerName,
} from "./plugin-agent-mcp"

function remotePlugin(id = "remote-editor", oauth: "auto" | "none" = "auto") {
  return parseWebPluginManifest({
    capabilities: [],
    contributes: {
      agent: {
        mcp: {
          headers: { "x-surface": "convax" },
          oauth,
          type: "remote",
          url: "https://example.com/mcp",
        },
      },
    },
    description: "Remote MCP Plugin",
    hostApi: { major: 3, optional: [], required: [] },
    id,
    name: id,
    schema: "convax.plugin/8",
    version: "1.0.0",
  })
}

describe("installed Plugin Agent MCP mapping", () => {
  test("derives a stable collision-free server name and native OpenCode remote config", () => {
    expect(pluginAgentMcpServerName("video-editor")).toBe("plugin_video_editor")
    expect(installedPluginAgentMcpServer(remotePlugin())).toEqual({
      name: "plugin_remote_editor",
      pluginId: "remote-editor",
      server: {
        enabled: true,
        headers: { "x-surface": "convax" },
        networkBoundary: "host-validated-https",
        type: "remote",
        url: "https://example.com/mcp",
      },
    })
    expect(installedPluginAgentMcpServers([remotePlugin("video-editor"), remotePlugin("remote-editor")])).toEqual({
      plugin_remote_editor: {
        enabled: true,
        headers: { "x-surface": "convax" },
        networkBoundary: "host-validated-https",
        type: "remote",
        url: "https://example.com/mcp",
      },
      plugin_video_editor: {
        enabled: true,
        headers: { "x-surface": "convax" },
        networkBoundary: "host-validated-https",
        type: "remote",
        url: "https://example.com/mcp",
      },
    })
  })

  test("maps explicit OAuth disablement and rejects legacy executable runtimes", () => {
    const withoutOauth = remotePlugin("remote-editor", "none")
    const executable = {
      ...remotePlugin("legacy-agent"),
      schema: "convax.plugin/6",
    } as unknown as InstalledWebPluginSummary

    expect(installedPluginAgentMcpServer(withoutOauth)?.server.oauth).toBe(false)
    expect(installedPluginAgentMcpServer(executable)).toBeNull()
    expect(installedPluginAgentMcpServers([executable])).toEqual({})
  })
})
