import type {
  CanvasDocumentClient,
  CanvasDocumentRef,
  CanvasDocumentSaveRequest,
} from "@convax/canvas/application"
import { ipcMain, type IpcMainInvokeEvent } from "electron"

export const canvasDocumentIpcChannels = {
  load: "canvas:document-load",
  save: "canvas:document-save",
} as const

interface CanvasDocumentIpcContract {
  "canvas:document-load": {
    input: CanvasDocumentRef
    result: Awaited<ReturnType<CanvasDocumentClient["load"]>>
  }
  "canvas:document-save": {
    input: CanvasDocumentSaveRequest
    result: Awaited<ReturnType<CanvasDocumentClient["save"]>>
  }
}

type CanvasDocumentInvokeChannel = keyof CanvasDocumentIpcContract

function registerHandler<Channel extends CanvasDocumentInvokeChannel>(
  channel: Channel,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
  handler: (
    input: CanvasDocumentIpcContract[Channel]["input"],
  ) => Promise<CanvasDocumentIpcContract[Channel]["result"]> | CanvasDocumentIpcContract[Channel]["result"],
) {
  ipcMain.handle(channel, (event, input: CanvasDocumentIpcContract[Channel]["input"]) => {
    if (!isTrustedSender(event)) throw new Error("Canvas IPC request came from an untrusted renderer")
    return handler(input)
  })
  return () => ipcMain.removeHandler(channel)
}

export function registerCanvasDocumentIpc(
  repository: CanvasDocumentClient,
  options: { isTrustedSender: (event: IpcMainInvokeEvent) => boolean },
) {
  const disposers = [
    registerHandler(canvasDocumentIpcChannels.load, options.isTrustedSender, (input) => repository.load(input)),
    registerHandler(canvasDocumentIpcChannels.save, options.isTrustedSender, (input) => repository.save(input)),
  ]
  return () => disposers.forEach((dispose) => dispose())
}
