export interface MediaCropBounds {
  height: number
  width: number
}

export interface MediaCropRect extends MediaCropBounds {
  x: number
  y: number
}

export type MediaCropResizeHandle = "e" | "n" | "ne" | "nw" | "s" | "se" | "sw" | "w"

const cropGridSize = 2

export function normalizeMediaCropBounds(width: number, height: number): MediaCropBounds {
  return {
    height: evenFloor(Math.max(cropGridSize, finiteOr(height, cropGridSize))),
    width: evenFloor(Math.max(cropGridSize, finiteOr(width, cropGridSize))),
  }
}

export function createFullFrameMediaCropRect(bounds: MediaCropBounds): MediaCropRect {
  const normalized = normalizeMediaCropBounds(bounds.width, bounds.height)
  return { ...normalized, x: 0, y: 0 }
}

export function clampMediaCropRect(rect: MediaCropRect, bounds: MediaCropBounds): MediaCropRect {
  const normalizedBounds = normalizeMediaCropBounds(bounds.width, bounds.height)
  const x = clamp(evenRound(rect.x), 0, normalizedBounds.width - cropGridSize)
  const y = clamp(evenRound(rect.y), 0, normalizedBounds.height - cropGridSize)
  return {
    height: clamp(evenRound(rect.height), cropGridSize, normalizedBounds.height - y),
    width: clamp(evenRound(rect.width), cropGridSize, normalizedBounds.width - x),
    x,
    y,
  }
}

export function adaptMediaCropRectToBounds(
  rect: MediaCropRect,
  previousBounds: MediaCropBounds,
  nextBounds: MediaCropBounds,
): MediaCropRect {
  const previous = normalizeMediaCropBounds(previousBounds.width, previousBounds.height)
  const next = normalizeMediaCropBounds(nextBounds.width, nextBounds.height)
  const current = clampMediaCropRect(rect, previous)
  if (isFullFrame(current, previous)) return createFullFrameMediaCropRect(next)
  return clampMediaCropRect(
    {
      height: (current.height / previous.height) * next.height,
      width: (current.width / previous.width) * next.width,
      x: (current.x / previous.width) * next.width,
      y: (current.y / previous.height) * next.height,
    },
    next,
  )
}

export function moveMediaCropRect(
  rect: MediaCropRect,
  bounds: MediaCropBounds,
  deltaX: number,
  deltaY: number,
): MediaCropRect {
  const normalizedBounds = normalizeMediaCropBounds(bounds.width, bounds.height)
  const current = clampMediaCropRect(rect, normalizedBounds)
  return {
    ...current,
    x: clamp(current.x + evenRound(deltaX), 0, normalizedBounds.width - current.width),
    y: clamp(current.y + evenRound(deltaY), 0, normalizedBounds.height - current.height),
  }
}

export function resizeMediaCropRect(
  rect: MediaCropRect,
  bounds: MediaCropBounds,
  handle: MediaCropResizeHandle,
  deltaX: number,
  deltaY: number,
): MediaCropRect {
  const normalizedBounds = normalizeMediaCropBounds(bounds.width, bounds.height)
  const current = clampMediaCropRect(rect, normalizedBounds)
  let left = current.x
  let right = current.x + current.width
  let top = current.y
  let bottom = current.y + current.height
  const horizontalDelta = evenRound(deltaX)
  const verticalDelta = evenRound(deltaY)

  if (handle.includes("w")) left = clamp(left + horizontalDelta, 0, right - cropGridSize)
  if (handle.includes("e")) right = clamp(right + horizontalDelta, left + cropGridSize, normalizedBounds.width)
  if (handle.includes("n")) top = clamp(top + verticalDelta, 0, bottom - cropGridSize)
  if (handle.includes("s")) bottom = clamp(bottom + verticalDelta, top + cropGridSize, normalizedBounds.height)

  return {
    height: bottom - top,
    width: right - left,
    x: left,
    y: top,
  }
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

function evenFloor(value: number) {
  return Math.floor(value / cropGridSize) * cropGridSize
}

function evenRound(value: number) {
  return Math.round(finiteOr(value, 0) / cropGridSize) * cropGridSize
}

function isFullFrame(rect: MediaCropRect, bounds: MediaCropBounds) {
  return rect.x === 0 && rect.y === 0 && rect.width === bounds.width && rect.height === bounds.height
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}
