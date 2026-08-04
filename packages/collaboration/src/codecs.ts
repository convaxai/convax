import { failCodec } from "./errors"
import { assertNfcScalarStringV2, compareBytesV2, utf8ByteLengthV2 } from "./jcs"

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

export type Id128V2 = string & { readonly [id128V2Brand]: "Id128V2" }
export type ActorIdV2 = string & { readonly [actorIdV2Brand]: "ActorIdV2" }
export type DigestV2 = string & { readonly [digestV2Brand]: "DigestV2" }
export type SignatureV2 = string & { readonly [signatureV2Brand]: "SignatureV2" }
export type PublicKeyV2 = string & { readonly [publicKeyV2Brand]: "PublicKeyV2" }
export type MemberIdV2 = Id128V2 & { readonly [memberIdV2Brand]: "MemberIdV2" }
export type ReplicaIdV2 = string & { readonly [replicaIdV2Brand]: "ReplicaIdV2" }
export type SessionIdV2 = Id128V2 & { readonly [sessionIdV2Brand]: "SessionIdV2" }
export type PeerIdV2 = string & { readonly [peerIdV2Brand]: "PeerIdV2" }
export type CanvasIdV2 = `cv_${string}` & { readonly [canvasIdV2Brand]: "CanvasIdV2" }
export type ProjectIdV2 = string & { readonly [projectIdV2Brand]: "ProjectIdV2" }
export type Uint32V2 = string & { readonly [uint32V2Brand]: "Uint32V2" }
export type Uint64V2 = string & { readonly [uint64V2Brand]: "Uint64V2" }
export type StateVectorV2 = Uint8Array & { readonly [stateVectorV2Brand]: "StateVectorV2" }

const BASE64URL = /^[A-Za-z0-9_-]+$/
const DIGEST = /^[0-9a-f]{64}$/
const CANVAS_ID = /^cv_[0-9a-f]{64}$/
const REPLICA_ID = /^replica_[0-9a-f]{8}$/
const PEER_ID = /^peer_[a-z2-7]{26}$/
const UINT = /^(0|[1-9][0-9]*)$/
const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,95}$/
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"

export function parseId128V2(value: unknown): Id128V2 {
  return parseFixedBase64url(value, 16, 22, "Id128V2") as Id128V2
}

export function parseActorIdV2(value: unknown): ActorIdV2 {
  return parseFixedBase64url(value, 32, 43, "ActorIdV2") as ActorIdV2
}

export function parseDigestV2(value: unknown): DigestV2 {
  if (typeof value !== "string" || !DIGEST.test(value)) failCodec("DigestV2 must be exactly 64 lowercase hexadecimal characters")
  return value as DigestV2
}

export function parseSignatureV2(value: unknown): SignatureV2 {
  return parseFixedBase64url(value, 64, 86, "SignatureV2") as SignatureV2
}

export function parsePublicKeyV2(value: unknown): PublicKeyV2 {
  return parseFixedBase64url(value, 32, 43, "PublicKeyV2") as PublicKeyV2
}

export function parseMemberIdV2(value: unknown): MemberIdV2 {
  return parseId128V2(value) as MemberIdV2
}

export function parseSessionIdV2(value: unknown): SessionIdV2 {
  return parseId128V2(value) as SessionIdV2
}

export function parseReplicaIdV2(value: unknown): ReplicaIdV2 {
  if (typeof value !== "string" || !REPLICA_ID.test(value)) {
    failCodec("ReplicaIdV2 must be replica_ followed by eight lowercase hexadecimal digits")
  }
  if (Number.parseInt(value.slice(8), 16) === 0) failCodec("ReplicaIdV2 zero is forbidden")
  return value as ReplicaIdV2
}

export function replicaIdToYjsClientIdV2(value: ReplicaIdV2 | string): number {
  const parsed = parseReplicaIdV2(value)
  return Number.parseInt(parsed.slice(8), 16)
}

export function parsePeerIdV2(value: unknown): PeerIdV2 {
  if (typeof value !== "string" || !PEER_ID.test(value)) {
    failCodec("PeerIdV2 must be peer_ followed by 26 lowercase base32 characters")
  }
  const decoded = decodeBase32(value.slice(5))
  if (decoded.byteLength !== 16 || encodeBase32(decoded) !== value.slice(5)) failCodec("PeerIdV2 is not canonical")
  return value as PeerIdV2
}

export function parseCanvasIdV2(value: unknown): CanvasIdV2 {
  if (typeof value !== "string" || !CANVAS_ID.test(value)) {
    failCodec("CanvasIdV2 must be cv_ followed by exactly 64 lowercase hexadecimal digits")
  }
  return value as CanvasIdV2
}

/** The generated global-URI descriptor closes this codec without a runtime package edge. */
export function parseProjectIdV2(value: unknown): ProjectIdV2 {
  if (typeof value !== "string" || !PROJECT_ID.test(value)) {
    failCodec("ProjectIdV2 does not satisfy the frozen global URI owner codec")
  }
  return value as ProjectIdV2
}

export function parseUint32V2(value: unknown): Uint32V2 {
  return parseCanonicalUint(value, 0xffff_ffffn, "Uint32V2") as Uint32V2
}

export function parseUint64V2(value: unknown): Uint64V2 {
  return parseCanonicalUint(value, 0xffff_ffff_ffff_ffffn, "Uint64V2") as Uint64V2
}

export function uint64ToBigIntV2(value: Uint64V2 | string): bigint {
  return BigInt(parseUint64V2(value))
}

export function uint32ToNumberV2(value: Uint32V2 | string): number {
  return Number(BigInt(parseUint32V2(value)))
}

export function incrementUint64V2(value: Uint64V2 | string): Uint64V2 {
  const parsed = uint64ToBigIntV2(value)
  if (parsed === 0xffff_ffff_ffff_ffffn) failCodec("Uint64V2 cannot increment past its maximum")
  return (parsed + 1n).toString() as Uint64V2
}

export function encodeBase64urlV2(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) failCodec("Base64url input must be Uint8Array")
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
}

export function decodeBase64urlV2(value: string): Uint8Array {
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
  if (encodeBase64urlV2(bytes) !== value) failCodec("Base64url value is not canonical")
  return bytes
}

export function compareDecodedBase64urlV2(left: string, right: string): number {
  return compareBytesV2(decodeBase64urlV2(left), decodeBase64urlV2(right))
}

export function assertBoundedNfcStringV2(value: unknown, min: number, max: number, label: string): asserts value is string {
  assertNfcScalarStringV2(value, label)
  const length = utf8ByteLengthV2(value)
  if (length < min || length > max) failCodec(`${label} must contain ${min}..${max} UTF-8 bytes`)
}

function parseFixedBase64url(value: unknown, bytes: number, characters: number, label: string): string {
  if (typeof value !== "string" || value.length !== characters) failCodec(`${label} has an invalid encoded length`)
  const decoded = decodeBase64urlV2(value)
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
    if (digit < 0) failCodec("PeerIdV2 contains an invalid base32 digit")
    buffer = (buffer << 5) | digit
    bits += 5
    while (bits >= 8) {
      bits -= 8
      output.push((buffer >>> bits) & 0xff)
      buffer &= (1 << bits) - 1
    }
  }
  if (bits > 0 && buffer !== 0) failCodec("PeerIdV2 has nonzero base32 padding bits")
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
