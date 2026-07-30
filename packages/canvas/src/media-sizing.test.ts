import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createMediaNode } from "./document"
import { fitCanvasMediaNodeToIntrinsicSize, fitCanvasMediaSizeWithinBounds } from "./media-sizing"

describe("Canvas media sizing", () => {
  test("fits every aspect ratio within one bounded media box", () => {
    expect(fitCanvasMediaSizeWithinBounds(4_000, 4_000)).toEqual({ height: 320, width: 320 })
    expect(fitCanvasMediaSizeWithinBounds(1_024, 2_048)).toEqual({ height: 320, width: 160 })
    expect(fitCanvasMediaSizeWithinBounds(2_400, 800)).toEqual({ height: 107, width: 320 })
    expect(fitCanvasMediaSizeWithinBounds(120, 80)).toEqual({ height: 80, width: 120 })
    expect(fitCanvasMediaSizeWithinBounds(0, 800)).toBeNull()
  })

  test("fits a dimensionless image once after it loads without stretching its current width", () => {
    const image = {
      ...createMediaNode({
        id: "image",
        position: { x: 10, y: 20 },
        resource: {
          id: "image",
          kind: "image",
          metadata: {},
          state: { status: "ready", url: "asset://portrait" },
        },
      }),
      measured: { height: 240, width: 480 },
      style: { height: 300, width: 400 },
    }
    const document = createCanvasDocument({ nodes: [image] })
    const fitted = fitCanvasMediaNodeToIntrinsicSize(document, {
      height: 1_600,
      nodeId: image.id,
      sourceUrl: "asset://portrait",
      width: 800,
    })

    expect(fitted.nodes[0]).toMatchObject({
      data: { height: 1_600, kind: "image", width: 800 },
      position: image.position,
      style: { height: 320, width: 160 },
    })
    expect(fitted.nodes[0]?.measured).toBeUndefined()
    expect(fitted.nodes[0]?.width).toBeUndefined()
    expect(fitted.nodes[0]?.height).toBeUndefined()
  })

  test("ignores stale loads and preserves a card that already knows its image dimensions", () => {
    const image = createMediaNode({
      id: "image",
      position: { x: 0, y: 0 },
      resource: {
        height: 900,
        id: "image",
        kind: "image",
        metadata: {},
        state: { status: "ready", url: "asset://current" },
        width: 1_600,
      },
    })
    const document = createCanvasDocument({ nodes: [image] })

    expect(
      fitCanvasMediaNodeToIntrinsicSize(document, {
        height: 2_000,
        nodeId: image.id,
        sourceUrl: "asset://stale",
        width: 1_000,
      }),
    ).toBe(document)
    expect(
      fitCanvasMediaNodeToIntrinsicSize(document, {
        height: 2_000,
        nodeId: image.id,
        sourceUrl: "asset://current",
        width: 1_000,
      }),
    ).toBe(document)
  })

  test("records intrinsic dimensions without resizing an explicit cover crop", () => {
    const image = createMediaNode({
      id: "image",
      position: { x: 0, y: 0 },
      resource: {
        id: "image",
        kind: "image",
        metadata: {},
        state: { status: "ready", url: "asset://cover" },
      },
    })
    const document = createCanvasDocument({
      nodes: [{ ...image, data: { ...image.data, fit: "cover" }, style: { height: 260, width: 420 } }],
    })
    const fitted = fitCanvasMediaNodeToIntrinsicSize(document, {
      height: 1_600,
      nodeId: image.id,
      sourceUrl: "asset://cover",
      width: 800,
    })

    expect(fitted.nodes[0]).toMatchObject({
      data: { fit: "cover", height: 1_600, width: 800 },
      style: { height: 260, width: 420 },
    })
  })

  test("records cutout result dimensions without resizing its pending frame", () => {
    const image = createMediaNode({
      id: "cutout-result",
      position: { x: 384, y: 20 },
      resource: {
        id: "cutout-result",
        kind: "image",
        metadata: {},
        state: { status: "ready", url: "asset://cutout-result" },
      },
    })
    const pendingFrame = {
      ...image,
      measured: { height: 240, width: 320 },
      style: { height: 240, width: 320 },
    }
    const fitted = fitCanvasMediaNodeToIntrinsicSize(createCanvasDocument({ nodes: [pendingFrame] }), {
      height: 1_600,
      nodeId: image.id,
      preserveFrame: true,
      sourceUrl: "asset://cutout-result",
      width: 800,
    })

    expect(fitted.nodes[0]).toMatchObject({
      data: { height: 1_600, kind: "image", width: 800 },
      measured: pendingFrame.measured,
      position: pendingFrame.position,
      style: pendingFrame.style,
    })
  })

  test("uses the same bounded sizing for video metadata", () => {
    const video = createMediaNode({
      id: "video",
      position: { x: 0, y: 0 },
      resource: {
        id: "video",
        kind: "video",
        metadata: {},
        state: { status: "ready", url: "asset://video" },
      },
    })
    const fitted = fitCanvasMediaNodeToIntrinsicSize(createCanvasDocument({ nodes: [video] }), {
      height: 1_080,
      nodeId: video.id,
      sourceUrl: "asset://video",
      width: 1_920,
    })

    expect(fitted.nodes[0]).toMatchObject({
      data: { height: 1_080, kind: "video", width: 1_920 },
      style: { height: 180, width: 320 },
    })
  })
})
