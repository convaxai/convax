import type { DigestV2, Uint32V2, Uint64V2 } from "./codecs"
import {
  parseDigestV2,
  parseUint32V2,
  parseUint64V2,
  uint32ToNumberV2,
  uint64ToBigIntV2,
} from "./codecs"
import { PINNED_AUTHORITY_IDENTITIES_V2 } from "./constants"
import type { DocumentScopeV2 } from "./contracts"
import { ordinarySha256V2 } from "./digest"
import { failCodec } from "./errors"
import {
  assertDenseArrayV2,
  assertExactKeysV2,
  compareUtf8V2,
  decodeRestrictedJcsV2,
  encodeRestrictedJcsV2,
} from "./jcs"
import { parseDocumentScopeV2 } from "./parse"

const encoder = new TextEncoder()
const MAGIC = encoder.encode("CVXCAR02")
const PREAMBLE_BYTES = 16

export const CHECKPOINT_VALIDATION_CARRIER_PREAMBLE_BYTES_V2 = PREAMBLE_BYTES

export const CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2 = Object.freeze({
  indexBytes: 4 * 1024 * 1024,
  proposalSnapshotBytes: 32 * 1024 * 1024,
  snapshotBytes: 256 * 1024 * 1024,
  suffixFrames: 4_096,
  suffixBytes: 64 * 1024 * 1024,
  validationArtifacts: 64,
  sections: 4_224,
  carrierBytes: 320 * 1024 * 1024,
} as const)

export type CheckpointCarrierSectionKindV2 =
  | "proposal-checkpoint"
  | "proposal-snapshot"
  | "parent-checkpoint"
  | "parent-snapshot"
  | "content-certificate"
  | "causal-frame"
  | "validation-artifact"

export interface CheckpointCarrierSectionV2 {
  readonly ordinal: Uint32V2
  readonly kind: CheckpointCarrierSectionKindV2
  readonly subjectDigest: DigestV2
  readonly byteOffset: Uint64V2
  readonly byteLength: Uint64V2
  readonly sha256: DigestV2
}

export interface CheckpointValidationCarrierIndexV2 {
  readonly format: "convax.checkpoint-validation-carrier-index/2"
  readonly scope: DocumentScopeV2
  readonly proposalCheckpointDigest: DigestV2
  readonly parentCheckpointDigests: readonly DigestV2[]
  readonly suffixFrameDigests: readonly DigestV2[]
  readonly validationArtifactSetDigest: DigestV2
  readonly sections: readonly CheckpointCarrierSectionV2[]
  readonly totalSectionBytes: Uint64V2
  readonly protocolDigest: DigestV2
}

export interface DecodedCheckpointValidationCarrierV2 {
  readonly index: CheckpointValidationCarrierIndexV2
  readonly exactIndexBytes: Uint8Array
  readonly exactSectionBytes: readonly Uint8Array[]
}

export interface CheckpointValidationCarrierPreambleV2 {
  readonly indexByteLength: Uint64V2
}

/** Parses the exact fixed-size prefix before an adapter allocates or reads the bounded JCS index. */
export function parseCheckpointValidationCarrierPreambleV2(bytes: Uint8Array): CheckpointValidationCarrierPreambleV2 {
  requireBytes(bytes, "Checkpoint validation carrier preamble")
  if (bytes.byteLength !== PREAMBLE_BYTES) invalid("Checkpoint carrier preamble must contain exactly 16 bytes")
  for (let index = 0; index < MAGIC.byteLength; index += 1) {
    if (bytes[index] !== MAGIC[index]) invalid("Checkpoint carrier magic is invalid")
  }
  const indexByteLength = parseUint64V2(readU64be(bytes, MAGIC.byteLength).toString())
  const length = uint64ToBigIntV2(indexByteLength)
  if (length < 1n || length > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2.indexBytes)) {
    invalid("Checkpoint carrier index length is outside the frozen limit")
  }
  return Object.freeze({ indexByteLength })
}

export function parseCheckpointValidationCarrierIndexV2(value: unknown): CheckpointValidationCarrierIndexV2 {
  assertExactKeysV2(value, [
    "format",
    "scope",
    "proposalCheckpointDigest",
    "parentCheckpointDigests",
    "suffixFrameDigests",
    "validationArtifactSetDigest",
    "sections",
    "totalSectionBytes",
    "protocolDigest",
  ], "CheckpointValidationCarrierIndexV2")
  if (value.format !== "convax.checkpoint-validation-carrier-index/2") invalid("Checkpoint carrier index format is invalid")
  const protocolDigest = parseDigestV2(value.protocolDigest)
  if (protocolDigest !== PINNED_AUTHORITY_IDENTITIES_V2.protocolDigest) invalid("Checkpoint carrier protocol digest is not the frozen v2 digest")
  const proposalCheckpointDigest = parseDigestV2(value.proposalCheckpointDigest)
  const parentCheckpointDigests = parseDigestList(value.parentCheckpointDigests, 8, "parent checkpoint digests")
  const suffixFrameDigests = parseDigestList(value.suffixFrameDigests, CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2.suffixFrames, "suffix frame digests")
  assertDenseArrayV2(value.sections, "Checkpoint carrier sections")
  if (value.sections.length > CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2.sections) invalid("Checkpoint carrier exceeds the section-count limit")
  const sections = value.sections.map(parseCheckpointCarrierSectionV2)
  const totalSectionBytes = parseUint64V2(value.totalSectionBytes)
  assertSectionGeometry(sections, totalSectionBytes)
  assertSectionCardinality(sections, proposalCheckpointDigest, parentCheckpointDigests, suffixFrameDigests)
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScopeV2(value.scope),
    proposalCheckpointDigest,
    parentCheckpointDigests,
    suffixFrameDigests,
    validationArtifactSetDigest: parseDigestV2(value.validationArtifactSetDigest),
    sections: Object.freeze(sections),
    totalSectionBytes,
    protocolDigest,
  })
}

export function parseCheckpointValidationCarrierIndexBytesV2(bytes: Uint8Array): CheckpointValidationCarrierIndexV2 {
  requireBytes(bytes, "Checkpoint carrier index")
  if (bytes.byteLength < 1 || bytes.byteLength > CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2.indexBytes) {
    invalid("Checkpoint carrier index byte length is outside the frozen limit")
  }
  return parseCheckpointValidationCarrierIndexV2(decodeRestrictedJcsV2(bytes))
}

export function decodeCheckpointValidationCarrierV2(bytes: Uint8Array): DecodedCheckpointValidationCarrierV2 {
  requireBytes(bytes, "Checkpoint validation carrier")
  if (bytes.byteLength > CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2.carrierBytes) invalid("Checkpoint carrier exceeds the whole-carrier limit")
  if (bytes.byteLength < PREAMBLE_BYTES) invalid("Checkpoint carrier is truncated before its preamble")
  const { indexByteLength } = parseCheckpointValidationCarrierPreambleV2(bytes.subarray(0, PREAMBLE_BYTES))
  const indexLength = uint64ToBigIntV2(indexByteLength)
  const firstSectionOffset = BigInt(PREAMBLE_BYTES) + indexLength
  if (firstSectionOffset > BigInt(bytes.byteLength)) invalid("Checkpoint carrier index is truncated")
  const firstSectionOffsetNumber = Number(firstSectionOffset)
  const borrowedIndexBytes = bytes.subarray(PREAMBLE_BYTES, firstSectionOffsetNumber)
  const index = parseCheckpointValidationCarrierIndexBytesV2(borrowedIndexBytes)
  const expectedLength = firstSectionOffset + uint64ToBigIntV2(index.totalSectionBytes)
  if (expectedLength !== BigInt(bytes.byteLength) || expectedLength > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2.carrierBytes)) {
    invalid("Checkpoint carrier total byte length does not match its index")
  }
  const exactSectionBytes = index.sections.map((section) => {
    const start = firstSectionOffset + uint64ToBigIntV2(section.byteOffset)
    const end = start + uint64ToBigIntV2(section.byteLength)
    if (end > BigInt(bytes.byteLength)) invalid("Checkpoint carrier section exceeds the carrier bytes")
    const borrowedSectionBytes = bytes.subarray(Number(start), Number(end))
    if (ordinarySha256V2(borrowedSectionBytes) !== section.sha256) invalid("Checkpoint carrier section SHA-256 mismatches")
    return Uint8Array.from(borrowedSectionBytes)
  })
  return Object.freeze({
    index,
    exactIndexBytes: Uint8Array.from(borrowedIndexBytes),
    exactSectionBytes: Object.freeze(exactSectionBytes),
  })
}

export function encodeCheckpointValidationCarrierV2(
  indexValue: CheckpointValidationCarrierIndexV2,
  sectionBytesValue: readonly Uint8Array[],
): Uint8Array {
  const index = parseCheckpointValidationCarrierIndexV2(indexValue)
  assertDenseArrayV2(sectionBytesValue, "Checkpoint carrier section bytes")
  if (sectionBytesValue.length !== index.sections.length) invalid("Checkpoint carrier section byte count mismatches the index")
  const exactIndexBytes = encodeRestrictedJcsV2(index)
  if (exactIndexBytes.byteLength > CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2.indexBytes) invalid("Checkpoint carrier index exceeds the byte limit")
  const totalLength = BigInt(PREAMBLE_BYTES + exactIndexBytes.byteLength) + uint64ToBigIntV2(index.totalSectionBytes)
  if (totalLength > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2.carrierBytes)) invalid("Checkpoint carrier exceeds the whole-carrier limit")
  const output = new Uint8Array(Number(totalLength))
  output.set(MAGIC)
  writeU64be(output, MAGIC.byteLength, BigInt(exactIndexBytes.byteLength))
  output.set(exactIndexBytes, PREAMBLE_BYTES)
  const firstSectionOffset = PREAMBLE_BYTES + exactIndexBytes.byteLength
  for (let ordinal = 0; ordinal < index.sections.length; ordinal += 1) {
    const section = index.sections[ordinal]!
    const exactBytes = sectionBytesValue[ordinal]
    requireBytes(exactBytes, `Checkpoint carrier section ${ordinal}`)
    if (BigInt(exactBytes.byteLength) !== uint64ToBigIntV2(section.byteLength)) invalid("Checkpoint carrier section byte length mismatches")
    if (ordinarySha256V2(exactBytes) !== section.sha256) invalid("Checkpoint carrier section SHA-256 mismatches")
    output.set(exactBytes, firstSectionOffset + Number(uint64ToBigIntV2(section.byteOffset)))
  }
  return output
}

function parseCheckpointCarrierSectionV2(value: unknown): CheckpointCarrierSectionV2 {
  assertExactKeysV2(value, ["ordinal", "kind", "subjectDigest", "byteOffset", "byteLength", "sha256"], "CheckpointCarrierSectionV2")
  if (!isSectionKind(value.kind)) invalid("Checkpoint carrier section kind is invalid")
  const byteLength = parseUint64V2(value.byteLength)
  if (byteLength === "0") invalid("Checkpoint carrier sections cannot be empty")
  return Object.freeze({
    ordinal: parseUint32V2(value.ordinal),
    kind: value.kind,
    subjectDigest: parseDigestV2(value.subjectDigest),
    byteOffset: parseUint64V2(value.byteOffset),
    byteLength,
    sha256: parseDigestV2(value.sha256),
  })
}

function assertSectionGeometry(sections: readonly CheckpointCarrierSectionV2[], totalSectionBytes: Uint64V2): void {
  let nextOffset = 0n
  let snapshotBytes = 0n
  let suffixBytes = 0n
  let proposalSnapshotBytes = 0n
  for (let ordinal = 0; ordinal < sections.length; ordinal += 1) {
    const section = sections[ordinal]!
    if (uint32ToNumberV2(section.ordinal) !== ordinal) invalid("Checkpoint carrier section ordinals must start at zero and be contiguous")
    if (uint64ToBigIntV2(section.byteOffset) !== nextOffset) invalid("Checkpoint carrier section offsets contain a gap or overlap")
    const byteLength = uint64ToBigIntV2(section.byteLength)
    nextOffset += byteLength
    if (nextOffset > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2.carrierBytes)) invalid("Checkpoint carrier section bytes exceed the whole-carrier limit")
    if (section.kind === "proposal-snapshot") proposalSnapshotBytes += byteLength
    if (section.kind === "proposal-snapshot" || section.kind === "parent-snapshot") snapshotBytes += byteLength
    if (section.kind === "causal-frame") suffixBytes += byteLength
  }
  if (nextOffset !== uint64ToBigIntV2(totalSectionBytes)) invalid("Checkpoint carrier totalSectionBytes mismatches its contiguous sections")
  if (proposalSnapshotBytes > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2.proposalSnapshotBytes)) invalid("Checkpoint proposal snapshot exceeds 32 MiB")
  if (snapshotBytes > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2.snapshotBytes)) invalid("Checkpoint proposal plus parent snapshots exceed 256 MiB")
  if (suffixBytes > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2.suffixBytes)) invalid("Checkpoint causal suffix exceeds 64 MiB")
}

function assertSectionCardinality(
  sections: readonly CheckpointCarrierSectionV2[],
  proposalCheckpointDigest: DigestV2,
  parentCheckpointDigests: readonly DigestV2[],
  suffixFrameDigests: readonly DigestV2[],
): void {
  const byKind = (kind: CheckpointCarrierSectionKindV2) => sections.filter((section) => section.kind === kind)
  const proposalCheckpoints = byKind("proposal-checkpoint")
  if (proposalCheckpoints.length !== 1 || proposalCheckpoints[0]!.subjectDigest !== proposalCheckpointDigest) {
    invalid("Checkpoint carrier must contain its exact proposal checkpoint once")
  }
  if (byKind("proposal-snapshot").length !== 1) invalid("Checkpoint carrier must contain exactly one proposal snapshot")
  assertExactSubjectSet(byKind("parent-checkpoint"), parentCheckpointDigests, "parent checkpoint")
  if (byKind("parent-snapshot").length !== parentCheckpointDigests.length) invalid("Checkpoint carrier parent snapshot count mismatches its parent list")
  if (byKind("content-certificate").length !== parentCheckpointDigests.length) invalid("Checkpoint carrier content certificate count mismatches its parent list")
  assertExactSubjectSet(byKind("causal-frame"), suffixFrameDigests, "causal suffix frame")
  const artifactCount = byKind("validation-artifact").length
  if (artifactCount < 4 || artifactCount > CHECKPOINT_VALIDATION_CARRIER_LIMITS_V2.validationArtifacts) {
    invalid("Checkpoint carrier validation artifacts must contain the four protocol artifacts and stay within 64 sections")
  }
}

function assertExactSubjectSet(sections: readonly CheckpointCarrierSectionV2[], expected: readonly DigestV2[], label: string): void {
  const actual = sections.map((section) => section.subjectDigest).sort(compareUtf8V2)
  if (actual.length !== expected.length || actual.some((digest, index) => digest !== expected[index])) {
    invalid(`Checkpoint carrier ${label} subjects do not match the declared digest set`)
  }
}

function parseDigestList(value: unknown, maximum: number, label: string): readonly DigestV2[] {
  assertDenseArrayV2(value, label)
  if (value.length > maximum) invalid(`${label} exceed the frozen count limit`)
  const result = value.map(parseDigestV2)
  for (let index = 1; index < result.length; index += 1) {
    if (compareUtf8V2(result[index - 1]!, result[index]!) >= 0) invalid(`${label} must be strictly sorted and duplicate-free`)
  }
  return Object.freeze(result)
}

function isSectionKind(value: unknown): value is CheckpointCarrierSectionKindV2 {
  return value === "proposal-checkpoint"
    || value === "proposal-snapshot"
    || value === "parent-checkpoint"
    || value === "parent-snapshot"
    || value === "content-certificate"
    || value === "causal-frame"
    || value === "validation-artifact"
}

function readU64be(bytes: Uint8Array, offset: number): bigint {
  let value = 0n
  for (let index = 0; index < 8; index += 1) value = (value << 8n) | BigInt(bytes[offset + index]!)
  return value
}

function writeU64be(bytes: Uint8Array, offset: number, value: bigint): void {
  for (let index = 7; index >= 0; index -= 1) {
    bytes[offset + index] = Number(value & 0xffn)
    value >>= 8n
  }
}

function requireBytes(value: unknown, label: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) invalid(`${label} must be Uint8Array`)
}

function invalid(message: string): never {
  return failCodec(message)
}
