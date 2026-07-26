import type { CanvasDocument, CanvasNode } from "@convax/canvas"
import type { WebPluginGenerationInputRole, WebPluginGenerationModality } from "./plugin-contracts"
import type { InstalledPlugin } from "./plugin-api"
import type { PluginConnectedMediaOpenResult } from "./plugin-connected-media-contracts"

/** Transport-neutral identity attached to one legacy node-scoped Plugin invocation. */
export interface PluginNodeInvocationRef {
  canvasId: string
  nodeId: string
  pluginId: string
  projectId: string
}

export interface PluginCanvasActiveContext {
  canvasId: string
  canvasName?: string
  projectId: string
  projectName?: string
}

export interface PluginProjectTextResult {
  content: string
  exists: boolean
  path: string
}

export interface PluginConnectedImageResult {
  dataUrl: string
  mimeType: string
  name: string
  size: number
}

export interface PluginAgentPromptResult {
  text: string
}

/** Pathless metadata for one direct incoming Canvas file node. */
export interface PluginConnectedInputDescriptor {
  durationMs?: number
  height?: number
  id: string
  kind: string
  label: string
  mediaRevision?: string
  mimeType?: string
  name?: string
  status?: "error" | "idle" | "pending"
  width?: number
}

export interface PluginGenerationToolSummary {
  acceptedInputs: readonly WebPluginGenerationInputRole[]
  description: string
  id: string
  kind: "model" | "operation"
  output: WebPluginGenerationModality
  title: string
}

export interface PluginGenerationReference {
  nodeId: string
  role: WebPluginGenerationInputRole
}

export interface PluginGenerationCanvasResult {
  createdNodeIds: readonly string[]
  revision: number
  toolId: string
  warnings: readonly string[]
}

export interface PluginCanvasImageResult {
  createdNodeId: string
  revision: number
}

export type PluginGenerationResultMode = "create-pending-node"

/** Product ports supplied by Desktop composition, independent of Plugin transport. */
export interface PluginCanvasHost {
  createCanvasImage(
    input: PluginNodeInvocationRef & {
      dataUrl: string
      name: string
      pluginVersion: string
      signal: AbortSignal
    },
  ): Promise<PluginCanvasImageResult>
  executeCanvasGeneration(
    input: PluginNodeInvocationRef & {
      anchor: { x: number; y: number }
      output?: WebPluginGenerationModality
      prompt: string
      references: readonly PluginGenerationReference[]
      resultMode?: PluginGenerationResultMode
      signal: AbortSignal
      toolId?: string
    },
  ): Promise<PluginGenerationCanvasResult>
  getActiveContext(): PluginCanvasActiveContext | null
  listGenerationTools(
    input: PluginNodeInvocationRef & {
      output?: WebPluginGenerationModality
      signal: AbortSignal
    },
  ): Promise<readonly PluginGenerationToolSummary[]>
  promptAgent(
    input: PluginNodeInvocationRef & {
      pluginName: string
      skillName?: string
      signal: AbortSignal
      text: string
    },
  ): Promise<PluginAgentPromptResult>
  readProjectText(input: { path: string; projectId: string; signal: AbortSignal }): Promise<PluginProjectTextResult>
  readConnectedImage(input: {
    canvasId: string
    expectedRevision: number
    nodeId: string
    ownerNodeId: string
    projectId: string
    signal: AbortSignal
  }): Promise<PluginConnectedImageResult>
  waitForGenerationProjection(input: PluginNodeInvocationRef & { signal: AbortSignal }): Promise<void>
}

export interface PluginHostLimits {
  canvasImageRequestBytes?: number
  connectedImageResponseBytes?: number
  requestBytes?: number
  responseBytes?: number
  stateBytes?: number
}

/**
 * A resolved capability invocation. Web frames, trusted adapters, and future
 * transports provide this context; capability handlers do not know the transport.
 */
export interface PluginHostRequestContext {
  canvasImageWriteGate: { active: boolean }
  connectedImageReadGate: { active: boolean }
  connectedMediaOpenGate: { active: boolean }
  frame: PluginNodeInvocationRef
  generationGate: { active: boolean }
  nodeStateWriteGate: { active: boolean }
  getActiveContext(): PluginCanvasActiveContext | null
  getConnectedImageNodes(): CanvasNode[]
  getConnectedInputNodes(): CanvasNode[]
  getDocument(): CanvasDocument | undefined
  getNode(): CanvasNode | undefined
  isCanvasWritable(): boolean
  limits?: PluginHostLimits
  ownsNode(node: CanvasNode): boolean
  plugin: InstalledPlugin
  createCanvasImage(
    input: PluginNodeInvocationRef & {
      dataUrl: string
      name: string
      pluginVersion: string
      signal: AbortSignal
    },
  ): Promise<PluginCanvasImageResult>
  executeCanvasGeneration(
    input: PluginNodeInvocationRef & {
      anchor: { x: number; y: number }
      output?: WebPluginGenerationModality
      prompt: string
      references: readonly PluginGenerationReference[]
      resultMode?: PluginGenerationResultMode
      signal: AbortSignal
      toolId?: string
    },
  ): Promise<PluginGenerationCanvasResult>
  listGenerationTools(
    input: PluginNodeInvocationRef & {
      output?: WebPluginGenerationModality
      signal: AbortSignal
    },
  ): Promise<readonly PluginGenerationToolSummary[]>
  openConnectedMedia(
    input: PluginNodeInvocationRef & {
      expectedRevision: number
      pluginVersion: string
      signal: AbortSignal
      sourceNodeId: string
    },
  ): Promise<PluginConnectedMediaOpenResult>
  closeConnectedMedia(input: { sessionId: string; signal: AbortSignal }): Promise<boolean>
  promptAgent(
    input: PluginNodeInvocationRef & {
      pluginName: string
      skillName?: string
      signal: AbortSignal
      text: string
    },
  ): Promise<PluginAgentPromptResult>
  readProjectText(input: { path: string; projectId: string; signal: AbortSignal }): Promise<PluginProjectTextResult>
  readConnectedImage(input: {
    canvasId: string
    expectedRevision: number
    nodeId: string
    ownerNodeId: string
    projectId: string
    signal: AbortSignal
  }): Promise<PluginConnectedImageResult>
  signal: AbortSignal
  updateNodeState(state: Record<string, unknown>): Promise<void>
}

// Compatibility aliases retained while callers migrate away from Web-specific names.
export type WebPluginCanvasActiveContext = PluginCanvasActiveContext
export type WebPluginProjectTextResult = PluginProjectTextResult
export type WebPluginConnectedImageResult = PluginConnectedImageResult
export type WebPluginAgentPromptResult = PluginAgentPromptResult
export type WebPluginGenerationToolSummary = PluginGenerationToolSummary
export type WebPluginGenerationReference = PluginGenerationReference
export type WebPluginGenerationCanvasResult = PluginGenerationCanvasResult
export type WebPluginGenerationResultMode = PluginGenerationResultMode
export type WebPluginCanvasHost = PluginCanvasHost
export type WebPluginCanvasHostLimits = PluginHostLimits
export type WebPluginHostRequestContext = PluginHostRequestContext
