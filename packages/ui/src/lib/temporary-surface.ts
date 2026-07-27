import { useLayoutEffect, useRef, type RefObject } from "react"

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",")

const surfaceStack: symbol[] = []
let bodyLockCount = 0
let previousBodyOverflow = ""

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => element.getAttribute("aria-hidden") !== "true" && !element.hidden,
  )
}

function focusFirst(container: HTMLElement, initialFocus: HTMLElement | null) {
  if (initialFocus && container.contains(initialFocus)) {
    initialFocus.focus()
    return
  }
  const first = focusableElements(container)[0]
  ;(first ?? container).focus()
}

function lockBody() {
  if (bodyLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
  }
  bodyLockCount += 1
}

function unlockBody() {
  bodyLockCount = Math.max(0, bodyLockCount - 1)
  if (bodyLockCount === 0) document.body.style.overflow = previousBodyOverflow
}

export function useTemporarySurfaceFocus({
  containerRef,
  dismissOnEscape,
  initialFocusRef,
  onDismiss,
  open,
  restoreFocus = true,
}: {
  containerRef: RefObject<HTMLElement | null>
  dismissOnEscape: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  onDismiss: () => void
  open: boolean
  restoreFocus?: boolean
}) {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useLayoutEffect(() => {
    if (!open || typeof document === "undefined") return undefined
    const container = containerRef.current
    if (!container) return undefined

    const surface = Symbol("temporary-surface")
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    surfaceStack.push(surface)
    lockBody()

    const isTopSurface = () => surfaceStack.at(-1) === surface
    const focusSurface = () => focusFirst(container, initialFocusRef?.current ?? null)
    queueMicrotask(focusSurface)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopSurface()) return
      if (event.key === "Escape" && dismissOnEscape) {
        event.preventDefault()
        event.stopPropagation()
        dismissRef.current()
        return
      }
      if (event.key !== "Tab") return

      const focusable = focusableElements(container)
      if (focusable.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }

      const first = focusable[0]!
      const last = focusable.at(-1)!
      const active = document.activeElement
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    const containFocus = (event: FocusEvent) => {
      if (!isTopSurface() || container.contains(event.target as Node)) return
      focusSurface()
    }

    document.addEventListener("keydown", handleKeyDown, true)
    document.addEventListener("focusin", containFocus, true)

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true)
      document.removeEventListener("focusin", containFocus, true)
      const index = surfaceStack.lastIndexOf(surface)
      if (index >= 0) surfaceStack.splice(index, 1)
      unlockBody()
      if (restoreFocus && previouslyFocused?.isConnected) queueMicrotask(() => previouslyFocused.focus())
    }
  }, [containerRef, dismissOnEscape, initialFocusRef, open, restoreFocus])
}
