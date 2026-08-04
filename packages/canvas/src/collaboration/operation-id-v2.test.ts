import { describe, expect, test } from "bun:test"
import { deriveCanvasCommandOperationIdV2 } from "./operation-id"

const input = {
  ref: { canvasId: "canvas-one", scopeId: "project-one" },
  actor: { kind: "renderer", id: "member-one/session-one" },
  commandId: "gesture-018f4f42",
} as const

describe("Canvas command operation identity v2", () => {
  test("is stable for one bound caller and changes across actor, scope, Canvas, or command", () => {
    const stable = deriveCanvasCommandOperationIdV2(input)
    expect(deriveCanvasCommandOperationIdV2(structuredClone(input))).toBe(stable)
    expect(stable).toBe("PWZOjk3uiiUs5PmfuO-ogg")
    expect(stable).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(new Set([
      stable,
      deriveCanvasCommandOperationIdV2({ ...input, commandId: "gesture-other" }),
      deriveCanvasCommandOperationIdV2({ ...input, actor: { ...input.actor, id: "member-two/session-one" } }),
      deriveCanvasCommandOperationIdV2({ ...input, actor: { ...input.actor, kind: "agent" } }),
      deriveCanvasCommandOperationIdV2({ ...input, ref: { ...input.ref, canvasId: "canvas-two" } }),
      deriveCanvasCommandOperationIdV2({ ...input, ref: { ...input.ref, scopeId: "project-two" } }),
    ]).size).toBe(6)
  })

  test("rejects empty, overlong, and non-NFC authority components", () => {
    for (const invalid of ["", "   ", "x".repeat(257), "e\u0301"]) {
      expect(() => deriveCanvasCommandOperationIdV2({ ...input, commandId: invalid })).toThrow()
    }
    expect(() => deriveCanvasCommandOperationIdV2({ ...input, actor: { ...input.actor, id: "" } })).toThrow()
    expect(() => deriveCanvasCommandOperationIdV2({ ...input, actor: { ...input.actor, kind: "x".repeat(257) } })).toThrow()
    expect(() => deriveCanvasCommandOperationIdV2({ ...input, ref: { ...input.ref, scopeId: "e\u0301" } })).toThrow()
  })
})
