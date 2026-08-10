import type { BoundedOperationReceipt } from "@convax/canvas/collaboration"

/** Plugin API Catalog still documents the versioned receipt format constant. */
export type PluginApiOperationReceipt = Omit<BoundedOperationReceipt, "format"> & {
  readonly format: "convax.canvas-operation-receipt/2"
}
import type { CanvasNodeData, CanvasPoint } from "@convax/canvas/core"
import type { PluginApiCall, PluginApiGenerationReference, PluginApiId } from "@convax/plugin-api"
import type { PortablePluginLocale } from "@convax/plugin-sdk"

import type {
  PluginCanvasCapabilityClient,
  PluginCanvasChangeEvent,
  PluginPrincipal,
  PluginProjectScope,
  ResolvedPluginPrincipal,
} from "./plugin-capability-contracts"
import type {
  PluginAgentPromptResult,
  PluginCanvasImageResult,
  PluginConnectedInputDescriptor,
  PluginGenerationCanvasResult,
  PluginGenerationResultMode,
  PluginGenerationToolSummary,
  PluginProjectTextResult,
} from "./plugin-host-types"
import type { PluginConnectedMediaOpenResult } from "./plugin-connected-media-contracts"
import type { PluginConnectedImageOpenResult } from "./plugin-connected-image-contracts"
import type { WebPluginGenerationModality } from "./plugin-contracts"

export interface PluginHostContextNode {
  data: CanvasNodeData
  id: string
  parentId?: string
  position: CanvasPoint
  style?: Record<string, unknown>
  type: string
}

/** Exact node scope issued by Main when a Web Plugin frame connects. */
export interface PluginHostNodeBinding {
  canvasId: string
  nodeId: string
  projectId: string
}

export interface PluginHostTransportContext {
  frameId: string
  senderId: number
}

/**
 * Renderer-safe authoritative context. Implementations must derive this from
 * Main's live Project/Canvas services and recheck Plugin ownership.
 */
export interface PluginHostNodeContext {
  canvas: { id: string; name?: string }
  node: PluginHostContextNode
  project: { id: string; name?: string }
}

export interface PluginHostLiveState {
  disabled: boolean
  recovering: boolean
  setupComplete: boolean
}

export interface PluginHostResolvedPrincipal extends ResolvedPluginPrincipal {
  pluginName: string
}

/**
 * Main-private authority for reverse Host API calls made by one exact
 * Plugin-to-Plugin invocation. It is never accepted from Web, preload, or IPC.
 *
 * The lease owner retains the historical ActiveSet closure and must reject
 * `assertActive` after release or cancellation. The Host snapshots these
 * claims when connecting and passes them back on every dispatch so the lease
 * owner can compare them with its independently retained invocation.
 */
export interface PluginHostInvocationLeaseClaims {
  consumerPluginId: string
  operationId: string
  providerPluginId: string
}

export interface PluginHostInvocationLease {
  assertActive(claims: PluginHostInvocationLeaseClaims): Promise<void> | void
  readonly claims: PluginHostInvocationLeaseClaims
  readonly principal: PluginPrincipal
  readonly resolved: PluginHostResolvedPrincipal
  readonly signal: AbortSignal
}

export interface PluginHostPrincipalPort {
  liveState(principal: PluginPrincipal, signal?: AbortSignal): Promise<PluginHostLiveState>
  resolve(principal: PluginPrincipal, signal?: AbortSignal): Promise<PluginHostResolvedPrincipal | null>
}

export interface PluginHostNodeContextPort {
  resolve(input: {
    binding: PluginHostNodeBinding
    principal: PluginPrincipal
    signal?: AbortSignal
  }): Promise<PluginHostNodeContext | null>
}

/**
 * A mutation port must call `checkpoint` immediately before every irreversible
 * boundary. Preparation may happen first, but it must not publish a file,
 * persist Canvas state, or start an external/billable call before the check.
 */
export interface PluginHostMutationCheckpoint {
  checkpoint(): Promise<PluginHostNodeContext>
}

export interface PluginHostNodeOperationsPort {
  closeConnection(input: {
    binding?: PluginHostNodeBinding
    connectionId: string
    principal: PluginPrincipal
    transport?: PluginHostTransportContext
  }): void
  closeInput(input: {
    binding: PluginHostNodeBinding
    connectionId: string
    principal: PluginPrincipal
    sessionId: string
    signal?: AbortSignal
    transport: PluginHostTransportContext
  }): Promise<boolean>
  createCanvasImage(input: {
    binding: PluginHostNodeBinding
    checkpoint: PluginHostMutationCheckpoint
    dataUrl: string
    name: string
    operationId: string
    principal: PluginPrincipal
    signal?: AbortSignal
  }): Promise<PluginCanvasImageResult>
  executeGeneration(input: {
    binding: PluginHostNodeBinding
    checkpoint: PluginHostMutationCheckpoint
    output?: WebPluginGenerationModality
    operationId: string
    principal: PluginPrincipal
    prompt: string
    references?: readonly PluginApiGenerationReference[]
    resultMode?: PluginGenerationResultMode
    signal?: AbortSignal
    toolId?: string
  }): Promise<PluginGenerationCanvasResult>
  listGenerationTools(input: {
    binding: PluginHostNodeBinding
    output?: WebPluginGenerationModality
    principal: PluginPrincipal
    signal?: AbortSignal
  }): Promise<readonly PluginGenerationToolSummary[]>
  listInputs(input: {
    binding: PluginHostNodeBinding
    principal: PluginPrincipal
    signal?: AbortSignal
  }): Promise<readonly PluginConnectedInputDescriptor[]>
  openInput(input: {
    binding: PluginHostNodeBinding
    connectionId: string
    inputKey: string
    principal: PluginPrincipal
    signal?: AbortSignal
    transport: PluginHostTransportContext
  }): Promise<PluginConnectedMediaOpenResult>
  openImageInput(input: {
    binding: PluginHostNodeBinding
    connectionId: string
    inputKey: string
    principal: PluginPrincipal
    signal?: AbortSignal
    transport: PluginHostTransportContext
  }): Promise<PluginConnectedImageOpenResult>
  closeImageInput(input: {
    binding: PluginHostNodeBinding
    connectionId: string
    principal: PluginPrincipal
    sessionId: string
    signal?: AbortSignal
    transport: PluginHostTransportContext
  }): Promise<boolean>
  promptAgent(input: {
    binding: PluginHostNodeBinding
    checkpoint: PluginHostMutationCheckpoint
    principal: PluginPrincipal
    signal?: AbortSignal
    text: string
  }): Promise<PluginAgentPromptResult>
  readProjectText(input: {
    path: string
    principal: PluginPrincipal
    projectId: string
    signal?: AbortSignal
  }): Promise<PluginProjectTextResult>
  replaceNodeState(input: {
    binding: PluginHostNodeBinding
    checkpoint: PluginHostMutationCheckpoint
    operationId: string
    principal: PluginPrincipal
    signal?: AbortSignal
    state: Record<string, unknown>
  }): Promise<{
    operationReceipt: PluginApiOperationReceipt
    projection: PluginHostContextNode
    updated: true
  }>
}

export interface PluginHostApiConnectionRequest {
  canvas: PluginCanvasCapabilityClient
  /** Main-only historical authority; renderer and IPC contracts cannot supply it. */
  invocationLease?: PluginHostInvocationLease
  /** Renderer-owned presentation preference mirrored into this exact Web connection. */
  locale?: PortablePluginLocale
  node?: PluginHostNodeBinding
  onCanvasEvent?(input: { event: PluginCanvasChangeEvent; subscriptionId: string }): void
  principal: PluginPrincipal
  scope: PluginProjectScope
  transport?: PluginHostTransportContext
}

export type PluginHostApiMainCall = PluginApiCall

export interface PluginHostApiMainConnection {
  close(): void
  execute(call: PluginHostApiMainCall, context: { operationId: string; signal?: AbortSignal }): Promise<unknown>
  supports(method: PluginApiId): boolean
  updateLocale(locale: PortablePluginLocale): boolean
}
