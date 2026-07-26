import type { ProjectCanvasClient } from "@convax/project/canvas"
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron"

type ClientInput<Method extends keyof Omit<ProjectCanvasClient, "onDidChange">> = Parameters<ProjectCanvasClient[Method]>[0]
type ClientResult<Method extends keyof Omit<ProjectCanvasClient, "onDidChange">> = Awaited<ReturnType<ProjectCanvasClient[Method]>>

export const projectCanvasIpcChannels = {
  changed: "project:canvases-changed",
  createCanvas: "project:canvas-create",
  deleteCanvas: "project:canvas-delete",
  getCanvasCatalog: "project:canvas-catalog",
  renameCanvas: "project:canvas-rename",
} as const

interface ProjectCanvasIpcContract {
  "project:canvas-create": { input: ClientInput<"createCanvas">; result: ClientResult<"createCanvas"> }
  "project:canvas-delete": { input: ClientInput<"deleteCanvas">; result: ClientResult<"deleteCanvas"> }
  "project:canvas-catalog": { input: ClientInput<"getCanvasCatalog">; result: ClientResult<"getCanvasCatalog"> }
  "project:canvas-rename": { input: ClientInput<"renameCanvas">; result: ClientResult<"renameCanvas"> }
}

type ProjectCanvasInvokeChannel = keyof ProjectCanvasIpcContract

export interface DesktopProjectCanvasManager {
  createCanvas(input: ClientInput<"createCanvas">): Promise<ClientResult<"createCanvas">>
  deleteCanvas(input: ClientInput<"deleteCanvas">): Promise<ClientResult<"deleteCanvas">>
  getCanvasCatalog(input: ClientInput<"getCanvasCatalog">): Promise<ClientResult<"getCanvasCatalog">>
  renameCanvas(input: ClientInput<"renameCanvas">): Promise<ClientResult<"renameCanvas">>
}

function registerHandler<Channel extends ProjectCanvasInvokeChannel>(
  channel: Channel,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
  handler: (input: ProjectCanvasIpcContract[Channel]["input"]) => Promise<ProjectCanvasIpcContract[Channel]["result"]>,
) {
  ipcMain.handle(channel, (event, input: ProjectCanvasIpcContract[Channel]["input"]) => {
    if (!isTrustedSender(event)) throw new Error("Project Canvas IPC request came from an untrusted renderer")
    return handler(input)
  })
  return () => ipcMain.removeHandler(channel)
}

export function registerProjectCanvasIpc(
  manager: DesktopProjectCanvasManager,
  options: {
    isTrustedSender: (event: IpcMainInvokeEvent) => boolean
    onDeleted?(input: ClientInput<"deleteCanvas">, result: ClientResult<"deleteCanvas">): Promise<void> | void
  },
) {
  const publishChange = (projectId: string) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      window.webContents.send(projectCanvasIpcChannels.changed, { projectId })
    }
  }
  const changed = <Input extends { projectId: string }, Result>(operation: (input: Input) => Promise<Result>) => async (input: Input) => {
    const result = await operation(input)
    publishChange(input.projectId)
    return result
  }
  const deleteCanvas = async (input: ClientInput<"deleteCanvas">) => {
    const result = await manager.deleteCanvas(input)
    if (result.deleted) await options.onDeleted?.(input, result)
    publishChange(input.projectId)
    return result
  }
  const disposers = [
    registerHandler(projectCanvasIpcChannels.createCanvas, options.isTrustedSender, changed((input) => manager.createCanvas(input))),
    registerHandler(projectCanvasIpcChannels.deleteCanvas, options.isTrustedSender, deleteCanvas),
    registerHandler(projectCanvasIpcChannels.getCanvasCatalog, options.isTrustedSender, (input) => manager.getCanvasCatalog(input)),
    registerHandler(projectCanvasIpcChannels.renameCanvas, options.isTrustedSender, changed((input) => manager.renameCanvas(input))),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
