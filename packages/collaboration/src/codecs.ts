import { failCodec } from "./errors"
import { assertNfcScalarString, compareBytes, utf8ByteLength } from "./jcs"

declare const id128V2Brand: unique symbol
declare const actorIdV2Brand: unique symbol
declare const digestV2Brand: unique symbol
declare const signatureV2Brand: unique symbol
declare const publicKeyV2Brand: unique symbol
declare const memberIdV2Brand: unique symbol
declare const replicaIdV2Brand: unique symbol
declare const sessionIdV2Brand: unique symbol
declare const peerIdV2Brand: unique symbol
declare const canvasIdV2Brand: unique symbol
declare const projectIdV2Brand: unique symbol
declare const uint32V2Brand: unique symbol
declare const uint64V2Brand: unique symbol
declare const stateVectorV2Brand: unique symbol

export type Id128 = string & { readonly [id128V2Brand]: "Id128" }
export type ActorId = string & { readonly [actorIdV2Brand]: "ActorId" }
export type Digest = string & { readonly [digestV2Brand]: "Digest" }
export type Signature = string & { readonly [signatureV2Brand]: "Signature" }
export type PublicKey = string & { readonly [publicKeyV2Brand]: "PublicKey" }
export type MemberId = Id128 & { readonly [memberIdV2Brand]: "MemberId" }
export type ReplicaId = string & { readonly [replicaIdV2Brand]: "ReplicaId" }
export type SessionId = Id128 & { readonly [sessionIdV2Brand]: "SessionId" }
export type PeerId = string & { readonly [peerIdV2Brand]: "PeerId" }
export type CanvasId = `cv_${string}` & { readonly [canvasIdV2Brand]: "CanvasId" }
export type ProjectId = string & { readonly [projectIdV2Brand]: "ProjectId" }
export type Uint32 = string & { readonly [uint32V2Brand]: "Uint32" }
export type Uint64 = string & { readonly [uint64V2Brand]: "Uint64" }
export type StateVector = Uint8Array & { readonly [stateVectorV2Brand]: "StateVector" }

const BASE64URL = /^[A-Za-z0-9_-]+$/
const DIGEST = /^[0-9a-f]{64}$/
const CANVAS_ID = /^cv_[0-9a-f]{64}$/
const REPLICA_ID = /^replica_[0-9a-f]{8}$/
const PEER_ID = /^peer_[a-z2-7]{26}$/
const UINT = /^(0|[1-9][0-9]*)$/
const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"

export function parseId128(value: unknown): Id128 {
  return parseFixedBase64url(value, 16, 22, "Id128") as Id128
}

export function parseActorId(value: unknown): ActorId {
  return parseFixedBase64url(value, 32, 43, "ActorId") as ActorId
}

export function parseDigest(value: unknown): Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) failCodec("Digest must be exactly 64 lowercase hexadecimal characters")
  return value as Digest
}

export function parseSignature(value: unknown): Signature {
  return parseFixedBase64url(value, 64, 86, "Signature") as Signature
}

export function parsePublicKey(value: unknown): PublicKey {
  return parseFixedBase64url(value, 32, 43, "PublicKey") as PublicKey
}

export function parseMemberId(value: unknown): MemberId {
  return parseId128(value) as MemberId
}

export function parseSessionId(value: unknown): SessionId {
  return parseId128(value) as SessionId
}

export function parseReplicaId(value: unknown): ReplicaId {
  if (typeof value !== "string" || !REPLICA_ID.test(value)) {
    failCodec("ReplicaId must be replica_ followed by eight lowercase hexadecimal digits")
  }
  if (Number.parseInt(value.slice(8), 16) === 0) failCodec("ReplicaId zero is forbidden")
  return value as ReplicaId
}

export function replicaIdToYjsClientId(value: ReplicaId | string): number {
  const parsed = parseReplicaId(value)
  return Number.parseInt(parsed.slice(8), 16)
}

export function parsePeerId(value: unknown): PeerId {
  if (typeof value !== "string" || !PEER_ID.test(value)) {
    failCodec("PeerId must be peer_ followed by 26 lowercase base32 characters")
  }
  const decoded = decodeBase32(value.slice(5))
  if (decoded.byteLength !== 16 || encodeBase32(decoded) !== value.slice(5)) failCodec("PeerId is not canonical")
  return value as PeerId
}

export function parseCanvasId(value: unknown): CanvasId {
  if (typeof value !== "string" || !CANVAS_ID.test(value)) {
    failCodec("CanvasId must be cv_ followed by exactly 64 lowercase hexadecimal digits")
  }
  return value as CanvasId
}

/** The generated global-URI descriptor closes this codec without a runtime package edge. */
export function parseProjectId(value: unknown): ProjectId {
  if (typeof value !== "string" || !PROJECT_ID.test(value)) {
    failCodec("ProjectId does not satisfy the frozen global URI owner codec")
  }
  return value as ProjectId
}

export function parseUint32(value: unknown): Uint32 {
  return parseCanonicalUint(value, 0xffff_ffffn, "Uint32") as Uint32
}

export function parseUint64(value: unknown): Uint64 {
  return parseCanonicalUint(value, 0xffff_ffff_ffff_ffffn, "Uint64") as Uint64
}

export function uint64ToBigInt(value: Uint64 | string): bigint {
  return BigInt(parseUint64(value))
}

export function uint32ToNumber(value: Uint32 | string): number {
  return Number(BigInt(parseUint32(value)))
}

export function incrementUint64(value: Uint64 | string): Uint64 {
  const parsed = uint64ToBigInt(value)
  if (parsed === 0xffff_ffff_ffff_ffffn) failCodec("Uint64 cannot increment past its maximum")
  return (parsed + 1n).toString() as Uint64
}

export function encodeBase64url(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) failCodec("Base64url input must be Uint8Array")
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
}

export function decodeBase64url(value: string): Uint8Array {
  if (typeof value !== "string" || value.length === 0 || !BASE64URL.test(value) || value.includes("=")) {
    failCodec("Base64url value is not strict unpadded RFC 4648")
  }
  const padding = (4 - (value.length % 4)) % 4
  let binary: string
  try {
    binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(padding))
  } catch (error) {
    failCodec("Base64url value cannot be decoded", { cause: error })
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (encodeBase64url(bytes) !== value) failCodec("Base64url value is not canonical")
  return bytes
}

export function compareDecodedBase64url(left: string, right: string): number {
  return compareBytes(decodeBase64url(left), decodeBase64url(right))
}

export function assertBoundedNfcString(value: unknown, min: number, max: number, label: string): asserts value is string {
  assertNfcScalarString(value, label)
  const length = utf8ByteLength(value)
  if (length < min || length > max) failCodec(`${label} must contain ${min}..${max} UTF-8 bytes`)
}

function parseFixedBase64url(value: unknown, bytes: number, characters: number, label: string): string {
  if (typeof value !== "string" || value.length !== characters) failCodec(`${label} has an invalid encoded length`)
  const decoded = decodeBase64url(value)
  if (decoded.byteLength !== bytes) failCodec(`${label} has an invalid decoded length`)
  return value
}

function parseCanonicalUint(value: unknown, maximum: bigint, label: string): string {
  if (typeof value !== "string" || !UINT.test(value)) failCodec(`${label} must be a canonical unsigned decimal string`)
  let parsed: bigint
  try {
    parsed = BigInt(value)
  } catch (error) {
    failCodec(`${label} cannot be decoded`, { cause: error })
  }
  if (parsed > maximum) failCodec(`${label} exceeds its unsigned bound`)
  return value
}

function decodeBase32(value: string): Uint8Array {
  let buffer = 0
  let bits = 0
  const output: number[] = []
  for (const character of value) {
    const digit = BASE32_ALPHABET.indexOf(character)
    if (digit < 0) failCodec("PeerId contains an invalid base32 digit")
    buffer = (buffer << 5) | digit
    bits += 5
    while (bits >= 8) {
      bits -= 8
      output.push((buffer >>> bits) & 0xff)
      buffer &= (1 << bits) - 1
    }
  }
  if (bits > 0 && buffer !== 0) failCodec("PeerId has nonzero base32 padding bits")
  return Uint8Array.from(output)
}

function encodeBase32(bytes: Uint8Array): string {
  let buffer = 0
  let bits = 0
  let output = ""
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += BASE32_ALPHABET[(buffer >>> bits) & 31]
      buffer &= (1 << bits) - 1
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]
  return output
}
