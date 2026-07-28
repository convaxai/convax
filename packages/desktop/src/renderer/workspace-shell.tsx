import { useCallback, useLayoutEffect, useRef, type ReactNode, type Ref } from "react"
import { HostPointerReleaseGate } from "./host-pointer-gesture"

export const hostPointerGestureAttribute = "data-host-pointer-gesture" as const
export const hostPointerGestureRootAttribute = "data-host-pointer-gesture-root" as const

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value)
  else if (ref) ref.current = value
}

export function WorkspaceShell({
  blocked,
  children,
  resizing = false,
  statusBar,
  utilityMode = "closed",
  workspaceRef,
}: {
  blocked: boolean
  children: ReactNode
  resizing?: boolean
  statusBar?: ReactNode
  utilityMode?: "agent" | "closed" | "generate" | "inspector"
  workspaceRef?: Ref<HTMLElement>
}) {
  const rootRef = useRef<HTMLElement>(null)
  const pointerGateRef = useRef(new HostPointerReleaseGate())
  const releaseFrameRef = useRef<number | null>(null)
  const blurringEmbeddedFrameRef = useRef(false)
  const setRootRef = useCallback(
    (element: HTMLElement | null) => {
      rootRef.current = element
      assignRef(workspaceRef, element)
    },
    [workspaceRef],
  )

  const finishHostPointerGesture = useCallback(() => {
    const scheduledFrame = releaseFrameRef.current
    if (scheduledFrame !== null) window.cancelAnimationFrame(scheduledFrame)
    releaseFrameRef.current = window.requestAnimationFrame(() => {
      releaseFrameRef.current = null
      if (!pointerGateRef.current.complete()) return
      rootRef.current?.removeAttribute(hostPointerGestureAttribute)
    })
  }, [])

  const beginHostPointerGesture = useCallback((event: PointerEvent) => {
    const root = rootRef.current
    if (!root || !pointerGateRef.current.begin(event.pointerId)) return
    const scheduledFrame = releaseFrameRef.current
    if (scheduledFrame !== null) window.cancelAnimationFrame(scheduledFrame)
    releaseFrameRef.current = null
    root.setAttribute(hostPointerGestureAttribute, "")
    const activeElement = root.ownerDocument.activeElement
    if (
      activeElement instanceof HTMLIFrameElement &&
      root.contains(activeElement) &&
      activeElement.hasAttribute("data-web-plugin-iframe")
    ) {
      blurringEmbeddedFrameRef.current = true
      try {
        activeElement.blur()
      } finally {
        blurringEmbeddedFrameRef.current = false
      }
    }
  }, [])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return () => undefined
    const releasePointer = (event: PointerEvent) => {
      if (!pointerGateRef.current.release(event.pointerId)) return
      finishHostPointerGesture()
    }
    const releaseAllPointers = () => {
      if (blurringEmbeddedFrameRef.current) return
      if (!pointerGateRef.current.releaseAll()) return
      finishHostPointerGesture()
    }
    root.addEventListener("pointerdown", beginHostPointerGesture, true)
    window.addEventListener("pointerup", releasePointer, true)
    window.addEventListener("pointercancel", releasePointer, true)
    window.addEventListener("blur", releaseAllPointers, true)
    return () => {
      root.removeEventListener("pointerdown", beginHostPointerGesture, true)
      window.removeEventListener("pointerup", releasePointer, true)
      window.removeEventListener("pointercancel", releasePointer, true)
      window.removeEventListener("blur", releaseAllPointers, true)
      const frame = releaseFrameRef.current
      if (frame !== null) window.cancelAnimationFrame(frame)
      releaseFrameRef.current = null
      pointerGateRef.current.releaseAll()
      pointerGateRef.current.complete()
      root.removeAttribute(hostPointerGestureAttribute)
    }
  }, [beginHostPointerGesture, finishHostPointerGesture])

  return (
    <main
      aria-hidden={blocked || undefined}
      className={`relative flex size-full flex-col overflow-hidden bg-background${resizing ? " cursor-col-resize select-none" : ""}`}
      data-host-pointer-gesture-root="true"
      data-workbench-resizing={resizing ? "" : undefined}
      data-workspace-utility-mode={utilityMode}
      data-workspace-shell="true"
      inert={blocked || undefined}
      ref={setRootRef}
    >
      <div className="relative flex min-h-0 flex-1 overflow-hidden">{children}</div>
      {statusBar}
    </main>
  )
}
