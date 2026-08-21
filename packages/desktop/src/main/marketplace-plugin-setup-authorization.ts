import { canonicalJson, sha256Hex } from "@convax/marketplace"

import type { InstalledWebPluginSummary } from "../plugin-contracts"

export type MarketplacePluginSetupMode = "automatic-product-lock" | "explicit"

export interface MarketplacePluginSetupAuthorizationDependencies {
  authorizeHook(plugin: InstalledWebPluginSummary): Promise<string | null>
  authorizeTool(plugin: InstalledWebPluginSummary, options: { requireManaged?: true }): Promise<string | null>
}

export function assertMarketplacePluginSetupPolicy(
  plugin: InstalledWebPluginSummary,
  mode: MarketplacePluginSetupMode,
) {
  if (mode !== "automatic-product-lock") return
  if (plugin.hooks !== undefined) {
    throw new Error("Automatic product-lock setup cannot authorize a Plugin Hook")
  }
  const interPlugin = plugin.contributes.capabilities
  if (
    plugin.capabilities.length !== 0 ||
    (interPlugin?.exports.length ?? 0) > 0 ||
    (interPlugin?.imports.optional.length ?? 0) > 0 ||
    (interPlugin?.imports.required.length ?? 0) > 0
  ) {
    throw new Error("Automatic product-lock setup cannot authorize extra Plugin capabilities")
  }
}

/**
 * Product-lock setup is a narrowly reviewed product capability, not a general
 * silent Plugin-consent path. It admits only an exact managed Tool companion.
 * A Service projection may coexist on that companion, but no Service action is
 * performed here; Hook, PATH, credentials and additional Plugin authority remain
 * explicit.
 */
export async function authorizeMarketplacePluginSetup(
  plugin: InstalledWebPluginSummary,
  mode: MarketplacePluginSetupMode,
  dependencies: MarketplacePluginSetupAuthorizationDependencies,
) {
  assertMarketplacePluginSetupPolicy(plugin, mode)
  if (mode === "automatic-product-lock") {
    const tool = await dependencies.authorizeTool(plugin, { requireManaged: true })
    if (!tool) throw new Error("Automatic product-lock setup requires an executable Tool Plugin")
    return sha256Hex(canonicalJson({ hook: null, tool }))
  }

  const [tool, hook] = await Promise.all([dependencies.authorizeTool(plugin, {}), dependencies.authorizeHook(plugin)])
  return tool || hook ? sha256Hex(canonicalJson({ hook, tool })) : null
}
