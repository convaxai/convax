import { describe, expect, test } from "bun:test"
import { UnsupportedLegacyCanvasPersistenceError, type CanvasDocumentRef } from "./persistence"

describe("Canvas collaboration persistence boundary", () => {
  test("exports only a host-neutral shard reference", () => {
    const ref: CanvasDocumentRef = { canvasId: "canvas", scopeId: "project" }
    expect(ref).toEqual({ canvasId: "canvas", scopeId: "project" })
    expect(ref).not.toHaveProperty("revision")
    expect(ref).not.toHaveProperty("storageVersion")
  })

  test("requires Project-owned explicit reset for legacy JSON bytes", () => {
    const error = new UnsupportedLegacyCanvasPersistenceError()
    expect(error.name).toBe("UnsupportedLegacyCanvasPersistenceError")
    expect(error.message).toContain("explicit Project reset")
  })
})
