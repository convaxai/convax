import { describe, expect, test } from "bun:test"
import { parseDigest } from "./codecs"
import {
  createOwnerStateCommitmentIssuer,
  ownerStateCommitmentDescriptorDigest,
  parseOwnerStateCommitmentDescriptor,
  testOnlyOwnerStateCommitmentWork,
  type OwnerStateCommitmentMutation,
} from "./owner-state-commitment"

const SCHEMA = parseDigest("11".repeat(32))
const OTHER_SCHEMA = parseDigest("22".repeat(32))
const descriptor = Object.freeze({
  format: "convax.owner-state-commitment-descriptor" as const,
  commitmentCodec: "sha256-merkle-patricia-v1" as const,
  canonicalKeyPathPolicy: "nfc-utf8-no-nul-bounded-v1" as const,
  maxCanonicalNameUtf8Bytes: "128" as const,
  maxCanonicalKeyUtf8Bytes: "1024" as const,
  scalarNames: Object.freeze(["format", "title"]),
  collectionNames: Object.freeze(["entries", "routes"]),
})

describe("owner state Merkle Patricia commitment", () => {
  test("is history-independent across random arrival, update, and delete order", () => {
    const issuer = createOwnerStateCommitmentIssuer({ owner: "canvas", ownerSchemaDigest: SCHEMA })
    const initial = Array.from({ length: 512 }, (_, index) => ({
      key: key(index),
      value: { index, label: `node-${index}`, nested: { parity: index % 2 } },
    }))
    const forward = issuer.build(source(initial))
    const reverse = issuer.build(source([...initial].reverse()))
    const shuffled = issuer.build(source(shuffle(initial, 0x51f15e)))
    expect(issuer.digest(reverse)).toBe(issuer.digest(forward))
    expect(issuer.digest(shuffled)).toBe(issuer.digest(forward))

    let incremental = issuer.build(source([]))
    incremental = issuer.apply(
      incremental,
      shuffle(initial, 0xdecafbad).map((entry) => ({
        kind: "set" as const,
        collection: "entries",
        key: entry.key,
        value: entry.value,
      })),
    )
    expect(issuer.digest(incremental)).toBe(issuer.digest(forward))

    const deleted = new Set(initial.filter((entry) => entry.value.index % 7 === 0).map((entry) => entry.key))
    const updated = initial
      .filter((entry) => !deleted.has(entry.key))
      .map((entry) => entry.value.index % 5 === 0
        ? { ...entry, value: { ...entry.value, label: `updated-${entry.value.index}` } }
        : entry)
    const mutations: OwnerStateCommitmentMutation[] = [
      ...[...deleted].map((entryKey) => ({ kind: "delete" as const, collection: "entries", key: entryKey })),
      ...updated
        .filter((entry) => entry.value.index % 5 === 0)
        .map((entry) => ({ kind: "set" as const, collection: "entries", key: entry.key, value: entry.value })),
      { kind: "set-scalar", name: "title", value: "after" },
    ]
    incremental = issuer.apply(incremental, shuffle(mutations, 0x12345678))
    const rebuilt = issuer.build(source(updated, "after"))
    expect(issuer.digest(incremental)).toBe(issuer.digest(rebuilt))
  })

  test("binds exact owner, schema, descriptor, collection, key, and restricted-JCS value", () => {
    const canvas = createOwnerStateCommitmentIssuer({ owner: "canvas", ownerSchemaDigest: SCHEMA })
    const project = createOwnerStateCommitmentIssuer({ owner: "project-index", ownerSchemaDigest: SCHEMA })
    const otherSchema = createOwnerStateCommitmentIssuer({ owner: "canvas", ownerSchemaDigest: OTHER_SCHEMA })
    const base = canvas.build(source([{ key: "same", value: { a: 1, b: 2 } }]))
    const reorderedValue = canvas.build(source([{ key: "same", value: { b: 2, a: 1 } }]))
    expect(canvas.digest(reorderedValue)).toBe(canvas.digest(base))
    expect(project.digest(project.build(source([{ key: "same", value: { a: 1, b: 2 } }])))).not.toBe(canvas.digest(base))
    expect(otherSchema.digest(otherSchema.build(source([{ key: "same", value: { a: 1, b: 2 } }])))).not.toBe(canvas.digest(base))

    const routesOnly = canvas.build({
      descriptor,
      scalars: [{ name: "format", value: "convax.test" }, { name: "title", value: "before" }],
      collections: [
        { name: "routes", entries: [{ key: "same", value: { a: 1, b: 2 } }] },
        { name: "entries", entries: [] },
      ],
    })
    expect(canvas.digest(routesOnly)).not.toBe(canvas.digest(base))
    expect(canvas.digest(canvas.apply(base, [{ kind: "set", collection: "entries", key: "same", value: { a: 2 } }]))).not.toBe(canvas.digest(base))
  })

  test("rejects duplicate names and keys, malformed paths, tampering, and issuer mixing", () => {
    expect(() => parseOwnerStateCommitmentDescriptor({
      ...descriptor,
      scalarNames: ["format", "format"],
    })).toThrow("unique")
    expect(() => parseOwnerStateCommitmentDescriptor({
      ...descriptor,
      collectionNames: ["entries", "format"],
    })).toThrow("overlap")
    expect(() => parseOwnerStateCommitmentDescriptor({
      ...descriptor,
      scalarNames: ["title", "format"],
    })).toThrow("sorted")

    const first = createOwnerStateCommitmentIssuer({ owner: "canvas", ownerSchemaDigest: SCHEMA })
    const second = createOwnerStateCommitmentIssuer({ owner: "canvas", ownerSchemaDigest: SCHEMA })
    const commitment = first.build(source([{ key: "one", value: 1 }]))
    expect(() => first.digest({ ...commitment })).toThrow("structural")
    expect(() => second.digest(commitment)).toThrow("another issuer")
    expect(() => second.apply(commitment, [])).toThrow("another issuer")
    expect(() => first.build(source([
      { key: "duplicate", value: 1 },
      { key: "duplicate", value: 2 },
    ]))).toThrow("duplicate collection key")
    expect(() => first.apply(commitment, [{ kind: "delete", collection: "entries", key: "absent" }])).toThrow("absent")
    expect(() => first.apply(commitment, [
      { kind: "set", collection: "entries", key: "one", value: 2 },
      { kind: "delete", collection: "entries", key: "one" },
    ])).toThrow("repeats")
    expect(() => first.apply(commitment, [{ kind: "set", collection: "routes", key: "one\u0000two", value: 1 }])).toThrow("canonical bound")
    expect(() => first.apply(commitment, [{ kind: "set", collection: "routes", key: "e\u0301", value: 1 }])).toThrow("NFC")
    expect(() => first.apply(commitment, [{ kind: "set", collection: "routes", key: "x".repeat(1025), value: 1 }])).toThrow("canonical bound")
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(() => first.apply(commitment, [{ kind: "set", collection: "routes", key: "cycle", value: cyclic }])).toThrow("cycles")
  })

  test("cold cache loss rebuilds the same root under a fresh issuer", () => {
    const entries = shuffle(Array.from({ length: 1_000 }, (_, index) => ({ key: key(index), value: index })), 77)
    const first = createOwnerStateCommitmentIssuer({ owner: "canvas", ownerSchemaDigest: SCHEMA })
    const lost = first.digest(first.build(source(entries)))
    const recovered = createOwnerStateCommitmentIssuer({ owner: "canvas", ownerSchemaDigest: SCHEMA })
    expect(recovered.digest(recovered.build(source(entries)))).toBe(lost)
    expect(ownerStateCommitmentDescriptorDigest({ ...descriptor })).toBe(ownerStateCommitmentDescriptorDigest(descriptor))
  })

  test("fixed-key mutation structural work is independent of collection cardinality", () => {
    const results = [1, 1_000, 10_000].map((size) => {
      const issuer = createOwnerStateCommitmentIssuer({ owner: "canvas", ownerSchemaDigest: SCHEMA })
      const built = issuer.build(source(Array.from({ length: size }, (_, index) => ({ key: key(index), value: index }))))
      const buildWork = testOnlyOwnerStateCommitmentWork(issuer, built)
      expect(buildWork.entryCount).toBe(size)
      expect(buildWork.nodeCount).toBeLessThanOrEqual(size * 2)
      const changed = issuer.apply(built, [{
        kind: "set",
        collection: "entries",
        key: key(Math.floor(size / 2)),
        value: "changed",
      }])
      const mutationWork = testOnlyOwnerStateCommitmentWork(issuer, changed)
      expect(mutationWork.leafHashCount).toBe(1)
      expect(mutationWork.nodeHashCount).toBeLessThanOrEqual(key(0).length + 2)
      expect(mutationWork.pathCopyCount).toBe(mutationWork.nodeHashCount)
      expect(issuer.digest(changed)).toBe(issuer.digest(changed))
      return mutationWork.nodeHashCount
    })
    expect(Math.max(...results) - Math.min(...results)).toBeLessThanOrEqual(4)
  })
})

function source(entries: readonly Readonly<{ key: string; value: unknown }>[], title = "before") {
  return {
    descriptor,
    scalars: [{ name: "title", value: title }, { name: "format", value: "convax.test" }],
    collections: [
      { name: "routes", entries: [] },
      { name: "entries", entries },
    ],
  }
}

function key(index: number): string {
  return `node-${index.toString().padStart(10, "0")}`
}

function shuffle<T>(input: readonly T[], seed: number): T[] {
  const result = [...input]
  let state = seed >>> 0
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    const target = state % (index + 1)
    ;[result[index], result[target]] = [result[target]!, result[index]!]
  }
  return result
}
