import {
  isCanvasGenerationOperationId,
  isCanvasGenerationTaskId,
} from "@convax/canvas/core"
import path from "node:path"

export const generationRecoveryCapabilitySchema = "convax.generation-recovery/1" as const
export const generationRecoveryRequestSchema = "convax.generation-recovery-request/1" as const
export const generationRecoverySnapshotSchema = "convax.generation-recovery-snapshot/1" as const

export const generationRecoveryMethods = {
  lookup: "convax/generation/operation/lookup",
  query: "convax/generation/task/query",
  await: "convax/generation/task/await",
  cancel: "convax/generation/operation/cancel",
  result: "convax/generation/task/result",
  acknowledge: "convax/generation/operation/acknowledge",
} as const

export type GenerationRecoveryMethod =
  (typeof generationRecoveryMethods)[keyof typeof generationRecoveryMethods]

export interface GenerationRecoveryCapability {
  binding: string
  mode: "operation-exactly-once"
  schema: typeof generationRecoveryCapabilitySchema
}

export interface GenerationRecoveryRequest {
  operationId: string
  outputDirectory?: string
  requestDigest: string
  resultDigest?: string
  schema: typeof generationRecoveryRequestSchema
  taskId?: string
}

export type GenerationRecoverySnapshot =
  | { schema: typeof generationRecoverySnapshotSchema; status: "absent" | "prepared" | "unknown" }
  | {
      schema: typeof generationRecoverySnapshotSchema
      status: "submitted" | "running"
      taskId: string
    }
  | {
      resultDigest: string
      schema: typeof generationRecoverySnapshotSchema
      status: "succeeded"
      taskId: string
    }
  | {
      error: { code: string; message: string }
      schema: typeof generationRecoverySnapshotSchema
      status: "failed"
      taskId?: string
    }
  | {
      schema: typeof generationRecoverySnapshotSchema
      status: "cancelled"
      taskId?: string
    }

const digestPattern = /^[a-f0-9]{64}$/
const bindingPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const errorCodePattern = /^[a-z][a-z0-9._-]{0,63}$/
const unsafeText =
  /(?:authorization|cookie|set-cookie|password|passwd|secret|api[-_ ]?key|access[-_ ]?key|token|bearer|stderr)|(?:file|https?|ftp):\/\/|(?:^|\s)(?:\/|~\/|[A-Za-z]:[\\/]|\\\\)/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(input: Record<string, unknown>, allowed: readonly string[], required: readonly string[]) {
  const permitted = new Set(allowed)
  return Object.keys(input).every((key) => permitted.has(key)) &&
    required.every((key) => Object.prototype.hasOwnProperty.call(input, key))
}

export function normalizeGenerationRecoveryCapability(value: unknown): GenerationRecoveryCapability {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["binding", "mode", "schema"], ["binding", "mode", "schema"]) ||
    value.schema !== generationRecoveryCapabilitySchema ||
    value.mode !== "operation-exactly-once" ||
    typeof value.binding !== "string" ||
    !bindingPattern.test(value.binding) ||
    unsafeText.test(value.binding)
  ) {
    throw new Error("Generation recovery capability is invalid")
  }
  return {
    binding: value.binding,
    mode: "operation-exactly-once",
    schema: generationRecoveryCapabilitySchema,
  }
}

export function requireGenerationRecoveryRequest(
  value: Omit<GenerationRecoveryRequest, "schema">,
  options: { allowOutputDirectory?: boolean } = {},
): GenerationRecoveryRequest {
  if (
    !isCanvasGenerationOperationId(value.operationId) ||
    !digestPattern.test(value.requestDigest) ||
    (value.resultDigest !== undefined && !digestPattern.test(value.resultDigest)) ||
    (value.outputDirectory !== undefined &&
      (!options.allowOutputDirectory ||
        !path.isAbsolute(value.outputDirectory) ||
        value.outputDirectory.includes("\0") ||
        value.outputDirectory.length > 4_096)) ||
    (value.taskId !== undefined && !isCanvasGenerationTaskId(value.taskId))
  ) {
    throw new Error("Generation recovery request is invalid")
  }
  return {
    operationId: value.operationId,
    ...(value.outputDirectory === undefined ? {} : { outputDirectory: value.outputDirectory }),
    requestDigest: value.requestDigest,
    schema: generationRecoveryRequestSchema,
    ...(value.resultDigest === undefined ? {} : { resultDigest: value.resultDigest }),
    ...(value.taskId === undefined ? {} : { taskId: value.taskId }),
  }
}

function safeError(value: unknown) {
  if (!isRecord(value) || !exactKeys(value, ["code", "message"], ["code", "message"])) {
    throw new Error("Generation recovery error is not host-safe")
  }
  if (
    typeof value.code !== "string" ||
    !errorCodePattern.test(value.code) ||
    typeof value.message !== "string" ||
    value.message !== value.message.trim() ||
    !value.message ||
    value.message.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(value.message) ||
    unsafeText.test(value.message)
  ) {
    throw new Error("Generation recovery error is not host-safe")
  }
  return { code: value.code, message: value.message }
}

export function normalizeGenerationRecoverySnapshot(value: unknown): GenerationRecoverySnapshot {
  if (!isRecord(value) || value.schema !== generationRecoverySnapshotSchema || typeof value.status !== "string") {
    throw new Error("Generation recovery snapshot is invalid")
  }
  const base = { schema: generationRecoverySnapshotSchema }
  if (value.status === "absent" || value.status === "prepared" || value.status === "unknown") {
    if (!exactKeys(value, ["schema", "status"], ["schema", "status"])) {
      throw new Error("Generation recovery snapshot is invalid")
    }
    return { ...base, status: value.status }
  }
  if (value.status === "submitted" || value.status === "running") {
    if (
      !exactKeys(value, ["schema", "status", "taskId"], ["schema", "status", "taskId"]) ||
      !isCanvasGenerationTaskId(value.taskId)
    ) {
      throw new Error("Generation recovery snapshot is invalid")
    }
    return { ...base, status: value.status, taskId: value.taskId }
  }
  if (value.status === "succeeded") {
    if (
      !exactKeys(
        value,
        ["resultDigest", "schema", "status", "taskId"],
        ["resultDigest", "schema", "status", "taskId"],
      ) ||
      !isCanvasGenerationTaskId(value.taskId) ||
      typeof value.resultDigest !== "string" ||
      !digestPattern.test(value.resultDigest)
    ) {
      throw new Error("Generation recovery snapshot is invalid")
    }
    return {
      ...base,
      resultDigest: value.resultDigest,
      status: "succeeded",
      taskId: value.taskId,
    }
  }
  if (value.status === "failed") {
    if (
      !exactKeys(value, ["error", "schema", "status", "taskId"], ["error", "schema", "status"]) ||
      (value.taskId !== undefined && !isCanvasGenerationTaskId(value.taskId))
    ) {
      throw new Error("Generation recovery snapshot is invalid")
    }
    return {
      ...base,
      error: safeError(value.error),
      status: "failed",
      ...(value.taskId === undefined ? {} : { taskId: value.taskId }),
    }
  }
  if (value.status === "cancelled") {
    if (
      !exactKeys(value, ["schema", "status", "taskId"], ["schema", "status"]) ||
      (value.taskId !== undefined && !isCanvasGenerationTaskId(value.taskId))
    ) {
      throw new Error("Generation recovery snapshot is invalid")
    }
    return {
      ...base,
      status: "cancelled",
      ...(value.taskId === undefined ? {} : { taskId: value.taskId }),
    }
  }
  throw new Error("Generation recovery snapshot is invalid")
}
