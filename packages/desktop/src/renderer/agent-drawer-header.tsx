import { Button, cn, Tooltip } from "@convax/ui"
import { Bot, ChevronRight, History, Plus } from "lucide-react"
import type { ReactNode } from "react"
import type { AgentCompactStatus, AgentCompactStatusKind } from "./agent-panel-state"

function statusTone(kind: AgentCompactStatusKind) {
  switch (kind) {
    case "failed":
      return "bg-status-danger"
    case "needs-approval":
      return "bg-status-warning"
    case "pending-changes":
      return "bg-status-success"
    case "working":
      return "bg-status-info"
    default:
      return "bg-text-disabled"
  }
}

function StatusLabel(props: { status: AgentCompactStatus }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-text-tertiary" title={props.status.detail}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", statusTone(props.status.kind))} />
      <span className="truncate">{props.status.label}</span>
    </span>
  )
}

function AgentIdentity(props: {
  className?: string
  status: AgentCompactStatus
  title: string
  toolCount?: number
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", props.className)}>
      <span className="truncate text-xs font-medium text-text-primary">{props.title}</span>
      <StatusLabel status={props.status} />
      {props.toolCount !== undefined ? (
        <span className="shrink-0 text-[9px] tabular-nums text-text-disabled">{props.toolCount} tools</span>
      ) : null}
    </div>
  )
}

export function AgentDrawerTrigger(props: { onOpen(): void; status: AgentCompactStatus }) {
  return (
    <div
      className="pointer-events-auto rounded-lg bg-surface-raised p-1 shadow-[var(--ui-shadow-low)]"
      data-agent-drawer-entry
    >
      <span aria-live="polite" className="sr-only" role="status">
        Agent status: {props.status.label}
      </span>
      <button
        aria-label="Open agent"
        className="flex min-h-9 items-center gap-2 rounded-md px-2.5 text-xs font-medium text-text-secondary outline-none transition-[background-color,color,transform] duration-100 ease-out [@media(hover:hover)]:hover:bg-surface-inset [@media(hover:hover)]:hover:text-text-primary active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
        onClick={() => props.onOpen()}
        type="button"
      >
        <Bot className="size-3.5 text-brand" />
        <StatusLabel status={props.status} />
      </button>
    </div>
  )
}

export function AgentDrawerHeader(props: {
  closeLabel?: string
  createDisabled: boolean
  historyVisible: boolean
  onClose?(): void
  onCreate(): void
  onHistory?(): void
  restart?: boolean
  status: AgentCompactStatus
  title: string
  toolCount?: number
  utilityNavigation?: ReactNode
}) {
  return (
    <header className="relative z-10 shrink-0 bg-card">
      <div className="flex h-10 items-center gap-1.5 px-2.5">
        <Bot aria-hidden="true" className="size-3.5 shrink-0 text-brand" />
        {props.utilityNavigation ? (
          <div className="flex min-w-0 flex-1">{props.utilityNavigation}</div>
        ) : (
          <AgentIdentity
            className="flex-1"
            status={props.status}
            title={props.title}
            toolCount={props.toolCount}
          />
        )}
        {props.onHistory ? (
          <Tooltip content="Conversation history">
            <Button
              aria-label="Conversation history"
              aria-pressed={props.historyVisible}
              className={cn(
                "size-7 rounded-md text-text-tertiary active:scale-[0.96] [&_svg]:size-3.5",
                props.historyVisible && "bg-surface-inset text-text-primary",
              )}
              onClick={() => props.onHistory?.()}
              size="icon-sm"
              variant="ghost"
            >
              <History />
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip content={props.restart ? "Restart conversation for this context" : "New conversation"}>
          <Button
            aria-label={props.restart ? "Restart embedded conversation" : "New conversation"}
            className="size-7 rounded-md text-text-tertiary active:scale-[0.96] [&_svg]:size-3.5"
            disabled={props.createDisabled}
            onClick={() => props.onCreate()}
            size="icon-sm"
            variant="ghost"
          >
            <Plus />
          </Button>
        </Tooltip>
        {props.onClose ? (
          <Tooltip content={props.closeLabel ?? "Close agent"}>
            <Button
              aria-label={props.closeLabel ?? "Close agent"}
              className="size-7 rounded-md text-text-tertiary active:scale-[0.96] [&_svg]:size-3.5"
              onClick={() => props.onClose?.()}
              size="icon-sm"
              variant="ghost"
            >
              <ChevronRight />
            </Button>
          </Tooltip>
        ) : null}
      </div>
      {props.utilityNavigation ? (
        <AgentIdentity
          className="h-7 border-t border-border-subtle px-3"
          status={props.status}
          title={props.title}
          toolCount={props.toolCount}
        />
      ) : null}
    </header>
  )
}
