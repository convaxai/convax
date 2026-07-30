import { useEffect, useRef, type ReactNode } from "react"
import { ProjectSidebarTrigger } from "./project-sidebar-trigger"

export interface ProjectSidebarShellProps {
  children: ReactNode
  entryLabel: string
  onOpenChange(open: boolean): void
  open: boolean
  presentation: "dock" | "overlay"
  resizeHandle?: ReactNode
  size: number
}

/**
 * Desktop-only presentation for the Project-owned sidebar. Workbench owns
 * whether the part is open and its size; this shell only maps that state to a
 * dock or responsive overlay and manages the overlay dismissal boundary.
 */
export function ProjectSidebarShell(props: ProjectSidebarShellProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusOnCloseRef = useRef(true)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const previousOpenRef = useRef(props.open)

  useEffect(() => {
    const wasOpen = previousOpenRef.current
    previousOpenRef.current = props.open
    if (props.open) {
      returnFocusOnCloseRef.current = true
      if (wasOpen) return
      const frame = window.requestAnimationFrame(() =>
        panelRef.current?.querySelector<HTMLElement>("[data-project-sidebar-close]")?.focus({ preventScroll: true }),
      )
      return () => window.cancelAnimationFrame(frame)
    }
    if (!wasOpen) return
    if (!returnFocusOnCloseRef.current) {
      returnFocusOnCloseRef.current = true
      return
    }
    const frame = window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [props.open])

  useEffect(() => {
    if (!props.open || props.presentation !== "overlay") return
    const ownerDocument = triggerRef.current?.ownerDocument ?? document
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('[role="dialog"], [data-ui-menu-surface], [data-project-switcher]')
      ) {
        return
      }
      event.preventDefault()
      returnFocusOnCloseRef.current = true
      props.onOpenChange(false)
    }
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || panelRef.current?.contains(target) || triggerRef.current?.contains(target))
        return
      if (
        target instanceof Element &&
        target.closest('[role="dialog"], [data-ui-menu-surface], [data-project-switcher]')
      ) {
        return
      }
      returnFocusOnCloseRef.current =
        target instanceof Element && Boolean(target.closest("[data-project-sidebar-backdrop]"))
      props.onOpenChange(false)
    }
    ownerDocument.addEventListener("keydown", dismissOnEscape)
    ownerDocument.addEventListener("pointerdown", dismissOnOutsidePointer, true)
    return () => {
      ownerDocument.removeEventListener("keydown", dismissOnEscape)
      ownerDocument.removeEventListener("pointerdown", dismissOnOutsidePointer, true)
    }
  }, [props.onOpenChange, props.open, props.presentation])

  const dock = props.presentation === "dock"
  return (
    <>
      {props.open && !dock ? (
        <button
          aria-label="Close project sidebar"
          className="project-sidebar-backdrop absolute inset-0 z-[39] cursor-default bg-foreground/[0.08]"
          data-project-sidebar-backdrop=""
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return
            event.preventDefault()
            returnFocusOnCloseRef.current = true
            props.onOpenChange(false)
          }}
          tabIndex={-1}
          type="button"
        />
      ) : null}
      <div
        aria-hidden={!props.open || undefined}
        className={`project-sidebar-shell project-sidebar-shell--${props.presentation}`}
        data-project-sidebar-presentation={props.presentation}
        data-project-sidebar-state={props.open ? "open" : "closed"}
        inert={!props.open || undefined}
        ref={panelRef}
        style={{ "--project-sidebar-size": `${props.size}px` } as React.CSSProperties}
      >
        <div className="project-sidebar-shell__panel">{props.children}</div>
        {dock && props.open ? props.resizeHandle : null}
      </div>
      <aside
        aria-hidden={props.open || undefined}
        aria-label="Project sidebar"
        className={`project-sidebar-entry pointer-events-none absolute left-4 top-4 z-40 ${
          props.open ? "project-sidebar-entry--hidden" : ""
        }`}
        inert={props.open || undefined}
      >
        <ProjectSidebarTrigger label={props.entryLabel} onOpen={() => props.onOpenChange(true)} ref={triggerRef} />
      </aside>
    </>
  )
}
