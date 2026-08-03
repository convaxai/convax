import { randomUUID } from "node:crypto"

import type { AgentToolDefinition, AgentToolProvider, AgentToolScope } from "@convax/agent-runtime"

import type {
  GenerationCanvasRequest,
  GenerationCanvasResult,
  GenerationInputRole,
  GenerationOutputModality,
  GenerationToolSummary,
} from "../generation-contracts"
import { GenerationToolReportedError } from "./generation-canvas-service"
import type { GenerationCanvasAgentPort } from "./generation-agent-tools"
import { validateGenerationToolInputShape } from "./generation-tool-input-schema"

export interface PluginOperationAgentActiveCanvas {
  canvasId: string
  scopeId: string
}

export interface PluginOperationAgentToolProviderOptions {
  resolveActiveCanvas(): Promise<PluginOperationAgentActiveCanvas | null>
}

interface InstalledAgentOperation {
  name: string
  tool: GenerationToolSummary & { agentId: string; kind: "operation" }
}

const inputRoles = [
  "text",
  "reference_image",
  "reference_video",
  "first_frame",
  "last_frame",
  "audio",
] as const satisfies readonly GenerationInputRole[]

const inputRoleSet = new Set<string>(inputRoles)
const outputModalities = new Set<string>(["text", "image", "video", "audio"] satisfies GenerationOutputModality[])
const canvasNodeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u
const pluginIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const pluginToolIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u
const agentIdPattern = /^[a-z][a-z0-9_]{0,63}$/u
const maximumReferences = 32
const maximumRelationNodeIds = 32

/**
 * Discovers manifest-declared Plugin operations and exposes each one through a
 * stable Agent tool. The adapter knows no concrete Plugin ids, commands or
 * tool-specific fields; execution remains inside GenerationCanvasService.
 */
export function createPluginOperationAgentToolProvider(
  service: GenerationCanvasAgentPort,
  options: PluginOperationAgentToolProviderOptions,
): AgentToolProvider {
  return {
    async listTools() {
      return (await installedAgentOperations(service)).map(({ name, tool }) => definition(name, tool))
    },

    async callTool(scope, name, input, context) {
      assertNotAborted(context?.signal)
      const operation = (await installedAgentOperations(service)).find((candidate) => candidate.name === name)
      assertNotAborted(context?.signal)
      if (!operation) throw new Error("Plugin operation Agent tool is not installed")
      const parsed = parseInput(input, operation.tool)
      const active = await requireActiveCanvas(scope, options)
      assertNotAborted(context?.signal)
      const returnsToAgent = operation.tool.delivery === "return"
      const request: GenerationCanvasRequest = {
        anchor: parsed.anchor,
        expectedOutputCount: 1,
        operationId: `plugin-operation-${randomUUID()}`,
        output: operation.tool.output,
        prompt: `Run installed Plugin operation ${operation.tool.id}.`,
        ref: { canvasId: active.canvasId, scopeId: active.scopeId },
        ...(parsed.ownerNodeId === undefined
          ? {}
          : {
              referenceConstraint: {
                ownerNodeId: parsed.ownerNodeId,
                ownerPluginId: operation.tool.pluginId,
                type: "direct-incoming" as const,
              },
            }),
        references: parsed.references,
        resultMode: returnsToAgent
          ? { type: "return" as const }
          : { type: "create-pending-node" as const },
        ...(!returnsToAgent && parsed.relationNodeIds.length ? { relationAnchorNodeIds: parsed.relationNodeIds } : {}),
        toolId: operation.tool.id,
        ...(parsed.toolInput === undefined ? {} : { toolInput: parsed.toolInput }),
      }
      const actor = { id: `opencode:${requiredIdentifier(scope.scopeId, "Agent scope id")}`, kind: "agent" } as const
      const cancel = () => {
        void service.cancel(request.operationId, actor).catch(() => undefined)
      }
      context?.signal?.addEventListener("abort", cancel, { once: true })
      let result: GenerationCanvasResult
      try {
        result = await service.generate(request, actor, context?.signal)
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error
        if (error instanceof GenerationToolReportedError) throw error
        throw sanitizedOperationFailure()
      } finally {
        context?.signal?.removeEventListener("abort", cancel)
      }
      if (
        returnsToAgent &&
        (typeof result.outputText !== "string" || !result.outputText.trim() || result.createdNodeIds.length !== 0)
      ) {
        throw sanitizedOperationFailure()
      }
      return {
        changed: result.createdNodeIds.length > 0,
        createdNodeIds: result.createdNodeIds,
        ...(returnsToAgent ? { outputText: result.outputText } : {}),
        operationReceipt: result.operationReceipt,
        toolId: result.toolId,
        warnings: result.warnings,
      }
    },
  }
}

function definition(name: string, tool: GenerationToolSummary): AgentToolDefinition {
  const returnsToAgent = tool.delivery === "return"
  const bindsDirectIncoming = tool.inputBinding === "direct-incoming"
  const references = tool.acceptedInputs.length
    ? {
        description: bindsDirectIncoming
          ? "Canvas nodes supplied as typed inputs. Every node must remain a direct incoming connection to ownerNodeId."
          : "Canvas nodes supplied as typed inputs to this operation. Native paths are never accepted.",
        items: {
          additionalProperties: false,
          properties: {
            nodeId: { minLength: 1, pattern: canvasNodeIdPattern.source, type: "string" },
            role: { enum: [...tool.acceptedInputs], type: "string" },
          },
          required: ["nodeId", "role"],
          type: "object",
        },
        maxItems: maximumReferences,
        type: "array",
      }
    : {
        description: "This operation does not accept Canvas references.",
        maxItems: 0,
        type: "array",
      }
  return {
    name,
    description:
      `${tool.description} ` +
      (returnsToAgent
        ? `Runs installed Plugin operation ${tool.id} and returns one bounded text result without creating a Canvas node.`
        : `Runs installed Plugin operation ${tool.id} and creates one managed Canvas ${tool.output} result in the active Project and Canvas.`),
    inputSchema: {
      additionalProperties: false,
      properties: {
        ...(returnsToAgent
          ? {}
          : {
              anchor: {
                additionalProperties: false,
                description: "Optional preferred Canvas position for the result.",
                properties: { x: { type: "number" }, y: { type: "number" } },
                required: ["x", "y"],
                type: "object",
              },
            }),
        ...(bindsDirectIncoming
          ? {
              ownerNodeId: {
                description: "The Canvas file node owned by this installed Plugin and receiving every reference.",
                minLength: 1,
                pattern: canvasNodeIdPattern.source,
                type: "string",
              },
            }
          : {}),
        references,
        ...(returnsToAgent || bindsDirectIncoming
          ? {}
          : {
              relationNodeIds: {
                description:
                  "Optional Canvas nodes to connect to the result without exposing them as operation inputs.",
                items: { minLength: 1, pattern: canvasNodeIdPattern.source, type: "string" },
                maxItems: maximumRelationNodeIds,
                type: "array",
                uniqueItems: true,
              },
            }),
        toolInput: {
          additionalProperties: {
            oneOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
          },
          description: "Optional bounded scalar fields declared by the installed Plugin operation.",
          maxProperties: 32,
          type: "object",
        },
      },
      required: [...(bindsDirectIncoming ? ["ownerNodeId"] : []), "references"],
      type: "object",
    },
  }
}

async function installedAgentOperations(service: GenerationCanvasAgentPort): Promise<InstalledAgentOperation[]> {
  const tools = await service.listTools()
  if (!Array.isArray(tools)) throw new Error("Installed Plugin tools must be an array")
  const ids = new Set<string>()
  const names = new Set<string>()
  const operations: InstalledAgentOperation[] = []
  for (const [index, tool] of tools.entries()) {
    if (tool.kind !== "operation" || tool.agentId === undefined) continue
    const label = `Installed Plugin operation ${index}`
    const pluginId = boundedPattern(tool.pluginId, `${label} pluginId`, pluginIdPattern, 80)
    const toolId = boundedPattern(tool.toolId, `${label} toolId`, pluginToolIdPattern, 80)
    const id = requiredIdentifier(tool.id, `${label} id`)
    if (id !== `${pluginId}/${toolId}`) throw new Error(`${label} id does not match its Plugin and tool ids`)
    if (ids.has(id)) throw new Error(`Installed Plugin operation id is duplicated: ${id}`)
    ids.add(id)
    const agentId = boundedPattern(tool.agentId, `${label} agentId`, agentIdPattern, 64)
    if (!outputModalities.has(tool.output)) throw new Error(`${label} has an unsupported output modality`)
    const delivery = tool.delivery ?? "canvas"
    if (delivery !== "canvas" && delivery !== "return") {
      throw new Error(`${label} has an unsupported delivery mode`)
    }
    if (delivery === "return" && tool.output !== "text") {
      throw new Error(`${label} return delivery requires text output`)
    }
    if (tool.inputBinding !== undefined && tool.inputBinding !== "direct-incoming") {
      throw new Error(`${label} has an unsupported input binding`)
    }
    if (!Array.isArray(tool.acceptedInputs)) throw new Error(`${label} acceptedInputs must be an array`)
    const roles = new Set<string>()
    for (const role of tool.acceptedInputs) {
      if (!inputRoleSet.has(role)) throw new Error(`${label} has an unsupported input role`)
      if (roles.has(role)) throw new Error(`${label} contains a duplicate input role`)
      roles.add(role)
    }
    if (tool.inputBinding === "direct-incoming" && roles.size === 0) {
      throw new Error(`${label} direct-incoming input binding requires accepted inputs`)
    }
    boundedManifestText(tool.description, `${label} description`, 2_000)
    const name = `plugin_${pluginId.replaceAll("-", "_")}_${agentId}`
    if (names.has(name)) throw new Error(`Installed Plugin operation Agent tool name is duplicated: ${name}`)
    names.add(name)
    operations.push({ name, tool: tool as InstalledAgentOperation["tool"] })
  }
  return operations.sort((left, right) => left.name.localeCompare(right.name))
}

function parseInput(value: Record<string, unknown>, tool: GenerationToolSummary) {
  const returnsToAgent = tool.delivery === "return"
  const bindsDirectIncoming = tool.inputBinding === "direct-incoming"
  rejectUnknownFields(value, operationInputFields(tool), "Plugin operation input")
  return {
    anchor: returnsToAgent || value.anchor === undefined ? { x: 0, y: 0 } : point(value.anchor, "anchor"),
    ownerNodeId: bindsDirectIncoming ? canvasNodeId(value.ownerNodeId, "ownerNodeId") : undefined,
    references: references(value.references, tool.acceptedInputs),
    relationNodeIds: returnsToAgent || bindsDirectIncoming ? [] : relationNodeIds(value.relationNodeIds),
    toolInput: value.toolInput === undefined ? undefined : validateGenerationToolInputShape(value.toolInput),
  }
}

function operationInputFields(tool: GenerationToolSummary) {
  const fields = new Set(["references", "toolInput"])
  if (tool.delivery !== "return") fields.add("anchor")
  if (tool.delivery !== "return" && tool.inputBinding !== "direct-incoming") fields.add("relationNodeIds")
  if (tool.inputBinding === "direct-incoming") fields.add("ownerNodeId")
  return fields
}

function references(value: unknown, acceptedRoles: readonly GenerationInputRole[]) {
  if (!Array.isArray(value) || value.length > maximumReferences) {
    throw new Error(`references must be an array with at most ${maximumReferences} items`)
  }
  const accepted = new Set<string>(acceptedRoles)
  const pairs = new Set<string>()
  return value.map((item, index) => {
    const label = `references[${index}]`
    const input = record(item, label)
    rejectUnknownFields(input, new Set(["nodeId", "role"]), label)
    const nodeId = canvasNodeId(input.nodeId, `${label}.nodeId`)
    if (typeof input.role !== "string" || !accepted.has(input.role)) {
      throw new Error(`${label}.role is not accepted by the installed Plugin operation`)
    }
    const role = input.role as GenerationInputRole
    const pair = `${nodeId}\0${role}`
    if (pairs.has(pair)) throw new Error("references contains a duplicate node and role")
    pairs.add(pair)
    return { nodeId, role }
  })
}

function relationNodeIds(value: unknown) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maximumRelationNodeIds) {
    throw new Error(`relationNodeIds must be an array with at most ${maximumRelationNodeIds} items`)
  }
  const nodeIds = value.map((nodeId, index) => canvasNodeId(nodeId, `relationNodeIds[${index}]`))
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error("relationNodeIds contains a duplicate node id")
  return nodeIds
}

async function requireActiveCanvas(scope: AgentToolScope, options: PluginOperationAgentToolProviderOptions) {
  let active: PluginOperationAgentActiveCanvas | null
  try {
    active = await options.resolveActiveCanvas()
  } catch {
    throw sanitizedOperationFailure()
  }
  if (!active || active.scopeId !== scope.scopeId) {
    throw new Error("Open a Canvas in the active Agent Project before running the Plugin operation")
  }
  requiredIdentifier(active.canvasId, "Active Canvas id")
  requiredIdentifier(active.scopeId, "Active Canvas scope id")
  return active
}

function point(value: unknown, label: string) {
  const input = record(value, label)
  rejectUnknownFields(input, new Set(["x", "y"]), label)
  if (typeof input.x !== "number" || !Number.isFinite(input.x)) throw new Error(`${label}.x must be finite`)
  if (typeof input.y !== "number" || !Number.isFinite(input.y)) throw new Error(`${label}.y must be finite`)
  return { x: input.x, y: input.y }
}

function canvasNodeId(value: unknown, label: string) {
  if (typeof value !== "string" || !canvasNodeIdPattern.test(value)) {
    throw new Error(`${label} must be a bounded Canvas node id`)
  }
  return value
}

function boundedPattern(value: unknown, label: string, pattern: RegExp, maximum: number) {
  if (typeof value !== "string" || value.length > maximum || !pattern.test(value)) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function boundedManifestText(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} is invalid`)
  }
}

function requiredIdentifier(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} must be a non-empty, trimmed string`)
  }
  return value
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  if (unknown) throw new Error(`${label} contains unsupported field: ${unknown}`)
}

function assertNotAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error && signal.reason.name === "AbortError") throw signal.reason
  const error = new Error("Plugin operation was canceled")
  error.name = "AbortError"
  throw error
}

function sanitizedOperationFailure() {
  return new Error("Plugin operation could not be completed; refresh the Canvas state before retrying")
}
