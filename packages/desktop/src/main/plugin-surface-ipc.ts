import { ipcMain, type IpcMainInvokeEvent } from "electron"

import { pluginSurfaceIpcChannels, type PluginSurfaceCreateInput } from "../plugin-surface-contracts"
import type { PluginSurfaceService } from "./plugin-surface-service"

export function registerPluginSurfaceIpc(options: {
  isTrustedSender(event: IpcMainInvokeEvent): boolean
  service: Pick<PluginSurfaceService, "create">
}) {
  ipcMain.handle(pluginSurfaceIpcChannels.create, async (event, input: PluginSurfaceCreateInput) => {
    if (!options.isTrustedSender(event)) throw new Error("Untrusted Plugin surface sender")
    return options.service.create(input)
  })
  return () => ipcMain.removeHandler(pluginSurfaceIpcChannels.create)
}
