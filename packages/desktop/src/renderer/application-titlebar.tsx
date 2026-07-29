import { Search } from "lucide-react"
import { ConvaxBrand } from "./convax-brand"

export type ApplicationTitlebarSurface = "home" | "settings" | "workspace"

export interface ApplicationTitlebarWindowControls {
  closeLabel: string
  fullScreenLabel: string
  groupLabel: string
  minimizeLabel: string
  onClose: () => void
  onMinimize: () => void
  onToggleFullScreen: () => void
}

export interface ApplicationTitlebarProps {
  contextLabel: string
  homeLabel: string
  onBackToProjects: () => void
  onOpenCommands: () => void
  platform: NodeJS.Platform
  commandsLabel: string
  surface: ApplicationTitlebarSurface
  windowControls?: ApplicationTitlebarWindowControls
}

export function ApplicationTitlebar({
  contextLabel,
  homeLabel,
  onBackToProjects,
  onOpenCommands,
  platform,
  commandsLabel,
  surface,
  windowControls,
}: ApplicationTitlebarProps) {
  return (
    <header
      className={`app-titlebar absolute inset-x-0 top-0 z-[60] flex h-11 items-center justify-between bg-transparent pr-2 text-foreground ${
        platform === "darwin" ? "pl-[78px]" : "pl-2"
      }`}
      data-application-titlebar="true"
    >
      {platform === "darwin" && windowControls ? (
        <div
          aria-label={windowControls.groupLabel}
          className="absolute left-[10px] top-[11px] z-10 flex items-center"
          data-macos-window-controls="true"
          role="group"
        >
          <button
            aria-label={windowControls.closeLabel}
            className="grid size-5 place-items-center rounded-full outline-none transition-[filter,transform,box-shadow] duration-100 [@media(hover:hover)]:hover:brightness-105 active:scale-90 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            onClick={windowControls.onClose}
            title={windowControls.closeLabel}
            type="button"
          >
            <span
              aria-hidden
              className="size-3 rounded-full border border-black/15"
              style={{ backgroundColor: "#ff5f57" }}
            />
          </button>
          <button
            aria-label={windowControls.minimizeLabel}
            className="grid size-5 place-items-center rounded-full outline-none transition-[filter,transform,box-shadow] duration-100 [@media(hover:hover)]:hover:brightness-105 active:scale-90 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            onClick={windowControls.onMinimize}
            title={windowControls.minimizeLabel}
            type="button"
          >
            <span
              aria-hidden
              className="size-3 rounded-full border border-black/15"
              style={{ backgroundColor: "#febc2e" }}
            />
          </button>
          <button
            aria-label={windowControls.fullScreenLabel}
            className="grid size-5 place-items-center rounded-full outline-none transition-[filter,transform,box-shadow] duration-100 [@media(hover:hover)]:hover:brightness-105 active:scale-90 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            onClick={windowControls.onToggleFullScreen}
            title={windowControls.fullScreenLabel}
            type="button"
          >
            <span
              aria-hidden
              className="size-3 rounded-full border border-black/15"
              style={{ backgroundColor: "#28c840" }}
            />
          </button>
        </div>
      ) : null}

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

      {surface !== "workspace" ? (
        <div
          className="pointer-events-none absolute left-1/2 max-w-[min(24rem,calc(100%-11rem))] -translate-x-1/2 truncate px-3 text-xs font-medium text-muted-foreground"
          title={contextLabel}
        >
          {contextLabel}
        </div>
      ) : null}

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
      </div>
    </header>
  )
}
