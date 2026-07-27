import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron"

import {
  pluginConnectedMediaIpcChannels,
  type PluginConnectedMediaCloseInput,
  type PluginConnectedMediaFrameRef,
  type PluginConnectedMediaOpenInput,
} from "../plugin-connected-media-contracts"
import type { PluginConnectedMediaService } from "./plugin-connected-media-service"

export function registerPluginConnectedMediaIpc(options: {
  isTrustedSender(event: IpcMainInvokeEvent): boolean
  service: PluginConnectedMediaService
}) {
  const observedSenders = new Map<number, { listener: () => void; sender: WebContents }>()
  const trusted = (event: IpcMainInvokeEvent) => {
    if (!options.isTrustedSender(event)) throw new Error("Untrusted Plugin connected-media sender")
    if (!observedSenders.has(event.sender.id)) {
      const listener = () => {
        options.service.revokeSender(event.sender.id)
        observedSenders.delete(event.sender.id)
      }
      observedSenders.set(event.sender.id, { listener, sender: event.sender })
      event.sender.once("destroyed", listener)
    }
  }
  ipcMain.handle(pluginConnectedMediaIpcChannels.open, async (event, input: PluginConnectedMediaOpenInput) => {
    trusted(event)
    return options.service.open(input, event.sender.id)
  })
  ipcMain.handle(pluginConnectedMediaIpcChannels.close, async (event, input: PluginConnectedMediaCloseInput) => {
    trusted(event)
    return options.service.close(input, event.sender.id)
  })
  ipcMain.handle(pluginConnectedMediaIpcChannels.revokeFrame, async (event, input: PluginConnectedMediaFrameRef) => {
    trusted(event)
    return options.service.revokeFrame(input, event.sender.id)
  })
  return () => {
    ipcMain.removeHandler(pluginConnectedMediaIpcChannels.open)
    ipcMain.removeHandler(pluginConnectedMediaIpcChannels.close)
    ipcMain.removeHandler(pluginConnectedMediaIpcChannels.revokeFrame)
    for (const { listener, sender } of observedSenders.values()) sender.removeListener("destroyed", listener)
    observedSenders.clear()
  }
}
