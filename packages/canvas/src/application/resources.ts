import { getCanvasResourcePresentationSize } from "../media-sizing"
import { canvasResourceProofMetadataKey } from "../collaboration/application-command-adapter"
import { canvasProjectionResourceMetadataKey } from "../collaboration/projection"
import type { CanvasPendingResourceKind, CanvasPoint, CanvasSize, CanvasUploadItem } from "../types"
import {
  CanvasCommandValidationError,
  createAddCanvasResourcesCommand,
  createCanvasPendingGenerationResourceCommand,
  createCanvasPendingResourceCommand,
  createRelinkCanvasResourceCommand,
  type CanvasNodeContentGuard,
  type CanvasGenerationTargetGuard,
  type CanvasAddResourcesCommand,
  type CanvasBusinessCommand,
  type CanvasCommandActor,
  type CanvasFailPendingResourceCommand,
  type CanvasReplaceGeneratedResourceCommand,
  type CanvasReplaceResourceCommand,
} from "./commands"
import type { CanvasDocumentRef } from "./persistence"
import type {
  CanvasApplicationCommandRequest,
  CanvasApplicationCommandResult,
  CanvasApplicationService,
  CanvasSubmitDiagnosticsPort,
} from "./service"

class CanvasResourceRequestConflictError extends Error {
  constructor(commandId: string) {
    super(`Canvas resource request id was reused with a different payload: ${commandId}`)
    this.name = "CanvasResourceRequestConflictError"
  }
}

interface CanvasResourceSourceBase {
  /** Caller-provided correlation id, stable across preparation retries. */
  sourceId: string
}

/**
 * Serializable resource inputs accepted at the business boundary. Browser
 * File/Blob objects and platform paths are deliberately resolved by a
 * preparation adapter rather than crossing this boundary.
 */
export type CanvasResourceSource =
  | (CanvasResourceSourceBase & {
      kind: "new-text"
      name?: string
      text: string
    })
  | (CanvasResourceSourceBase & {
      /** A portable file reference interpreted relative to the host scope. */
      kind: "host-file"
      path: string
    })
  | (CanvasResourceSourceBase & {
      /** A portable directory reference interpreted relative to the host scope. */
      kind: "host-directory"
      path: string
    })

/** Interpretation of the resource placement anchor before it becomes a durable top-left position. */
export type CanvasResourceAnchorOrigin = "center" | "top-left"

export interface CanvasResourcePreparationRequest extends CanvasDocumentRef {
  signal?: AbortSignal
  sources: readonly CanvasResourceSource[]
}

export interface CanvasResourcePreparationResult {
  items: readonly CanvasUploadItem[]
  retainedOnFailure?: readonly { label: string }[]
  warnings?: readonly string[]
}

export class CanvasResourcePartialFailureError extends Error {
  readonly retainedOnFailure: readonly { label: string }[]

  constructor(cause: unknown, retainedOnFailure: readonly { label: string }[]) {
    const retained = validateRetainedOnFailure(retainedOnFailure)
    if (retained.length === 0) {
      throw new CanvasCommandValidationError("Canvas resource partial failure requires a retained label")
    }
    super("Canvas resources could not be committed after host resources were retained", { cause })
    this.name = "CanvasResourcePartialFailureError"
    this.retainedOnFailure = retained
  }
}

/** Platform adapter for reading files, probing media, and materializing URLs. */
export interface CanvasResourcePreparationPort {
  prepare(request: CanvasResourcePreparationRequest): Promise<CanvasResourcePreparationResult>
}

export interface CanvasAddResourceSourcesRequest extends CanvasDocumentRef {
  actor: CanvasCommandActor
  anchor: CanvasPoint
  anchorOrigin?: CanvasResourceAnchorOrigin
  /** Host-neutral final guard invoked immediately before Canvas persistence. */
  beforeCommit?: () => Promise<void>
  commandId: string
  parentId?: string
  relation?: CanvasAddResourcesCommand["relation"]
  signal?: AbortSignal
  sources: readonly CanvasResourceSource[]
}

export interface CanvasReplaceResourceSourceRequest extends CanvasDocumentRef {
  actor: CanvasCommandActor
  commandId: string
  expectedTarget: CanvasNodeContentGuard
  source: CanvasResourceSource
  signal?: AbortSignal
  targetNodeId: string
}

export interface CanvasCreatePendingResourceRequest extends CanvasDocumentRef {
  actor: CanvasCommandActor
  anchor: CanvasPoint
  commandId: string
  kind: CanvasPendingResourceKind
  label?: string
  parentId?: string
  relation?: CanvasAddResourcesCommand["relation"]
  signal?: AbortSignal
}

export interface CanvasCreatePendingGenerationResourceRequest extends CanvasDocumentRef {
  actor: CanvasCommandActor
  anchor: CanvasPoint
  commandId: string
  kind: CanvasPendingResourceKind
  label?: string
  operationId: string
  parentId?: string
  prompt: string
  relation?: CanvasAddResourcesCommand["relation"]
  signal?: AbortSignal
  size?: CanvasSize
  toolId: string
}

export interface CanvasFailPendingResourceRequest extends CanvasDocumentRef {
  actor: CanvasCommandActor
  commandId: string
  expectedTarget: CanvasNodeContentGuard
  message: string
  targetNodeId: string
}

export interface CanvasRelinkPreparedResourceRequest extends CanvasDocumentRef {
  actor: CanvasCommandActor
  commandId: string
  metadataKeysToRemove?: readonly string[]
  nodeId: string
}

export interface CanvasReplaceGeneratedResourceSourceRequest extends CanvasDocumentRef {
  actor: CanvasCommandActor
  commandId: string
  expectedTarget: CanvasGenerationTargetGuard
  operationId: string
  signal?: AbortSignal
  source: CanvasResourceSource
  targetNodeId: string
}

type CanvasCommandExecutor = Pick<CanvasApplicationService, "execute" | "query">

interface CanvasResourceExecution {
  fingerprint: string
  result: Promise<CanvasApplicationCommandResult>
}

/**
 * Headless business orchestration shared by UI actions and Agent tools.
 * Preparation is environment-specific; sizing, placement, relations,
 * semantic guards and persistence stay in the Canvas application layer.
 */
export class CanvasResourceBusinessService {
  private readonly executions = new Map<string, CanvasResourceExecution>()

  constructor(
    private readonly preparation: CanvasResourcePreparationPort,
    private readonly application: CanvasCommandExecutor,
    private readonly diagnostics?: CanvasSubmitDiagnosticsPort,
  ) {}

  createPendingResource(request: CanvasCreatePendingResourceRequest): Promise<CanvasApplicationCommandResult> {
    const key = resourceExecutionKey(request)
    const fingerprint = stableJson({
      operation: "pending-create",
      anchor: request.anchor,
      kind: request.kind,
      label: request.label,
      ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
      relation: request.relation,
    })
    const existing = this.executions.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new CanvasResourceRequestConflictError(request.commandId))
      }
      return existing.result
    }

    const result = this.createPendingResourceOnce(request)
    this.rememberExecution(key, fingerprint, result)
    return result
  }

  createPendingGenerationResource(
    request: CanvasCreatePendingGenerationResourceRequest,
  ): Promise<CanvasApplicationCommandResult> {
    const key = resourceExecutionKey(request)
    const fingerprint = stableJson({
      operation: "pending-generation-create",
      anchor: request.anchor,
      kind: request.kind,
      label: request.label,
      operationId: request.operationId,
      ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
      prompt: request.prompt,
      relation: request.relation,
      size: request.size,
      toolId: request.toolId,
    })
    const existing = this.executions.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new CanvasResourceRequestConflictError(request.commandId))
      }
      return existing.result
    }

    const result = this.createPendingGenerationResourceOnce(request)
    this.rememberExecution(key, fingerprint, result)
    return result
  }

  failPendingResource(request: CanvasFailPendingResourceRequest): Promise<CanvasApplicationCommandResult> {
    const key = resourceExecutionKey(request)
    const fingerprint = stableJson({
      operation: "pending-fail",
      expectedTarget: request.expectedTarget,
      message: request.message,
      targetNodeId: request.targetNodeId,
    })
    const existing = this.executions.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new CanvasResourceRequestConflictError(request.commandId))
      }
      return existing.result
    }

    const result = this.failPendingResourceOnce(request)
    this.rememberExecution(key, fingerprint, result)
    return result
  }

  addResources(request: CanvasAddResourceSourcesRequest): Promise<CanvasApplicationCommandResult> {
    return this.addResourcesShared(request)
  }

  addPreparedResources(
    request: CanvasAddResourceSourcesRequest,
    prepared: CanvasResourcePreparationResult,
  ): Promise<CanvasApplicationCommandResult> {
    return this.addResourcesShared(request, prepared)
  }

  async relinkPreparedResource(
    request: CanvasRelinkPreparedResourceRequest,
    prepared: CanvasResourcePreparationResult,
  ): Promise<CanvasApplicationCommandResult> {
    try {
      validateCanvasResourceCommandIdentity(request)
      requireNonEmptyString(request.nodeId, "Canvas resource node id")
      validatePreparedCanvasResources(prepared)
      if (prepared.items.length !== 1) {
        throw new CanvasCommandValidationError("Relink preparation must return exactly one Canvas resource")
      }
      const result = await this.application.execute({
        canvasId: request.canvasId,
        envelope: {
          actor: request.actor,
          command: createRelinkCanvasResourceCommand({
            item: prepared.items[0],
            metadataKeysToRemove: request.metadataKeysToRemove,
            nodeId: request.nodeId,
          }),
          commandId: request.commandId,
        },
        scopeId: request.scopeId,
      })
      return { ...result, warnings: [...(prepared.warnings ?? []), ...result.warnings] }
    } catch (error) {
      return throwPartialFailureIfRetained(error, prepared.retainedOnFailure)
    }
  }

  private addResourcesShared(
    request: CanvasAddResourceSourcesRequest,
    hostPrepared?: CanvasResourcePreparationResult,
  ): Promise<CanvasApplicationCommandResult> {
    const key = JSON.stringify([
      request.scopeId,
      request.canvasId,
      request.actor.kind,
      request.actor.id,
      request.commandId,
    ])
    const fingerprint = stableJson({
      operation: "add",
      anchor: request.anchor,
      anchorOrigin: request.anchorOrigin ?? "top-left",
      ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
      relation: request.relation,
      sources: request.sources,
      ...(hostPrepared === undefined ? {} : { hostPrepared }),
    })
    const existing = this.executions.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new CanvasResourceRequestConflictError(request.commandId))
      }
      return existing.result
    }

    const result = this.addResourcesOnce(request, hostPrepared)
    const execution = { fingerprint, result }
    this.executions.set(key, execution)
    if (this.executions.size > 1_000) this.executions.delete(this.executions.keys().next().value ?? "")
    void result.catch((error) => {
      if (error instanceof CanvasResourcePartialFailureError) return
      if (this.executions.get(key) === execution) this.executions.delete(key)
    })
    return result
  }

  replaceResource(request: CanvasReplaceResourceSourceRequest): Promise<CanvasApplicationCommandResult> {
    const key = JSON.stringify([
      request.scopeId,
      request.canvasId,
      request.actor.kind,
      request.actor.id,
      request.commandId,
    ])
    const fingerprint = stableJson({
      operation: "replace",
      expectedTarget: request.expectedTarget,
      source: request.source,
      targetNodeId: request.targetNodeId,
    })
    const existing = this.executions.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new CanvasResourceRequestConflictError(request.commandId))
      }
      return existing.result
    }

    const result = this.replaceResourceOnce(request)
    const execution = { fingerprint, result }
    this.executions.set(key, execution)
    if (this.executions.size > 1_000) this.executions.delete(this.executions.keys().next().value ?? "")
    void result.catch((error) => {
      if (error instanceof CanvasResourcePartialFailureError) return
      if (this.executions.get(key) === execution) this.executions.delete(key)
    })
    return result
  }

  replaceGeneratedResource(
    request: CanvasReplaceGeneratedResourceSourceRequest,
  ): Promise<CanvasApplicationCommandResult> {
    const key = JSON.stringify([
      request.scopeId,
      request.canvasId,
      request.actor.kind,
      request.actor.id,
      request.commandId,
    ])
    const fingerprint = stableJson({
      operation: "replace-generated",
      expectedTarget: request.expectedTarget,
      operationId: request.operationId,
      source: request.source,
      targetNodeId: request.targetNodeId,
    })
    const existing = this.executions.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new CanvasResourceRequestConflictError(request.commandId))
      }
      return existing.result
    }

    const result = this.replaceGeneratedResourceOnce(request)
    this.rememberExecution(key, fingerprint, result)
    return result
  }

  private rememberExecution(key: string, fingerprint: string, result: Promise<CanvasApplicationCommandResult>): void {
    const execution = { fingerprint, result }
    this.executions.set(key, execution)
    if (this.executions.size > 1_000) this.executions.delete(this.executions.keys().next().value ?? "")
    void result.catch(() => {
      if (this.executions.get(key) === execution) this.executions.delete(key)
    })
  }

  private async createPendingResourceOnce(
    request: CanvasCreatePendingResourceRequest,
  ): Promise<CanvasApplicationCommandResult> {
    validateResourceOperation(request)
    if (!Number.isFinite(request.anchor.x) || !Number.isFinite(request.anchor.y)) {
      throw new CanvasCommandValidationError("Placement anchor must contain finite coordinates")
    }
    validatePendingResourceKind(request.kind)
    if (request.label !== undefined) requireBoundedString(request.label, "Pending resource label", 200)

    const command = createCanvasPendingResourceCommand({
      anchor: request.anchor,
      kind: request.kind,
      label: request.label ?? pendingResourceLabel(request.kind),
      ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
      relation: request.relation,
    })
    return this.executeGuarded(request, command, [])
  }

  private async createPendingGenerationResourceOnce(
    request: CanvasCreatePendingGenerationResourceRequest,
  ): Promise<CanvasApplicationCommandResult> {
    throwIfAborted(request.signal)
    validateResourceOperation(request)
    if (!Number.isFinite(request.anchor.x) || !Number.isFinite(request.anchor.y)) {
      throw new CanvasCommandValidationError("Placement anchor must contain finite coordinates")
    }
    validatePendingResourceKind(request.kind)
    if (request.label !== undefined) requireBoundedString(request.label, "Pending resource label", 200)
    if (request.size !== undefined) validatePositiveSize(request.size, "Pending generation resource size")

    const command = createCanvasPendingGenerationResourceCommand({
      anchor: request.anchor,
      generation: {
        operationId: request.operationId,
        prompt: request.prompt,
        toolId: request.toolId,
      },
      kind: request.kind,
      label: request.label ?? pendingResourceLabel(request.kind),
      ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
      relation: request.relation,
      ...(request.size === undefined ? {} : { size: request.size }),
    })
    return this.executeGuarded(request, command, [])
  }

  private async failPendingResourceOnce(
    request: CanvasFailPendingResourceRequest,
  ): Promise<CanvasApplicationCommandResult> {
    validateResourceOperation(request)
    requireNonEmptyString(request.targetNodeId, "Canvas pending resource target node id")
    validatePendingResourceContentGuard(request.expectedTarget)
    validatePendingResourceErrorMessage(request.message)

    const command: CanvasFailPendingResourceCommand = {
      type: "resources.pending.fail",
      expectedTarget: structuredClone(request.expectedTarget),
      message: request.message,
      targetNodeId: request.targetNodeId,
    }
    return this.executeGuarded(request, command, [])
  }

  private async addResourcesOnce(
    request: CanvasAddResourceSourcesRequest,
    hostPrepared?: CanvasResourcePreparationResult,
  ): Promise<CanvasApplicationCommandResult> {
    const businessStartedAt = this.diagnostics ? performance.now() : undefined
    throwIfAborted(request.signal)
    validateCanvasResourceCommandIdentity(request)
    const sourceIds = validateCanvasResourceSources(request.sources)
    if (!Number.isFinite(request.anchor.x) || !Number.isFinite(request.anchor.y)) {
      throw new CanvasCommandValidationError("Placement anchor must contain finite coordinates")
    }
    validateCanvasResourceAnchorOrigin(request.anchorOrigin)
    if (hostPrepared !== undefined) validatePreparedCanvasResources(hostPrepared, sourceIds)
    if (request.sources.length === 0 && (hostPrepared === undefined || hostPrepared.items.length === 0)) {
      throw new CanvasCommandValidationError("At least one Canvas resource source is required")
    }

    const preparedFromSources: CanvasResourcePreparationResult = request.sources.length
      ? await this.preparation.prepare({
          canvasId: request.canvasId,
          ...(request.signal ? { signal: request.signal } : {}),
          scopeId: request.scopeId,
          sources: request.sources,
        })
      : { items: [] }
    throwIfAborted(request.signal)
    const retainedOnFailure = mergeRetainedOnFailure(
      preparedFromSources.retainedOnFailure,
      hostPrepared?.retainedOnFailure,
    )
    let prepared: CanvasResourcePreparationResult
    let command: CanvasAddResourcesCommand
    try {
      validatePreparedCanvasResources(preparedFromSources)
      prepared =
        hostPrepared === undefined
          ? preparedFromSources
          : {
              items: [...preparedFromSources.items, ...hostPrepared.items],
              retainedOnFailure,
              warnings: [...(preparedFromSources.warnings ?? []), ...(hostPrepared.warnings ?? [])],
            }
      command = createAddCanvasResourcesCommand({
        anchor: resolveCanvasResourcePlacementAnchor(request.anchor, request.anchorOrigin, prepared.items[0]),
        items: prepared.items,
        ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
        relation: request.relation,
      })
    } catch (error) {
      throwPartialFailureIfRetained(error, retainedOnFailure)
    }
    const applicationRequest: CanvasApplicationCommandRequest = {
      canvasId: request.canvasId,
      envelope: { actor: request.actor, command, commandId: request.commandId },
      scopeId: request.scopeId,
    }
    const preparedRuntimeStates = command.items.map(({ item }) => ({
      bindingKey: preparedResourceRuntimeBindingKey(item),
      state: structuredClone(item.state),
    }))
    if (businessStartedAt !== undefined) {
      try {
        this.diagnostics?.record({
          callCount: 1,
          durationMs: performance.now() - businessStartedAt,
          sizes: { resources: prepared.items.length },
          stage: "business-prepare",
        })
      } catch {}
    }
    try {
      throwIfAborted(request.signal)
      const result = await this.application.execute({
        ...applicationRequest,
        ...(request.beforeCommit ? { beforeCommit: request.beforeCommit } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      })
      return {
        ...projectPreparedResourceRuntimeStates(result, preparedRuntimeStates),
        warnings: [...(prepared.warnings ?? []), ...result.warnings],
      }
    } catch (error) {
      throwPartialFailureIfRetained(error, prepared.retainedOnFailure)
    }
  }

  private async replaceResourceOnce(
    request: CanvasReplaceResourceSourceRequest,
  ): Promise<CanvasApplicationCommandResult> {
    throwIfAborted(request.signal)
    validateResourceOperation(request)
    requireNonEmptyString(request.targetNodeId, "Canvas replacement target node id")
    if (
      !isRecord(request.expectedTarget) ||
      !isRecord(request.expectedTarget.data) ||
      typeof request.expectedTarget.data.kind !== "string" ||
      typeof request.expectedTarget.data.label !== "string" ||
      request.expectedTarget.type !== "file"
    ) {
      throw new CanvasCommandValidationError("Canvas replacement target guard is invalid")
    }
    validateCanvasResourceSources([request.source])

    const prepared = await this.preparation.prepare({
      canvasId: request.canvasId,
      ...(request.signal ? { signal: request.signal } : {}),
      scopeId: request.scopeId,
      sources: [request.source],
    })
    throwIfAborted(request.signal)
    try {
      validatePreparedCanvasResources(prepared)
      if (prepared.items.length !== 1) {
        throw new CanvasCommandValidationError("Canvas resource replacement must prepare exactly one item")
      }
      const command: CanvasReplaceResourceCommand = {
        type: "resources.replace",
        expectedTarget: structuredClone(request.expectedTarget),
        item: prepared.items[0],
        targetNodeId: request.targetNodeId,
      }

      return await this.executeGuarded(request, command, prepared.warnings ?? [])
    } catch (error) {
      return throwPartialFailureIfRetained(error, prepared.retainedOnFailure)
    }
  }

  private async replaceGeneratedResourceOnce(
    request: CanvasReplaceGeneratedResourceSourceRequest,
  ): Promise<CanvasApplicationCommandResult> {
    throwIfAborted(request.signal)
    validateResourceOperation(request)
    requireNonEmptyString(request.targetNodeId, "Canvas replacement target node id")
    requireNonEmptyString(request.operationId, "Canvas generation operation id")
    if (
      !isRecord(request.expectedTarget) ||
      !isRecord(request.expectedTarget.data) ||
      typeof request.expectedTarget.data.kind !== "string" ||
      typeof request.expectedTarget.data.label !== "string" ||
      request.expectedTarget.type !== "file"
    ) {
      throw new CanvasCommandValidationError("Canvas generation replacement target guard is invalid")
    }
    validateCanvasResourceSources([request.source])

    const prepared = await this.preparation.prepare({
      canvasId: request.canvasId,
      ...(request.signal ? { signal: request.signal } : {}),
      scopeId: request.scopeId,
      sources: [request.source],
    })
    throwIfAborted(request.signal)
    validatePreparedCanvasResources(prepared)
    if (prepared.items.length !== 1) {
      throw new CanvasCommandValidationError("Canvas generated resource replacement must prepare exactly one item")
    }
    const command: CanvasReplaceGeneratedResourceCommand = {
      type: "resources.replace-generated",
      expectedTarget: structuredClone(request.expectedTarget),
      item: prepared.items[0],
      operationId: request.operationId,
      targetNodeId: request.targetNodeId,
    }
    return this.executeGuarded(request, command, prepared.warnings ?? [])
  }

  private async executeGuarded(
    request: Pick<
      | CanvasReplaceResourceSourceRequest
      | CanvasReplaceGeneratedResourceSourceRequest
      | CanvasCreatePendingGenerationResourceRequest
      | CanvasCreatePendingResourceRequest
      | CanvasFailPendingResourceRequest,
      "actor" | "canvasId" | "commandId" | "scopeId"
    > & { signal?: AbortSignal },
    command: CanvasBusinessCommand,
    preparationWarnings: readonly string[],
  ): Promise<CanvasApplicationCommandResult> {
    throwIfAborted(request.signal)
    const result = await this.application.execute({
      canvasId: request.canvasId,
      envelope: { actor: request.actor, command, commandId: request.commandId },
      ...(request.signal ? { signal: request.signal } : {}),
      scopeId: request.scopeId,
    })
    return { ...result, warnings: [...preparationWarnings, ...result.warnings] }
  }
}

function validateCanvasResourceAnchorOrigin(value: CanvasResourceAnchorOrigin | undefined) {
  if (value !== undefined && value !== "center" && value !== "top-left") {
    throw new CanvasCommandValidationError("Canvas resource anchor origin is invalid")
  }
}

function resolveCanvasResourcePlacementAnchor(
  anchor: CanvasPoint,
  origin: CanvasResourceAnchorOrigin | undefined,
  firstItem: CanvasUploadItem | undefined,
): CanvasPoint {
  if (origin !== "center" || !firstItem) return anchor
  const size = getCanvasResourcePresentationSize(
    firstItem.kind,
    firstItem.kind === "image" || firstItem.kind === "video"
      ? { height: firstItem.height, width: firstItem.width }
      : undefined,
  )
  return { x: anchor.x - size.width / 2, y: anchor.y - size.height / 2 }
}

function resourceExecutionKey(request: {
  actor: CanvasCommandActor
  canvasId: string
  commandId: string
  scopeId: string
}) {
  return JSON.stringify([request.scopeId, request.canvasId, request.actor.kind, request.actor.id, request.commandId])
}

function validateResourceOperation(request: { actor: CanvasCommandActor; commandId: string }) {
  if (!request.commandId.trim() || !request.actor.id.trim()) {
    throw new CanvasCommandValidationError("Canvas command and actor ids are required")
  }
}

function validateCanvasResourceCommandIdentity(request: { actor: CanvasCommandActor; commandId: string }) {
  if (!request.commandId.trim() || !request.actor.id.trim() || !request.actor.kind.trim()) {
    throw new CanvasCommandValidationError("Canvas command and actor ids are required")
  }
}

function throwPartialFailureIfRetained(
  error: unknown,
  retainedOnFailure: CanvasResourcePreparationResult["retainedOnFailure"],
): never {
  if (error instanceof CanvasResourcePartialFailureError) throw error
  const retained = validateRetainedOnFailure(retainedOnFailure)
  if (retained.length > 0) throw new CanvasResourcePartialFailureError(error, retained)
  throw error
}

export function validateCanvasResourceSources(sources: readonly CanvasResourceSource[]) {
  if (!Array.isArray(sources)) throw new CanvasCommandValidationError("Canvas resource sources must be an array")
  const sourceIds = new Set<string>()
  for (const source of sources) {
    if (!isRecord(source) || typeof source.sourceId !== "string" || !source.sourceId.trim()) {
      throw new CanvasCommandValidationError("Canvas resource source id is required")
    }
    if (sourceIds.has(source.sourceId)) {
      throw new CanvasCommandValidationError(`Canvas resource source id is duplicated: ${source.sourceId}`)
    }
    sourceIds.add(source.sourceId)
    if (source.kind === "host-file" || source.kind === "host-directory") {
      requireNonEmptyString(source.path, "Host entry path")
    } else if (source.kind === "new-text") {
      if (typeof source.text !== "string") throw new CanvasCommandValidationError("New resource text is required")
      if (source.name !== undefined && typeof source.name !== "string") {
        throw new CanvasCommandValidationError("New resource name must be a string")
      }
    } else {
      throw new CanvasCommandValidationError(`Unsupported canvas resource source: ${String(source.kind)}`)
    }
  }
  return sourceIds
}

function validatePreparedCanvasResources(
  prepared: CanvasResourcePreparationResult,
  unavailableSourceIds: ReadonlySet<string> = new Set(),
) {
  if (!isRecord(prepared) || !Array.isArray(prepared.items)) {
    throw new CanvasCommandValidationError("Resource preparation must return an item array")
  }
  const itemIds = new Set<string>()
  for (const item of prepared.items) {
    if (!isRecord(item)) throw new CanvasCommandValidationError("Prepared canvas resource is invalid")
    requireNonEmptyString(item.id, "Prepared resource id")
    if (unavailableSourceIds.has(item.id) || itemIds.has(item.id)) {
      throw new CanvasCommandValidationError(`Canvas resource source id is duplicated: ${item.id}`)
    }
    itemIds.add(item.id)
    if (!isRecord(item.metadata)) throw new CanvasCommandValidationError("Prepared resource metadata is required")
    requireResourceRuntimeState(item.state)
    for (const key of ["format", "text", "richText", "url", "posterUrl", "path"]) {
      if (Object.hasOwn(item, key)) {
        throw new CanvasCommandValidationError(`Prepared resource contains removed field: ${key}`)
      }
    }
    if (item.kind === "text") {
      continue
    }
    if (item.kind === "folder") {
      requireNonEmptyString(item.name, "Prepared folder name")
      continue
    }
    if (item.kind !== "audio" && item.kind !== "file" && item.kind !== "image" && item.kind !== "video") {
      throw new CanvasCommandValidationError(`Unsupported prepared resource kind: ${String(item.kind)}`)
    }
    requirePositiveNumberIfPresent(item.width, "Prepared resource width")
    requirePositiveNumberIfPresent(item.height, "Prepared resource height")
    requirePositiveNumberIfPresent(item.durationMs, "Prepared resource duration")
  }
  if (
    prepared.warnings !== undefined &&
    (!Array.isArray(prepared.warnings) || prepared.warnings.some((warning) => typeof warning !== "string"))
  ) {
    throw new CanvasCommandValidationError("Resource preparation warnings must be strings")
  }
  validateRetainedOnFailure(prepared.retainedOnFailure)
}

function mergeRetainedOnFailure(
  ...values: Array<CanvasResourcePreparationResult["retainedOnFailure"]>
): readonly { label: string }[] | undefined {
  const retained = new Map<string, { label: string }>()
  for (const value of values) {
    for (const item of validateRetainedOnFailure(value)) {
      if (!retained.has(item.label)) retained.set(item.label, item)
    }
  }
  return retained.size > 0 ? [...retained.values()] : undefined
}

function validateRetainedOnFailure(value: unknown): readonly { label: string }[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new CanvasCommandValidationError("Canvas resource retained labels must be an array")
  }
  const labels = new Set<string>()
  return Object.freeze(
    value.map((item) => {
      if (!isRecord(item) || Object.keys(item).length !== 1 || !Object.hasOwn(item, "label")) {
        throw new CanvasCommandValidationError("Canvas resource retained label is invalid")
      }
      const label = item.label
      if (typeof label !== "string" || !label.trim() || label !== label.trim() || label.length > 4_096) {
        throw new CanvasCommandValidationError("Canvas resource retained label is invalid")
      }
      if (labels.has(label)) {
        throw new CanvasCommandValidationError(`Canvas resource retained label is duplicated: ${label}`)
      }
      labels.add(label)
      return Object.freeze({ label })
    }),
  )
}

function requireResourceRuntimeState(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.status !== "string" ||
    !["stale", "ready", "missing", "corrupt", "unsupported", "conflict"].includes(value.status)
  ) {
    throw new CanvasCommandValidationError("Prepared resource runtime state is invalid")
  }
  for (const key of ["contentRevision", "error", "posterUrl", "text", "url"]) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      throw new CanvasCommandValidationError(`Prepared resource runtime ${key} must be a string`)
    }
  }
  for (const key of ["canSaveEditableCopy", "editableText"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      throw new CanvasCommandValidationError(`Prepared resource runtime ${key} must be a boolean`)
    }
  }
}

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new CanvasCommandValidationError(`${label} is required`)
}

function requireBoundedString(value: unknown, label: string, maxLength: number): asserts value is string {
  requireNonEmptyString(value, label)
  if (value.length > maxLength) throw new CanvasCommandValidationError(`${label} exceeds ${maxLength} characters`)
}

function validatePendingResourceKind(kind: unknown): asserts kind is CanvasPendingResourceKind {
  if (kind !== "text" && kind !== "image" && kind !== "video" && kind !== "audio") {
    throw new CanvasCommandValidationError(`Unsupported pending resource kind: ${String(kind)}`)
  }
}

function validatePendingResourceContentGuard(guard: CanvasNodeContentGuard) {
  if (
    !isRecord(guard) ||
    guard.type !== "file" ||
    !isRecord(guard.data) ||
    guard.data.status !== "pending" ||
    typeof guard.data.label !== "string"
  ) {
    throw new CanvasCommandValidationError("Canvas pending resource target guard is invalid")
  }
  validatePendingResourceKind(guard.data.kind)
}

function validatePendingResourceErrorMessage(message: unknown): asserts message is string {
  requireBoundedString(message, "Pending resource error message", 500)
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(message)) {
    throw new CanvasCommandValidationError("Pending resource error message contains unsupported control characters")
  }
}

function pendingResourceLabel(kind: CanvasPendingResourceKind) {
  return `${kind[0].toUpperCase()}${kind.slice(1)}`
}

function requirePositiveNumberIfPresent(value: unknown, label: string) {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
    throw new CanvasCommandValidationError(`${label} must be positive when provided`)
  }
}

function validatePositiveSize(size: CanvasSize, label: string) {
  requirePositiveNumberIfPresent(size.width, `${label} width`)
  requirePositiveNumberIfPresent(size.height, `${label} height`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/**
 * Resource runtime state is deliberately absent from the durable Canvas
 * snapshot. Once the authoritative commit has succeeded, retain the exact
 * validated preparation result in the returned view instead of immediately
 * reading the same host resource again. Operation receipts sort result entities
 * by canonical entity key, so their order cannot bind prepared items to created
 * nodes. Match the exact persisted resource identity and title instead. An
 * ambiguous duplicate set is attached only when every runtime state is equal;
 * otherwise hydration remains the safe authority and no state crosses nodes.
 * Main separately binds this view to the session's authoritative metadata
 * before renderer delivery.
 */
function projectPreparedResourceRuntimeStates(
  result: CanvasApplicationCommandResult,
  prepared: readonly {
    bindingKey: string | null
    state: CanvasUploadItem["state"]
  }[],
): CanvasApplicationCommandResult {
  if (!result.changed || prepared.length === 0 || prepared.length !== result.createdNodeIds.length) return result
  const createdNodeIds = new Set(result.createdNodeIds)
  if (createdNodeIds.size !== prepared.length) return result

  const preparedByBinding = new Map<string, (typeof prepared)[number][]>()
  for (const item of prepared) {
    if (item.bindingKey === null) continue
    const matches = preparedByBinding.get(item.bindingKey) ?? []
    matches.push(item)
    preparedByBinding.set(item.bindingKey, matches)
  }
  const nodesByBinding = new Map<string, (typeof result.document.nodes)[number][]>()
  for (const node of result.document.nodes) {
    if (!createdNodeIds.has(node.id)) continue
    const bindingKey = projectedResourceRuntimeBindingKey(node)
    if (bindingKey === null) continue
    const matches = nodesByBinding.get(bindingKey) ?? []
    matches.push(node)
    nodesByBinding.set(bindingKey, matches)
  }

  const runtimeStateByNodeId = new Map<string, CanvasUploadItem["state"]>()
  for (const [bindingKey, preparedMatches] of preparedByBinding) {
    const nodeMatches = nodesByBinding.get(bindingKey)
    if (!nodeMatches || nodeMatches.length !== preparedMatches.length) continue
    const state = preparedMatches[0]!.state
    const stateFingerprint = stableJson(state)
    if (preparedMatches.some((candidate) => stableJson(candidate.state) !== stateFingerprint)) continue
    for (const node of nodeMatches) runtimeStateByNodeId.set(node.id, state)
  }

  let changed = false
  const nodes = result.document.nodes.map((node) => {
    const state = runtimeStateByNodeId.get(node.id)
    if (state === undefined || stableJson(node.data.resourceState) === stableJson(state)) return node
    changed = true
    return { ...node, data: { ...node.data, resourceState: structuredClone(state) } }
  })
  return changed ? { ...result, document: { ...result.document, nodes } } : result
}

function preparedResourceRuntimeBindingKey(item: CanvasUploadItem): string | null {
  const proof = item.metadata[canvasResourceProofMetadataKey]
  if (!isRecord(proof) || !isRecord(proof.resource)) return null
  return resourceRuntimeBindingKey(item.kind, item.name ?? defaultPreparedResourceTitle(item.kind), proof.resource)
}

function projectedResourceRuntimeBindingKey(node: CanvasApplicationCommandResult["document"]["nodes"][number]) {
  const metadata = isRecord(node.data.metadata) ? node.data.metadata : undefined
  const resource = metadata?.[canvasProjectionResourceMetadataKey]
  if (!isRecord(resource)) return null
  return resourceRuntimeBindingKey(node.data.kind, node.data.label, resource)
}

function resourceRuntimeBindingKey(kind: string, title: string, resource: Record<string, unknown>) {
  return stableJson({ kind, resource, title })
}

function defaultPreparedResourceTitle(kind: CanvasUploadItem["kind"]) {
  return kind === "text" ? "Text" : kind === "folder" ? "Folder" : "Resource"
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (isRecord(value)) {
    const record = value
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException("Canvas resource operation was canceled", "AbortError")
}
