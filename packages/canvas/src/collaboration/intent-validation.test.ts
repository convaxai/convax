import { describe, expect, test } from "bun:test"
import { encodeRestrictedJcs } from "@convax/collaboration"
import { assertCanvasTypedIntent, CANVAS_INTENT_KINDS, decodeCanvasTypedIntent } from "./intent-validation"
import { applyCanvasCandidateIntent } from "./reducer"
import type { CanvasTypedIntentUnion } from "./types"
import { derivedNodeRef } from "./validation"
import { encodeCanvasCanonicalState } from "./ydoc"
import { context, newCanvas, U0, VALID_FACTS } from "./test-fixtures.test"

describe("Canvas v2 closed typed-intent admission", () => {
  test("closes all 25 discriminators and rejects document replacement/version/raw Yjs fields", () => {
    expect(CANVAS_INTENT_KINDS).toHaveLength(25)
    const intent = nodeCreateIntent()
    expect(() => assertCanvasTypedIntent(intent)).not.toThrow()
    expect(decodeCanvasTypedIntent(encodeRestrictedJcs(intent))).toEqual(intent)

    for (const extra of [
      { document: {} },
      { revision: "7" },
      { expectedDocumentVersion: "7" },
      { rawYjsUpdate: "AA" },
      { viewport: { x: 0, y: 0, zoom: 1 } },
      { selection: [] },
    ])
      expect(() => assertCanvasTypedIntent({ ...intent, ...extra })).toThrow()
    expect(() => assertCanvasTypedIntent({ ...intent, format: "convax.typed-intent/1" })).toThrow()
    expect(() => assertCanvasTypedIntent({ ...intent, kind: "canvas.nodes.delete" })).toThrow()
  })

  test("rejects nested field tampering before candidate mutation", () => {
    const document = newCanvas()
    const before = encodeCanvasCanonicalState(document)
    const intent = nodeCreateIntent() as CanvasTypedIntentUnion & { body: { node: Record<string, unknown> } }
    intent.body.node.measured = { width: 99, height: 99 }
    expect(() => assertCanvasTypedIntent(intent)).toThrow()
    expect(encodeCanvasCanonicalState(document)).toEqual(before)
  })

  test("a stale derived guard rejects without any logical write", () => {
    const document = newCanvas()
    const before = encodeCanvasCanonicalState(document)
    const valid = nodeCreateIntent()
    const stale = {
      ...valid,
      guard: { ...valid.guard, node: derivedNodeRef(context(9, 9, 9), U0) },
    } as CanvasTypedIntentUnion
    expect(applyCanvasCandidateIntent(document, context(1, 1, 1), stale, VALID_FACTS)).toBe("rejected")
    expect(encodeCanvasCanonicalState(document)).toEqual(before)
  })
})

function nodeCreateIntent(): Extract<CanvasTypedIntentUnion, { kind: "canvas.agent.create" }> {
  const operationContext = context(1, 1, 1)
  const node = derivedNodeRef(operationContext, U0)
  return {
    format: "convax.typed-intent",
    kind: "canvas.agent.create",
    guard: { ordinal: U0, node, expectedAbsent: true },
    body: {
      node: {
        ordinal: U0,
        nodeId: node.id,
        incarnation: node.incarnation,
        role: "agent",
        position: { x: 1, y: 2 },
        size: { width: 240, height: 120 },
        data: { format: "convax.canvas-node-data", kind: "agent", title: "A", instructions: null },
        plugin: null,
      },
    },
  }
}
