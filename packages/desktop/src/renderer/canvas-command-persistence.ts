import type { CanvasDocument, CanvasPersistenceService } from "@convax/canvas"
import {
  createCanvasDocumentPatchCommand,
  type CanvasDocumentPatchCommand,
} from "@convax/canvas/application"
import type { CanvasRendererDocumentClient } from "../canvas-document-contracts"

export function createRendererCanvasPersistence(options: {
  client: CanvasRendererDocumentClient
  commandId(): string
  dehydrate(document: CanvasDocument): CanvasDocument
  hydrate(document: CanvasDocument): CanvasDocument
  onSavePending?(pending: Promise<CanvasDocument>): void
  ref: { canvasId: string; scopeId: string }
}): CanvasPersistenceService {
  let authoritativeDocument: CanvasDocument | null | undefined
  let saveQueue: Promise<unknown> = Promise.resolve()

  return {
    async load(documentId, signal) {
      throwIfAborted(signal)
      const result = await options.client.load(options.ref)
      throwIfAborted(signal)
      if (!result.document) {
        authoritativeDocument = null
        return null
      }
      if (result.document.id !== documentId) throw new Error("Loaded the wrong canvas document")
      authoritativeDocument = structuredClone(options.dehydrate(result.document))
      return options.hydrate(result.document)
    },
    save(document, signal) {
      const save = saveQueue
        .catch(() => undefined)
        .then(async () => {
          throwIfAborted(signal)
          if (authoritativeDocument === undefined) throw new Error("Canvas must be loaded before it can be edited")
          if (!authoritativeDocument) throw new Error("Canvas document was not found")
          const target = options.dehydrate(document)
          const command = createCanvasDocumentPatchCommand(authoritativeDocument, target)
          if (isEmptyCanvasDocumentPatch(command)) return options.hydrate(authoritativeDocument)
          const result = await options.client.execute({
            command,
            commandId: options.commandId(),
            expectedRevision: authoritativeDocument.revision,
            ref: options.ref,
          })
          authoritativeDocument = structuredClone(options.dehydrate(result.document))
          return options.hydrate(result.document)
        })
      saveQueue = save
      options.onSavePending?.(save)
      return save
    },
  }
}

function isEmptyCanvasDocumentPatch(command: CanvasDocumentPatchCommand) {
  return (
    command.addedEdges.length === 0 &&
    command.addedNodes.length === 0 &&
    command.metadata === undefined &&
    command.removedEdgeIds.length === 0 &&
    command.removedNodeIds.length === 0 &&
    command.updatedEdges.length === 0 &&
    command.updatedNodes.length === 0
  )
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException("Canvas persistence request was canceled", "AbortError")
}
