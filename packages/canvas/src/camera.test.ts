import { describe, expect, test } from "bun:test"
import {
  isCanvasCameraMotionCurrent,
  isCanvasPostMutationRevealGuardCurrent,
  resolveCanvasAnchoredZoomViewport,
  resolveCanvasFocusAvoidanceViewport,
  resolveCanvasSafeViewportRect,
  resolveCanvasVisibleWorldRect,
  resolveInitialCanvasCameraFit,
  shouldRevealCanvasNodes,
} from "./camera"
import type { CanvasDocument } from "./types"

const document = {
  edges: [],
  id: "canvas",
  metadata: { title: "Camera" },
  nodes: [
    {
      data: { kind: "test", label: "Visible" },
      id: "visible",
      position: { x: 20, y: 20 },
      style: { height: 100, width: 100 },
      type: "file",
    },
    {
      data: { kind: "test", label: "Outside" },
      id: "outside",
      position: { x: 900, y: 20 },
      style: { height: 100, width: 100 },
      type: "file",
    },
  ],
  revision: 2,
} satisfies CanvasDocument

describe("Canvas camera policy", () => {
  test("derives a host-neutral safe rectangle from bounded occlusion insets", () => {
    expect(resolveCanvasSafeViewportRect({ height: 600, width: 1000 }, { bottom: 80, left: 12, right: 300 })).toEqual(
      {
        bottom: 520,
        height: 520,
        left: 12,
        right: 700,
        top: 0,
        width: 688,
      },
    )
    expect(resolveCanvasSafeViewportRect({ height: 0, width: 1000 })).toBeUndefined()
    expect(resolveCanvasSafeViewportRect({ height: 600, width: 1000 }, { left: 600, right: 500 })).toBeUndefined()
  })

  test("projects the safe viewport into finite world-space placement bounds", () => {
    expect(
      resolveCanvasVisibleWorldRect({
        safeRect: { bottom: 520, height: 500, left: 20, right: 720, top: 20, width: 700 },
        viewport: { x: -180, y: 120, zoom: 2 },
      }),
    ).toEqual({ bottom: 200, height: 250, left: 100, right: 450, top: -50, width: 350 })
    expect(
      resolveCanvasVisibleWorldRect({
        safeRect: { bottom: 520, height: 500, left: 20, right: 720, top: 20, width: 700 },
        viewport: { x: 0, y: 0, zoom: 0 },
      }),
    ).toBeUndefined()
  })

  test("zooms about the pointer rather than the full viewport center", () => {
    expect(
      resolveCanvasAnchoredZoomViewport({
        anchor: { x: 200, y: 100 },
        targetZoom: 2,
        viewport: { x: -100, y: 40, zoom: 1 },
      }),
    ).toEqual({ x: -400, y: -20, zoom: 2 })
  })

  test("reveals only authoritative targets outside the safe rectangle", () => {
    const safeRect = resolveCanvasSafeViewportRect({ height: 600, width: 1000 }, { right: 300 })!
    expect(
      shouldRevealCanvasNodes({
        document,
        nodeIds: ["visible"],
        safeRect,
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    ).toBeFalse()
    expect(
      shouldRevealCanvasNodes({
        document,
        nodeIds: ["outside"],
        safeRect,
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    ).toBeTrue()
    expect(
      shouldRevealCanvasNodes({
        document,
        nodeIds: ["missing"],
        safeRect,
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    ).toBeFalse()
  })

  test("cancels stale, remounted, or user-navigated post-mutation effects", () => {
    const guard = { documentId: "canvas", navigationRevision: 3, scopeId: "project", viewId: "main" }
    expect(isCanvasPostMutationRevealGuardCurrent(guard, guard)).toBeTrue()
    expect(isCanvasPostMutationRevealGuardCurrent(guard, { ...guard, navigationRevision: 4 })).toBeFalse()
    expect(isCanvasPostMutationRevealGuardCurrent(guard, { ...guard, viewId: "secondary" })).toBeFalse()
  })

  test("marks an empty Canvas initialized without replaying the first-mutation fit", () => {
    expect(
      resolveInitialCanvasCameraFit({
        initializedScope: "",
        nodeCount: 0,
        scope: "project:canvas",
      }),
    ).toBe("mark-only")
    expect(
      resolveInitialCanvasCameraFit({
        initializedScope: "project:canvas",
        nodeCount: 1,
        scope: "project:canvas",
      }),
    ).toBe("skip")
    expect(
      resolveInitialCanvasCameraFit({
        initializedScope: "",
        nodeCount: 2,
        scope: "project:canvas",
      }),
    ).toBe("mark-and-fit")
  })

  test("treats superseded camera motion generations as cancelled", () => {
    expect(isCanvasCameraMotionCurrent(3, 3)).toBeTrue()
    expect(isCanvasCameraMotionCurrent(3, 4)).toBeFalse()
  })

  test("avoids a newly occluded focus without changing zoom", () => {
    const safeRect = resolveCanvasSafeViewportRect({ height: 600, width: 1000 }, { right: 300 })!
    expect(
      resolveCanvasFocusAvoidanceViewport({
        document,
        nodeIds: ["outside"],
        safeRect,
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    ).toEqual({ x: -300, y: 0, zoom: 1 })
    expect(
      resolveCanvasFocusAvoidanceViewport({
        document,
        nodeIds: ["visible"],
        safeRect,
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    ).toBeUndefined()
  })
})
