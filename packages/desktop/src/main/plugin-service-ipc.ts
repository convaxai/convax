import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron"

import { pluginServiceIpcChannels } from "../plugin-service-contracts"
import {
  registerPluginServiceIpcCore,
  type PluginServiceExecutor,
} from "./plugin-service-ipc-core"

export { parsePluginServiceTarget } from "./plugin-service-ipc-core"
export type { PluginServiceExecutor } from "./plugin-service-ipc-core"

/** Exposes fixed service operations only; no MCP method or payload crosses preload. */
export function registerPluginServiceIpc(
  executor: PluginServiceExecutor,
  options: { isTrustedSender(event: IpcMainInvokeEvent): boolean },
) {
  const publishChange = () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      window.webContents.send(pluginServiceIpcChannels.changed)
    }
  }

  return registerPluginServiceIpcCore(executor, options, {
    handle: (channel, handler) => ipcMain.handle(channel, handler),
    publishChange,
    removeHandler: (channel) => ipcMain.removeHandler(channel),
  })
}
