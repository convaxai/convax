import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { forwardRef, useEffect, useState } from "react"

export const ProjectSidebarTrigger = forwardRef<
  HTMLButtonElement,
  { label?: string; onClose?: () => void; onOpen: () => void; open?: boolean }
>(function ProjectSidebarTrigger({ label = "Project", onClose, onOpen, open = false }, ref) {
  const [interactive, setInteractive] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setInteractive(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <div className="pointer-events-auto" data-project-sidebar-entry>
      <button
        aria-expanded={open}
        aria-label={open ? "Close project sidebar" : "Open project sidebar"}
        className={`grid size-8 place-items-center rounded-md text-text-tertiary outline-none transition-[background-color,color,transform] duration-100 ease-out [@media(hover:hover)]:hover:bg-surface-inset [@media(hover:hover)]:hover:text-text-primary active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none${interactive ? "" : " pointer-events-none"}`}
        onClick={interactive ? (open ? onClose : onOpen) : undefined}
        ref={ref}
        title={`${open ? "Close" : "Open"} ${label}`}
        type="button"
      >
        {open ? (
          <PanelLeftClose aria-hidden className="size-4" />
        ) : (
          <PanelLeftOpen aria-hidden className="size-4" />
        )}
      </button>
    </div>
  )
})
