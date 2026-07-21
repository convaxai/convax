import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument } from "./document"
import { createCanvasSelectionActionContext } from "./selection-actions"
import {
  CanvasSelectionDragGestureController,
  CanvasSelectionDragPreparationController,
  getVisibleCanvasSelectionDragSource,
  type CanvasPreparedSelectionDrag,
  type CanvasSelectionDragSource,
} from "./selection-drag-source"

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

function context(controller = new AbortController()) {
  const document = createCanvasDocument({ id: "canvas-drag" })
  return createCanvasSelectionActionContext(document, [], [], controller.signal)
}

function selectedContext(nodeIds: readonly string[]) {
  const document = createCanvasDocument({ id: "canvas-drag" })
  return createCanvasSelectionActionContext(document, nodeIds, [], new AbortController().signal)
}

function source(
  prepare: CanvasSelectionDragSource["prepare"],
  visible: CanvasSelectionDragSource["visible"] = () => true,
): CanvasSelectionDragSource {
  return { id: "native-files", label: "Drag outside Convax", prepare, visible }
}

function prepared() {
  return {
    dispose: mock(() => undefined),
    start: mock(() => undefined),
  } satisfies CanvasPreparedSelectionDrag
}

describe("Canvas selection drag preparation", () => {
  test("fails closed when a host visibility predicate fails", () => {
    const current = context()
    expect(
      getVisibleCanvasSelectionDragSource(
        source(async () => prepared()),
        current,
      )?.id,
    ).toBe("native-files")
    expect(
      getVisibleCanvasSelectionDragSource(
        source(
          async () => prepared(),
          () => false,
        ),
        current,
      ),
    ).toBeNull()
    expect(
      getVisibleCanvasSelectionDragSource(
        source(
          async () => prepared(),
          () => {
            throw new Error("broken host predicate")
          },
        ),
        current,
      ),
    ).toBeNull()
  })

  test("disposes a stale async result and starts only the current prepared drag", async () => {
    const first = deferred<CanvasPreparedSelectionDrag>()
    const second = deferred<CanvasPreparedSelectionDrag>()
    const firstPrepared = prepared()
    const secondPrepared = prepared()
    const secondPrepare = mock(() => second.promise)
    const onExit = mock(() => undefined)
    const controller = new CanvasSelectionDragPreparationController({ onExit })

    controller.set(
      source(() => first.promise),
      context(),
    )
    controller.set(source(secondPrepare), context())
    first.resolve(firstPrepared)
    await Promise.resolve()

    expect(firstPrepared.dispose).toHaveBeenCalledTimes(1)
    expect(controller.status).toBe("preparing")

    second.resolve(secondPrepared)
    await Promise.resolve()
    expect(controller.status).toBe("ready")
    expect(controller.start()).toBeTrue()
    expect(secondPrepared.start).toHaveBeenCalledTimes(1)
    expect(secondPrepared.dispose).not.toHaveBeenCalled()
    expect(secondPrepare).toHaveBeenCalledTimes(1)
    expect(controller.status).toBe("unavailable")
    expect(onExit).toHaveBeenCalledWith("started")
  })

  test("aborts host preparation immediately when a held gesture is reset", async () => {
    const pending = deferred<CanvasPreparedSelectionDrag>()
    const latePrepared = prepared()
    let gestureSignal: AbortSignal | undefined
    const controller = new CanvasSelectionDragPreparationController()
    controller.set(
      source((current) => {
        gestureSignal = current.signal
        return pending.promise
      }),
      context(),
    )

    expect(gestureSignal?.aborted).toBeFalse()
    controller.reset()
    expect(gestureSignal?.aborted).toBeTrue()

    pending.resolve(latePrepared)
    await Promise.resolve()
    expect(latePrepared.dispose).toHaveBeenCalledTimes(1)
  })

  test("does not abort consumed host authority after a native drag starts", async () => {
    const currentPrepared = prepared()
    let gestureSignal: AbortSignal | undefined
    const controller = new CanvasSelectionDragPreparationController()
    controller.set(
      source(async (current) => {
        gestureSignal = current.signal
        return currentPrepared
      }),
      context(),
    )
    await Promise.resolve()

    expect(controller.start()).toBeTrue()
    expect(gestureSignal?.aborted).toBeFalse()
  })

  test("aborts and disposes ready or pending preparations when the context becomes stale", async () => {
    const readyAbort = new AbortController()
    const readyPrepared = prepared()
    const controller = new CanvasSelectionDragPreparationController()
    controller.set(
      source(async () => readyPrepared),
      context(readyAbort),
    )
    await Promise.resolve()
    expect(controller.status).toBe("ready")

    readyAbort.abort()
    expect(controller.status).toBe("unavailable")
    expect(readyPrepared.dispose).toHaveBeenCalledTimes(1)

    const pendingAbort = new AbortController()
    const pending = deferred<CanvasPreparedSelectionDrag>()
    const latePrepared = prepared()
    controller.set(
      source(() => pending.promise),
      context(pendingAbort),
    )
    pendingAbort.abort()
    pending.resolve(latePrepared)
    await Promise.resolve()

    expect(latePrepared.dispose).toHaveBeenCalledTimes(1)
    expect(controller.start()).toBeFalse()
  })

  test("isolates current preparation failures and keeps the drag unavailable", async () => {
    const onError = mock(() => undefined)
    const onExit = mock(() => undefined)
    const controller = new CanvasSelectionDragPreparationController({ onError, onExit })
    const failure = new Error("prepare failed")
    controller.set(
      source(() => Promise.reject(failure)),
      context(),
    )
    await Promise.resolve()

    expect(controller.status).toBe("unavailable")
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ id: "native-files" }), failure)
    expect(onExit).toHaveBeenCalledWith("failed")
    expect(controller.start()).toBeFalse()
  })

  test("disposes host authority that is already expired", async () => {
    const onExit = mock(() => undefined)
    const expired = {
      ...prepared(),
      expiresAt: Date.now() - 1,
    }
    const controller = new CanvasSelectionDragPreparationController({ onExit })

    controller.set(
      source(async () => expired),
      context(),
    )
    await Promise.resolve()

    expect(expired.dispose).toHaveBeenCalledTimes(1)
    expect(expired.start).not.toHaveBeenCalled()
    expect(controller.status).toBe("unavailable")
    expect(controller.start()).toBeFalse()
    expect(onExit).toHaveBeenCalledWith("expired")
  })

  test("rechecks host authority synchronously before starting", async () => {
    const onExit = mock(() => undefined)
    const expiring = {
      ...prepared(),
      expiresAt: Date.now() + 60_000,
    }
    const controller = new CanvasSelectionDragPreparationController({ onExit })
    controller.set(
      source(async () => expiring),
      context(),
    )
    await Promise.resolve()
    expect(controller.status).toBe("ready")

    expiring.expiresAt = Date.now() - 1
    expect(controller.start()).toBeFalse()

    expect(expiring.dispose).toHaveBeenCalledTimes(1)
    expect(expiring.start).not.toHaveBeenCalled()
    expect(onExit).toHaveBeenCalledWith("expired")
  })
})

describe("Canvas selection drag held gesture", () => {
  test("holds before selection and prepares a newly eligible selection once", async () => {
    const currentPrepared = prepared()
    const prepare = mock(async () => currentPrepared)
    const currentSource = source(prepare, (current) => current.selectedNodeIds.length > 0)
    const emptyContext = context()
    const newlySelectedContext = selectedContext(["node-a"])
    const controller = new CanvasSelectionDragGestureController()

    expect(controller.hold(currentSource, emptyContext)).toBeTrue()
    expect(controller.held).toBeTrue()
    expect(controller.consumed).toBeFalse()
    expect(controller.status).toBe("unavailable")
    expect(prepare).not.toHaveBeenCalled()

    expect(controller.reconcile(currentSource, newlySelectedContext)).toBeTrue()
    expect(controller.reconcile(currentSource, newlySelectedContext)).toBeFalse()
    await Promise.resolve()

    expect(prepare).toHaveBeenCalledTimes(1)
    expect(controller.status).toBe("ready")
  })

  test("selection changes cancel stale work and prepare the replacement", async () => {
    const first = deferred<CanvasPreparedSelectionDrag>()
    const second = deferred<CanvasPreparedSelectionDrag>()
    const firstPrepared = prepared()
    const secondPrepared = prepared()
    let firstSignal: AbortSignal | undefined
    const firstPrepare = mock((current: ReturnType<typeof context>) => {
      firstSignal = current.signal
      return first.promise
    })
    const secondPrepare = mock(() => second.promise)
    const currentSource = source((current) =>
      current.selectedNodeIds.includes("node-a") ? firstPrepare(current) : secondPrepare(),
    )
    const controller = new CanvasSelectionDragGestureController()

    controller.hold(currentSource, selectedContext(["node-a"]))
    expect(firstSignal?.aborted).toBeFalse()
    controller.reconcile(currentSource, selectedContext(["node-b", "node-c"]))
    expect(firstSignal?.aborted).toBeTrue()

    first.resolve(firstPrepared)
    second.resolve(secondPrepared)
    await Promise.resolve()

    expect(firstPrepared.dispose).toHaveBeenCalledTimes(1)
    expect(secondPrepare).toHaveBeenCalledTimes(1)
    expect(controller.status).toBe("ready")
  })

  test("keeps the shortcut held after preparation failure and expiry", async () => {
    const failure = new Error("prepare failed")
    const failedPrepare = mock(() => Promise.reject(failure))
    const expiredPrepared = {
      ...prepared(),
      expiresAt: Date.now() - 1,
    }
    const expiredPrepare = mock(async () => expiredPrepared)
    const onExit = mock(() => undefined)
    const controller = new CanvasSelectionDragGestureController({ onExit })
    const failedSource = source(failedPrepare)
    const failedContext = context()

    controller.hold(failedSource, failedContext)
    await Promise.resolve()
    expect(controller.held).toBeTrue()
    expect(controller.consumed).toBeFalse()
    expect(controller.status).toBe("unavailable")
    expect(controller.reconcile(failedSource, failedContext)).toBeFalse()
    expect(failedPrepare).toHaveBeenCalledTimes(1)

    controller.reconcile(source(expiredPrepare), context())
    await Promise.resolve()
    expect(expiredPrepared.dispose).toHaveBeenCalledTimes(1)
    expect(controller.held).toBeTrue()
    expect(controller.consumed).toBeFalse()
    expect(controller.status).toBe("unavailable")
    expect(onExit).toHaveBeenCalledWith("failed")
    expect(onExit).toHaveBeenCalledWith("expired")
  })

  test("consumes one native drag and will not reprepare until release", async () => {
    const firstPrepared = prepared()
    const nextPrepared = prepared()
    const firstPrepare = mock(async () => firstPrepared)
    const nextPrepare = mock(async () => nextPrepared)
    const firstSource = source(firstPrepare)
    const nextSource = source(nextPrepare)
    const controller = new CanvasSelectionDragGestureController()

    controller.hold(firstSource, context())
    await Promise.resolve()
    expect(controller.start()).toBeTrue()
    expect(controller.start()).toBeFalse()
    expect(firstPrepared.start).toHaveBeenCalledTimes(1)
    expect(controller.held).toBeTrue()
    expect(controller.consumed).toBeTrue()

    expect(controller.reconcile(nextSource, context())).toBeFalse()
    await Promise.resolve()
    expect(nextPrepare).not.toHaveBeenCalled()

    expect(controller.release()).toBeTrue()
    expect(controller.held).toBeFalse()
    expect(controller.consumed).toBeFalse()
    expect(controller.hold(nextSource, context())).toBeTrue()
    await Promise.resolve()
    expect(nextPrepare).toHaveBeenCalledTimes(1)
    expect(controller.status).toBe("ready")
  })

  test("restarts a persistent held mode after a consumed native drag", async () => {
    const firstPrepared = prepared()
    const nextPrepared = prepared()
    const prepare = mock(async () => (prepare.mock.calls.length === 1 ? firstPrepared : nextPrepared))
    const currentSource = source(prepare)
    const currentContext = context()
    const controller = new CanvasSelectionDragGestureController()

    controller.hold(currentSource, currentContext)
    await Promise.resolve()
    expect(controller.start()).toBeTrue()
    expect(controller.consumed).toBeTrue()

    expect(controller.restart(currentSource, currentContext)).toBeTrue()
    await Promise.resolve()
    expect(controller.held).toBeTrue()
    expect(controller.consumed).toBeFalse()
    expect(controller.status).toBe("ready")
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(nextPrepared.start).not.toHaveBeenCalled()
  })

  test("release aborts pending preparation and disposes its late result", async () => {
    const pending = deferred<CanvasPreparedSelectionDrag>()
    const latePrepared = prepared()
    let gestureSignal: AbortSignal | undefined
    const controller = new CanvasSelectionDragGestureController()
    controller.hold(
      source((current) => {
        gestureSignal = current.signal
        return pending.promise
      }),
      context(),
    )

    expect(gestureSignal?.aborted).toBeFalse()
    expect(controller.release()).toBeTrue()
    expect(gestureSignal?.aborted).toBeTrue()
    expect(controller.status).toBe("unavailable")

    pending.resolve(latePrepared)
    await Promise.resolve()
    expect(latePrepared.dispose).toHaveBeenCalledTimes(1)
    expect(controller.start()).toBeFalse()
  })
})
