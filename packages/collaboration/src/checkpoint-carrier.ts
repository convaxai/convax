import type { Digest, Uint32, Uint64 } from "./codecs"
import {
  parseDigest,
  parseUint32,
  parseUint64,
  uint32ToNumber,
  uint64ToBigInt,
} from "./codecs"
import { CURRENT_PROTOCOL_IDENTITIES } from "./constants"
import type { DocumentScope } from "./contracts"
import { ordinarySha256 } from "./digest"
import { failCodec } from "./errors"
import {
  assertDenseArray,
  assertExactKeys,
  compareUtf8,
  decodeRestrictedJcs,
  encodeRestrictedJcs,
} from "./jcs"
import { parseDocumentScope } from "./parse"

const encoder = new TextEncoder()
const MAGIC = encoder.encode("CVXCAR02")
const PREAMBLE_BYTES = 16

export const CHECKPOINT_VALIDATION_CARRIER_PREAMBLE_BYTES = PREAMBLE_BYTES

export const CHECKPOINT_VALIDATION_CARRIER_LIMITS = Object.freeze({
  indexBytes: 4 * 1024 * 1024,
  proposalSnapshotBytes: 32 * 1024 * 1024,
  snapshotBytes: 256 * 1024 * 1024,
  suffixFrames: 4_096,
  suffixBytes: 64 * 1024 * 1024,
  validationArtifacts: 64,
  sections: 4_224,
  carrierBytes: 320 * 1024 * 1024,
} as const)

export type CheckpointCarrierSectionKind =
  | "proposal-checkpoint"
  | "proposal-snapshot"
  | "parent-checkpoint"
  | "parent-snapshot"
  | "content-certificate"
  | "causal-frame"
  | "validation-artifact"

export interface CheckpointCarrierSection {
  readonly ordinal: Uint32
  readonly kind: CheckpointCarrierSectionKind
  readonly subjectDigest: Digest
  readonly byteOffset: Uint64
  readonly byteLength: Uint64
  readonly sha256: Digest
}

export interface CheckpointValidationCarrierIndex {
  readonly format: "convax.checkpoint-validation-carrier-index/2"
  readonly scope: DocumentScope
  readonly proposalCheckpointDigest: Digest
  readonly parentCheckpointDigests: readonly Digest[]
  readonly suffixFrameDigests: readonly Digest[]
  readonly validationArtifactSetDigest: Digest
  readonly sections: readonly CheckpointCarrierSection[]
  readonly totalSectionBytes: Uint64
  readonly protocolDigest: Digest
}

export interface DecodedCheckpointValidationCarrier {
  readonly index: CheckpointValidationCarrierIndex
  readonly exactIndexBytes: Uint8Array
  readonly exactSectionBytes: readonly Uint8Array[]
}

export interface CheckpointValidationCarrierPreamble {
  readonly indexByteLength: Uint64
}

/** Parses the exact fixed-size prefix before an adapter allocates or reads the bounded JCS index. */
export function parseCheckpointValidationCarrierPreamble(bytes: Uint8Array): CheckpointValidationCarrierPreamble {
  requireBytes(bytes, "Checkpoint validation carrier preamble")
  if (bytes.byteLength !== PREAMBLE_BYTES) invalid("Checkpoint carrier preamble must contain exactly 16 bytes")
  for (let index = 0; index < MAGIC.byteLength; index += 1) {
    if (bytes[index] !== MAGIC[index]) invalid("Checkpoint carrier magic is invalid")
  }
  const indexByteLength = parseUint64(readU64be(bytes, MAGIC.byteLength).toString())
  const length = uint64ToBigInt(indexByteLength)
  if (length < 1n || length > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS.indexBytes)) {
    invalid("Checkpoint carrier index length is outside the frozen limit")
  }
  return Object.freeze({ indexByteLength })
}

export function parseCheckpointValidationCarrierIndex(value: unknown): CheckpointValidationCarrierIndex {
  assertExactKeys(value, [
    "format",
    "scope",
    "proposalCheckpointDigest",
    "parentCheckpointDigests",
    "suffixFrameDigests",
    "validationArtifactSetDigest",
    "sections",
    "totalSectionBytes",
    "protocolDigest",
  ], "CheckpointValidationCarrierIndex")
  if (value.format !== "convax.checkpoint-validation-carrier-index/2") invalid("Checkpoint carrier index format is invalid")
  const protocolDigest = parseDigest(value.protocolDigest)
  if (protocolDigest !== CURRENT_PROTOCOL_IDENTITIES.protocolDigest) invalid("Checkpoint carrier protocol digest is not the current protocol digest")
  const proposalCheckpointDigest = parseDigest(value.proposalCheckpointDigest)
  const parentCheckpointDigests = parseDigestList(value.parentCheckpointDigests, 8, "parent checkpoint digests")
  const suffixFrameDigests = parseDigestList(value.suffixFrameDigests, CHECKPOINT_VALIDATION_CARRIER_LIMITS.suffixFrames, "suffix frame digests")
  assertDenseArray(value.sections, "Checkpoint carrier sections")
  if (value.sections.length > CHECKPOINT_VALIDATION_CARRIER_LIMITS.sections) invalid("Checkpoint carrier exceeds the section-count limit")
  const sections = value.sections.map(parseCheckpointCarrierSection)
  const totalSectionBytes = parseUint64(value.totalSectionBytes)
  assertSectionGeometry(sections, totalSectionBytes)
  assertSectionCardinality(sections, proposalCheckpointDigest, parentCheckpointDigests, suffixFrameDigests)
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScope(value.scope),
    proposalCheckpointDigest,
    parentCheckpointDigests,
    suffixFrameDigests,
    validationArtifactSetDigest: parseDigest(value.validationArtifactSetDigest),
    sections: Object.freeze(sections),
    totalSectionBytes,
    protocolDigest,
  })
}

export function parseCheckpointValidationCarrierIndexBytes(bytes: Uint8Array): CheckpointValidationCarrierIndex {
  requireBytes(bytes, "Checkpoint carrier index")
  if (bytes.byteLength < 1 || bytes.byteLength > CHECKPOINT_VALIDATION_CARRIER_LIMITS.indexBytes) {
    invalid("Checkpoint carrier index byte length is outside the frozen limit")
  }
  return parseCheckpointValidationCarrierIndex(decodeRestrictedJcs(bytes))
}

export function decodeCheckpointValidationCarrier(bytes: Uint8Array): DecodedCheckpointValidationCarrier {
  requireBytes(bytes, "Checkpoint validation carrier")
  if (bytes.byteLength > CHECKPOINT_VALIDATION_CARRIER_LIMITS.carrierBytes) invalid("Checkpoint carrier exceeds the whole-carrier limit")
  if (bytes.byteLength < PREAMBLE_BYTES) invalid("Checkpoint carrier is truncated before its preamble")
  const { indexByteLength } = parseCheckpointValidationCarrierPreamble(bytes.subarray(0, PREAMBLE_BYTES))
  const indexLength = uint64ToBigInt(indexByteLength)
  const firstSectionOffset = BigInt(PREAMBLE_BYTES) + indexLength
  if (firstSectionOffset > BigInt(bytes.byteLength)) invalid("Checkpoint carrier index is truncated")
  const firstSectionOffsetNumber = Number(firstSectionOffset)
  const borrowedIndexBytes = bytes.subarray(PREAMBLE_BYTES, firstSectionOffsetNumber)
  const index = parseCheckpointValidationCarrierIndexBytes(borrowedIndexBytes)
  const expectedLength = firstSectionOffset + uint64ToBigInt(index.totalSectionBytes)
  if (expectedLength !== BigInt(bytes.byteLength) || expectedLength > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS.carrierBytes)) {
    invalid("Checkpoint carrier total byte length does not match its index")
  }
  const exactSectionBytes = index.sections.map((section) => {
    const start = firstSectionOffset + uint64ToBigInt(section.byteOffset)
    const end = start + uint64ToBigInt(section.byteLength)
    if (end > BigInt(bytes.byteLength)) invalid("Checkpoint carrier section exceeds the carrier bytes")
    const borrowedSectionBytes = bytes.subarray(Number(start), Number(end))
    if (ordinarySha256(borrowedSectionBytes) !== section.sha256) invalid("Checkpoint carrier section SHA-256 mismatches")
    return Uint8Array.from(borrowedSectionBytes)
  })
  return Object.freeze({
    index,
    exactIndexBytes: Uint8Array.from(borrowedIndexBytes),
    exactSectionBytes: Object.freeze(exactSectionBytes),
  })
}

export function encodeCheckpointValidationCarrier(
  indexValue: CheckpointValidationCarrierIndex,
  sectionBytesValue: readonly Uint8Array[],
): Uint8Array {
  const index = parseCheckpointValidationCarrierIndex(indexValue)
  assertDenseArray(sectionBytesValue, "Checkpoint carrier section bytes")
  if (sectionBytesValue.length !== index.sections.length) invalid("Checkpoint carrier section byte count mismatches the index")
  const exactIndexBytes = encodeRestrictedJcs(index)
  if (exactIndexBytes.byteLength > CHECKPOINT_VALIDATION_CARRIER_LIMITS.indexBytes) invalid("Checkpoint carrier index exceeds the byte limit")
  const totalLength = BigInt(PREAMBLE_BYTES + exactIndexBytes.byteLength) + uint64ToBigInt(index.totalSectionBytes)
  if (totalLength > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS.carrierBytes)) invalid("Checkpoint carrier exceeds the whole-carrier limit")
  const output = new Uint8Array(Number(totalLength))
  output.set(MAGIC)
  writeU64be(output, MAGIC.byteLength, BigInt(exactIndexBytes.byteLength))
  output.set(exactIndexBytes, PREAMBLE_BYTES)
  const firstSectionOffset = PREAMBLE_BYTES + exactIndexBytes.byteLength
  for (let ordinal = 0; ordinal < index.sections.length; ordinal += 1) {
    const section = index.sections[ordinal]!
    const exactBytes = sectionBytesValue[ordinal]
    requireBytes(exactBytes, `Checkpoint carrier section ${ordinal}`)
    if (BigInt(exactBytes.byteLength) !== uint64ToBigInt(section.byteLength)) invalid("Checkpoint carrier section byte length mismatches")
    if (ordinarySha256(exactBytes) !== section.sha256) invalid("Checkpoint carrier section SHA-256 mismatches")
    output.set(exactBytes, firstSectionOffset + Number(uint64ToBigInt(section.byteOffset)))
  }
  return output
}

function parseCheckpointCarrierSection(value: unknown): CheckpointCarrierSection {
  assertExactKeys(value, ["ordinal", "kind", "subjectDigest", "byteOffset", "byteLength", "sha256"], "CheckpointCarrierSection")
  if (!isSectionKind(value.kind)) invalid("Checkpoint carrier section kind is invalid")
  const byteLength = parseUint64(value.byteLength)
  if (byteLength === "0") invalid("Checkpoint carrier sections cannot be empty")
  return Object.freeze({
    ordinal: parseUint32(value.ordinal),
    kind: value.kind,
    subjectDigest: parseDigest(value.subjectDigest),
    byteOffset: parseUint64(value.byteOffset),
    byteLength,
    sha256: parseDigest(value.sha256),
  })
}

function assertSectionGeometry(sections: readonly CheckpointCarrierSection[], totalSectionBytes: Uint64): void {
  let nextOffset = 0n
  let snapshotBytes = 0n
  let suffixBytes = 0n
  let proposalSnapshotBytes = 0n
  for (let ordinal = 0; ordinal < sections.length; ordinal += 1) {
    const section = sections[ordinal]!
    if (uint32ToNumber(section.ordinal) !== ordinal) invalid("Checkpoint carrier section ordinals must start at zero and be contiguous")
    if (uint64ToBigInt(section.byteOffset) !== nextOffset) invalid("Checkpoint carrier section offsets contain a gap or overlap")
    const byteLength = uint64ToBigInt(section.byteLength)
    nextOffset += byteLength
    if (nextOffset > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS.carrierBytes)) invalid("Checkpoint carrier section bytes exceed the whole-carrier limit")
    if (section.kind === "proposal-snapshot") proposalSnapshotBytes += byteLength
    if (section.kind === "proposal-snapshot" || section.kind === "parent-snapshot") snapshotBytes += byteLength
    if (section.kind === "causal-frame") suffixBytes += byteLength
  }
  if (nextOffset !== uint64ToBigInt(totalSectionBytes)) invalid("Checkpoint carrier totalSectionBytes mismatches its contiguous sections")
  if (proposalSnapshotBytes > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS.proposalSnapshotBytes)) invalid("Checkpoint proposal snapshot exceeds 32 MiB")
  if (snapshotBytes > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS.snapshotBytes)) invalid("Checkpoint proposal plus parent snapshots exceed 256 MiB")
  if (suffixBytes > BigInt(CHECKPOINT_VALIDATION_CARRIER_LIMITS.suffixBytes)) invalid("Checkpoint causal suffix exceeds 64 MiB")
}

function assertSectionCardinality(
  sections: readonly CheckpointCarrierSection[],
  proposalCheckpointDigest: Digest,
  parentCheckpointDigests: readonly Digest[],
  suffixFrameDigests: readonly Digest[],
): void {
  const byKind = (kind: CheckpointCarrierSectionKind) => sections.filter((section) => section.kind === kind)
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
  if (artifactCount < 4 || artifactCount > CHECKPOINT_VALIDATION_CARRIER_LIMITS.validationArtifacts) {
    invalid("Checkpoint carrier validation artifacts must contain the four protocol artifacts and stay within 64 sections")
  }
}

function assertExactSubjectSet(sections: readonly CheckpointCarrierSection[], expected: readonly Digest[], label: string): void {
  const actual = sections.map((section) => section.subjectDigest).sort(compareUtf8)
  if (actual.length !== expected.length || actual.some((digest, index) => digest !== expected[index])) {
    invalid(`Checkpoint carrier ${label} subjects do not match the declared digest set`)
  }
}

function parseDigestList(value: unknown, maximum: number, label: string): readonly Digest[] {
  assertDenseArray(value, label)
  if (value.length > maximum) invalid(`${label} exceed the frozen count limit`)
  const result = value.map(parseDigest)
  for (let index = 1; index < result.length; index += 1) {
    if (compareUtf8(result[index - 1]!, result[index]!) >= 0) invalid(`${label} must be strictly sorted and duplicate-free`)
  }
  return Object.freeze(result)
}

function isSectionKind(value: unknown): value is CheckpointCarrierSectionKind {
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
