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
  CanvasResourceRuntimeState,
  CanvasTextNodeData,
} from "./types"
import { getCanvasTextFileFormat } from "./file-import"
import { isCanvasGroupFolded } from "./group-fold"
import { fitCanvasMediaSizeWithinBounds } from "./media-sizing"

/** Wide only at the persistence boundary so legacy node types never leak into the public model. */
type PersistedCanvasNode = Node<CanvasNodeData, string>
const emptyImageRuntimeStateKeys = new Set(["mediaType", "name", "status", "text", "url"])

export function createCanvasId(prefix: string) {
  const value =
    typeof crypto === "object" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)
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
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    (expectedId !== undefined && value.id !== expectedId) ||
    typeof value.revision !== "number" ||
    !Number.isFinite(value.revision) ||
    value.revision < 0 ||
    !isRecord(value.metadata) ||
    typeof value.metadata.title !== "string" ||
    !Array.isArray(value.nodes) ||
    !value.nodes.every(isCanvasNode) ||
    !Array.isArray(value.edges) ||
    !value.edges.every(isCanvasEdge)
  ) {
    return null
  }
  const nodes = value.nodes as unknown as PersistedCanvasNode[]
  const edges = value.edges as unknown as CanvasEdge[]
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edgeIds = new Set(edges.map((edge) => edge.id))
  if (
    nodeIds.size !== nodes.length ||
    edgeIds.size !== edges.length ||
    nodes.some((node) => node.parentId !== undefined && !nodeIds.has(node.parentId)) ||
    edges.some((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) ||
    hasParentCycle(nodes)
  ) {
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
  metadata: Record<string, unknown>
  mimeType?: string
  name?: string
  position: CanvasPoint
  resourceState: CanvasResourceRuntimeState
}): CanvasNode {
  const data: CanvasTextNodeData = {
    kind: "text",
    label: input.label ?? input.name ?? "Text",
    metadata: input.metadata,
    mimeType: input.mimeType,
    name: input.name,
    resourceState: { ...input.resourceState },
  }
  return {
    id: input.id ?? createCanvasId("node"),
    type: "file",
    position: input.position,
    data,
    style:
      getCanvasTextFileFormat({ mimeType: input.mimeType, name: input.name ?? "" }) === "markdown"
        ? { width: 360, height: 240 }
        : { width: 280, height: 160 },
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
    name: input.resource.name,
    mimeType: input.resource.mimeType,
    width: input.resource.width,
    height: input.resource.height,
    durationMs: input.resource.durationMs,
    metadata: input.resource.metadata,
    resourceState: { ...input.resource.state },
  }
  const boundedMedia =
    input.resource.kind === "image" || input.resource.kind === "video"
      ? fitCanvasMediaSizeWithinBounds(input.resource.width, input.resource.height)
      : null
  const size = boundedMedia ?? { height: 240, width: 320 }
  return {
    id: input.id ?? createCanvasId("node"),
    type: "file",
    position: input.position,
    data,
    style: { width: size.width, height: size.height },
  }
}

export function isCanvasEmptyImageNodeData(data: CanvasNodeData) {
  const name = data.name
  const mimeType = data.mimeType
  const metadata = data.metadata
  const error = data.error
  if (
    data.kind !== "image" ||
    data.status !== "idle" ||
    (name !== undefined && (typeof name !== "string" || name.trim())) ||
    (mimeType !== undefined && (typeof mimeType !== "string" || mimeType.trim())) ||
    (error !== undefined && (typeof error !== "string" || error.trim())) ||
    !isRecord(metadata) ||
    Object.keys(metadata).length > 0
  ) {
    return false
  }
  const state = data.resourceState
  // A durable empty card has no runtime state after serialization. Any persisted
  // resource identity above, or any non-ready runtime state, fails closed.
  if (state === undefined) return true
  return (
    isRecord(state) &&
    Object.keys(state).every((key) => emptyImageRuntimeStateKeys.has(key)) &&
    state.status === "ready" &&
    isEmptyOptionalString(state.url) &&
    isEmptyOptionalString(state.name) &&
    isEmptyOptionalString(state.mediaType) &&
    isEmptyOptionalString(state.text)
  )
}

function isEmptyOptionalString(value: unknown) {
  return value === undefined || (typeof value === "string" && !value.trim())
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
    metadata: input.resource.metadata,
    resourceState: { ...input.resource.state },
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

export const CANVAS_GROUP_FOLDER_SIZE = {
  height: 160,
  width: 200,
} as const

/**
 * Geometry used when a node participates in overview UI operations. Structural
 * Folded Groups retain their expanded child bounds in persistence while using
 * compact folder geometry in overview operations.
 */
export function getCanvasNodePresentationSize(node: CanvasNode) {
  return node.data.kind === "group" && isCanvasGroupFolded(node) ? CANVAS_GROUP_FOLDER_SIZE : getCanvasNodeSize(node)
}

function isCanvasNode(value: unknown) {
  if (
    !(
      isRecord(value) &&
      typeof value.id === "string" &&
      (value.type === undefined || typeof value.type === "string") &&
      (value.parentId === undefined || typeof value.parentId === "string") &&
      isRecord(value.position) &&
      typeof value.position.x === "number" &&
      Number.isFinite(value.position.x) &&
      typeof value.position.y === "number" &&
      Number.isFinite(value.position.y) &&
      isRecord(value.data) &&
      typeof value.data.kind === "string" &&
      typeof value.data.label === "string"
    )
  )
    return false
  if (value.data.kind === "note") return false
  if (value.data.kind === "text" && value.data.name !== undefined && typeof value.data.name !== "string") return false
  if (value.data.kind === "text" && value.data.mimeType !== undefined && typeof value.data.mimeType !== "string")
    return false
  if (value.data.kind === "folder" && value.data.name !== undefined && typeof value.data.name !== "string") return false
  if (value.data.kind === "agent" && value.data.agentId !== undefined && typeof value.data.agentId !== "string")
    return false
  if (
    value.data.status !== undefined &&
    value.data.status !== "idle" &&
    value.data.status !== "pending" &&
    value.data.status !== "error"
  )
    return false
  if (value.data.error !== undefined && typeof value.data.error !== "string") return false
  if (isResourceKind(value.data.kind) && !isRecord(value.data.metadata)) return false
  if (
    isResourceKind(value.data.kind) &&
    value.data.resourceState !== undefined &&
    !isResourceRuntimeState(value.data.resourceState)
  )
    return false
  if (isResourceKind(value.data.kind)) {
    for (const key of ["format", "text", "richText", "url", "posterUrl", "path"]) {
      if (key in value.data) return false
    }
  }
  if (!isResourceKind(value.data.kind) && value.data.metadata !== undefined && !isRecord(value.data.metadata))
    return false
  if (
    ["image", "video", "audio", "file"].includes(value.data.kind) &&
    value.data.fit !== undefined &&
    !["contain", "cover"].includes(String(value.data.fit))
  )
    return false
  return true
}

function isResourceKind(value: string) {
  return ["text", "image", "video", "audio", "file", "folder"].includes(value)
}

function isResourceRuntimeState(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.status !== "string" ||
    !["stale", "ready", "missing", "corrupt", "unsupported", "conflict"].includes(value.status)
  )
    return false
  return (
    ["contentRevision", "error", "posterUrl", "text", "url"].every(
      (key) => value[key] === undefined || typeof value[key] === "string",
    ) &&
    ["canSaveEditableCopy", "editableText"].every((key) => value[key] === undefined || typeof value[key] === "boolean")
  )
}

function migrateCanvasNode(node: PersistedCanvasNode): CanvasNode {
  if (
    ["image", "video", "audio", "file"].includes(node.data.kind) &&
    node.data.label === "Media" &&
    typeof node.data.name !== "string"
  ) {
    const kindLabel = node.data.kind[0].toUpperCase() + node.data.kind.slice(1)
    return { ...node, type: "file", data: { ...node.data, label: kindLabel } }
  }
  if (node.data.kind === "group") return { ...node, type: "file", zIndex: node.zIndex ?? -1 }
  if (node.data.kind === "agent") return { ...node, type: "agent" }
  return { ...node, type: "file" }
}

function isCanvasEdge(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.source === "string" &&
    typeof value.target === "string"
  )
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
