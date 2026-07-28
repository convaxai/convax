import type { CanvasPoint } from "../types"

export interface CanvasNodeBounds {
  x: number
  y: number
  width: number
  height: number
}

export function resolveCanvasCardHandlePoint(bounds: CanvasNodeBounds, side: "left" | "right"): CanvasPoint {
  return {
    x: side === "right" ? bounds.x + bounds.width : bounds.x,
    y: bounds.y + bounds.height / 2,
  }
}
