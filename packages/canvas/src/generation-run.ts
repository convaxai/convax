import type { CanvasDocument, CanvasNode } from "./types"
import { isCanvasGenerationToolId } from "./generation-preference"

export const canvasNodeGenerationRunKey = "convaxGenerationRun"
export const canvasNodeGenerationRunSchemaV1 = "convax.node-generation-run/1"
export const canvasNodeGenerationRunSchema = "convax.node-generation-run/2"
export const maximumCanvasGenerationPromptLength = 64 * 1024

const maximumGenerationOperationIdLength = 128
const maximumGenerationTaskIdLength = 512
const maximumSerializedGenerationRunLength = 192 * 1024
const generationOperationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const generationTaskIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/
const unsafeGenerationTaskIdSegment =
  /(?:^|[._:-])(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|access[-_]?key|ak|sk)(?:[._:-]|$)/i

export type CanvasNodeGenerationRunStatus =
  | "submitting"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted"

export interface CanvasNodeGenerationRun {
  operationId: string
  prompt: string
  retrySafety?: "safe" | "unknown"
  schema: typeof canvasNodeGenerationRunSchema
  status: CanvasNodeGenerationRunStatus
  taskId?: string
  toolId: string
}

export type CanvasNodeGenerationRunInspection =
  | { kind: "absent" }
  | { kind: "unreadable"; value: unknown }
  | { kind: "valid"; run: CanvasNodeGenerationRun }

export class CanvasNodeGenerationRunValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CanvasNodeGenerationRunValidationError"
  }
}

const generationRunStatuses = [
  "submitting",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
] as const satisfies readonly CanvasNodeGenerationRunStatus[]

const terminalGenerationRunStatuses = new Set<CanvasNodeGenerationRunStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
])

function isRetrySafety(value: unknown): value is NonNullable<CanvasNodeGenerationRun["retrySafety"]> {
  return value === "safe" || value === "unknown"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]) {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every((key) => allowedKeys.has(key)) && required.every((key) => hasOwn(value, key))
}

export function isCanvasGenerationOperationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumGenerationOperationIdLength &&
    generationOperationIdPattern.test(value)
  )
}

export function isCanvasGenerationTaskId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumGenerationTaskIdLength &&
    generationTaskIdPattern.test(value) &&
    !unsafeGenerationTaskIdSegment.test(value)
  )
}

export function isCanvasGenerationPrompt(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumCanvasGenerationPromptLength &&
    value === value.trim() &&
    !value.includes("\0")
  )
}

export function isCanvasNodeGenerationRunActive(run: CanvasNodeGenerationRun) {
  return run.status === "submitting" || run.status === "running"
}

export function isCanvasNodeGenerationRunTerminal(run: CanvasNodeGenerationRun) {
  return terminalGenerationRunStatuses.has(run.status)
}

function isCanvasNodeGenerationRunStatus(value: unknown): value is CanvasNodeGenerationRunStatus {
  return generationRunStatuses.some((status) => status === value)
}

export function parseCanvasNodeGenerationRun(value: unknown): CanvasNodeGenerationRun | undefined {
  if (!isRecord(value)) return undefined
  const isLegacy = value.schema === canvasNodeGenerationRunSchemaV1
  if (
    !hasExactKeys(
      value,
      isLegacy
        ? ["operationId", "prompt", "schema", "status", "taskId", "toolId"]
        : ["operationId", "prompt", "retrySafety", "schema", "status", "taskId", "toolId"],
      ["operationId", "prompt", "schema", "status", "toolId"],
    ) ||
    (!isLegacy && value.schema !== canvasNodeGenerationRunSchema) ||
    !isCanvasGenerationOperationId(value.operationId) ||
    !isCanvasGenerationPrompt(value.prompt) ||
    !isCanvasGenerationToolId(value.toolId) ||
    !isCanvasNodeGenerationRunStatus(value.status) ||
    (value.taskId !== undefined && !isCanvasGenerationTaskId(value.taskId)) ||
    (!isLegacy && value.retrySafety !== undefined && !isRetrySafety(value.retrySafety))
  ) {
    return undefined
  }
  const retrySafety: CanvasNodeGenerationRun["retrySafety"] =
    isLegacy && value.status !== "succeeded" && terminalGenerationRunStatuses.has(value.status)
      ? "unknown"
      : isRetrySafety(value.retrySafety)
        ? value.retrySafety
        : undefined
  if (
    (value.status === "submitting" || value.status === "running" || value.status === "succeeded") &&
    retrySafety !== undefined
  ) {
    return undefined
  }
  if (
    (value.status === "failed" || value.status === "cancelled" || value.status === "interrupted") &&
    retrySafety === undefined
  ) {
    return undefined
  }
  const run: CanvasNodeGenerationRun = {
    operationId: value.operationId,
    prompt: value.prompt,
    ...(retrySafety === undefined ? {} : { retrySafety }),
    schema: canvasNodeGenerationRunSchema,
    status: value.status,
    ...(value.taskId === undefined ? {} : { taskId: value.taskId }),
    toolId: value.toolId,
  }
  let serialized: string
  try {
    serialized = JSON.stringify(run)
  } catch {
    return undefined
  }
  if (serialized.length > maximumSerializedGenerationRunLength) return undefined
  return structuredClone(run)
}

export function inspectCanvasNodeGenerationRun(node: CanvasNode): CanvasNodeGenerationRunInspection {
  const metadata = node.data.metadata
  if (!isRecord(metadata) || !hasOwn(metadata, canvasNodeGenerationRunKey)) return { kind: "absent" }
  const value = metadata[canvasNodeGenerationRunKey]
  const run = parseCanvasNodeGenerationRun(value)
  return run ? { kind: "valid", run } : { kind: "unreadable", value }
}

export function getCanvasNodeGenerationRun(node: CanvasNode): CanvasNodeGenerationRun | undefined {
  const inspected = inspectCanvasNodeGenerationRun(node)
  return inspected.kind === "valid" ? inspected.run : undefined
}

export function startCanvasNodeGenerationRun(
  document: CanvasDocument,
  nodeId: string,
  input: { operationId: string; prompt: string; toolId: string },
): CanvasDocument {
  requireRunInput(input)
  const node = requireNode(document, nodeId)
  if (node.type !== "file" || node.data.kind === "group") {
    throw new CanvasNodeGenerationRunValidationError("Canvas generation run requires a file node")
  }
  const current = inspectCanvasNodeGenerationRun(node)
  if (current.kind === "unreadable") {
    throw new CanvasNodeGenerationRunValidationError("Canvas node generation run uses an unreadable schema")
  }
  if (current.kind === "valid" && isCanvasNodeGenerationRunActive(current.run)) {
    throw new CanvasNodeGenerationRunValidationError("Canvas node already has an active generation run")
  }
  if (
    current.kind === "valid" &&
    current.run.status !== "succeeded" &&
    current.run.retrySafety === "unknown"
  ) {
    throw new CanvasNodeGenerationRunValidationError(
      "Canvas node generation retry safety is unknown",
    )
  }
  return setRun(document, nodeId, {
    operationId: input.operationId,
    prompt: input.prompt,
    schema: canvasNodeGenerationRunSchema,
    status: "submitting",
    toolId: input.toolId,
  })
}

export function markCanvasNodeGenerationRunRunning(
  document: CanvasDocument,
  nodeId: string,
  operationId: string,
  taskId?: string,
): CanvasDocument {
  if (!isCanvasGenerationOperationId(operationId)) {
    throw new CanvasNodeGenerationRunValidationError("Canvas generation operation id is invalid")
  }
  if (taskId !== undefined && !isCanvasGenerationTaskId(taskId)) {
    throw new CanvasNodeGenerationRunValidationError("Canvas generation task id is invalid")
  }
  const run = requireReadableRun(document, nodeId, operationId)
  if (run.status !== "submitting" && run.status !== "running") {
    throw new CanvasNodeGenerationRunValidationError("Canvas generation run cannot return to running")
  }
  if (run.taskId !== undefined && taskId !== undefined && run.taskId !== taskId) {
    throw new CanvasNodeGenerationRunValidationError("Canvas generation run received a different task id")
  }
  const resolvedTaskId = run.taskId ?? taskId
  const next = {
    ...run,
    status: "running" as const,
    ...(resolvedTaskId === undefined ? {} : { taskId: resolvedTaskId }),
  }
  if (sameRun(run, next)) return document
  return setRun(document, nodeId, next)
}

export function finishCanvasNodeGenerationRun(
  document: CanvasDocument,
  nodeId: string,
  operationId: string,
  status: "failed" | "cancelled" | "interrupted",
  retrySafety: "safe" | "unknown",
): CanvasDocument {
  if (!isRetrySafety(retrySafety)) {
    throw new CanvasNodeGenerationRunValidationError("Canvas generation retry safety is invalid")
  }
  const run = requireReadableRun(document, nodeId, operationId)
  if (!isCanvasNodeGenerationRunActive(run)) {
    throw new CanvasNodeGenerationRunValidationError("Canvas generation run is already terminal")
  }
  const next = setRun(document, nodeId, { ...run, retrySafety, status })
  return finishPendingResourcePresentation(next, nodeId, status)
}

/** Used only by the atomic generated-resource replacement command. */
export function succeedCanvasNodeGenerationRun(
  document: CanvasDocument,
  nodeId: string,
  operationId: string,
): CanvasDocument {
  const run = requireReadableRun(document, nodeId, operationId)
  if (!isCanvasNodeGenerationRunActive(run)) {
    throw new CanvasNodeGenerationRunValidationError("Canvas generation run is already terminal")
  }
  return setRun(document, nodeId, { ...run, status: "succeeded" })
}

export function interruptInactiveCanvasNodeGenerationRuns(
  document: CanvasDocument,
  liveRuns: readonly { nodeId: string; operationId: string }[],
): CanvasDocument {
  const live = new Set(liveRuns.map((run) => `${run.nodeId}\0${run.operationId}`))
  let next = document
  for (const node of document.nodes) {
    const inspected = inspectCanvasNodeGenerationRun(node)
    if (
      inspected.kind !== "valid" ||
      !isCanvasNodeGenerationRunActive(inspected.run) ||
      live.has(`${node.id}\0${inspected.run.operationId}`)
    ) {
      continue
    }
    next = finishCanvasNodeGenerationRun(next, node.id, inspected.run.operationId, "interrupted", "unknown")
  }
  return next
}

/** Removes active task ownership while retaining portable generation history on a clone. */
export function cloneCanvasNodeGenerationRunData(data: CanvasNode["data"]): CanvasNode["data"] {
  const metadata = data.metadata
  if (!isRecord(metadata)) return data
  const run = parseCanvasNodeGenerationRun(metadata[canvasNodeGenerationRunKey])
  if (!run || !isCanvasNodeGenerationRunActive(run)) return data
  const nextMetadata = {
    ...structuredClone(metadata),
    [canvasNodeGenerationRunKey]: {
      ...run,
      retrySafety: "unknown" as const,
      status: "interrupted" as const,
      taskId: undefined,
    },
  }
  delete (nextMetadata[canvasNodeGenerationRunKey] as Record<string, unknown>).taskId
  return {
    ...data,
    ...(data.status === "pending"
      ? {
          error: pendingGenerationTerminalMessage("interrupted"),
          status: "error" as const,
        }
      : {}),
    metadata: nextMetadata,
  }
}

export function omitCanvasNodeGenerationRunFromData(data: CanvasNode["data"]): CanvasNode["data"] {
  const metadata = data.metadata
  if (!isRecord(metadata) || !hasOwn(metadata, canvasNodeGenerationRunKey)) return structuredClone(data)
  const nextMetadata = { ...structuredClone(metadata) }
  delete nextMetadata[canvasNodeGenerationRunKey]
  if (Object.keys(nextMetadata).length === 0) {
    const { metadata: _metadata, ...withoutMetadata } = structuredClone(data)
    return withoutMetadata as CanvasNode["data"]
  }
  return { ...structuredClone(data), metadata: nextMetadata }
}

function requireRunInput(input: { operationId: string; prompt: string; toolId: string }) {
  if (!isCanvasGenerationOperationId(input.operationId)) {
    throw new CanvasNodeGenerationRunValidationError("Canvas generation operation id is invalid")
  }
  if (!isCanvasGenerationPrompt(input.prompt)) {
    throw new CanvasNodeGenerationRunValidationError("Canvas generation prompt is invalid")
  }
  if (!isCanvasGenerationToolId(input.toolId)) {
    throw new CanvasNodeGenerationRunValidationError("Canvas generation tool id is invalid")
  }
}

function requireNode(document: CanvasDocument, nodeId: string) {
  const node = document.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) throw new CanvasNodeGenerationRunValidationError(`Canvas node was not found: ${nodeId}`)
  return node
}

function requireReadableRun(document: CanvasDocument, nodeId: string, operationId: string) {
  if (!isCanvasGenerationOperationId(operationId)) {
    throw new CanvasNodeGenerationRunValidationError("Canvas generation operation id is invalid")
  }
  const inspected = inspectCanvasNodeGenerationRun(requireNode(document, nodeId))
  if (inspected.kind !== "valid") {
    throw new CanvasNodeGenerationRunValidationError("Canvas node generation run is missing or unreadable")
  }
  if (inspected.run.operationId !== operationId) {
    throw new CanvasNodeGenerationRunValidationError("Canvas generation operation id does not own this run")
  }
  return inspected.run
}

function setRun(document: CanvasDocument, nodeId: string, run: CanvasNodeGenerationRun) {
  const parsed = parseCanvasNodeGenerationRun(run)
  if (!parsed) throw new CanvasNodeGenerationRunValidationError("Canvas generation run is invalid")
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (node.id !== nodeId) return node
      const metadata = isRecord(node.data.metadata) ? node.data.metadata : {}
      return {
        ...node,
        data: {
          ...node.data,
          metadata: {
            ...metadata,
            [canvasNodeGenerationRunKey]: parsed,
          },
        },
      }
    }),
  }
}

function finishPendingResourcePresentation(
  document: CanvasDocument,
  nodeId: string,
  status: "failed" | "cancelled" | "interrupted",
) {
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === nodeId && node.data.status === "pending"
        ? {
            ...node,
            data: {
              ...node.data,
              error: pendingGenerationTerminalMessage(status),
              status: "error" as const,
            },
          }
        : node,
    ),
  }
}

function pendingGenerationTerminalMessage(status: "failed" | "cancelled" | "interrupted") {
  if (status === "cancelled") return "Generation was canceled"
  if (status === "interrupted") return "Generation was interrupted"
  return "Generation could not be completed"
}

function sameRun(left: CanvasNodeGenerationRun, right: CanvasNodeGenerationRun) {
  return JSON.stringify(left) === JSON.stringify(right)
}
