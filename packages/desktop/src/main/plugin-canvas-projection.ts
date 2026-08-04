import { getCanvasNodeSize, type CanvasDocument } from "@convax/canvas/core"
import { getProjectResourceReference } from "@convax/project/canvas"

import type {
  PluginCanvasDocumentProjection,
  PluginCanvasDocumentResult,
  PluginCanvasRef,
  PluginCanvasStructureDocument,
} from "../plugin-capability-contracts"

function geometryNodes(document: CanvasDocument) {
  return document.nodes.map((node) => ({
    id: node.id,
    kind: node.data.kind,
    label: node.data.label,
    ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
    position: { ...node.position },
    size: getCanvasNodeSize(node),
    ...(node.type === undefined ? {} : { type: node.type }),
  }))
}

export function projectPluginCanvasDocument(
  document: CanvasDocument,
  projection: PluginCanvasDocumentProjection,
  ref: PluginCanvasRef,
): PluginCanvasDocumentResult {
  const nodes = geometryNodes(document)
  const edges = document.edges.map(({ id, source, target }) => ({ id, source, target }))
  if (projection === "geometry") {
    return {
      document: { edges, id: document.id, nodes, title: document.metadata.title },
      projection,
      ref: { ...ref },
    }
  }
  return {
    document: projectPluginCanvasStructureDocument(document, nodes, edges),
    projection,
    ref: { ...ref },
  }
}

export function projectPluginCanvasStructureDocument(
  document: CanvasDocument,
  nodes = geometryNodes(document),
  edges = document.edges.map(({ id, source, target }) => ({ id, source, target })),
): PluginCanvasStructureDocument {
  return {
    ...(document.metadata.description === undefined ? {} : { description: document.metadata.description }),
    edges,
    id: document.id,
    nodes: document.nodes.map((node, index) => {
      const reference = getProjectResourceReference(node.data.metadata)
      const resourceState =
        node.data.resourceState &&
        typeof node.data.resourceState === "object" &&
        !Array.isArray(node.data.resourceState)
          ? (node.data.resourceState as Record<string, unknown>)
          : undefined
      return {
        ...nodes[index]!,
        ...(typeof node.data.description === "string" ? { description: node.data.description } : {}),
        ...(typeof node.data.durationMs === "number" ? { durationMs: node.data.durationMs } : {}),
        ...(typeof node.data.mimeType === "string" ? { mimeType: node.data.mimeType } : {}),
        ...(typeof node.data.name === "string" ? { name: node.data.name } : {}),
        ...(reference?.kind === "project-file"
          ? { resource: { kind: "project-file" as const, path: reference.path } }
          : {}),
        ...(resourceState && typeof resourceState.status === "string" ? { status: resourceState.status } : {}),
        ...(resourceState && typeof resourceState.text === "string" ? { text: resourceState.text } : {}),
      }
    }),
    ...(document.metadata.tags === undefined ? {} : { tags: [...document.metadata.tags] }),
    title: document.metadata.title,
  }
}
