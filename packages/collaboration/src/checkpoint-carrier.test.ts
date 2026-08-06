import { describe, expect, test } from "bun:test"
import {
  decodeCheckpointValidationCarrier,
  encodeCheckpointValidationCarrier,
  parseCheckpointValidationCarrierIndex,
  parseCheckpointValidationCarrierPreamble,
  type CheckpointCarrierSectionKind,
} from "./checkpoint-carrier"
import {
  encodeBase64url,
  parseCanvasId,
  parseId128,
  parseProjectId,
  parseUint64,
} from "./codecs"
import { CURRENT_PROTOCOL_IDENTITIES } from "./constants"
import { ordinarySha256 } from "./digest"

const encoder = new TextEncoder()
const id = (byte: number) => parseId128(encodeBase64url(Uint8Array.from({ length: 16 }, () => byte)))
const digest = (label: string) => ordinarySha256(encoder.encode(label))
const scope = Object.freeze({
  projectId: parseProjectId("project"),
  projectEpoch: id(1),
  docKind: "canvas" as const,
  docId: parseCanvasId(`cv_${"3".repeat(64)}`),
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
  ] as const satisfies readonly (readonly [CheckpointCarrierSectionKind, string, string])[]
  const sectionBytes = values.map(([, , body]) => encoder.encode(body))
  let offset = 0
  const sections = values.map(([kind, subject], ordinal) => {
    const bytes = sectionBytes[ordinal]!
    const section = {
      ordinal: String(ordinal), kind, subjectDigest: digest(subject), byteOffset: String(offset),
      byteLength: String(bytes.byteLength), sha256: ordinarySha256(bytes),
    }
    offset += bytes.byteLength
    return section
  })
  const index = parseCheckpointValidationCarrierIndex({
    format: "convax.checkpoint-validation-carrier-index",
    scope,
    proposalCheckpointDigest: digest("proposal-checkpoint"),
    parentCheckpointDigests: [],
    suffixFrameDigests: [],
    validationArtifactSetDigest: digest("artifact-set"),
    sections,
    totalSectionBytes: String(offset),
    protocolDigest: CURRENT_PROTOCOL_IDENTITIES.protocolDigest,
  })
  return { index, sectionBytes }
}

describe("CVXCAR02 checkpoint validation carrier", () => {
  test("round-trips exact canonical index and binary section bytes", () => {
    const { index, sectionBytes } = fixture()
    const encoded = encodeCheckpointValidationCarrier(index, sectionBytes)
    expect(new TextDecoder().decode(encoded.subarray(0, 8))).toBe("CVXCAR02")
    expect(BigInt(parseCheckpointValidationCarrierPreamble(encoded.subarray(0, 16)).indexByteLength)).toBeGreaterThan(0n)
    const decoded = decodeCheckpointValidationCarrier(encoded)
    expect(decoded.index).toEqual(index)
    expect(decoded.exactSectionBytes.map((bytes) => new TextDecoder().decode(bytes))).toEqual([
      "checkpoint", "snapshot", "artifact-a", "artifact-b", "artifact-c", "artifact-d",
    ])
    encoded.fill(0)
    expect(new TextDecoder().decode(decoded.exactSectionBytes[0])).toBe("checkpoint")
  })

  test("rejects magic, trailing bytes and section hash corruption", () => {
    const { index, sectionBytes } = fixture()
    const encoded = encodeCheckpointValidationCarrier(index, sectionBytes)
    const badMagic = encoded.slice()
    badMagic[0] ^= 1
    expect(() => decodeCheckpointValidationCarrier(badMagic)).toThrow("magic")
    const trailing = new Uint8Array(encoded.byteLength + 1)
    trailing.set(encoded)
    expect(() => decodeCheckpointValidationCarrier(trailing)).toThrow("total byte length")
    const corrupt = encoded.slice()
    corrupt[corrupt.byteLength - 1] ^= 1
    expect(() => decodeCheckpointValidationCarrier(corrupt)).toThrow("SHA-256")
  })

  test("rejects gaps, missing protocol artifacts and oversized proposal snapshots before allocation", () => {
    const { index } = fixture()
    const plain = { ...index, sections: index.sections.map((section) => ({ ...section })) }
    plain.sections[1]!.byteOffset = parseUint64("999")
    expect(() => parseCheckpointValidationCarrierIndex(plain)).toThrow("gap or overlap")

    const threeArtifacts = { ...index, sections: index.sections.map((section) => ({ ...section })) }
    threeArtifacts.sections.pop()
    const removed = BigInt(index.sections[index.sections.length - 1]!.byteLength)
    threeArtifacts.totalSectionBytes = parseUint64((BigInt(threeArtifacts.totalSectionBytes) - removed).toString())
    expect(() => parseCheckpointValidationCarrierIndex(threeArtifacts)).toThrow("four protocol artifacts")

    const oversized = { ...index, sections: index.sections.map((section) => ({ ...section })) }
    const delta = BigInt(32 * 1024 * 1024 + 1) - BigInt(oversized.sections[1]!.byteLength)
    oversized.sections[1]!.byteLength = parseUint64(String(32 * 1024 * 1024 + 1))
    for (let ordinal = 2; ordinal < oversized.sections.length; ordinal += 1) {
      oversized.sections[ordinal]!.byteOffset = parseUint64((BigInt(oversized.sections[ordinal]!.byteOffset) + delta).toString())
    }
    oversized.totalSectionBytes = parseUint64((BigInt(oversized.totalSectionBytes) + delta).toString())
    expect(() => parseCheckpointValidationCarrierIndex(oversized)).toThrow("32 MiB")
  })
})
