import type { AgentMcpServerStatus } from "@convax/agent-runtime/node"

import type {
  InstalledWebPluginSummary,
  WebPluginAgentMcpConnectionStatus,
  WebPluginAgentMcpConnectionStatuses,
} from "../plugin-contracts"
import { installedPluginAgentMcpServer } from "./plugin-agent-mcp"

export interface PluginAgentMcpRuntime {
  authenticateMcp(input: { directory: string; name: string }): Promise<AgentMcpServerStatus>
  connectMcp(input: { directory: string; name: string }): Promise<void>
  listMcpStatuses(input: { directory: string }): Promise<Record<string, AgentMcpServerStatus>>
  refreshCapabilities(): Promise<void>
}

/**
 * Main-only adapter from an installed Plugin id to OpenCode's native OAuth API.
 * The renderer never selects a server name or supplies connection material.
 */
export class PluginAgentMcpConnectionService {
  readonly #directory: string
  readonly #runtime: PluginAgentMcpRuntime

  constructor(runtime: PluginAgentMcpRuntime, directory: string) {
    if (!directory.trim()) throw new Error("Plugin Agent MCP connection directory is required")
    this.#directory = directory
    this.#runtime = runtime
  }

  async listStatuses(plugins: readonly InstalledWebPluginSummary[]): Promise<WebPluginAgentMcpConnectionStatuses> {
    const servers = plugins.flatMap((plugin) => {
      const server = installedPluginAgentMcpServer(plugin)
      return server ? [{ pluginId: plugin.id, serverName: server.name }] : []
    })
    if (servers.length === 0) return {}

    let statuses: Record<string, AgentMcpServerStatus>
    try {
      statuses = await this.#runtime.listMcpStatuses({ directory: this.#directory })
    } catch {
      return Object.fromEntries(servers.map(({ pluginId }) => [pluginId, "unavailable"]))
    }
    return Object.fromEntries(
      servers.map(({ pluginId, serverName }) => [pluginId, rendererStatus(statuses[serverName])]),
    )
  }

  async connect(plugin: InstalledWebPluginSummary): Promise<void> {
    const resolved = installedPluginAgentMcpServer(plugin)
    if (!resolved) throw new Error(`Plugin does not contribute a remote Agent MCP server: ${plugin.id}`)

    let current = (await this.#readStatuses(plugin.id))[resolved.name]
    if (!current) throw new Error(`OpenCode did not load the Plugin Agent MCP server: ${plugin.id}`)
    if (current.status === "connected") {
      this.#refreshProjectConnections(plugin.id)
      return
    }
    if (current.status === "disabled") throw new Error(`Plugin Agent MCP server is disabled: ${plugin.id}`)
    if (current.status === "failed") {
      try {
        await this.#runtime.connectMcp({ directory: this.#directory, name: resolved.name })
      } catch {
        throw new Error(`Plugin Agent MCP reconnect failed: ${plugin.id}`)
      }
      current = (await this.#readStatuses(plugin.id))[resolved.name]
      if (!current) throw new Error(`OpenCode did not load the Plugin Agent MCP server: ${plugin.id}`)
      if (current.status === "connected") {
        this.#refreshProjectConnections(plugin.id)
        return
      }
      if (current.status === "disabled") throw new Error(`Plugin Agent MCP server is disabled: ${plugin.id}`)
      if (current.status === "failed") throw new Error(`Plugin Agent MCP connection failed: ${plugin.id}`)
    }

    let authenticated: AgentMcpServerStatus
    try {
      authenticated = await this.#runtime.authenticateMcp({
        directory: this.#directory,
        name: resolved.name,
      })
    } catch {
      throw new Error(`Plugin Agent MCP authentication failed: ${plugin.id}`)
    }
    if (authenticated.status === "failed") throw new Error(`Plugin Agent MCP authentication failed: ${plugin.id}`)
    if (authenticated.status === "needs_client_registration") {
      throw new Error(`Plugin Agent MCP client registration is required: ${plugin.id}`)
    }
    if (authenticated.status !== "connected") {
      throw new Error(`Plugin Agent MCP authentication did not connect: ${plugin.id}`)
    }
    // OAuth credentials are OpenCode-owned and durable, while MCP clients are
    // directory-instance scoped. Dispose the live instances so every Project
    // reconnects with the newly stored credential on its next Agent call. This
    // cleanup is deliberately detached: an active Agent run must not block the
    // successful connection action, and cleanup failure cannot revoke OAuth.
    this.#refreshProjectConnections(plugin.id)
  }

  async #readStatuses(pluginId: string) {
    try {
      return await this.#runtime.listMcpStatuses({ directory: this.#directory })
    } catch {
      throw new Error(`Plugin Agent MCP status is unavailable: ${pluginId}`)
    }
  }

  #refreshProjectConnections(pluginId: string) {
    void Promise.resolve()
      .then(() => this.#runtime.refreshCapabilities())
      .catch((error: unknown) => {
        console.warn(`Plugin Agent MCP connected but deferred Agent refresh failed: ${pluginId}`, error)
      })
  }
}

function rendererStatus(status: AgentMcpServerStatus | undefined): WebPluginAgentMcpConnectionStatus {
  if (!status) return "unavailable"
  return status.status
}
