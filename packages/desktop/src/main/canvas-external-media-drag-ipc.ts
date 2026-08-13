import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron"

import {
  canvasExternalMediaDragIpcChannels,
  type CanvasExternalMediaDragPrepareRequest,
  type CanvasExternalMediaDragRequest,
} from "../canvas-external-drag-contracts"
import type { CanvasRendererBridge } from "./canvas-renderer-bridge"
import type { CanvasExternalMediaDragTicketPort } from "./canvas-external-media-drag-service"

interface PendingPreparation {
  controller: AbortController
  ticket?: string
}

const maximumPendingPreparesPerSender = 8

export interface ActiveCanvasExternalDragScope {
  canvasId: string
  scopeId: string
  selectedEdgeIds: readonly string[]
  selectedNodeIds: readonly string[]
}

export interface CanvasExternalMediaDragStartErrorContext {
  senderId: number
}

export async function showCanvasExternalMediaDragStartFailure(
  renderer: Pick<CanvasRendererBridge, "executeView" | "getViewSnapshot">,
): Promise<boolean> {
  const snapshot = await renderer.getViewSnapshot("desktop-main")
  if (!snapshot) return false
  await renderer.executeView({
    command: {
      description: "The system could not start the file drag. Release Command, then try again.",
      kind: "error",
      title: "Could not drag media out",
      type: "notification.show",
    },
    expectedDocumentId: snapshot.documentId,
    expectedScopeId: snapshot.scopeId,
    viewId: snapshot.viewId,
  })
  return true
}

export function registerCanvasExternalMediaDragIpc(
  service: CanvasExternalMediaDragTicketPort,
  options: {
    isTrustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean
    onError?: (error: unknown) => void
    onStartError?: (error: unknown, context: CanvasExternalMediaDragStartErrorContext) => void
    resolveActiveCanvas: (senderId: number) => Promise<ActiveCanvasExternalDragScope | null>
  },
) {
  const pendingBySender = new Map<number, Map<string, PendingPreparation>>()

  const prepare = async (event: IpcMainInvokeEvent, input: unknown) => {
    if (!options.isTrustedSender(event)) {
      throw new Error("Canvas external drag IPC request came from an untrusted renderer")
    }
    const request = requirePrepareRequest(input)
    const pending = reservePreparation(pendingBySender, event.sender.id, request.prepareId)
    const abortOnDestroy = () => pending.controller.abort(new DOMException("The Canvas renderer closed", "AbortError"))
    event.sender.once("destroyed", abortOnDestroy)
    try {
      const active = await options.resolveActiveCanvas(event.sender.id)
      throwIfAborted(pending.controller.signal)
      if (!matchesActiveSelection(active, request)) {
        throw new Error("Canvas external drag is no longer bound to the live active selection")
      }
      const ticket = await service.prepare(event.sender.id, selectionRequest(request), pending.controller.signal)
      pending.ticket = ticket.ticket
      if (pending.controller.signal.aborted) {
        await service.cancel(event.sender.id, ticket.ticket)
        throw pending.controller.signal.reason
      }
      return ticket
    } finally {
      event.sender.removeListener("destroyed", abortOnDestroy)
      releasePreparation(pendingBySender, event.sender.id, request.prepareId, pending)
    }
  }

  const cancelPrepare = (event: IpcMainEvent, input: unknown) => {
    if (!options.isTrustedSender(event)) return
    let prepareId: string
    try {
      prepareId = requirePrepareCancellationRequest(input)
    } catch {
      return
    }
    const pending = pendingBySender.get(event.sender.id)?.get(prepareId)
    if (!pending) return
    pending.controller.abort(new DOMException("Canvas external drag preparation was canceled", "AbortError"))
    if (pending.ticket) {
      void service.cancel(event.sender.id, pending.ticket).catch((error) => reportError(options.onError, error))
    }
  }

  const cancel = (event: IpcMainEvent, input: unknown) => {
    if (!options.isTrustedSender(event)) return
    let ticket: string
    try {
      ticket = requireTicketRequest(input)
    } catch {
      return
    }
    void service.cancel(event.sender.id, ticket).catch((error) => reportError(options.onError, error))
  }

  const start = (event: IpcMainEvent, input: unknown) => {
    if (!options.isTrustedSender(event)) return
    let lease: ReturnType<CanvasExternalMediaDragTicketPort["consume"]> | undefined
    try {
      const ticket = requireTicketRequest(input)
      lease = service.consume(event.sender.id, ticket)
      if (event.sender.isDestroyed()) throw new Error("Canvas renderer closed before native drag started")
      event.sender.startDrag({ file: lease.file, files: lease.files, icon: lease.icon })
    } catch (error) {
      reportError(options.onError, error)
      try {
        options.onStartError?.(error, { senderId: event.sender.id })
      } catch (notificationError) {
        reportError(options.onError, notificationError)
      }
    } finally {
      lease?.release()
    }
  }

  ipcMain.handle(canvasExternalMediaDragIpcChannels.prepare, prepare)
  ipcMain.on(canvasExternalMediaDragIpcChannels.cancel, cancel)
  ipcMain.on(canvasExternalMediaDragIpcChannels.cancelPrepare, cancelPrepare)
  ipcMain.on(canvasExternalMediaDragIpcChannels.start, start)

  return () => {
    for (const preparations of pendingBySender.values()) {
      for (const pending of preparations.values()) {
        pending.controller.abort(new DOMException("Canvas external drag IPC was disposed", "AbortError"))
      }
    }
    pendingBySender.clear()
    ipcMain.removeHandler(canvasExternalMediaDragIpcChannels.prepare)
    ipcMain.removeListener(canvasExternalMediaDragIpcChannels.cancel, cancel)
    ipcMain.removeListener(canvasExternalMediaDragIpcChannels.cancelPrepare, cancelPrepare)
    ipcMain.removeListener(canvasExternalMediaDragIpcChannels.start, start)
  }
}

function reservePreparation(
  pendingBySender: Map<number, Map<string, PendingPreparation>>,
  senderId: number,
  prepareId: string,
) {
  let owned = pendingBySender.get(senderId)
  if (!owned) {
    owned = new Map()
    pendingBySender.set(senderId, owned)
  }
  if (owned.has(prepareId)) {
    throw new Error("Canvas external drag prepareId is already active for this renderer")
  }
  if (owned.size >= maximumPendingPreparesPerSender) {
    throw new Error("Too many Canvas external drags are being prepared by this renderer")
  }
  const pending: PendingPreparation = { controller: new AbortController() }
  owned.set(prepareId, pending)
  return pending
}

function releasePreparation(
  pendingBySender: Map<number, Map<string, PendingPreparation>>,
  senderId: number,
  prepareId: string,
  expected: PendingPreparation,
) {
  const owned = pendingBySender.get(senderId)
  if (owned?.get(prepareId) !== expected) return
  owned.delete(prepareId)
  if (owned.size === 0) pendingBySender.delete(senderId)
}

function matchesActiveSelection(
  active: ActiveCanvasExternalDragScope | null,
  request: CanvasExternalMediaDragPrepareRequest,
) {
  return Boolean(
    active &&
      active.canvasId === request.ref.canvasId &&
      active.scopeId === request.ref.scopeId &&
      active.selectedEdgeIds.length === 0 &&
      equalIds(active.selectedNodeIds, request.nodeIds),
  )
}

function equalIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && new Set(left).size === left.length && left.every((id) => right.includes(id))
}

function requirePrepareRequest(value: unknown): CanvasExternalMediaDragPrepareRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Canvas external drag request is required")
  }
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => !["nodeIds", "prepareId", "ref"].includes(key))) {
    throw new Error("Canvas external drag request contains unsupported fields")
  }
  if (!input.ref || typeof input.ref !== "object" || Array.isArray(input.ref)) {
    throw new Error("Canvas external drag requires a Project-scoped Canvas reference")
  }
  const ref = input.ref as Record<string, unknown>
  if (
    Object.keys(ref).some((key) => key !== "canvasId" && key !== "scopeId") ||
    typeof ref.canvasId !== "string" ||
    !ref.canvasId ||
    typeof ref.scopeId !== "string" ||
    !ref.scopeId
  ) {
    throw new Error("Canvas external drag requires a Project-scoped Canvas reference")
  }
  if (!isPrepareId(input.prepareId)) {
    throw new Error("Canvas external drag prepareId must be an opaque URL-safe token")
  }
  if (
    !Array.isArray(input.nodeIds) ||
    input.nodeIds.length === 0 ||
    input.nodeIds.length > 100 ||
    input.nodeIds.some((nodeId) => typeof nodeId !== "string" || !nodeId) ||
    new Set(input.nodeIds).size !== input.nodeIds.length
  ) {
    throw new Error("Canvas external drag nodeIds must contain 1 to 100 unique Canvas node ids")
  }
  return {
    nodeIds: [...input.nodeIds],
    prepareId: input.prepareId,
    ref: { canvasId: ref.canvasId, scopeId: ref.scopeId },
  }
}

function selectionRequest(request: CanvasExternalMediaDragPrepareRequest): CanvasExternalMediaDragRequest {
  return {
    nodeIds: request.nodeIds,
    ref: request.ref,
  }
}

function requirePrepareCancellationRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Canvas external drag prepare cancellation is required")
  }
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => key !== "prepareId") || !isPrepareId(input.prepareId)) {
    throw new Error("Canvas external drag prepare cancellation is invalid")
  }
  return input.prepareId
}

function requireTicketRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Canvas external media drag ticket is required")
  }
  const input = value as Record<string, unknown>
  if (Object.keys(input).some((key) => key !== "ticket") || !isTicket(input.ticket)) {
    throw new Error("Canvas external media drag ticket is invalid")
  }
  return input.ticket
}

function isTicket(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^drag_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}

function isPrepareId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new DOMException("Canceled", "AbortError")
}

function reportError(callback: ((error: unknown) => void) | undefined, error: unknown) {
  try {
    callback?.(error)
  } catch {
    // Diagnostics must not retain a staged native drag lease.
  }
}
