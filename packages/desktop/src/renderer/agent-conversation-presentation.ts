import type { AgentMessage, AgentMessagePart } from "@convax/agent-runtime"
import { getAgentToolPresentation } from "./agent-tool-presentation"

export type AgentConversationToolOutcome = "failure" | "none" | "pending" | "running" | "success"

export interface AgentConversationMessageSlice {
  message: AgentMessage
  parts: AgentMessagePart[]
}

export interface AgentConversationError {
  message: AgentMessage
  text: string
}

export interface AgentConversationToolSummary {
  count: number
  failed: number
  outcome: AgentConversationToolOutcome
  pending: number
  running: number
  succeeded: number
}

export interface AgentConversationTurn {
  activity: AgentConversationMessageSlice[]
  delivery?: AgentConversationMessageSlice
  /** Best available persisted wall-clock duration for a completed turn. */
  durationMs?: number
  /** Render independently from the activity disclosure so failures stay visible. */
  errors: AgentConversationError[]
  id: string
  /** The latest assistant has no completed marker; caller busy state distinguishes streaming from interruption. */
  interrupted: boolean
  tools: AgentConversationToolSummary
  user?: AgentConversationMessageSlice
}

export interface AgentConversationAnnouncementState {
  busy: boolean
  completed: boolean
  messageId?: string
  text: string
}

/** Returns only the assistant-authored text that is safe to place on the clipboard. */
export function agentConversationCopyText(slice: AgentConversationMessageSlice) {
  return slice.parts
    .flatMap((part) => (part.type === "text" && !part.synthetic ? [part.text] : []))
    .join("\n\n")
    .trim()
}

export function agentConversationAnnouncementState(
  slice: AgentConversationMessageSlice | undefined,
  busy: boolean,
): AgentConversationAnnouncementState {
  return {
    busy,
    completed: slice?.message.completedAt !== undefined,
    messageId: slice?.message.id,
    text: slice ? agentConversationCopyText(slice) : "",
  }
}

/**
 * Produces short live-region updates instead of repeatedly announcing the
 * complete streaming response. A completed conversation loaded from history
 * stays quiet because it has no preceding in-view transition.
 */
export function resolveAgentConversationAnnouncement(
  previous: AgentConversationAnnouncementState | undefined,
  next: AgentConversationAnnouncementState,
) {
  if (!previous) {
    if (!next.busy) return undefined
    return next.text ? `Agent response started. ${next.text}` : "Agent response requested."
  }

  const newMessage = Boolean(next.messageId && next.messageId !== previous.messageId)
  const appendedText =
    next.text && (newMessage || !previous.text)
      ? next.text
      : next.text.startsWith(previous.text)
        ? next.text.slice(previous.text.length).trim()
        : undefined

  if (next.completed && (!previous.completed || newMessage)) {
    return appendedText ? `Agent response complete. ${appendedText}` : "Agent response complete."
  }
  if (next.busy && next.text) {
    if (newMessage || !previous.messageId) return `Agent response started. ${next.text}`
    if (appendedText) return `Agent response continued. ${appendedText}`
    if (next.text !== previous.text) return "Agent response updated."
  }
  if (previous.busy && !next.busy) return "Agent response ended."
  if (!previous.busy && next.busy && !next.text) return "Agent response requested."
  return undefined
}

/** Uses the structured turn projection; never reparses tool output or display text. */
export function agentConversationTurnHasFailure(turn: AgentConversationTurn) {
  return turn.errors.length > 0 || turn.tools.failed > 0
}

function partType(part: AgentMessagePart) {
  // Keep this presentation layer compatible with newly admitted part kinds. In
  // particular, Skill parts are added by the runtime as visible rich content.
  return (part as { type: string }).type
}

function isVisibleConversationPart(part: AgentMessagePart) {
  const type = partType(part)
  if (type === "skill") return true
  if (part.type === "file") return true
  return part.type === "text" && !part.synthetic && Boolean(part.text.trim())
}

function isDeliveryCandidate(message: AgentMessage) {
  if (message.error) return true
  return message.parts.some((part) => {
    if (part.type === "file") return true
    return part.type === "text" && !part.synthetic && Boolean(part.text.trim())
  })
}

function summarizeTools(activity: readonly AgentConversationMessageSlice[]): AgentConversationToolSummary {
  const summary: AgentConversationToolSummary = {
    count: 0,
    failed: 0,
    outcome: "none",
    pending: 0,
    running: 0,
    succeeded: 0,
  }

  for (const entry of activity) {
    for (const part of entry.parts) {
      if (part.type !== "tool") continue
      summary.count += 1
      switch (getAgentToolPresentation(part).outcome) {
        case "failure":
          summary.failed += 1
          break
        case "pending":
          summary.pending += 1
          break
        case "running":
          summary.running += 1
          break
        case "success":
          summary.succeeded += 1
          break
      }
    }
  }

  summary.outcome =
    summary.running > 0
      ? "running"
      : summary.pending > 0
        ? "pending"
        : summary.failed > 0
          ? "failure"
          : summary.succeeded > 0
            ? "success"
            : "none"
  return summary
}

function presentTurn(user: AgentMessage | undefined, assistants: AgentMessage[]): AgentConversationTurn {
  let deliveryIndex = -1
  for (let index = assistants.length - 1; index >= 0; index -= 1) {
    if (isDeliveryCandidate(assistants[index])) {
      deliveryIndex = index
      break
    }
  }

  const activity: AgentConversationMessageSlice[] = []
  let delivery: AgentConversationMessageSlice | undefined
  for (const [index, message] of assistants.entries()) {
    if (index !== deliveryIndex) {
      activity.push({ message, parts: [...message.parts] })
      continue
    }

    const deliveryParts = message.parts.filter(isVisibleConversationPart)
    const activityParts = message.parts.filter((part) => !isVisibleConversationPart(part))
    delivery = { message, parts: deliveryParts }
    if (activityParts.length > 0) activity.push({ message, parts: activityParts })
  }

  const firstMessage = user ?? assistants[0]
  if (!firstMessage) throw new Error("An Agent conversation turn requires at least one message")
  const completedAt = assistants.reduce<number | undefined>(
    (latest, message) =>
      message.completedAt === undefined ? latest : Math.max(latest ?? message.completedAt, message.completedAt),
    undefined,
  )
  const durationMs =
    completedAt !== undefined && completedAt >= firstMessage.createdAt
      ? completedAt - firstMessage.createdAt
      : undefined
  const userParts = user?.parts.filter(isVisibleConversationPart) ?? []

  return {
    activity,
    delivery,
    durationMs,
    errors: assistants.flatMap((message) => (message.error ? [{ message, text: message.error }] : [])),
    id: firstMessage.id,
    interrupted: Boolean(assistants.at(-1) && assistants.at(-1)?.completedAt === undefined),
    tools: summarizeTools(activity),
    user: user && userParts.length > 0 ? { message: user, parts: userParts } : undefined,
  }
}

/**
 * Groups the ordered OpenCode message stream into user turns and separates the
 * primary delivery from inspectable activity. Activity remains available to a
 * caller that wants to reveal it, while final text, files, Skills, and errors
 * can stay visible when activity is collapsed. Pending permission and question
 * requests are intentionally outside this message-only model and must remain
 * visible alongside the resulting turns.
 */
export function buildAgentConversationTurns(messages: readonly AgentMessage[]): AgentConversationTurn[] {
  const turns: AgentConversationTurn[] = []
  let user: AgentMessage | undefined
  let assistants: AgentMessage[] = []

  const flush = () => {
    if (!user && assistants.length === 0) return
    turns.push(presentTurn(user, assistants))
    user = undefined
    assistants = []
  }

  for (const message of messages) {
    if (message.role === "user") {
      flush()
      user = message
    } else {
      assistants.push(message)
    }
  }
  flush()
  return turns
}
