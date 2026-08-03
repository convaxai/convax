import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron"

import {
  publishPluginServiceChangeToTargets,
  registerPluginServiceIpcCore,
  type PluginServiceExecutor,
} from "./plugin-service-ipc-core"

export { parsePluginServiceCheckoutTarget, parsePluginServiceTarget } from "./plugin-service-ipc-core"
export type { PluginServiceExecutor } from "./plugin-service-ipc-core"

export function publishPluginServiceChange() {
  publishPluginServiceChangeToTargets(BrowserWindow.getAllWindows())
}

/** Exposes fixed service operations only; no MCP method or payload crosses preload. */
export function registerPluginServiceIpc(
  executor: PluginServiceExecutor,
  options: { isTrustedSender(event: IpcMainInvokeEvent): boolean },
) {
  return registerPluginServiceIpcCore(executor, options, {
    handle: (channel, handler) => ipcMain.handle(channel, handler),
    publishChange: publishPluginServiceChange,
    removeHandler: (channel) => ipcMain.removeHandler(channel),
  })
}
