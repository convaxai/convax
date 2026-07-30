import type { PortablePluginCanvasSelectionActionContribution } from "./canvas"
import { assertPortableKeys, parsePortableStableId, portableArray, portableRecord, portableText } from "./primitives"

export const portablePluginGenerationModalities = ["text", "image", "video", "audio"] as const
export const portablePluginGenerationInputRoles = [
  "reference_image",
  "reference_video",
  "first_frame",
  "last_frame",
  "audio",
  "text",
] as const

export type PortablePluginGenerationModality = (typeof portablePluginGenerationModalities)[number]
export type PortablePluginGenerationInputRole = (typeof portablePluginGenerationInputRoles)[number]
export type PortablePluginGenerationDelivery = "canvas" | "return"
export type PortablePluginGenerationInputBinding = "direct-incoming"

export interface PortablePluginGenerationRecoveryContribution {
  readonly mode: "long-running-operation"
  readonly schema: "convax.generation-lro/1"
}

export interface PortablePluginGenerationModelContribution {
  readonly name: string
  readonly tool: string
}

export interface PortablePluginGenerationToolContribution {
  readonly acceptedInputs: readonly PortablePluginGenerationInputRole[]
  readonly delivery?: PortablePluginGenerationDelivery
  readonly description: string
  readonly id: string
  readonly inputBinding?: PortablePluginGenerationInputBinding
  readonly output: PortablePluginGenerationModality
  readonly recovery?: PortablePluginGenerationRecoveryContribution
  readonly title: string
}

export interface PortablePluginGenerationContribution {
  readonly models: readonly PortablePluginGenerationModelContribution[]
  readonly tools: readonly PortablePluginGenerationToolContribution[]
}

export interface PortablePluginAgentToolContribution {
  readonly id: string
  readonly tool: string
}

export interface PortablePluginAgentRemoteMcpContribution {
  readonly headers?: Readonly<Record<string, string>>
  readonly oauth: "auto" | "none"
  readonly type: "remote"
  readonly url: string
}

export interface PortablePluginAgentContribution {
  readonly mcp?: PortablePluginAgentRemoteMcpContribution
  readonly tools?: readonly PortablePluginAgentToolContribution[]
}

const allowedGenerationModalities = new Set<string>(portablePluginGenerationModalities)
const allowedGenerationInputRoles = new Set<string>(portablePluginGenerationInputRoles)
const agentToolIdPattern = /^[a-z][a-z0-9_]{0,63}$/

function parseGenerationInputRoles(value: unknown, label: string): readonly PortablePluginGenerationInputRole[] {
  const input = portableArray(value, label, portablePluginGenerationInputRoles.length)
  const roles = input.map((role) => {
    if (typeof role !== "string" || !allowedGenerationInputRoles.has(role)) {
      throw new TypeError(`${label} contain an unsupported or duplicate role`)
    }
    return role as PortablePluginGenerationInputRole
  })
  if (new Set(roles).size !== roles.length) {
    throw new TypeError(`${label} contain an unsupported or duplicate role`)
  }
  return roles
}

export function parsePortablePluginGenerationContribution(value: unknown): PortablePluginGenerationContribution {
  const input = portableRecord(value, "Generation contribution")
  assertPortableKeys(input, ["models", "tools"], "Generation contribution")
  if (!Object.prototype.hasOwnProperty.call(input, "models")) {
    throw new TypeError("convax.plugin/8 generation models must be declared explicitly")
  }
  const tools = portableArray(input.tools, "Generation tools", 64, true).map((value, index) => {
    const label = `Generation tool ${index}`
    const tool = portableRecord(value, label)
    assertPortableKeys(
      tool,
      ["acceptedInputs", "delivery", "description", "id", "inputBinding", "output", "recovery", "title"],
      label,
    )
    const id = parsePortableStableId(tool.id, `${label} id`)
    if (typeof tool.output !== "string" || !allowedGenerationModalities.has(tool.output)) {
      throw new TypeError(`${label} output is not supported`)
    }
    if (tool.delivery !== undefined && tool.delivery !== "canvas" && tool.delivery !== "return") {
      throw new TypeError(`${label} delivery is not supported`)
    }
    if (tool.delivery === "return" && tool.output !== "text") {
      throw new TypeError(`${label} return delivery requires text output`)
    }
    const acceptedInputs = parseGenerationInputRoles(tool.acceptedInputs, `${label} acceptedInputs`)
    if (tool.inputBinding !== undefined && tool.inputBinding !== "direct-incoming") {
      throw new TypeError(`${label} input binding is not supported`)
    }
    if (tool.inputBinding === "direct-incoming" && acceptedInputs.length === 0) {
      throw new TypeError(`${label} direct-incoming input binding requires accepted inputs`)
    }
    let recovery: PortablePluginGenerationRecoveryContribution | undefined
    if (tool.recovery !== undefined) {
      const recoveryInput = portableRecord(tool.recovery, `${label} recovery`)
      assertPortableKeys(recoveryInput, ["mode", "schema"], `${label} recovery`)
      if (recoveryInput.schema !== "convax.generation-lro/1" || recoveryInput.mode !== "long-running-operation") {
        throw new TypeError(`${label} recovery contract is not supported`)
      }
      recovery = { mode: "long-running-operation", schema: "convax.generation-lro/1" }
    }
    return {
      acceptedInputs,
      ...(tool.delivery === undefined ? {} : { delivery: tool.delivery as PortablePluginGenerationDelivery }),
      description: portableText(tool.description, `${label} description`, 2_000),
      id,
      ...(tool.inputBinding === undefined
        ? {}
        : { inputBinding: tool.inputBinding as PortablePluginGenerationInputBinding }),
      output: tool.output as PortablePluginGenerationModality,
      ...(recovery === undefined ? {} : { recovery }),
      title: portableText(tool.title, `${label} title`, 120),
    }
  })
  if (new Set(tools.map((tool) => tool.id)).size !== tools.length) {
    throw new TypeError("Generation tools contain duplicate ids")
  }
  const models = portableArray(input.models, "Generation models", tools.length).map((value, index) => {
    const label = `Generation model ${index}`
    const model = portableRecord(value, label)
    assertPortableKeys(model, ["name", "tool"], label)
    return {
      name: portableText(model.name, `${label} name`, 120),
      tool: parsePortableStableId(model.tool, `${label} tool`),
    }
  })
  if (new Set(models.map((model) => model.tool)).size !== models.length) {
    throw new TypeError("Generation models contain duplicate tool references")
  }
  const modelToolIds = new Set(models.map((model) => model.tool))
  const returnedModel = tools.find((tool) => tool.delivery === "return" && modelToolIds.has(tool.id))
  if (returnedModel) {
    throw new TypeError(`Generation model cannot reference a return-delivery operation: ${returnedModel.id}`)
  }
  const boundModel = tools.find((tool) => tool.inputBinding !== undefined && modelToolIds.has(tool.id))
  if (boundModel) {
    throw new TypeError(`Generation model cannot reference an input-bound operation: ${boundModel.id}`)
  }
  return { models, tools }
}

function parseAgentTools(value: unknown): readonly PortablePluginAgentToolContribution[] {
  const tools = portableArray(value, "Agent tools", 32, true).map((value, index) => {
    const label = `Agent tool ${index}`
    const tool = portableRecord(value, label)
    assertPortableKeys(tool, ["id", "tool"], label)
    const id = portableText(tool.id, `${label} id`, 64)
    if (!agentToolIdPattern.test(id)) throw new TypeError(`${label} id must use lower snake_case`)
    return { id, tool: parsePortableStableId(tool.tool, `${label} generation tool`) }
  })
  if (new Set(tools.map((tool) => tool.id)).size !== tools.length) {
    throw new TypeError("Agent tools contain duplicate ids")
  }
  if (new Set(tools.map((tool) => tool.tool)).size !== tools.length) {
    throw new TypeError("Agent tools contain duplicate generation tool references")
  }
  return tools
}

function parseAgentRemoteMcp(value: unknown): PortablePluginAgentRemoteMcpContribution {
  const input = portableRecord(value, "Agent remote MCP contribution")
  assertPortableKeys(input, ["headers", "oauth", "type", "url"], "Agent remote MCP contribution")
  if (input.type !== "remote") throw new TypeError("Agent MCP type must be remote")
  const url = portableText(input.url, "Agent remote MCP URL", 2_048)
  try {
    const parsedUrl = new URL(url)
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.username !== "" ||
      parsedUrl.password !== "" ||
      parsedUrl.hash !== ""
    ) {
      throw new TypeError()
    }
  } catch {
    throw new TypeError("Agent remote MCP URL must be an absolute HTTPS URL without credentials or a fragment")
  }
  if (input.oauth !== undefined && input.oauth !== "auto" && input.oauth !== "none") {
    throw new TypeError("Agent remote MCP oauth must be auto or none")
  }
  let headers: Record<string, string> | undefined
  if (input.headers !== undefined) {
    const headerInput = portableRecord(input.headers, "Agent remote MCP headers")
    const entries = Object.entries(headerInput)
    if (entries.length > 16) throw new TypeError("Agent remote MCP headers must contain at most 16 entries")
    const names = new Set<string>()
    headers = {}
    for (const [name, value] of entries) {
      if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(name)) {
        throw new TypeError(`Agent remote MCP header name is invalid: ${name}`)
      }
      const normalizedName = name.toLowerCase()
      if (names.has(normalizedName)) {
        throw new TypeError(`Agent remote MCP headers contain a duplicate name: ${name}`)
      }
      if (
        normalizedName === "authorization" ||
        normalizedName === "cookie" ||
        normalizedName === "proxy-authorization"
      ) {
        throw new TypeError(`Agent remote MCP header is not allowed: ${name}`)
      }
      const literal = portableText(value, `Agent remote MCP header ${name}`, 2_048)
      if (/\{(?:env|file):/iu.test(literal) || /\$\{[^}]*\}/u.test(literal)) {
        throw new TypeError(`Agent remote MCP header ${name} must be a literal value`)
      }
      names.add(normalizedName)
      headers[name] = literal
    }
  }
  return {
    ...(headers === undefined ? {} : { headers }),
    oauth: input.oauth === "none" ? "none" : "auto",
    type: "remote",
    url,
  }
}

export function parsePortablePluginAgentContribution(value: unknown): PortablePluginAgentContribution {
  const input = portableRecord(value, "Agent contribution")
  assertPortableKeys(input, ["mcp", "tools"], "Agent contribution")
  const tools = input.tools === undefined ? undefined : parseAgentTools(input.tools)
  const mcp = input.mcp === undefined ? undefined : parseAgentRemoteMcp(input.mcp)
  if (tools === undefined && mcp === undefined) {
    throw new TypeError("Agent contribution must declare tools or mcp")
  }
  return {
    ...(mcp === undefined ? {} : { mcp }),
    ...(tools === undefined ? {} : { tools }),
  }
}

export function validatePortableToolReferences(input: {
  readonly agent?: PortablePluginAgentContribution
  readonly generation?: PortablePluginGenerationContribution
  readonly selectionActions?: readonly PortablePluginCanvasSelectionActionContribution[]
}) {
  const tools = new Map(input.generation?.tools.map((tool) => [tool.id, tool]) ?? [])
  const modelToolIds = new Set(input.generation?.models.map((model) => model.tool) ?? [])
  for (const modelToolId of modelToolIds) {
    if (!tools.has(modelToolId)) {
      throw new TypeError(`Generation model references an unknown tool: ${modelToolId}`)
    }
  }
  for (const agentTool of input.agent?.tools ?? []) {
    if (!tools.has(agentTool.tool)) {
      throw new TypeError(`Agent tool references an unknown generation tool: ${agentTool.tool}`)
    }
    if (modelToolIds.has(agentTool.tool)) {
      throw new TypeError(`Agent tool must reference an operation, not a generation model: ${agentTool.tool}`)
    }
  }
  for (const action of input.selectionActions ?? []) {
    if (!("steps" in action)) continue
    for (const step of action.steps) {
      const tool = tools.get(step.tool)
      if (!tool) {
        throw new TypeError(`Canvas selection action references an unknown generation tool: ${step.tool}`)
      }
      if (modelToolIds.has(step.tool)) {
        throw new TypeError(`Canvas selection action must reference an operation, not a generation model: ${step.tool}`)
      }
      if (tool.inputBinding !== undefined) {
        throw new TypeError(`Canvas selection action cannot reference an input-bound operation: ${step.tool}`)
      }
      const referenceRole = action.target === "image" ? "reference_image" : "reference_video"
      if (!tool.acceptedInputs.includes(referenceRole)) {
        throw new TypeError(`Canvas ${action.target} selection action tool must accept ${referenceRole}: ${step.tool}`)
      }
      if (tool.delivery === "return") {
        if (action.editor !== "confirmation") {
          throw new TypeError(`Canvas return-delivery operation requires a confirmation editor: ${step.tool}`)
        }
        if (action.steps.length !== 1) {
          throw new TypeError(`Canvas return-delivery operation requires exactly one step: ${step.tool}`)
        }
        if (tool.output !== "text") {
          throw new TypeError(`Canvas return-delivery operation must return text: ${step.tool}`)
        }
      } else if (
        action.target === "image" &&
        (action.editor !== "immediate" ||
          action.presentation !== "cutout-scan" ||
          action.steps.length !== 1 ||
          tool.output !== "image")
      ) {
        throw new TypeError(
          `Canvas image output requires one immediate image operation with cutout-scan presentation: ${step.tool}`,
        )
      }
    }
  }
}
