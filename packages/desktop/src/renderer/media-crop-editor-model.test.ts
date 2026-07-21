import { describe, expect, test } from "bun:test"
import {
  adaptMediaCropRectToBounds,
  clampMediaCropRect,
  createFullFrameMediaCropRect,
  moveMediaCropRect,
  normalizeMediaCropBounds,
  resizeMediaCropRect,
} from "./media-crop-editor-model"

describe("media crop editor model", () => {
  test("normalizes source dimensions to the even YUV 4:2:0 grid", () => {
    const bounds = normalizeMediaCropBounds(1_279, 719)
    expect(bounds).toEqual({ height: 718, width: 1_278 })
    expect(createFullFrameMediaCropRect(bounds)).toEqual({ height: 718, width: 1_278, x: 0, y: 0 })
  })

  test("moves the selection on an even grid and keeps it inside the source", () => {
    const bounds = { height: 720, width: 1_280 }
    const rect = { height: 360, width: 640, x: 100, y: 100 }
    expect(moveMediaCropRect(rect, bounds, 31, -101)).toEqual({ height: 360, width: 640, x: 132, y: 0 })
    expect(moveMediaCropRect(rect, bounds, 2_000, 2_000)).toEqual({ height: 360, width: 640, x: 640, y: 360 })
  })

  test("resizes from edges and corners without crossing the opposite boundary", () => {
    const bounds = { height: 720, width: 1_280 }
    const rect = { height: 360, width: 640, x: 100, y: 100 }
    expect(resizeMediaCropRect(rect, bounds, "nw", 101, 51)).toEqual({
      height: 308,
      width: 538,
      x: 202,
      y: 152,
    })
    expect(resizeMediaCropRect(rect, bounds, "se", 2_000, 2_000)).toEqual({
      height: 620,
      width: 1_180,
      x: 100,
      y: 100,
    })
    expect(resizeMediaCropRect(rect, bounds, "nw", 2_000, 2_000)).toEqual({
      height: 2,
      width: 2,
      x: 738,
      y: 458,
    })
  })

  test("clamps stale values back into the current source", () => {
    expect(clampMediaCropRect({ height: 721, width: 1_281, x: -3, y: 719 }, { height: 720, width: 1_280 })).toEqual({
      height: 2,
      width: 1_280,
      x: 0,
      y: 718,
    })
  })

  test("adapts the visual selection when loaded video dimensions differ from card metadata", () => {
    expect(
      adaptMediaCropRectToBounds(
        { height: 720, width: 1_280, x: 0, y: 0 },
        { height: 720, width: 1_280 },
        { height: 480, width: 720 },
      ),
    ).toEqual({ height: 480, width: 720, x: 0, y: 0 })
    expect(
      adaptMediaCropRectToBounds(
        { height: 360, width: 640, x: 320, y: 180 },
        { height: 720, width: 1_280 },
        { height: 480, width: 720 },
      ),
    ).toEqual({ height: 240, width: 360, x: 180, y: 120 })
  })
})
