import {
  PLUGIN_API_CATALOG_MAJOR,
  PLUGIN_API_CATALOG_VERSION,
  evaluatePluginApiAvailability,
  type PluginApiAudience,
} from "@convax/plugin-api"
import type {
  PluginCapabilityRuntimeKind,
  PluginPrincipal,
  ResolvedPluginPrincipal,
} from "../plugin-capability-contracts"
import { pluginManifestSchemaV8, type InstalledPlugin } from "../plugin-api"
import type { PluginPrincipalResolver } from "./plugin-canvas-capability-service"

export interface InstalledPluginCapabilityIdentity {
  activeRevision?: number
  activeSetDigest?: string
  digest: string
  plugin: InstalledPlugin
  snapshotDigest?: string
}

function hasActiveSnapshotIdentity(
  identity: InstalledPluginCapabilityIdentity,
): identity is InstalledPluginCapabilityIdentity & {
  activeRevision: number
  activeSetDigest: string
  snapshotDigest: string
} {
  return (
    Number.isSafeInteger(identity.activeRevision) &&
    (identity.activeRevision ?? -1) >= 0 &&
    typeof identity.activeSetDigest === "string" &&
    /^[a-f0-9]{64}$/.test(identity.activeSetDigest) &&
    typeof identity.snapshotDigest === "string" &&
    /^[a-f0-9]{64}$/.test(identity.snapshotDigest)
  )
}

export interface InstalledPluginCapabilityIdentitySource {
  resolveCapabilityIdentity(pluginId: string): Promise<InstalledPluginCapabilityIdentity | null>
}

function isCapabilityRuntime(value: unknown): value is PluginCapabilityRuntimeKind {
  return value === "web" || value === "tool"
}

function runtimeAudience(runtime: PluginCapabilityRuntimeKind): PluginApiAudience {
  return runtime === "web" ? "web-plugin" : "companion"
}

function requiredHostApiFailure(
  plugin: InstalledPlugin,
  runtime: PluginCapabilityRuntimeKind,
): { id: string; reason: string } | undefined {
  if (plugin.schema !== pluginManifestSchemaV8) return undefined
  for (const id of plugin.hostApi.required) {
    const availability = evaluatePluginApiAvailability(id, plugin.hostApi, {
      audience: runtimeAudience(runtime),
      catalogMajor: PLUGIN_API_CATALOG_MAJOR,
      catalogVersion: PLUGIN_API_CATALOG_VERSION,
      disabled: false,
      grants: plugin.capabilities,
      hasContext: true,
      recovering: false,
      setupComplete: true,
    })
    if (!availability.available) return { id, reason: availability.reason }
  }
  return undefined
}

export class InstalledPluginPrincipalResolver implements PluginPrincipalResolver {
  constructor(private readonly plugins: InstalledPluginCapabilityIdentitySource) {}

  async issue(
    pluginId: string,
    runtime: PluginCapabilityRuntimeKind,
    expected?: InstalledPlugin,
  ): Promise<PluginPrincipal> {
    if (!isCapabilityRuntime(runtime)) {
      throw new Error(`Plugin capability runtime is unsupported: ${String(runtime)}`)
    }
    const identity = await this.plugins.resolveCapabilityIdentity(pluginId)
    if (!identity || identity.plugin.schema !== pluginManifestSchemaV8) {
      throw new Error(`Plugin does not expose the capability API: ${pluginId}`)
    }
    if (!hasActiveSnapshotIdentity(identity)) {
      throw new Error(`Plugin v8 identity is not bound to an active immutable snapshot: ${pluginId}`)
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
    const hostApiFailure = requiredHostApiFailure(identity.plugin, runtime)
    if (hostApiFailure) {
      throw new Error(
        `Plugin requires unavailable Host API ${hostApiFailure.id}: ${hostApiFailure.reason}`,
      )
    }
    return Object.freeze({
      activeRevision: identity.activeRevision,
      activeSetDigest: identity.activeSetDigest,
      manifestDigest: identity.digest,
      pluginId: identity.plugin.id,
      pluginVersion: identity.plugin.version,
      runtime,
      snapshotDigest: identity.snapshotDigest,
    })
  }

  async resolve(principal: PluginPrincipal): Promise<ResolvedPluginPrincipal | null> {
    const identity = await this.plugins.resolveCapabilityIdentity(principal.pluginId)
    if (
      !identity ||
      identity.plugin.schema !== pluginManifestSchemaV8 ||
      !hasActiveSnapshotIdentity(identity) ||
      identity.plugin.id !== principal.pluginId ||
      identity.plugin.version !== principal.pluginVersion ||
      identity.digest !== principal.manifestDigest ||
      identity.activeRevision !== principal.activeRevision ||
      identity.activeSetDigest !== principal.activeSetDigest ||
      identity.snapshotDigest !== principal.snapshotDigest ||
      !isCapabilityRuntime(principal.runtime) ||
      (principal.runtime === "web" && !identity.plugin.entry) ||
      (principal.runtime === "tool" && identity.plugin.runtime?.type !== "mcp-stdio")
    ) {
      return null
    }
    if (requiredHostApiFailure(identity.plugin, principal.runtime)) return null
    return {
      activeRevision: identity.activeRevision,
      activeSetDigest: identity.activeSetDigest,
      capabilities: [...identity.plugin.capabilities],
      hostApi: identity.plugin.hostApi,
      manifestDigest: identity.digest,
      pluginId: identity.plugin.id,
      pluginVersion: identity.plugin.version,
      snapshotDigest: identity.snapshotDigest,
    }
  }
}
