import { AlertTriangle, Check, ChevronDown, ChevronRight, ListTree, LoaderCircle } from "lucide-react"
import { useState, type ReactNode } from "react"
import type { AgentConversationTurn } from "./agent-conversation-presentation"

export type AgentActivityTone = "failure" | "neutral" | "running" | "success" | "warning"

export interface AgentActivityDescription {
  detail?: string
  label: string
  tone: AgentActivityTone
}

export function formatAgentActivityDuration(durationMs: number | undefined) {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return undefined
  if (durationMs < 1_000) return "<1s"
  const totalSeconds = Math.max(1, Math.round(durationMs / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return [
    hours ? `${hours}h` : undefined,
    minutes ? `${minutes}m` : undefined,
    seconds || (!hours && !minutes) ? `${seconds}s` : undefined,
  ]
    .filter(Boolean)
    .join(" ")
}

function joinDetail(parts: Array<string | undefined>) {
  const detail = parts.filter(Boolean).join(" · ")
  return detail || undefined
}

function completedCounts(turn: AgentConversationTurn) {
  return joinDetail([
    turn.tools.succeeded ? `${turn.tools.succeeded} succeeded` : undefined,
    turn.tools.failed ? `${turn.tools.failed} failed` : undefined,
    formatAgentActivityDuration(turn.durationMs),
  ])
}

export function describeAgentActivity(
  turn: AgentConversationTurn,
  options: { awaitingInput?: boolean; busy: boolean },
): AgentActivityDescription {
  if (options.awaitingInput) {
    return {
      detail: joinDetail([
        turn.tools.succeeded ? `${turn.tools.succeeded} complete` : undefined,
        turn.tools.running ? `${turn.tools.running} running` : undefined,
      ]),
      label: "Needs your response",
      tone: "warning",
    }
  }
  if (options.busy) {
    return {
      detail: joinDetail([
        turn.tools.succeeded ? `${turn.tools.succeeded} complete` : undefined,
        turn.tools.running ? `${turn.tools.running} running` : undefined,
        turn.tools.pending ? `${turn.tools.pending} queued` : undefined,
      ]),
      label: "Working",
      tone: "running",
    }
  }
  if (turn.interrupted) {
    return {
      detail: completedCounts(turn),
      label: "Interrupted",
      tone: "warning",
    }
  }
  if (turn.errors.length > 0 || turn.tools.failed > 0) {
    return {
      detail: completedCounts(turn),
      label: "Completed with errors",
      tone: "failure",
    }
  }
  return {
    detail: completedCounts(turn),
    label: "Activity complete",
    tone: turn.tools.succeeded > 0 ? "success" : "neutral",
  }
}

function ActivityIcon(props: { tone: AgentActivityTone }) {
  if (props.tone === "running")
    return <LoaderCircle className="size-3.5 animate-spin text-status-info motion-reduce:animate-none" />
  if (props.tone === "failure") return <AlertTriangle className="size-3.5 text-status-danger" />
  if (props.tone === "warning") return <AlertTriangle className="size-3.5 text-status-warning" />
  if (props.tone === "success") return <Check className="size-3.5 text-status-success" />
  return <ListTree className="size-3.5 text-text-tertiary" />
}

export function AgentActivitySummary(props: {
  awaitingInput?: boolean
  busy?: boolean
  children: ReactNode
  turn: AgentConversationTurn
}) {
  const [expanded, setExpanded] = useState(false)
  const description = describeAgentActivity(props.turn, {
    awaitingInput: props.awaitingInput,
    busy: props.busy === true,
  })
  return (
    <section className="agent-activity text-xs" data-agent-activity data-agent-activity-state={description.tone}>
      <button
        aria-expanded={expanded}
        className="agent-activity__trigger flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-text-tertiary outline-none transition-[background-color,color,transform] duration-100 ease-out [@media(hover:hover)]:hover:bg-surface-inset [@media(hover:hover)]:hover:text-text-primary active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <ActivityIcon tone={description.tone} />
        <span aria-live={description.tone === "running" ? "polite" : undefined} className="min-w-0 flex-1">
          <span className="block truncate font-medium text-text-secondary">{description.label}</span>
          {description.detail ? (
            <span className="mt-0.5 block truncate text-[10px] tabular-nums text-text-tertiary">
              {description.detail}
            </span>
          ) : null}
        </span>
        {expanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
      </button>
      {expanded ? (
        <div
          className="agent-activity__content mt-1 space-y-1 rounded-md bg-surface-inset/65 p-1 text-text-tertiary"
          data-agent-activity-content
        >
          {props.children}
        </div>
      ) : null}
    </section>
  )
}
