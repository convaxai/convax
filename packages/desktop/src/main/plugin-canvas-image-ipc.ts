import { ipcMain, type IpcMainInvokeEvent } from "electron"
import {
  pluginCanvasImageIpcChannel,
  type PluginCanvasImageCreateRequest,
  type PluginCanvasImageCreateResult,
} from "../plugin-canvas-image-contracts"

export function registerPluginCanvasImageIpc(
  service: { create(request: PluginCanvasImageCreateRequest): Promise<PluginCanvasImageCreateResult> },
  options: { isTrustedSender(event: IpcMainInvokeEvent): boolean },
) {
  ipcMain.handle(pluginCanvasImageIpcChannel, (event, request) => {
    if (!options.isTrustedSender(event)) throw new Error("Plugin Canvas image request came from an untrusted renderer")
    return service.create(request)
  })
  return () => ipcMain.removeHandler(pluginCanvasImageIpcChannel)
}
