import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createMediaNode, isCanvasEmptyMediaNodeData } from "./document"
import { isCanvasOptimisticGhostNodeData } from "./optimistic-overlay-react-flow"
import {
  CANVAS_OPTIMISTIC_HANDOFF_MAX_READINESS_FRAMES,
  createOptimisticAlignedResourceGhosts,
  createOptimisticEmptyNodeGhosts,
  createOptimisticPreparedResourceGhosts,
  createOptimisticResourceGhosts,
  isEmptyLocalCanvasResourceCreate,
  projectCanvasResourceGhostForReactFlow,
  scheduleCanvasOptimisticResourceHandoffAfterPaint,
  type CanvasOptimisticResourceHandoffScheduler,
} from "./optimistic-resource-projection"

function createFrameScheduler() {
  let nextFrameId = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  const cancelled: number[] = []
  const scheduler: CanvasOptimisticResourceHandoffScheduler = {
    cancelFrame(frameId) {
      cancelled.push(frameId)
      callbacks.delete(frameId)
    },
    requestFrame(callback) {
      const frameId = nextFrameId++
      callbacks.set(frameId, callback)
      return frameId
    },
  }
  const runNextFrame = () => {
    const entry = callbacks.entries().next().value
    if (!entry) throw new Error("Expected a scheduled animation frame")
    callbacks.delete(entry[0])
    entry[1](entry[0] * 16)
  }
  return { callbacks, cancelled, runNextFrame, scheduler }
}

describe("optimistic resource overlay", () => {
  test("hands a ready authority node off after exactly one paint shield frame", () => {
    const frames = createFrameScheduler()
    let settled = false
    scheduleCanvasOptimisticResourceHandoffAfterPaint({
      isAuthorityReady: () => true,
      onReady: () => {
        settled = true
      },
      scheduler: frames.scheduler,
    })

    frames.runNextFrame()
    expect(settled).toBeFalse()
    frames.runNextFrame()
    expect(settled).toBeTrue()
    expect(frames.callbacks.size).toBe(0)
    expect(CANVAS_OPTIMISTIC_HANDOFF_MAX_READINESS_FRAMES).toBeGreaterThan(4)
  })

  test("settles on the paint immediately after delayed authority readiness instead of waiting for the fallback", () => {
    const frames = createFrameScheduler()
    let authorityReady = false
    let settled = false
    scheduleCanvasOptimisticResourceHandoffAfterPaint({
      isAuthorityReady: () => authorityReady,
      onReady: () => {
        settled = true
      },
      scheduler: frames.scheduler,
    })

    frames.runNextFrame()
    authorityReady = true
    frames.runNextFrame()
    expect(settled).toBeFalse()
    frames.runNextFrame()
    expect(settled).toBeTrue()
    expect(frames.callbacks.size).toBe(0)
  })

  test("bounds a never-mounted authority and cancels a stale handoff", () => {
    const boundedFrames = createFrameScheduler()
    let settled = false
    scheduleCanvasOptimisticResourceHandoffAfterPaint({
      isAuthorityReady: () => false,
      maximumReadinessFrames: 2,
      onReady: () => {
        settled = true
      },
      scheduler: boundedFrames.scheduler,
    })
    boundedFrames.runNextFrame()
    boundedFrames.runNextFrame()
    expect(settled).toBeFalse()
    boundedFrames.runNextFrame()
    expect(settled).toBeTrue()

    const cancelledFrames = createFrameScheduler()
    const cancel = scheduleCanvasOptimisticResourceHandoffAfterPaint({
      onReady: () => {
        throw new Error("cancelled handoff must not settle")
      },
      scheduler: cancelledFrames.scheduler,
    })
    cancel()
    expect(cancelledFrames.callbacks.size).toBe(0)
    expect(cancelledFrames.cancelled).toEqual([1])
  })

  test("centers the first presentation ghost on a pointer anchor", () => {
    const ghosts = createOptimisticResourceGhosts({
      anchor: { x: 400, y: 260 },
      anchorOrigin: "center",
      document: createCanvasDocument({ id: "canvas-centered" }),
      files: [new File(["image"], "frame.png", { type: "image/png" })],
      intrinsicSizes: [{ height: 900, width: 1_600 }],
      previewUrls: ["blob:local-frame"],
      createPresentationKey: () => "presentation-centered",
    })

    expect(ghosts[0]).toMatchObject({
      position: { x: 240, y: 170 },
      presentation: { previewUrl: "blob:local-frame" },
      size: { height: 180, width: 320 },
    })
    const adapted = projectCanvasResourceGhostForReactFlow(ghosts[0]!)
    expect(adapted.data.resourceState).toMatchObject({ status: "ready", url: "blob:local-frame" })
    expect(adapted.style?.opacity).toBeUndefined()
    expect(adapted.style?.pointerEvents).toBe("none")
  })

  test("uses cached host presentation dimensions and preview on the first frame", () => {
    const ghosts = createOptimisticPreparedResourceGhosts({
      anchor: { x: 400, y: 260 },
      anchorOrigin: "center",
      document: createCanvasDocument({ id: "canvas-sidebar-presentation" }),
      createPresentationKey: () => "presentation-sidebar-image",
      presentations: [
        {
          intrinsicSize: { height: 900, width: 1_600 },
          mediaKind: "image",
          previewUrl: "data:image/png;base64,cached-thumbnail",
          title: "sidebar-image.png",
        },
      ],
    })

    expect(ghosts[0]).toMatchObject({
      position: { x: 240, y: 170 },
      presentation: { mediaKind: "image", previewUrl: "data:image/png;base64,cached-thumbnail" },
      size: { height: 180, width: 320 },
    })
    expect(projectCanvasResourceGhostForReactFlow(ghosts[0]!).data.resourceState).toMatchObject({
      status: "ready",
      url: "data:image/png;base64,cached-thumbnail",
    })
  })

  test("places local, explicit, drag and null presentation slots in one authority-aligned lane", () => {
    let nextKey = 0
    const ghosts = createOptimisticAlignedResourceGhosts({
      anchor: { x: 0, y: 0 },
      createPresentationKey: () => `aligned-${++nextKey}`,
      document: createCanvasDocument({ id: "canvas-aligned-mixed-resources" }),
      files: [new File(["image"], "local.png", { type: "image/png" })],
      intrinsicSizes: [{ height: 900, width: 1_600 }],
      presentations: [
        null,
        null,
        {
          intrinsicSize: { height: 900, width: 1_600 },
          mediaKind: "image",
          previewUrl: "data:image/png;base64,drag-preview",
          title: "drag-preview.png",
        },
        null,
      ],
      previewUrls: ["blob:local-preview"],
      sources: [{ kind: "new-text", name: "Explicit note", sourceId: "explicit-note", text: "" }],
    })

    expect(ghosts.map((ghost) => ghost.presentation.title)).toEqual([
      "local.png",
      "Explicit note",
      "drag-preview.png",
      "Resource",
    ])
    expect(ghosts.map((ghost) => ghost.position)).toEqual([
      { x: 0, y: 0 },
      { x: 344, y: 0 },
      { x: 688, y: 0 },
      { x: 1_032, y: 0 },
    ])
    expect(ghosts.map((ghost) => ghost.size)).toEqual([
      { height: 180, width: 320 },
      { height: 180, width: 320 },
      { height: 180, width: 320 },
      { height: 180, width: 240 },
    ])
    expect(ghosts[0]?.presentation.previewUrl).toBe("blob:local-preview")
    expect(ghosts[2]?.presentation.previewUrl).toBe("data:image/png;base64,drag-preview")
    expect(projectCanvasResourceGhostForReactFlow(ghosts[3]!).data.resourceState).toMatchObject({
      status: "ready",
      url: "",
    })
  })

  test("creates presentation ghosts without changing the authoritative document", () => {
    const authoritative = createCanvasDocument({
      id: "canvas-a",
      nodes: [
        createMediaNode({
          id: "existing",
          position: { x: 20, y: 40 },
          resource: { id: "existing", kind: "image", metadata: {}, state: { status: "ready" } },
        }),
      ],
    })
    let nextKey = 0
    const ghosts = createOptimisticResourceGhosts({
      anchor: { x: 20, y: 40 },
      document: authoritative,
      files: [
        new File(["image"], "frame.png", { type: "image/png" }),
        new File(["# Brief"], "brief.md", { type: "text/markdown" }),
      ],
      intrinsicSizes: [{ height: 900, width: 1_600 }, null],
      parentPresentationKey: "group-a",
      createPresentationKey: () => `presentation-${++nextKey}`,
    })

    expect(authoritative.nodes.map((node) => node.id)).toEqual(["existing"])
    expect(
      ghosts.map((ghost) => ({
        kind: ghost.kind,
        nodeType: ghost.presentation.nodeType,
        title: ghost.presentation.title,
      })),
    ).toEqual([
      { kind: "ghost-node", nodeType: "file", title: "frame.png" },
      { kind: "ghost-node", nodeType: "text", title: "brief.md" },
    ])
    expect(ghosts.every((ghost) => ghost.parentPresentationKey === "group-a")).toBeTrue()
    expect(ghosts.map((ghost) => ghost.size)).toEqual([
      { height: 180, width: 320 },
      { height: 180, width: 320 },
    ])
    expect(ghosts[0]?.position).not.toEqual(ghosts[1]?.position)

    const adapted = ghosts.map(projectCanvasResourceGhostForReactFlow)
    expect(
      adapted.every(
        (node) =>
          node.connectable === false &&
          node.deletable === false &&
          node.draggable === false &&
          node.focusable === false &&
          node.selectable === false &&
          node.style?.pointerEvents === "none" &&
          node.style?.opacity === undefined &&
          node.data.status === "pending",
      ),
    ).toBeTrue()
    expect(JSON.stringify(ghosts)).not.toContain("connectable")
  })

  test("projects an empty pending image as an idle empty card without inventing a File", () => {
    expect(
      isEmptyLocalCanvasResourceCreate({
        files: [],
        pending: { kind: "image" },
        sources: [],
      }),
    ).toBeTrue()
    expect(
      isEmptyLocalCanvasResourceCreate({
        files: [new File(["image"], "frame.png", { type: "image/png" })],
        sources: [],
      }),
    ).toBeFalse()

    const ghosts = createOptimisticEmptyNodeGhosts({
      anchor: { x: 400, y: 260 },
      document: createCanvasDocument({ id: "canvas-empty" }),
      kind: "image",
      createPresentationKey: () => "presentation-empty-image",
    })

    expect(ghosts).toHaveLength(1)
    expect(ghosts[0]).toMatchObject({
      presentation: {
        emptyCard: true,
        mediaKind: "image",
        nodeType: "file",
        title: "Image",
      },
      size: { height: 180, width: 240 },
    })
    expect(ghosts[0]?.presentation).not.toHaveProperty("mimeType")

    const adapted = projectCanvasResourceGhostForReactFlow(ghosts[0]!)
    expect(adapted.data.status).toBe("idle")
    expect(adapted.data.name).toBeUndefined()
    expect(adapted.data.mimeType).toBeUndefined()
    expect(isCanvasEmptyMediaNodeData(adapted.data)).toBeTrue()
    expect(adapted.connectable).toBeFalse()
    expect(isCanvasOptimisticGhostNodeData(adapted.data)).toBeTrue()
    expect(adapted.style?.opacity).toBeUndefined()
  })

  test("projects requested focus immediately without making the ghost interactive", () => {
    const [ghost] = createOptimisticEmptyNodeGhosts({
      anchor: { x: 40, y: 60 },
      document: createCanvasDocument({ id: "canvas-focused-ghost" }),
      kind: "video",
      createPresentationKey: () => "presentation-focused-video",
    })
    const adapted = projectCanvasResourceGhostForReactFlow({ ...ghost!, focusVisible: true })

    expect(adapted.selected).toBeTrue()
    expect(adapted.selectable).toBeFalse()
    expect(adapted.focusable).toBeFalse()
    expect(adapted.draggable).toBeFalse()
    expect(adapted.style?.pointerEvents).toBe("none")
  })

  test("projects an empty new-text node as an idle card without inventing a File", () => {
    expect(
      isEmptyLocalCanvasResourceCreate({
        files: [],
        sources: [{ kind: "new-text" }],
      }),
    ).toBeTrue()

    const ghosts = createOptimisticEmptyNodeGhosts({
      anchor: { x: 80, y: 40 },
      document: createCanvasDocument({ id: "canvas-empty-text" }),
      kind: "text",
      createPresentationKey: () => "presentation-empty-text",
    })
    const adapted = projectCanvasResourceGhostForReactFlow(ghosts[0]!)
    expect(adapted.data.kind).toBe("text")
    expect(adapted.data.status).toBe("idle")
    expect(adapted.data.name).toBeUndefined()
    expect(adapted.data.mimeType).toBeUndefined()
    expect(isCanvasOptimisticGhostNodeData(adapted.data)).toBeTrue()
    expect(adapted.style?.opacity).toBeUndefined()
  })
})
