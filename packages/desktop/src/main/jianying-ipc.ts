import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron"

import type { JianyingCanvasExportIpcEnvelope, JianyingClient } from "../jianying-contracts"

export const jianyingIpcChannels = {
  cancelCanvasMediaExport: "jianying:canvas-media-export-cancel",
  exportCanvasMedia: "jianying:canvas-media-export",
  getDraftStatus: "jianying:draft-status",
} as const

export function registerJianyingIpc(
  client: JianyingClient,
  options: {
    isTrustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean
    resolveActiveCanvas: () => Promise<{
      canvasId: string
      revision: number
      scopeId: string
    } | null>
  },
) {
  const operations = new Map<string, AbortController>()
  const canceledBeforeStart = new Map<string, number>()
  const operationKey = (senderId: number, operationId: string) => `${senderId}:${operationId}`
  const pruneEarlyCancellations = (now = Date.now()) => {
    for (const [key, expiresAt] of canceledBeforeStart) {
      if (expiresAt <= now) canceledBeforeStart.delete(key)
    }
    while (canceledBeforeStart.size > 1_000) {
      const oldest = canceledBeforeStart.keys().next().value
      if (!oldest) break
      canceledBeforeStart.delete(oldest)
    }
  }
  const cancel = (event: IpcMainEvent, input: unknown) => {
    if (!options.isTrustedSender(event)) return
    let operationId: string
    try {
      operationId = requireOperationId(input)
    } catch {
      return
    }
    const key = operationKey(event.sender.id, operationId)
    const operation = operations.get(key)
    if (operation) {
      operation.abort(new DOMException("The Canvas export was canceled", "AbortError"))
      return
    }
    pruneEarlyCancellations()
    canceledBeforeStart.set(key, Date.now() + 60_000)
  }
  ipcMain.on(jianyingIpcChannels.cancelCanvasMediaExport, cancel)
  ipcMain.handle(jianyingIpcChannels.getDraftStatus, (event) => {
    if (!options.isTrustedSender(event)) throw new Error("JianYing IPC request came from an untrusted renderer")
    return client.getDraftStatus()
  })
  ipcMain.handle(jianyingIpcChannels.exportCanvasMedia, async (event, input: JianyingCanvasExportIpcEnvelope) => {
    if (!options.isTrustedSender(event)) throw new Error("JianYing IPC request came from an untrusted renderer")
    const operationId = requireOperationId(input)
    if (
      !input.request ||
      typeof input.request !== "object" ||
      !input.request.ref ||
      typeof input.request.ref !== "object" ||
      Object.keys(input).some((key) => key !== "operationId" && key !== "request")
    ) {
      throw new Error("JianYing export IPC envelope is invalid")
    }
    const key = operationKey(event.sender.id, operationId)
    if (operations.has(key)) throw new Error("JianYing export operation id is already active")
    const controller = new AbortController()
    const abortOnDestroy = () => controller.abort(new DOMException("The Canvas renderer closed", "AbortError"))
    operations.set(key, controller)
    pruneEarlyCancellations()
    if (canceledBeforeStart.delete(key)) {
      controller.abort(new DOMException("The Canvas export was canceled before it started", "AbortError"))
    }
    event.sender.once("destroyed", abortOnDestroy)
    try {
      if (controller.signal.aborted) throw controller.signal.reason
      const active = await options.resolveActiveCanvas()
      if (controller.signal.aborted) throw controller.signal.reason
      if (
        !active ||
        active.canvasId !== input.request.ref.canvasId ||
        active.scopeId !== input.request.ref.scopeId ||
        active.revision !== input.request.expectedRevision
      ) {
        throw new Error("JianYing export is no longer bound to the live active Canvas")
      }
      return await client.exportCanvasMedia(input.request, controller.signal)
    } finally {
      event.sender.removeListener("destroyed", abortOnDestroy)
      if (operations.get(key) === controller) operations.delete(key)
    }
  })
  return () => {
    ipcMain.removeListener(jianyingIpcChannels.cancelCanvasMediaExport, cancel)
    ipcMain.removeHandler(jianyingIpcChannels.exportCanvasMedia)
    ipcMain.removeHandler(jianyingIpcChannels.getDraftStatus)
    for (const controller of operations.values()) {
      controller.abort(new DOMException("JianYing IPC was disposed", "AbortError"))
    }
    operations.clear()
    canceledBeforeStart.clear()
  }
}

function requireOperationId(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("JianYing export operation id is required")
  }
  const operationId = (input as Record<string, unknown>).operationId
  if (typeof operationId !== "string" || !/^[a-zA-Z0-9._-]{1,128}$/.test(operationId)) {
    throw new Error("JianYing export operation id is invalid")
  }
  return operationId
}
