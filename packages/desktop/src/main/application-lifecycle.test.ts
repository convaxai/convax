import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { registerWillQuitCleanup } from "./application-lifecycle"

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
