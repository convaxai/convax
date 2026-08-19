/**
 * Canonical Plugin names for host/runtime code.
 *
 * The original public contracts used a `WebPlugin*` prefix before Convax gained
 * headless Tool Plugins, declarative contributions and Plugin-owned Skills.
 * Keep those source-compatible names in `plugin-contracts.ts`, while new code
 * depends on these transport-neutral aliases. A Web surface is one adapter for
 * an installed Plugin, not the Plugin's identity.
 */
export type {
  InstalledWebPluginSummary as InstalledPlugin,
  WebPluginCapability as PluginCapability,
  WebPluginInventory as PluginInventory,
  WebPluginManifest as PluginManifest,
  WebPluginManifestSchema as PluginManifestSchema,
} from "./plugin-contracts"

export {
  isSupportedWebPluginManifestSchema as isSupportedPluginManifestSchema,
  parseWebPluginManifest as parsePluginManifest,
  webPluginCapabilities as pluginCapabilities,
  webPluginManifestFileName as pluginManifestFileName,
  webPluginManifestSchemaV8 as pluginManifestSchemaV8,
  webPluginManifestSchemaV9 as pluginManifestSchemaV9,
} from "./plugin-contracts"
