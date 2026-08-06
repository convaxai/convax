import { describe, expect, test } from "bun:test"
import { deriveCanvasCommandOperationId } from "./operation-id"

const input = {
  ref: { canvasId: "canvas-one", scopeId: "project-one" },
  actor: { kind: "renderer", id: "member-one/session-one" },
  commandId: "gesture-018f4f42",
} as const

describe("Canvas command operation identity v2", () => {
  test("is stable for one bound caller and changes across actor, scope, Canvas, or command", () => {
    const stable = deriveCanvasCommandOperationId(input)
    expect(deriveCanvasCommandOperationId(structuredClone(input))).toBe(stable)
    expect(stable).toBe("_hkBgZUibqHKRvCx0ONG4g")
    expect(stable).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(new Set([
      stable,
      deriveCanvasCommandOperationId({ ...input, commandId: "gesture-other" }),
      deriveCanvasCommandOperationId({ ...input, actor: { ...input.actor, id: "member-two/session-one" } }),
      deriveCanvasCommandOperationId({ ...input, actor: { ...input.actor, kind: "agent" } }),
      deriveCanvasCommandOperationId({ ...input, ref: { ...input.ref, canvasId: "canvas-two" } }),
      deriveCanvasCommandOperationId({ ...input, ref: { ...input.ref, scopeId: "project-two" } }),
    ]).size).toBe(6)
  })

  test("rejects empty, overlong, and non-NFC authority components", () => {
    for (const invalid of ["", "   ", "x".repeat(257), "e\u0301"]) {
      expect(() => deriveCanvasCommandOperationId({ ...input, commandId: invalid })).toThrow()
    }
    expect(() => deriveCanvasCommandOperationId({ ...input, actor: { ...input.actor, id: "" } })).toThrow()
    expect(() => deriveCanvasCommandOperationId({ ...input, actor: { ...input.actor, kind: "x".repeat(257) } })).toThrow()
    expect(() => deriveCanvasCommandOperationId({ ...input, ref: { ...input.ref, scopeId: "e\u0301" } })).toThrow()
  })
})
