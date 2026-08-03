import type { CanvasApplicationService, CanvasDocumentRef, CanvasNodeQuery } from "@convax/canvas/application"
import type { ProjectCanvasCatalogProjectionV2 } from "@convax/project/canvas"
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
import type { PluginHostInvocationLease } from "../plugin-host-api-main-contracts"
import { PluginHostApiError } from "../plugin-host-errors"
import { projectPluginCanvasDocument } from "./plugin-canvas-projection"

type CanvasApplicationPort = Pick<CanvasApplicationService, "execute" | "query">
interface ProjectCanvasPort {
  getCanvasCatalog(input: { readonly projectId: string }): Promise<ProjectCanvasCatalogProjectionV2>
}

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
  maximumDocumentBytes?: number
  maximumRequestBytes?: number
  plugins: PluginPrincipalResolver
  projects: PluginProjectCatalogPort
}

const defaultMaximumDocumentBytes = 8 * 1024 * 1024
const defaultMaximumRequestBytes = 1024 * 1024

export class PluginConnectionInvalidError extends PluginHostApiError {
  constructor(pluginId: string) {
    super("stale-context", `Plugin capability connection is no longer valid: ${pluginId}`)
    this.name = "PluginConnectionInvalidError"
  }
}

export class PluginCapabilityDeniedError extends PluginHostApiError {
  constructor(capability: PluginCapability) {
    super("permission-denied", `Plugin capability is not granted: ${capability}`)
    this.name = "PluginCapabilityDeniedError"
  }
}

export class PluginProjectScopeError extends PluginHostApiError {
  constructor(projectId: string) {
    super("stale-context", `Plugin connection cannot access Project: ${projectId}`)
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
  }

  async connect(
    request: PluginCapabilityConnectionRequest,
    invocationLease?: PluginHostInvocationLease,
  ): Promise<PluginCanvasCapabilityClient> {
    const principal = Object.freeze({ ...request.principal })
    const scope = freezeScope(request.scope)
    const installed = await this.requirePrincipal(principal, undefined, invocationLease)
    if (scope.kind === "all-bound-projects") requireCapability(installed, "projects.read")
    return {
      getDocument: (ref, projection, signal) =>
        this.getDocument(principal, scope, ref, projection, invocationLease, signal),
      listCanvases: (projectId, signal) => this.listCanvases(principal, scope, projectId, invocationLease, signal),
      listProjects: (signal) => this.listProjects(principal, scope, invocationLease, signal),
      queryNodes: (ref, query, signal) => this.queryNodes(principal, scope, ref, query, invocationLease, signal),
      subscribe: (filter, listener, signal) =>
        this.subscribe(principal, scope, filter, listener, invocationLease, signal),
      transact: (transaction, signal) => this.transact(principal, scope, transaction, invocationLease, signal),
    }
  }

  private async listProjects(
    principal: PluginPrincipal,
    scope: PluginProjectScope,
    invocationLease?: PluginHostInvocationLease,
    signal?: AbortSignal,
  ): Promise<PluginProjectSummary[]> {
    const installed = await this.requirePrincipal(principal, signal, invocationLease)
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
    invocationLease?: PluginHostInvocationLease,
    signal?: AbortSignal,
  ) {
    const installed = await this.requirePrincipal(principal, signal, invocationLease)
    requireCapability(installed, "canvas.catalog.read")
    await this.requireProject(scope, projectId, signal)
    throwIfAborted(signal)
    const catalog = await this.options.canvases.getCanvasCatalog({ projectId })
    throwIfAborted(signal)
    return {
      canvases: catalog.visibleCanvases.map((canvas) => ({
        id: canvas.canvasId,
        name: canvas.title ?? "Untitled canvas",
      })),
      projectId,
    }
  }

  private async getDocument(
    principal: PluginPrincipal,
    scope: PluginProjectScope,
    inputRef: PluginCanvasRef,
    projection: PluginCanvasDocumentProjection = "geometry",
    invocationLease?: PluginHostInvocationLease,
    signal?: AbortSignal,
  ): Promise<PluginCanvasDocumentResult> {
    const installed = await this.requirePrincipal(principal, signal, invocationLease)
    requireCapability(installed, "canvas.document.read")
    await this.requireCanvas(scope, inputRef, signal)
    if (projection !== "geometry" && projection !== "structure") {
      throw new Error("Unsupported Canvas document projection")
    }
    throwIfAborted(signal)
    await this.requirePrincipal(principal, signal, invocationLease)
    const currentRef = await this.requireCanvas(scope, inputRef, signal)
    throwIfAborted(signal)
    const snapshot = await this.options.application.query(currentRef)
    throwIfAborted(signal)
    const result = projectPluginCanvasDocument(snapshot.projection, projection, inputRef)
    assertSerializedSize(result, this.maximumDocumentBytes, "Plugin Canvas document response")
    throwIfAborted(signal)
    return result
  }

  private async queryNodes(
    principal: PluginPrincipal,
    scope: PluginProjectScope,
    inputRef: PluginCanvasRef,
    query: CanvasNodeQuery = {},
    invocationLease?: PluginHostInvocationLease,
    signal?: AbortSignal,
  ) {
    const installed = await this.requirePrincipal(principal, signal, invocationLease)
    requireCapability(installed, "canvas.document.read")
    assertSerializedSize(query, this.maximumRequestBytes, "Plugin Canvas node query")
    await this.requireCanvas(scope, inputRef, signal)
    throwIfAborted(signal)
    await this.requirePrincipal(principal, signal, invocationLease)
    const currentRef = await this.requireCanvas(scope, inputRef, signal)
    throwIfAborted(signal)
    const result = await this.options.application.query(currentRef, query)
    throwIfAborted(signal)
    const structure = projectPluginCanvasDocument(result.projection, "structure", inputRef).document
    const response = { nodes: result.nodes, projection: structure, ref: { ...inputRef } }
    assertSerializedSize(response, this.maximumDocumentBytes, "Plugin Canvas node query response")
    return response
  }

  private async transact(
    principal: PluginPrincipal,
    scope: PluginProjectScope,
    request: PluginCanvasTransactionRequest,
    invocationLease?: PluginHostInvocationLease,
    signal?: AbortSignal,
  ): Promise<PluginCanvasTransactionResult> {
    const installed = await this.requirePrincipal(principal, signal, invocationLease)
    requireCapability(installed, "canvas.document.write")
    assertSerializedSize(request, this.maximumRequestBytes, "Plugin Canvas transaction")
    if (!request.commandId.trim() || request.commandId.length > 128) {
      throw new Error("Plugin Canvas command id must contain 1-128 characters")
    }
    const commandType = (request.command as { type?: unknown }).type
    if (commandType === "document.patch" || commandType === "resources.add" || commandType === "resources.replace") {
      throw new Error("Plugin Canvas document commands cannot mutate resource references")
    }
    await this.requireCanvas(scope, request.ref, signal)
    throwIfAborted(signal)
    // Revalidate immediately before applying anything durable.
    await this.requirePrincipal(principal, signal, invocationLease)
    const currentRef = await this.requireCanvas(scope, request.ref, signal)
    throwIfAborted(signal)
    const result = await this.options.application.execute({
      ...currentRef,
      envelope: {
        actor: { id: principal.pluginId, kind: "plugin" },
        command: structuredClone(request.command),
        commandId: request.commandId,
      },
      ...(signal === undefined ? {} : { signal }),
    })
    // Canvas owns the irreversible boundary and checks the signal before
    // persistence. Once it resolves, keep the durable commit authoritative
    // even if transport cancellation races with the completed save.
    const event = {
      operationReceipt: result.operationReceipt,
      ref: { ...request.ref },
      source: "plugin" as const,
    }
    if (result.changed) {
      try {
        this.options.changes.publish(event)
      } catch {
        // Projection invalidation is advisory and cannot turn a committed
        // Canvas transaction into a failed mutation.
      }
    }
    return {
      affectedNodeIds: [...result.affectedNodeIds],
      changed: result.changed,
      createdNodeIds: [...result.createdNodeIds],
      operationReceipt: structuredClone(result.operationReceipt),
      projection: projectPluginCanvasDocument(result.document, "structure", request.ref).document,
      ref: { ...request.ref },
      warnings: [...result.warnings],
    }
  }

  private async subscribe(
    principal: PluginPrincipal,
    scope: PluginProjectScope,
    filter: PluginCanvasRef | { projectId: string },
    listener: (event: PluginCanvasChangeEvent) => void,
    invocationLease?: PluginHostInvocationLease,
    signal?: AbortSignal,
  ) {
    const installed = await this.requirePrincipal(principal, signal, invocationLease)
    requireCapability(installed, "canvas.events.subscribe")
    if ("canvasId" in filter) await this.requireCanvas(scope, filter, signal)
    else await this.requireProject(scope, filter.projectId, signal)
    throwIfAborted(signal)
    let closed = false
    let underlying: PluginCanvasEventSubscription
    let deliveryTail = Promise.resolve()
    const seenOperations = new Set<string>()
    const closeForLease = () => subscription.close()
    const subscription: PluginCanvasEventSubscription = {
      close() {
        if (closed) return
        closed = true
        invocationLease?.signal.removeEventListener("abort", closeForLease)
        underlying.close()
      },
    }
    underlying = this.options.changes.subscribe(filter, (event) => {
      if (closed) return
      deliveryTail = deliveryTail
        .then(async () => {
          if (closed) return
          await this.requirePrincipal(principal, undefined, invocationLease)
          await this.requireCanvas(scope, event.ref)
          const key = JSON.stringify([
            event.ref.projectId,
            event.ref.canvasId,
            event.operationReceipt.actorId,
            event.operationReceipt.operationId,
          ])
          if (seenOperations.has(key)) return
          seenOperations.add(key)
          if (!closed) listener(structuredClone(event))
        })
        .catch(() => subscription.close())
    })
    invocationLease?.signal.addEventListener("abort", closeForLease, { once: true })
    if (signal?.aborted) {
      subscription.close()
      throwIfAborted(signal)
    }
    return subscription
  }

  private async requirePrincipal(
    principal: PluginPrincipal,
    signal?: AbortSignal,
    invocationLease?: PluginHostInvocationLease,
  ) {
    throwIfAborted(signal)
    if (invocationLease) {
      throwIfAborted(invocationLease.signal)
      if (
        principal.runtime !== "tool" ||
        invocationLease.claims.providerPluginId !== principal.pluginId ||
        !sameExactPrincipal(principal, invocationLease.principal) ||
        !sameResolvedPrincipal(principal, invocationLease.resolved)
      ) {
        throw new PluginConnectionInvalidError(principal.pluginId)
      }
      await invocationLease.assertActive(invocationLease.claims)
      throwIfAborted(signal)
      throwIfAborted(invocationLease.signal)
      return invocationLease.resolved
    }
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
    if (!catalog.visibleCanvases.some((canvas) => canvas.canvasId === ref.canvasId)) {
      throw new PluginHostApiError("stale-context", `Canvas was not found in Project ${ref.projectId}: ${ref.canvasId}`)
    }
    return { canvasId: ref.canvasId, scopeId: ref.projectId }
  }
}

function requireCapability(principal: ResolvedPluginPrincipal, capability: PluginCapability) {
  if (!principal.capabilities.includes(capability)) throw new PluginCapabilityDeniedError(capability)
}

function sameExactPrincipal(left: PluginPrincipal, right: PluginPrincipal) {
  return (
    left.activeRevision === right.activeRevision &&
    left.activeSetDigest === right.activeSetDigest &&
    left.manifestDigest === right.manifestDigest &&
    left.pluginId === right.pluginId &&
    left.pluginVersion === right.pluginVersion &&
    left.runtime === right.runtime &&
    left.snapshotDigest === right.snapshotDigest
  )
}

function sameResolvedPrincipal(principal: PluginPrincipal, resolved: ResolvedPluginPrincipal) {
  return (
    principal.activeRevision === resolved.activeRevision &&
    principal.activeSetDigest === resolved.activeSetDigest &&
    principal.manifestDigest === resolved.manifestDigest &&
    principal.pluginId === resolved.pluginId &&
    principal.pluginVersion === resolved.pluginVersion &&
    principal.snapshotDigest === resolved.snapshotDigest
  )
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
