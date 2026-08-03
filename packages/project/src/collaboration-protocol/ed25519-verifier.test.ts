import { describe, expect, test } from "bun:test"
import { createWebCryptoEd25519VerifierV2 } from "../collaboration-protocol"

const scalarOrder = BigInt("0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed")
const orderEightPoint = Uint8Array.from(
  "e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800".match(/../gu)!,
  (byte) => Number.parseInt(byte, 16),
)

function littleEndian(value: bigint, length: number): Uint8Array {
  const result = new Uint8Array(length)
  let remaining = value
  for (let index = 0; index < length; index += 1) {
    result[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return result
}

describe("strict raw Ed25519 digest verifier", () => {
  test("accepts an RFC 8032/WebCrypto Ed25519 signature over one exact 32-byte purpose digest", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
    const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))
    const purposeDigestBytes = crypto.getRandomValues(new Uint8Array(32))
    const signatureBytes = new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, purposeDigestBytes),
    )

    await expect(
      createWebCryptoEd25519VerifierV2().verifyDigest({ publicKeyBytes, signatureBytes, purposeDigestBytes }),
    ).resolves.toEqual({ ok: true })
  })

  test("rejects malformed lengths before reaching WebCrypto", async () => {
    const verifier = createWebCryptoEd25519VerifierV2()
    await expect(
      verifier.verifyDigest({
        publicKeyBytes: new Uint8Array(31),
        signatureBytes: new Uint8Array(64),
        purposeDigestBytes: new Uint8Array(32),
      }),
    ).resolves.toEqual({ ok: false, code: "invalid-public-key-length" })
    await expect(
      verifier.verifyDigest({
        publicKeyBytes: new Uint8Array(32),
        signatureBytes: new Uint8Array(63),
        purposeDigestBytes: new Uint8Array(32),
      }),
    ).resolves.toEqual({ ok: false, code: "invalid-signature-length" })
    await expect(
      verifier.verifyDigest({
        publicKeyBytes: new Uint8Array(32),
        signatureBytes: new Uint8Array(64),
        purposeDigestBytes: new Uint8Array(31),
      }),
    ).resolves.toEqual({ ok: false, code: "invalid-digest-length" })
  })

  test("rejects canonical small-order and noncanonical point encodings", async () => {
    const verifier = createWebCryptoEd25519VerifierV2()
    const signature = new Uint8Array(64)
    signature[0] = 2
    signature[32] = 1

    await expect(
      verifier.verifyDigest({
        publicKeyBytes: Uint8Array.of(1, ...new Uint8Array(31)),
        signatureBytes: signature,
        purposeDigestBytes: new Uint8Array(32),
      }),
    ).resolves.toEqual({ ok: false, code: "small-order-public-key" })

    const signedSmallOrder = orderEightPoint.slice()
    signedSmallOrder[31] |= 0x80
    await expect(
      verifier.verifyDigest({
        publicKeyBytes: signedSmallOrder,
        signatureBytes: signature,
        purposeDigestBytes: new Uint8Array(32),
      }),
    ).resolves.toEqual({ ok: false, code: "small-order-public-key" })

    const noncanonicalY = new Uint8Array(32).fill(0xff)
    noncanonicalY[31] = 0x7f
    await expect(
      verifier.verifyDigest({
        publicKeyBytes: noncanonicalY,
        signatureBytes: signature,
        purposeDigestBytes: new Uint8Array(32),
      }),
    ).resolves.toEqual({ ok: false, code: "noncanonical-public-key" })
  })

  test("fails closed when no WebCrypto Ed25519 backend is available", async () => {
    const publicKey = new Uint8Array(32)
    publicKey[0] = 2
    const signature = new Uint8Array(64)
    signature[0] = 2
    signature[32] = 1
    await expect(
      createWebCryptoEd25519VerifierV2(null).verifyDigest({
        publicKeyBytes: publicKey,
        signatureBytes: signature,
        purposeDigestBytes: new Uint8Array(32),
      }),
    ).resolves.toEqual({ ok: false, code: "backend-unavailable" })
  })

  test("rejects S equal to the group order before signature verification", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
    const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))
    const signatureBytes = new Uint8Array(64)
    signatureBytes[0] = 2
    signatureBytes.set(littleEndian(scalarOrder, 32), 32)

    await expect(
      createWebCryptoEd25519VerifierV2().verifyDigest({
        publicKeyBytes,
        signatureBytes,
        purposeDigestBytes: new Uint8Array(32),
      }),
    ).resolves.toEqual({ ok: false, code: "noncanonical-signature-s" })
  })

  test("rejects a signature replayed over another purpose digest", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
    const publicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))
    const signedDigest = crypto.getRandomValues(new Uint8Array(32))
    const replayDigest = signedDigest.slice()
    replayDigest[0] ^= 1
    const signatureBytes = new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, signedDigest))

    await expect(
      createWebCryptoEd25519VerifierV2().verifyDigest({
        publicKeyBytes,
        signatureBytes,
        purposeDigestBytes: replayDigest,
      }),
    ).resolves.toEqual({ ok: false, code: "signature-mismatch" })
  })
})
