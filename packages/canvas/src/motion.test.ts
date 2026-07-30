import { describe, expect, test } from "bun:test"
import {
  CANVAS_MOTION_DURATION,
  CanvasNodeEntryPresentationStore,
  CanvasNodeEntryTracker,
  canvasMotionStyle,
  canvasViewportEase,
  resolveCanvasCenteredZoomViewport,
  resolveCanvasRectEnterTransform,
  resolveCanvasReducedMotion,
} from "./motion"

describe("Canvas motion policy", () => {
  test("keeps the interaction hierarchy on one bounded timing scale", () => {
    expect(CANVAS_MOTION_DURATION).toMatchObject({
      edgeLoop: 500,
      fit: 300,
      generationPanel: 200,
      menu: 100,
      port: 156,
      selectionToolbar: 150,
      stepZoom: 200,
      viewport: 300,
    })
    expect(canvasMotionStyle(false)).toMatchObject({
      "--canvas-motion-edge-loop": "500ms",
      "--canvas-motion-generation-panel": "200ms",
      "--canvas-motion-menu": "100ms",
      "--canvas-motion-port": "156ms",
      "--canvas-motion-viewport": "300ms",
    })
    expect(canvasMotionStyle(true)).toMatchObject({
      "--canvas-motion-edge-loop": "0ms",
      "--canvas-motion-menu": "0ms",
      "--canvas-motion-viewport": "0ms",
    })
  })

  test("zooms around the visible viewport center", () => {
    expect(
      resolveCanvasCenteredZoomViewport({
        bounds: { height: 600, width: 800 },
        targetZoom: 2,
        viewport: { x: -200, y: 100, zoom: 1 },
      }),
    ).toEqual({ x: -800, y: -100, zoom: 2 })
    expect(
      resolveCanvasCenteredZoomViewport({
        bounds: { height: 0, width: 800 },
        targetZoom: 2,
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    ).toBeUndefined()
  })

  test("uses a bounded cubic-in-out curve for scripted viewport movement", () => {
    expect(canvasViewportEase(-1)).toBe(0)
    expect(canvasViewportEase(0.25)).toBe(0.0625)
    expect(canvasViewportEase(0.5)).toBe(0.5)
    expect(canvasViewportEase(0.75)).toBe(0.9375)
    expect(canvasViewportEase(2)).toBe(1)
  })

  test("lets an explicit host preference override the operating system", () => {
    expect(resolveCanvasReducedMotion(true, false)).toBeTrue()
    expect(resolveCanvasReducedMotion(false, true)).toBeFalse()
    expect(resolveCanvasReducedMotion(undefined, true)).toBeTrue()
    expect(resolveCanvasReducedMotion(undefined, false)).toBeFalse()
  })

  test("tracks explicit node creation once without treating hydration as entry evidence", () => {
    const tracker = new CanvasNodeEntryTracker("project-a:canvas-a", ["hydrated"], 4)
    tracker.queue("project-a:canvas-a", ["hydrated", "new-a", "new-b", "new-a"])

    expect(tracker.activate("project-a:canvas-a", new Set(["hydrated", "new-a"]))).toEqual(["new-a"])
    expect(tracker.activate("project-a:canvas-a", new Set(["hydrated", "new-a", "new-b"]))).toEqual(["new-b"])

    tracker.queue("project-a:canvas-a", ["new-a"])
    expect(tracker.activate("project-a:canvas-a", new Set(["new-a"]))).toEqual([])
  })

  test("bounds entry history and cancels stale scope work", () => {
    const tracker = new CanvasNodeEntryTracker("scope-a", [], 2)
    tracker.queue("scope-a", ["one", "two", "three"])
    expect(tracker.pendingCount).toBe(2)
    expect(tracker.activate("scope-b", new Set(["two", "three"]))).toEqual([])

    tracker.reset("scope-b", ["hydrated-b"])
    tracker.queue("scope-a", ["stale"])
    tracker.queue("scope-b", ["fresh"])
    expect(tracker.activate("scope-b", new Set(["fresh"]))).toEqual(["fresh"])
    expect(tracker.hasPresented("hydrated-b")).toBeTrue()
  })

  test("notifies only the node whose transient entry presentation changes", () => {
    const presentation = new CanvasNodeEntryPresentationStore("scope-a")
    let firstNotifications = 0
    let secondNotifications = 0
    presentation.subscribe("first", () => firstNotifications++)
    presentation.subscribe("second", () => secondNotifications++)

    presentation.prepare("scope-a", ["first"])
    expect(presentation.has("first")).toBeTrue()
    expect(presentation.phase("first")).toBe("pending-focus")
    expect(presentation.enteringNodeIds.has("first")).toBeFalse()
    expect(firstNotifications).toBe(1)
    expect(secondNotifications).toBe(0)

    presentation.start("scope-a", ["first"])
    expect(presentation.phase("first")).toBe("entering")
    expect(presentation.enteringNodeIds.has("first")).toBeTrue()
    expect(firstNotifications).toBe(2)
    expect(secondNotifications).toBe(0)

    presentation.finish("scope-a", "first")
    expect(presentation.has("first")).toBeFalse()
    expect(presentation.phase("first")).toBe("idle")
    expect(presentation.enteringNodeIds.has("first")).toBeFalse()
    expect(firstNotifications).toBe(3)
    expect(secondNotifications).toBe(0)

    presentation.start("stale-scope", ["second"])
    expect(presentation.has("second")).toBeFalse()
    expect(secondNotifications).toBe(0)
  })

  test("derives a transient rect-to-expanded transform without changing layout", () => {
    expect(
      resolveCanvasRectEnterTransform(
        { height: 100, left: 20, top: 40, width: 200 },
        { height: 500, left: 100, top: 80, width: 800 },
      ),
    ).toEqual({
      transform: "translate3d(-380px, -240px, 0) scale(0.25, 0.2)",
      transformOrigin: "center",
    })
    expect(
      resolveCanvasRectEnterTransform(
        { height: 0, left: 20, top: 40, width: 200 },
        { height: 500, left: 100, top: 80, width: 800 },
      ),
    ).toBeUndefined()
  })
})
