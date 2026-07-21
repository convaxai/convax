import type { AgentToolDefinition, AgentToolProvider, AgentToolScope } from "@convax/agent-runtime"

import type {
  GenerationCanvasRequest,
  GenerationCanvasResult,
  GenerationInputRole,
  GenerationOutputModality,
  GenerationToolSummary,
} from "../generation-contracts"
import { GenerationToolReportedError } from "./generation-canvas-service"
import { validateGenerationToolInputShape } from "./generation-tool-input-schema"

export interface GenerationCanvasAgentPort {
  generate(
    request: GenerationCanvasRequest,
    actor: { id: string; kind: "agent" },
    signal?: AbortSignal,
  ): Promise<GenerationCanvasResult>
  listTools(options?: { output?: GenerationOutputModality }): Promise<readonly GenerationToolSummary[]>
}

const toolName = "canvas_generate"
const outputModalities = ["text", "image", "video", "audio"] as const satisfies readonly GenerationOutputModality[]
const inputRoles = [
  "text",
  "reference_image",
  "reference_video",
  "first_frame",
  "last_frame",
  "audio",
] as const satisfies readonly GenerationInputRole[]

const outputModalitySet = new Set<string>(outputModalities)
const inputRoleSet = new Set<string>(inputRoles)
const topLevelFields = new Set([
  "anchor",
  "canvasId",
  "commandId",
  "expectedRevision",
  "output",
  "prompt",
  "references",
  "toolId",
  "toolInput",
])

/**
 * Exposes the shared generation application service to OpenCode. The adapter
 * contributes no generation implementation of its own: installed Tool Plugins
 * remain the only executors, while the host supplies the authoritative Agent
 * Project scope and mutation actor.
 */
export function createGenerationAgentToolProvider(service: GenerationCanvasAgentPort): AgentToolProvider {
  const installedTools = async () =>
    normalizeInstalledTools(await service.listTools()).filter((tool) => tool.kind === "model")
  return {
    async listTools() {
      const installed = await installedTools()
      return installed.length ? [definition(installed)] : []
    },

    async callTool(scope, name, input, context) {
      if (name !== toolName) throw new Error(`Unknown generation tool: ${name}`)
      const installed = await installedTools()
      if (!installed.length) throw new Error("No generation Tool Plugin is installed")
      const request = generationRequest(scope, input, installed)
      let result: GenerationCanvasResult
      try {
        result = await service.generate(
          request,
          { id: `opencode:${requiredIdentifier(scope.scopeId, "Agent scope id")}`, kind: "agent" },
          context?.signal,
        )
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error
        if (error instanceof GenerationToolReportedError) throw error
        // Native filesystem paths, CLI diagnostics, cookies, and credentials
        // must never become model-visible MCP error text.
        throw sanitizedGenerationFailure()
      }
      return {
        changed: result.createdNodeIds.length > 0,
        createdNodeIds: result.createdNodeIds,
        revision: result.revision,
        toolId: result.toolId,
        warnings: result.warnings,
      }
    },
  }
}

function sanitizedGenerationFailure() {
  return new Error(
    "Canvas generation could not be completed; refresh the Canvas state before retrying with a new commandId",
  )
}

function definition(tools: readonly GenerationToolSummary[]): AgentToolDefinition {
  const outputs = unique(tools.map((tool) => tool.output))
  const capabilities = tools
    .map(
      (tool) =>
        `${tool.id} (output: ${tool.output}; reference roles: ${tool.acceptedInputs.length ? tool.acceptedInputs.join(", ") : "none"})`,
    )
    .join("; ")
  return {
    name: toolName,
    description:
      "Generate content through an installed generation Tool Plugin, admit the result as managed Project assets when needed, and add normal file or text nodes to the live Canvas. " +
      `Installed host tool IDs: ${capabilities}. Omit toolId only when exactly one installed tool matches the requested output and references.`,
    inputSchema: {
      additionalProperties: false,
      properties: {
        anchor: {
          additionalProperties: false,
          description: "Canvas position for the generated result.",
          properties: { x: { type: "number" }, y: { type: "number" } },
          required: ["x", "y"],
          type: "object",
        },
        canvasId: {
          description: "Canvas id from the active host scope.",
          minLength: 1,
          type: "string",
        },
        commandId: {
          description: "Stable id for this generation mutation and any replay of the same request.",
          maxLength: 256,
          minLength: 1,
          type: "string",
        },
        expectedRevision: {
          description: "Revision returned by the latest Canvas query.",
          minimum: 0,
          type: "integer",
        },
        output: {
          description: "Optional output modality used to select a compatible installed tool.",
          enum: outputs,
          type: "string",
        },
        prompt: {
          description: "Generation instructions.",
          maxLength: 65_536,
          minLength: 1,
          type: "string",
        },
        references: {
          description:
            "Canvas nodes used as typed references. Project paths are never accepted. Use reference_image for ordinary single-image-to-video input. first_frame may be used alone as an opening frame; use first_frame plus last_frame only when both endpoints are constrained.",
          items: {
            additionalProperties: false,
            properties: {
              nodeId: { minLength: 1, type: "string" },
              role: { enum: inputRoles, type: "string" },
            },
            required: ["nodeId", "role"],
            type: "object",
          },
          maxItems: 32,
          type: "array",
        },
        toolId: {
          description: "Stable host id of an installed generation tool.",
          enum: tools.map((tool) => tool.id),
          type: "string",
        },
        toolInput: {
          additionalProperties: {
            oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
          },
          description:
            "Optional scalar fields declared by the explicitly selected MCP generation tool. Use only fields supplied by the host's current tool configuration.",
          maxProperties: 32,
          type: "object",
        },
      },
      required: ["anchor", "canvasId", "commandId", "expectedRevision", "prompt", "references"],
      type: "object",
    },
  }
}

function generationRequest(
  scope: AgentToolScope,
  value: Record<string, unknown>,
  installed: readonly GenerationToolSummary[],
): GenerationCanvasRequest {
  rejectUnknownFields(value, topLevelFields, "canvas_generate input")
  const canvasId = requiredIdentifier(value.canvasId, "canvasId")
  const commandId = requiredIdentifier(value.commandId, "commandId")
  const prompt = requiredPrompt(value.prompt)
  const expectedRevision = requiredInteger(value.expectedRevision, "expectedRevision", 0)
  const anchor = point(value.anchor, "anchor")
  const output = optionalEnum(value.output, "output", outputModalities)
  const toolId = optionalIdentifier(value.toolId, "toolId")
  const toolInput = value.toolInput === undefined ? undefined : validateGenerationToolInputShape(value.toolInput)
  const references = generationReferences(value.references)

  if (toolId !== undefined) {
    const tool = installed.find((candidate) => candidate.id === toolId)
    if (!tool) throw new Error(`Generation tool is not installed: ${toolId}`)
    if (output !== undefined && output !== tool.output) {
      throw new Error(`Generation tool ${toolId} does not produce ${output}`)
    }
    const unsupported = references.find((reference) => !tool.acceptedInputs.includes(reference.role))
    if (unsupported) throw new Error(`Generation tool ${toolId} does not accept reference role ${unsupported.role}`)
  }

  return {
    anchor,
    expectedRevision,
    operationId: commandId,
    ...(output === undefined ? {} : { output }),
    prompt,
    ref: {
      canvasId,
      scopeId: requiredIdentifier(scope.scopeId, "Agent scope id"),
    },
    references,
    ...(toolId === undefined ? {} : { toolId }),
    ...(toolInput === undefined ? {} : { toolInput }),
  }
}

function normalizeInstalledTools(tools: readonly GenerationToolSummary[]) {
  if (!Array.isArray(tools)) throw new Error("Installed generation tools must be an array")
  const ids = new Set<string>()
  const normalized: GenerationToolSummary[] = Array.from(tools, (tool, index) => {
    const id = requiredIdentifier(tool.id, `Installed generation tool ${index} id`)
    if (ids.has(id)) throw new Error(`Installed generation tool id is duplicated: ${id}`)
    ids.add(id)
    if (!outputModalitySet.has(tool.output)) {
      throw new Error(`Installed generation tool ${id} has an unsupported output modality`)
    }
    if (tool.kind !== "model" && tool.kind !== "operation") {
      throw new Error(`Installed generation tool ${id} has an unsupported kind`)
    }
    if (!Array.isArray(tool.acceptedInputs)) {
      throw new Error(`Installed generation tool ${id} acceptedInputs must be an array`)
    }
    const roles = new Set<string>()
    for (const role of tool.acceptedInputs) {
      if (!inputRoleSet.has(role)) throw new Error(`Installed generation tool ${id} has an unsupported input role`)
      if (roles.has(role)) throw new Error(`Installed generation tool ${id} contains a duplicate input role`)
      roles.add(role)
    }
    return tool
  })
  return normalized.sort((left, right) => left.id.localeCompare(right.id))
}

function generationReferences(value: unknown) {
  if (!Array.isArray(value)) throw new Error("references must be an array")
  if (value.length > 32) throw new Error("references accepts at most 32 items")
  const pairs = new Set<string>()
  return value.map((item, index) => {
    const label = `references[${index}]`
    const input = record(item, label)
    rejectUnknownFields(input, new Set(["nodeId", "role"]), label)
    const nodeId = requiredIdentifier(input.nodeId, `${label}.nodeId`)
    const role = requiredEnum(input.role, `${label}.role`, inputRoles)
    const pair = `${nodeId}\0${role}`
    if (pairs.has(pair)) throw new Error("references contains a duplicate node and role")
    pairs.add(pair)
    return { nodeId, role }
  })
}

function point(value: unknown, label: string) {
  const input = record(value, label)
  rejectUnknownFields(input, new Set(["x", "y"]), label)
  return {
    x: requiredNumber(input.x, `${label}.x`),
    y: requiredNumber(input.y, `${label}.y`),
  }
}

function requiredPrompt(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 65_536 || value.includes("\0")) {
    throw new Error("prompt must contain between 1 and 65536 characters")
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  if (unknown) throw new Error(`${label} contains unsupported field: ${unknown}`)
}

function requiredIdentifier(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} must be a non-empty, trimmed string`)
  }
  return value
}

function optionalIdentifier(value: unknown, label: string) {
  return value === undefined ? undefined : requiredIdentifier(value, label)
}

function requiredNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}

function requiredInteger(value: unknown, label: string, minimum: number) {
  const result = requiredNumber(value, label)
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`)
  }
  return result
}

function requiredEnum<const Values extends readonly string[]>(value: unknown, label: string, values: Values) {
  if (typeof value !== "string" || !values.includes(value))
    throw new Error(`${label} must be one of ${values.join(", ")}`)
  return value as Values[number]
}

function optionalEnum<const Values extends readonly string[]>(value: unknown, label: string, values: Values) {
  return value === undefined ? undefined : requiredEnum(value, label, values)
}

function unique<const Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)]
}
