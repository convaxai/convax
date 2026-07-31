import { PanelLeftOpen } from "lucide-react"
import { forwardRef, useEffect, useState } from "react"

export const ProjectSidebarTrigger = forwardRef<
  HTMLButtonElement,
  { hidden?: boolean; label?: string; onOpen: () => void }
>(function ProjectSidebarTrigger({ hidden = false, label = "Project", onOpen }, ref) {
  const [interactive, setInteractive] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setInteractive(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      aria-hidden={hidden || undefined}
      className={`pointer-events-auto transition-[opacity,visibility] duration-150 motion-reduce:transition-none${hidden ? " pointer-events-none invisible opacity-0" : ""}`}
      data-project-sidebar-entry
      data-project-sidebar-entry-state={hidden ? "hidden" : "visible"}
      inert={hidden || undefined}
    >
      <button
        aria-label="Open project sidebar"
        className={`grid size-8 place-items-center rounded-md text-text-tertiary outline-none transition-[background-color,color,transform] duration-100 ease-out [@media(hover:hover)]:hover:bg-surface-inset [@media(hover:hover)]:hover:text-text-primary active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none${interactive ? "" : " pointer-events-none"}`}
        onClick={interactive ? onOpen : undefined}
        ref={ref}
        title={`Open ${label}`}
        type="button"
      >
        <PanelLeftOpen aria-hidden className="size-4" />
      </button>
    </div>
  )
})
