import { describe, expect, mock, test } from "bun:test"
import {
  scheduleCutoutTransitionAfterPaint,
  type CutoutTransitionFrameScheduler,
  type CutoutTransitionImage,
} from "./cutout-transition"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createFrameScheduler() {
  let nextFrameId = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  const cancelled: number[] = []
  const scheduler: CutoutTransitionFrameScheduler = {
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
  const runNextFrame = (time: number) => {
    const entry = callbacks.entries().next().value
    if (!entry) throw new Error("Expected a scheduled animation frame")
    callbacks.delete(entry[0])
    entry[1](time)
  }
  return { callbacks, cancelled, runNextFrame, scheduler }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe("cutout transition paint scheduling", () => {
  test("keeps the source visible until both images decode and one shielded frame paints", async () => {
    const sourceDecode = deferred()
    const resultDecode = deferred()
    const sourceImage: CutoutTransitionImage = {
      complete: true,
      decode: () => sourceDecode.promise,
      naturalWidth: 640,
    }
    const resultImage: CutoutTransitionImage = {
      complete: true,
      decode: () => resultDecode.promise,
      naturalWidth: 640,
    }
    const frames = createFrameScheduler()
    const onReady = mock(() => undefined)

    scheduleCutoutTransitionAfterPaint({
      onReady,
      resultImage,
      scheduler: frames.scheduler,
      sourceImage,
    })

    sourceDecode.resolve()
    await flushPromises()
    expect(frames.callbacks.size).toBe(0)
    resultDecode.resolve()
    await flushPromises()
    expect(frames.callbacks.size).toBe(1)

    frames.runNextFrame(16)
    expect(onReady).not.toHaveBeenCalled()
    expect(frames.callbacks.size).toBe(1)
    frames.runNextFrame(32)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  test("cancels stale paint readiness before it can start a dissolve", async () => {
    const image: CutoutTransitionImage = {
      complete: true,
      decode: async () => undefined,
      naturalWidth: 640,
    }
    const frames = createFrameScheduler()
    const onReady = mock(() => undefined)
    const cancel = scheduleCutoutTransitionAfterPaint({
      onReady,
      resultImage: image,
      scheduler: frames.scheduler,
      sourceImage: image,
    })

    await flushPromises()
    expect(frames.callbacks.size).toBe(1)
    cancel()
    expect(frames.callbacks.size).toBe(0)
    expect(frames.cancelled).toEqual([1])
    expect(onReady).not.toHaveBeenCalled()
  })
})
