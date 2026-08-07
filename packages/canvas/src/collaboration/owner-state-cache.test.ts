import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { CanvasOwnerStateCache } from "./owner-state-cache"
import type { CanvasSnapshot } from "./types"
import { CANVAS_ROOT_NAME, getCanvasChildMap } from "./ydoc"
import { context, createAgent, newCanvas } from "./test-fixtures.test"

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

  test("invalidates pure deletes, nested deletes, and subsequent transactions", () => {
    const document = newCanvas()
    const node = createAgent(document, context(12, 1, 1))
    const cache = new CanvasOwnerStateCache()
    const initial = cache.validate(document)
    document.transact(() => {
      document.transact(() => {
        getCanvasChildMap(document, "nodes").delete(`node/${node.id}/${node.incarnation}`)
      }, "nested-delete")
    }, "outer-delete")
    const afterDelete = cache.validate(document)
    expect(afterDelete).not.toBe(initial)
    expect(afterDelete.nodes.size).toBe(0)

    createAgent(document, context(13, 2, 2))
    expect(cache.validate(document)).not.toBe(afterDelete)
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
})
