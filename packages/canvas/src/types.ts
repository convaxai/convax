import type { Edge, Node, XYPosition } from "@xyflow/react"

export type CanvasNodeId = string
export type CanvasEdgeId = string
export type CanvasDocumentId = string

export type CanvasNodeStatus = "idle" | "pending" | "error"
export type CanvasMediaKind = "image" | "video" | "audio" | "file"

export interface CanvasBaseNodeData extends Record<string, unknown> {
  kind: string
  label: string
  description?: string
  status?: CanvasNodeStatus
  error?: string
}

export interface CanvasTextNodeData extends CanvasBaseNodeData {
  kind: "text"
  text: string
}

export type CanvasNoteTone = "neutral" | "yellow" | "green" | "blue" | "rose"

export interface CanvasNoteNodeData extends CanvasBaseNodeData {
  kind: "note"
  text: string
  tone: CanvasNoteTone
}

export interface CanvasMediaNodeData extends CanvasBaseNodeData {
  kind: CanvasMediaKind
  url: string
  name?: string
  mimeType?: string
  posterUrl?: string
  width?: number
  height?: number
  durationMs?: number
  metadata?: Record<string, unknown>
}

export interface CanvasGroupNodeData extends CanvasBaseNodeData {
  kind: "group"
}

export type CanvasNodeData =
  | CanvasTextNodeData
  | CanvasNoteNodeData
  | CanvasMediaNodeData
  | CanvasGroupNodeData
  | CanvasBaseNodeData

export type CanvasNode = Node<CanvasNodeData, string>

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
  revision: number
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
  url: string
  name?: string
  mimeType?: string
  posterUrl?: string
  width?: number
  height?: number
  durationMs?: number
  metadata?: Record<string, unknown>
}

export interface CanvasClipboardPayload {
  version: 1
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

