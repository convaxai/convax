import { desktopProtocolChannel, desktopProtocolVersion } from "../desktop-protocol"
import { ipcMain, type IpcMainInvokeEvent } from "electron"

export function registerDesktopProtocolIpc(
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
) {
  ipcMain.handle(desktopProtocolChannel, (event) => {
    if (!isTrustedSender(event)) throw new Error("Desktop protocol request came from an untrusted renderer")
    return desktopProtocolVersion
  })
  return () => ipcMain.removeHandler(desktopProtocolChannel)
}
