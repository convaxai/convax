import { shell } from "electron"

import { openPackagedSmokeExternalAuthorization } from "./packaged-smoke-external-authorization"
import { DefaultPluginServiceExternalAuthorizationBroker } from "./plugin-service-external-authorization"

export function createElectronPluginServiceExternalAuthorizationBroker(options?: {
  packagedSmoke?: {
    socketPath: string
    userDataDirectory: string
  }
}) {
  return new DefaultPluginServiceExternalAuthorizationBroker(async (url) => {
    if (options?.packagedSmoke) {
      await openPackagedSmokeExternalAuthorization({
        authorizationUrl: url,
        ...options.packagedSmoke,
      })
      return
    }
    await shell.openExternal(url, { activate: true })
  })
}
