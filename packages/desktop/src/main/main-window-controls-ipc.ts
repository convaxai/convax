import { ipcMain, type IpcMainInvokeEvent } from "electron"
import {
  isMainWindowControlsRequest,
  mainWindowControlsIpcChannel,
  type MainWindowControlAction,
} from "../main-window-controls-contracts"
import { setNativeMainWindowControlsVisible } from "./main-window-chrome"

interface MainWindowControlTarget {
  readonly webContents: Pick<IpcMainInvokeEvent["sender"], "id">
  close(): void
  isDestroyed(): boolean
  isFullScreen(): boolean
  minimize(): void
  setFullScreen(value: boolean): void
  setWindowButtonVisibility(visible: boolean): void
}

function performMainWindowControl(target: MainWindowControlTarget, action: MainWindowControlAction) {
  switch (action) {
    case "close":
      target.close()
      return
    case "minimize":
      target.minimize()
      return
    case "toggle-full-screen":
      target.setFullScreen(!target.isFullScreen())
  }
}

export function registerMainWindowControlsIpc(
  getMainWindow: () => MainWindowControlTarget | null,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
  platform: NodeJS.Platform,
) {
  ipcMain.handle(mainWindowControlsIpcChannel, (event, value: unknown) => {
    if (!isTrustedSender(event)) throw new Error("Main window control request came from an untrusted renderer")
    if (!isMainWindowControlsRequest(value)) throw new TypeError("Main window control request is invalid")

    const target = getMainWindow()
    if (!target || target.isDestroyed() || target.webContents.id !== event.sender.id) {
      throw new Error("Main window control request is not bound to the active main window")
    }
    if (value.action === "set-custom-controls-visible") {
      if (platform !== "darwin") throw new Error("Custom main window controls are supported only on macOS")
      setNativeMainWindowControlsVisible(platform, target, !value.visible)
      return
    }
    performMainWindowControl(target, value.action)
  })
  return () => ipcMain.removeHandler(mainWindowControlsIpcChannel)
}
