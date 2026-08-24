import { describe, expect, test } from "bun:test"
import {
  compareUtf8,
  encodeRestrictedJcs,
  type CanonicalJcsEvidence,
  type CanonicalJcsEvidenceIssuer,
} from "@convax/collaboration"
import * as Y from "yjs"
import { CanvasOwnerStateCache } from "./owner-state-cache"
import type { CanvasSnapshot } from "./types"
import {
  CANVAS_ROOT_NAME,
  encodeValidatedCanvasCanonicalState,
  getCanvasChildMap,
  validateCanvasYDoc,
} from "./ydoc"
import { canvasEntityKey, derivedNodeRef, makeStamp } from "./validation"
import { context, createAgent, newCanvas, U0 } from "./test-fixtures.test"

describe("Canvas owner state cache", () => {
  test("returns fresh canonical bytes while reusing one unchanged full validation", () => {
    const document = newCanvas()
    const cache = new CanvasOwnerStateCache()
    const firstSnapshot = cache.validate(document)
    const first = cache.canonicalStateBytes(document)
    first[0] ^= 0xff

    expect(cache.validate(document)).toBe(firstSnapshot)
    expect(cache.canonicalStateBytes(document)).not.toBe(first)
    expect(cache.canonicalStateBytes(document)[0]).not.toBe(first[0])
    expect(cache.traversalCounts()).toEqual({ fullValidation: 1, canonical: 1 })
  })

  test("reduces the warm kernel owner-port sequence from six validations/four canonical traversals to three/two", () => {
    const replica = newCanvas()
    const candidate = newCanvas()
    const canonicalPost = newCanvas()
    const cache = new CanvasOwnerStateCache()

    cache.canonicalStateBytes(replica)
    cache.canonicalStateBytes(replica)
    cache.validate(replica)
    cache.validate(candidate)
    cache.canonicalStateBytes(canonicalPost)
    cache.canonicalStateBytes(canonicalPost)

    expect(cache.traversalCounts()).toEqual({ fullValidation: 3, canonical: 2 })
  })

  test("invalidates when first observed inside an outer transaction", () => {
    const document = newCanvas()
    const cache = new CanvasOwnerStateCache()
    let inside: CanvasSnapshot | undefined
    document.transact(() => {
      inside = cache.validate(document)
      createAgent(document, context(11, 1, 1))
    }, "outer")
    expect(cache.validate(document)).not.toBe(inside)
    expect(cache.validate(document).nodes.size).toBe(1)
  })

  test("invalidates legal nested claims and subsequent transactions", () => {
    const document = newCanvas()
    const cache = new CanvasOwnerStateCache()
    const initial = cache.validate(document)
    const metadataContext = context(12, 1, 1)
    document.transact(() => {
      document.transact(() => {
        const title = getCanvasChildMap(document, "meta").get("title")
        if (!(title instanceof Y.Map)) throw new Error("Canvas title actor map is missing")
        title.set(metadataContext.actorId, {
          format: "convax.canvas-stamped-claim",
          stamp: makeStamp(metadataContext, U0),
          value: "Nested title",
        })
      }, "nested-metadata-claim")
    }, "outer-metadata-claim")
    const afterClaim = cache.validate(document)
    expect(afterClaim).not.toBe(initial)
    expect(afterClaim.meta.title).toHaveLength(1)

    createAgent(document, context(13, 2, 2))
    expect(cache.validate(document)).not.toBe(afterClaim)
    expect(cache.validate(document).nodes.size).toBe(1)
  })

  test("rejects stale entries after root replacement and clears on destroy", () => {
    const document = newCanvas()
    const cache = new CanvasOwnerStateCache()
    const initial = cache.validate(document)
    const originalRoot = document.share.get(CANVAS_ROOT_NAME)!
    document.share.set(CANVAS_ROOT_NAME, new Y.Map())
    expect(() => cache.validate(document)).toThrow()

    document.share.set(CANVAS_ROOT_NAME, originalRoot)
    expect(cache.validate(document)).not.toBe(initial)
    const beforeDestroy = cache.validate(document)
    document.destroy()
    expect(cache.validate(document)).not.toBe(beforeDestroy)
  })

  test("certifies only the exact durable head and invalidates on any transaction or root replacement", () => {
    const source = newCanvas()
    const target = newCanvas()
    const cache = new CanvasOwnerStateCache()
    const snapshot = cache.validate(source)
    cache.canonicalStateBytes(source)
    const canonical = "a".repeat(64) as import("@convax/collaboration").Digest
    const head = "b".repeat(64) as import("@convax/collaboration").Digest
    const scope = context(21, 1, 1).scope
    cache.transferValidatedSnapshot(source, target, snapshot, canonical, head)

    expect(cache.readCertifiedCanonicalDigest(target, scope, head, canonical)).toBe(canonical)
    expect(cache.readCertifiedCanonicalDigest(target, scope, "c".repeat(64) as never, canonical)).toBeNull()
    expect(cache.readCertifiedCanonicalDigest(target, scope, head, "d".repeat(64) as never)).toBeNull()

    target.transact(() => {}, "empty-transaction")
    expect(cache.readCertifiedCanonicalDigest(target, scope, head, canonical)).toBeNull()

    cache.transferValidatedSnapshot(source, target, snapshot, canonical, head)
    target.share.set(CANVAS_ROOT_NAME, new Y.Map())
    expect(cache.readCertifiedCanonicalDigest(target, scope, head, canonical)).toBeNull()
  })

  test("keeps canonical evidence acceleration failure out of legal owner validation", () => {
    const cache = new CanvasOwnerStateCache()
    const postDocument = newCanvas()
    createAgent(postDocument, context(31, 2, 2))
    const post = validateCanvasYDoc(postDocument)
    const failure = new Error("evidence unavailable")
    const throwingIssuer: CanonicalJcsEvidenceIssuer = {
      encodeEvidence() { throw failure },
      composeArray() { throw failure },
      composeObject() { throw failure },
    }

    const workBefore = cache.canonicalWorkCounts()
    expect(() => cache.installValidatedSnapshot(postDocument, post)).not.toThrow()
    const workAfterInstall = cache.canonicalWorkCounts()
    expect(workAfterInstall.assemblies - workBefore.assemblies).toBe(0)
    expect(workAfterInstall.pairByteEncodes - workBefore.pairByteEncodes).toBe(0)
    expect(workAfterInstall.evidenceArrayEntries - workBefore.evidenceArrayEntries).toBe(0)
    expect(cache.validate(postDocument)).toBe(post)
    expect(cache.canonicalEvidence(postDocument)).toBeNull()
    expect(cache.canonicalStateBytes(postDocument, throwingIssuer)).toEqual(encodeValidatedCanvasCanonicalState(post))
  })

  test("keeps hot appends free of canonical history work and rebuilds exact audit bytes only on demand", () => {
    const document = newCanvas()
    const cache = new CanvasOwnerStateCache()
    let immutablePairTuples = 0
    const issuer = byteEvidenceIssuer((tuple) => {
      expect(Object.isFrozen(tuple)).toBeTrue()
      expect(Reflect.set(tuple, "0", "mutated-key")).toBeFalse()
      immutablePairTuples += 1
    })
    const planned = Array.from({ length: 67 }, (_, seed) => context(1_000 + seed, 2_000 + seed, seed + 1))
      .sort((left, right) => compareUtf8(
        canvasEntityKey(derivedNodeRef(left, U0)),
        canvasEntityKey(derivedNodeRef(right, U0)),
      ))
    const anchorIndexes = new Set([16, 32, 48])
    const anchors = planned.filter((_value, index) => anchorIndexes.has(index))
    for (const operationContext of anchors) createAgent(document, operationContext)

    let base = cache.validate(document)
    const initial = cache.canonicalWorkCounts()
    const before = planned.slice(0, 16)
    const between = [...planned.slice(17, 32), ...planned.slice(33, 48)]
    const after = planned.slice(49)
    const appendOrder: ReturnType<typeof context>[] = []
    for (let index = 0; index < Math.max(before.length, between.length, after.length); index += 1) {
      if (before[index]) appendOrder.push(before[index]!)
      if (between[index]) appendOrder.push(between[index]!)
      if (after[index]) appendOrder.push(after[index]!)
    }
    expect(appendOrder).toHaveLength(64)
    const anchorKeys = anchors.map((value) => canvasEntityKey(derivedNodeRef(value, U0))).sort(compareUtf8)
    expect(before.every((value) => compareUtf8(canvasEntityKey(derivedNodeRef(value, U0)), anchorKeys[0]!) < 0)).toBeTrue()
    expect(after.every((value) => compareUtf8(canvasEntityKey(derivedNodeRef(value, U0)), anchorKeys[2]!) > 0)).toBeTrue()

    for (const operationContext of appendOrder) {
      createAgent(document, operationContext)
      const post = validateCanvasYDoc(document)
      const beforeInstall = cache.canonicalWorkCounts()
      cache.installValidatedSnapshot(document, post)
      const afterInstall = cache.canonicalWorkCounts()
      expect(afterInstall.assemblies - beforeInstall.assemblies).toBe(0)
      expect(afterInstall.collectionByteAssemblies - beforeInstall.collectionByteAssemblies).toBe(0)
      expect(afterInstall.pairByteEncodes - beforeInstall.pairByteEncodes).toBe(0)
      expect(afterInstall.evidenceArrayEntries - beforeInstall.evidenceArrayEntries).toBe(0)
      expect(cache.canonicalEvidence(document)).toBeNull()
      base = post
    }

    const afterInstalls = cache.canonicalWorkCounts()
    expect(afterInstalls.assemblies - initial.assemblies).toBe(0)
    expect(afterInstalls.collectionByteAssemblies - initial.collectionByteAssemblies).toBe(0)
    expect(afterInstalls.pairByteEncodes - initial.pairByteEncodes).toBe(0)
    expect(afterInstalls.evidenceArrayEntries - initial.evidenceArrayEntries).toBe(0)

    const expected = encodeValidatedCanvasCanonicalState(base)
    expect(cache.canonicalStateBytes(document, issuer)).toEqual(expected)
    const afterFirstAudit = cache.canonicalWorkCounts()
    expect(afterFirstAudit.assemblies - afterInstalls.assemblies).toBe(1)
    expect(afterFirstAudit.collectionByteAssemblies - afterInstalls.collectionByteAssemblies).toBe(9)
    // Three seeded entries plus 64 appends across nodes, semantic history and
    // operation receipts are visited once, only by this explicit cold audit.
    expect(afterFirstAudit.pairByteEncodes - afterInstalls.pairByteEncodes).toBe(201)
    expect(afterFirstAudit.evidenceArrayEntries - afterInstalls.evidenceArrayEntries).toBe(201)
    expect(cache.canonicalStateBytes(document, issuer)).toEqual(expected)
    const afterCachedAudit = cache.canonicalWorkCounts()
    expect(afterCachedAudit).toEqual(afterFirstAudit)
    expect(immutablePairTuples).toBe(201)
  }, 30_000)
})

interface ByteEvidence extends CanonicalJcsEvidence {
  readonly bytes: Uint8Array
}

function byteEvidenceIssuer(
  onPairTuple?: (tuple: readonly [string, unknown]) => void,
): CanonicalJcsEvidenceIssuer {
  const encoder = new TextEncoder()
  const issue = (parts: readonly Uint8Array[]): ByteEvidence => Object.freeze({
    bytes: joinBytes(parts),
  }) as ByteEvidence
  return {
    encodeEvidence: (value) => {
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string") {
        onPairTuple?.(value as unknown as readonly [string, unknown])
      }
      return issue([encodeRestrictedJcs(value)])
    },
    composeArray: (items) => issue([
      encoder.encode("["),
      ...items.flatMap((item, index) => index === 0
        ? [readByteEvidence(item)]
        : [encoder.encode(","), readByteEvidence(item)]),
      encoder.encode("]"),
    ]),
    composeObject: (entries) => issue([
      encoder.encode("{"),
      ...entries.flatMap(([key, value], index) => [
        ...(index === 0 ? [] : [encoder.encode(",")]),
        encodeRestrictedJcs(key),
        encoder.encode(":"),
        readByteEvidence(value),
      ]),
      encoder.encode("}"),
    ]),
  }
}

function readByteEvidence(evidence: CanonicalJcsEvidence): Uint8Array {
  const bytes = (evidence as Partial<ByteEvidence>).bytes
  if (!(bytes instanceof Uint8Array)) throw new Error("test evidence is not byte backed")
  return bytes
}

function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}
