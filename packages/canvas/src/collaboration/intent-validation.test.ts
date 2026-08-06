import { describe, expect, test } from "bun:test"
import { encodeRestrictedJcs } from "@convax/collaboration"
import { assertCanvasTypedIntentV2, CANVAS_INTENT_KINDS_V2, decodeCanvasTypedIntentV2 } from "./intent-validation"
import { applyCanvasCandidateIntentV2 } from "./reducer"
import type { CanvasTypedIntentUnionV2 } from "./types"
import { derivedNodeRefV2 } from "./validation"
import { encodeCanvasCanonicalStateV2 } from "./ydoc"
import { context, newCanvas, U0, VALID_FACTS } from "./test-fixtures.test"

describe("Canvas v2 closed typed-intent admission", () => {
  test("closes all 23 discriminators and rejects document replacement/version/raw Yjs fields", () => {
    expect(CANVAS_INTENT_KINDS_V2).toHaveLength(23)
    const intent = nodeCreateIntent()
    expect(() => assertCanvasTypedIntentV2(intent)).not.toThrow()
    expect(decodeCanvasTypedIntentV2(encodeRestrictedJcs(intent))).toEqual(intent)

    for (const extra of [
      { document: {} },
      { revision: "7" },
      { expectedDocumentVersion: "7" },
      { rawYjsUpdate: "AA" },
      { viewport: { x: 0, y: 0, zoom: 1 } },
      { selection: [] },
    ])
      expect(() => assertCanvasTypedIntentV2({ ...intent, ...extra })).toThrow()
    expect(() => assertCanvasTypedIntentV2({ ...intent, format: "convax.typed-intent/1" })).toThrow()
    expect(() => assertCanvasTypedIntentV2({ ...intent, kind: "canvas.nodes.delete/2" })).toThrow()
  })

  test("rejects nested field tampering before candidate mutation", () => {
    const document = newCanvas()
    const before = encodeCanvasCanonicalStateV2(document)
    const intent = nodeCreateIntent() as CanvasTypedIntentUnionV2 & { body: { node: Record<string, unknown> } }
    intent.body.node.measured = { width: 99, height: 99 }
    expect(() => assertCanvasTypedIntentV2(intent)).toThrow()
    expect(encodeCanvasCanonicalStateV2(document)).toEqual(before)
  })

  test("a stale derived guard rejects without any logical write", () => {
    const document = newCanvas()
    const before = encodeCanvasCanonicalStateV2(document)
    const valid = nodeCreateIntent()
    const stale = {
      ...valid,
      guard: { ...valid.guard, node: derivedNodeRefV2(context(9, 9, 9), U0) },
    } as CanvasTypedIntentUnionV2
    expect(applyCanvasCandidateIntentV2(document, context(1, 1, 1), stale, VALID_FACTS)).toBe("rejected")
    expect(encodeCanvasCanonicalStateV2(document)).toEqual(before)
  })
})

function nodeCreateIntent(): Extract<CanvasTypedIntentUnionV2, { kind: "canvas.agent.create" }> {
  const operationContext = context(1, 1, 1)
  const node = derivedNodeRefV2(operationContext, U0)
  return {
    format: "convax.typed-intent/2",
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
        data: { format: "convax.canvas-node-data/2", kind: "agent", title: "A", instructions: null },
        plugin: null,
      },
    },
  }
}
