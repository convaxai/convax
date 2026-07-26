import { ipcMain, type IpcMainInvokeEvent } from "electron"

import {
  pluginServiceIpcChannels,
  type PluginServiceStatus,
  type PluginServiceSummary,
} from "../plugin-service-contracts"
import {
  PluginServiceIpcOperations,
  parsePluginServiceCheckoutTarget,
  parsePluginServiceTarget,
} from "./plugin-service-ipc-core"

export { parsePluginServiceCheckoutTarget, parsePluginServiceTarget } from "./plugin-service-ipc-core"

export interface PluginServiceExecutor {
  authorize(pluginId: string, signal?: AbortSignal): Promise<PluginServiceStatus>
  cancelAuthorization(pluginId: string, signal?: AbortSignal): Promise<PluginServiceStatus>
  checkout(pluginId: string, planKey: string, signal?: AbortSignal): Promise<PluginServiceStatus>
  getStatus(pluginId: string, signal?: AbortSignal): Promise<PluginServiceStatus>
  listServices(): Promise<readonly PluginServiceSummary[]>
  reauthorize(pluginId: string, signal?: AbortSignal): Promise<PluginServiceStatus>
  signOut(pluginId: string, signal?: AbortSignal): Promise<PluginServiceStatus>
}

/** Exposes fixed service operations only; no MCP method or payload crosses preload. */
export function registerPluginServiceIpc(
  executor: PluginServiceExecutor,
  options: { isTrustedSender(event: IpcMainInvokeEvent): boolean },
) {
  const operations = new PluginServiceIpcOperations()
  let disposed = false

  const register = <Result>(channel: string, operation: (pluginId: string, signal: AbortSignal) => Promise<Result>) => {
    ipcMain.handle(channel, async (event, input: unknown) => {
      if (!options.isTrustedSender(event)) throw new Error("Plugin service IPC request came from an untrusted renderer")
      if (disposed) throw new Error("Plugin service IPC is disposed")
      const { pluginId } = parsePluginServiceTarget(input)
      const operationKey = `${channel}\0${pluginId}`
      return operations.run(event.sender, operationKey, (signal) => operation(pluginId, signal))
    })
  }

  ipcMain.handle(pluginServiceIpcChannels.listServices, (event) => {
    if (!options.isTrustedSender(event)) throw new Error("Plugin service IPC request came from an untrusted renderer")
    if (disposed) throw new Error("Plugin service IPC is disposed")
    return executor.listServices()
  })
  register(pluginServiceIpcChannels.getStatus, (pluginId, signal) => executor.getStatus(pluginId, signal))
  register(pluginServiceIpcChannels.authorize, (pluginId, signal) => executor.authorize(pluginId, signal))
  register(pluginServiceIpcChannels.reauthorize, (pluginId, signal) => executor.reauthorize(pluginId, signal))
  register(pluginServiceIpcChannels.cancelAuthorization, (pluginId, signal) =>
    executor.cancelAuthorization(pluginId, signal),
  )
  register(pluginServiceIpcChannels.signOut, (pluginId, signal) => executor.signOut(pluginId, signal))
  ipcMain.handle(pluginServiceIpcChannels.checkout, async (event, input: unknown) => {
    if (!options.isTrustedSender(event)) throw new Error("Plugin service IPC request came from an untrusted renderer")
    if (disposed) throw new Error("Plugin service IPC is disposed")
    const { planKey, pluginId } = parsePluginServiceCheckoutTarget(input)
    return operations.run(event.sender, `${pluginServiceIpcChannels.checkout}\0${pluginId}`, (signal) =>
      executor.checkout(pluginId, planKey, signal),
    )
  })

  return () => {
    if (disposed) return
    disposed = true
    operations.dispose()
    for (const channel of Object.values(pluginServiceIpcChannels)) ipcMain.removeHandler(channel)
  }
}
