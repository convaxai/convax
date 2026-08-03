import type { CanvasDocument, CanvasNode } from "./types"

export const canvasGroupFoldKey = "convaxGroupFold"
export const canvasGroupFoldSchema = "convax.group-fold/1"

interface StoredCanvasGroupFold {
  folded: true
  schema: typeof canvasGroupFoldSchema
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parseCanvasGroupFold(value: unknown): StoredCanvasGroupFold | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    value.schema !== canvasGroupFoldSchema ||
    value.folded !== true
  ) {
    return undefined
  }
  return { folded: true, schema: canvasGroupFoldSchema }
}

function storedFoldForNode(node: CanvasNode | undefined) {
  if (node?.data.kind !== "group" || !isRecord(node.data.metadata)) return undefined
  return node.data.metadata[canvasGroupFoldKey]
}

/** Unmarked Groups preserve the original expanded presentation. */
export function isCanvasGroupFolded(node: CanvasNode | undefined) {
  return parseCanvasGroupFold(storedFoldForNode(node))?.folded === true
}

export function hasUnsupportedCanvasGroupFold(node: CanvasNode | undefined) {
  const stored = storedFoldForNode(node)
  return stored !== undefined && parseCanvasGroupFold(stored) === undefined
}

export function setCanvasGroupFolded(document: CanvasDocument, nodeId: string, folded: boolean): CanvasDocument {
  const node = document.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || node.data.kind !== "group") return document
  if (hasUnsupportedCanvasGroupFold(node)) throw new Error("Canvas group fold schema is unsupported")
  if (isCanvasGroupFolded(node) === folded) return document

  return {
    ...document,
    nodes: document.nodes.map((candidate) => {
      if (candidate.id !== nodeId || candidate.data.kind !== "group") return candidate
      const currentMetadata = isRecord(candidate.data.metadata) ? candidate.data.metadata : {}
      const metadata = { ...currentMetadata }
      if (folded) {
        metadata[canvasGroupFoldKey] = {
          folded: true,
          schema: canvasGroupFoldSchema,
        } satisfies StoredCanvasGroupFold
      } else {
        delete metadata[canvasGroupFoldKey]
      }
      if (Object.keys(metadata).length === 0) {
        const { metadata: _metadata, ...withoutMetadata } = candidate.data
        return { ...candidate, data: withoutMetadata }
      }
      return { ...candidate, data: { ...candidate.data, metadata } }
    }),
  }
}
