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
  cleanup(): void
  reject(error: Error): void
  resolve(result: CanvasRendererRequestResult): void
  targetId: number
}

export interface CanvasRendererBridge {
  executeView(input: CanvasViewCommandRequest): Promise<CanvasViewCommandResult>
  getViewSnapshot(viewId: string, targetWebContentsId?: number): Promise<CanvasViewSnapshot | null>
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
    pending.delete(response.id)
    request.cleanup()
    if (response.ok) request.resolve(response.result)
    else request.reject(new Error(response.error))
  }
  ipcMain.on(canvasRendererChannels.response, handleResponse)

  const request = (input: CanvasRendererRequest, signal?: AbortSignal, targetWebContentsId?: number) =>
    new Promise<CanvasRendererRequestResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(signal))
        return
      }
      const target = BrowserWindow.getAllWindows().find(
        (window) =>
          !window.isDestroyed() &&
          !window.webContents.isDestroyed() &&
          options.isTrustedWebContentsId(window.webContents.id) &&
          (targetWebContentsId === undefined || window.webContents.id === targetWebContentsId),
      )
      if (!target) {
        reject(new Error("No Canvas renderer is available"))
        return
      }
      const id = randomUUID()
      const onAbort = () => {
        const request = pending.get(id)
        if (!request) return
        pending.delete(id)
        request.cleanup()
        reject(abortError(signal!))
      }
      const timeout = setTimeout(() => {
        pending.delete(id)
        signal?.removeEventListener("abort", onAbort)
        reject(new Error("Canvas renderer did not answer the request in time"))
      }, options.requestTimeoutMs ?? 10_000)
      pending.set(id, {
        cleanup() {
          clearTimeout(timeout)
          signal?.removeEventListener("abort", onAbort)
        },
        reject,
        resolve,
        targetId: target.webContents.id,
      })
      signal?.addEventListener("abort", onAbort, { once: true })
      const envelope: CanvasRendererRequestEnvelope = { id, request: input }
      target.webContents.send(canvasRendererChannels.request, envelope)
    })

  return {
    dispose() {
      ipcMain.removeListener(canvasRendererChannels.response, handleResponse)
      for (const value of pending.values()) {
        value.cleanup()
        value.reject(new Error("Canvas renderer bridge was disposed"))
      }
      pending.clear()
    },
    async executeView(input) {
      const result = await request({ type: "view.execute", input })
      if (result.type !== "view.execute") throw new Error("Canvas renderer returned the wrong response")
      return result.result
    },
    async getViewSnapshot(viewId, targetWebContentsId) {
      const result = await request({ type: "view.snapshot", viewId }, undefined, targetWebContentsId)
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

function abortError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason
  return new DOMException("Canvas document operation was canceled", "AbortError")
}
