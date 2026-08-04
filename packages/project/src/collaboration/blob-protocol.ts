import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js"
import { parseProjectFileId } from "@convax/project-files/identity"
import { parseProjectUri } from "@convax/uri"

export const BLOB_CHUNK_BYTES = 1024 * 1024
export const MAX_BLOB_BYTES = 64 * 1024 * 1024 * 1024
export const MAX_BLOB_CHUNKS = 65_536
export const MAX_BLOB_PROOF_DEPTH = 16

const encoder = new TextEncoder()
const emptyDomain = encoder.encode("convax.blob-merkle-empty/1\0")
const leafDomain = encoder.encode("convax.blob-merkle-leaf/1\0")
const nodeDomain = encoder.encode("convax.blob-merkle-node/1\0")
const emptyBlobHash = bytesToHex(sha256(new Uint8Array()))
const emptyMerkleRoot = bytesToHex(sha256(emptyDomain))
const digestPattern = /^[0-9a-f]{64}$/u
const canonicalUintPattern = /^(0|[1-9][0-9]*)$/u

export interface BlobPartitionV1 {
  byteLength: string
  chunkSize: string
  chunkCount: string
  chunkMerkleRoot: string
  blobHash: string
}

export interface BlobManifestPartitionV1 extends BlobPartitionV1 {
  canonicalUri: string
  fileId: string
}

export interface BlobMerkleProofStepV1 {
  side: "left" | "right"
  siblingHash: string
}

export interface BlobMerkleTreeV1 extends BlobPartitionV1 {
  chunkHashes: readonly string[]
  proofs: readonly (readonly BlobMerkleProofStepV1[])[]
}

export class BlobProtocolValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BlobProtocolValidationError"
  }
}

export function expectedBlobPartition(byteLengthInput: number | bigint | string) {
  const byteLength = parseCanonicalUint(byteLengthInput, "byteLength")
  if (byteLength > BigInt(MAX_BLOB_BYTES)) {
    throw new BlobProtocolValidationError("Blob byteLength exceeds 64 GiB")
  }
  if (byteLength === 0n) {
    return Object.freeze({ byteLength: "0", chunkSize: "0", chunkCount: "0" })
  }
  const chunkSize = BigInt(BLOB_CHUNK_BYTES)
  const chunkCount = (byteLength + chunkSize - 1n) / chunkSize
  if (chunkCount > BigInt(MAX_BLOB_CHUNKS)) {
    throw new BlobProtocolValidationError("Blob chunkCount exceeds 65536")
  }
  return Object.freeze({
    byteLength: byteLength.toString(),
    chunkSize: BLOB_CHUNK_BYTES.toString(),
    chunkCount: chunkCount.toString(),
  })
}

export function expectedBlobChunkLength(byteLengthInput: string, chunkIndexInput: string): number {
  const partition = expectedBlobPartition(byteLengthInput)
  const chunkCount = BigInt(partition.chunkCount)
  if (chunkCount === 0n) throw new BlobProtocolValidationError("An empty blob has no chunks")
  const chunkIndex = parseCanonicalUint(chunkIndexInput, "chunkIndex")
  if (chunkIndex >= chunkCount) throw new BlobProtocolValidationError("Blob chunk index is out of range")
  if (chunkIndex + 1n < chunkCount) return BLOB_CHUNK_BYTES
  return Number(BigInt(partition.byteLength) - BigInt(BLOB_CHUNK_BYTES) * (chunkCount - 1n))
}

export function createBlobMerkleTree(bytes: Uint8Array): BlobMerkleTreeV1 {
  if (!(bytes instanceof Uint8Array)) throw new BlobProtocolValidationError("Blob bytes must be a Uint8Array")
  const partition = expectedBlobPartition(bytes.byteLength)
  const blobHash = bytesToHex(sha256(bytes))
  if (bytes.byteLength === 0) {
    return Object.freeze({
      ...partition,
      blobHash,
      chunkMerkleRoot: emptyMerkleRoot,
      chunkHashes: Object.freeze([]),
      proofs: Object.freeze([]),
    })
  }

  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += BLOB_CHUNK_BYTES) {
    chunks.push(bytes.subarray(offset, Math.min(offset + BLOB_CHUNK_BYTES, bytes.byteLength)))
  }
  const leaves = chunks.map((chunk, index) => hashBlobLeaf(index, chunk))
  const proofs = leaves.map((_leaf, index) => buildProof(leaves, index))
  return Object.freeze({
    ...partition,
    blobHash,
    chunkMerkleRoot: bytesToHex(buildMerkleRoot(leaves)),
    chunkHashes: Object.freeze(leaves.map(bytesToHex)),
    proofs: Object.freeze(proofs.map((proof) => Object.freeze(proof))),
  })
}

export function validateBlobManifestPartition(manifest: BlobManifestPartitionV1): void {
  const expected = expectedBlobPartition(manifest.byteLength)
  if (manifest.chunkSize !== expected.chunkSize || manifest.chunkCount !== expected.chunkCount) {
    throw new BlobProtocolValidationError("Blob manifest does not use the canonical 1 MiB partition")
  }
  requireDigest(manifest.blobHash, "blobHash")
  requireDigest(manifest.chunkMerkleRoot, "chunkMerkleRoot")
  const parsedUri = parseProjectUri(manifest.canonicalUri)
  const fileId = parseProjectFileId(manifest.fileId)
  if (parsedUri.entryId !== fileId || parsedUri.blob !== `sha256:${manifest.blobHash}`) {
    throw new BlobProtocolValidationError("Blob manifest URI/file/hash binding is inconsistent")
  }
  if (expected.chunkCount === "0") {
    if (manifest.blobHash !== emptyBlobHash || manifest.chunkMerkleRoot !== emptyMerkleRoot) {
      throw new BlobProtocolValidationError("Empty blob manifest does not use the unique empty tuple")
    }
  }
}

export function validateBlobChunkProof(input: {
  blobHash: string
  byteLength: string
  chunk: Uint8Array
  chunkHash: string
  chunkIndex: string
  chunkMerkleRoot: string
  proof: readonly BlobMerkleProofStepV1[]
}): void {
  requireDigest(input.blobHash, "blobHash")
  requireDigest(input.chunkHash, "chunkHash")
  requireDigest(input.chunkMerkleRoot, "chunkMerkleRoot")
  const partition = expectedBlobPartition(input.byteLength)
  if (partition.chunkCount === "0") throw new BlobProtocolValidationError("Empty blobs cannot carry chunk data")
  const index = parseCanonicalUint(input.chunkIndex, "chunkIndex")
  const chunkCount = BigInt(partition.chunkCount)
  if (index >= chunkCount) throw new BlobProtocolValidationError("Blob chunk index is out of range")
  const expectedLength = expectedBlobChunkLength(input.byteLength, input.chunkIndex)
  if (!(input.chunk instanceof Uint8Array) || input.chunk.byteLength !== expectedLength) {
    throw new BlobProtocolValidationError("Blob chunk length does not match its canonical partition")
  }
  const expectedDepth = Math.ceil(Math.log2(Number(chunkCount)))
  if (input.proof.length !== expectedDepth || input.proof.length > MAX_BLOB_PROOF_DEPTH) {
    throw new BlobProtocolValidationError("Blob Merkle proof depth is not canonical")
  }

  let current = hashBlobLeaf(Number(index), input.chunk)
  if (bytesToHex(current) !== input.chunkHash) throw new BlobProtocolValidationError("Blob chunk hash is invalid")
  let width = Number(chunkCount)
  let position = Number(index)
  for (const step of input.proof) {
    requireDigest(step.siblingHash, "proof siblingHash")
    const sibling = hexToBytes(step.siblingHash)
    const duplicateLast = width % 2 === 1 && position === width - 1
    const expectedSide: BlobMerkleProofStepV1["side"] = duplicateLast || position % 2 === 0 ? "right" : "left"
    if (step.side !== expectedSide) throw new BlobProtocolValidationError("Blob Merkle proof side is invalid")
    if (duplicateLast && step.siblingHash !== bytesToHex(current)) {
      throw new BlobProtocolValidationError("Blob duplicate-last proof must repeat the current hash")
    }
    current = step.side === "left" ? hashBlobNode(sibling, current) : hashBlobNode(current, sibling)
    position = Math.floor(position / 2)
    width = Math.ceil(width / 2)
  }
  if (bytesToHex(current) !== input.chunkMerkleRoot) {
    throw new BlobProtocolValidationError("Blob Merkle proof does not reach the manifest root")
  }
}

export function validateBlobChunkRequest(indexes: readonly string[], chunkCountInput: string): readonly string[] {
  if (!Array.isArray(indexes) || indexes.length > 256) {
    throw new BlobProtocolValidationError("Blob chunk request exceeds 256 indexes")
  }
  const chunkCount = parseCanonicalUint(chunkCountInput, "chunkCount")
  if (chunkCount === 0n && indexes.length > 0) {
    throw new BlobProtocolValidationError("Empty blobs cannot request chunks")
  }
  let previous = -1n
  return Object.freeze(
    indexes.map((value) => {
      const index = parseCanonicalUint(value, "chunkIndex")
      if (index >= chunkCount || index <= previous) {
        throw new BlobProtocolValidationError("Blob chunk indexes must be in range, strictly increasing and unique")
      }
      previous = index
      return index.toString()
    }),
  )
}

function buildProof(leaves: readonly Uint8Array[], leafIndex: number): BlobMerkleProofStepV1[] {
  const proof: BlobMerkleProofStepV1[] = []
  let level: Uint8Array[] = leaves.map((leaf) => new Uint8Array(leaf))
  let position = leafIndex
  while (level.length > 1) {
    const duplicateLast = level.length % 2 === 1 && position === level.length - 1
    const siblingIndex = duplicateLast ? position : position % 2 === 0 ? position + 1 : position - 1
    const sibling = level[siblingIndex]
    if (!sibling) throw new BlobProtocolValidationError("Blob Merkle tree is incomplete")
    proof.push({ side: duplicateLast || position % 2 === 0 ? "right" : "left", siblingHash: bytesToHex(sibling) })
    level = nextMerkleLevel(level)
    position = Math.floor(position / 2)
  }
  return proof
}

function buildMerkleRoot(leaves: readonly Uint8Array[]): Uint8Array {
  if (leaves.length === 0) return sha256(emptyDomain)
  let level: Uint8Array[] = leaves.map((leaf) => new Uint8Array(leaf))
  while (level.length > 1) level = nextMerkleLevel(level)
  return level[0] ?? sha256(emptyDomain)
}

function nextMerkleLevel(level: readonly Uint8Array[]): Uint8Array[] {
  const next: Uint8Array[] = []
  for (let index = 0; index < level.length; index += 2) {
    const left = level[index]
    const right = level[index + 1] ?? left
    if (!left || !right) throw new BlobProtocolValidationError("Blob Merkle level is incomplete")
    next.push(hashBlobNode(left, right))
  }
  return next
}

function hashBlobLeaf(index: number, chunk: Uint8Array): Uint8Array {
  if (!Number.isSafeInteger(index) || index < 0 || index > 0xffff_ffff) {
    throw new BlobProtocolValidationError("Blob chunk index exceeds u32")
  }
  const header = new Uint8Array(8)
  const view = new DataView(header.buffer)
  view.setUint32(0, index)
  view.setUint32(4, chunk.byteLength)
  return sha256(concat(leafDomain, header, chunk))
}

function hashBlobNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength !== 32 || right.byteLength !== 32) {
    throw new BlobProtocolValidationError("Blob Merkle nodes must be 32 bytes")
  }
  return sha256(concat(nodeDomain, left, right))
}

function concat(...values: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(values.reduce((total, value) => total + value.byteLength, 0))
  let offset = 0
  for (const value of values) {
    result.set(value, offset)
    offset += value.byteLength
  }
  return result
}

function requireDigest(value: string, label: string): void {
  if (!digestPattern.test(value)) throw new BlobProtocolValidationError(`${label} must be lowercase SHA-256`)
}

function parseCanonicalUint(value: number | bigint | string, label: string): bigint {
  const stringValue = typeof value === "string" ? value : value.toString()
  if (!canonicalUintPattern.test(stringValue)) {
    throw new BlobProtocolValidationError(`${label} must be a canonical unsigned decimal`)
  }
  return BigInt(stringValue)
}

export const EMPTY_BLOB_HASH_V1 = emptyBlobHash
export const EMPTY_BLOB_MERKLE_ROOT_V1 = emptyMerkleRoot
