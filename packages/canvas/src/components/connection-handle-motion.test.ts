import { describe, expect, test } from "bun:test"
import {
  CANVAS_CONNECTION_HANDLE_MAGNET_MAX_OFFSET,
  projectCanvasConnectionHandlePointer,
  resolveCanvasConnectionHandleMagnetOffset,
} from "./connection-handle-motion"

describe("Canvas connection handle motion", () => {
  test("keeps the visual button centered when the pointer is centered", () => {
    expect(resolveCanvasConnectionHandleMagnetOffset({ x: 44, y: 44 }, { width: 88, height: 88 })).toEqual({
      x: 0,
      y: 0,
    })
  })

  test("follows the pointer within the magnetic trigger", () => {
    expect(
      resolveCanvasConnectionHandleMagnetOffset(
        { x: 54, y: 39 },
        { width: 88, height: 88 },
        { strength: 0.5 },
      ),
    ).toEqual({ x: 5, y: -2.5 })
  })

  test("clamps diagonal travel to one radial maximum", () => {
    const offset = resolveCanvasConnectionHandleMagnetOffset({ x: 88, y: 88 }, { width: 88, height: 88 })

    expect(Math.hypot(offset.x, offset.y)).toBeCloseTo(CANVAS_CONNECTION_HANDLE_MAGNET_MAX_OFFSET)
    expect(offset.x).toBeCloseTo(offset.y)
  })

  test("projects viewport coordinates into local coordinates at Canvas zoom", () => {
    expect(
      projectCanvasConnectionHandlePointer(
        { x: 122, y: 211 },
        { left: 100, top: 200, width: 44, height: 44 },
        { width: 88, height: 88 },
      ),
    ).toEqual({ x: 44, y: 22 })
  })

  test("disables magnetic travel for reduced motion", () => {
    expect(
      resolveCanvasConnectionHandleMagnetOffset(
        { x: 88, y: 88 },
        { width: 88, height: 88 },
        { reducedMotion: true },
      ),
    ).toEqual({ x: 0, y: 0 })
  })

  test("fails closed for an unmeasurable trigger", () => {
    expect(resolveCanvasConnectionHandleMagnetOffset({ x: 10, y: 10 }, { width: 0, height: 88 })).toEqual({
      x: 0,
      y: 0,
    })
  })
})
