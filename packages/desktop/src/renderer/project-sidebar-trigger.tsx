import { PanelLeftOpen } from "lucide-react"
import { forwardRef, useEffect, useState } from "react"

export const ProjectSidebarTrigger = forwardRef<HTMLButtonElement, { label?: string; onOpen: () => void }>(
  function ProjectSidebarTrigger({ label = "Project", onOpen }, ref) {
    const [interactive, setInteractive] = useState(false)

    useEffect(() => {
      const frame = window.requestAnimationFrame(() => setInteractive(true))
      return () => window.cancelAnimationFrame(frame)
    }, [])

    return (
      <div
        className="pointer-events-auto rounded-lg bg-surface-raised p-1 shadow-[var(--ui-shadow-low)]"
        data-project-sidebar-entry
      >
        <button
          aria-label="Open project sidebar"
          className={`flex min-h-9 items-center gap-2 rounded-md px-2.5 text-xs font-medium text-text-secondary outline-none transition-[background-color,color,transform] duration-100 ease-out [@media(hover:hover)]:hover:bg-surface-inset [@media(hover:hover)]:hover:text-text-primary active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none${interactive ? "" : " pointer-events-none"}`}
          onClick={interactive ? onOpen : undefined}
          ref={ref}
          type="button"
        >
          <PanelLeftOpen aria-hidden className="size-3.5 text-brand" />
          <span className="max-w-36 truncate">{label}</span>
        </button>
      </div>
    )
  },
)
