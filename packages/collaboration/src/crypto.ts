import type { PublicKey, Signature } from "./codecs"
import { decodeBase64url, parsePublicKey, parseSignature } from "./codecs"
import { CollaborationCodecError } from "./errors"

const ED25519_L = BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed")
const FIELD_P = (1n << 255n) - 19n
const SMALL_ORDER_ENCODINGS = new Set([
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0100000000000000000000000000000000000000000000000000000000000000",
  "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
  "26e8958f3fbdf3f04579f4f6f1f4ecae849c9f4f4cdbdc57e31a4f0b37a7fc05",
  "c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39cc3c6efda0203c7a037a",
])

export interface Ed25519VerifierPort {
  verify(publicKey: Uint8Array, signature: Uint8Array, digest: Uint8Array): Promise<boolean>
}

export interface ReplicaSignerPort {
  sign(digest: Uint8Array): Promise<Signature>
}

export async function verifyExactEd25519(
  verifier: Ed25519VerifierPort,
  publicKey: PublicKey | string,
  signature: Signature | string,
  digest: Uint8Array,
): Promise<boolean> {
  if (!(digest instanceof Uint8Array) || digest.byteLength !== 32) invalid("Ed25519 purpose digest must contain exactly 32 bytes")
  const keyBytes = decodeBase64url(parsePublicKey(publicKey))
  const signatureBytes = decodeBase64url(parseSignature(signature))
  assertCanonicalPoint(keyBytes, "Ed25519 public key")
  assertCanonicalPoint(signatureBytes.subarray(0, 32), "Ed25519 R")
  if (littleEndianInteger(signatureBytes.subarray(32)) >= ED25519_L) invalid("Ed25519 S is noncanonical")
  return verifier.verify(Uint8Array.from(keyBytes), Uint8Array.from(signatureBytes), Uint8Array.from(digest))
}

export function createWebCryptoEd25519Verifier(subtle: SubtleCrypto = crypto.subtle): Ed25519VerifierPort {
  return Object.freeze({
    async verify(publicKey: Uint8Array, signature: Uint8Array, digest: Uint8Array): Promise<boolean> {
      try {
        const key = await subtle.importKey("raw", exactArrayBuffer(publicKey), { name: "Ed25519" }, false, ["verify"])
        return subtle.verify({ name: "Ed25519" }, key, exactArrayBuffer(signature), exactArrayBuffer(digest))
      } catch {
        return false
      }
    },
  })
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function assertCanonicalPoint(bytes: Uint8Array, label: string): void {
  if (bytes.byteLength !== 32) invalid(`${label} must contain exactly 32 bytes`)
  const encoded = Uint8Array.from(bytes)
  encoded[31] = encoded[31]! & 0x7f
  if (littleEndianInteger(encoded) >= FIELD_P) invalid(`${label} has a noncanonical field encoding`)
  if (SMALL_ORDER_ENCODINGS.has(toHex(bytes))) invalid(`${label} is small-order`)
}

function littleEndianInteger(bytes: Uint8Array): bigint {
  let result = 0n
  for (let index = bytes.byteLength - 1; index >= 0; index -= 1) result = (result << 8n) | BigInt(bytes[index]!)
  return result
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function invalid(message: string): never {
  throw new CollaborationCodecError("invalid-codec", message)
}
