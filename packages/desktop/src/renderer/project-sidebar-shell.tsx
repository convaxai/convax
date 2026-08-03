import { useEffect, useReducer, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { transitionProjectSidebarHover } from "./project-sidebar-hover-state"
import { ProjectSidebarTrigger } from "./project-sidebar-trigger"

export interface ProjectSidebarShellProps {
  children: ReactNode
  entryLabel: string
  entryPortal?: Element | null
  onOpenChange(open: boolean): void
  open: boolean
  resizeHandle?: ReactNode
  size: number
}

/**
 * Desktop-only presentation for the Project-owned sidebar. Workbench owns
 * whether the part is pinned and its size. This shell owns only the transient
 * hover preview: pinned state consumes layout width, while hover state floats.
 */
export function ProjectSidebarShell(props: ProjectSidebarShellProps) {
  const [hoverState, dispatchHover] = useReducer(transitionProjectSidebarHover, "idle")
  const hoverCloseTimerRef = useRef<number | null>(null)
  const entryPointerInsideRef = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const previousOpenRef = useRef(props.open)
  const hoverReveal = !props.open && hoverState === "revealed"
  const reveal = props.open ? "pinned" : hoverReveal ? "hover" : "closed"
  const revealed = reveal !== "closed"
  const presentation = props.open ? "dock" : "overlay"

  const cancelHoverClose = () => {
    if (hoverCloseTimerRef.current === null) return
    window.clearTimeout(hoverCloseTimerRef.current)
    hoverCloseTimerRef.current = null
  }

  const scheduleHoverClose = () => {
    if (props.open) return
    cancelHoverClose()
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null
      if (panelRef.current?.contains(panelRef.current.ownerDocument.activeElement)) return
      dispatchHover("dismiss")
    }, 120)
  }

  useEffect(
    () => () => {
      if (hoverCloseTimerRef.current !== null) window.clearTimeout(hoverCloseTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    const wasOpen = previousOpenRef.current
    previousOpenRef.current = props.open
    if (props.open) {
      dispatchHover("pin")
      if (wasOpen) return
      const frame = window.requestAnimationFrame(() =>
        panelRef.current?.querySelector<HTMLElement>("[data-project-sidebar-close]")?.focus({ preventScroll: true }),
      )
      return () => window.cancelAnimationFrame(frame)
    }
    if (!wasOpen) return
    dispatchHover(entryPointerInsideRef.current ? "unpin-inside-entry" : "unpin-outside-entry")
    const frame = window.requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [props.open])

  useEffect(() => {
    if (!hoverReveal) return
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
      dispatchHover("dismiss")
      triggerRef.current?.focus({ preventScroll: true })
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
      dispatchHover("dismiss")
    }
    ownerDocument.addEventListener("keydown", dismissOnEscape)
    ownerDocument.addEventListener("pointerdown", dismissOnOutsidePointer, true)
    return () => {
      ownerDocument.removeEventListener("keydown", dismissOnEscape)
      ownerDocument.removeEventListener("pointerdown", dismissOnOutsidePointer, true)
    }
  }, [hoverReveal])

  return (
    <>
      <div
        aria-hidden={!revealed || undefined}
        className={`project-sidebar-shell project-sidebar-shell--${presentation}`}
        data-project-sidebar-presentation={presentation}
        data-project-sidebar-reveal={reveal}
        data-project-sidebar-state={revealed ? "open" : "closed"}
        inert={!revealed || undefined}
        onBlur={(event) => {
          if (
            props.open ||
            (event.relatedTarget instanceof Node &&
              (panelRef.current?.contains(event.relatedTarget) || triggerRef.current?.contains(event.relatedTarget)))
          )
            return
          cancelHoverClose()
          dispatchHover("dismiss")
        }}
        onPointerEnter={cancelHoverClose}
        onPointerLeave={scheduleHoverClose}
        ref={panelRef}
        style={{ "--project-sidebar-size": `${props.size}px` } as React.CSSProperties}
      >
        <div className="project-sidebar-shell__panel">{props.children}</div>
        {props.resizeHandle}
      </div>
      {props.entryPortal
        ? createPortal(
            <ProjectSidebarEntry
              entryLabel={props.entryLabel}
              hoverOpen={hoverReveal}
              onHoverClose={() => {
                entryPointerInsideRef.current = false
                dispatchHover("entry-leave")
                scheduleHoverClose()
              }}
              onHoverOpen={() => {
                entryPointerInsideRef.current = true
                cancelHoverClose()
                dispatchHover("entry-enter")
              }}
              onOpen={() => {
                dispatchHover("pin")
                props.onOpenChange(true)
              }}
              open={props.open}
              triggerRef={triggerRef}
            />,
            props.entryPortal,
          )
        : null}
      {props.entryPortal === undefined ? (
        <ProjectSidebarEntry
          entryLabel={props.entryLabel}
          hoverOpen={hoverReveal}
          onHoverClose={() => {
            entryPointerInsideRef.current = false
            dispatchHover("entry-leave")
            scheduleHoverClose()
          }}
          onHoverOpen={() => {
            entryPointerInsideRef.current = true
            cancelHoverClose()
            dispatchHover("entry-enter")
          }}
          onOpen={() => {
            dispatchHover("pin")
            props.onOpenChange(true)
          }}
          open={props.open}
          triggerRef={triggerRef}
        />
      ) : null}
    </>
  )
}

function ProjectSidebarEntry({
  entryLabel,
  hoverOpen,
  onHoverClose,
  onHoverOpen,
  onOpen,
  open,
  triggerRef,
}: {
  entryLabel: string
  hoverOpen: boolean
  onHoverClose(): void
  onHoverOpen(): void
  onOpen(): void
  open: boolean
  triggerRef: React.RefObject<HTMLButtonElement | null>
}) {
  return (
    <aside
      aria-label="Project sidebar"
      className="project-sidebar-entry pointer-events-auto"
      data-project-sidebar-entry-state={open ? "open" : hoverOpen ? "hover" : "closed"}
      onPointerEnter={(event) => {
        if (event.pointerType === "touch") return
        onHoverOpen()
      }}
      onPointerLeave={onHoverClose}
    >
      <ProjectSidebarTrigger hidden={open} label={entryLabel} onOpen={onOpen} ref={triggerRef} />
    </aside>
  )
}
