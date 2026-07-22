import { describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import {
  createIdempotentAsyncCleanup,
  registerMainWindowActivation,
  registerWillQuitCleanup,
} from "./application-lifecycle"

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
