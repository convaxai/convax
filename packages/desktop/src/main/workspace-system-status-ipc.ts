import { app, ipcMain, type IpcMainInvokeEvent } from "electron"
import {
  aggregateWorkspaceProcessMetrics,
  workspaceSystemStatusIpcChannel,
} from "../workspace-system-status-contracts"

export function registerWorkspaceSystemStatusIpc(
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
) {
  ipcMain.handle(workspaceSystemStatusIpcChannel, (event) => {
    if (!isTrustedSender(event)) throw new Error("Workspace system status request came from an untrusted renderer")
    return aggregateWorkspaceProcessMetrics(app.getAppMetrics())
  })
  return () => ipcMain.removeHandler(workspaceSystemStatusIpcChannel)
}
