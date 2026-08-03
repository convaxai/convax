import { X } from "lucide-react"
import { useId, useLayoutEffect, useRef } from "react"
import { createPortal } from "react-dom"

export interface CanvasMediaViewerProps {
  height?: number
  kind: "image" | "video"
  label: string
  onOpenChange: (open: boolean) => void
  open: boolean
  posterUrl?: string
  url: string
  width?: number
}

export function CanvasMediaViewer({
  height,
  kind,
  label,
  onOpenChange,
  open,
  posterUrl,
  url,
  width,
}: CanvasMediaViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useLayoutEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.open) dialog.showModal()
    closeButtonRef.current?.focus({ preventScroll: true })
    return () => {
      if (dialog.open) dialog.close()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null
  const viewer = (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 m-0 size-full max-h-none max-w-none overflow-hidden bg-transparent p-4 text-white backdrop:bg-black/75"
      data-canvas-media-viewer-dialog=""
      onCancel={(event) => {
        event.preventDefault()
        onOpenChange(false)
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false)
      }}
      ref={dialogRef}
      role="dialog"
    >
      <div className="relative flex size-full items-center justify-center overflow-hidden rounded-xl bg-black shadow-2xl">
        <h2 className="sr-only" id={titleId}>
          {label}
        </h2>
        <p className="sr-only" id={descriptionId}>
          Full-screen {kind} viewer. Press Escape or use the close button to return to the Canvas.
        </p>
        <div
          className="relative flex size-full items-center justify-center overflow-hidden bg-black"
          data-canvas-media-viewer={kind}
        >
          {kind === "image" ? (
            <img
              alt={label}
              className="max-h-full max-w-full object-contain"
              decoding="async"
              draggable={false}
              height={height}
              src={url}
              width={width}
            />
          ) : (
            <video
              aria-label={label}
              className="size-full object-contain"
              controls
              playsInline
              poster={posterUrl}
              preload="metadata"
              src={url}
            />
          )}
          <button
            aria-label="Close full-screen viewer"
            className="absolute right-4 top-4 grid size-10 place-items-center rounded-lg bg-white/10 text-white/80 outline-none transition-[background-color,color,transform] duration-100 [@media(hover:hover)]:hover:bg-white/15 [@media(hover:hover)]:hover:text-white active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none"
            onClick={() => onOpenChange(false)}
            ref={closeButtonRef}
            type="button"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
      </div>
    </dialog>
  )
  return typeof document === "undefined" ? viewer : createPortal(viewer, document.body)
}
