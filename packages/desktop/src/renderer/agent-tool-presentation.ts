import type { AgentMessagePart } from "@convax/agent-runtime"

type AgentToolPart = Extract<AgentMessagePart, { type: "tool" }>

export type AgentToolPresentationOutcome = "cancelled" | "failure" | "pending" | "running" | "success"

export interface AgentToolPresentation {
  detail?: string
  outcome: AgentToolPresentationOutcome
}

function hasExplicitFailureOutput(output: string) {
  try {
    const value = JSON.parse(output) as unknown
    return (
      Boolean(value) &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).ok === false
    )
  } catch {
    return false
  }
}

/**
 * Derives UI semantics without changing the DSH tool state. DSH's
 * `completed` means that the handler completed, while a tool may still return
 * an explicit failure envelope as ordinary output.
 */
export function getAgentToolPresentation(
  part: AgentToolPart,
  options: { interrupted?: boolean } = {},
): AgentToolPresentation {
  const state = part.state
  if (state.status === "pending" || state.status === "running") return { outcome: state.status }
  if (state.status === "error")
    return {
      detail: state.error,
      outcome: options.interrupted ? "cancelled" : "failure",
    }

  return {
    detail: state.output,
    outcome: part.tool === "invalid" || hasExplicitFailureOutput(state.output) ? "failure" : "success",
  }
}
