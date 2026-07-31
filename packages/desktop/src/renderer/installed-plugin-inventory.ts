import type { ActiveInstalledWebPluginSummary, WebPluginClient } from "../plugin-contracts"

type InstalledPluginInventoryClient = Pick<WebPluginClient, "listPlugins" | "onDidChange">
type ChangeClient = Pick<WebPluginClient, "onDidChange">

export function combineInstalledPluginInventoryChanges(
  plugins: InstalledPluginInventoryClient,
  marketplace: ChangeClient,
  onMarketplaceRuntimeChange: () => void,
): InstalledPluginInventoryClient {
  return {
    listPlugins: () => plugins.listPlugins(),
    onDidChange(listener) {
      const disposePlugin = plugins.onDidChange(listener)
      const disposeMarketplace = marketplace.onDidChange(() => {
        onMarketplaceRuntimeChange()
        listener()
      })
      return () => {
        disposeMarketplace()
        disposePlugin()
      }
    },
  }
}

export function subscribeInstalledPluginInventory(
  client: InstalledPluginInventoryClient,
  onInstalled: (plugins: readonly ActiveInstalledWebPluginSummary[]) => void,
  onError: (error: unknown) => void,
) {
  let active = true
  let request = 0
  const refresh = async () => {
    const current = ++request
    try {
      const inventory = await client.listPlugins()
      if (active && current === request) onInstalled(inventory.installed)
    } catch (error) {
      if (active && current === request) {
        onInstalled([])
        onError(error)
      }
    }
  }
  // Subscribe first so a Plugin publication cannot land between the initial
  // inventory request and listener registration.
  const unsubscribe = client.onDidChange(() => void refresh())
  void refresh()
  return () => {
    active = false
    request += 1
    unsubscribe()
  }
}
