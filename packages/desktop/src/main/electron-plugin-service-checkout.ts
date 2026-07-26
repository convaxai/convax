import { shell } from "electron"

import type { PluginServiceCheckoutNavigation } from "./plugin-service-checkout"

export function createElectronPluginServiceCheckoutNavigation(): PluginServiceCheckoutNavigation {
  return {
    async open(url) {
      await shell.openExternal(url, { activate: true })
    },
  }
}
