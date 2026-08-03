import { describe, expect, mock, test } from "bun:test"
import {
  shouldMountResizeHandle,
  startCapturedPointerDrag,
  type CapturedPointerDragClock,
  type CapturedPointerTarget,
} from "./captured-pointer-drag"

class TestPointerTarget extends EventTarget implements CapturedPointerTarget {
  readonly captured = new Set<number>()

  hasPointerCapture(pointerId: number) {
    return this.captured.has(pointerId)
  }

  releasePointerCapture(pointerId: number) {
    this.captured.delete(pointerId)
  }

  setPointerCapture(pointerId: number) {
    this.captured.add(pointerId)
  }
}

class FailingPointerTarget extends TestPointerTarget {
  override setPointerCapture(_pointerId: number) {
    throw new Error("Pointer capture is unavailable")
  }
}

function pointerEvent(type: string, pointerId: number, clientX = 0) {
  const event = new Event(type, { cancelable: true })
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: pointerId },
  })
  return event
}

function testClock() {
  let sequence = 0
  const frames: Array<{ callback(): void; canceled: boolean; id: number }> = []
  const clock: CapturedPointerDragClock = {
    cancelFrame(frameId) {
      const frame = frames.find((candidate) => candidate.id === frameId)
      if (frame) frame.canceled = true
    },
    requestFrame(callback) {
      const frame = { callback, canceled: false, id: ++sequence }
      frames.push(frame)
      return frame.id
    },
  }
  const run = (frame: (typeof frames)[number]) => {
    if (!frame.canceled) frame.callback()
  }
  return { clock, frames, run }
}

describe("captured pointer drag", () => {
  test("wires Workbench resizing to the stable WorkspaceShell capture target", async () => {
    const source = await Bun.file(new URL("./index.tsx", import.meta.url)).text()
    const start = source.indexOf("const startWorkbenchPartResize")
    const end = source.indexOf("const primarySidebar", start)
    const resizeWiring = source.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(resizeWiring).toContain("const captureTarget = workspaceShellRef.current")
    expect(resizeWiring).toMatch(/startCapturedPointerDrag\(\{[\s\S]*?captureTarget,/)
    expect(resizeWiring).toContain('presentation.utilityPresentation === "dock"')
    expect(resizeWiring).toContain("suppressClickAfterCommit: true")
  })

  test("retains a resize handle after the part crosses its collapse threshold", () => {
    expect(shouldMountResizeHandle(false, true)).toBeTrue()
    expect(shouldMountResizeHandle(false, false)).toBeFalse()
  })

  test("commits a window-owned drag without requiring pointer capture", () => {
    const source = new EventTarget()
    const updates: number[] = []
    const commit = mock(() => undefined)
    const cancel = mock(() => undefined)
    const { clock } = testClock()

    const session = startCapturedPointerDrag({
      cancel,
      clock,
      commit,
      eventSource: source,
      pointerId: 2,
      update: (clientX) => updates.push(clientX),
    })

    expect(session).not.toBeNull()
    source.dispatchEvent(pointerEvent("pointerup", 2, 96))
    expect(updates).toEqual([96])
    expect(commit).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()
  })

  test("swallows the committed pointer click before it can reach newly exposed Canvas content", () => {
    const source = new EventTarget()
    const leakedClick = mock(() => undefined)
    const { clock } = testClock()

    startCapturedPointerDrag({
      cancel: () => undefined,
      clock,
      commit: () => undefined,
      eventSource: source,
      pointerId: 2,
      suppressClickAfterCommit: true,
      update: () => undefined,
    })
    source.dispatchEvent(pointerEvent("pointerup", 2, 96))
    source.addEventListener("click", leakedClick)
    const click = pointerEvent("click", 2, 96)

    expect(source.dispatchEvent(click)).toBeFalse()
    expect(click.defaultPrevented).toBeTrue()
    expect(leakedClick).not.toHaveBeenCalled()
  })

  test("filters pointer ids, coalesces moves, and flushes the exact release before commit", () => {
    const source = new EventTarget()
    const captureTarget = new TestPointerTarget()
    const updates: number[] = []
    const commit = mock(() => undefined)
    const cancel = mock(() => undefined)
    const settled = mock(() => undefined)
    const { clock, frames, run } = testClock()

    const session = startCapturedPointerDrag({
      cancel,
      captureTarget,
      clock,
      commit,
      eventSource: source,
      onSettled: settled,
      pointerId: 7,
      update: (clientX) => updates.push(clientX),
    })

    expect(session).not.toBeNull()
    expect(captureTarget.hasPointerCapture(7)).toBeTrue()
    source.dispatchEvent(pointerEvent("pointermove", 8, 90))
    source.dispatchEvent(pointerEvent("pointermove", 7, 120))
    source.dispatchEvent(pointerEvent("pointermove", 7, 140))
    expect(frames).toHaveLength(1)
    expect(updates).toEqual([])
    run(frames[0])
    expect(updates).toEqual([140])

    source.dispatchEvent(pointerEvent("pointerup", 8, 150))
    expect(commit).not.toHaveBeenCalled()
    source.dispatchEvent(pointerEvent("pointermove", 7, 160))
    source.dispatchEvent(pointerEvent("pointerup", 7, 180))

    expect(updates).toEqual([140, 180])
    expect(frames[1]?.canceled).toBeTrue()
    expect(commit).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()
    expect(settled).toHaveBeenCalledTimes(1)
    expect(captureTarget.hasPointerCapture(7)).toBeFalse()
  })

  test("cancels on the owning pointer cancellation, lost capture, blur, and explicit disposal", () => {
    for (const reason of ["pointercancel", "lostpointercapture", "blur", "dispose"] as const) {
      const source = new EventTarget()
      const captureTarget = new TestPointerTarget()
      const cancel = mock(() => undefined)
      const commit = mock(() => undefined)
      const { clock, frames } = testClock()
      const session = startCapturedPointerDrag({
        cancel,
        captureTarget,
        clock,
        commit,
        eventSource: source,
        pointerId: 3,
        update: () => undefined,
      })
      source.dispatchEvent(pointerEvent("pointermove", 3, 200))
      if (reason === "pointercancel") {
        source.dispatchEvent(pointerEvent(reason, 4))
        expect(cancel).not.toHaveBeenCalled()
        source.dispatchEvent(pointerEvent(reason, 3))
      } else if (reason === "lostpointercapture") {
        captureTarget.dispatchEvent(pointerEvent(reason, 4))
        expect(cancel).not.toHaveBeenCalled()
        captureTarget.dispatchEvent(pointerEvent(reason, 3))
      }
      else if (reason === "blur") source.dispatchEvent(new Event(reason))
      else session?.cancel()

      expect(cancel).toHaveBeenCalledTimes(1)
      expect(commit).not.toHaveBeenCalled()
      expect(frames[0]?.canceled).toBeTrue()
      expect(captureTarget.hasPointerCapture(3)).toBeFalse()
    }
  })

  test("fails closed and detaches listeners when pointer capture cannot be acquired", () => {
    const source = new EventTarget()
    const cancel = mock(() => undefined)
    const commit = mock(() => undefined)
    const update = mock(() => undefined)

    const session = startCapturedPointerDrag({
      cancel,
      captureTarget: new FailingPointerTarget(),
      commit,
      eventSource: source,
      pointerId: 5,
      update,
    })
    source.dispatchEvent(pointerEvent("pointermove", 5, 100))
    source.dispatchEvent(pointerEvent("pointerup", 5, 120))

    expect(session).toBeNull()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
  })
})
