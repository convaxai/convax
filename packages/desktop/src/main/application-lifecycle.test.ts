import { describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import {
  createDemandDrivenAsyncLifecycle,
  createDetachedAsyncCallback,
  createIdempotentAsyncCleanup,
  registerMainWindowActivation,
  registerWillQuitCleanup,
} from "./application-lifecycle"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe("createDetachedAsyncCallback", () => {
  test("returns before a queued mutation settles and contains async or synchronous failure", async () => {
    const pending = deferred()
    const errors: unknown[] = []
    const operation = mock(() => pending.promise)
    const detached = createDetachedAsyncCallback(operation, (error) => errors.push(error))

    expect(detached()).toBeUndefined()
    expect(operation).toHaveBeenCalledTimes(1)
    let settled = false
    void pending.promise.then(() => {
      settled = true
    })
    expect(settled).toBeFalse()
    pending.resolve()
    await pending.promise

    const asyncFailure = createDetachedAsyncCallback(
      () => Promise.reject(new Error("async failed")),
      (error) => errors.push(error),
    )
    const syncFailure = createDetachedAsyncCallback(
      () => {
        throw new Error("sync failed")
      },
      (error) => errors.push(error),
    )
    expect(asyncFailure()).toBeUndefined()
    expect(syncFailure()).toBeUndefined()
    await Promise.resolve()
    expect(errors.map((error) => (error as Error).message)).toEqual(["sync failed", "async failed"])
  })
})

describe("createDemandDrivenAsyncLifecycle", () => {
  test("starts once for the first lease and stops on the last idempotent release", async () => {
    const start = mock(async () => undefined)
    const stop = mock(() => undefined)
    const lifecycle = createDemandDrivenAsyncLifecycle({ start, stop })

    const releaseFirst = lifecycle.acquire()
    const releaseSecond = lifecycle.acquire()
    await Promise.resolve()
    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).not.toHaveBeenCalled()

    releaseFirst()
    expect(stop).not.toHaveBeenCalled()
    releaseSecond()
    releaseSecond()
    expect(stop).toHaveBeenCalledTimes(1)
    await lifecycle.dispose()
  })

  test("serializes a fast release and reacquire behind an in-flight start", async () => {
    const first = deferred()
    const secondStarted = deferred()
    const order: string[] = []
    let starts = 0
    const lifecycle = createDemandDrivenAsyncLifecycle({
      async start() {
        starts += 1
        order.push(`start:${starts}`)
        if (starts === 1) await first.promise
        else secondStarted.resolve()
      },
      stop() {
        order.push("stop")
      },
    })
    const releaseFirst = lifecycle.acquire()
    await Promise.resolve()
    releaseFirst()
    const releaseSecond = lifecycle.acquire()

    first.resolve()
    await secondStarted.promise
    expect(starts).toBe(2)
    expect(order).toEqual(["start:1", "stop", "stop", "start:2"])
    releaseSecond()
    await lifecycle.dispose()
  })

  test("contains lifecycle errors, drains pending start on dispose, and rejects later leases", async () => {
    const pending = deferred()
    const errors: unknown[] = []
    const stop = mock(() => undefined)
    const lifecycle = createDemandDrivenAsyncLifecycle({
      onError: (error) => errors.push(error),
      start: () => pending.promise,
      stop,
    })
    lifecycle.acquire()
    await Promise.resolve()

    let disposed = false
    const disposal = lifecycle.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBeFalse()
    expect(stop).toHaveBeenCalled()
    pending.resolve()
    await disposal
    expect(disposed).toBeTrue()
    expect(() => lifecycle.acquire()).toThrow("disposed")

    const failing = createDemandDrivenAsyncLifecycle({
      onError: (error) => errors.push(error),
      start: () => {
        throw new Error("start failed")
      },
      stop: () => {
        throw new Error("stop failed")
      },
    })
    const release = failing.acquire()
    await Promise.resolve()
    release()
    await failing.dispose()
    expect(errors.map((error) => (error as Error).message)).toEqual([
      "start failed",
      "stop failed",
      "stop failed",
      "stop failed",
    ])
  })
})

describe("createIdempotentAsyncCleanup", () => {
  test("runs ownership cleanup sequentially once across shutdown paths", async () => {
    const order: string[] = []
    const cleanup = createIdempotentAsyncCleanup([
      () => order.push("activity.stop"),
      async () => {
        await Promise.resolve()
        order.push("ipc.dispose")
      },
      () => order.push("window.dispose"),
    ])

    await Promise.all([cleanup(), cleanup()])
    expect(order).toEqual(["activity.stop", "ipc.dispose", "window.dispose"])
    await cleanup()
    expect(order).toHaveLength(3)
  })
})

describe("registerWillQuitCleanup", () => {
  test("uses one listener to run every cleanup once in registration order", () => {
    const application = new EventEmitter()
    const calls: number[] = []
    const errors: Array<{ error: unknown; index: number }> = []

    registerWillQuitCleanup(
      application,
      Array.from({ length: 11 }, (_, index) => () => {
        calls.push(index)
        if (index === 5) throw new Error("cleanup failed")
      }),
      (error, index) => errors.push({ error, index }),
    )

    expect(application.listenerCount("will-quit")).toBe(1)
    application.emit("will-quit")
    application.emit("will-quit")
    expect(calls).toEqual(Array.from({ length: 11 }, (_, index) => index))
    expect(errors).toEqual([{ error: new Error("cleanup failed"), index: 5 }])
  })
})

describe("registerMainWindowActivation", () => {
  test("recreates a missing main window even when another pet window exists", () => {
    const application = new EventEmitter()
    const createMainWindow = mock(() => ({ isDestroyed: () => false }))
    let mainWindow: { isDestroyed(): boolean } | null = null
    const petWindow = { isDestroyed: () => false }
    expect(petWindow.isDestroyed()).toBe(false)

    registerMainWindowActivation(
      application,
      () => mainWindow,
      () => {
        mainWindow = createMainWindow()
      },
    )
    application.emit("activate")
    expect(createMainWindow).toHaveBeenCalledTimes(1)
    application.emit("activate")
    expect(createMainWindow).toHaveBeenCalledTimes(1)

    mainWindow = null
    application.emit("activate")
    expect(createMainWindow).toHaveBeenCalledTimes(2)
  })
})
