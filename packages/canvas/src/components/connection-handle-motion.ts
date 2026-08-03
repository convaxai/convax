export const CANVAS_CONNECTION_HANDLE_MAGNET_MAX_OFFSET = 16
export const CANVAS_CONNECTION_HANDLE_MAGNET_STRENGTH = 0.48

export interface CanvasConnectionHandlePoint {
  x: number
  y: number
}

export interface CanvasConnectionHandleSize {
  height: number
  width: number
}

export interface CanvasConnectionHandleViewportBounds extends CanvasConnectionHandleSize {
  left: number
  top: number
}

/**
 * Projects viewport pointer coordinates into the Handle's local coordinate space.
 * React Flow scales nodes with the viewport, so using client pixels directly would
 * make the magnetic travel vary with Canvas zoom.
 */
export function projectCanvasConnectionHandlePointer(
  pointer: CanvasConnectionHandlePoint,
  viewportBounds: CanvasConnectionHandleViewportBounds,
  layoutSize: CanvasConnectionHandleSize,
): CanvasConnectionHandlePoint {
  if (
    !isFinitePoint(pointer) ||
    !isFiniteBounds(viewportBounds) ||
    !isFiniteSize(layoutSize) ||
    viewportBounds.width <= 0 ||
    viewportBounds.height <= 0 ||
    layoutSize.width <= 0 ||
    layoutSize.height <= 0
  ) {
    return {
      x: nonNegativeFinite(layoutSize.width) / 2,
      y: nonNegativeFinite(layoutSize.height) / 2,
    }
  }

  return {
    x: ((pointer.x - viewportBounds.left) / viewportBounds.width) * layoutSize.width,
    y: ((pointer.y - viewportBounds.top) / viewportBounds.height) * layoutSize.height,
  }
}

/**
 * Resolves a bounded radial offset for the visual button only. The React Flow
 * Handle remains centered, keeping persisted edge geometry stable.
 */
export function resolveCanvasConnectionHandleMagnetOffset(
  pointer: CanvasConnectionHandlePoint,
  triggerSize: CanvasConnectionHandleSize,
  options: { maxOffset?: number; reducedMotion?: boolean; strength?: number } = {},
): CanvasConnectionHandlePoint {
  if (
    options.reducedMotion ||
    !isFinitePoint(pointer) ||
    !isFiniteSize(triggerSize) ||
    triggerSize.width <= 0 ||
    triggerSize.height <= 0
  ) {
    return centeredConnectionHandlePoint()
  }

  const maxOffset = nonNegativeFinite(options.maxOffset ?? CANVAS_CONNECTION_HANDLE_MAGNET_MAX_OFFSET)
  const strength = nonNegativeFinite(options.strength ?? CANVAS_CONNECTION_HANDLE_MAGNET_STRENGTH)
  const x = (pointer.x - triggerSize.width / 2) * strength
  const y = (pointer.y - triggerSize.height / 2) * strength
  const distance = Math.hypot(x, y)

  if (distance === 0 || maxOffset === 0) return centeredConnectionHandlePoint()
  if (distance <= maxOffset) return { x, y }

  const scale = maxOffset / distance
  return { x: x * scale, y: y * scale }
}

function isFinitePoint(point: CanvasConnectionHandlePoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function isFiniteSize(size: CanvasConnectionHandleSize) {
  return Number.isFinite(size.width) && Number.isFinite(size.height)
}

function isFiniteBounds(bounds: CanvasConnectionHandleViewportBounds) {
  return Number.isFinite(bounds.left) && Number.isFinite(bounds.top) && isFiniteSize(bounds)
}

function centeredConnectionHandlePoint(): CanvasConnectionHandlePoint {
  return { x: 0, y: 0 }
}

function nonNegativeFinite(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
