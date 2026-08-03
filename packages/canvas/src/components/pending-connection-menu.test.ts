import { describe, expect, test } from "bun:test"
import { resolvePendingConnectionOverlayGeometry } from "./pending-connection-menu"

describe("pending Canvas connections", () => {
  test("projects a pending right-side connection with the live viewport", () => {
    expect(
      resolvePendingConnectionOverlayGeometry({
        side: "right",
        sourceBounds: { x: 100, y: 50, width: 200, height: 120 },
        targetPosition: { x: 500, y: 260 },
        viewport: { x: -80, y: 40, zoom: 1.5 },
      }),
    ).toEqual({
      sourcePoint: { x: 370, y: 205 },
      sourceScale: 1.5,
      targetPoint: { x: 670, y: 430 },
    })
  })

  test("keeps a pending left-side connection attached after pan and zoom", () => {
    const input = {
      side: "left" as const,
      sourceBounds: { x: 100, y: 50, width: 200, height: 120 },
      targetPosition: { x: -40, y: 260 },
    }

    expect(resolvePendingConnectionOverlayGeometry({ ...input, viewport: { x: 0, y: 0, zoom: 1 } })).toEqual({
      sourcePoint: { x: 100, y: 110 },
      sourceScale: 1,
      targetPoint: { x: -40, y: 260 },
    })
    expect(resolvePendingConnectionOverlayGeometry({ ...input, viewport: { x: 300, y: -70, zoom: 0.5 } })).toEqual({
      sourcePoint: { x: 350, y: -15 },
      sourceScale: 0.5,
      targetPoint: { x: 280, y: 60 },
    })
  })
})
