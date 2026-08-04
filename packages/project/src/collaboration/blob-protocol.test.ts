import { describe, expect, test } from "bun:test"
import {
  BLOB_CHUNK_BYTES,
  BlobProtocolValidationError,
  createBlobMerkleTree,
  EMPTY_BLOB_HASH_V1,
  EMPTY_BLOB_MERKLE_ROOT_V1,
  expectedBlobChunkLength,
  expectedBlobPartition,
  validateBlobChunkProof,
  validateBlobChunkRequest,
  validateBlobManifestPartition,
} from "./blob-protocol"

const projectId = "project_0123456789abcdef"
const projectEpoch = "AQEBAQEBAQEBAQEBAQEBAQ"
const fileId = `pf_${"a".repeat(64)}`

describe("blob collaboration protocol", () => {
  test("has one unique zero-byte tuple and no chunk request", () => {
    const tree = createBlobMerkleTree(new Uint8Array())
    expect(tree).toMatchObject({
      byteLength: "0",
      chunkSize: "0",
      chunkCount: "0",
      blobHash: EMPTY_BLOB_HASH_V1,
      chunkMerkleRoot: EMPTY_BLOB_MERKLE_ROOT_V1,
    })
    expect(tree.chunkHashes).toEqual([])
    expect(() => validateBlobChunkRequest(["0"], "0")).toThrow(BlobProtocolValidationError)
  })

  test("fixes the 1 MiB partition and final slice", () => {
    expect(expectedBlobPartition(BLOB_CHUNK_BYTES * 2 + 7)).toEqual({
      byteLength: String(BLOB_CHUNK_BYTES * 2 + 7),
      chunkSize: String(BLOB_CHUNK_BYTES),
      chunkCount: "3",
    })
    expect(expectedBlobChunkLength(String(BLOB_CHUNK_BYTES * 2 + 7), "0")).toBe(BLOB_CHUNK_BYTES)
    expect(expectedBlobChunkLength(String(BLOB_CHUNK_BYTES * 2 + 7), "2")).toBe(7)
    expect(() => expectedBlobPartition(64n * 1024n * 1024n * 1024n + 1n)).toThrow(
      BlobProtocolValidationError,
    )
  })

  test("builds and verifies exact duplicate-last Merkle proofs", () => {
    const bytes = new Uint8Array(BLOB_CHUNK_BYTES * 2 + 7)
    bytes.fill(1, 0, BLOB_CHUNK_BYTES)
    bytes.fill(2, BLOB_CHUNK_BYTES, BLOB_CHUNK_BYTES * 2)
    bytes.fill(3, BLOB_CHUNK_BYTES * 2)
    const tree = createBlobMerkleTree(bytes)
    expect(tree.chunkCount).toBe("3")
    expect(tree.proofs[2]).toHaveLength(2)
    expect(tree.proofs[2]?.[0]).toEqual({ side: "right", siblingHash: tree.chunkHashes[2] })
    const third = bytes.subarray(BLOB_CHUNK_BYTES * 2)
    validateBlobChunkProof({
      blobHash: tree.blobHash,
      byteLength: tree.byteLength,
      chunk: third,
      chunkHash: tree.chunkHashes[2]!,
      chunkIndex: "2",
      chunkMerkleRoot: tree.chunkMerkleRoot,
      proof: tree.proofs[2]!,
    })
    expect(() =>
      validateBlobChunkProof({
        blobHash: tree.blobHash,
        byteLength: tree.byteLength,
        chunk: third,
        chunkHash: tree.chunkHashes[2]!,
        chunkIndex: "2",
        chunkMerkleRoot: tree.chunkMerkleRoot,
        proof: [{ ...tree.proofs[2]![0]!, side: "left" }, tree.proofs[2]![1]!],
      }),
    ).toThrow(BlobProtocolValidationError)
  })

  test("binds manifest file identity, canonical URI and blob hash", () => {
    const bytes = new TextEncoder().encode("convax")
    const tree = createBlobMerkleTree(bytes)
    const canonicalUri =
      `convax-project://${projectId}/epochs/${projectEpoch}/entries/${fileId}` +
      `?blob=sha256%3A${tree.blobHash}&path=Generated%2Fclip.bin`
    validateBlobManifestPartition({ ...tree, canonicalUri, fileId })
    expect(() =>
      validateBlobManifestPartition({
        ...tree,
        canonicalUri,
        fileId: `pf_${"b".repeat(64)}`,
      }),
    ).toThrow(BlobProtocolValidationError)
  })

  test("requires request indexes to be bounded and strictly increasing", () => {
    expect(validateBlobChunkRequest(["0", "2"], "3")).toEqual(["0", "2"])
    for (const indexes of [["1", "1"], ["2", "1"], ["3"]]) {
      expect(() => validateBlobChunkRequest(indexes, "3")).toThrow(BlobProtocolValidationError)
    }
  })
})
