import { Button, cn } from "@convax/ui"
import { FileStack, ListTree, PanelsTopLeft, Pin, PinOff, X } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react"
import type { WorkspacePanelPresentation } from "./workspace-layout-model"

export type ProjectDetailsTab = "resources" | "canvases" | "outline"

export interface ProjectDetailsPanelProps {
  canvases: ReactNode
  initialTab?: ProjectDetailsTab
  mode: Exclude<WorkspacePanelPresentation, "hidden">
  onClose: () => void
  onPinnedChange: (pinned: boolean) => void
  open: boolean
  outline: ReactNode
  pinned: boolean
  projectName: string
  resources: ReactNode
  returnFocusRef?: RefObject<HTMLElement | null>
}

const projectDetailsTabs = [
  { icon: FileStack, label: "Resources", value: "resources" },
  { icon: PanelsTopLeft, label: "Canvases", value: "canvases" },
  { icon: ListTree, label: "Outline", value: "outline" },
] as const

export function ProjectDetailsPanel({
  canvases,
  initialTab = "resources",
  mode,
  onClose,
  onPinnedChange,
  open,
  outline,
  pinned,
  projectName,
  resources,
  returnFocusRef,
}: ProjectDetailsPanelProps) {
  const [activeTab, setActiveTab] = useState<ProjectDetailsTab>(initialTab)
  const panelRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const returnFocusTargetRef = useRef<HTMLElement | null>(null)
  const temporary = mode !== "dock"
  onCloseRef.current = onClose

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab, projectName])

  useEffect(() => {
    if (!open || !temporary) return undefined
    returnFocusTargetRef.current =
      returnFocusRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopImmediatePropagation()
      onCloseRef.current()
      queueMicrotask(() => returnFocusTargetRef.current?.isConnected && returnFocusTargetRef.current.focus())
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (panelRef.current?.contains(event.target)) return
      if (returnFocusRef?.current?.contains(event.target)) return
      onCloseRef.current()
      queueMicrotask(() => returnFocusTargetRef.current?.isConnected && returnFocusTargetRef.current.focus())
    }
    document.addEventListener("keydown", handleKeyDown, true)
    document.addEventListener("pointerdown", handlePointerDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true)
      document.removeEventListener("pointerdown", handlePointerDown)
    }
  }, [open, returnFocusRef, temporary])

  useEffect(() => {
    const panel = panelRef.current
    if (!open || mode !== "sheet" || !panel) return undefined

    const isolated = new Map<HTMLElement, { ariaHidden: string | null; inert: boolean }>()
    let branch: HTMLElement = panel
    let parent = branch.parentElement
    while (parent) {
      for (const sibling of parent.children) {
        if (!(sibling instanceof HTMLElement) || sibling === branch || isolated.has(sibling)) continue
        isolated.set(sibling, {
          ariaHidden: sibling.getAttribute("aria-hidden"),
          inert: sibling.inert,
        })
        sibling.inert = true
        sibling.setAttribute("aria-hidden", "true")
      }
      if (parent === document.body) break
      branch = parent
      parent = branch.parentElement
    }

    const selectedTab = panel.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    const initialFocusTarget = selectedTab ?? panel
    initialFocusTarget.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true")
      if (!focusable.length) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]!
      const last = focusable.at(-1)!
      const active = document.activeElement
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", handleKeyDown, true)
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true)
      for (const [element, previous] of isolated) {
        element.inert = previous.inert
        if (previous.ariaHidden === null) element.removeAttribute("aria-hidden")
        else element.setAttribute("aria-hidden", previous.ariaHidden)
      }
    }
  }, [mode, open])

  if (!open) return null

  const content = activeTab === "resources" ? resources : activeTab === "canvases" ? canvases : outline
  const closePanel = () => {
    onCloseRef.current()
    const target = returnFocusTargetRef.current ?? returnFocusRef?.current
    queueMicrotask(() => target?.isConnected && target.focus())
  }
  return (
    <aside
      aria-label={`${projectName} details`}
      aria-modal={mode === "sheet" || undefined}
      className={cn(
        "flex min-h-0 flex-col overflow-hidden overscroll-contain bg-popover text-popover-foreground shadow-xl ring-1 ring-border/70",
        mode === "dock" && "relative h-full w-full shadow-none",
        mode === "overlay" && "absolute inset-y-3 left-3 z-40 w-[min(360px,calc(100vw-24px))] rounded-lg",
        mode === "sheet" && "absolute inset-0 z-50 size-full rounded-none",
      )}
      data-project-details-panel={mode}
      ref={panelRef}
      role={mode === "sheet" ? "dialog" : "complementary"}
      tabIndex={mode === "sheet" ? -1 : undefined}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold" title={projectName}>
            {projectName}
          </h2>
          <p className="text-[11px] text-muted-foreground">Project details</p>
        </div>
        <Button
          aria-label={pinned ? "Unpin Project Details" : "Pin Project Details"}
          aria-pressed={pinned}
          className="size-10"
          onClick={() => onPinnedChange(!pinned)}
          size="icon"
          variant="ghost"
        >
          {pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
        </Button>
        <Button aria-label="Close Project Details" className="size-10" onClick={closePanel} size="icon" variant="ghost">
          <X aria-hidden />
        </Button>
      </header>

      <div
        aria-label="Project detail sections"
        className="grid shrink-0 grid-cols-3 gap-1 border-b border-border/70 p-2"
        role="tablist"
      >
        {projectDetailsTabs.map((tab) => {
          const Icon = tab.icon
          const selected = activeTab === tab.value
          return (
            <button
              aria-controls={`project-details-${tab.value}`}
              aria-selected={selected}
              className={cn(
                "flex min-h-10 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none transition-transform duration-100 [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-accent-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none",
                selected && "bg-accent text-accent-foreground",
              )}
              data-project-details-tab={tab.value}
              id={`project-details-tab-${tab.value}`}
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              role="tab"
              type="button"
            >
              <Icon aria-hidden className="size-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      <div
        aria-labelledby={`project-details-tab-${activeTab}`}
        className="min-h-0 flex-1 overflow-auto"
        id={`project-details-${activeTab}`}
        role="tabpanel"
      >
        {content ?? (
          <div className="grid min-h-40 place-items-center px-6 text-center text-xs text-muted-foreground">
            This view is unavailable.
          </div>
        )}
      </div>
    </aside>
  )
}
