import { describe, expect, mock, test } from "bun:test"
import type { NativeImage } from "electron"

import {
  createCanvasExternalMediaDragIconFactory,
  type CanvasExternalMediaDragIconAdapter,
} from "./canvas-external-media-drag-icon"

class TestImage {
  readonly resizeCalls: Array<{ height?: number; quality?: string; width?: number }> = []

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly fill = 19,
  ) {}

  getSize() {
    return { height: this.height, width: this.width }
  }

  isEmpty() {
    return this.width === 0 || this.height === 0
  }

  resize(options: { height?: number; quality?: string; width?: number }) {
    this.resizeCalls.push(options)
    return image(options.width ?? this.width, options.height ?? this.height, this.fill)
  }

  toBitmap() {
    return Buffer.alloc(this.width * this.height * 4, this.fill)
  }
}

function image(width: number, height: number, fill = 19) {
  return new TestImage(width, height, fill) as unknown as NativeImage
}

function adapter(
  input: {
    direct?: NativeImage
    thumbnail?: NativeImage
    thumbnailError?: Error
  } = {},
) {
  let composedBitmap: Buffer | undefined
  const value: CanvasExternalMediaDragIconAdapter = {
    createFromBitmap: mock((buffer, options) => {
      composedBitmap = Buffer.from(buffer)
      return image(options.width, options.height)
    }),
    createFromPath: mock(() => input.direct ?? image(0, 0)),
    createThumbnailFromPath: mock(async () => {
      if (input.thumbnailError) throw input.thumbnailError
      return input.thumbnail ?? image(0, 0)
    }),
  }
  return { adapter: value, composedBitmap: () => composedBitmap }
}

describe("Canvas external media drag icon", () => {
  test("uses the selected image pixels and adds the selection count badge", async () => {
    const direct = image(200, 100, 31)
    const fixture = adapter({ direct })
    const createIcon = createCanvasExternalMediaDragIconFactory({
      adapter: fixture.adapter,
    })

    await createIcon({ file: "/staged/selected.png", itemCount: 3 })

    expect(fixture.adapter.createFromPath).toHaveBeenCalledWith("/staged/selected.png")
    expect(fixture.adapter.createThumbnailFromPath).not.toHaveBeenCalled()
    expect((direct as unknown as TestImage).resizeCalls).toEqual([{ height: 32, quality: "better", width: 64 }])
    const bitmap = fixture.composedBitmap()
    expect(bitmap).toBeDefined()
    expect(bitmap?.includes(Buffer.from([220, 54, 73, 255]))).toBeTrue()
    expect(bitmap?.includes(Buffer.from([255, 255, 255, 255]))).toBeTrue()
  })

  test("uses the operating-system thumbnail for video without consulting an associated application", async () => {
    const thumbnail = image(160, 90)
    const video = adapter({ thumbnail })
    const createVideoIcon = createCanvasExternalMediaDragIconFactory({
      adapter: video.adapter,
    })

    await createVideoIcon({ file: "/staged/clip.mp4", itemCount: 1 })
    expect(video.adapter.createThumbnailFromPath).toHaveBeenCalledWith("/staged/clip.mp4", {
      height: 64,
      width: 64,
    })
  })

  test("uses a bounded neutral file preview instead of the application icon", async () => {
    const fixture = adapter()
    const createIcon = createCanvasExternalMediaDragIconFactory({ adapter: fixture.adapter })

    const result = await createIcon({ file: "/staged/unpreviewable.bin", itemCount: 2 })

    expect((result as NativeImage).isEmpty()).toBeFalse()
    expect(fixture.adapter.createFromBitmap).toHaveBeenCalledWith(expect.any(Buffer), {
      height: 64,
      scaleFactor: 1,
      width: 64,
    })
    const bitmap = fixture.composedBitmap()
    expect(bitmap?.includes(Buffer.from([245, 245, 245, 255]))).toBeTrue()
    expect(bitmap?.includes(Buffer.from([220, 54, 73, 255]))).toBeTrue()
  })

  test("cancels while the operating-system thumbnail is pending", async () => {
    const pending = new Promise<NativeImage>(() => {})
    const fixture = adapter()
    fixture.adapter.createThumbnailFromPath = mock(() => pending)
    const createIcon = createCanvasExternalMediaDragIconFactory({
      adapter: fixture.adapter,
    })
    const controller = new AbortController()
    const creating = createIcon({ file: "/staged/clip.mp4", itemCount: 1, signal: controller.signal })

    controller.abort(new DOMException("Canceled", "AbortError"))
    await expect(creating).rejects.toMatchObject({ name: "AbortError" })
  })
})
