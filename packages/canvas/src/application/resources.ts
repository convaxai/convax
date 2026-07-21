import type { CanvasPendingResourceKind, CanvasPoint, CanvasUploadItem } from "../types"
import {
  CanvasCommandValidationError,
  CanvasRevisionConflictError,
  createAddCanvasResourcesCommand,
  createCanvasPendingResourceCommand,
  createRelinkCanvasResourceCommand,
  type CanvasNodeContentGuard,
  type CanvasAddResourcesCommand,
  type CanvasBusinessCommand,
  type CanvasCommandActor,
  type CanvasFailPendingResourceCommand,
  type CanvasReplaceResourceCommand,
} from "./commands"
import { CanvasStorageConflictError, type CanvasDocumentRef } from "./persistence"
import type {
  CanvasApplicationCommandRequest,
  CanvasApplicationCommandResult,
  CanvasApplicationService,
} from "./service"
import { CanvasCommandIdConflictError } from "./service"

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
  commandId: string
  /**
   * Controls whether a concurrent Canvas change may replay this business
   * operation on the latest document. Defaults to `retry`.
   */
  conflictPolicy?: "reject" | "retry"
  expectedRevision: number
  relation?: CanvasAddResourcesCommand["relation"]
  signal?: AbortSignal
  sources: readonly CanvasResourceSource[]
}

export interface CanvasReplaceResourceSourceRequest extends CanvasDocumentRef {
  actor: CanvasCommandActor
  commandId: string
  /** Defaults to retry, guarded by expectedTarget so unrelated edits survive. */
  conflictPolicy?: "reject" | "retry"
  expectedRevision: number
  expectedTarget: CanvasNodeContentGuard
  source: CanvasResourceSource
  signal?: AbortSignal
  targetNodeId: string
}

export interface CanvasCreatePendingResourceRequest extends CanvasDocumentRef {
  actor: CanvasCommandActor
  anchor: CanvasPoint
  commandId: string
  /** Defaults to retry and reuses the same generated node id across replays. */
  conflictPolicy?: "reject" | "retry"
  expectedRevision: number
  kind: CanvasPendingResourceKind
  label?: string
  relation?: CanvasAddResourcesCommand["relation"]
}

export interface CanvasFailPendingResourceRequest extends CanvasDocumentRef {
  actor: CanvasCommandActor
  commandId: string
  /** Defaults to retry, guarded by expectedTarget so a removed node is never recreated. */
  conflictPolicy?: "reject" | "retry"
  expectedRevision: number
  expectedTarget: CanvasNodeContentGuard
  message: string
  targetNodeId: string
}

export interface CanvasRelinkPreparedResourceRequest extends CanvasDocumentRef {
  actor: CanvasCommandActor
  commandId: string
  expectedRevision: number
  metadataKeysToRemove?: readonly string[]
  nodeId: string
}

type CanvasCommandExecutor = Pick<CanvasApplicationService, "execute" | "query">

const maxCanvasResourceConflictRetries = 2

interface CanvasResourceExecution {
  fingerprint: string
  result: Promise<CanvasApplicationCommandResult>
}

/**
 * Headless business orchestration shared by UI actions and Agent tools.
 * Preparation is environment-specific; sizing, placement, relations,
 * revision checks, and persistence stay in the Canvas application layer.
 */
export class CanvasResourceBusinessService {
  private readonly executions = new Map<string, CanvasResourceExecution>()

  constructor(
    private readonly preparation: CanvasResourcePreparationPort,
    private readonly application: CanvasCommandExecutor,
  ) {}

  createPendingResource(request: CanvasCreatePendingResourceRequest): Promise<CanvasApplicationCommandResult> {
    const key = resourceExecutionKey(request)
    const fingerprint = stableJson({
      operation: "pending-create",
      anchor: request.anchor,
      conflictPolicy: request.conflictPolicy ?? "retry",
      expectedRevision: request.expectedRevision,
      kind: request.kind,
      label: request.label,
      relation: request.relation,
    })
    const existing = this.executions.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new CanvasCommandIdConflictError(request.commandId))
      }
      return existing.result
    }

    const result = this.createPendingResourceOnce(request)
    this.rememberExecution(key, fingerprint, result)
    return result
  }

  failPendingResource(request: CanvasFailPendingResourceRequest): Promise<CanvasApplicationCommandResult> {
    const key = resourceExecutionKey(request)
    const fingerprint = stableJson({
      operation: "pending-fail",
      conflictPolicy: request.conflictPolicy ?? "retry",
      expectedRevision: request.expectedRevision,
      expectedTarget: request.expectedTarget,
      message: request.message,
      targetNodeId: request.targetNodeId,
    })
    const existing = this.executions.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new CanvasCommandIdConflictError(request.commandId))
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
          expectedRevision: request.expectedRevision,
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
      conflictPolicy: request.conflictPolicy ?? "retry",
      expectedRevision: request.expectedRevision,
      relation: request.relation,
      sources: request.sources,
      ...(hostPrepared === undefined ? {} : { hostPrepared }),
    })
    const existing = this.executions.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new CanvasCommandIdConflictError(request.commandId))
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
      conflictPolicy: request.conflictPolicy ?? "retry",
      expectedRevision: request.expectedRevision,
      expectedTarget: request.expectedTarget,
      source: request.source,
      targetNodeId: request.targetNodeId,
    })
    const existing = this.executions.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new CanvasCommandIdConflictError(request.commandId))
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
      relation: request.relation,
    })
    return this.executeWithConflictPolicy(request, command, [])
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
    return this.executeWithConflictPolicy(request, command, [])
  }

  private async addResourcesOnce(
    request: CanvasAddResourceSourcesRequest,
    hostPrepared?: CanvasResourcePreparationResult,
  ): Promise<CanvasApplicationCommandResult> {
    throwIfAborted(request.signal)
    validateCanvasResourceCommandIdentity(request)
    if (
      request.conflictPolicy !== undefined &&
      request.conflictPolicy !== "reject" &&
      request.conflictPolicy !== "retry"
    ) {
      throw new CanvasCommandValidationError("Canvas resource conflict policy must be retry or reject")
    }
    const sourceIds = validateCanvasResourceSources(request.sources)
    if (!Number.isFinite(request.anchor.x) || !Number.isFinite(request.anchor.y)) {
      throw new CanvasCommandValidationError("Placement anchor must contain finite coordinates")
    }
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
        anchor: request.anchor,
        items: prepared.items,
        relation: request.relation,
      })
    } catch (error) {
      throwPartialFailureIfRetained(error, retainedOnFailure)
    }
    // Preparation and command creation stay outside the retry loop so one logical
    // operation keeps the same materialized resources and generated node ids.
    let expectedRevision = request.expectedRevision
    let conflictRetries = 0

    while (true) {
      const applicationRequest: CanvasApplicationCommandRequest = {
        canvasId: request.canvasId,
        envelope: {
          actor: request.actor,
          command,
          commandId: request.commandId,
          expectedRevision,
        },
        scopeId: request.scopeId,
      }
      try {
        throwIfAborted(request.signal)
        const result = await this.application.execute({
          ...applicationRequest,
          ...(request.signal ? { signal: request.signal } : {}),
        })
        const replayWarning =
          conflictRetries > 0
            ? [canvasResourceReplayWarning(request.expectedRevision, expectedRevision, conflictRetries)]
            : []
        return {
          ...result,
          warnings: [...(prepared.warnings ?? []), ...result.warnings, ...replayWarning],
        }
      } catch (error) {
        if (
          !isCanvasResourceConflict(error) ||
          request.conflictPolicy === "reject" ||
          conflictRetries >= maxCanvasResourceConflictRetries
        ) {
          throwPartialFailureIfRetained(error, prepared.retainedOnFailure)
        }
        conflictRetries += 1
        // A storage conflict has no document revision, so both conflict types use
        // one fresh query before reapplying the business command.
        throwIfAborted(request.signal)
        let latest: Awaited<ReturnType<CanvasCommandExecutor["query"]>>
        try {
          latest = await this.application.query(
            {
              canvasId: request.canvasId,
              scopeId: request.scopeId,
            },
            { limit: 0 },
          )
        } catch (queryError) {
          throwPartialFailureIfRetained(queryError, prepared.retainedOnFailure)
        }
        throwIfAborted(request.signal)
        expectedRevision = latest.revision
      }
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
        item: prepared.items[0]!,
        targetNodeId: request.targetNodeId,
      }

      return await this.executeWithConflictPolicy(request, command, prepared.warnings ?? [])
    } catch (error) {
      throwPartialFailureIfRetained(error, prepared.retainedOnFailure)
    }
  }

  private async executeWithConflictPolicy(
    request: Pick<
      CanvasReplaceResourceSourceRequest | CanvasCreatePendingResourceRequest | CanvasFailPendingResourceRequest,
      "actor" | "canvasId" | "commandId" | "conflictPolicy" | "expectedRevision" | "scopeId"
    > & { signal?: AbortSignal },
    command: CanvasBusinessCommand,
    preparationWarnings: readonly string[],
  ): Promise<CanvasApplicationCommandResult> {
    let expectedRevision = request.expectedRevision
    let conflictRetries = 0
    while (true) {
      try {
        throwIfAborted(request.signal)
        const result = await this.application.execute({
          canvasId: request.canvasId,
          envelope: {
            actor: request.actor,
            command,
            commandId: request.commandId,
            expectedRevision,
          },
          ...(request.signal ? { signal: request.signal } : {}),
          scopeId: request.scopeId,
        })
        const replayWarning =
          conflictRetries > 0
            ? [canvasResourceReplayWarning(request.expectedRevision, expectedRevision, conflictRetries)]
            : []
        return {
          ...result,
          warnings: [...preparationWarnings, ...result.warnings, ...replayWarning],
        }
      } catch (error) {
        if (
          !isCanvasResourceConflict(error) ||
          request.conflictPolicy === "reject" ||
          conflictRetries >= maxCanvasResourceConflictRetries
        ) {
          throw error
        }
        conflictRetries += 1
        throwIfAborted(request.signal)
        const latest = await this.application.query(
          { canvasId: request.canvasId, scopeId: request.scopeId },
          { limit: 0 },
        )
        throwIfAborted(request.signal)
        expectedRevision = latest.revision
      }
    }
  }
}

function resourceExecutionKey(request: {
  actor: CanvasCommandActor
  canvasId: string
  commandId: string
  scopeId: string
}) {
  return JSON.stringify([request.scopeId, request.canvasId, request.actor.kind, request.actor.id, request.commandId])
}

function validateResourceOperation(request: {
  actor: CanvasCommandActor
  commandId: string
  conflictPolicy?: "reject" | "retry"
  expectedRevision: number
}) {
  if (!request.commandId.trim() || !request.actor.id.trim()) {
    throw new CanvasCommandValidationError("Canvas command and actor ids are required")
  }
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
    throw new CanvasCommandValidationError("Expected canvas revision must be a non-negative integer")
  }
  if (
    request.conflictPolicy !== undefined &&
    request.conflictPolicy !== "reject" &&
    request.conflictPolicy !== "retry"
  ) {
    throw new CanvasCommandValidationError("Canvas resource conflict policy must be retry or reject")
  }
}

function validateCanvasResourceCommandIdentity(request: {
  actor: CanvasCommandActor
  commandId: string
  expectedRevision: number
}) {
  if (!request.commandId.trim() || !request.actor.id.trim() || !request.actor.kind.trim()) {
    throw new CanvasCommandValidationError("Canvas command and actor ids are required")
  }
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
    throw new CanvasCommandValidationError("Expected canvas revision must be a non-negative integer")
  }
}

function isCanvasResourceConflict(error: unknown) {
  return error instanceof CanvasRevisionConflictError || error instanceof CanvasStorageConflictError
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

function canvasResourceReplayWarning(fromRevision: number, latestRevision: number, retries: number) {
  return [
    "Canvas changed while resources were being added;",
    `replayed from revision ${fromRevision} on revision ${latestRevision}`,
    `after ${retries} conflict ${retries === 1 ? "retry" : "retries"}.`,
  ].join(" ")
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
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
