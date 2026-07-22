import { describe, expect, test } from "bun:test"
import { canvasRendererChannels, sameCanvasDocumentRef } from "./canvas-renderer-contracts"

const ref = { canvasId: "canvas-1", scopeId: "project-1" }

describe("Canvas renderer contracts", () => {
  test("matches document references by both scope and Canvas id", () => {
    expect(sameCanvasDocumentRef(ref, { ...ref })).toBe(true)
    expect(sameCanvasDocumentRef(ref, { ...ref, canvasId: "canvas-2" })).toBe(false)
    expect(sameCanvasDocumentRef(ref, { ...ref, scopeId: "project-2" })).toBe(false)
  })

  test("keeps the renderer bridge scoped to projection requests", () => {
    expect(canvasRendererChannels).toEqual({
      request: "canvas:renderer-request",
      response: "canvas:renderer-response",
    })
  })
})
