import { ArrowLeft } from "lucide-react"
import type { ReactNode, Ref } from "react"

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
  centerAction?: ReactNode
  contextLabel: string
  homeLabel: string
  leadingActionHostRef?: Ref<HTMLDivElement>
  onBackToProjects: () => void
  platform: NodeJS.Platform
  productLabel?: string
  rightAction?: ReactNode
  surface: ApplicationTitlebarSurface
  windowControls?: ApplicationTitlebarWindowControls
}

export function ApplicationTitlebar({
  centerAction,
  contextLabel,
  homeLabel,
  leadingActionHostRef,
  onBackToProjects,
  platform,
  productLabel = "Convax",
  rightAction,
  surface,
  windowControls,
}: ApplicationTitlebarProps) {
  return (
    <header
      className={`app-titlebar relative z-[60] flex h-11 shrink-0 items-center justify-between bg-surface-panel pr-2 text-foreground ${
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

      <div className="flex min-w-0 items-center gap-1.5">
        <div
          className="flex min-w-0 shrink-0 items-center"
          data-application-titlebar-leading=""
          ref={leadingActionHostRef}
        />
        <span
          className="max-w-[min(18rem,32vw)] truncate px-1 text-sm font-semibold tracking-[-0.01em] text-text-primary"
          data-application-product-name=""
          title={productLabel}
        >
          {productLabel}
        </span>
        {surface === "settings" ? (
          <button
            aria-label={homeLabel}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-[background-color,color,transform] duration-100 [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-accent-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none"
            onClick={onBackToProjects}
            title={homeLabel}
            type="button"
          >
            <ArrowLeft aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>

      {surface === "workspace" ? (
        <div
          className="absolute left-1/2 min-w-0 max-w-[min(32rem,calc(100%-22rem))] -translate-x-1/2"
          data-application-titlebar-center=""
        >
          {centerAction}
        </div>
      ) : (
        <div
          className="pointer-events-none absolute left-1/2 max-w-[min(24rem,calc(100%-11rem))] -translate-x-1/2 truncate px-3 text-xs font-medium text-muted-foreground"
          title={contextLabel}
        >
          {contextLabel}
        </div>
      )}
      <div className="flex shrink-0 items-center" data-application-titlebar-right="">
        {rightAction}
      </div>
    </header>
  )
}
