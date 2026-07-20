import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from "electron"

import {
  generationIpcChannels,
  type GenerationCanvasRequest,
  type GenerationCanvasResult,
  type GenerationDescribeToolRequest,
  type GenerationInputRole,
  type GenerationListToolsRequest,
  type GenerationOutputModality,
  type GenerationToolDescription,
  type GenerationToolSummary,
} from "../generation-contracts"
import { validateGenerationToolInputShape } from "./generation-tool-input-schema"

export { generationIpcChannels } from "../generation-contracts"

export interface GenerationExecutor {
  describeTool(request: GenerationDescribeToolRequest, signal?: AbortSignal): Promise<GenerationToolDescription>
  generate(request: GenerationCanvasRequest, signal?: AbortSignal): Promise<GenerationCanvasResult>
  listTools(request: GenerationListToolsRequest): Promise<readonly GenerationToolSummary[]>
}

export interface GenerationIpcOptions {
  isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean
}

interface SenderOperations {
  readonly controllers: Map<string, AbortController>
  readonly destroyed: () => void
  readonly sender: WebContents
}

const operationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/
const hostToolIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const outputModalities = ["text", "image", "video", "audio"] as const satisfies readonly GenerationOutputModality[]
const inputRoles = [
  "text",
  "reference_image",
  "reference_video",
  "first_frame",
  "last_frame",
  "audio",
] as const satisfies readonly GenerationInputRole[]

function abortError(message: string) {
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} is invalid`)
  return Object.fromEntries(Object.entries(value))
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
) {
  const allowedKeys = new Set(allowed)
  if (Object.keys(value).some((key) => !allowedKeys.has(key)) || required.some((key) => !(key in value))) {
    throw new Error(`${label} is invalid`)
  }
}

function requireOpaqueId(value: unknown, label: string) {
  if (typeof value !== "string" || !opaqueIdPattern.test(value)) throw new Error(`${label} is invalid`)
  return value
}

function requireOperationId(input: unknown) {
  const value = requireRecord(input, "Generation cancellation request")
  requireExactKeys(value, ["operationId"], ["operationId"], "Generation cancellation request")
  if (typeof value.operationId !== "string" || !operationIdPattern.test(value.operationId)) {
    throw new Error("Generation operation id is invalid")
  }
  return value.operationId
}

function requireOutput(value: unknown, label: string): GenerationOutputModality {
  const output = outputModalities.find((candidate) => candidate === value)
  if (!output) throw new Error(`${label} is invalid`)
  return output
}

function requireRole(value: unknown): GenerationInputRole {
  const role = inputRoles.find((candidate) => candidate === value)
  if (!role) throw new Error("Generation reference role is invalid")
  return role
}

function requireHostToolId(value: unknown) {
  if (typeof value !== "string" || !hostToolIdPattern.test(value)) {
    throw new Error("Generation tool id is invalid")
  }
  return value
}

export function parseGenerationListToolsRequest(input: unknown): GenerationListToolsRequest {
  const value = requireRecord(input, "Generation tool list request")
  requireExactKeys(value, ["output", "scopeId"], ["scopeId"], "Generation tool list request")
  return {
    ...(value.output === undefined ? {} : { output: requireOutput(value.output, "Generation output modality") }),
    scopeId: requireOpaqueId(value.scopeId, "Generation scope id"),
  }
}

export function parseGenerationDescribeToolRequest(input: unknown): GenerationDescribeToolRequest {
  const value = requireRecord(input, "Generation tool description request")
  requireExactKeys(value, ["scopeId", "toolId"], ["scopeId", "toolId"], "Generation tool description request")
  return {
    scopeId: requireOpaqueId(value.scopeId, "Generation scope id"),
    toolId: requireHostToolId(value.toolId),
  }
}

export function parseGenerationCanvasRequest(input: unknown): GenerationCanvasRequest {
  const value = requireRecord(input, "Generation request")
  requireExactKeys(
    value,
    [
      "anchor",
      "expectedRevision",
      "operationId",
      "output",
      "prompt",
      "ref",
      "referenceConstraint",
      "references",
      "toolId",
      "toolInput",
    ],
    ["anchor", "expectedRevision", "operationId", "prompt", "ref", "references"],
    "Generation request",
  )

  const operationId = requireOperationId({ operationId: value.operationId })
  const ref = requireRecord(value.ref, "Generation Canvas reference")
  requireExactKeys(ref, ["canvasId", "scopeId"], ["canvasId", "scopeId"], "Generation Canvas reference")
  const expectedRevision = value.expectedRevision
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("Generation expected revision is invalid")
  }
  const prompt = value.prompt
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 64 * 1024 || prompt.includes("\0")) {
    throw new Error("Generation prompt is invalid")
  }
  const toolId = value.toolId === undefined ? undefined : requireHostToolId(value.toolId)

  const anchor = requireRecord(value.anchor, "Generation anchor")
  requireExactKeys(anchor, ["x", "y"], ["x", "y"], "Generation anchor")
  if (
    typeof anchor.x !== "number" ||
    typeof anchor.y !== "number" ||
    !Number.isFinite(anchor.x) ||
    !Number.isFinite(anchor.y)
  ) {
    throw new Error("Generation anchor is invalid")
  }

  if (!Array.isArray(value.references) || value.references.length > 32) {
    throw new Error("Generation references are invalid")
  }
  const referencePairs = new Set<string>()
  const references = value.references.map((inputReference) => {
    const reference = requireRecord(inputReference, "Generation reference")
    requireExactKeys(reference, ["nodeId", "role"], ["nodeId", "role"], "Generation reference")
    const nodeId = requireOpaqueId(reference.nodeId, "Generation reference node id")
    const role = requireRole(reference.role)
    const key = `${nodeId}\0${role}`
    if (referencePairs.has(key)) throw new Error("Generation references contain a duplicate node and role")
    referencePairs.add(key)
    return { nodeId, role }
  })

  let referenceConstraint: GenerationCanvasRequest["referenceConstraint"]
  if (value.referenceConstraint !== undefined) {
    const constraint = requireRecord(value.referenceConstraint, "Generation reference constraint")
    requireExactKeys(constraint, ["ownerNodeId", "type"], ["ownerNodeId", "type"], "Generation reference constraint")
    if (constraint.type !== "direct-incoming") throw new Error("Generation reference constraint is invalid")
    referenceConstraint = {
      ownerNodeId: requireOpaqueId(constraint.ownerNodeId, "Generation reference owner node id"),
      type: "direct-incoming",
    }
  }

  return {
    anchor: { x: anchor.x, y: anchor.y },
    expectedRevision,
    operationId,
    ...(value.output === undefined ? {} : { output: requireOutput(value.output, "Generation output modality") }),
    prompt,
    ref: {
      canvasId: requireOpaqueId(ref.canvasId, "Generation Canvas id"),
      scopeId: requireOpaqueId(ref.scopeId, "Generation scope id"),
    },
    ...(referenceConstraint === undefined ? {} : { referenceConstraint }),
    references,
    ...(toolId === undefined ? {} : { toolId }),
    ...(value.toolInput === undefined ? {} : { toolInput: validateGenerationToolInputShape(value.toolInput) }),
  }
}

/**
 * Exposes only the generation application operation. Vendor credentials, native
 * paths, arbitrary MCP calls, and Plugin process controls never cross preload.
 */
export function registerGenerationIpc(executor: GenerationExecutor, options: GenerationIpcOptions) {
  const senders = new Map<number, SenderOperations>()
  let disposed = false

  const deleteSenderWhenIdle = (state: SenderOperations) => {
    if (state.controllers.size || senders.get(state.sender.id) !== state) return
    state.sender.removeListener("destroyed", state.destroyed)
    senders.delete(state.sender.id)
  }

  const stateFor = (sender: WebContents) => {
    const current = senders.get(sender.id)
    if (current) return current
    const controllers = new Map<string, AbortController>()
    const state = {
      controllers,
      destroyed: () => {
        if (senders.get(sender.id) === state) senders.delete(sender.id)
        for (const controller of controllers.values()) {
          controller.abort(abortError("The generation renderer closed"))
        }
        controllers.clear()
      },
      sender,
    } satisfies SenderOperations
    senders.set(sender.id, state)
    sender.once("destroyed", state.destroyed)
    return state
  }

  const cancel = (event: IpcMainEvent, input: unknown) => {
    if (!options.isTrustedSender(event)) return
    let operationId: string
    try {
      operationId = requireOperationId(input)
    } catch {
      return
    }
    senders
      .get(event.sender.id)
      ?.controllers.get(operationId)
      ?.abort(abortError("The generation operation was canceled"))
  }

  ipcMain.on(generationIpcChannels.cancel, cancel)
  ipcMain.handle(generationIpcChannels.listTools, (event, input: unknown) => {
    if (!options.isTrustedSender(event)) throw new Error("Generation IPC request came from an untrusted renderer")
    if (disposed) throw new Error("Generation IPC is disposed")
    return executor.listTools(parseGenerationListToolsRequest(input))
  })
  ipcMain.handle(generationIpcChannels.describeTool, (event, input: unknown) => {
    if (!options.isTrustedSender(event)) throw new Error("Generation IPC request came from an untrusted renderer")
    if (disposed) throw new Error("Generation IPC is disposed")
    return executor.describeTool(parseGenerationDescribeToolRequest(input))
  })
  ipcMain.handle(generationIpcChannels.generate, async (event, input: unknown) => {
    if (!options.isTrustedSender(event)) throw new Error("Generation IPC request came from an untrusted renderer")
    if (disposed) throw new Error("Generation IPC is disposed")
    const request = parseGenerationCanvasRequest(input)
    const state = stateFor(event.sender)
    if (state.controllers.has(request.operationId)) throw new Error("Generation operation id is already active")
    const controller = new AbortController()
    state.controllers.set(request.operationId, controller)
    try {
      return await executor.generate(request, controller.signal)
    } finally {
      if (state.controllers.get(request.operationId) === controller) state.controllers.delete(request.operationId)
      deleteSenderWhenIdle(state)
    }
  })

  return () => {
    if (disposed) return
    disposed = true
    ipcMain.removeListener(generationIpcChannels.cancel, cancel)
    ipcMain.removeHandler(generationIpcChannels.generate)
    ipcMain.removeHandler(generationIpcChannels.describeTool)
    ipcMain.removeHandler(generationIpcChannels.listTools)
    for (const state of senders.values()) {
      state.sender.removeListener("destroyed", state.destroyed)
      for (const controller of state.controllers.values()) {
        controller.abort(abortError("Generation IPC was disposed"))
      }
      state.controllers.clear()
    }
    senders.clear()
  }
}
