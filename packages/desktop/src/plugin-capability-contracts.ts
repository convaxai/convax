import type { CanvasApplicationCommand, CanvasNodeQuery, CanvasNodeSummary } from "@convax/canvas/application"
import type { CanvasEdge, CanvasPoint, CanvasSize } from "@convax/canvas/core"

import type { PluginCapability } from "./plugin-api"
import type { PluginCapabilityProtocol } from "./plugin-host-protocol"

export const pluginCapabilityRuntimeKinds = ["web", "tool", "builtin"] as const
export type PluginCapabilityRuntimeKind = (typeof pluginCapabilityRuntimeKinds)[number]

/** Immutable identity captured when a host connection is established. */
export interface PluginPrincipal {
  capabilityProtocol?: PluginCapabilityProtocol
  manifestDigest: string
  pluginId: string
  pluginVersion: string
  runtime: PluginCapabilityRuntimeKind
}

/** Public Project/Canvas identity. Native paths never cross this contract. */
export interface PluginCanvasRef {
  canvasId: string
  projectId: string
}

export type PluginProjectScope = { kind: "project"; projectId: string } | { kind: "all-bound-projects" }

export interface PluginCapabilityConnectionRequest {
  principal: PluginPrincipal
  scope: PluginProjectScope
}

export interface PluginProjectSummary {
  available: boolean
  id: string
  name: string
}

export interface PluginCanvasSummary {
  createdAt: number
  id: string
  name: string
  updatedAt: number
}

export interface PluginCanvasCatalogResult {
  canvases: PluginCanvasSummary[]
  projectId: string
}

export const pluginCanvasDocumentProjections = ["geometry", "structure"] as const
export type PluginCanvasDocumentProjection = (typeof pluginCanvasDocumentProjections)[number]

export interface PluginCanvasGeometryNode {
  id: string
  kind: string
  label: string
  parentId?: string
  position: CanvasPoint
  size: CanvasSize
  type?: string
}

export interface PluginCanvasGeometryDocument {
  edges: Array<Pick<CanvasEdge, "id" | "source" | "target">>
  id: string
  nodes: PluginCanvasGeometryNode[]
  revision: number
  title: string
}

export interface PluginCanvasPortableResourceRef {
  kind: "project-file"
  path: string
}

export interface PluginCanvasStructureNode extends PluginCanvasGeometryNode {
  description?: string
  durationMs?: number
  mimeType?: string
  name?: string
  resource?: PluginCanvasPortableResourceRef
  status?: string
  text?: string
}

export interface PluginCanvasStructureDocument extends Omit<PluginCanvasGeometryDocument, "nodes"> {
  description?: string
  nodes: PluginCanvasStructureNode[]
  tags?: string[]
}

export type PluginCanvasDocumentResult =
  | {
      document: PluginCanvasGeometryDocument
      projection: "geometry"
      ref: PluginCanvasRef
      storageVersion: string | null
    }
  | {
      document: PluginCanvasStructureDocument
      projection: "structure"
      ref: PluginCanvasRef
      storageVersion: string | null
    }

export interface PluginCanvasNodeQueryResult {
  nodes: CanvasNodeSummary[]
  ref: PluginCanvasRef
  revision: number
  storageVersion: string | null
}

export interface PluginCanvasTransactionRequest {
  commands: readonly PluginCanvasDocumentCommand[]
  expectedRevision: number
  ref: PluginCanvasRef
  transactionId: string
}

/**
 * Resource admission/replacement is intentionally excluded. Plugin document
 * transactions cannot forge a portable file reference or bypass Project-owned
 * admission leases; those operations use a separate resource business API.
 */
export type PluginCanvasDocumentCommand = Exclude<
  CanvasApplicationCommand,
  { type: "resources.add" | "resources.replace" }
>

/** Compact result: callers re-query only the projection they need. */
export interface PluginCanvasTransactionResult {
  affectedNodeIds: string[]
  changed: boolean
  createdNodeIds: string[]
  ref: PluginCanvasRef
  revision: number
  storageVersion: string
  /** The commit succeeded, but its potentially huge id lists were omitted from the transport response. */
  summaryTruncated?: boolean
  warnings: string[]
}

export interface PluginCanvasChangeEvent {
  ref: PluginCanvasRef
  revision: number
  source: "plugin" | "renderer" | "host"
}

export interface PluginCanvasEventSubscription {
  close(): void
}

/**
 * Principal-bound API shared by Web, verified Tool sidecars and built-ins.
 * Agent/Skill callers use the same underlying service with an Agent principal;
 * a Skill is not allowed to impersonate its owning Plugin.
 */
export interface PluginCanvasCapabilityClient {
  getDocument(
    ref: PluginCanvasRef,
    projection?: PluginCanvasDocumentProjection,
    signal?: AbortSignal,
  ): Promise<PluginCanvasDocumentResult>
  listCanvases(projectId: string, signal?: AbortSignal): Promise<PluginCanvasCatalogResult>
  listProjects(signal?: AbortSignal): Promise<PluginProjectSummary[]>
  queryNodes(ref: PluginCanvasRef, query?: CanvasNodeQuery, signal?: AbortSignal): Promise<PluginCanvasNodeQueryResult>
  subscribe(
    ref: PluginCanvasRef | { projectId: string },
    listener: (event: PluginCanvasChangeEvent) => void,
    signal?: AbortSignal,
  ): Promise<PluginCanvasEventSubscription>
  transact(request: PluginCanvasTransactionRequest, signal?: AbortSignal): Promise<PluginCanvasTransactionResult>
}

export interface ResolvedPluginPrincipal {
  capabilities: readonly PluginCapability[]
  capabilityProtocol?: PluginCapabilityProtocol
  manifestDigest: string
  pluginId: string
  pluginVersion: string
}
