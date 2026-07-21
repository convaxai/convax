import type { Node } from "@xyflow/react"
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasAgentNodeData,
  CanvasFolderNodeData,
  CanvasFolderResource,
  CanvasGroupNodeData,
  CanvasMediaNodeData,
  CanvasNode,
  CanvasNodeData,
  CanvasPoint,
  CanvasResource,
  CanvasTextFormat,
  CanvasTextNodeData,
} from "./types"

/** Wide only at the persistence boundary so legacy node types never leak into the public model. */
type PersistedCanvasNode = Node<CanvasNodeData, string>

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
  const nodes = value.nodes as unknown as PersistedCanvasNode[]
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
  return {
    ...(value as unknown as CanvasDocument),
    nodes: nodes.map(migrateCanvasNode),
  }
}

export function createTextNode(input: {
  id?: string
  label?: string
  text?: string
  format?: CanvasTextFormat
  metadata?: Record<string, unknown>
  position: CanvasPoint
}): CanvasNode {
  const data: CanvasTextNodeData = {
    kind: "text",
    label: input.label ?? "Text",
    text: input.text ?? "",
    format: input.format,
    metadata: input.metadata,
  }
  return {
    id: input.id ?? createCanvasId("node"),
    type: "file",
    position: input.position,
    data,
    style: input.format ? { width: 360, height: 240 } : { width: 280, height: 160 },
  }
}

export function createMediaNode(input: {
  id?: string
  label?: string
  position: CanvasPoint
  resource: CanvasResource
}): CanvasNode {
  const kindLabel = input.resource.kind[0].toUpperCase() + input.resource.kind.slice(1)
  const data: CanvasMediaNodeData = {
    kind: input.resource.kind,
    label: input.label ?? input.resource.name ?? kindLabel,
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
    type: "file",
    position: input.position,
    data,
    style: { width, height: Math.max(180, Math.round(width / ratio)) },
  }
}

export function createFolderNode(input: {
  id?: string
  label?: string
  position: CanvasPoint
  resource: CanvasFolderResource
}): CanvasNode {
  const data: CanvasFolderNodeData = {
    kind: "folder",
    label: input.label ?? input.resource.name,
    name: input.resource.name,
    path: input.resource.path,
    metadata: input.resource.metadata,
  }
  return {
    id: input.id ?? createCanvasId("node"),
    type: "file",
    position: input.position,
    data,
    style: { width: 300, height: 180 },
  }
}

export function createAgentNode(input: {
  agentId?: string
  id?: string
  label?: string
  position: CanvasPoint
}): CanvasNode {
  const data: CanvasAgentNodeData = {
    agentId: input.agentId,
    kind: "agent",
    label: input.label ?? "Agent",
  }
  return {
    id: input.id ?? createCanvasId("agent"),
    type: "agent",
    position: input.position,
    data,
    style: { width: 420, height: 520 },
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
    type: "file",
    position: input.position,
    parentId: input.parentId,
    data,
    style: { width: input.width, height: input.height },
    zIndex: -1,
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
  if (value.data.kind === "text" && value.data.format !== undefined && !["plain", "markdown"].includes(String(value.data.format))) return false
  if (value.data.kind === "text" && value.data.richText !== undefined && !isCanvasRichTextContent(value.data.richText)) return false
  if (value.data.kind === "folder"
    && (value.data.name !== undefined && typeof value.data.name !== "string"
      || value.data.path !== undefined && typeof value.data.path !== "string")) return false
  if (value.data.kind === "agent" && value.data.agentId !== undefined && typeof value.data.agentId !== "string") return false
  if (value.data.metadata !== undefined && !isRecord(value.data.metadata)) return false
  if (
    value.data.status !== undefined &&
    value.data.status !== "idle" &&
    value.data.status !== "pending" &&
    value.data.status !== "error"
  )
    return false
  if (value.data.error !== undefined && typeof value.data.error !== "string") return false
  if (["image", "video", "audio", "file"].includes(value.data.kind) && typeof value.data.url !== "string") return false
  if (["image", "video", "audio", "file"].includes(value.data.kind)
    && value.data.fit !== undefined
    && !["contain", "cover"].includes(String(value.data.fit))) return false
  return true
}

function isCanvasRichTextContent(value: unknown, depth = 0): boolean {
  if (!isRecord(value) || depth > 100) return false
  if (typeof value.type !== "string") return false
  if (value.text !== undefined && typeof value.text !== "string") return false
  if (value.attrs !== undefined && !isRecord(value.attrs)) return false
  if (value.content !== undefined
    && (!Array.isArray(value.content) || !value.content.every((child) => isCanvasRichTextContent(child, depth + 1)))) return false
  if (value.marks !== undefined && (!Array.isArray(value.marks) || !value.marks.every((mark) =>
    isRecord(mark)
    && typeof mark.type === "string"
    && (mark.attrs === undefined || isRecord(mark.attrs))))) return false
  return true
}

function migrateCanvasNode(node: PersistedCanvasNode): CanvasNode {
  if (node.data.kind === "note") {
    const { tone: _tone, ...legacyData } = node.data
    return {
      ...node,
      type: "file",
      data: {
        ...legacyData,
        kind: "text",
        label: legacyData.label === "Note" ? "Text" : legacyData.label,
        text: typeof legacyData.text === "string" ? legacyData.text : "",
      },
    }
  }
  if (["image", "video", "audio", "file"].includes(node.data.kind)
    && node.data.label === "Media"
    && typeof node.data.name !== "string") {
    const kindLabel = node.data.kind[0].toUpperCase() + node.data.kind.slice(1)
    return { ...node, type: "file", data: { ...node.data, label: kindLabel } }
  }
  if (node.data.kind === "group") return { ...node, type: "file", zIndex: node.zIndex ?? -1 }
  if (node.data.kind === "agent") return { ...node, type: "agent" }
  return { ...node, type: "file" }
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

function hasParentCycle(nodes: readonly PersistedCanvasNode[]) {
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
