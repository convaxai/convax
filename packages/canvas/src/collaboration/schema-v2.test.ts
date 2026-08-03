import { describe, expect, test } from "bun:test"
import { parseDigestV2 } from "@convax/collaboration"
import * as Y from "yjs"
import {
  CANVAS_DIGEST_DOMAINS_V2,
  actualWriteValueDigestV2,
  canvasDigestV2,
  canvasOwnerCanonicalizerDigestV2,
} from "./validation"
import {
  CANVAS_ROOT_KEYS_V2,
  CANVAS_ROOT_NAME_V2,
  createCanvasReconstructionYDocV2,
  encodeCanvasCanonicalStateV2,
  getCanvasChildMapV2,
  getCanvasRootV2,
  validateCanvasYDocV2,
} from "./ydoc"
import { context, createAgent, fork, newCanvas } from "./test-fixtures.test"

describe("CanvasYDoc v2 closed canonical schema", () => {
  test("has one named root with exactly the final 11 mandatory child maps", () => {
    const document = newCanvas()
    expect([...document.share.keys()]).toEqual([CANVAS_ROOT_NAME_V2])
    expect([...getCanvasRootV2(document).keys()]).toEqual([...CANVAS_ROOT_KEYS_V2])
    expect(validateCanvasYDocV2(document).nodes.size).toBe(0)

    const rogueRoot = fork(document)
    rogueRoot.getMap("document")
    expect(() => validateCanvasYDocV2(rogueRoot)).toThrow("exactly the convax.canvas.v2 named root")

    const rogueRevision = fork(document)
    getCanvasRootV2(rogueRevision).set("revision", "1")
    expect(() => validateCanvasYDocV2(rogueRevision)).toThrow("missing or unknown keys")
  })

  test("canonical bytes include every losing actor slot but never Yjs insertion order", () => {
    const base = newCanvas()
    const node = createAgent(base, context(1, 1, 1), "A")
    const left = fork(base)
    const right = fork(base)
    const key = `node/${node.id}/${node.incarnation}`
    const leftRecord = getCanvasChildMapV2(left, "nodes").get(key) as Y.Map<unknown>
    const rightRecord = getCanvasChildMapV2(right, "nodes").get(key) as Y.Map<unknown>
    const leftPosition = leftRecord.get("position") as Y.Map<unknown>
    const rightPosition = rightRecord.get("position") as Y.Map<unknown>
    leftPosition.set(context(2, 2, 2).actorId, claim(context(2, 2, 2), { x: 10, y: 20 }))
    rightPosition.set(context(3, 3, 3).actorId, claim(context(3, 3, 3), { x: 30, y: 40 }))

    const first = fork(base)
    Y.applyUpdate(first, Y.encodeStateAsUpdate(left))
    Y.applyUpdate(first, Y.encodeStateAsUpdate(right))
    const second = fork(base)
    Y.applyUpdate(second, Y.encodeStateAsUpdate(right))
    Y.applyUpdate(second, Y.encodeStateAsUpdate(left))

    expect(encodeCanvasCanonicalStateV2(first)).toEqual(encodeCanvasCanonicalStateV2(second))
    expect(validateCanvasYDocV2(first).nodes.get(key)!.position).toHaveLength(3)
  })

  test("reconstructs exact canonical bytes after binding the Canvas-owned root before a full update", () => {
    const source = newCanvas()
    createAgent(source, context(1, 31, 1), "Reconstructed")
    const reconstructed = createCanvasReconstructionYDocV2()

    Y.applyUpdate(reconstructed, Y.encodeStateAsUpdate(source), "canvas-full-update-reconstruction-v2")

    expect(encodeCanvasCanonicalStateV2(reconstructed)).toEqual(encodeCanvasCanonicalStateV2(source))
    expect(validateCanvasYDocV2(reconstructed)).toEqual(validateCanvasYDocV2(source))
  })

  test("reproduces the frozen R5 digest ledger and vectors A through E", () => {
    expect(CANVAS_DIGEST_DOMAINS_V2).toHaveLength(29)
    expect(CANVAS_DIGEST_DOMAINS_V2).toContain("convax.canvas-derived-id/2")
    expect([...CANVAS_DIGEST_DOMAINS_V2].sort()).toEqual([...CANVAS_DIGEST_DOMAINS_V2])
    expect(
      canvasOwnerCanonicalizerDigestV2(
        parseDigestV2("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
      ),
    ).toBe(parseDigestV2("043f386edb26fd29d9eebffc5d5154dceb263df6451eb3b2228890ce455291cd"))
    expect(
      canvasDigestV2("convax.canvas-effective-data/2", {
        format: "convax.canvas-effective-data/2",
        data: { format: "convax.canvas-node-data/2", kind: "agent", title: "A", instructions: null },
      }),
    ).toBe(parseDigestV2("8175e6a7eede34bec6869d37ed6629135741bb7727eb97d2bd93f36000e2a42f"))
    expect(
      canvasDigestV2("convax.canvas-obstacle-projection/2", {
        format: "convax.canvas-obstacle-projection/2",
        obstacles: [],
      }),
    ).toBe(parseDigestV2("5317e3704fa88e76024939abdfabe5dea30ef67301dd37ab626bc8f5dfa72874"))
    expect(
      canvasDigestV2("convax.canvas-metadata-effective/2", {
        format: "convax.canvas-metadata-effective/2",
        field: "description",
        value: null,
      }),
    ).toBe(parseDigestV2("21d7c073cf0c363eb1d884bf7ad77f9fc087750679d00580c427c24154a91f9a"))
    const entityId = `node/n_${"A".repeat(43)}/ni_${"A".repeat(43)}`
    const path = `nodes/${entityId}/creationGroup`
    expect(actualWriteValueDigestV2(path, { entityKind: "node", entityId, field: "creationGroup" }, null)).toBe(
      parseDigestV2("fffb72be980a00d8ed0acebf5768d73a0da53dfef751887b8a78bb7b8ae4dd52"),
    )
  })
})

function claim(operationContext: ReturnType<typeof context>, value: { x: number; y: number }) {
  return {
    format: "convax.canvas-stamped-claim/2",
    stamp: {
      format: "convax.portable-stamp/2",
      lamport: operationContext.lamport,
      actorId: operationContext.actorId,
      operationId: operationContext.operationId,
      writeOrdinal: "0",
    },
    value,
  }
}
