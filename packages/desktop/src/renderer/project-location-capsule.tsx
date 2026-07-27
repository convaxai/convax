import { ChevronRight, LayoutPanelLeft, Library } from "lucide-react"
import type { RefObject } from "react"

export interface ProjectLocationCapsuleProps {
  canvasName: string | null
  detailsButtonRef?: RefObject<HTMLButtonElement | null>
  detailsOpen: boolean
  onBackToProjects?: () => void
  onToggleDetails: () => void
  projectName: string
}

export function ProjectLocationCapsule({
  canvasName,
  detailsButtonRef,
  detailsOpen,
  onBackToProjects,
  onToggleDetails,
  projectName,
}: ProjectLocationCapsuleProps) {
  const visibleCanvasName = canvasName || "No canvas"
  return (
    <div
      className="pointer-events-auto flex h-12 max-w-[min(34rem,calc(100vw-2rem))] items-center gap-1 rounded-lg bg-popover/95 p-1 text-popover-foreground shadow-lg ring-1 ring-border/70"
      data-project-location-capsule="true"
    >
      {onBackToProjects ? (
        <button
          aria-label="Back to projects"
          className="grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-transform duration-100 [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-accent-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
          onClick={onBackToProjects}
          type="button"
        >
          <Library aria-hidden className="size-4" />
        </button>
      ) : null}
      <button
        aria-expanded={detailsOpen}
        aria-label={`${detailsOpen ? "Close" : "Open"} details for ${projectName}, ${visibleCanvasName}`}
        className="flex min-h-10 min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left outline-none transition-transform duration-100 [@media(hover:hover)]:hover:bg-accent active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
        onClick={onToggleDetails}
        ref={detailsButtonRef}
        type="button"
      >
        <LayoutPanelLeft aria-hidden className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 max-w-48 truncate text-xs font-medium" title={projectName}>
          {projectName}
        </span>
        <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 max-w-56 truncate text-xs text-muted-foreground" title={canvasName ?? undefined}>
          {visibleCanvasName}
        </span>
      </button>
    </div>
  )
}
