export type Ed25519VerificationFailureV2 =
  | "invalid-public-key-length"
  | "invalid-signature-length"
  | "invalid-digest-length"
  | "noncanonical-public-key"
  | "small-order-public-key"
  | "noncanonical-signature-r"
  | "small-order-signature-r"
  | "noncanonical-signature-s"
  | "signature-mismatch"
  | "backend-unavailable"

export type Ed25519VerificationResultV2 =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: Ed25519VerificationFailureV2 }

export interface Ed25519VerifyDigestInputV2 {
  readonly publicKeyBytes: Uint8Array
  readonly signatureBytes: Uint8Array
  readonly purposeDigestBytes: Uint8Array
}

export interface Ed25519VerifierV2 {
  verifyDigest(input: Ed25519VerifyDigestInputV2): Promise<Ed25519VerificationResultV2>
}

const fieldPrime = (1n << 255n) - 19n
const scalarOrder = BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed")

function hexBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

// The five canonical encodings of the Ed25519 small-order subgroup after the
// sign bit is masked. The sign-bit variants are therefore rejected as well.
const zeroPoint = new Uint8Array(32)
const identityPoint = Uint8Array.of(1, ...new Uint8Array(31))
const minusOnePoint = Uint8Array.of(0xec, ...new Uint8Array(30).fill(0xff), 0x7f)
const orderEightPointA = hexBytes("e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800")
const orderEightPointB = hexBytes("5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224e8dd09f1157")
const smallOrderPoints = [zeroPoint, identityPoint, minusOnePoint, orderEightPointA, orderEightPointB]

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!
  return difference === 0
}

function littleEndianInteger(bytes: Uint8Array): bigint {
  let result = 0n
  for (let index = bytes.length - 1; index >= 0; index -= 1) result = (result << 8n) | BigInt(bytes[index]!)
  return result
}

function copyForWebCrypto(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

function pointFailure(bytes: Uint8Array, subject: "public-key" | "signature-r"): Ed25519VerificationFailureV2 | null {
  const y = bytes.slice()
  y[31] = y[31]! & 0x7f
  if (littleEndianInteger(y) >= fieldPrime) {
    return subject === "public-key" ? "noncanonical-public-key" : "noncanonical-signature-r"
  }
  if (smallOrderPoints.some((point) => equalBytes(y, point))) {
    return subject === "public-key" ? "small-order-public-key" : "small-order-signature-r"
  }
  return null
}

export function createWebCryptoEd25519VerifierV2(
  subtle: SubtleCrypto | null | undefined = globalThis.crypto?.subtle,
): Ed25519VerifierV2 {
  const verifier: Ed25519VerifierV2 = {
    async verifyDigest(input: Ed25519VerifyDigestInputV2): Promise<Ed25519VerificationResultV2> {
      if (!(input.publicKeyBytes instanceof Uint8Array) || input.publicKeyBytes.byteLength !== 32) {
        return { ok: false, code: "invalid-public-key-length" }
      }
      if (!(input.signatureBytes instanceof Uint8Array) || input.signatureBytes.byteLength !== 64) {
        return { ok: false, code: "invalid-signature-length" }
      }
      if (!(input.purposeDigestBytes instanceof Uint8Array) || input.purposeDigestBytes.byteLength !== 32) {
        return { ok: false, code: "invalid-digest-length" }
      }
      const publicKeyFailure = pointFailure(input.publicKeyBytes, "public-key")
      if (publicKeyFailure) return { ok: false, code: publicKeyFailure }
      const signatureRFailure = pointFailure(input.signatureBytes.subarray(0, 32), "signature-r")
      if (signatureRFailure) return { ok: false, code: signatureRFailure }
      if (littleEndianInteger(input.signatureBytes.subarray(32)) >= scalarOrder) {
        return { ok: false, code: "noncanonical-signature-s" }
      }
      if (!subtle) return { ok: false, code: "backend-unavailable" }
      try {
        const key = await subtle.importKey(
          "raw",
          copyForWebCrypto(input.publicKeyBytes),
          { name: "Ed25519" },
          false,
          ["verify"],
        )
        const verified = await subtle.verify(
          { name: "Ed25519" },
          key,
          copyForWebCrypto(input.signatureBytes),
          copyForWebCrypto(input.purposeDigestBytes),
        )
        return verified ? { ok: true } : { ok: false, code: "signature-mismatch" }
      } catch {
        return { ok: false, code: "backend-unavailable" }
      }
    },
  }
  return Object.freeze(verifier)
}
