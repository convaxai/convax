import type { CanvasDocument, CanvasNode } from "@convax/canvas"
import type { WebPluginGenerationInputRole, WebPluginGenerationModality } from "./plugin-contracts"
import type { InstalledPlugin } from "./plugin-api"

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

export interface PluginProjectFileResult {
  dataUrl: string
  mimeType: string
  name: string
  path: string
  size: number
}

export interface PluginAgentPromptResult {
  text: string
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

export type PluginGenerationResultMode = "create-pending-node"

/** Product ports supplied by Desktop composition, independent of Plugin transport. */
export interface PluginCanvasHost {
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
      signal: AbortSignal
      text: string
    },
  ): Promise<PluginAgentPromptResult>
  readProjectText(input: { path: string; projectId: string; signal: AbortSignal }): Promise<PluginProjectTextResult>
  readManagedProjectImage(input: {
    path: string
    projectId: string
    signal: AbortSignal
  }): Promise<PluginProjectFileResult>
}

export interface PluginHostLimits {
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
  connectedImageReadGate: { active: boolean }
  frame: PluginNodeInvocationRef
  generationGate: { active: boolean }
  getActiveContext(): PluginCanvasActiveContext | null
  getConnectedImageNodes(): CanvasNode[]
  getDocument(): CanvasDocument | undefined
  getNode(): CanvasNode | undefined
  isCanvasWritable(): boolean
  limits?: PluginHostLimits
  ownsNode(node: CanvasNode): boolean
  plugin: InstalledPlugin
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
  promptAgent(
    input: PluginNodeInvocationRef & {
      pluginName: string
      signal: AbortSignal
      text: string
    },
  ): Promise<PluginAgentPromptResult>
  readProjectText(input: { path: string; projectId: string; signal: AbortSignal }): Promise<PluginProjectTextResult>
  readManagedProjectImage(input: {
    path: string
    projectId: string
    signal: AbortSignal
  }): Promise<PluginProjectFileResult>
  signal: AbortSignal
  updateNodeState(state: Record<string, unknown>): void
}

// Compatibility aliases retained while callers migrate away from Web-specific names.
export type WebPluginCanvasActiveContext = PluginCanvasActiveContext
export type WebPluginProjectTextResult = PluginProjectTextResult
export type WebPluginProjectFileResult = PluginProjectFileResult
export type WebPluginAgentPromptResult = PluginAgentPromptResult
export type WebPluginGenerationToolSummary = PluginGenerationToolSummary
export type WebPluginGenerationReference = PluginGenerationReference
export type WebPluginGenerationCanvasResult = PluginGenerationCanvasResult
export type WebPluginGenerationResultMode = PluginGenerationResultMode
export type WebPluginCanvasHost = PluginCanvasHost
export type WebPluginCanvasHostLimits = PluginHostLimits
export type WebPluginHostRequestContext = PluginHostRequestContext
