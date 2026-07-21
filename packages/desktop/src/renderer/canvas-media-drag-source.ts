import type { CanvasSelectionActionContext, CanvasSelectionDragSource } from "@convax/canvas"
import {
  getProjectFileReference,
  isProjectCanvasManagedAssetPath,
  requireProjectCanvasResourcePath,
} from "@convax/project/canvas"
import type { CanvasExternalMediaDragRendererClient } from "../canvas-external-drag-contracts"

export const canvasMediaSelectionDragSourceId = "desktop.canvas-media.external-drag"

export interface CanvasMediaSelectionDragSourceOptions {
  client: CanvasExternalMediaDragRendererClient
  createPrepareId?: () => string
  flush: () => Promise<void>
  icon?: CanvasSelectionDragSource["icon"]
  label: string
  mode?: CanvasSelectionDragSource["mode"]
  preparingLabel?: string
  scopeId: string
}

export function isManagedCanvasMediaDragSelection(context: CanvasSelectionActionContext) {
  return (
    !context.signal.aborted &&
    context.selectedEdgeIds.length === 0 &&
    context.selectedNodeIds.length > 0 &&
    context.selectedNodes.length === context.selectedNodeIds.length &&
    context.selectedNodes.every((node) => {
      if (
        node.type !== "file" ||
        (node.data.kind !== "image" && node.data.kind !== "video" && node.data.kind !== "audio")
      ) {
        return false
      }
      const reference = getProjectFileReference(node.data.metadata)
      if (!reference) return false
      try {
        return isProjectCanvasManagedAssetPath(requireProjectCanvasResourcePath(reference.path))
      } catch {
        return false
      }
    })
  )
}

export function createCanvasMediaSelectionDragSource(
  options: CanvasMediaSelectionDragSourceOptions,
): CanvasSelectionDragSource {
  return {
    icon: options.icon,
    id: canvasMediaSelectionDragSourceId,
    label: options.label,
    mode: options.mode,
    preparingLabel: options.preparingLabel,
    shortcutModifier: "meta",
    visible: isManagedCanvasMediaDragSelection,
    async prepare(context) {
      throwIfAborted(context.signal)
      if (!isManagedCanvasMediaDragSelection(context)) {
        throw new Error("The Canvas media drag selection is no longer valid")
      }
      await options.flush()
      throwIfAborted(context.signal)

      const prepareId = options.createPrepareId?.() ?? `prepare_${crypto.randomUUID()}`
      let preparing = true
      const cancelPreparation = () => {
        if (!preparing) return
        try {
          options.client.cancelPrepare({ prepareId })
        } catch {
          // Main also aborts work when the renderer closes or IPC is disposed.
        }
      }
      context.signal.addEventListener("abort", cancelPreparation, { once: true })
      let response: { expiresAt: number; itemCount: number; ticket: string }
      try {
        response = await options.client.prepare({
          expectedRevision: context.document.revision,
          nodeIds: [...context.selectedNodeIds],
          prepareId,
          ref: { canvasId: context.document.id, scopeId: options.scopeId },
        })
      } catch (error) {
        preparing = false
        context.signal.removeEventListener("abort", cancelPreparation)
        throwIfAborted(context.signal)
        throw error
      }
      preparing = false
      context.signal.removeEventListener("abort", cancelPreparation)

      if (context.signal.aborted) {
        const ticket = validTicket(response?.ticket)
        if (ticket) cancelTicket(options.client, ticket)
        throwAbortReason(context.signal)
      }
      const prepared = requireTicket(options.client, response, context.selectedNodeIds.length)

      let state: "ready" | "started" | "disposed" = "ready"
      const dispose = () => {
        if (state !== "ready") return
        state = "disposed"
        context.signal.removeEventListener("abort", dispose)
        cancelTicket(options.client, prepared.ticket)
      }
      context.signal.addEventListener("abort", dispose, { once: true })
      if (context.signal.aborted) dispose()
      if (state !== "ready") throwAbortReason(context.signal)

      return {
        dispose,
        expiresAt: prepared.expiresAt,
        start() {
          if (state !== "ready") return
          state = "started"
          context.signal.removeEventListener("abort", dispose)
          try {
            options.client.start({ ticket: prepared.ticket })
          } catch (error) {
            state = "disposed"
            cancelTicket(options.client, prepared.ticket)
            throw error
          }
        },
      }
    },
  }
}

function requireTicket(client: CanvasExternalMediaDragRendererClient, response: unknown, expectedItemCount: number) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("The native Canvas drag ticket is invalid or expired")
  }
  const value = response as Record<string, unknown>
  const ticket = validTicket(value.ticket)
  if (
    !ticket ||
    typeof value.expiresAt !== "number" ||
    !Number.isFinite(value.expiresAt) ||
    value.expiresAt <= Date.now() ||
    !Number.isSafeInteger(value.itemCount) ||
    value.itemCount !== expectedItemCount
  ) {
    if (ticket) cancelTicket(client, ticket)
    throw new Error("The native Canvas drag ticket is invalid or expired")
  }
  return { expiresAt: value.expiresAt, ticket }
}

function validTicket(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : undefined
}

function cancelTicket(client: CanvasExternalMediaDragRendererClient, ticket: string) {
  try {
    client.cancel({ ticket })
  } catch {
    // Cleanup is best-effort. Main also expires every unconsumed ticket.
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throwAbortReason(signal)
}

function throwAbortReason(signal: AbortSignal): never {
  throw signal.reason ?? new DOMException("Canceled", "AbortError")
}
