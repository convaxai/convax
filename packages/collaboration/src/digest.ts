import type { Digest } from "./codecs"
import { parseDigest } from "./codecs"
import { encodeRestrictedJcs } from "./jcs"

const encoder = new TextEncoder()

export function ordinarySha256(bytes: Uint8Array): Digest {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("SHA-256 input must be Uint8Array")
  return bytesToHex(sha256Bytes(bytes))
}

export function structuredDigest(domain: string, value: unknown): Digest {
  return rawDomainDigest(domain, encodeRestrictedJcs(value))
}

export function rawDomainDigest(domain: string, bytes: Uint8Array): Digest {
  const domainBytes = encoder.encode(domain)
  const preimage = new Uint8Array(domainBytes.byteLength + 1 + bytes.byteLength)
  preimage.set(domainBytes)
  preimage[domainBytes.byteLength] = 0
  preimage.set(bytes, domainBytes.byteLength + 1)
  return ordinarySha256(preimage)
}

export function decodedDigestPurpose(domain: string, digest: Digest | string): Uint8Array {
  return hexToBytes(rawDomainDigest(domain, hexToBytes(parseDigest(digest))))
}

export function canonicalStateDigest(ownerSchemaDigest: Digest | string, exactCanonicalState: Uint8Array): Digest {
  if (!(exactCanonicalState instanceof Uint8Array)) throw new TypeError("Canonical state must be Uint8Array")
  const domain = encoder.encode("convax.canonical-state")
  const schema = hexToBytes(parseDigest(ownerSchemaDigest))
  const preimage = new Uint8Array(domain.byteLength + 1 + schema.byteLength + 1 + exactCanonicalState.byteLength)
  preimage.set(domain)
  preimage[domain.byteLength] = 0
  preimage.set(schema, domain.byteLength + 1)
  preimage[domain.byteLength + 1 + schema.byteLength] = 0
  preimage.set(exactCanonicalState, domain.byteLength + 2 + schema.byteLength)
  return ordinarySha256(preimage)
}

export function hexToBytes(value: Digest | string): Uint8Array {
  const parsed = parseDigest(value)
  const result = new Uint8Array(32)
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(parsed.slice(index * 2, index * 2 + 2), 16)
  }
  return result
}

export function bytesToHex(bytes: Uint8Array): Digest {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) throw new TypeError("Digest bytes must contain exactly 32 bytes")
  return parseDigest(Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""))
}

const SHA256_INITIAL = Uint32Array.of(
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
)

const SHA256_ROUND = Uint32Array.of(
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
)

function sha256Bytes(input: Uint8Array): Uint8Array {
  const state = Uint32Array.from(SHA256_INITIAL)
  const schedule = new Uint32Array(64)
  const blockCount = Math.ceil((input.byteLength + 9) / 64)
  const paddedLength = blockCount * 64
  const highBitLength = Math.floor(input.byteLength / 0x2000_0000)
  const lowBitLength = (input.byteLength << 3) >>> 0
  for (let block = 0; block < blockCount; block += 1) {
    const offset = block * 64
    for (let word = 0; word < 16; word += 1) {
      const byteOffset = offset + word * 4
      schedule[word] = (
        (paddedByte(input, byteOffset, paddedLength, highBitLength, lowBitLength) << 24)
        | (paddedByte(input, byteOffset + 1, paddedLength, highBitLength, lowBitLength) << 16)
        | (paddedByte(input, byteOffset + 2, paddedLength, highBitLength, lowBitLength) << 8)
        | paddedByte(input, byteOffset + 3, paddedLength, highBitLength, lowBitLength)
      ) >>> 0
    }
    for (let word = 16; word < 64; word += 1) {
      const s0 = rotateRight(schedule[word - 15]!, 7) ^ rotateRight(schedule[word - 15]!, 18) ^ (schedule[word - 15]! >>> 3)
      const s1 = rotateRight(schedule[word - 2]!, 17) ^ rotateRight(schedule[word - 2]!, 19) ^ (schedule[word - 2]! >>> 10)
      schedule[word] = (schedule[word - 16]! + s0 + schedule[word - 7]! + s1) >>> 0
    }
    let a = state[0]!
    let b = state[1]!
    let c = state[2]!
    let d = state[3]!
    let e = state[4]!
    let f = state[5]!
    let g = state[6]!
    let h = state[7]!
    for (let round = 0; round < 64; round += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + choice + SHA256_ROUND[round]! + schedule[round]!) >>> 0
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    state[0] = (state[0]! + a) >>> 0
    state[1] = (state[1]! + b) >>> 0
    state[2] = (state[2]! + c) >>> 0
    state[3] = (state[3]! + d) >>> 0
    state[4] = (state[4]! + e) >>> 0
    state[5] = (state[5]! + f) >>> 0
    state[6] = (state[6]! + g) >>> 0
    state[7] = (state[7]! + h) >>> 0
  }
  const output = new Uint8Array(32)
  const view = new DataView(output.buffer)
  for (let index = 0; index < state.length; index += 1) view.setUint32(index * 4, state[index]!, false)
  return output
}

function paddedByte(input: Uint8Array, index: number, paddedLength: number, high: number, low: number): number {
  if (index < input.byteLength) return input[index]!
  if (index === input.byteLength) return 0x80
  if (index < paddedLength - 8) return 0
  const shift = (paddedLength - 1 - index) * 8
  return shift >= 32 ? (high >>> (shift - 32)) & 0xff : (low >>> shift) & 0xff
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount))
}
