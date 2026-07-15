import { duplicateCanvasSelection } from "./commands"
import type { CanvasClipboardPayload, CanvasDocument } from "./types"

export const CANVAS_CLIPBOARD_MIME_TYPE = "application/x-convax-canvas+json"

function collectClipboardNodeIds(document: CanvasDocument, selectedNodeIds: readonly string[]) {
  const ids = new Set(selectedNodeIds)
  const addChildren = (parentId: string) => {
    document.nodes
      .filter((node) => node.parentId === parentId && !ids.has(node.id))
      .forEach((node) => {
        ids.add(node.id)
        addChildren(node.id)
      })
  }
  selectedNodeIds.forEach(addChildren)
  return ids
}

export function createCanvasClipboardPayload(
  document: CanvasDocument,
  selectedNodeIds: readonly string[],
): CanvasClipboardPayload | null {
  const ids = collectClipboardNodeIds(document, selectedNodeIds)
  if (ids.size === 0) return null
  return {
    version: 1,
    nodes: structuredClone(document.nodes.filter((node) => ids.has(node.id))),
    edges: structuredClone(document.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))),
  }
}

export function serializeCanvasClipboard(payload: CanvasClipboardPayload) {
  return JSON.stringify(payload)
}

export function parseCanvasClipboard(value: string): CanvasClipboardPayload | null {
  try {
    const input: unknown = JSON.parse(value)
    if (!input || typeof input !== "object") return null
    if (!("version" in input) || input.version !== 1) return null
    if (!("nodes" in input) || !Array.isArray(input.nodes)) return null
    if (!("edges" in input) || !Array.isArray(input.edges)) return null
    return input as CanvasClipboardPayload
  } catch {
    return null
  }
}

export function writeCanvasClipboard(data: DataTransfer | null, payload: CanvasClipboardPayload) {
  if (!data) return
  const value = serializeCanvasClipboard(payload)
  data.setData(CANVAS_CLIPBOARD_MIME_TYPE, value)
  data.setData("text/plain", value)
}

export function readCanvasClipboard(data: DataTransfer | null) {
  if (!data) return null
  const value = data.getData(CANVAS_CLIPBOARD_MIME_TYPE)
  if (value) return parseCanvasClipboard(value)
  return parseCanvasClipboard(data.getData("text/plain"))
}

export function pasteCanvasClipboard(
  document: CanvasDocument,
  payload: CanvasClipboardPayload,
  offset = { x: 32, y: 32 },
) {
  const source: CanvasDocument = {
    id: document.id,
    revision: document.revision,
    metadata: document.metadata,
    nodes: payload.nodes,
    edges: payload.edges,
  }
  const roots = payload.nodes.filter((node) => !node.parentId).map((node) => node.id)
  const duplicated = duplicateCanvasSelection(source, roots, offset)
  return {
    document: {
      ...document,
      nodes: [...document.nodes, ...duplicated.document.nodes.slice(payload.nodes.length)],
      edges: [...document.edges, ...duplicated.document.edges.slice(payload.edges.length)],
    },
    selectedNodeIds: duplicated.selectedNodeIds,
  }
}

