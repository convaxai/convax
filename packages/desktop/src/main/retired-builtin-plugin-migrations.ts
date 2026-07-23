import type { WebPluginManager } from "./plugin-manager"

/**
 * Compatibility-only identities that were shipped as trusted static built-ins
 * before their source and release lifecycle moved to the official Registry.
 */
export const retiredBuiltinPluginIds = ["panorama-viewer"] as const

export async function migrateRetiredBuiltinPlugins(
  manager: Pick<WebPluginManager, "retireInstalledBuiltinProvenance">,
  onError: (pluginId: string, error: unknown) => void,
) {
  for (const pluginId of retiredBuiltinPluginIds) {
    await manager.retireInstalledBuiltinProvenance(pluginId).catch((error) => onError(pluginId, error))
  }
}
