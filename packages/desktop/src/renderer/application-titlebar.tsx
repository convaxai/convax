import { ChevronRight, LayoutPanelLeft, Search, Settings } from "lucide-react"
import type { RefObject } from "react"
import { ConvaxBrand } from "./convax-brand"

export type ApplicationTitlebarSurface = "home" | "settings" | "workspace"

export interface ApplicationTitlebarProps {
  canvasName?: string | null
  contextLabel: string
  detailsButtonRef?: RefObject<HTMLButtonElement | null>
  detailsOpen?: boolean
  homeLabel: string
  onBackToProjects: () => void
  onOpenCommands: () => void
  onOpenSettings: () => void
  onToggleDetails?: () => void
  platform: NodeJS.Platform
  projectName?: string
  commandsLabel: string
  settingsLabel: string
  surface: ApplicationTitlebarSurface
}

export function ApplicationTitlebar({
  canvasName,
  contextLabel,
  detailsButtonRef,
  detailsOpen = false,
  homeLabel,
  onBackToProjects,
  onOpenCommands,
  onOpenSettings,
  onToggleDetails,
  platform,
  projectName,
  commandsLabel,
  settingsLabel,
  surface,
}: ApplicationTitlebarProps) {
  const visibleCanvasName = canvasName || "No canvas"
  const workspaceContext = surface === "workspace" && projectName && onToggleDetails

  return (
    <header
      className={`app-titlebar relative flex h-11 shrink-0 items-center justify-between bg-background/95 pr-2 text-foreground ${
        platform === "darwin" ? "pl-[78px]" : "pl-2"
      }`}
      data-application-titlebar="true"
    >
      <button
        aria-current={surface === "home" ? "page" : undefined}
        aria-label={homeLabel}
        className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-[background-color,color,transform] duration-100 [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-accent-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
        onClick={onBackToProjects}
        title={homeLabel}
        type="button"
      >
        <ConvaxBrand className="text-foreground" />
      </button>

      {workspaceContext ? (
        <button
          aria-expanded={detailsOpen}
          aria-label={`${detailsOpen ? "Close" : "Open"} details for ${projectName}, ${visibleCanvasName}`}
          className="absolute left-1/2 flex h-8 max-w-[min(32rem,calc(100%-11rem))] -translate-x-1/2 items-center gap-1.5 rounded-md px-2.5 text-xs outline-none transition-[background-color,transform] duration-100 [@media(hover:hover)]:hover:bg-accent active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
          onClick={onToggleDetails}
          ref={detailsButtonRef}
          title={`${projectName} / ${visibleCanvasName}`}
          type="button"
        >
          <LayoutPanelLeft aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 max-w-48 truncate font-medium" title={projectName}>
            {projectName}
          </span>
          <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/70" />
          <span className="min-w-0 max-w-56 truncate text-muted-foreground" title={canvasName ?? undefined}>
            {visibleCanvasName}
          </span>
        </button>
      ) : (
        <div
          className="pointer-events-none absolute left-1/2 max-w-[min(24rem,calc(100%-11rem))] -translate-x-1/2 truncate px-3 text-xs font-medium text-muted-foreground"
          title={contextLabel}
        >
          {contextLabel}
        </div>
      )}

      <div className="flex items-center gap-0.5">
        <button
          aria-label={commandsLabel}
          className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-[background-color,color,transform] duration-100 [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-accent-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
          onClick={onOpenCommands}
          title={`${commandsLabel} · ⌘K`}
          type="button"
        >
          <Search aria-hidden className="size-4" />
        </button>
        <button
          aria-current={surface === "settings" ? "page" : undefined}
          aria-label={settingsLabel}
          className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition-[background-color,color,transform] duration-100 [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-accent-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
          onClick={onOpenSettings}
          title={settingsLabel}
          type="button"
        >
          <Settings aria-hidden className="size-4" />
        </button>
      </div>
    </header>
  )
}
