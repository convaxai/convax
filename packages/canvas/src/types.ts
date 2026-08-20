import type { Edge, Node, XYPosition } from "@xyflow/react"

export type CanvasNodeId = string
export type CanvasEdgeId = string
export type CanvasDocumentId = string

export type CanvasNodeStatus = "idle" | "pending" | "error"
export type CanvasPendingResourceKind = "text" | "image" | "video" | "audio"
export type CanvasMediaKind = "image" | "video" | "audio" | "file"
export type CanvasFileKind = "text" | CanvasMediaKind | "folder"
/** Public canvas node roles. Structural groups are persisted as file nodes with `data.kind = "group"`. */
export type CanvasNodeType = "file" | "agent"
export type CanvasTextFormat = "plain" | "markdown"

export type CanvasResourceStatus = "stale" | "ready" | "missing" | "corrupt" | "unsupported" | "conflict"

export interface CanvasResourceRuntimeState {
  canSaveEditableCopy?: boolean
  contentRevision?: string
  editableText?: boolean
  error?: string
  mediaType?: string
  name?: string
  posterUrl?: string
  status: CanvasResourceStatus
  text?: string
  url?: string
}

const canvasResourceRuntimeStatuses = new Set<CanvasResourceStatus>([
  "stale",
  "ready",
  "missing",
  "corrupt",
  "unsupported",
  "conflict",
])

/**
 * Parses host-prepared resource presentation state for Canvas's transient
 * runtime overlay. The returned value is detached from the caller and is never
 * a persistence payload.
 */
export function parseCanvasResourceRuntimeState(value: unknown): CanvasResourceRuntimeState | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null
  const state = value as Record<string, unknown>
  if (!canvasResourceRuntimeStatuses.has(state.status as CanvasResourceStatus)) return null
  for (const key of ["contentRevision", "error", "mediaType", "name", "posterUrl", "text", "url"] as const) {
    if (state[key] !== undefined && typeof state[key] !== "string") return null
  }
  for (const key of ["canSaveEditableCopy", "editableText"] as const) {
    if (state[key] !== undefined && typeof state[key] !== "boolean") return null
  }
  return structuredClone(value) as CanvasResourceRuntimeState
}

export interface CanvasBaseNodeData extends Record<string, unknown> {
  kind: string
  label: string
  description?: string
  status?: CanvasNodeStatus
  error?: string
}

export interface CanvasTextNodeData extends CanvasBaseNodeData {
  kind: "text"
  name?: string
  mimeType?: string
  metadata: Record<string, unknown>
  resourceState?: CanvasResourceRuntimeState
}

export interface CanvasMediaNodeData extends CanvasBaseNodeData {
  kind: CanvasMediaKind
  fit?: "contain" | "cover"
  name?: string
  mimeType?: string
  width?: number
  height?: number
  durationMs?: number
  metadata: Record<string, unknown>
  resourceState?: CanvasResourceRuntimeState
}

export interface CanvasGroupNodeData extends CanvasBaseNodeData {
  kind: "group"
}

export interface CanvasFolderNodeData extends CanvasBaseNodeData {
  kind: "folder"
  name?: string
  metadata: Record<string, unknown>
  resourceState?: CanvasResourceRuntimeState
}

export interface CanvasAgentNodeData extends CanvasBaseNodeData {
  kind: "agent"
  agentId?: string
}

export type CanvasNodeData =
  | CanvasTextNodeData
  | CanvasMediaNodeData
  | CanvasFolderNodeData
  | CanvasAgentNodeData
  | CanvasGroupNodeData
  | CanvasBaseNodeData

/** Public and in-memory Canvas nodes have exactly two roles. Legacy types are normalized while parsing. */
export type CanvasNode = Node<CanvasNodeData, CanvasNodeType>

export interface CanvasEdgeData extends Record<string, unknown> {
  label?: string
}

export type CanvasEdge = Edge<CanvasEdgeData, string>

export interface CanvasMetadata {
  title: string
  description?: string
  tags?: string[]
}

export interface CanvasDocument {
  id: CanvasDocumentId
  metadata: CanvasMetadata
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export interface CanvasSelection {
  nodeIds: ReadonlySet<CanvasNodeId>
  edgeIds: ReadonlySet<CanvasEdgeId>
}

export interface CanvasPoint extends XYPosition {}

export interface CanvasSize {
  width: number
  height: number
}

export interface CanvasResource {
  id: string
  kind: CanvasMediaKind
  metadata: Record<string, unknown>
  name?: string
  mimeType?: string
  state: CanvasResourceRuntimeState
  width?: number
  height?: number
  durationMs?: number
}

export interface CanvasTextResource {
  id: string
  kind: "text"
  metadata: Record<string, unknown>
  name?: string
  mimeType?: string
  state: CanvasResourceRuntimeState
}

export interface CanvasFolderResource {
  id: string
  kind: "folder"
  metadata: Record<string, unknown>
  name: string
  state: CanvasResourceRuntimeState
}

export type CanvasUploadItem = CanvasResource | CanvasTextResource | CanvasFolderResource

export interface CanvasClipboardPayload {
  version: 1
  scope?: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}
