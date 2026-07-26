import { ipcMain, type IpcMainInvokeEvent } from "electron"

import {
  pluginMaterializationIpcChannels,
  type PluginMaterializationInput,
} from "../plugin-materialization-contracts"
import type { PluginMaterializationService } from "./plugin-materialization-service"

export function registerPluginMaterializationIpc(options: {
  isTrustedSender(event: IpcMainInvokeEvent): boolean
  service: Pick<PluginMaterializationService, "materialize">
}) {
  ipcMain.handle(
    pluginMaterializationIpcChannels.materialize,
    async (event, input: PluginMaterializationInput) => {
      if (!options.isTrustedSender(event)) throw new Error("Untrusted Plugin materialization sender")
      return options.service.materialize(input)
    },
  )
  return () => ipcMain.removeHandler(pluginMaterializationIpcChannels.materialize)
}
