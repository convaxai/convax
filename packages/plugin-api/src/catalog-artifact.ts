import type { PluginApiDefinition, PluginApiVersion } from "./contracts"
import type { PluginApiWireContract } from "./method-schemas"

/** Artifact token for the unpublished initial Catalog candidate. */
export const PLUGIN_API_CATALOG_ARTIFACT_SCHEMA = "convax.plugin-api-catalog/3" as const

export interface PluginApiContractSnapshot extends PluginApiWireContract {
  readonly digest: `sha256:${string}`
}

export interface PluginApiDefinitionSnapshot extends PluginApiDefinition {
  readonly contract: PluginApiContractSnapshot
}

export interface PluginApiCatalogSnapshot {
  readonly schema: typeof PLUGIN_API_CATALOG_ARTIFACT_SCHEMA
  readonly version: PluginApiVersion
  readonly apis: readonly PluginApiDefinitionSnapshot[]
}
