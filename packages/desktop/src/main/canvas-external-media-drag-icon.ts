import type { NativeImage } from "electron"

import type {
  CanvasExternalMediaDragIcon,
  CanvasExternalMediaDragIconRequest,
} from "./canvas-external-media-drag-service"

const dragPreviewSize = 64
const badgeMargin = 3
const badgeHeight = 17
const badgePaddingX = 5
const glyphScale = 2
const glyphGap = 1

const digitGlyphs: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
}

export interface CanvasExternalMediaDragIconAdapter {
  createFromBitmap(buffer: Buffer, options: { height: number; scaleFactor?: number; width: number }): NativeImage
  createFromPath(path: string): NativeImage
  createThumbnailFromPath(path: string, size: { height: number; width: number }): Promise<NativeImage>
}

/**
 * Builds the already-prepared native drag image before DOM `dragstart` fires.
 * Images use their pixels immediately; video and audio ask the OS thumbnailer.
 * Associated-application icons are intentionally excluded because they do not
 * represent the selected material.
 */
export function createCanvasExternalMediaDragIconFactory(input: { adapter: CanvasExternalMediaDragIconAdapter }) {
  return async (request: CanvasExternalMediaDragIconRequest): Promise<CanvasExternalMediaDragIcon> => {
    throwIfAborted(request.signal)
    let preview = input.adapter.createFromPath(request.file)
    if (preview.isEmpty()) {
      preview = await resolveSystemPreview(input.adapter, request.file, request.signal)
    }
    throwIfAborted(request.signal)
    if (preview.isEmpty()) return createNeutralFilePreview(input.adapter, request.itemCount)
    return composeMaterialPreview(input.adapter, preview, request.itemCount)
  }
}

async function resolveSystemPreview(adapter: CanvasExternalMediaDragIconAdapter, file: string, signal?: AbortSignal) {
  try {
    const thumbnail = await waitForAbortable(
      adapter.createThumbnailFromPath(file, { height: dragPreviewSize, width: dragPreviewSize }),
      signal,
    )
    if (!thumbnail.isEmpty()) return thumbnail
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error
  }
  return adapter.createFromPath("")
}

function composeMaterialPreview(adapter: CanvasExternalMediaDragIconAdapter, source: NativeImage, itemCount: number) {
  const sourceSize = source.getSize(1)
  if (sourceSize.width <= 0 || sourceSize.height <= 0) return source
  const scale = Math.min(dragPreviewSize / sourceSize.width, dragPreviewSize / sourceSize.height)
  const width = Math.max(1, Math.round(sourceSize.width * scale))
  const height = Math.max(1, Math.round(sourceSize.height * scale))
  const resized = source.resize({ height, quality: "better", width })
  const actual = resized.getSize(1)
  const bitmap = resized.toBitmap({ scaleFactor: 1 })
  if (actual.width <= 0 || actual.height <= 0 || bitmap.length !== actual.width * actual.height * 4) {
    return resized
  }

  const composed = Buffer.alloc(dragPreviewSize * dragPreviewSize * 4)
  const offsetX = Math.floor((dragPreviewSize - actual.width) / 2)
  const offsetY = Math.floor((dragPreviewSize - actual.height) / 2)
  for (let row = 0; row < actual.height; row += 1) {
    const sourceOffset = row * actual.width * 4
    const destinationOffset = ((offsetY + row) * dragPreviewSize + offsetX) * 4
    bitmap.copy(composed, destinationOffset, sourceOffset, sourceOffset + actual.width * 4)
  }
  if (itemCount > 1) paintCountBadge(composed, dragPreviewSize, dragPreviewSize, itemCount)
  const icon = adapter.createFromBitmap(composed, {
    height: dragPreviewSize,
    scaleFactor: 1,
    width: dragPreviewSize,
  })
  return icon.isEmpty() ? resized : icon
}

function createNeutralFilePreview(adapter: CanvasExternalMediaDragIconAdapter, itemCount: number) {
  const bitmap = Buffer.alloc(dragPreviewSize * dragPreviewSize * 4)
  const left = 16
  const top = 7
  const right = 48
  const bottom = 57
  const fold = 10

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const inFoldCutout = y < top + fold && x >= right - fold && x - (right - fold) > y - top
      if (inFoldCutout) continue
      const border = x === left || x === right - 1 || y === top || y === bottom - 1
      setBgra(bitmap, dragPreviewSize, x, y, border ? 145 : 245, border ? 145 : 245, border ? 145 : 245, 255)
    }
  }
  for (let offset = 0; offset < fold; offset += 1) {
    setBgra(bitmap, dragPreviewSize, right - fold + offset, top + offset, 145, 145, 145, 255)
  }
  if (itemCount > 1) paintCountBadge(bitmap, dragPreviewSize, dragPreviewSize, itemCount)
  return adapter.createFromBitmap(bitmap, {
    height: dragPreviewSize,
    scaleFactor: 1,
    width: dragPreviewSize,
  })
}

function paintCountBadge(bitmap: Buffer, width: number, height: number, itemCount: number) {
  const label = String(Math.max(2, Math.min(100, itemCount)))
  const glyphWidth = 3 * glyphScale
  const textWidth = label.length * glyphWidth + (label.length - 1) * glyphGap
  const badgeWidth = textWidth + badgePaddingX * 2
  const left = width - badgeMargin - badgeWidth
  const top = height - badgeMargin - badgeHeight
  const radius = badgeHeight / 2
  for (let y = top; y < top + badgeHeight; y += 1) {
    for (let x = left; x < left + badgeWidth; x += 1) {
      const centerX = x < left + radius ? left + radius : left + badgeWidth - radius
      const centerY = top + radius
      const inMiddle = x >= left + radius && x < left + badgeWidth - radius
      if (inMiddle || (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) {
        setBgra(bitmap, width, x, y, 73, 54, 220, 255)
      }
    }
  }

  let glyphLeft = left + badgePaddingX
  const glyphTop = top + Math.floor((badgeHeight - 5 * glyphScale) / 2)
  for (const character of label) {
    const glyph = digitGlyphs[character]
    if (!glyph) continue
    for (const [row, pixels] of glyph.entries()) {
      for (const [column, pixel] of [...pixels].entries()) {
        if (pixel !== "1") continue
        for (let dy = 0; dy < glyphScale; dy += 1) {
          for (let dx = 0; dx < glyphScale; dx += 1) {
            setBgra(
              bitmap,
              width,
              glyphLeft + column * glyphScale + dx,
              glyphTop + row * glyphScale + dy,
              255,
              255,
              255,
              255,
            )
          }
        }
      }
    }
    glyphLeft += glyphWidth + glyphGap
  }
}

function setBgra(
  bitmap: Buffer,
  width: number,
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number,
  alpha: number,
) {
  const offset = (y * width + x) * 4
  bitmap[offset] = blue
  bitmap[offset + 1] = green
  bitmap[offset + 2] = red
  bitmap[offset + 3] = alpha
}

function waitForAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Canceled", "AbortError"))
    signal.addEventListener("abort", abort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Canceled", "AbortError")
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}
