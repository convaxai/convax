import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { cn } from "../lib/utils"

type TooltipSide = "bottom" | "left" | "right" | "top"

type TooltipEntry = {
  anchor: HTMLElement
  content: ReactNode
  descriptionTarget: HTMLElement
  id: string
  side: TooltipSide
}

type TooltipController = {
  activeId: string | null
  cancelHide: () => void
  dismissForPointer: () => void
  hide: (id: string, delay?: number) => void
  show: (entry: TooltipEntry, source: "focus" | "pointer") => void
  update: (id: string, content: ReactNode, side: TooltipSide) => void
}

type PendingTooltip = {
  id: string
  timer: ReturnType<typeof setTimeout>
}

type TriggerProps = {
  "aria-describedby"?: string
  onBlur?: (event: ReactFocusEvent<HTMLElement>) => void
  onFocus?: (event: ReactFocusEvent<HTMLElement>) => void
  onPointerEnter?: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerLeave?: (event: ReactPointerEvent<HTMLElement>) => void
  onPointerDownCapture?: (event: ReactPointerEvent<HTMLElement>) => void
}

const TooltipProviderContext = createContext<TooltipController | null>(null)

export function TooltipProvider({
  children,
  delayDuration = 300,
  disableHoverableContent = false,
  skipDelayDuration = 100,
}: {
  children?: ReactNode
  delayDuration?: number
  disableHoverableContent?: boolean
  skipDelayDuration?: number
}) {
  const [active, setActive] = useState<TooltipEntry | null>(null)
  const activeRef = useRef<TooltipEntry | null>(null)
  const pendingRef = useRef<PendingTooltip | null>(null)
  const hideTimerRef = useRef<PendingTooltip | null>(null)
  const lastClosedAtRef = useRef(Number.NEGATIVE_INFINITY)
  const lastPointerDownAtRef = useRef(Number.NEGATIVE_INFINITY)

  const clearPending = useCallback(() => {
    if (!pendingRef.current) return
    clearTimeout(pendingRef.current.timer)
    pendingRef.current = null
  }, [])

  const cancelHide = useCallback(() => {
    if (!hideTimerRef.current) return
    clearTimeout(hideTimerRef.current.timer)
    hideTimerRef.current = null
  }, [])

  const close = useCallback((id: string) => {
    if (activeRef.current?.id !== id) return
    activeRef.current = null
    lastClosedAtRef.current = Date.now()
    setActive(null)
  }, [])

  const hide = useCallback(
    (id: string, delay = 0) => {
      if (pendingRef.current?.id === id) clearPending()
      if (activeRef.current?.id !== id) return
      if (hideTimerRef.current?.id === id) cancelHide()
      if (delay <= 0) {
        close(id)
        return
      }
      hideTimerRef.current = {
        id,
        timer: setTimeout(() => {
          hideTimerRef.current = null
          close(id)
        }, delay),
      }
    },
    [cancelHide, clearPending, close],
  )

  const dismissForPointer = useCallback(() => {
    lastPointerDownAtRef.current = Date.now()
    clearPending()
    cancelHide()
    const activeId = activeRef.current?.id
    if (activeId) close(activeId)
  }, [cancelHide, clearPending, close])

  const show = useCallback(
    (entry: TooltipEntry, source: "focus" | "pointer") => {
      if (Date.now() - lastPointerDownAtRef.current < 500) return
      clearPending()
      cancelHide()

      const hasOpenTooltip = activeRef.current !== null
      const isInsideSkipWindow = Date.now() - lastClosedAtRef.current <= skipDelayDuration
      const delay = source === "focus" || hasOpenTooltip || isInsideSkipWindow ? 0 : delayDuration
      const commit = () => {
        pendingRef.current = null
        activeRef.current = entry
        setActive(entry)
      }

      if (delay <= 0) {
        commit()
        return
      }

      pendingRef.current = {
        id: entry.id,
        timer: setTimeout(commit, delay),
      }
    },
    [cancelHide, clearPending, delayDuration, skipDelayDuration],
  )

  const update = useCallback((id: string, content: ReactNode, side: TooltipSide) => {
    const current = activeRef.current
    if (!current || current.id !== id || (Object.is(current.content, content) && current.side === side)) return
    const next = { ...current, content, side }
    activeRef.current = next
    setActive(next)
  }, [])

  useEffect(
    () => () => {
      clearPending()
      cancelHide()
    },
    [cancelHide, clearPending],
  )

  const controller = useMemo<TooltipController>(
    () => ({ activeId: active?.id ?? null, cancelHide, dismissForPointer, hide, show, update }),
    [active?.id, cancelHide, dismissForPointer, hide, show, update],
  )
  const activeId = active?.id
  const closeActive = useCallback(() => {
    if (activeId) hide(activeId)
  }, [activeId, hide])

  return (
    <TooltipProviderContext.Provider value={controller}>
      {children}
      {active ? (
        <TooltipSurface
          entry={active}
          onClose={closeActive}
          onPointerEnter={disableHoverableContent ? undefined : cancelHide}
          onPointerLeave={disableHoverableContent ? undefined : closeActive}
          pointerEvents={disableHoverableContent ? "none" : "auto"}
        />
      ) : null}
    </TooltipProviderContext.Provider>
  )
}

export function Tooltip({
  children,
  content,
  side = "bottom",
}: {
  children: ReactElement<TriggerProps>
  content: ReactNode
  side?: TooltipSide
}) {
  const controller = useContext(TooltipProviderContext)
  if (controller) {
    return (
      <TooltipTrigger controller={controller} content={content} side={side}>
        {children}
      </TooltipTrigger>
    )
  }
  return (
    <TooltipProvider>
      <TooltipTrigger content={content} side={side}>
        {children}
      </TooltipTrigger>
    </TooltipProvider>
  )
}

function TooltipTrigger({
  children,
  content,
  controller: controllerProp,
  side,
}: {
  children: ReactElement<TriggerProps>
  content: ReactNode
  controller?: TooltipController
  side: TooltipSide
}) {
  const contextController = useContext(TooltipProviderContext)
  const controller = controllerProp ?? contextController
  const id = useId()
  const hide = controller?.hide
  useEffect(
    () => () => {
      hide?.(id)
    },
    [hide, id],
  )
  useEffect(() => {
    if (controller?.activeId === id) controller.update(id, content, side)
  }, [content, controller, id, side])
  if (!controller) return children

  const childProps = children.props

  return cloneElement(children, {
    onBlur: composeEventHandlers(childProps.onBlur, () => controller.hide(id)),
    onFocus: composeEventHandlers(childProps.onFocus, (event) => {
      const descriptionTarget = event.target instanceof HTMLElement ? event.target : event.currentTarget
      controller.show({ anchor: event.currentTarget, content, descriptionTarget, id, side }, "focus")
    }),
    onPointerDownCapture: composeEventHandlers(childProps.onPointerDownCapture, () => {
      controller.dismissForPointer()
    }),
    onPointerEnter: composeEventHandlers(childProps.onPointerEnter, (event) => {
      if (event.pointerType === "touch") return
      controller.show(
        { anchor: event.currentTarget, content, descriptionTarget: event.currentTarget, id, side },
        "pointer",
      )
    }),
    onPointerLeave: composeEventHandlers(childProps.onPointerLeave, () => controller.hide(id, 80)),
  })
}

function TooltipSurface({
  entry,
  onClose,
  onPointerEnter,
  onPointerLeave,
  pointerEvents,
}: {
  entry: TooltipEntry
  onClose: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  pointerEvents: "auto" | "none"
}) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{
    entryId: string
    left: number
    side: TooltipSide
    top: number
  } | null>(null)
  const tooltipId = `tooltip-${entry.id.replaceAll(":", "")}`

  useLayoutEffect(() => {
    const updatePosition = () => {
      const surface = surfaceRef.current
      if (!surface || !entry.anchor.isConnected) {
        onClose()
        return
      }
      const next = calculatePosition(entry.anchor.getBoundingClientRect(), surface.getBoundingClientRect(), entry.side)
      setPosition((current) => {
        if (
          current?.entryId === entry.id &&
          current.left === next.left &&
          current.side === next.side &&
          current.top === next.top
        ) {
          return current
        }
        return { entryId: entry.id, ...next }
      })
    }

    updatePosition()
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [entry, onClose])

  useEffect(() => {
    const target = entry.descriptionTarget
    const describedBy = new Set(target.getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean) ?? [])
    describedBy.add(tooltipId)
    target.setAttribute("aria-describedby", [...describedBy].join(" "))
    return () => {
      const current = new Set(target.getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean) ?? [])
      current.delete(tooltipId)
      if (current.size > 0) target.setAttribute("aria-describedby", [...current].join(" "))
      else target.removeAttribute("aria-describedby")
    }
  }, [entry.descriptionTarget, tooltipId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  const isPositioned = position?.entryId === entry.id
  return createPortal(
    <div
      ref={surfaceRef}
      id={tooltipId}
      role="tooltip"
      data-side={isPositioned ? position.side : entry.side}
      className="z-[100] w-max max-w-64 select-none rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-lg [&_[data-slot=shortcut]]:text-background/70"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        left: isPositioned ? position.left : 0,
        pointerEvents,
        position: "fixed",
        top: isPositioned ? position.top : 0,
        visibility: isPositioned ? "visible" : "hidden",
      }}
    >
      {entry.content}
    </div>,
    document.body,
  )
}

function calculatePosition(anchor: DOMRect, surface: DOMRect, side: TooltipSide) {
  const gap = 8
  const padding = 8
  const opposite: Record<TooltipSide, TooltipSide> = {
    bottom: "top",
    left: "right",
    right: "left",
    top: "bottom",
  }
  const available: Record<TooltipSide, number> = {
    bottom: window.innerHeight - anchor.bottom - gap - padding,
    left: anchor.left - gap - padding,
    right: window.innerWidth - anchor.right - gap - padding,
    top: anchor.top - gap - padding,
  }
  const required = side === "left" || side === "right" ? surface.width : surface.height
  const fallbackSide = opposite[side]
  const resolvedSide = available[side] < required && available[fallbackSide] > available[side] ? fallbackSide : side
  let left = anchor.left + (anchor.width - surface.width) / 2
  let top = anchor.top + (anchor.height - surface.height) / 2

  if (resolvedSide === "top") top = anchor.top - surface.height - gap
  if (resolvedSide === "bottom") top = anchor.bottom + gap
  if (resolvedSide === "left") left = anchor.left - surface.width - gap
  if (resolvedSide === "right") left = anchor.right + gap

  const maxLeft = Math.max(padding, window.innerWidth - surface.width - padding)
  const maxTop = Math.max(padding, window.innerHeight - surface.height - padding)
  return {
    left: Math.round(Math.min(Math.max(left, padding), maxLeft)),
    side: resolvedSide,
    top: Math.round(Math.min(Math.max(top, padding), maxTop)),
  }
}

function composeEventHandlers<Event extends { defaultPrevented: boolean }>(
  original: ((event: Event) => void) | undefined,
  next: (event: Event) => void,
) {
  return (event: Event) => {
    original?.(event)
    if (!event.defaultPrevented) next(event)
  }
}

export function Shortcut({ className, ...props }: ComponentProps<"kbd">) {
  return <kbd data-slot="shortcut" className={cn("ml-auto text-[11px] text-muted-foreground", className)} {...props} />
}
