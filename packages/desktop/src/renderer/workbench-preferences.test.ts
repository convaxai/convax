import { describe, expect, test } from "bun:test"
import { readLastCanvasPreference, writeLastCanvasPreference } from "./workbench-preferences"

function storage(initial: string | null = null, failWrites = false) {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      if (failWrites) throw new Error("quota")
      value = next
    },
  }
}

describe("Workbench Canvas preferences", () => {
  test("keeps each Project's last Canvas in user-side storage", () => {
    const target = storage()
    expect(writeLastCanvasPreference(target, "project-one", "canvas-one")).toBe(true)
    expect(writeLastCanvasPreference(target, "project-two", "canvas-two")).toBe(true)
    expect(readLastCanvasPreference(target, "project-one")).toBe("canvas-one")
    expect(readLastCanvasPreference(target, "project-two")).toBe("canvas-two")
  })

  test("recovers from malformed preferences and storage write failures", () => {
    const malformed = storage("not-json")
    expect(readLastCanvasPreference(malformed, "project-one")).toBeUndefined()
    expect(writeLastCanvasPreference(malformed, "project-one", "canvas-one")).toBe(true)
    expect(writeLastCanvasPreference(storage(null, true), "project-one", "canvas-one")).toBe(false)
  })
})
