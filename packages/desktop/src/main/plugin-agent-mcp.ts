import { type InstalledWebPluginSummary, requireWebPluginId, webPluginManifestSchemaV6 } from "../plugin-contracts"

export interface InstalledPluginAgentMcpServer {
  enabled: true
  headers?: Record<string, string>
  oauth?: false
  type: "remote"
  url: string
}

/**
 * Stable OpenCode MCP identity for one installed Plugin.
 *
 * Plugin ids are strict kebab-case, so replacing hyphens with underscores is
 * injective. The reserved prefix keeps Plugin tools separate from Convax's
 * dynamically scoped host-tool bridge; OpenCode owns the final tool prefix.
 */
export function pluginAgentMcpServerName(pluginId: string) {
  return `plugin_${requireWebPluginId(pluginId).replaceAll("-", "_")}`
}

export function installedPluginAgentMcpServer(plugin: InstalledWebPluginSummary): {
  name: string
  pluginId: string
  server: InstalledPluginAgentMcpServer
} | null {
  if (plugin.schema !== webPluginManifestSchemaV6 || !plugin.contributes.agent?.mcp) return null
  const contribution = plugin.contributes.agent.mcp
  return {
    name: pluginAgentMcpServerName(plugin.id),
    pluginId: plugin.id,
    server: {
      enabled: true,
      ...(contribution.headers === undefined ? {} : { headers: { ...contribution.headers } }),
      ...(contribution.oauth === "none" ? { oauth: false as const } : {}),
      type: "remote" as const,
      url: contribution.url,
    },
  }
}

/** Maps the revalidated installed Plugin set into OpenCode's native Config.mcp shape. */
export function installedPluginAgentMcpServers(plugins: readonly InstalledWebPluginSummary[]) {
  const servers: Record<string, InstalledPluginAgentMcpServer> = {}
  for (const plugin of plugins) {
    const resolved = installedPluginAgentMcpServer(plugin)
    if (!resolved) continue
    if (servers[resolved.name]) {
      throw new Error(`Installed Plugin Agent MCP server name collides: ${resolved.name}`)
    }
    servers[resolved.name] = resolved.server
  }
  return servers
}
