import { randomUUID } from "node:crypto"
import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron"
import type { CanvasDocumentRef } from "@convax/canvas/application"
import type { CanvasViewCommandRequest, CanvasViewCommandResult } from "@convax/canvas/view"
import type { CanvasViewSnapshot } from "@convax/canvas/view"
import {
  canvasRendererChannels,
  matchesCanvasDocumentMutationResult,
  type CanvasDocumentMutationFinishRequest,
  type CanvasDocumentMutationOutcome,
  type CanvasDocumentMutationPrepareRequest,
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
  getViewSnapshot(viewId: string): Promise<CanvasViewSnapshot | null>
  reloadDocument(ref: CanvasDocumentRef): Promise<boolean>
  runDocumentMutation<Result>(
    ref: CanvasDocumentRef,
    mutate: () => Result | PromiseLike<Result>,
    signal?: AbortSignal,
  ): Promise<Result>
  runDocumentRead<Result>(
    ref: CanvasDocumentRef,
    read: () => Result | PromiseLike<Result>,
    signal?: AbortSignal,
  ): Promise<Result>
}

export function createCanvasRendererBridge(options: {
  isTrustedWebContentsId(id: number): boolean
  isTrustedSender(event: IpcMainEvent): boolean
  requestTimeoutMs?: number
}): CanvasRendererBridge & { dispose(): void } {
  const pending = new Map<string, PendingRequest>()
  let documentLeaseTail = Promise.resolve()
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

  const request = (input: CanvasRendererRequest, signal?: AbortSignal) =>
    new Promise<CanvasRendererRequestResult>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(signal))
        return
      }
      const target = BrowserWindow.getAllWindows().find(
        (window) => !window.isDestroyed() && options.isTrustedWebContentsId(window.webContents.id),
      )
      if (!target) {
        reject(new Error("No Canvas renderer is available"))
        return
      }
      const id = randomUUID()
      const cancelPreparation = () => {
        if (input.type !== "document.mutation.prepare" || target.isDestroyed()) return
        try {
          const cancel: CanvasRendererRequestEnvelope = {
            id: randomUUID(),
            request: {
              leaseId: input.leaseId,
              ref: input.ref,
              type: "document.mutation.cancel",
            },
          }
          target.webContents.send(canvasRendererChannels.request, cancel)
        } catch {
          // Renderer disposal also disposes its editor; there is no live lease to recover.
        }
      }
      const onAbort = () => {
        const request = pending.get(id)
        if (!request) return
        pending.delete(id)
        request.cleanup()
        cancelPreparation()
        reject(abortError(signal!))
      }
      const timeout = setTimeout(() => {
        pending.delete(id)
        signal?.removeEventListener("abort", onAbort)
        cancelPreparation()
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

  const serializeDocumentLease = <Result>(operation: () => Promise<Result>, signal?: AbortSignal) => {
    let started = false
    const start = () => {
      throwIfAborted(signal)
      started = true
      return operation()
    }
    const result = documentLeaseTail.then(start, start)
    documentLeaseTail = result.then(
      () => undefined,
      () => undefined,
    )
    return waitForCancellationBeforeStart(result, signal, () => started)
  }

  const runWithDocumentLease = <Result>(
    ref: CanvasDocumentRef,
    operation: () => Result | PromiseLike<Result>,
    successOutcome: CanvasDocumentMutationOutcome,
    signal?: AbortSignal,
  ) =>
    serializeDocumentLease(async () => {
      throwIfAborted(signal)
      const leaseId = randomUUID()
      const leaseRef = { canvasId: ref.canvasId, scopeId: ref.scopeId }
      const prepare: CanvasDocumentMutationPrepareRequest = {
        leaseId,
        ref: leaseRef,
        type: "document.mutation.prepare",
      }
      const prepared = await request(prepare, signal)
      if (!matchesCanvasDocumentMutationResult(prepare, prepared) || prepared.type !== prepare.type) {
        throw new Error("Canvas renderer returned a mismatched document mutation lease")
      }

      let outcome: CanvasDocumentMutationOutcome = "aborted"
      let operationFailed = false
      let operationError: unknown
      let operationResult: { value: Result } | undefined
      let finishFailed = false
      let finishError: unknown
      try {
        throwIfAborted(signal)
        operationResult = { value: await operation() }
        outcome = successOutcome
      } catch (error) {
        operationFailed = true
        operationError = error
      } finally {
        try {
          const finish: CanvasDocumentMutationFinishRequest = {
            leaseId,
            outcome,
            ref: leaseRef,
            type: "document.mutation.finish",
          }
          const finished = await request(finish)
          if (!matchesCanvasDocumentMutationResult(finish, finished) || finished.type !== finish.type) {
            finishFailed = true
            finishError = new Error("Canvas renderer returned a mismatched document mutation lease")
          }
        } catch (error) {
          finishFailed = true
          finishError = error
        }
      }
      if (operationFailed) throw operationError
      if (finishFailed && successOutcome !== "committed") throw finishError
      if (finishFailed) {
        console.error("Canvas mutation committed, but the renderer could not reconcile it", finishError)
      }
      if (!operationResult) throw new Error("Canvas document operation did not produce a result")
      return operationResult.value
    }, signal)

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
    runDocumentMutation(ref, mutate, signal) {
      return runWithDocumentLease(ref, mutate, "committed", signal)
    },
    runDocumentRead(ref, read, signal) {
      return runWithDocumentLease(ref, read, "aborted", signal)
    },
  }
}

function abortError(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason
  return new DOMException("Canvas document operation was canceled", "AbortError")
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal)
}

function waitForCancellationBeforeStart<Result>(
  result: Promise<Result>,
  signal: AbortSignal | undefined,
  started: () => boolean,
): Promise<Result> {
  if (!signal) return result
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<Result>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      if (!started()) reject(abortError(signal))
    }
    const cleanup = () => signal.removeEventListener("abort", onAbort)
    signal.addEventListener("abort", onAbort, { once: true })
    void result.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}
