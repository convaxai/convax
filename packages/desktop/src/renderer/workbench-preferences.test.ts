import { describe, expect, test } from "bun:test"
import {
  migrateLastCanvasPreference,
  readLastCanvasPreference,
  writeLastCanvasPreference,
} from "./workbench-preferences"

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

  test("moves a legacy project selection into user-side Workbench preferences", () => {
    const target = storage()
    expect(migrateLastCanvasPreference(target, "project-one", "canvas-legacy")).toBe("canvas-legacy")
    expect(readLastCanvasPreference(target, "project-one")).toBe("canvas-legacy")
  })

  test("keeps an existing user preference ahead of a legacy shared selection", () => {
    const target = storage()
    writeLastCanvasPreference(target, "project-one", "canvas-user")
    expect(migrateLastCanvasPreference(target, "project-one", "canvas-legacy")).toBe("canvas-user")
    expect(readLastCanvasPreference(target, "project-one")).toBe("canvas-user")
  })

  test("uses the legacy preference for this session when user storage cannot be written", () => {
    expect(migrateLastCanvasPreference(storage(null, true), "project-one", "canvas-legacy"))
      .toBe("canvas-legacy")
  })
})
