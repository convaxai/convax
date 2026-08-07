import { describe, expect, test } from "bun:test"
import { createCanonicalJcsEvidenceIssuer, testOnlyCanonicalJcsEvidenceBytes } from "./canonical-jcs-evidence"
import { canonicalStateDigest, nativeCanonicalStateDigest } from "./digest"
import { encodeRestrictedJcs } from "./jcs"
import * as publicSurface from "./index"

describe("CanonicalJcsEvidence", () => {
  test("keeps native canonical hashing byte-identical and falls back on every accelerator failure", async () => {
    const schema = "00".repeat(32)
    const bytes = encodeRestrictedJcs({ format: "canonical-hash-parity", values: [1, 2, 3] })
    const expected = canonicalStateDigest(schema, bytes)
    expect(await nativeCanonicalStateDigest(schema, bytes)).toBe(expected)
    expect(await nativeCanonicalStateDigest(schema, bytes, null)).toBe(expected)
    expect(await nativeCanonicalStateDigest(schema, bytes, { digest: async () => { throw new Error("native unavailable") } } as never)).toBe(expected)
    expect(await nativeCanonicalStateDigest(schema, bytes, { digest: async () => new Uint8Array(31).buffer } as never)).toBe(expected)
    expect("nativeCanonicalStateDigest" in publicSurface).toBe(false)
  })

  test("keeps issuer and consumer helpers off the package root", () => {
    expect("createCanonicalJcsEvidenceIssuer" in publicSurface).toBe(false)
    expect("testOnlyCanonicalJcsEvidenceBytes" in publicSurface).toBe(false)
  })

  test("composes byte-identical canonical arrays and objects without exposing bytes", () => {
    const issuer = createCanonicalJcsEvidenceIssuer()
    const left = issuer.encodeEvidence({ value: 1 })
    const right = issuer.encodeEvidence("two")
    const array = issuer.composeArray([left, right])
    const object = issuer.composeObject([["items", array], ["tail", issuer.encodeEvidence(null)]])
    expect(testOnlyCanonicalJcsEvidenceBytes(issuer, object)).toEqual(encodeRestrictedJcs({ items: [{ value: 1 }, "two"], tail: null }))
    expect(Object.keys(object)).toEqual([])
    expect("bytes" in object).toBe(false)
    expect("digest" in object).toBe(false)
  })

  test("rejects structural and cross-issuer evidence plus unordered or duplicate keys", () => {
    const first = createCanonicalJcsEvidenceIssuer()
    const second = createCanonicalJcsEvidenceIssuer()
    const value = first.encodeEvidence(1)
    expect(() => second.composeArray([value])).toThrow("another issuer")
    expect(() => first.composeArray([Object.freeze({}) as never])).toThrow("structural")
    expect(() => first.composeObject([["b", value], ["a", value]])).toThrow("ordered")
    expect(() => first.composeObject([["a", value], ["a", value]])).toThrow("unique")
  })

  test("copies encoded values and every inspection result", () => {
    const issuer = createCanonicalJcsEvidenceIssuer()
    const input = { nested: [1, 2] }
    const evidence = issuer.encodeEvidence(input)
    input.nested[0] = 9
    const first = testOnlyCanonicalJcsEvidenceBytes(issuer, evidence)
    first[0] ^= 0xff
    expect(testOnlyCanonicalJcsEvidenceBytes(issuer, evidence)).toEqual(encodeRestrictedJcs({ nested: [1, 2] }))
  })

  test("assembles 512 and 2k entry collections byte-identically", () => {
    for (const size of [512, 2_048]) {
      const issuer = createCanonicalJcsEvidenceIssuer()
      const values = Array.from({ length: size }, (_, index) => [`entry-${String(index).padStart(4, "0")}`, { index }] as const)
      const pairs = values.map((value) => issuer.encodeEvidence(value))
      const evidence = issuer.composeObject([["entries", issuer.composeArray(pairs)]])
      expect(testOnlyCanonicalJcsEvidenceBytes(issuer, evidence)).toEqual(encodeRestrictedJcs({ entries: values }))
    }
  })

  test("enforces child, byte and composition-depth limits", () => {
    const issuer = createCanonicalJcsEvidenceIssuer()
    const scalar = issuer.encodeEvidence(0)
    expect(() => issuer.composeArray(Array.from({ length: 65_537 }, () => scalar))).toThrow("limit")
    expect(() => issuer.encodeEvidence("x".repeat(16 * 1024 * 1024))).toThrow("byte limit")
    let nested = scalar
    for (let index = 0; index < 127; index += 1) nested = issuer.composeArray([nested])
    expect(() => issuer.composeArray([nested])).toThrow("depth limit")
  })
})
