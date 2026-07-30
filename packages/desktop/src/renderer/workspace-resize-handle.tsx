import { cn } from "@convax/ui"
import type { PointerEventHandler } from "react"

export interface WorkspaceResizeHandleProps {
  edge: "start" | "end"
  label: string
  maximum: number
  minimum: number
  onPointerDown: PointerEventHandler<HTMLDivElement>
  onResizeBy: (delta: number) => void
  value: number
}

export function WorkspaceResizeHandle({
  edge,
  label,
  maximum,
  minimum,
  onPointerDown,
  onResizeBy,
  value,
}: WorkspaceResizeHandleProps) {
  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={maximum}
      aria-valuemin={minimum}
      aria-valuenow={value}
      className={cn(
        "absolute inset-y-0 z-50 w-2 cursor-col-resize touch-none outline-none focus-visible:bg-brand/20",
        edge === "start" ? "-left-1" : "-right-1",
      )}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.preventDefault()
        const direction = edge === "start" ? -1 : 1
        onResizeBy((event.key === "ArrowRight" ? 24 : -24) * direction)
      }}
      onPointerDown={onPointerDown}
      role="separator"
      tabIndex={0}
    />
  )
}
