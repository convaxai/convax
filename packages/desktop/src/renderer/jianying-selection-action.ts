import type { CanvasSelectionActionContext } from "@convax/canvas"
import { getProjectResourceReference } from "@convax/project/canvas"
import type {
  JianyingCanvasExportRequest,
  JianyingCanvasExportResult,
  JianyingRendererClient,
} from "../jianying-contracts"

export function canExportSelectionToJianying(context: CanvasSelectionActionContext) {
  return (
    context.selectedEdgeIds.length === 0 &&
    context.selectedNodes.length > 0 &&
    context.selectedNodes.length === context.selectedNodeIds.length &&
    context.selectedNodes.every((node) => {
      if (node.type !== "file" || (node.data.kind !== "image" && node.data.kind !== "video")) return false
      const reference = getProjectResourceReference(node.data.metadata)
      return reference?.kind === "project-file" || reference?.kind === "managed-asset"
    })
  )
}

/** Keep the live AbortSignal in the renderer realm; contextBridge receives only cloneable data. */
export async function exportCanvasMediaToJianying(
  client: JianyingRendererClient,
  request: JianyingCanvasExportRequest,
  signal: AbortSignal,
): Promise<JianyingCanvasExportResult> {
  throwIfAborted(signal)
  const operationId = `renderer-${globalThis.crypto.randomUUID()}`
  const operation = client.exportCanvasMedia({ operationId, request })
  const cancel = () => client.cancelCanvasMediaExport({ operationId })
  signal.addEventListener("abort", cancel, { once: true })
  if (signal.aborted) cancel()
  try {
    return await operation
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}

export function normalizeJianyingRendererError(error: unknown): Error {
  const message = errorMessage(error)
    .replace(/^Error:\s*/, "")
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/, "")
    .trim()
  if (error instanceof Error && message === error.message) return error
  return new Error(message || "JianYing export failed", { cause: error })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return
  throw signal.reason ?? new DOMException("Canceled", "AbortError")
}
