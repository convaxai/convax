import { AlertTriangle, LoaderCircle } from "lucide-react"
import type { WorkspaceActivitySummary } from "./workspace-activity-model"

export function WorkspaceTaskIndicator(props: {
  label: string
  onOpen(): void
  summary: WorkspaceActivitySummary
}) {
  if (props.summary.total === 0) return null
  const needsAttention = props.summary.attention > 0
  return (
    <button
      aria-label={props.label}
      className="flex h-5 items-center gap-1.5 rounded-md px-1.5 text-[10px] tabular-nums text-text-tertiary outline-none transition-[background-color,color,transform] duration-100 [@media(hover:hover)]:hover:bg-interactive-hover [@media(hover:hover)]:hover:text-text-primary active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-focus-ring/50 motion-reduce:transition-none"
      data-workspace-task-indicator
      onClick={props.onOpen}
      type="button"
    >
      {needsAttention ? (
        <AlertTriangle aria-hidden className="size-3 text-status-warning" />
      ) : (
        <LoaderCircle aria-hidden className="size-3 animate-spin text-brand motion-reduce:animate-none" />
      )}
      <span>{props.summary.total}</span>
    </button>
  )
}
