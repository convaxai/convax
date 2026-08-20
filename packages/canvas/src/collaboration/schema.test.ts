import { describe, expect, test } from "bun:test"
import { parseDigest } from "@convax/collaboration"
import * as Y from "yjs"
import {
  CANVAS_DIGEST_DOMAINS,
  actualWriteValueDigest,
  canvasDigest,
  canvasOwnerCanonicalizerDigest,
} from "./validation"
import {
  CANVAS_ROOT_KEYS,
  CANVAS_ROOT_NAME,
  createCanvasReconstructionYDoc,
  encodeCanvasCanonicalState,
  getCanvasChildMap,
  getCanvasRoot,
  validateCanvasYDoc,
} from "./ydoc"
import { context, createAgent, fork, newCanvas } from "./test-fixtures.test"

describe("CanvasYDoc v2 closed canonical schema", () => {
  test("has one named root with exactly the final 11 mandatory child maps", () => {
    const document = newCanvas()
    expect([...document.share.keys()]).toEqual([CANVAS_ROOT_NAME])
    expect([...getCanvasRoot(document).keys()]).toEqual([...CANVAS_ROOT_KEYS])
    expect(validateCanvasYDoc(document).nodes.size).toBe(0)

    const rogueRoot = fork(document)
    rogueRoot.getMap("document")
    expect(() => validateCanvasYDoc(rogueRoot)).toThrow("exactly the convax.canvas.v2 named root")

    const rogueRevision = fork(document)
    getCanvasRoot(rogueRevision).set("revision", "1")
    expect(() => validateCanvasYDoc(rogueRevision)).toThrow("missing or unknown keys")
  })

  test("canonical bytes include every losing actor slot but never Yjs insertion order", () => {
    const base = newCanvas()
    const node = createAgent(base, context(1, 1, 1), "A")
    const left = fork(base)
    const right = fork(base)
    const key = `node/${node.id}/${node.incarnation}`
    const leftRecord = getCanvasChildMap(left, "nodes").get(key) as Y.Map<unknown>
    const rightRecord = getCanvasChildMap(right, "nodes").get(key) as Y.Map<unknown>
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

    expect(encodeCanvasCanonicalState(first)).toEqual(encodeCanvasCanonicalState(second))
    expect(validateCanvasYDoc(first).nodes.get(key)!.position).toHaveLength(3)
  })

  test("reconstructs exact canonical bytes after binding the Canvas-owned root before a full update", () => {
    const source = newCanvas()
    createAgent(source, context(1, 31, 1), "Reconstructed")
    const reconstructed = createCanvasReconstructionYDoc()

    Y.applyUpdate(reconstructed, Y.encodeStateAsUpdate(source), "canvas-full-update-reconstruction-v2")

    expect(encodeCanvasCanonicalState(reconstructed)).toEqual(encodeCanvasCanonicalState(source))
    expect(validateCanvasYDoc(reconstructed)).toEqual(validateCanvasYDoc(source))
  })

  test("reproduces the frozen current digest ledger and remaining current vectors", () => {
    expect(CANVAS_DIGEST_DOMAINS).toHaveLength(28)
    expect(CANVAS_DIGEST_DOMAINS).toContain("convax.canvas-derived-id")
    expect([...CANVAS_DIGEST_DOMAINS].sort()).toEqual([...CANVAS_DIGEST_DOMAINS])
    expect(
      canvasOwnerCanonicalizerDigest(
        parseDigest("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
      ),
    ).toBe(parseDigest("12a931a5714f459e2080e59fb21403c2ac786e783003f2de11f513073d9a43aa"))
    expect(
      canvasDigest("convax.canvas-effective-data", {
        format: "convax.canvas-effective-data",
        data: { format: "convax.canvas-node-data", kind: "agent", title: "A", instructions: null },
      }),
    ).toBe(parseDigest("7aeb046a6803a1f4d290d70ba0e9fe5327c2f5b8007c29b3b4e94251e65a8d36"))
    expect(
      canvasDigest("convax.canvas-metadata-effective", {
        format: "convax.canvas-metadata-effective",
        field: "description",
        value: null,
      }),
    ).toBe(parseDigest("5e094b2098d40785af3672c7ee1526ed6801e1a128faa533a7d3c908af25c4a6"))
    const entityId = `node/n_${"A".repeat(43)}/ni_${"A".repeat(43)}`
    const path = `nodes/${entityId}/creationGroup`
    expect(actualWriteValueDigest(path, { entityKind: "node", entityId, field: "creationGroup" }, null)).toBe(
      parseDigest("45cbf04805167c30991195ea2766878e624a57661a45a4396d308bee504c4d98"),
    )
  })
})

function claim(operationContext: ReturnType<typeof context>, value: { x: number; y: number }) {
  return {
    format: "convax.canvas-stamped-claim",
    stamp: {
      format: "convax.portable-stamp",
      lamport: operationContext.lamport,
      actorId: operationContext.actorId,
      operationId: operationContext.operationId,
      writeOrdinal: "0",
    },
    value,
  }
}
