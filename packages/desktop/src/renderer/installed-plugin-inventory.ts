import type { InstalledWebPluginSummary, WebPluginClient } from "../plugin-contracts"

type InstalledPluginInventoryClient = Pick<WebPluginClient, "listPlugins" | "onDidChange">

export function subscribeInstalledPluginInventory(
  client: InstalledPluginInventoryClient,
  onInstalled: (plugins: InstalledWebPluginSummary[]) => void,
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
      if (active && current === request) onError(error)
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
