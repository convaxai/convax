import type { Edge, Node, XYPosition } from "@xyflow/react"

export type CanvasNodeId = string
export type CanvasEdgeId = string
export type CanvasDocumentId = string

export type CanvasNodeStatus = "idle" | "pending" | "error"
export type CanvasMediaKind = "image" | "video" | "audio" | "file"
export type CanvasTextFormat = "plain" | "markdown"

export interface CanvasBaseNodeData extends Record<string, unknown> {
  kind: string
  label: string
  description?: string
  status?: CanvasNodeStatus
  error?: string
}

export interface CanvasRichTextContent {
  type: string
  attrs?: Record<string, unknown>
  content?: CanvasRichTextContent[]
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  text?: string
}

export interface CanvasTextNodeData extends CanvasBaseNodeData {
  kind: "text"
  text: string
  format?: CanvasTextFormat
  richText?: CanvasRichTextContent
}

export interface CanvasMediaNodeData extends CanvasBaseNodeData {
  kind: CanvasMediaKind
  url: string
  fit?: "contain" | "cover"
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

export interface CanvasTextResource {
  id: string
  kind: "text"
  text: string
  format?: CanvasTextFormat
  name?: string
  mimeType?: string
  metadata?: Record<string, unknown>
}

export type CanvasUploadItem = CanvasResource | CanvasTextResource

export interface CanvasClipboardPayload {
  version: 1
  scope?: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}
