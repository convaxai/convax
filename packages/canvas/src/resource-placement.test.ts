import { describe, expect, test } from "bun:test"
import { resolveCanvasResourcePlacements } from "./resource-placement"

describe("resource placement", () => {
  test("uses one deterministic positive-X lane for authority and presentation", () => {
    expect(
      resolveCanvasResourcePlacements({
        anchor: { x: 0, y: 0 },
        obstacles: [
          { height: 180, width: 320, x: 0, y: 0 },
          { height: 180, width: 240, x: 344, y: 0 },
        ],
        sizes: [
          { height: 180, width: 320 },
          { height: 180, width: 240 },
        ],
      }),
    ).toEqual([
      { x: 608, y: 0 },
      { x: 952, y: 0 },
    ])
  })

  test("rejects invalid geometry instead of producing divergent placement", () => {
    expect(
      resolveCanvasResourcePlacements({
        anchor: { x: Number.NaN, y: 0 },
        obstacles: [],
        sizes: [{ height: 180, width: 320 }],
      }),
    ).toBeNull()
  })
})
