import {
  getCanvasGenerationInputError,
  getCanvasGenerationReferenceError,
  getCompatibleCanvasGenerationTools,
  inferCanvasGenerationInputs,
  type CanvasGenerateService,
  type CanvasGenerationInputRole,
  type CanvasGenerationReference,
  type CanvasGenerationToolInput,
  type CanvasGenerationToolSummary,
} from "./services"
import type { CanvasDocument } from "./types"

export type CanvasGenerationImageRole = Extract<
  CanvasGenerationInputRole,
  "reference_image" | "first_frame" | "last_frame"
>

export type CanvasGenerationCatalogStatus = "idle" | "loading" | "ready" | "error"

export interface CanvasGenerationComposerProjection {
  compatibleTools: readonly CanvasGenerationToolSummary[]
  documentId: string
  inferredReferences: readonly CanvasGenerationReference[]
  inputError?: string
  promptContextNodeIds: readonly string[]
  referenceError?: string
  references: readonly CanvasGenerationReference[]
  selectedNodeIds: readonly string[]
  selectedTool?: CanvasGenerationToolSummary
}

export interface CanvasGenerationComposerSubmission {
  documentId: string
  prompt: string
  promptContextNodeIds: readonly string[]
  references: readonly CanvasGenerationReference[]
  scopeId: string
  selectedNodeIds: readonly string[]
  tool: CanvasGenerationToolSummary
  toolInput?: CanvasGenerationToolInput
}

export interface CanvasGenerationCatalogRequest {
  readonly key: string
  readonly signal: AbortSignal
}

export function isCanvasGenerationImageRole(value: string): value is CanvasGenerationImageRole {
  return value === "reference_image" || value === "first_frame" || value === "last_frame"
}

export function assignCanvasGenerationImageRole(
  current: Readonly<Record<string, CanvasGenerationImageRole>>,
  nodeId: string,
  role: CanvasGenerationImageRole,
): Readonly<Record<string, CanvasGenerationImageRole>> {
  const next = { ...current }
  if (role === "first_frame" || role === "last_frame") {
    for (const [candidateId, candidateRole] of Object.entries(next)) {
      if (candidateId !== nodeId && candidateRole === role) delete next[candidateId]
    }
  }
  next[nodeId] = role
  return next
}

export function reconcileCanvasGenerationImageRoles(
  current: Readonly<Record<string, CanvasGenerationImageRole>>,
  inferredReferences: readonly CanvasGenerationReference[],
): Readonly<Record<string, CanvasGenerationImageRole>> {
  const imageNodeIds = new Set(
    inferredReferences.filter((reference) => reference.role === "reference_image").map((reference) => reference.nodeId),
  )
  const next = Object.fromEntries(Object.entries(current).filter(([nodeId]) => imageNodeIds.has(nodeId)))
  return shallowEqualRecords(current, next) ? current : next
}

export function projectCanvasGenerationComposer(input: {
  document: CanvasDocument
  imageRoles: Readonly<Record<string, CanvasGenerationImageRole>>
  selectedNodeIds: readonly string[]
  selectedToolId: string
  tools: readonly CanvasGenerationToolSummary[]
}): CanvasGenerationComposerProjection {
  const inferredInputs = inferCanvasGenerationInputs(input.document.nodes, input.selectedNodeIds)
  const inferredReferences = inferredInputs.references
  const references = inferredReferences.map((reference) =>
    reference.role === "reference_image" && input.imageRoles[reference.nodeId]
      ? { ...reference, role: input.imageRoles[reference.nodeId] }
      : reference,
  )
  const referenceError = getCanvasGenerationReferenceError(references)
  const inputError = getCanvasGenerationInputError({
    promptContextNodeIds: inferredInputs.promptContextNodeIds,
    references,
  })
  const compatibleTools = inputError ? [] : getCompatibleCanvasGenerationTools(input.tools, references)
  return {
    compatibleTools,
    documentId: input.document.id,
    inferredReferences,
    ...(inputError ? { inputError } : {}),
    promptContextNodeIds: [...inferredInputs.promptContextNodeIds],
    ...(referenceError ? { referenceError } : {}),
    references,
    selectedNodeIds: [...input.selectedNodeIds],
    selectedTool: compatibleTools.find((tool) => tool.id === input.selectedToolId),
  }
}

export function resolveCanvasGenerationToolId(
  currentToolId: string,
  compatibleTools: readonly CanvasGenerationToolSummary[],
) {
  return compatibleTools.some((tool) => tool.id === currentToolId) ? currentToolId : (compatibleTools[0]?.id ?? "")
}

export function createCanvasGenerationComposerSubmission(input: {
  catalogStatus: CanvasGenerationCatalogStatus
  document: CanvasDocument
  prompt: string
  projection: CanvasGenerationComposerProjection
  scopeId: string
  selectedNodeIds: readonly string[]
  toolInput?: CanvasGenerationToolInput
}): CanvasGenerationComposerSubmission | undefined {
  const prompt = input.prompt.trim()
  if (
    input.catalogStatus !== "ready" ||
    (!prompt && input.projection.promptContextNodeIds.length === 0) ||
    !input.projection.selectedTool ||
    input.projection.documentId !== input.document.id ||
    !equalStrings(input.projection.selectedNodeIds, input.selectedNodeIds)
  )
    return undefined
  return {
    documentId: input.document.id,
    prompt,
    promptContextNodeIds: [...input.projection.promptContextNodeIds],
    references: input.projection.references,
    scopeId: input.scopeId,
    selectedNodeIds: [...input.selectedNodeIds],
    tool: input.projection.selectedTool,
    ...(input.toolInput ? { toolInput: { ...input.toolInput } } : {}),
  }
}

export function isCanvasGenerationComposerSubmissionCurrent(
  submission: CanvasGenerationComposerSubmission,
  current: { documentId: string; scopeId: string },
) {
  return submission.documentId === current.documentId && submission.scopeId === current.scopeId
}

/**
 * Owns only pre-submit catalog discovery. Generation operation signals intentionally
 * live outside this tracker so closing a composer cannot cancel Main-accepted work.
 */
export class CanvasGenerationCatalogRequestTracker {
  #active: { controller: AbortController; key: string } | undefined

  begin(input: {
    catalogVersion?: CanvasGenerateService["catalogVersion"]
    documentId: string
    scopeId: string
  }): CanvasGenerationCatalogRequest {
    this.cancel()
    const key = `${input.scopeId}\0${input.documentId}\0${String(input.catalogVersion ?? "")}`
    const controller = new AbortController()
    this.#active = { controller, key }
    return { key, signal: controller.signal }
  }

  cancel(request?: CanvasGenerationCatalogRequest) {
    if (
      !this.#active ||
      (request && (request.key !== this.#active.key || request.signal !== this.#active.controller.signal))
    )
      return
    this.#active.controller.abort()
    this.#active = undefined
  }

  isCurrent(request: CanvasGenerationCatalogRequest) {
    return Boolean(
      this.#active &&
        this.#active.key === request.key &&
        this.#active.controller.signal === request.signal &&
        !request.signal.aborted,
    )
  }
}

function shallowEqualRecords(
  left: Readonly<Record<string, CanvasGenerationImageRole>>,
  right: Readonly<Record<string, CanvasGenerationImageRole>>,
) {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  return leftEntries.length === rightEntries.length && leftEntries.every(([key, value]) => right[key] === value)
}

function equalStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
