import type {
  AgentActivityProjectionContext,
  AgentActivityState,
  AgentMessage,
  AgentSessionState,
} from "./contracts"

export const agentActivityPriority = {
  "needs-input": 0,
  blocked: 1,
  ready: 2,
  running: 3,
  idle: 4,
} as const satisfies Record<AgentActivityState["state"], number>

function latestAssistantMessage(messages: readonly AgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "assistant") return message
  }
  return undefined
}

/**
 * Projects only lifecycle facts. Message parts, errors, request metadata,
 * directories, titles, retry diagnostics, and question text never cross this boundary.
 */
export function projectAgentActivity(
  session: AgentSessionState,
  context: AgentActivityProjectionContext = {},
): AgentActivityState {
  if (context.canceled) return { state: "idle" }
  if (session.pendingQuestions.length > 0) return { input: "question", state: "needs-input" }
  if (session.pendingPermissions.length > 0) return { input: "permission", state: "needs-input" }
  if (session.status.type === "busy" || session.status.type === "retry") return { state: "running" }

  const assistant = latestAssistantMessage(session.messages)
  if (assistant?.error !== undefined) return { state: "blocked" }
  if (
    assistant?.completedAt !== undefined &&
    (context.seenAfter === undefined || assistant.completedAt > context.seenAfter)
  ) {
    return { state: "ready" }
  }
  return { state: "idle" }
}

export function compareAgentActivity(left: AgentActivityState, right: AgentActivityState) {
  return agentActivityPriority[left.state] - agentActivityPriority[right.state]
}
