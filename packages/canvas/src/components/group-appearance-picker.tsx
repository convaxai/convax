import { cn, FolderGlyph } from "@convax/ui"
import {
  type CSSProperties,
  type KeyboardEvent,
  type MutableRefObject,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import {
  canvasGroupColorOptions,
  canvasGroupEmojiOptions,
  getCanvasGroupEmoji,
  getCanvasGroupColorValue,
  type CanvasGroupAppearance,
} from "../group-appearance"
import { useCanvasOverlayRoot } from "../editor-context"

const emojiColumnCount = 7
const colorColumnCount = 5

function moveGridIndex(current: number, key: string, itemCount: number, columnCount: number) {
  if (itemCount <= 0) return -1
  const index = current >= 0 && current < itemCount ? current : 0
  if (key === "ArrowLeft") return (index - 1 + itemCount) % itemCount
  if (key === "ArrowRight") return (index + 1) % itemCount
  if (key === "Home") return 0
  if (key === "End") return itemCount - 1
  if (key !== "ArrowUp" && key !== "ArrowDown") return index

  const column = index % columnCount
  const columnIndices: number[] = []
  for (let candidate = column; candidate < itemCount; candidate += columnCount) columnIndices.push(candidate)
  const position = columnIndices.indexOf(index)
  const delta = key === "ArrowDown" ? 1 : -1
  return columnIndices[(position + delta + columnIndices.length) % columnIndices.length] ?? index
}

export function moveCanvasGroupEmojiIndex(current: number, key: string) {
  return moveGridIndex(current, key, canvasGroupEmojiOptions.length, emojiColumnCount)
}

export function CanvasGroupAppearancePicker(props: {
  anchor: HTMLElement | null
  appearance: CanvasGroupAppearance
  onChange: (appearance: CanvasGroupAppearance) => void
  onClose: () => void
}) {
  const overlayRoot = useCanvasOverlayRoot()
  const panelRef = useRef<HTMLDivElement>(null)
  const colorRefs = useRef<(HTMLButtonElement | null)[]>([])
  const emojiRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [position, setPosition] = useState<CSSProperties>()
  const selectedEmojiIndex = Math.max(
    0,
    canvasGroupEmojiOptions.findIndex((option) => option.id === props.appearance.emoji),
  )
  const close = (restoreFocus: boolean) => {
    if (restoreFocus) props.anchor?.focus({ preventScroll: true })
    props.onClose()
  }

  useLayoutEffect(() => {
    const panel = panelRef.current
    const root = overlayRoot
    const anchor = props.anchor
    if (!panel || !root || !anchor) return
    const updatePosition = () => {
      const anchorRect = anchor.getBoundingClientRect()
      const rootRect = root.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const safeInset = 12
      const gap = 10
      const panelWidth = panelRect.width || 328
      const panelHeight = panelRect.height || 394
      const preferredLeft = anchorRect.left - rootRect.left + anchorRect.width / 2 - panelWidth / 2
      const maximumLeft = Math.max(safeInset, rootRect.width - panelWidth - safeInset)
      const left = Math.min(Math.max(safeInset, preferredLeft), maximumLeft)
      const below = anchorRect.bottom - rootRect.top + gap
      const above = anchorRect.top - rootRect.top - panelHeight - gap
      const maximumTop = Math.max(safeInset, rootRect.height - panelHeight - safeInset)
      const top = Math.min(
        Math.max(safeInset, below + panelHeight <= rootRect.height - safeInset ? below : above),
        maximumTop,
      )
      setPosition({ left, top })
    }
    updatePosition()
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [overlayRoot, props.anchor])

  useLayoutEffect(() => {
    emojiRefs.current[selectedEmojiIndex]?.focus({ preventScroll: true })
  }, [selectedEmojiIndex])

  useEffect(() => {
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) || props.anchor?.contains(target)) return
      close(false)
    }
    window.addEventListener("pointerdown", closeOnOutsidePointer, true)
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointer, true)
  }, [props.anchor, props.onClose])

  const moveFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: number,
    refs: MutableRefObject<(HTMLButtonElement | null)[]>,
    itemCount: number,
    columnCount: number,
  ) => {
    if (!["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home"].includes(event.key)) return
    event.preventDefault()
    refs.current[moveGridIndex(current, event.key, itemCount, columnCount)]?.focus()
  }

  const layer = (
    <div
      aria-label="Group appearance"
      className="convax-group-appearance-picker nodrag nowheel"
      data-canvas-group-appearance-picker
      data-canvas-shortcuts="ignore"
      data-positioned={String(Boolean(position) || !props.anchor)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key !== "Escape") return
        event.preventDefault()
        close(true)
      }}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => event.stopPropagation()}
      ref={panelRef}
      role="dialog"
      style={position}
    >
      <div className="convax-group-appearance-picker__header">
        <span className="convax-group-appearance-picker__preview" aria-hidden="true">
          {getCanvasGroupEmoji(props.appearance.emoji)}
        </span>
        <div>
          <div className="convax-group-appearance-picker__title">Folder appearance</div>
          <div className="convax-group-appearance-picker__subtitle">Choose a color and an emoji</div>
        </div>
      </div>
      <div aria-label="Folder color" className="convax-group-appearance-picker__section" role="group">
        <div className="convax-group-appearance-picker__section-label">Color</div>
        <div className="convax-group-appearance-picker__colors">
          {canvasGroupColorOptions.map((option, index) => (
            <button
              aria-label={option.label}
              aria-pressed={props.appearance.color === option.id}
              className={cn(
                "convax-group-appearance-picker__color",
                props.appearance.color === option.id && "is-selected",
              )}
              data-canvas-group-color={option.id}
              key={option.id}
              onClick={() => props.onChange({ ...props.appearance, color: option.id })}
              onKeyDown={(event) =>
                moveFocus(event, index, colorRefs, canvasGroupColorOptions.length, colorColumnCount)
              }
              ref={(element) => {
                colorRefs.current[index] = element
              }}
              title={option.label}
              type="button"
            >
              <FolderGlyph color={getCanvasGroupColorValue(option.id)} />
            </button>
          ))}
        </div>
      </div>
      <div aria-label="Folder emoji" className="convax-group-appearance-picker__section" role="group">
        <div className="convax-group-appearance-picker__section-label">Emoji</div>
        <div className="convax-group-appearance-picker__emojis">
          {canvasGroupEmojiOptions.map((option, index) => (
            <button
              aria-label={option.label}
              aria-pressed={props.appearance.emoji === option.id}
              className={cn(
                "convax-group-appearance-picker__emoji",
                props.appearance.emoji === option.id && "is-selected",
              )}
              key={option.id}
              onClick={() => {
                props.onChange({ ...props.appearance, emoji: option.id })
                close(true)
              }}
              onKeyDown={(event) => {
                if (!["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home"].includes(event.key)) return
                event.preventDefault()
                emojiRefs.current[moveCanvasGroupEmojiIndex(index, event.key)]?.focus()
              }}
              ref={(element) => {
                emojiRefs.current[index] = element
              }}
              title={option.label}
              type="button"
            >
              <span aria-hidden="true">{option.emoji}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
  return overlayRoot ? createPortal(layer, overlayRoot) : layer
}
