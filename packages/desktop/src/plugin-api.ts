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
  parseWebPluginManifest as parsePluginManifest,
  webPluginCapabilities as pluginCapabilities,
  webPluginManifestFileName as pluginManifestFileName,
  webPluginManifestSchema as pluginManifestSchemaV1,
  webPluginManifestSchemaV2 as pluginManifestSchemaV2,
  webPluginManifestSchemaV3 as pluginManifestSchemaV3,
  webPluginManifestSchemaV4 as pluginManifestSchemaV4,
  webPluginManifestSchemaV5 as pluginManifestSchemaV5,
} from "./plugin-contracts"
