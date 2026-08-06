import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  encodeBase64url,
  ordinarySha256,
  parseActorId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseReplicaId,
  parseSignature,
} from "@convax/collaboration"
import { CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2 } from "../../collaboration-protocol/control-descriptor"
import { createBlobDurableAckV2 } from "../../collaboration/blob-replication"
import type { ProjectResourceReferenceV2 } from "../../collaboration/project-index"
import { createCompleteProjectBlobRootScanPortV2, ProjectBlobReplicationStoreV2 } from "./blob-replication-store"

const id = (fill: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(fill)))
const actor = (fill: number) => parseActorId(encodeBase64url(new Uint8Array(32).fill(fill)))
const projectId = parseProjectId("project-a")
const projectEpoch = id(1)
const sourceMemberId = parseMemberId(id(2))
const receiver = {
  receiverMemberId: parseMemberId(id(3)),
  receiverReplicaId: parseReplicaId("replica_00000003"),
  receiverActorId: actor(3),
  receiverAuthorizationDigest: ordinarySha256(new TextEncoder().encode("authorization")),
}
const signature = parseSignature(encodeBase64url(new Uint8Array(64).fill(9)))
const durabilityTest = test.skipIf(process.platform === "win32")

describe("Project/node blob replication store", () => {
  durabilityTest("resumes chunks after restart, accepts exact duplicates, verifies digest before durable evidence and bootstraps have", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-blob-store-"))
    try {
      const senderDirectory = await collaborationDirectory(root, "sender")
      const receiverDirectory = await collaborationDirectory(root, "receiver")
      const sender = await open(senderDirectory)
      let receiverStore = await open(receiverDirectory)
      const bytes = new Uint8Array(1024 * 1024 + 17)
      bytes.fill(1, 0, 1024 * 1024); bytes.fill(2, 1024 * 1024)
      const reference = resource(bytes)
      await sender.admitVerifiedBytes(reference, bytes)
      const plan = await sender.prepareSend({ reference, connectionId: id(4), transferId: id(5) })
      await receiverStore.beginReceive({ sourceMemberId, manifest: plan.manifest, reference })
      const first = await sender.readSendChunk(plan, "0")
      await receiverStore.receiveChunk({ sourceMemberId, transferId: plan.manifest.core.transferId, ...first })

      receiverStore = await open(receiverDirectory)
      const resumed = await receiverStore.beginReceive({ sourceMemberId, manifest: plan.manifest, reference })
      expect(resumed.nextChunkIndex).toBe("1")
      expect((await receiverStore.receiveChunk({ sourceMemberId, transferId: plan.manifest.core.transferId, ...first })).nextChunkIndex).toBe("1")
      const second = await sender.readSendChunk(plan, "1")
      await receiverStore.receiveChunk({ sourceMemberId, transferId: plan.manifest.core.transferId, ...second })
      const evidence = await receiverStore.finalizeReceive({ sourceMemberId, transferId: plan.manifest.core.transferId })
      expect(evidence.reference.blob.digest).toBe(reference.blob.digest)
      expect(await receiverStore.queryHave([{ blobSha256: reference.blob.digest, byteLength: reference.blob.byteLength }])).toHaveLength(1)
      expect(await receiverStore.missingCurrentReferences([reference])).toEqual([])

      const digestPath = path.join(receiverDirectory, "blob-replication", "cache", "sha256", reference.blob.digest.slice(0, 2), reference.blob.digest)
      await fs.writeFile(digestPath, "tampered")
      expect(await receiverStore.queryHave([{ blobSha256: reference.blob.digest, byteLength: reference.blob.byteLength }])).toEqual([])
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  durabilityTest("rejects digest tampering and transfer-id equivocation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-blob-tamper-"))
    try {
      const sender = await open(await collaborationDirectory(root, "sender"))
      const receiverStore = await open(await collaborationDirectory(root, "receiver"))
      const bytes = new TextEncoder().encode("verified")
      const reference = resource(bytes)
      await sender.admitVerifiedBytes(reference, bytes)
      const plan = await sender.prepareSend({ reference, connectionId: id(6), transferId: id(7) })
      await receiverStore.beginReceive({ sourceMemberId, manifest: plan.manifest, reference })
      const chunk = await sender.readSendChunk(plan, "0")
      await expect(receiverStore.receiveChunk({ sourceMemberId, transferId: plan.manifest.core.transferId, header: chunk.header, rawChunk: new Uint8Array(chunk.rawChunk).fill(8) })).rejects.toThrow("invalid")
      await expect(receiverStore.beginReceive({ sourceMemberId, manifest: { ...plan.manifest, coreDigest: ordinarySha256(new TextEncoder().encode("other")) }, reference })).rejects.toThrow()
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  durabilityTest("admits a verified managed source incrementally without requiring one whole-file byte array", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-blob-stream-"))
    try {
      const store = await open(await collaborationDirectory(root, "project"))
      const bytes = new Uint8Array(2 * 1024 * 1024 + 31)
      bytes.fill(3, 0, 1024 * 1024)
      bytes.fill(4, 1024 * 1024)
      const reference = resource(bytes)
      let maximumChunk = 0
      await store.admitVerifiedStream(reference, {
        blob: reference.blob,
        async readChunks(consume) {
          for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
            const chunk = bytes.subarray(offset, Math.min(bytes.byteLength, offset + 64 * 1024))
            maximumChunk = Math.max(maximumChunk, chunk.byteLength)
            await consume(chunk)
          }
        },
      })
      expect(maximumChunk).toBe(64 * 1024)
      expect(await store.queryHave([{ blobSha256: reference.blob.digest, byteLength: reference.blob.byteLength }])).toHaveLength(1)
      await expect(store.admitVerifiedStream(reference, {
        blob: reference.blob,
        async readChunks(consume) { await consume(new TextEncoder().encode("wrong")) },
      })).rejects.toThrow("match")
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  durabilityTest("publishes only verified create-new materialization staging and notifies durable observers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-blob-materialize-"))
    try {
      const store = await open(await collaborationDirectory(root, "project"))
      const bytes = new TextEncoder().encode("materialize")
      const reference = resource(bytes)
      const published: string[] = []
      const unsubscribe = store.subscribePublished((blobDigest) => published.push(blobDigest))
      await store.admitVerifiedBytes(reference, bytes)
      const staging = path.join(root, "staging.bin")
      await store.copyVerifiedBytesTo(reference, staging)
      expect(await fs.readFile(staging)).toEqual(Buffer.from(bytes))
      await expect(store.copyVerifiedBytesTo(reference, staging)).rejects.toThrow()
      expect(published).toEqual([reference.blob.digest])
      unsubscribe()
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  durabilityTest("persists verified remote ACK but keeps it pending until the same current replica frame ACK exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-blob-ack-"))
    try {
      const directory = await collaborationDirectory(root, "sender")
      const store = await open(directory)
      const reference = resource(new TextEncoder().encode("ack"))
      const evidence = await store.admitVerifiedBytes(reference, new TextEncoder().encode("ack"))
      const core = store.createAckCore({ evidence, ...receiver })
      const ack = createBlobDurableAckV2(core, signature)
      await store.recordVerifiedRemoteAck({ ack, verifyCurrentAck: async () => true })
      expect(await store.evaluateReplication({ references: [reference], frameAckReceivers: [], verifyCurrentAck: () => true })).toBe("local-structural-only")
      expect(await store.evaluateReplication({ references: [reference], frameAckReceivers: [{ receiverReplicaId: receiver.receiverReplicaId, receiverAuthorizationDigest: receiver.receiverAuthorizationDigest }], verifyCurrentAck: () => true })).toBe("blob-replicated")
      const reopened = await open(directory)
      expect(await reopened.evaluateReplication({ references: [reference], frameAckReceivers: [{ receiverReplicaId: receiver.receiverReplicaId, receiverAuthorizationDigest: receiver.receiverAuthorizationDigest }], verifyCurrentAck: () => true })).toBe("blob-replicated")
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  durabilityTest("delays unreferenced cache GC across restart and deletes nothing when a root scan fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-blob-gc-"))
    let now = 1_000
    try {
      const directory = await collaborationDirectory(root, "project")
      let store = await open(directory, () => now)
      const bytes = new TextEncoder().encode("orphan")
      const reference = resource(bytes)
      await store.admitVerifiedBytes(reference, bytes)
      const emptyRoots = { scanCompleteRoots: async () => ({ complete: true as const, digests: new Set<ReturnType<typeof ordinarySha256>>() }) }
      expect((await store.runConservativeGc(emptyRoots)).deleted).toEqual([])
      now += 8 * 24 * 60 * 60 * 1000
      store = await open(directory, () => now)
      expect((await store.runConservativeGc(emptyRoots)).deleted).toEqual([reference.blob.digest])

      const retainedBytes = new TextEncoder().encode("retain-on-failure")
      const retained = resource(retainedBytes, "c")
      await store.admitVerifiedBytes(retained, retainedBytes)
      await expect(store.runConservativeGc({ scanCompleteRoots: async () => { throw new Error("ProjectIndex unreadable") } })).rejects.toThrow("ProjectIndex unreadable")
      expect(await store.queryHave([{ blobSha256: retained.blob.digest, byteLength: retained.blob.byteLength }])).toHaveLength(1)
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })

  test("requires every portable and durability root contributor before native GC receives a complete union", async () => {
    const a = ordinarySha256(new TextEncoder().encode("root-a"))
    const b = ordinarySha256(new TextEncoder().encode("root-b"))
    const contributor = (digests: ReadonlySet<typeof a>) => ({ scanRoots: async () => ({ complete: true as const, digests }) })
    const port = createCompleteProjectBlobRootScanPortV2({
      projectIndex: contributor(new Set([a])),
      canvasHistory: contributor(new Set([b])),
      collaborationEvidence: contributor(new Set([a])),
      conflictReservations: contributor(new Set()),
      publicationResetAndPartialSuccess: contributor(new Set()),
    })
    expect((await port.scanCompleteRoots({ projectId, projectEpoch })).digests).toEqual(new Set([a, b]))
    const failed = createCompleteProjectBlobRootScanPortV2({
      projectIndex: contributor(new Set([a])),
      canvasHistory: { scanRoots: async () => { throw new Error("Canvas history unreadable") } },
      collaborationEvidence: contributor(new Set()),
      conflictReservations: contributor(new Set()),
      publicationResetAndPartialSuccess: contributor(new Set()),
    })
    await expect(failed.scanCompleteRoots({ projectId, projectEpoch })).rejects.toThrow("Canvas history unreadable")
  })
})

async function collaborationDirectory(root: string, name: string) {
  const directory = path.join(root, name, ".convax", "collaboration")
  await fs.mkdir(directory, { recursive: true })
  return directory
}

function open(directory: string, now?: () => number) {
  return ProjectBlobReplicationStoreV2.open({ collaborationDirectory: directory, projectId, projectEpoch, protocolDigest: parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest), now })
}

function resource(bytes: Uint8Array, family = "a"): ProjectResourceReferenceV2 {
  const digest = ordinarySha256(bytes)
  return Object.freeze({
    format: "convax.project-resource-reference/2", projectId, projectEpoch,
    entryFileId: `pf_${family.repeat(64)}` as never, familyPrimaryFileId: `pf_${family.repeat(64)}` as never,
    versionId: `pv_${digest}`,
    canonicalUri: `convax-project://project-a/epochs/${projectEpoch}/entries/pf_${family.repeat(64)}?blob=sha256%3A${digest}`,
    blob: { format: "convax.blob-ref/2" as const, algorithm: "sha256" as const, digest, byteLength: String(bytes.byteLength) as never, mime: "application/octet-stream" },
    versionRecordDigest: ordinarySha256(new TextEncoder().encode(`version:${digest}`)),
  })
}
