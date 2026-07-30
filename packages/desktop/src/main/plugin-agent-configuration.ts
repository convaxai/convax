import { pathToFileURL } from "node:url"

import type { AgentPluginConfiguration } from "@convax/agent-runtime/node"

import { installedPluginAgentMcpServers } from "./plugin-agent-mcp"
import {
  pluginExecutionAuthorizationIdentity,
  type ActivePluginRuntimeSetHandle,
} from "./plugin-installation-runtime"
import { isMarketplacePluginRuntimeAdmitted } from "./marketplace-plugin-runtime-gate"
import type { MarketplaceState } from "./marketplace-state"

export interface PluginAgentConfigurationSource {
  acquireActivePluginSet(): Promise<ActivePluginRuntimeSetHandle>
}

export interface PluginAgentConfigurationResolverOptions {
  readonly plugins: PluginAgentConfigurationSource
  readonly readMarketplaceState: () => Promise<MarketplaceState | undefined>
}

/**
 * Resolves every Plugin-owned Agent contribution from one immutable ActiveSet.
 *
 * The returned paths remain valid because this resolver retains that exact set
 * until a later configuration generation has been built successfully. The Agent
 * runtime receives only generic URLs, directories, and MCP configs; Plugin
 * identity and lease ownership never cross the package boundary.
 */
export class PluginAgentConfigurationResolver {
  readonly #plugins: PluginAgentConfigurationSource
  readonly #readMarketplaceState: () => Promise<MarketplaceState | undefined>
  #pending: Promise<void> = Promise.resolve()
  #retainedSet?: ActivePluginRuntimeSetHandle

  constructor(options: PluginAgentConfigurationResolverOptions) {
    this.#plugins = options.plugins
    this.#readMarketplaceState = options.readMarketplaceState
  }

  resolve(): Promise<AgentPluginConfiguration> {
    const result = this.#pending.then(
      () => this.#resolveOnce(),
      () => this.#resolveOnce(),
    )
    this.#pending = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async #resolveOnce(): Promise<AgentPluginConfiguration> {
    const activeSet = await this.#plugins.acquireActivePluginSet()
    try {
      if (activeSet.plugins.length > 0 && activeSet.activeSetDigest === null) {
        throw new Error("Plugin Agent configuration cannot resolve an unbound ActiveSet")
      }
      for (const handle of activeSet.plugins) {
        if (
          handle.identity.activeRevision !== activeSet.revision ||
          handle.identity.activeSetDigest !== activeSet.activeSetDigest ||
          handle.identity.pluginId !== handle.plugin.id ||
          handle.identity.version !== handle.plugin.version
        ) {
          throw new Error("Plugin Agent configuration contains a mixed ActiveSet generation")
        }
      }
      const marketplaceState = await this.#readMarketplaceState()
      const hookModules: Array<{ fileUrl: string }> = []
      const skillPaths: string[] = []
      for (const handle of activeSet.plugins) {
        for (const skill of handle.plugin.contributes.skills ?? []) {
          skillPaths.push(await handle.resolveOwnedSkillDirectory(skill.name))
        }
        if (!handle.plugin.hooks) continue
        const enabled = isMarketplacePluginRuntimeAdmitted({
          authorizationContractDigest: pluginExecutionAuthorizationIdentity(handle.descriptor),
          pluginId: handle.plugin.id,
          pluginVersion: handle.plugin.version,
          state: marketplaceState,
        })
        if (!enabled) continue
        const file = await handle.resolveHook()
        if (file) hookModules.push({ fileUrl: pathToFileURL(file).href })
      }
      const configuration = {
        hookModules,
        mcpServers: installedPluginAgentMcpServers(activeSet.plugins.map(({ plugin }) => plugin)),
        skillPaths,
      }
      const previous = this.#retainedSet
      this.#retainedSet = activeSet
      previous?.release()
      return configuration
    } catch (error) {
      activeSet.release()
      throw error
    }
  }

  dispose() {
    this.#retainedSet?.release()
    this.#retainedSet = undefined
  }
}
