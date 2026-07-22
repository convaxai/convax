import type {
  CanvasApplicationService,
  CanvasDocumentClient,
  CanvasDocumentRef,
  CanvasNodeQuery,
} from "@convax/canvas/application"
import { getCanvasNodeSize } from "@convax/canvas/core"
import { getProjectFileReference, type ProjectCanvasClient } from "@convax/project/canvas"
import type { ProjectRecord } from "@convax/project/contracts"

import type {
  PluginCanvasCapabilityClient,
  PluginCanvasChangeEvent,
  PluginCanvasDocumentProjection,
  PluginCanvasDocumentResult,
  PluginCanvasEventSubscription,
  PluginCanvasRef,
  PluginCanvasTransactionRequest,
  PluginCanvasTransactionResult,
  PluginCapabilityConnectionRequest,
  PluginPrincipal,
  PluginProjectScope,
  PluginProjectSummary,
  ResolvedPluginPrincipal,
} from "../plugin-capability-contracts"
import type { PluginCapability } from "../plugin-api"

type CanvasApplicationPort = Pick<CanvasApplicationService, "executeTransaction" | "query">
type ProjectCanvasPort = Pick<ProjectCanvasClient, "getCanvasCatalog">

export interface PluginPrincipalResolver {
  resolve(principal: PluginPrincipal): Promise<ResolvedPluginPrincipal | null>
}

export interface PluginProjectCatalogPort {
  list(): Promise<readonly ProjectRecord[]>
}

export interface PluginCanvasChangeBus {
  publish(event: PluginCanvasChangeEvent): void
  subscribe(
    filter: PluginCanvasRef | { projectId: string },
    listener: (event: PluginCanvasChangeEvent) => void,
  ): PluginCanvasEventSubscription
}

export interface PluginCanvasCapabilityServiceOptions {
  application: CanvasApplicationPort
  canvases: ProjectCanvasPort
  changes: PluginCanvasChangeBus
  documents: CanvasDocumentClient
  maximumDocumentBytes?: number
  maximumRequestBytes?: number
  maximumTransactionCommands?: number
  plugins: PluginPrincipalResolver
  projects: PluginProjectCatalogPort
}

const defaultMaximumDocumentBytes = 8 * 1024 * 1024
const defaultMaximumRequestBytes = 1024 * 1024
const defaultMaximumTransactionCommands = 256

export class PluginConnectionInvalidError extends Error {
  constructor(pluginId: string) {
    super(`Plugin capability connection is no longer valid: ${pluginId}`)
    this.name = "PluginConnectionInvalidError"
  }
}

export class PluginCapabilityDeniedError extends Error {
  constructor(capability: PluginCapability) {
    super(`Plugin capability is not granted: ${capability}`)
    this.name = "PluginCapabilityDeniedError"
  }
}

export class PluginProjectScopeError extends Error {
  constructor(projectId: string) {
    super(`Plugin connection cannot access Project: ${projectId}`)
    this.name = "PluginProjectScopeError"
  }
}

/**
 * Main-owned, transport-neutral broker. Every returned client is permanently
 * bound to one immutable Plugin principal and one host-authorized Project
 * scope. Web frames, Tool sidecars and built-ins all adapt to this same client.
 */
export class PluginCanvasCapabilityService {
  private readonly maximumDocumentBytes: number
  private readonly maximumRequestBytes: number
  private readonly maximumTransactionCommands: number

  constructor(private readonly options: PluginCanvasCapabilityServiceOptions) {
    this.maximumDocumentBytes = positiveLimit(
      options.maximumDocumentBytes,
      defaultMaximumDocumentBytes,
      "Plugin Canvas document byte limit",
    )
    this.maximumRequestBytes = positiveLimit(
      options.maximumRequestBytes,
      defaultMaximumRequestBytes,
      "Plugin Canvas request byte limit",
    )
    this.maximumTransactionCommands = positiveLimit(
      options.maximumTransactionCommands,
      defaultMaximumTransactionCommands,
      "Plugin Canvas transaction command limit",
    )
  }

  async connect(request: PluginCapabilityConnectionRequest): Promise<PluginCanvasCapabilityClient> {
    const principal = Object.freeze({ ...request.principal })
    const scope = freezeScope(request.scope)
    const installed = await this.requirePrincipal(principal)
    if (scope.kind === "all-bound-projects") requireCapability(installed, "projects.read")
    return {
      getDocument: (ref, projection, signal) => this.getDocument(principal, scope, ref, projection, signal),
      listCanvases: (projectId, signal) => this.listCanvases(principal, scope, projectId, signal),
      listProjects: (signal) => this.listProjects(principal, scope, signal),
      queryNodes: (ref, query, signal) => this.queryNodes(principal, scope, ref, query, signal),
      subscribe: (filter, listener, signal) => this.subscribe(principal, scope, filter, listener, signal),
      transact: (transaction, signal) => this.transact(principal, scope, transaction, signal),
    }
  }

  private async listProjects(
    principal: PluginPrincipal,
    scope: PluginProjectScope,
    signal?: AbortSignal,
  ): Promise<PluginProjectSummary[]> {
    const installed = await this.requirePrincipal(principal, signal)
    requireCapability(installed, "projects.read")
    if (scope.kind !== "all-bound-projects") throw new PluginProjectScopeError(scope.projectId)
    throwIfAborted(signal)
    const projects = await this.options.projects.list()
    throwIfAborted(signal)
    return projects.map(projectSummary)
  }

  private async listCanvases(
    principal: PluginPrincipal,
    scope: PluginProjectScope,
    projectId: string,
    signal?: AbortSignal,
  ) {
    const installed = await this.requirePrincipal(principal, signal)
    requireCapability(installed, "canvas.catalog.read")
    await this.requireProject(scope, projectId, signal)
    throwIfAborted(signal)
    const catalog = await this.options.canvases.getCanvasCatalog({ projectId })
    throwIfAborted(signal)
    return {
      canvases: catalog.canvases.map((canvas) => ({ ...canvas })),
      projectId,
    }
  }

  private async getDocument(
    principal: PluginPrincipal,
    scope: PluginProjectScope,
    inputRef: PluginCanvasRef,
    projection: PluginCanvasDocumentProjection = "geometry",
    signal?: AbortSignal,
  ): Promise<PluginCanvasDocumentResult> {
    const installed = await this.requirePrincipal(principal, signal)
    requireCapability(installed, "canvas.document.read")
    await this.requireCanvas(scope, inputRef, signal)
    if (projection !== "geometry" && projection !== "structure") {
      throw new Error("Unsupported Canvas document projection")
    }
    {
        throwIfAborted(signal)
        await this.requirePrincipal(principal, signal)
        const currentRef = await this.requireCanvas(scope, inputRef, signal)
        throwIfAborted(signal)
        const snapshot = await this.options.documents.load(currentRef)
        throwIfAborted(signal)
        if (!snapshot.document) throw new Error(`Canvas document was not found: ${currentRef.canvasId}`)
        const publicRef = { ...inputRef }
        const geometryNodes = snapshot.document.nodes.map((node) => ({
          id: node.id,
          kind: node.data.kind,
          label: node.data.label,
          ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
          position: { ...node.position },
          size: getCanvasNodeSize(node),
          ...(node.type === undefined ? {} : { type: node.type }),
        }))
        const result: PluginCanvasDocumentResult =
          projection === "structure"
            ? {
                document: {
                  ...(snapshot.document.metadata.description === undefined
                    ? {}
                    : { description: snapshot.document.metadata.description }),
                  edges: snapshot.document.edges.map(({ id, source, target }) => ({ id, source, target })),
                  id: snapshot.document.id,
                  nodes: snapshot.document.nodes.map((node, index) => {
                    const reference = getProjectFileReference(node.data.metadata)
                    return {
                      ...geometryNodes[index]!,
                      ...(typeof node.data.description === "string" ? { description: node.data.description } : {}),
                      ...(typeof node.data.durationMs === "number" ? { durationMs: node.data.durationMs } : {}),
                      ...(typeof node.data.mimeType === "string" ? { mimeType: node.data.mimeType } : {}),
                      ...(typeof node.data.name === "string" ? { name: node.data.name } : {}),
                      ...(reference ? { resource: { kind: "project-file" as const, path: reference.path } } : {}),
                      ...(typeof node.data.status === "string" ? { status: node.data.status } : {}),
                      ...(typeof node.data.text === "string" ? { text: node.data.text } : {}),
                    }
                  }),
                  revision: snapshot.document.revision,
                  ...(snapshot.document.metadata.tags === undefined
                    ? {}
                    : { tags: [...snapshot.document.metadata.tags] }),
                  title: snapshot.document.metadata.title,
                },
                projection,
                ref: publicRef,
                storageVersion: snapshot.storageVersion,
              }
            : {
                document: {
                  edges: snapshot.document.edges.map(({ id, source, target }) => ({ id, source, target })),
                  id: snapshot.document.id,
                  nodes: geometryNodes,
                  revision: snapshot.document.revision,
                  title: snapshot.document.metadata.title,
                },
                projection,
                ref: publicRef,
                storageVersion: snapshot.storageVersion,
              }
        assertSerializedSize(result, this.maximumDocumentBytes, "Plugin Canvas document response")
        throwIfAborted(signal)
        return result
    }
  }

  private async queryNodes(
    principal: PluginPrincipal,
    scope: PluginProjectScope,
    inputRef: PluginCanvasRef,
    query: CanvasNodeQuery = {},
    signal?: AbortSignal,
  ) {
    const installed = await this.requirePrincipal(principal, signal)
    requireCapability(installed, "canvas.document.read")
    assertSerializedSize(query, this.maximumRequestBytes, "Plugin Canvas node query")
    await this.requireCanvas(scope, inputRef, signal)
    {
        throwIfAborted(signal)
        await this.requirePrincipal(principal, signal)
        const currentRef = await this.requireCanvas(scope, inputRef, signal)
        throwIfAborted(signal)
        const result = await this.options.application.query(currentRef, query)
        throwIfAborted(signal)
        const response = { ...result, ref: { ...inputRef } }
        assertSerializedSize(response, this.maximumDocumentBytes, "Plugin Canvas node query response")
        return response
    }
  }

  private async transact(
    principal: PluginPrincipal,
    scope: PluginProjectScope,
    request: PluginCanvasTransactionRequest,
    signal?: AbortSignal,
  ): Promise<PluginCanvasTransactionResult> {
    const installed = await this.requirePrincipal(principal, signal)
    requireCapability(installed, "canvas.document.write")
    assertSerializedSize(request, this.maximumRequestBytes, "Plugin Canvas transaction")
    if (!request.transactionId.trim() || request.transactionId.length > 128) {
      throw new Error("Plugin Canvas transaction id must contain 1-128 characters")
    }
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
      throw new Error("Plugin Canvas expected revision must be a non-negative integer")
    }
    if (request.commands.length > this.maximumTransactionCommands) {
      throw new Error(`Plugin Canvas transaction exceeds ${this.maximumTransactionCommands} commands`)
    }
    if (request.commands.length === 0) {
      throw new Error("Plugin Canvas transaction must contain at least one command")
    }
    for (const command of request.commands) {
      const commandType = (command as { type?: unknown }).type
      if (
        commandType === "document.patch" ||
        commandType === "resources.add" ||
        commandType === "resources.replace"
      ) {
        throw new Error("Plugin Canvas document transactions cannot mutate resource references")
      }
    }
    await this.requireCanvas(scope, request.ref, signal)
    {
        throwIfAborted(signal)
        // Revalidate immediately before applying anything durable.
        await this.requirePrincipal(principal, signal)
        const currentRef = await this.requireCanvas(scope, request.ref, signal)
        throwIfAborted(signal)
        const result = await this.options.application.executeTransaction({
          ...currentRef,
          envelope: {
            actor: { id: principal.pluginId, kind: "plugin" },
            commands: structuredClone(request.commands),
            expectedRevision: request.expectedRevision,
            transactionId: request.transactionId,
          },
          ...(signal === undefined ? {} : { signal }),
        })
        // Canvas owns the irreversible boundary and checks the signal before
        // persistence. Once it resolves, keep the durable commit authoritative
        // even if transport cancellation races with the completed save.
        const event = {
          ref: { ...request.ref },
          revision: result.document.revision,
          source: "plugin" as const,
        }
        if (result.changed) {
          try {
            this.options.changes.publish(event)
          } catch {
            // Revision invalidation is advisory and cannot turn a committed
            // Canvas transaction into a failed mutation.
          }
        }
        return {
          affectedNodeIds: [...result.affectedNodeIds],
          changed: result.changed,
          createdNodeIds: [...result.createdNodeIds],
          ref: { ...request.ref },
          revision: result.document.revision,
          storageVersion: result.storageVersion,
          warnings: [...result.warnings],
        }
    }
  }

  private async subscribe(
    principal: PluginPrincipal,
    scope: PluginProjectScope,
    filter: PluginCanvasRef | { projectId: string },
    listener: (event: PluginCanvasChangeEvent) => void,
    signal?: AbortSignal,
  ) {
    const installed = await this.requirePrincipal(principal, signal)
    requireCapability(installed, "canvas.events.subscribe")
    if ("canvasId" in filter) await this.requireCanvas(scope, filter, signal)
    else await this.requireProject(scope, filter.projectId, signal)
    throwIfAborted(signal)
    let closed = false
    let underlying: PluginCanvasEventSubscription
    let deliveryTail = Promise.resolve()
    const lastRevisionByCanvas = new Map<string, number>()
    const subscription: PluginCanvasEventSubscription = {
      close() {
        if (closed) return
        closed = true
        underlying.close()
      },
    }
    underlying = this.options.changes.subscribe(filter, (event) => {
      if (closed) return
      deliveryTail = deliveryTail
        .then(async () => {
          if (closed) return
          await this.requirePrincipal(principal)
          await this.requireCanvas(scope, event.ref)
          const key = JSON.stringify([event.ref.projectId, event.ref.canvasId])
          const lastRevision = lastRevisionByCanvas.get(key)
          if (lastRevision !== undefined && lastRevision >= event.revision) return
          lastRevisionByCanvas.set(key, event.revision)
          if (!closed) listener(structuredClone(event))
        })
        .catch(() => subscription.close())
    })
    if (signal?.aborted) {
      subscription.close()
      throwIfAborted(signal)
    }
    return subscription
  }

  private async requirePrincipal(principal: PluginPrincipal, signal?: AbortSignal) {
    throwIfAborted(signal)
    const current = await this.options.plugins.resolve(principal)
    throwIfAborted(signal)
    if (
      !current ||
      current.pluginId !== principal.pluginId ||
      current.pluginVersion !== principal.pluginVersion ||
      current.manifestDigest !== principal.manifestDigest
    ) {
      throw new PluginConnectionInvalidError(principal.pluginId)
    }
    return current
  }

  private async requireProject(scope: PluginProjectScope, projectId: string, signal?: AbortSignal) {
    throwIfAborted(signal)
    requireOpaqueId(projectId, "Plugin Project id")
    if (scope.kind === "project" && scope.projectId !== projectId) throw new PluginProjectScopeError(projectId)
    const projects = await this.options.projects.list()
    throwIfAborted(signal)
    const project = projects.find((candidate) => candidate.id === projectId)
    if (!project || project.missing) throw new PluginProjectScopeError(projectId)
    return project
  }

  private async requireCanvas(
    scope: PluginProjectScope,
    ref: PluginCanvasRef,
    signal?: AbortSignal,
  ): Promise<CanvasDocumentRef> {
    throwIfAborted(signal)
    requireOpaqueId(ref.canvasId, "Plugin Canvas id")
    await this.requireProject(scope, ref.projectId, signal)
    throwIfAborted(signal)
    const catalog = await this.options.canvases.getCanvasCatalog({ projectId: ref.projectId })
    throwIfAborted(signal)
    if (!catalog.canvases.some((canvas) => canvas.id === ref.canvasId)) {
      throw new Error(`Canvas was not found in Project ${ref.projectId}: ${ref.canvasId}`)
    }
    return { canvasId: ref.canvasId, scopeId: ref.projectId }
  }
}

function requireCapability(principal: ResolvedPluginPrincipal, capability: PluginCapability) {
  if (!principal.capabilities.includes(capability)) throw new PluginCapabilityDeniedError(capability)
}

function projectSummary(project: ProjectRecord): PluginProjectSummary {
  return { available: !project.missing, id: project.id, name: project.name }
}

function freezeScope(scope: PluginProjectScope): PluginProjectScope {
  if (scope.kind === "all-bound-projects") return Object.freeze({ kind: scope.kind })
  requireOpaqueId(scope.projectId, "Plugin Project scope id")
  return Object.freeze({ kind: scope.kind, projectId: scope.projectId })
}

function requireOpaqueId(value: string, label: string) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 256 || value.includes("\0")) {
    throw new Error(`${label} must be a trimmed string of at most 256 characters`)
  }
}

function positiveLimit(value: number | undefined, fallback: number, label: string) {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(`${label} must be a positive integer`)
  return limit
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException("Plugin Canvas capability request was canceled", "AbortError")
}

function assertSerializedSize(value: unknown, limit: number, label: string) {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error(`${label} must be JSON-serializable`)
  }
  if (serialized === undefined) throw new Error(`${label} must be JSON-serializable`)
  if (new TextEncoder().encode(serialized).byteLength > limit) throw new Error(`${label} exceeds ${limit} bytes`)
}
