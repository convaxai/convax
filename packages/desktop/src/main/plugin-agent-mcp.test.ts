import { describe, expect, test } from "bun:test"

import { parseWebPluginManifest } from "../plugin-contracts"
import {
  installedPluginAgentMcpServer,
  installedPluginAgentMcpServers,
  pluginAgentMcpServerName,
} from "./plugin-agent-mcp"

function remotePlugin(id = "remote-editor") {
  return parseWebPluginManifest({
    capabilities: [],
    contributes: {
      agent: {
        mcp: {
          headers: { "x-surface": "convax" },
          oauth: "auto",
          type: "remote",
          url: "https://example.com/mcp",
        },
      },
    },
    description: "Remote MCP Plugin",
    id,
    name: id,
    schema: "convax.plugin/6",
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
        type: "remote",
        url: "https://example.com/mcp",
      },
    })
    expect(installedPluginAgentMcpServers([remotePlugin("video-editor"), remotePlugin("remote-editor")])).toEqual({
      plugin_remote_editor: {
        enabled: true,
        headers: { "x-surface": "convax" },
        type: "remote",
        url: "https://example.com/mcp",
      },
      plugin_video_editor: {
        enabled: true,
        headers: { "x-surface": "convax" },
        type: "remote",
        url: "https://example.com/mcp",
      },
    })
  })

  test("maps explicit OAuth disablement and ignores pre-v6 executable MCP runtimes", () => {
    const withoutOauth = remotePlugin()
    withoutOauth.contributes.agent!.mcp!.oauth = "none"
    const executable = parseWebPluginManifest({
      capabilities: [],
      contributes: {
        generation: {
          tools: [
            {
              acceptedInputs: ["text"],
              description: "Generate",
              id: "generate",
              output: "image",
              title: "Generate",
            },
          ],
        },
      },
      description: "Executable Tool Plugin",
      id: "local-tool",
      name: "Local tool",
      runtime: { command: "local-tool", type: "mcp-stdio" },
      schema: "convax.plugin/2",
      version: "1.0.0",
    })

    expect(installedPluginAgentMcpServer(withoutOauth)?.server.oauth).toBe(false)
    expect(installedPluginAgentMcpServer(executable)).toBeNull()
    expect(installedPluginAgentMcpServers([executable])).toEqual({})
  })
})
