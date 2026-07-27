import { shell } from "electron"

import { DefaultPluginServiceExternalAuthorizationBroker } from "./plugin-service-external-authorization"

export function createElectronPluginServiceExternalAuthorizationBroker() {
  return new DefaultPluginServiceExternalAuthorizationBroker(async (url) => {
    await shell.openExternal(url, { activate: true })
  })
}
