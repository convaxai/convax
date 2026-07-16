import { duplicateCanvasSelection } from "./commands"
import { parseCanvasDocument } from "./document"
import type { CanvasClipboardPayload, CanvasDocument, CanvasNode } from "./types"

export const CANVAS_CLIPBOARD_MIME_TYPE = "application/x-convax-canvas+json"

/**
 * File references backed by a host scope must not silently resolve against a
 * different scope after paste. Unknown plugin file kinds are treated as bound
 * by default; plugins can still serialize self-contained data inside a text node.
 */
export function isCanvasNodeScopeBound(node: CanvasNode) {
  if (node.type === "agent" || node.data.kind === "agent" || node.data.kind === "group") return false
  if (node.data.kind === "text") return Boolean(node.data.metadata && Object.keys(node.data.metadata).length)
  return true
}

export function canvasClipboardHasScopeConflict(payload: CanvasClipboardPayload, targetScope?: string) {
  return payload.scope !== targetScope && payload.nodes.some(isCanvasNodeScopeBound)
}

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
  scope?: string,
): CanvasClipboardPayload | null {
  const ids = collectClipboardNodeIds(document, selectedNodeIds)
  if (ids.size === 0) return null
  return {
    version: 1,
    scope,
    nodes: structuredClone(document.nodes.filter((node) => ids.has(node.id))),
    edges: structuredClone(document.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target))),
  }
}

export function serializeCanvasClipboard(payload: CanvasClipboardPayload) {
  return JSON.stringify(payload)
}

export function parseCanvasClipboard(value: string): CanvasClipboardPayload | null {
  if (value.length > 5 * 1024 * 1024) return null
  try {
    const input: unknown = JSON.parse(value)
    if (!input || typeof input !== "object") return null
    if (!("version" in input) || input.version !== 1) return null
    if (!("nodes" in input) || !Array.isArray(input.nodes)) return null
    if (!("edges" in input) || !Array.isArray(input.edges)) return null
    if ("scope" in input && input.scope !== undefined && typeof input.scope !== "string") return null
    const document = parseCanvasDocument({
      id: "clipboard",
      revision: 0,
      metadata: { title: "Clipboard" },
      nodes: input.nodes,
      edges: input.edges,
    })
    return document ? {
      version: 1,
      scope: "scope" in input && typeof input.scope === "string" ? input.scope : undefined,
      nodes: document.nodes,
      edges: document.edges,
    } : null
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
  const prepared = prepareCanvasClipboardPaste(payload, offset)
  return {
    document: {
      ...document,
      nodes: [...document.nodes, ...prepared.nodes],
      edges: [...document.edges, ...prepared.edges],
    },
    selectedNodeIds: prepared.selectedNodeIds,
  }
}

export function prepareCanvasClipboardPaste(
  payload: CanvasClipboardPayload,
  offset = { x: 32, y: 32 },
) {
  const source: CanvasDocument = {
    id: "clipboard",
    revision: 0,
    metadata: { title: "Clipboard" },
    nodes: payload.nodes,
    edges: payload.edges,
  }
  const roots = payload.nodes.filter((node) => !node.parentId).map((node) => node.id)
  const duplicated = duplicateCanvasSelection(source, roots, offset)
  return {
    edges: duplicated.document.edges.slice(payload.edges.length),
    nodes: duplicated.document.nodes.slice(payload.nodes.length),
    selectedNodeIds: duplicated.selectedNodeIds,
  }
}
