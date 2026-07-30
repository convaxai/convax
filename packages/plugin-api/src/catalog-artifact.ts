import type { PluginApiDefinition, PluginApiVersion } from "./contracts"
import { pluginApiWireSchemaDialect, type PluginApiWireContract } from "./method-schemas"

/** Canonical schema token for generated Catalog JSON and compatibility history. */
export const PLUGIN_API_CATALOG_ARTIFACT_SCHEMA = "convax.plugin-api-catalog/2" as const

export interface PluginApiContractSnapshot extends PluginApiWireContract {
  readonly dialect: typeof pluginApiWireSchemaDialect
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
