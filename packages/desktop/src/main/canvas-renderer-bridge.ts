import { randomUUID } from "node:crypto"
import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron"
import type { CanvasDocumentRef } from "@convax/canvas/application"
import type { CanvasViewCommandRequest, CanvasViewCommandResult } from "@convax/canvas/view"
import type { CanvasViewSnapshot } from "@convax/canvas/view"
import {
  canvasRendererChannels,
  type CanvasRendererRequest,
  type CanvasRendererRequestEnvelope,
  type CanvasRendererRequestResult,
  type CanvasRendererResponseEnvelope,
} from "../canvas-renderer-contracts"

interface PendingRequest {
  reject(error: Error): void
  resolve(result: CanvasRendererRequestResult): void
  targetId: number
  timeout: ReturnType<typeof setTimeout>
}

export interface CanvasRendererBridge {
  executeView(input: CanvasViewCommandRequest): Promise<CanvasViewCommandResult>
  getViewSnapshot(viewId: string): Promise<CanvasViewSnapshot | null>
  reloadDocument(ref: CanvasDocumentRef): Promise<boolean>
}

export function createCanvasRendererBridge(options: {
  isTrustedWebContentsId(id: number): boolean
  isTrustedSender(event: IpcMainEvent): boolean
  requestTimeoutMs?: number
}): CanvasRendererBridge & { dispose(): void } {
  const pending = new Map<string, PendingRequest>()
  const handleResponse = (event: IpcMainEvent, response: CanvasRendererResponseEnvelope) => {
    if (!options.isTrustedSender(event) || !response || typeof response.id !== "string") return
    const request = pending.get(response.id)
    if (!request || request.targetId !== event.sender.id) return
    clearTimeout(request.timeout)
    pending.delete(response.id)
    if (response.ok) request.resolve(response.result)
    else request.reject(new Error(response.error))
  }
  ipcMain.on(canvasRendererChannels.response, handleResponse)

  const request = (input: CanvasRendererRequest) =>
    new Promise<CanvasRendererRequestResult>((resolve, reject) => {
      const target = BrowserWindow.getAllWindows().find(
        (window) => !window.isDestroyed() && options.isTrustedWebContentsId(window.webContents.id),
      )
      if (!target) {
        reject(new Error("No Canvas renderer is available"))
        return
      }
      const id = randomUUID()
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error("Canvas renderer did not answer the request in time"))
      }, options.requestTimeoutMs ?? 10_000)
      pending.set(id, { reject, resolve, targetId: target.webContents.id, timeout })
      const envelope: CanvasRendererRequestEnvelope = { id, request: input }
      target.webContents.send(canvasRendererChannels.request, envelope)
    })

  return {
    dispose() {
      ipcMain.removeListener(canvasRendererChannels.response, handleResponse)
      for (const value of pending.values()) {
        clearTimeout(value.timeout)
        value.reject(new Error("Canvas renderer bridge was disposed"))
      }
      pending.clear()
    },
    async executeView(input) {
      const result = await request({ type: "view.execute", input })
      if (result.type !== "view.execute") throw new Error("Canvas renderer returned the wrong response")
      return result.result
    },
    async getViewSnapshot(viewId) {
      const result = await request({ type: "view.snapshot", viewId })
      if (result.type !== "view.snapshot") throw new Error("Canvas renderer returned the wrong response")
      return result.snapshot
    },
    async reloadDocument(ref) {
      const result = await request({ type: "document.reload", ref })
      if (result.type !== "document.reload") throw new Error("Canvas renderer returned the wrong response")
      return result.reloaded
    },
  }
}
