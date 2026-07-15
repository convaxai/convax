import type {
  CanvasDocument,
  CanvasEdge,
  CanvasGroupNodeData,
  CanvasMediaNodeData,
  CanvasNode,
  CanvasNoteNodeData,
  CanvasNoteTone,
  CanvasPoint,
  CanvasResource,
  CanvasTextNodeData,
} from "./types"

export function createCanvasId(prefix: string) {
  const value = typeof crypto === "object" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  return `${prefix}_${value}`
}

export function createCanvasDocument(input?: {
  id?: string
  title?: string
  description?: string
  nodes?: CanvasNode[]
  edges?: CanvasEdge[]
}): CanvasDocument {
  return {
    id: input?.id ?? createCanvasId("canvas"),
    revision: 0,
    metadata: {
      title: input?.title ?? "Untitled canvas",
      description: input?.description,
    },
    nodes: input?.nodes ?? [],
    edges: input?.edges ?? [],
  }
}

export function createTextNode(input: {
  id?: string
  label?: string
  text?: string
  position: CanvasPoint
}): CanvasNode {
  const data: CanvasTextNodeData = {
    kind: "text",
    label: input.label ?? "Text",
    text: input.text ?? "Start typing...",
  }
  return {
    id: input.id ?? createCanvasId("node"),
    type: "text",
    position: input.position,
    data,
    style: { width: 280, height: 160 },
  }
}

export function createNoteNode(input: {
  id?: string
  label?: string
  text?: string
  tone?: CanvasNoteTone
  position: CanvasPoint
}): CanvasNode {
  const data: CanvasNoteNodeData = {
    kind: "note",
    label: input.label ?? "Note",
    text: input.text ?? "Add a thought",
    tone: input.tone ?? "yellow",
  }
  return {
    id: input.id ?? createCanvasId("node"),
    type: "note",
    position: input.position,
    data,
    style: { width: 240, height: 180 },
  }
}

export function createMediaNode(input: {
  id?: string
  label?: string
  position: CanvasPoint
  resource: CanvasResource
}): CanvasNode {
  const data: CanvasMediaNodeData = {
    kind: input.resource.kind,
    label: input.label ?? input.resource.name ?? "Media",
    url: input.resource.url,
    name: input.resource.name,
    mimeType: input.resource.mimeType,
    posterUrl: input.resource.posterUrl,
    width: input.resource.width,
    height: input.resource.height,
    durationMs: input.resource.durationMs,
    metadata: input.resource.metadata,
  }
  const ratio = input.resource.width && input.resource.height ? input.resource.width / input.resource.height : 4 / 3
  const width = 320
  return {
    id: input.id ?? createCanvasId("node"),
    type: input.resource.kind,
    position: input.position,
    data,
    style: { width, height: Math.max(180, Math.round(width / ratio)) },
  }
}

export function createGroupNode(input: {
  id?: string
  label?: string
  position: CanvasPoint
  width: number
  height: number
  parentId?: string
}): CanvasNode {
  const data: CanvasGroupNodeData = {
    kind: "group",
    label: input.label ?? "Group",
  }
  return {
    id: input.id ?? createCanvasId("group"),
    type: "group",
    position: input.position,
    parentId: input.parentId,
    data,
    style: { width: input.width, height: input.height },
  }
}

export function cloneCanvasDocument(document: CanvasDocument): CanvasDocument {
  return structuredClone(document)
}

export function getCanvasNodeSize(node: CanvasNode) {
  const styleWidth = typeof node.style?.width === "number" ? node.style.width : undefined
  const styleHeight = typeof node.style?.height === "number" ? node.style.height : undefined
  return {
    width: node.measured?.width ?? node.width ?? styleWidth ?? 240,
    height: node.measured?.height ?? node.height ?? styleHeight ?? 160,
  }
}

