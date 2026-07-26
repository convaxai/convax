import type {
  PluginCapabilityRuntimeKind,
  PluginPrincipal,
  ResolvedPluginPrincipal,
} from "../plugin-capability-contracts"
import {
  pluginManifestSchemaV5,
  pluginManifestSchemaV6,
  pluginManifestSchemaV7,
  type InstalledPlugin,
} from "../plugin-api"
import { pluginCapabilityProtocolV2 } from "../plugin-host-protocol"
import type { PluginPrincipalResolver } from "./plugin-canvas-capability-service"

export interface InstalledPluginCapabilityIdentity {
  digest: string
  plugin: InstalledPlugin
}

export interface InstalledPluginCapabilityIdentitySource {
  resolveCapabilityIdentity(pluginId: string): Promise<InstalledPluginCapabilityIdentity | null>
}

export class InstalledPluginPrincipalResolver implements PluginPrincipalResolver {
  constructor(private readonly plugins: InstalledPluginCapabilityIdentitySource) {}

  async issue(
    pluginId: string,
    runtime: PluginCapabilityRuntimeKind,
    expected?: InstalledPlugin,
  ): Promise<PluginPrincipal> {
    const identity = await this.plugins.resolveCapabilityIdentity(pluginId)
    if (
      !identity ||
      (identity.plugin.schema !== pluginManifestSchemaV5 &&
        identity.plugin.schema !== pluginManifestSchemaV6 &&
        identity.plugin.schema !== pluginManifestSchemaV7)
    ) {
      throw new Error(`Plugin does not expose the capability API: ${pluginId}`)
    }
    if (expected && JSON.stringify(identity.plugin) !== JSON.stringify(expected)) {
      throw new Error(`Plugin changed before its capability principal was issued: ${pluginId}`)
    }
    if (runtime === "web" && !identity.plugin.entry) {
      throw new Error(`Headless Plugin cannot create a Web capability connection: ${pluginId}`)
    }
    if (runtime === "tool" && identity.plugin.runtime?.type !== "mcp-stdio") {
      throw new Error(`Static Plugin cannot create a Tool capability connection: ${pluginId}`)
    }
    if (runtime === "builtin" && !identity.plugin.trustedBuiltin) {
      throw new Error(`Imported Plugin cannot create a built-in capability connection: ${pluginId}`)
    }
    return Object.freeze({
      ...(identity.plugin.schema === pluginManifestSchemaV7
        ? { capabilityProtocol: pluginCapabilityProtocolV2 }
        : {}),
      manifestDigest: identity.digest,
      pluginId: identity.plugin.id,
      pluginVersion: identity.plugin.version,
      runtime,
    })
  }

  async resolve(principal: PluginPrincipal): Promise<ResolvedPluginPrincipal | null> {
    const identity = await this.plugins.resolveCapabilityIdentity(principal.pluginId)
    if (
      !identity ||
      (identity.plugin.schema !== pluginManifestSchemaV5 &&
        identity.plugin.schema !== pluginManifestSchemaV6 &&
        identity.plugin.schema !== pluginManifestSchemaV7) ||
      identity.plugin.id !== principal.pluginId ||
      identity.plugin.version !== principal.pluginVersion ||
      identity.digest !== principal.manifestDigest ||
      (principal.runtime === "web" && !identity.plugin.entry) ||
      (principal.runtime === "tool" && identity.plugin.runtime?.type !== "mcp-stdio") ||
      (principal.runtime === "builtin" && !identity.plugin.trustedBuiltin)
    ) {
      return null
    }
    return {
      capabilities: [...identity.plugin.capabilities],
      ...(identity.plugin.schema === pluginManifestSchemaV7
        ? { capabilityProtocol: pluginCapabilityProtocolV2 }
        : {}),
      manifestDigest: identity.digest,
      pluginId: identity.plugin.id,
      pluginVersion: identity.plugin.version,
    }
  }
}
