import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import {
  adaptMediaCropRectToBounds,
  clampMediaCropRect,
  moveMediaCropRect,
  normalizeMediaCropBounds,
  resizeMediaCropRect,
  type MediaCropRect,
  type MediaCropResizeHandle,
} from "./media-crop-editor-model"

interface MediaCropEditorCopy {
  adjust: string
  dimensions: string
  previewUnavailable: string
  selection: string
}

export interface MediaCropEditorProps {
  copy: MediaCropEditorCopy
  disabled: boolean
  label: string
  onChange: (rect: MediaCropRect) => void
  onSourceDimensionsChange: (bounds: { height: number; width: number }) => void
  sourceHeight: number
  sourceUrl: string
  sourceWidth: number
  value: MediaCropRect
}

interface CropDragSession {
  clientX: number
  clientY: number
  handle: MediaCropResizeHandle | "move"
  pointerId: number
  rect: MediaCropRect
}

const handles: readonly {
  className: string
  cursor: string
  handle: MediaCropResizeHandle
}[] = [
  { className: "-left-1.5 -top-1.5", cursor: "cursor-nwse-resize", handle: "nw" },
  { className: "left-1/2 -top-1.5 -translate-x-1/2", cursor: "cursor-ns-resize", handle: "n" },
  { className: "-right-1.5 -top-1.5", cursor: "cursor-nesw-resize", handle: "ne" },
  { className: "top-1/2 -right-1.5 -translate-y-1/2", cursor: "cursor-ew-resize", handle: "e" },
  { className: "-right-1.5 -bottom-1.5", cursor: "cursor-nwse-resize", handle: "se" },
  { className: "left-1/2 -bottom-1.5 -translate-x-1/2", cursor: "cursor-ns-resize", handle: "s" },
  { className: "-left-1.5 -bottom-1.5", cursor: "cursor-nesw-resize", handle: "sw" },
  { className: "top-1/2 -left-1.5 -translate-y-1/2", cursor: "cursor-ew-resize", handle: "w" },
]

export function MediaCropEditor(props: MediaCropEditorProps) {
  const hintedBounds = normalizeMediaCropBounds(props.sourceWidth, props.sourceHeight)
  const [bounds, setBounds] = useState(hintedBounds)
  const value = clampMediaCropRect(props.value, bounds)
  const editorRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<CropDragSession | undefined>(undefined)
  const [previewUnavailable, setPreviewUnavailable] = useState(false)

  useEffect(() => {
    setPreviewUnavailable(false)
    setBounds(hintedBounds)
    props.onSourceDimensionsChange(hintedBounds)
  }, [props.sourceUrl])

  useEffect(() => {
    if (
      value.x !== props.value.x ||
      value.y !== props.value.y ||
      value.width !== props.value.width ||
      value.height !== props.value.height
    ) {
      props.onChange(value)
    }
  }, [props.onChange, props.value.height, props.value.width, props.value.x, props.value.y, value])

  const resolveSourceDimensions = (video: HTMLVideoElement) => {
    if (video.videoWidth < 2 || video.videoHeight < 2) return
    const actualBounds = normalizeMediaCropBounds(video.videoWidth, video.videoHeight)
    const nextValue = adaptMediaCropRectToBounds(props.value, bounds, actualBounds)
    setBounds(actualBounds)
    props.onSourceDimensionsChange(actualBounds)
    props.onChange(nextValue)
  }

  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (props.disabled || event.button !== 0) return
    const handleElement =
      event.target instanceof Element ? event.target.closest<HTMLElement>("[data-crop-handle]") : null
    const requestedHandle = handleElement?.dataset.cropHandle
    const handle = isCropResizeHandle(requestedHandle) ? requestedHandle : "move"
    dragRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      handle,
      pointerId: event.pointerId,
      rect: value,
    }
    editorRef.current?.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const session = dragRef.current
    const editor = editorRef.current
    if (!session || session.pointerId !== event.pointerId || !editor) return
    const clientBounds = editor.getBoundingClientRect()
    if (clientBounds.width <= 0 || clientBounds.height <= 0) return
    const deltaX = ((event.clientX - session.clientX) / clientBounds.width) * bounds.width
    const deltaY = ((event.clientY - session.clientY) / clientBounds.height) * bounds.height
    props.onChange(
      session.handle === "move"
        ? moveMediaCropRect(session.rect, bounds, deltaX, deltaY)
        : resizeMediaCropRect(session.rect, bounds, session.handle, deltaX, deltaY),
    )
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = undefined
    if (editorRef.current?.hasPointerCapture(event.pointerId)) editorRef.current.releasePointerCapture(event.pointerId)
  }

  const moveWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (props.disabled) return
    const delta = keyboardDelta(event)
    if (!delta) return
    event.preventDefault()
    props.onChange(moveMediaCropRect(value, bounds, delta.x, delta.y))
  }

  return (
    <div className="min-w-0" data-testid="media-crop-editor">
      <div
        className="relative mx-auto max-h-[56vh] w-full overflow-hidden rounded-2xl border border-border bg-black shadow-inner"
        onLostPointerCapture={() => {
          dragRef.current = undefined
        }}
        onPointerCancel={endDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        ref={editorRef}
        style={{ aspectRatio: `${bounds.width} / ${bounds.height}` }}
      >
        <video
          aria-label={props.label}
          autoPlay
          className="pointer-events-none size-full object-cover"
          draggable={false}
          loop
          muted
          onError={() => setPreviewUnavailable(true)}
          onLoadedMetadata={(event) => resolveSourceDimensions(event.currentTarget)}
          playsInline
          preload="auto"
          src={props.sourceUrl}
        />
        {previewUnavailable ? (
          <div className="absolute inset-0 grid place-items-center bg-muted/25 px-6 text-center text-xs text-white/75">
            {props.copy.previewUnavailable}
          </div>
        ) : null}

        <div
          aria-label={props.copy.selection}
          className="absolute cursor-move touch-none border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.58),0_0_0_1px_rgba(0,0,0,0.45),0_2px_18px_rgba(0,0,0,0.35)] outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          onKeyDown={moveWithKeyboard}
          onPointerDown={beginDrag}
          role="group"
          style={{
            height: `${(value.height / bounds.height) * 100}%`,
            left: `${(value.x / bounds.width) * 100}%`,
            top: `${(value.y / bounds.height) * 100}%`,
            width: `${(value.width / bounds.width) * 100}%`,
          }}
          tabIndex={props.disabled ? -1 : 0}
        >
          <span className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/45" />
          <span className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/45" />
          <span className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/45" />
          <span className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/45" />
          {handles.map(({ className, cursor, handle }) => (
            <button
              aria-label={`${props.copy.adjust} ${handle}`}
              className={`absolute size-3 rounded-[3px] border border-black/35 bg-white shadow-sm ${className} ${cursor}`}
              data-crop-handle={handle}
              disabled={props.disabled}
              key={handle}
              onKeyDown={(event) => resizeWithKeyboard(event, handle, value, bounds, props.onChange)}
              type="button"
            />
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <span>{props.copy.adjust}</span>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 font-medium tabular-nums text-foreground">
          {props.copy.dimensions}: {value.width} × {value.height}
        </span>
      </div>
    </div>
  )
}

function resizeWithKeyboard(
  event: KeyboardEvent<HTMLButtonElement>,
  handle: MediaCropResizeHandle,
  value: MediaCropRect,
  bounds: { height: number; width: number },
  onChange: (rect: MediaCropRect) => void,
) {
  const delta = keyboardDelta(event)
  if (!delta) return
  event.preventDefault()
  event.stopPropagation()
  onChange(resizeMediaCropRect(value, bounds, handle, delta.x, delta.y))
}

function keyboardDelta(event: KeyboardEvent<HTMLElement>) {
  const distance = event.shiftKey ? 20 : 2
  if (event.key === "ArrowLeft") return { x: -distance, y: 0 }
  if (event.key === "ArrowRight") return { x: distance, y: 0 }
  if (event.key === "ArrowUp") return { x: 0, y: -distance }
  if (event.key === "ArrowDown") return { x: 0, y: distance }
  return undefined
}

function isCropResizeHandle(value: string | undefined): value is MediaCropResizeHandle {
  return handles.some((candidate) => candidate.handle === value)
}
