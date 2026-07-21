import { describe, expect, test } from "bun:test"
import {
  matchesCanvasDocumentMutationResult,
  sameCanvasDocumentRef,
  type CanvasDocumentMutationPrepareRequest,
} from "./canvas-renderer-contracts"

const ref = { canvasId: "canvas-1", scopeId: "project-1" }

describe("Canvas renderer contracts", () => {
  test("matches document references by both scope and Canvas id", () => {
    expect(sameCanvasDocumentRef(ref, { ...ref })).toBe(true)
    expect(sameCanvasDocumentRef(ref, { ...ref, canvasId: "canvas-2" })).toBe(false)
    expect(sameCanvasDocumentRef(ref, { ...ref, scopeId: "project-2" })).toBe(false)
  })

  test("binds a mutation result to its exact request kind, lease, and document ref", () => {
    const request: CanvasDocumentMutationPrepareRequest = {
      leaseId: "lease-1",
      ref,
      type: "document.mutation.prepare",
    }
    const result = {
      leaseId: request.leaseId,
      prepared: true,
      ref: { ...ref },
      type: request.type,
    } as const

    expect(matchesCanvasDocumentMutationResult(request, result)).toBe(true)
    expect(matchesCanvasDocumentMutationResult(request, { ...result, leaseId: "lease-2" })).toBe(false)
    expect(
      matchesCanvasDocumentMutationResult(request, {
        ...result,
        ref: { ...result.ref, canvasId: "canvas-2" },
      }),
    ).toBe(false)
    expect(
      matchesCanvasDocumentMutationResult(request, {
        finished: true,
        leaseId: request.leaseId,
        ref,
        type: "document.mutation.finish",
      }),
    ).toBe(false)
  })
})
