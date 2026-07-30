import { createHash } from "node:crypto"

import type { AgentRuntime } from "@convax/agent-runtime"
import {
  createCanvasDocumentPatchCommand,
  type CanvasApplicationService,
  type CanvasDocumentClient,
} from "@convax/canvas/application"
import {
  getIncomingConnectedCanvasFileNodeIds,
  type CanvasDocument,
  type CanvasNode,
  type CanvasNodeData,
} from "@convax/canvas/core"
import type { ProjectCanvasClient } from "@convax/project/canvas"
import type { ProjectRecord } from "@convax/project/contracts"

import {
  GenerationPublicationPartialSuccessError,
  GenerationResourceUnavailableError,
  type GenerationCanvasService,
} from "./generation-canvas-service"
import {
  PluginCanvasImagePublicationPartialSuccessError,
  type PluginCanvasImageService,
} from "./plugin-canvas-image-service"
import type { PluginConnectedMediaService } from "./plugin-connected-media-service"
import { matchesWebPluginCanvasNodeIdentity, webPluginStateMetadataKey } from "../plugin-canvas-node"
import type {
  PluginHostNodeBinding,
  PluginHostNodeContext,
  PluginHostNodeContextPort,
  PluginHostNodeOperationsPort,
} from "../plugin-host-api-main-contracts"
import type { PluginPrincipal } from "../plugin-capability-contracts"
import type { PluginConnectedInputDescriptor, PluginGenerationReference } from "../plugin-host-types"
import type { WebPluginGenerationInputRole } from "../plugin-contracts"
import {
  PluginHostApiError,
  PluginHostApiPartialSuccessError,
  PluginHostApiResourceUnavailableError,
} from "../plugin-host-errors"

interface PluginHostProjectPort {
  list(): Promise<readonly ProjectRecord[]>
  readTextFile(input: { path: string; projectId: string }): Promise<{
    content: string
    exists: boolean
    path: string
  }>
  resolveEntryPath(input: { projectId: string }): Promise<string>
}

export interface PluginHostApiMainAdapterOptions {
  agent: Pick<AgentRuntime, "abort" | "createSession" | "prompt">
  application: Pick<CanvasApplicationService, "execute">
  canvases: Pick<ProjectCanvasClient, "getCanvasCatalog">
  documents: Pick<CanvasDocumentClient, "load">
  generation: Pick<GenerationCanvasService, "generate" | "listTools">
  images: Pick<PluginCanvasImageService, "createForHostApi">
  media: Pick<PluginConnectedMediaService, "close" | "closeImage" | "open" | "openImage" | "revokeFrame">
  projects: PluginHostProjectPort
}

/**
 * Main-owned adapter from the Host API Catalog to authoritative domain ports.
 * It does not trust renderer state and never returns native paths.
 */
export class PluginHostApiMainAdapter implements PluginHostNodeContextPort, PluginHostNodeOperationsPort {
  constructor(private readonly options: PluginHostApiMainAdapterOptions) {}

  async resolve(input: {
    binding: PluginHostNodeBinding
    principal: Parameters<PluginHostNodeContextPort["resolve"]>[0]["principal"]
    signal?: AbortSignal
  }): Promise<PluginHostNodeContext | null> {
    throwIfAborted(input.signal)
    const [{ document }, projects, catalog] = await Promise.all([
      this.options.documents.load({
        canvasId: input.binding.canvasId,
        scopeId: input.binding.projectId,
      }),
      this.options.projects.list(),
      this.options.canvases.getCanvasCatalog({ projectId: input.binding.projectId }),
    ])
    throwIfAborted(input.signal)
    if (!document || document.id !== input.binding.canvasId) return null
    const project = projects.find((candidate) => candidate.id === input.binding.projectId && !candidate.missing)
    const canvas = catalog.canvases.find((candidate) => candidate.id === input.binding.canvasId)
    const node = document.nodes.find((candidate) => candidate.id === input.binding.nodeId)
    if (!project || !canvas || !node || !matchesWebPluginCanvasNodeIdentity(input.principal.pluginId, node.data)) {
      return null
    }
    return {
      canvas: { id: canvas.id, name: canvas.name },
      documentRevision: document.revision,
      node: rendererSafeNode(node),
      project: { id: project.id, name: project.name },
    }
  }

  closeConnection(input: Parameters<PluginHostNodeOperationsPort["closeConnection"]>[0]) {
    if (!input.binding || !input.transport) return
    this.options.media.revokeFrame(
      mediaFrame(input.binding, input.principal, input.transport.frameId),
      input.transport.senderId,
    )
  }

  async closeInput(input: Parameters<PluginHostNodeOperationsPort["closeInput"]>[0]) {
    throwIfAborted(input.signal)
    return this.options.media.close(
      {
        ...mediaFrame(input.binding, input.principal, input.transport.frameId),
        sessionId: input.sessionId,
      },
      input.transport.senderId,
    )
  }

  createCanvasImage(input: Parameters<PluginHostNodeOperationsPort["createCanvasImage"]>[0]) {
    return this.options.images.createForHostApi(input, input.signal).catch((error: unknown) => {
      if (error instanceof PluginCanvasImagePublicationPartialSuccessError) {
        throw new PluginHostApiPartialSuccessError("Plugin Canvas image publication partially succeeded", {
          cause: error,
        })
      }
      throw error
    })
  }

  async executeGeneration(input: Parameters<PluginHostNodeOperationsPort["executeGeneration"]>[0]) {
    const context = await input.checkpoint.checkpoint()
    const snapshot = await this.loadDocument(input.binding, input.signal)
    if (snapshot.revision !== context.documentRevision) {
      throw new PluginHostApiError("stale-context", "Canvas changed during generation preparation")
    }
    const owner = requireOwnedNode(snapshot, input.binding, input.principal.pluginId)
    const references = generationReferences(snapshot, input.binding.nodeId, input.references)
    return this.options.generation
      .generate(
        {
          anchor: nodeOutputAnchor(owner),
          expectedRevision: snapshot.revision,
          operationId: input.operationId,
          ...(input.output ? { output: input.output } : {}),
          prompt: input.prompt,
          ref: { canvasId: input.binding.canvasId, scopeId: input.binding.projectId },
          referenceConstraint: {
            ownerNodeId: input.binding.nodeId,
            ownerPluginId: input.principal.pluginId,
            type: "direct-incoming",
          },
          references,
          resultMode: { type: input.resultMode ?? "create-pending-node" },
          ...(input.toolId ? { toolId: input.toolId } : {}),
        },
        { id: input.principal.pluginId, kind: "plugin" },
        input.signal,
        { beforeExternalCall: () => input.checkpoint.checkpoint().then(() => undefined) },
      )
      .catch((error: unknown) => {
        if (error instanceof GenerationPublicationPartialSuccessError) {
          throw new PluginHostApiPartialSuccessError("Plugin generation publication partially succeeded", {
            cause: error,
          })
        }
        if (error instanceof GenerationResourceUnavailableError) {
          throw new PluginHostApiResourceUnavailableError("Plugin generation resource is unavailable", {
            cause: error,
          })
        }
        throw error
      })
  }

  async listGenerationTools(input: Parameters<PluginHostNodeOperationsPort["listGenerationTools"]>[0]) {
    throwIfAborted(input.signal)
    const tools = await this.options.generation.listTools(input.output ? { output: input.output } : {})
    throwIfAborted(input.signal)
    return tools.map((tool) => ({
      acceptedInputs: tool.acceptedInputs,
      description: tool.description,
      id: tool.id,
      kind: tool.kind,
      output: tool.output,
      title: tool.title,
    }))
  }

  async listInputs(input: Parameters<PluginHostNodeOperationsPort["listInputs"]>[0]) {
    const document = await this.loadDocument(input.binding, input.signal)
    requireOwnedNode(document, input.binding, input.principal.pluginId)
    const byId = new Map(document.nodes.map((node) => [node.id, node]))
    return Promise.all(
      getIncomingConnectedCanvasFileNodeIds(document, input.binding.nodeId).flatMap((nodeId) => {
        const node = byId.get(nodeId)
        return node ? [connectedInputDescriptor(node)] : []
      }),
    )
  }

  async openInput(input: Parameters<PluginHostNodeOperationsPort["openInput"]>[0]) {
    const context = await this.resolve({
      binding: input.binding,
      principal: input.principal,
      signal: input.signal,
    })
    if (!context) {
      throw new PluginHostApiError("stale-context", "Plugin input owner is no longer current")
    }
    return this.options.media.open(
      {
        ...mediaFrame(input.binding, input.principal, input.transport.frameId),
        expectedRevision: context.documentRevision,
        sourceNodeId: input.inputKey,
      },
      input.transport.senderId,
    )
  }

  async openImageInput(input: Parameters<PluginHostNodeOperationsPort["openImageInput"]>[0]) {
    const context = await this.resolve({
      binding: input.binding,
      principal: input.principal,
      signal: input.signal,
    })
    if (!context) {
      throw new PluginHostApiError("stale-context", "Plugin image input owner is no longer current")
    }
    return this.options.media.openImage(
      {
        ...mediaFrame(input.binding, input.principal, input.transport.frameId),
        expectedRevision: context.documentRevision,
        sourceNodeId: input.inputKey,
      },
      input.transport.senderId,
      input.signal,
    )
  }

  async closeImageInput(input: Parameters<PluginHostNodeOperationsPort["closeImageInput"]>[0]) {
    throwIfAborted(input.signal)
    return this.options.media.closeImage(
      {
        ...mediaFrame(input.binding, input.principal, input.transport.frameId),
        sessionId: input.sessionId,
      },
      input.transport.senderId,
    )
  }

  async promptAgent(input: Parameters<PluginHostNodeOperationsPort["promptAgent"]>[0]) {
    await input.checkpoint.checkpoint()
    throwIfAborted(input.signal)
    const directory = await this.options.projects.resolveEntryPath({ projectId: input.binding.projectId })
    const session = await this.options.agent.createSession({
      directory,
      title: `Plugin: ${input.principal.pluginId}`,
    })
    const abort = () => {
      void this.options.agent.abort({ directory, sessionId: session.id }).catch(() => undefined)
    }
    input.signal?.addEventListener("abort", abort, { once: true })
    try {
      await input.checkpoint.checkpoint()
      throwIfAborted(input.signal)
      const message = await this.options.agent.prompt({
        directory,
        instructions: [
          `A sandboxed Convax Plugin ${JSON.stringify(input.principal.pluginId)} requested this response.`,
          `Keep every tool call in Project ${JSON.stringify(input.binding.projectId)} and Canvas ${JSON.stringify(input.binding.canvasId)}.`,
        ],
        scopeId: input.binding.projectId,
        sessionId: session.id,
        text: input.text,
      })
      throwIfAborted(input.signal)
      if (message.error) throw new Error(message.error)
      return {
        text: message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n\n"),
      }
    } finally {
      input.signal?.removeEventListener("abort", abort)
    }
  }

  async readProjectText(input: Parameters<PluginHostNodeOperationsPort["readProjectText"]>[0]) {
    throwIfAborted(input.signal)
    const result = await this.options.projects.readTextFile({
      path: input.path,
      projectId: input.projectId,
    })
    throwIfAborted(input.signal)
    return result
  }

  async replaceNodeState(input: Parameters<PluginHostNodeOperationsPort["replaceNodeState"]>[0]) {
    const context = await input.checkpoint.checkpoint()
    const document = await this.loadDocument(input.binding, input.signal)
    if (document.revision !== context.documentRevision) {
      throw new PluginHostApiError("stale-context", "Canvas changed during Plugin state preparation")
    }
    requireOwnedNode(document, input.binding, input.principal.pluginId)
    const next: CanvasDocument = {
      ...document,
      nodes: document.nodes.map((node) =>
        node.id !== input.binding.nodeId
          ? node
          : {
              ...node,
              data: {
                ...node.data,
                metadata: {
                  ...metadata(node.data),
                  [webPluginStateMetadataKey]: structuredClone(input.state),
                },
              },
            },
      ),
    }
    await this.options.application.execute({
      beforeCommit: () => input.checkpoint.checkpoint().then(() => undefined),
      canvasId: input.binding.canvasId,
      envelope: {
        actor: { id: input.principal.pluginId, kind: "plugin" },
        command: createCanvasDocumentPatchCommand(document, next),
        commandId: `plugin-state:${input.operationId}`,
        expectedRevision: document.revision,
      },
      scopeId: input.binding.projectId,
      ...(input.signal ? { signal: input.signal } : {}),
    })
  }

  private async loadDocument(binding: PluginHostNodeBinding, signal?: AbortSignal) {
    throwIfAborted(signal)
    const { document } = await this.options.documents.load({
      canvasId: binding.canvasId,
      scopeId: binding.projectId,
    })
    throwIfAborted(signal)
    if (!document || document.id !== binding.canvasId) {
      throw new PluginHostApiError("stale-context", "Plugin Canvas was not found")
    }
    return document
  }
}

function rendererSafeNode(node: CanvasNode) {
  return {
    data: structuredClone(node.data),
    id: node.id,
    ...(node.parentId ? { parentId: node.parentId } : {}),
    position: structuredClone(node.position),
    ...(node.style ? { style: structuredClone(node.style) as Record<string, unknown> } : {}),
    type: node.type,
  }
}

function metadata(data: CanvasNodeData) {
  return data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata : {}
}

function requireOwnedNode(document: CanvasDocument, binding: PluginHostNodeBinding, pluginId: string) {
  const node = document.nodes.find((candidate) => candidate.id === binding.nodeId)
  if (!node || !matchesWebPluginCanvasNodeIdentity(pluginId, node.data)) {
    throw new PluginHostApiError("stale-context", "Plugin no longer owns its Canvas node")
  }
  return node
}

function mediaFrame(
  binding: PluginHostNodeBinding,
  principal: Pick<PluginPrincipal, "pluginId" | "pluginVersion">,
  frameId: string,
) {
  return {
    canvasId: binding.canvasId,
    frameId,
    nodeId: binding.nodeId,
    pluginId: principal.pluginId,
    pluginVersion: principal.pluginVersion,
    projectId: binding.projectId,
  }
}

function nodeOutputAnchor(node: CanvasNode) {
  const width =
    [node.measured?.width, node.width, node.style?.width].find(
      (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0,
    ) ?? 320
  return { x: node.position.x + width + 64, y: node.position.y }
}

function generationRole(node: CanvasNode): WebPluginGenerationInputRole | undefined {
  if (node.data.kind === "text") return "text"
  if (node.data.kind === "image") return "reference_image"
  if (node.data.kind === "video") return "reference_video"
  if (node.data.kind === "audio") return "audio"
  return undefined
}

function generationReferences(
  document: CanvasDocument,
  ownerNodeId: string,
  requested?: readonly PluginGenerationReference[],
) {
  const byId = new Map(document.nodes.map((node) => [node.id, node]))
  const incoming = new Set(getIncomingConnectedCanvasFileNodeIds(document, ownerNodeId))
  if (!requested) {
    return [...incoming].flatMap((nodeId) => {
      const node = byId.get(nodeId)
      const role = node && generationRole(node)
      return role ? [{ nodeId, role }] : []
    })
  }
  return requested.map((reference) => {
    const node = byId.get(reference.nodeId)
    if (!node || !incoming.has(reference.nodeId)) {
      throw new Error("Generation references must be direct incoming Canvas file nodes")
    }
    const expectedKind =
      reference.role === "text"
        ? "text"
        : reference.role === "reference_video"
          ? "video"
          : reference.role === "audio"
            ? "audio"
            : "image"
    if (node.data.kind !== expectedKind) {
      throw new Error(`Generation role ${reference.role} requires an incoming ${expectedKind} node`)
    }
    return structuredClone(reference)
  })
}

async function connectedInputDescriptor(node: CanvasNode): Promise<PluginConnectedInputDescriptor> {
  const data = node.data
  const dimension = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
  const text = (value: unknown, maximum: number) =>
    typeof value === "string" && value && value === value.trim() && value.length <= maximum ? value : undefined
  const mediaRevision = createHash("sha256")
    .update(
      JSON.stringify([
        data.kind,
        data.label,
        data.name,
        data.mimeType,
        data.status,
        data.width,
        data.height,
        data.durationMs,
        metadata(data),
      ]),
    )
    .digest("hex")
  return {
    ...(dimension(data.durationMs) === undefined ? {} : { durationMs: dimension(data.durationMs) }),
    ...(dimension(data.height) === undefined ? {} : { height: dimension(data.height) }),
    id: node.id,
    kind: text(data.kind, 80) ?? "file",
    label: text(data.label, 512) ?? "Untitled",
    mediaRevision,
    ...(text(data.mimeType, 256) ? { mimeType: text(data.mimeType, 256) } : {}),
    ...(text(data.name, 512) ? { name: text(data.name, 512) } : {}),
    ...(data.status === "idle" || data.status === "pending" || data.status === "error" ? { status: data.status } : {}),
    ...(dimension(data.width) === undefined ? {} : { width: dimension(data.width) }),
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException("Plugin Host API operation was canceled", "AbortError")
}
