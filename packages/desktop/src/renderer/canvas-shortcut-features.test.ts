import { describe, expect, mock, test } from "bun:test"

import { canvasShortcutFeatureIds, createCanvasShortcutFeatures } from "./canvas-shortcut-features"

describe("Desktop Canvas shortcut inventory", () => {
  test("registers every core Canvas command exactly once on macOS and Windows", () => {
    for (const platform of ["darwin", "win32"]) {
      const features = createCanvasShortcutFeatures({
        canRun: () => true,
        platform,
        run: () => undefined,
        scopeId: "canvas",
        setSpacePanningHeld: () => undefined,
      })
      expect(features.map((feature) => feature.id)).toEqual([...canvasShortcutFeatureIds])
      expect(new Set(features.map((feature) => feature.id)).size).toBe(features.length)
      expect(features.every((feature) => feature.scopeId === "canvas")).toBeTrue()
    }
  })

  test("routes commands through the Canvas port and owns Space as a held feature", () => {
    const run = mock(() => undefined)
    const setSpacePanningHeld = mock((_held: boolean) => undefined)
    const features = createCanvasShortcutFeatures({
      canRun: () => true,
      platform: "darwin",
      run,
      scopeId: "canvas",
      setSpacePanningHeld,
    })

    const duplicate = features.find((feature) => feature.id === "canvas.duplicate")
    if (duplicate?.kind === "command") duplicate.onTrigger({} as KeyboardEvent)
    const space = features.find((feature) => feature.id === "canvas.space-pan")
    if (space?.kind === "hold") {
      space.onHold({} as KeyboardEvent)
      space.onRelease()
    }

    expect(run).toHaveBeenCalledWith("duplicate")
    expect(space?.kind).toBe("hold")
    expect(setSpacePanningHeld.mock.calls.map((call) => call[0])).toEqual([true, false])
  })
})
