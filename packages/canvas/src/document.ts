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

export function parseCanvasDocument(value: unknown, expectedId?: string): CanvasDocument | null {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || (expectedId !== undefined && value.id !== expectedId)
    || typeof value.revision !== "number"
    || !Number.isFinite(value.revision)
    || value.revision < 0
    || !isRecord(value.metadata)
    || typeof value.metadata.title !== "string"
    || !Array.isArray(value.nodes)
    || !value.nodes.every(isCanvasNode)
    || !Array.isArray(value.edges)
    || !value.edges.every(isCanvasEdge)) {
    return null
  }
  const nodes = value.nodes as unknown as CanvasNode[]
  const edges = value.edges as unknown as CanvasEdge[]
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edgeIds = new Set(edges.map((edge) => edge.id))
  if (nodeIds.size !== nodes.length
    || edgeIds.size !== edges.length
    || nodes.some((node) => node.parentId !== undefined && !nodeIds.has(node.parentId))
    || edges.some((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))
    || hasParentCycle(nodes)) {
    return null
  }
  return value as unknown as CanvasDocument
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

function isCanvasNode(value: unknown) {
  if (!(isRecord(value)
    && typeof value.id === "string"
    && (value.type === undefined || typeof value.type === "string")
    && (value.parentId === undefined || typeof value.parentId === "string")
    && isRecord(value.position)
    && typeof value.position.x === "number"
    && Number.isFinite(value.position.x)
    && typeof value.position.y === "number"
    && Number.isFinite(value.position.y)
    && isRecord(value.data)
    && typeof value.data.kind === "string"
    && typeof value.data.label === "string")) return false
  if ((value.data.kind === "text" || value.data.kind === "note") && typeof value.data.text !== "string") return false
  if (value.data.kind === "note" && !["neutral", "yellow", "green", "blue", "rose"].includes(String(value.data.tone))) return false
  if (["image", "video", "audio", "file"].includes(value.data.kind) && typeof value.data.url !== "string") return false
  return true
}

function isCanvasEdge(value: unknown) {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.source === "string"
    && typeof value.target === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasParentCycle(nodes: readonly CanvasNode[]) {
  const parents = new Map(nodes.map((node) => [node.id, node.parentId]))
  const states = new Map<string, "visiting" | "resolved">()
  for (const node of nodes) {
    const trail: string[] = []
    let current: string | undefined = node.id
    while (current) {
      const state = states.get(current)
      if (state === "visiting") return true
      if (state === "resolved") break
      states.set(current, "visiting")
      trail.push(current)
      current = parents.get(current)
    }
    for (const id of trail) states.set(id, "resolved")
  }
  return false
}
