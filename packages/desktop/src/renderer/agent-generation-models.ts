import type { AgentResource } from "@convax/agent-runtime"
import type { GenerationOutputModality, GenerationToolInput, GenerationToolSummary } from "../generation-contracts"
import { createAgentCanvasInstructions, type AgentActiveCanvas } from "../agent-canvas-context"

export const agentGenerationOutputs = ["image", "video", "audio"] as const

export type AgentGenerationOutput = (typeof agentGenerationOutputs)[number]

export interface AgentGenerationToolSelection {
  id: string
  output: AgentGenerationOutput
}

const dedicatedAgentSurfacePluginIds = new Set(["ffmpeg-tools"])

function isGenerationPreferenceTool(tool: GenerationToolSummary) {
  return !dedicatedAgentSurfacePluginIds.has(tool.pluginId)
}

export function isAgentGenerationOutput(output: GenerationOutputModality): output is AgentGenerationOutput {
  return (agentGenerationOutputs as readonly GenerationOutputModality[]).includes(output)
}

export function agentGenerationToolsForOutput(tools: readonly GenerationToolSummary[], output: AgentGenerationOutput) {
  return tools.filter((tool) => tool.output === output && isGenerationPreferenceTool(tool))
}

/**
 * Resolves a remembered choice back to the current host catalog. Exact id and
 * output matching means a removed or changed Plugin tool fails closed to Auto.
 */
export function findAgentGenerationTool(
  selection: AgentGenerationToolSelection | undefined,
  tools: readonly GenerationToolSummary[],
) {
  if (!selection) return undefined
  const matches = tools.filter(
    (tool) =>
      tool.id === selection.id &&
      tool.output === selection.output &&
      isAgentGenerationOutput(tool.output) &&
      isGenerationPreferenceTool(tool),
  )
  return matches.length === 1 ? matches[0] : undefined
}

export function reconcileAgentGenerationToolSelection(
  selection: AgentGenerationToolSelection | undefined,
  tools: readonly GenerationToolSummary[],
): AgentGenerationToolSelection | undefined {
  const tool = findAgentGenerationTool(selection, tools)
  return tool && isAgentGenerationOutput(tool.output) ? { id: tool.id, output: tool.output } : undefined
}

export function createAgentPromptInstructions(input: {
  activeCanvas?: AgentActiveCanvas
  generationSelection?: AgentGenerationToolSelection
  generationToolInput?: GenerationToolInput
  generationTools: readonly GenerationToolSummary[]
  resources: readonly AgentResource[]
}) {
  const instructions = createAgentCanvasInstructions({
    activeCanvas: input.activeCanvas,
    resources: input.resources,
  })
  const selection = reconcileAgentGenerationToolSelection(input.generationSelection, input.generationTools)
  if (!selection || instructions.length === 0) return instructions
  const toolInput = input.generationToolInput ?? {}
  const toolInputInstruction =
    Object.keys(toolInput).length > 0
      ? [
          `- Host-validated model input: ${JSON.stringify(toolInput)}`,
          "When calling canvas_generate for this request, pass exactly this object as toolInput.",
        ]
      : ["Omit toolInput when calling canvas_generate for this request."]
  return [
    ...instructions,
    [
      "Convax generation preference (host-validated; applies only when the user asks to generate media):",
      `- Preferred installed tool ID: ${JSON.stringify(selection.id)}`,
      `- Required output modality: ${JSON.stringify(selection.output)}`,
      ...toolInputInstruction,
      "When calling canvas_generate for this request, pass exactly this toolId and output. This preference is not permission to generate media by itself.",
    ].join("\n"),
  ]
}

export class AgentGenerationCatalogRequestTracker {
  #generation = 0
  #scope = ""

  begin(scope: string) {
    const generation = ++this.#generation
    this.#scope = scope
    return () => this.#generation === generation && this.#scope === scope
  }

  invalidate() {
    this.#generation += 1
    this.#scope = ""
  }
}
