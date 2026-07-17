import type { AgentResource } from "@convax/agent-runtime"

export interface AgentActiveCanvas {
  id: string
  name?: string
}

export function agentCanvasResourceUri(canvasId: string) {
  return `convax://canvas/${encodeURIComponent(canvasId)}`
}

export function agentCanvasNodeResourceUri(canvasId: string, nodeId: string) {
  return `${agentCanvasResourceUri(canvasId)}/node/${encodeURIComponent(nodeId)}`
}

export function isAgentCanvasResource(resource: AgentResource) {
  if (resource.kind !== "resource") return false
  try {
    const url = new URL(resource.uri)
    return url.protocol === "convax:" && url.hostname === "canvas"
  } catch {
    return false
  }
}

export function shouldFlushAgentCanvasContext(input: {
  activeCanvas?: AgentActiveCanvas
  resources: readonly AgentResource[]
}) {
  return Boolean(input.activeCanvas) || input.resources.some(isAgentCanvasResource)
}

/** Product guidance composed by Desktop; the generic Agent runtime remains host-agnostic. */
export function createAgentCanvasInstructions(input: {
  activeCanvas?: AgentActiveCanvas
  resources: readonly AgentResource[]
}) {
  const hasCanvasResource = input.resources.some(isAgentCanvasResource)
  if (!input.activeCanvas && !hasCanvasResource) return []
  const instructions: string[] = []
  if (input.activeCanvas) {
    instructions.push([
      "Convax host context (authoritative):",
      `- Active Canvas ID: ${JSON.stringify(input.activeCanvas.id)}`,
      ...(input.activeCanvas.name ? [`- Active Canvas name: ${JSON.stringify(input.activeCanvas.name)}`] : []),
      "When a Convax Canvas tool needs the active canvas, pass exactly this Canvas ID. Do not guess it from the Canvas name, project ID, or view ID.",
      `To inspect what is on the active Canvas, call convax_canvas_query_nodes immediately with canvasId ${JSON.stringify(input.activeCanvas.id)}.`,
      "Convax Canvas tools are already registered. Do not search the filesystem for Canvas instructions or load a Canvas Skill unless the user explicitly selected one.",
    ].join("\n"))
  }
  instructions.push(hasCanvasResource
    ? "Convax Canvas resources are read-only snapshots. Use Convax Canvas tools for changes, selection, and viewport actions; do not read or edit files under .convax directly."
    : "Use Convax Canvas tools—not private .convax files—when the request involves a canvas. Prefer business tools; use primitive tools only for precise low-level edits.")
  return instructions
}
