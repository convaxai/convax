import type { CanvasPoint, CanvasTextFormat, CanvasUploadItem } from "../types"
import {
  CanvasCommandValidationError,
  CanvasRevisionConflictError,
  createAddCanvasResourcesCommand,
  type CanvasAddResourcesCommand,
  type CanvasCommandActor,
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
      kind: "inline-text"
      format?: CanvasTextFormat
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
  | (CanvasResourceSourceBase & {
      kind: "remote-url"
      mimeType?: string
      name?: string
      url: string
    })

export interface CanvasResourcePreparationRequest extends CanvasDocumentRef {
  sources: readonly CanvasResourceSource[]
}

export interface CanvasResourcePreparationResult {
  items: readonly CanvasUploadItem[]
  warnings?: readonly string[]
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
  sources: readonly CanvasResourceSource[]
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

  addResources(request: CanvasAddResourceSourcesRequest): Promise<CanvasApplicationCommandResult> {
    const key = JSON.stringify([
      request.scopeId,
      request.canvasId,
      request.actor.kind,
      request.actor.id,
      request.commandId,
    ])
    const fingerprint = stableJson({
      anchor: request.anchor,
      conflictPolicy: request.conflictPolicy ?? "retry",
      expectedRevision: request.expectedRevision,
      relation: request.relation,
      sources: request.sources,
    })
    const existing = this.executions.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(new CanvasCommandIdConflictError(request.commandId))
      }
      return existing.result
    }

    const result = this.addResourcesOnce(request)
    const execution = { fingerprint, result }
    this.executions.set(key, execution)
    if (this.executions.size > 1_000) this.executions.delete(this.executions.keys().next().value ?? "")
    void result.catch(() => {
      if (this.executions.get(key) === execution) this.executions.delete(key)
    })
    return result
  }

  private async addResourcesOnce(request: CanvasAddResourceSourcesRequest): Promise<CanvasApplicationCommandResult> {
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
    validateCanvasResourceSources(request.sources)
    if (!Number.isFinite(request.anchor.x) || !Number.isFinite(request.anchor.y)) {
      throw new CanvasCommandValidationError("Placement anchor must contain finite coordinates")
    }

    const prepared = await this.preparation.prepare({
      canvasId: request.canvasId,
      scopeId: request.scopeId,
      sources: request.sources,
    })
    validatePreparedCanvasResources(prepared)
    const command = createAddCanvasResourcesCommand({
      anchor: request.anchor,
      items: prepared.items,
      relation: request.relation,
    })
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
        const result = await this.application.execute(applicationRequest)
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
          throw error
        }
        conflictRetries += 1
        // A storage conflict has no document revision, so both conflict types use
        // one fresh query before reapplying the business command.
        const latest = await this.application.query(
          {
            canvasId: request.canvasId,
            scopeId: request.scopeId,
          },
          { limit: 0 },
        )
        expectedRevision = latest.revision
      }
    }
  }
}

function isCanvasResourceConflict(error: unknown) {
  return error instanceof CanvasRevisionConflictError || error instanceof CanvasStorageConflictError
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
    } else if (source.kind === "remote-url") requireNonEmptyString(source.url, "Resource URL")
    else if (source.kind === "inline-text") {
      if (typeof source.text !== "string") throw new CanvasCommandValidationError("Inline resource text is required")
      if (source.format !== undefined && source.format !== "markdown" && source.format !== "plain") {
        throw new CanvasCommandValidationError(`Unsupported inline text format: ${String(source.format)}`)
      }
    } else {
      throw new CanvasCommandValidationError(`Unsupported canvas resource source: ${String(source.kind)}`)
    }
  }
}

function validatePreparedCanvasResources(prepared: CanvasResourcePreparationResult) {
  if (!isRecord(prepared) || !Array.isArray(prepared.items)) {
    throw new CanvasCommandValidationError("Resource preparation must return an item array")
  }
  for (const item of prepared.items) {
    if (!isRecord(item)) throw new CanvasCommandValidationError("Prepared canvas resource is invalid")
    requireNonEmptyString(item.id, "Prepared resource id")
    if (item.kind === "text") {
      if (typeof item.text !== "string") throw new CanvasCommandValidationError("Prepared text resource is invalid")
      continue
    }
    if (item.kind === "folder") {
      requireNonEmptyString(item.name, "Prepared folder name")
      if (item.path !== undefined) requireNonEmptyString(item.path, "Prepared folder path")
      continue
    }
    if (item.kind !== "audio" && item.kind !== "file" && item.kind !== "image" && item.kind !== "video") {
      throw new CanvasCommandValidationError(`Unsupported prepared resource kind: ${String(item.kind)}`)
    }
    if (typeof item.url !== "string") throw new CanvasCommandValidationError("Prepared media resource URL is required")
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
}

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new CanvasCommandValidationError(`${label} is required`)
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
