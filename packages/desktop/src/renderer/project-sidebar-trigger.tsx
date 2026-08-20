import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { forwardRef } from "react"

export const ProjectSidebarTrigger = forwardRef<
  HTMLButtonElement,
  { collapseLabel?: string; label?: string; onOpenChange: (open: boolean) => void; open?: boolean }
>(function ProjectSidebarTrigger(
  { collapseLabel = "Collapse project sidebar", label = "Project", onOpenChange, open = false },
  ref,
) {
  const actionLabel = open ? collapseLabel : "Open project sidebar"
  return (
    <div
      className="pointer-events-auto"
      data-project-sidebar-entry
      data-project-sidebar-entry-state={open ? "open" : "closed"}
    >
      <button
        aria-label={actionLabel}
        className="grid size-8 place-items-center rounded-md text-text-tertiary outline-none transition-[background-color,color,transform] duration-100 ease-out [@media(hover:hover)]:hover:bg-surface-inset [@media(hover:hover)]:hover:text-text-primary active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
        data-project-sidebar-close={open || undefined}
        onClick={() => onOpenChange(!open)}
        ref={ref}
        title={open ? collapseLabel : `Open ${label}`}
        type="button"
      >
        {open ? <PanelLeftClose aria-hidden className="size-4" /> : <PanelLeftOpen aria-hidden className="size-4" />}
      </button>
    </div>
  )
})
