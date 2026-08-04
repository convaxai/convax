import { describe, expect, test } from "bun:test"
import {
  decodeCheckpointValidationCarrierV2,
  encodeCheckpointValidationCarrierV2,
  parseCheckpointValidationCarrierIndexV2,
  parseCheckpointValidationCarrierPreambleV2,
  type CheckpointCarrierSectionKindV2,
} from "./checkpoint-carrier"
import {
  encodeBase64urlV2,
  parseCanvasIdV2,
  parseId128V2,
  parseProjectIdV2,
  parseUint64V2,
} from "./codecs"
import { PINNED_AUTHORITY_IDENTITIES_V2 } from "./constants"
import { ordinarySha256V2 } from "./digest"

const encoder = new TextEncoder()
const id = (byte: number) => parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => byte)))
const digest = (label: string) => ordinarySha256V2(encoder.encode(label))
const scope = Object.freeze({
  projectId: parseProjectIdV2("project"),
  projectEpoch: id(1),
  docKind: "canvas" as const,
  docId: parseCanvasIdV2(`cv_${"3".repeat(64)}`),
  shardEpoch: id(2),
})

function fixture() {
  const values = [
    ["proposal-checkpoint", "proposal-checkpoint", "checkpoint"],
    ["proposal-snapshot", "proposal-snapshot", "snapshot"],
    ["validation-artifact", "artifact-a", "artifact-a"],
    ["validation-artifact", "artifact-b", "artifact-b"],
    ["validation-artifact", "artifact-c", "artifact-c"],
    ["validation-artifact", "artifact-d", "artifact-d"],
  ] as const satisfies readonly (readonly [CheckpointCarrierSectionKindV2, string, string])[]
  const sectionBytes = values.map(([, , body]) => encoder.encode(body))
  let offset = 0
  const sections = values.map(([kind, subject], ordinal) => {
    const bytes = sectionBytes[ordinal]!
    const section = {
      ordinal: String(ordinal), kind, subjectDigest: digest(subject), byteOffset: String(offset),
      byteLength: String(bytes.byteLength), sha256: ordinarySha256V2(bytes),
    }
    offset += bytes.byteLength
    return section
  })
  const index = parseCheckpointValidationCarrierIndexV2({
    format: "convax.checkpoint-validation-carrier-index/2",
    scope,
    proposalCheckpointDigest: digest("proposal-checkpoint"),
    parentCheckpointDigests: [],
    suffixFrameDigests: [],
    validationArtifactSetDigest: digest("artifact-set"),
    sections,
    totalSectionBytes: String(offset),
    protocolDigest: PINNED_AUTHORITY_IDENTITIES_V2.protocolDigest,
  })
  return { index, sectionBytes }
}

describe("CVXCAR02 checkpoint validation carrier", () => {
  test("round-trips exact canonical index and binary section bytes", () => {
    const { index, sectionBytes } = fixture()
    const encoded = encodeCheckpointValidationCarrierV2(index, sectionBytes)
    expect(new TextDecoder().decode(encoded.subarray(0, 8))).toBe("CVXCAR02")
    expect(BigInt(parseCheckpointValidationCarrierPreambleV2(encoded.subarray(0, 16)).indexByteLength)).toBeGreaterThan(0n)
    const decoded = decodeCheckpointValidationCarrierV2(encoded)
    expect(decoded.index).toEqual(index)
    expect(decoded.exactSectionBytes.map((bytes) => new TextDecoder().decode(bytes))).toEqual([
      "checkpoint", "snapshot", "artifact-a", "artifact-b", "artifact-c", "artifact-d",
    ])
    encoded.fill(0)
    expect(new TextDecoder().decode(decoded.exactSectionBytes[0])).toBe("checkpoint")
  })

  test("rejects magic, trailing bytes and section hash corruption", () => {
    const { index, sectionBytes } = fixture()
    const encoded = encodeCheckpointValidationCarrierV2(index, sectionBytes)
    const badMagic = encoded.slice()
    badMagic[0] ^= 1
    expect(() => decodeCheckpointValidationCarrierV2(badMagic)).toThrow("magic")
    const trailing = new Uint8Array(encoded.byteLength + 1)
    trailing.set(encoded)
    expect(() => decodeCheckpointValidationCarrierV2(trailing)).toThrow("total byte length")
    const corrupt = encoded.slice()
    corrupt[corrupt.byteLength - 1] ^= 1
    expect(() => decodeCheckpointValidationCarrierV2(corrupt)).toThrow("SHA-256")
  })

  test("rejects gaps, missing protocol artifacts and oversized proposal snapshots before allocation", () => {
    const { index } = fixture()
    const plain = { ...index, sections: index.sections.map((section) => ({ ...section })) }
    plain.sections[1]!.byteOffset = parseUint64V2("999")
    expect(() => parseCheckpointValidationCarrierIndexV2(plain)).toThrow("gap or overlap")

    const threeArtifacts = { ...index, sections: index.sections.map((section) => ({ ...section })) }
    threeArtifacts.sections.pop()
    const removed = BigInt(index.sections[index.sections.length - 1]!.byteLength)
    threeArtifacts.totalSectionBytes = parseUint64V2((BigInt(threeArtifacts.totalSectionBytes) - removed).toString())
    expect(() => parseCheckpointValidationCarrierIndexV2(threeArtifacts)).toThrow("four protocol artifacts")

    const oversized = { ...index, sections: index.sections.map((section) => ({ ...section })) }
    const delta = BigInt(32 * 1024 * 1024 + 1) - BigInt(oversized.sections[1]!.byteLength)
    oversized.sections[1]!.byteLength = parseUint64V2(String(32 * 1024 * 1024 + 1))
    for (let ordinal = 2; ordinal < oversized.sections.length; ordinal += 1) {
      oversized.sections[ordinal]!.byteOffset = parseUint64V2((BigInt(oversized.sections[ordinal]!.byteOffset) + delta).toString())
    }
    oversized.totalSectionBytes = parseUint64V2((BigInt(oversized.totalSectionBytes) + delta).toString())
    expect(() => parseCheckpointValidationCarrierIndexV2(oversized)).toThrow("32 MiB")
  })
})
