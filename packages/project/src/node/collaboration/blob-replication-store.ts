import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcsV2,
  encodeRestrictedJcsV2,
  ordinarySha256V2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parseUint32V2,
  parseUint64V2,
  type DigestV2,
  type Id128V2,
  type MemberIdV2,
  type ProjectIdV2,
  type Uint64V2,
} from "@convax/collaboration"
import {
  blobDurableAckCoreFromReferenceV2,
  evaluateProjectBlobReplicationStatusV2,
  parseBlobDurableAckV2,
  type BlobDurableAckCoreV2,
  type BlobDurableAckV2,
  type ProjectBlobHaveV2,
  type ProjectBlobReplicationStatusV2,
} from "../../collaboration/blob-replication"
import { BLOB_CHUNK_BYTES } from "../../collaboration/blob-protocol"
import {
  createPeerTransferManifestV2,
  parsePeerTransferManifestV2,
  type PeerTransferChunkHeaderV2,
  type PeerTransferManifestV2,
} from "../../collaboration-protocol/peer-wire"
import {
  parseProjectResourceReferenceV2,
  projectResourceReferenceDigestV2,
  type ProjectResourceReferenceV2,
} from "../../collaboration/project-index"
import type { ProjectIndexManagedBlobAdmissionV2 } from "../../canvas/project-index-file-application"
import { fsyncProjectDirectoryV2 } from "./directory-durability"

const digestPattern = /^[0-9a-f]{64}$/u
const maximumBlobBytes = 64n * 1024n * 1024n * 1024n
const gcGraceMs = 7 * 24 * 60 * 60 * 1000
const gcMaximumObjects = 1_024
const gcMaximumBytes = 16n * 1024n * 1024n * 1024n

export interface ProjectBlobRootScanPortV2 {
  /** Must include every ProjectIndex/Canvas/history/outbox/recovery root or throw. */
  scanCompleteRoots(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
  }): Promise<Readonly<{ complete: true; digests: ReadonlySet<DigestV2> }>>
}

export interface ProjectBlobRootContributorV2 {
  scanRoots(input: {
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
  }): Promise<Readonly<{ complete: true; digests: ReadonlySet<DigestV2> }>>
}

/**
 * Exact owner seams required before native blob GC may claim a complete scan.
 * Active native transfers are added by ProjectBlobReplicationStoreV2 itself.
 */
export interface CompleteProjectBlobRootContributorsV2 {
  readonly projectIndex: ProjectBlobRootContributorV2
  readonly canvasHistory: ProjectBlobRootContributorV2
  readonly collaborationEvidence: ProjectBlobRootContributorV2
  readonly conflictReservations: ProjectBlobRootContributorV2
  readonly publicationResetAndPartialSuccess: ProjectBlobRootContributorV2
}

export function createCompleteProjectBlobRootScanPortV2(
  contributors: CompleteProjectBlobRootContributorsV2,
): ProjectBlobRootScanPortV2 {
  const ordered = Object.freeze([
    contributors.projectIndex,
    contributors.canvasHistory,
    contributors.collaborationEvidence,
    contributors.conflictReservations,
    contributors.publicationResetAndPartialSuccess,
  ])
  if (ordered.some((contributor) => !contributor || typeof contributor.scanRoots !== "function")) {
    throw new TypeError("Complete Project blob root contributors are unavailable")
  }
  return Object.freeze({
    async scanCompleteRoots(input: { readonly projectId: ProjectIdV2; readonly projectEpoch: Id128V2 }) {
      const projectId = parseProjectIdV2(input.projectId)
      const projectEpoch = parseId128V2(input.projectEpoch)
      const results = await Promise.all(ordered.map((contributor) => contributor.scanRoots({ projectId, projectEpoch })))
      const digests = new Set<DigestV2>()
      for (const result of results) {
        if (!result || result.complete !== true || !result.digests || typeof result.digests[Symbol.iterator] !== "function") {
          throw new Error("Project blob root contributor returned an incomplete scan")
        }
        for (const digest of result.digests) digests.add(parseDigestV2(digest))
      }
      return Object.freeze({ complete: true as const, digests })
    },
  })
}

export interface ProjectBlobReceiveProgressV2 {
  readonly transferId: Id128V2
  readonly manifestDigest: DigestV2
  readonly nextChunkIndex: string
  readonly acceptedByteLength: Uint64V2
  readonly complete: boolean
}

export interface ProjectBlobDurabilityEvidenceV2 {
  readonly format: "convax.local-blob-durability-evidence/2"
  readonly reference: ProjectResourceReferenceV2
  readonly presenceGeneration: Uint64V2
  readonly verifiedObjectKey: string
}

export interface ProjectBlobSendPlanV2 {
  readonly manifest: PeerTransferManifestV2
  readonly reference: ProjectResourceReferenceV2
}

interface PresenceEntryV2 {
  readonly blobSha256: DigestV2
  readonly byteLength: Uint64V2
  readonly locationKind: "replication-cache"
  readonly verifiedObjectKey: string
  readonly verifiedGeneration: Uint64V2
}

interface PresenceIndexV2 {
  readonly format: "convax.local-blob-presence-index/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly generation: Uint64V2
  readonly entries: readonly PresenceEntryV2[]
}

interface TransferRecordV2 {
  readonly format: "convax.local-blob-transfer/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly sourceMemberId: MemberIdV2
  readonly transferId: Id128V2
  readonly manifest: PeerTransferManifestV2
  readonly reference: ProjectResourceReferenceV2
  readonly nextChunkIndex: string
  readonly acceptedByteLength: Uint64V2
  readonly state: "receiving" | "published"
}

interface BlobGcEntryV2 {
  readonly firstUnreferencedUnixMs: string
  readonly firstStoreGeneration: Uint64V2
  readonly lastScanGeneration: Uint64V2
}

interface BlobGcStateV2 {
  readonly format: "convax.local-blob-gc/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly lastScanUnixMs: string
  readonly entries: Readonly<Record<string, BlobGcEntryV2>>
}

export class ProjectBlobReplicationStoreV2 {
  readonly #root: string
  readonly #cacheRoot: string
  readonly #transfersRoot: string
  readonly #acksRoot: string
  readonly #presencePath: string
  readonly #gcPath: string
  readonly #projectId: ProjectIdV2
  readonly #projectEpoch: Id128V2
  readonly #protocolDigest: DigestV2
  readonly #now: () => number
  #presence: PresenceIndexV2
  #queue: Promise<void> = Promise.resolve()
  readonly #publishedListeners = new Set<(digest: DigestV2) => void>()

  private constructor(input: {
    root: string
    projectId: ProjectIdV2
    projectEpoch: Id128V2
    protocolDigest: DigestV2
    now: () => number
    presence: PresenceIndexV2
  }) {
    this.#root = input.root
    this.#cacheRoot = path.join(input.root, "cache", "sha256")
    this.#transfersRoot = path.join(input.root, "transfers")
    this.#acksRoot = path.join(input.root, "acks")
    this.#presencePath = path.join(input.root, "presence-index-v2.bin")
    this.#gcPath = path.join(input.root, "gc-v2.bin")
    this.#projectId = input.projectId
    this.#projectEpoch = input.projectEpoch
    this.#protocolDigest = input.protocolDigest
    this.#now = input.now
    this.#presence = input.presence
  }

  static async open(input: {
    readonly collaborationDirectory: string
    readonly projectId: ProjectIdV2
    readonly projectEpoch: Id128V2
    readonly protocolDigest: DigestV2
    readonly now?: () => number
  }): Promise<ProjectBlobReplicationStoreV2> {
    if (!path.isAbsolute(input.collaborationDirectory)) throw new TypeError("Collaboration directory must be absolute")
    const projectId = parseProjectIdV2(input.projectId)
    const projectEpoch = parseId128V2(input.projectEpoch)
    const protocolDigest = parseDigestV2(input.protocolDigest)
    const collaboration = await requireRealDirectory(input.collaborationDirectory, "Collaboration directory")
    const root = path.join(collaboration, "blob-replication")
    await ensureRealDirectory(root)
    await ensureRealDirectory(path.join(root, "cache"))
    await ensureRealDirectory(path.join(root, "cache", "sha256"))
    await ensureRealDirectory(path.join(root, "transfers"))
    await ensureRealDirectory(path.join(root, "acks"))
    const presencePath = path.join(root, "presence-index-v2.bin")
    const previous = await readPresenceIndex(presencePath, projectId, projectEpoch).catch(() => null)
    const generation = String(BigInt(previous?.generation ?? "0") + 1n) as Uint64V2
    const rebuilt = await rebuildPresence(path.join(root, "cache", "sha256"), projectId, projectEpoch, generation)
    await replaceJcs(presencePath, rebuilt)
    return new ProjectBlobReplicationStoreV2({
      root,
      projectId,
      projectEpoch,
      protocolDigest,
      now: input.now ?? Date.now,
      presence: rebuilt,
    })
  }

  get generation(): Uint64V2 { return this.#presence.generation }

  subscribePublished(listener: (digest: DigestV2) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("Blob publication listener is required")
    this.#publishedListeners.add(listener)
    return () => this.#publishedListeners.delete(listener)
  }

  /**
   * Copies one already verified cache object into a caller-owned create-new
   * staging path. Project/node's materializer owns target containment and final
   * publication; the blob cache never becomes path authority.
   */
  async copyVerifiedBytesTo(reference: ProjectResourceReferenceV2, stagingPath: string): Promise<void> {
    return this.#serial(async () => {
      this.#validateReference(reference)
      if (!path.isAbsolute(stagingPath)) throw new TypeError("Blob materialization staging path must be absolute")
      await this.#requirePresent(reference)
      await fs.copyFile(this.#blobPath(reference.blob.digest), stagingPath, fsConstants.COPYFILE_EXCL)
      try {
        await verifyFile(stagingPath, reference.blob.digest, reference.blob.byteLength)
        await fsyncFile(stagingPath)
        await fsyncProjectDirectoryV2(path.dirname(stagingPath))
      } catch (error) {
        await fs.rm(stagingPath, { force: true }).catch(() => undefined)
        throw error
      }
    })
  }

  async admitVerifiedBytes(reference: ProjectResourceReferenceV2, bytesInput: Readonly<Uint8Array>): Promise<ProjectBlobDurabilityEvidenceV2> {
    const bytes = new Uint8Array(bytesInput)
    return this.#serial(async () => {
      this.#validateReference(reference)
      if (BigInt(bytes.byteLength) !== BigInt(reference.blob.byteLength) || ordinarySha256V2(bytes) !== reference.blob.digest) {
        throw new Error("Blob admission bytes do not match the ProjectIndex reference")
      }
      const staging = path.join(this.#transfersRoot, `admit-${randomUUID()}.part`)
      await writeNewDurable(staging, bytes)
      try {
        return await this.#publishStaging(reference, staging)
      } finally {
        await fs.rm(staging, { force: true }).catch(() => undefined)
      }
    })
  }

  async admitVerifiedStream(
    reference: ProjectResourceReferenceV2,
    admission: ProjectIndexManagedBlobAdmissionV2,
  ): Promise<ProjectBlobDurabilityEvidenceV2> {
    return this.#serial(async () => {
      this.#validateReference(reference)
      if (
        admission.blob.format !== reference.blob.format ||
        admission.blob.algorithm !== reference.blob.algorithm ||
        admission.blob.digest !== reference.blob.digest ||
        admission.blob.byteLength !== reference.blob.byteLength ||
        admission.blob.mime !== reference.blob.mime
      ) {
        throw new Error("Managed blob admission does not match the ProjectIndex reference")
      }
      const expectedLength = BigInt(reference.blob.byteLength)
      const staging = path.join(this.#transfersRoot, `admit-${randomUUID()}.part`)
      const handle = await fs.open(staging, "wx", 0o600)
      let closed = false
      try {
        const hash = createHash("sha256")
        let byteLength = 0n
        await admission.readChunks(async (chunkInput) => {
          const chunk = new Uint8Array(chunkInput)
          if (chunk.byteLength === 0) return
          byteLength += BigInt(chunk.byteLength)
          if (byteLength > expectedLength) throw new Error("Managed blob admission exceeded its declared length")
          hash.update(chunk)
          let offset = 0
          while (offset < chunk.byteLength) {
            const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, null)
            if (bytesWritten < 1) throw new Error("Managed blob admission made no write progress")
            offset += bytesWritten
          }
        })
        if (byteLength !== expectedLength || hash.digest("hex") !== reference.blob.digest) {
          throw new Error("Managed blob admission bytes do not match the ProjectIndex reference")
        }
        await handle.sync()
        await handle.close()
        closed = true
        return await this.#publishStaging(reference, staging)
      } finally {
        if (!closed) await handle.close().catch(() => undefined)
        await fs.rm(staging, { force: true }).catch(() => undefined)
      }
    })
  }

  async queryHave(blobs: readonly ProjectBlobHaveV2[]): Promise<readonly ProjectBlobHaveV2[]> {
    return this.#serial(async () => {
      const result: ProjectBlobHaveV2[] = []
      for (const blob of blobs) {
        const digest = parseDigestV2(blob.blobSha256)
        const byteLength = parseUint64V2(blob.byteLength)
        const entry = this.#presence.entries.find((candidate) => candidate.blobSha256 === digest && candidate.byteLength === byteLength)
        if (!entry) continue
        try {
          await verifyFile(this.#blobPath(digest), digest, byteLength)
          result.push(Object.freeze({ blobSha256: digest, byteLength }))
        } catch {
          await this.#removePresence(digest)
        }
      }
      return Object.freeze(result)
    })
  }

  async missingCurrentReferences(references: readonly ProjectResourceReferenceV2[]): Promise<readonly ProjectResourceReferenceV2[]> {
    const wanted = references.map((reference) => {
      this.#validateReference(reference)
      return { blobSha256: reference.blob.digest, byteLength: reference.blob.byteLength }
    })
    const have = new Set((await this.queryHave(wanted)).map((blob) => `${blob.blobSha256}:${blob.byteLength}`))
    return Object.freeze(references.filter((reference) => !have.has(`${reference.blob.digest}:${reference.blob.byteLength}`)))
  }

  async prepareSend(input: {
    readonly reference: ProjectResourceReferenceV2
    readonly connectionId: Id128V2
    readonly transferId: Id128V2
  }): Promise<ProjectBlobSendPlanV2> {
    return this.#serial(async () => {
      this.#validateReference(input.reference)
      if (BigInt(input.reference.blob.byteLength) === 0n) throw new Error("Zero-byte blobs are locally materialized and have no wire transfer")
      await this.#requirePresent(input.reference)
      const chunkBytes = Math.min(BLOB_CHUNK_BYTES, Number(BigInt(input.reference.blob.byteLength)))
      const chunkCount = (BigInt(input.reference.blob.byteLength) + BigInt(chunkBytes) - 1n) / BigInt(chunkBytes)
      const manifest = createPeerTransferManifestV2({
        format: "convax.peer-transfer-manifest-core/2",
        connectionId: parseId128V2(input.connectionId),
        transferId: parseId128V2(input.transferId),
        channel: "blob",
        kind: "project-blob",
        scope: null,
        subjectDigest: projectResourceReferenceDigestV2(input.reference),
        byteLength: input.reference.blob.byteLength,
        sha256: input.reference.blob.digest,
        chunkBytes: String(chunkBytes) as never,
        chunkCount: chunkCount.toString() as never,
        compression: "none",
        protocolDigest: this.#protocolDigest,
      })
      return Object.freeze({ manifest, reference: input.reference })
    })
  }

  async readSendChunk(plan: ProjectBlobSendPlanV2, chunkIndexInput: string): Promise<Readonly<{
    header: PeerTransferChunkHeaderV2
    rawChunk: Uint8Array
  }>> {
    return this.#serial(async () => {
      this.#validateReference(plan.reference)
      const index = BigInt(parseUint32V2(chunkIndexInput))
      const chunkCount = BigInt(plan.manifest.core.chunkCount)
      if (index >= chunkCount) throw new Error("Blob send chunk index is out of range")
      if (plan.manifest.core.subjectDigest !== projectResourceReferenceDigestV2(plan.reference)) throw new Error("Blob send plan is stale")
      await this.#requirePresent(plan.reference)
      const chunkBytes = BigInt(plan.manifest.core.chunkBytes)
      const offset = index * chunkBytes
      const length = Number(index + 1n === chunkCount ? BigInt(plan.manifest.core.byteLength) - offset : chunkBytes)
      const handle = await openReadNoFollow(this.#blobPath(plan.reference.blob.digest))
      try {
        const rawChunk = new Uint8Array(length)
        const { bytesRead } = await handle.read(rawChunk, 0, length, Number(offset))
        if (bytesRead !== length) throw new Error("Blob send source was truncated")
        const header: PeerTransferChunkHeaderV2 = Object.freeze({
          format: "convax.peer-transfer-chunk/2",
          transferId: plan.manifest.core.transferId,
          manifestDigest: plan.manifest.coreDigest,
          chunkIndex: index.toString() as never,
          byteOffset: offset.toString() as never,
          byteLength: String(length) as never,
          chunkSha256: ordinarySha256V2(rawChunk),
        })
        return Object.freeze({ header, rawChunk })
      } finally {
        await handle.close()
      }
    })
  }

  async beginReceive(input: {
    readonly sourceMemberId: MemberIdV2
    readonly manifest: PeerTransferManifestV2
    readonly reference: ProjectResourceReferenceV2
  }): Promise<ProjectBlobReceiveProgressV2> {
    return this.#serial(async () => {
      this.#validateReference(input.reference)
      const sourceMemberId = parseMemberIdV2(input.sourceMemberId)
      this.#validateManifest(input.manifest, input.reference)
      const key = transferKey(this.#projectId, this.#projectEpoch, sourceMemberId, input.manifest.core.transferId)
      const metadataPath = path.join(this.#transfersRoot, `${key}.bin`)
      const partialPath = path.join(this.#transfersRoot, `${key}.part`)
      const existing = await readJcsIfPresent(metadataPath)
      if (existing !== null) {
        const record = parseTransferRecord(existing)
        this.#validateTransferRecord(record, sourceMemberId, input.manifest.core.transferId)
        if (record.manifest.coreDigest !== input.manifest.coreDigest) throw new Error("Blob transfer id equivocation")
        if (projectResourceReferenceDigestV2(record.reference) !== projectResourceReferenceDigestV2(input.reference)) {
          throw new Error("Blob transfer reference equivocation")
        }
        await normalizePartial(partialPath, record)
        return progress(record)
      }
      const record: TransferRecordV2 = Object.freeze({
        format: "convax.local-blob-transfer/2",
        projectId: this.#projectId,
        projectEpoch: this.#projectEpoch,
        sourceMemberId,
        transferId: input.manifest.core.transferId,
        manifest: input.manifest,
        reference: input.reference,
        nextChunkIndex: "0",
        acceptedByteLength: "0" as Uint64V2,
        state: "receiving",
      })
      await writeNewDurable(partialPath, new Uint8Array())
      await writeNewDurable(metadataPath, encodeRestrictedJcsV2(record))
      return progress(record)
    })
  }

  async receiveChunk(input: {
    readonly sourceMemberId: MemberIdV2
    readonly transferId: Id128V2
    readonly header: PeerTransferChunkHeaderV2
    readonly rawChunk: Readonly<Uint8Array>
  }): Promise<ProjectBlobReceiveProgressV2> {
    return this.#serial(async () => {
      const sourceMemberId = parseMemberIdV2(input.sourceMemberId)
      const transferId = parseId128V2(input.transferId)
      const key = transferKey(this.#projectId, this.#projectEpoch, sourceMemberId, transferId)
      const metadataPath = path.join(this.#transfersRoot, `${key}.bin`)
      const partialPath = path.join(this.#transfersRoot, `${key}.part`)
      const record = parseTransferRecord(await readRequiredJcs(metadataPath))
      this.#validateTransferRecord(record, sourceMemberId, transferId)
      if (record.state === "published") return progress(record)
      if (input.header.transferId !== transferId || input.header.manifestDigest !== record.manifest.coreDigest) throw new Error("Blob chunk transfer binding mismatches")
      const index = BigInt(parseUint32V2(input.header.chunkIndex))
      const rawChunk = new Uint8Array(input.rawChunk)
      const chunkCount = BigInt(record.manifest.core.chunkCount)
      const chunkBytes = BigInt(record.manifest.core.chunkBytes)
      if (index >= chunkCount || BigInt(input.header.byteOffset) !== index * chunkBytes) throw new Error("Blob chunk position is invalid")
      const expectedLength = Number(index + 1n === chunkCount ? BigInt(record.manifest.core.byteLength) - index * chunkBytes : chunkBytes)
      if (rawChunk.byteLength !== expectedLength || BigInt(input.header.byteLength) !== BigInt(expectedLength) || ordinarySha256V2(rawChunk) !== input.header.chunkSha256) {
        throw new Error("Blob chunk bytes are invalid")
      }
      const next = BigInt(record.nextChunkIndex)
      if (index > next) throw new Error("Blob chunks must be contiguous")
      if (index < next) {
        const existing = await readRange(partialPath, Number(BigInt(input.header.byteOffset)), expectedLength)
        if (ordinarySha256V2(existing) !== input.header.chunkSha256) throw new Error("Duplicate blob chunk storage is corrupt")
        return progress(record)
      }
      const handle = await fs.open(partialPath, "r+")
      try {
        await handle.write(rawChunk, 0, rawChunk.byteLength, Number(BigInt(input.header.byteOffset)))
        await handle.sync()
      } finally { await handle.close() }
      const nextRecord: TransferRecordV2 = Object.freeze({
        ...record,
        nextChunkIndex: String(index + 1n),
        acceptedByteLength: (BigInt(record.acceptedByteLength) + BigInt(expectedLength)).toString() as Uint64V2,
      })
      await replaceJcs(metadataPath, nextRecord)
      return progress(nextRecord)
    })
  }

  async finalizeReceive(input: {
    readonly sourceMemberId: MemberIdV2
    readonly transferId: Id128V2
  }): Promise<ProjectBlobDurabilityEvidenceV2> {
    return this.#serial(async () => {
      const sourceMemberId = parseMemberIdV2(input.sourceMemberId)
      const transferId = parseId128V2(input.transferId)
      const key = transferKey(this.#projectId, this.#projectEpoch, sourceMemberId, transferId)
      const metadataPath = path.join(this.#transfersRoot, `${key}.bin`)
      const partialPath = path.join(this.#transfersRoot, `${key}.part`)
      const record = parseTransferRecord(await readRequiredJcs(metadataPath))
      this.#validateTransferRecord(record, sourceMemberId, transferId)
      if (BigInt(record.nextChunkIndex) !== BigInt(record.manifest.core.chunkCount) || record.acceptedByteLength !== record.manifest.core.byteLength) throw new Error("Blob transfer is incomplete")
      if (record.state === "published") return this.#requirePresent(record.reference)
      await verifyFile(partialPath, record.reference.blob.digest, record.reference.blob.byteLength)
      const evidence = await this.#publishStaging(record.reference, partialPath)
      const published: TransferRecordV2 = Object.freeze({ ...record, state: "published" })
      await replaceJcs(metadataPath, published)
      await fs.rm(partialPath, { force: true })
      await fsyncProjectDirectoryV2(this.#transfersRoot)
      return evidence
    })
  }

  createAckCore(input: {
    readonly evidence: ProjectBlobDurabilityEvidenceV2
    readonly receiverMemberId: BlobDurableAckCoreV2["receiverMemberId"]
    readonly receiverReplicaId: BlobDurableAckCoreV2["receiverReplicaId"]
    readonly receiverActorId: BlobDurableAckCoreV2["receiverActorId"]
    readonly receiverAuthorizationDigest: BlobDurableAckCoreV2["receiverAuthorizationDigest"]
  }): BlobDurableAckCoreV2 {
    if (input.evidence.presenceGeneration !== this.#presence.generation) throw new Error("Blob durability evidence is stale")
    return blobDurableAckCoreFromReferenceV2({
      reference: input.evidence.reference,
      receiverMemberId: input.receiverMemberId,
      receiverReplicaId: input.receiverReplicaId,
      receiverActorId: input.receiverActorId,
      receiverAuthorizationDigest: input.receiverAuthorizationDigest,
      protocolDigest: this.#protocolDigest,
    })
  }

  async recordVerifiedRemoteAck(input: {
    readonly ack: BlobDurableAckV2
    readonly verifyCurrentAck: (ack: BlobDurableAckV2) => Promise<boolean>
  }): Promise<void> {
    return this.#serial(async () => {
      const ack = parseBlobDurableAckV2(input.ack)
      if (ack.core.projectId !== this.#projectId || ack.core.projectEpoch !== this.#projectEpoch || ack.core.protocolDigest !== this.#protocolDigest) {
        throw new Error("Remote blob ACK scope is invalid")
      }
      if (!(await input.verifyCurrentAck(ack))) throw new Error("Remote blob ACK is not current and verified")
      await writeNewOrVerify(path.join(this.#acksRoot, `${ack.coreDigest}.bin`), encodeRestrictedJcsV2(ack))
    })
  }

  async evaluateReplication(input: {
    readonly references: readonly ProjectResourceReferenceV2[]
    readonly frameAckReceivers: Parameters<typeof evaluateProjectBlobReplicationStatusV2>[0]["frameAckReceivers"]
    readonly verifyCurrentAck: (ack: BlobDurableAckV2) => boolean
  }): Promise<ProjectBlobReplicationStatusV2> {
    return this.#serial(async () => {
      const acks: BlobDurableAckV2[] = []
      for (const entry of await fs.readdir(this.#acksRoot, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !/^[0-9a-f]{64}\.bin$/u.test(entry.name)) continue
        acks.push(parseBlobDurableAckV2(await readRequiredJcs(path.join(this.#acksRoot, entry.name))))
      }
      return evaluateProjectBlobReplicationStatusV2({ ...input, blobAcks: acks })
    })
  }

  async runConservativeGc(roots: ProjectBlobRootScanPortV2): Promise<Readonly<{ deleted: readonly DigestV2[] }>> {
    return this.#serial(async () => {
      const now = this.#now()
      if (!Number.isSafeInteger(now) || now < 0) throw new Error("Blob GC clock is invalid")
      const first = await roots.scanCompleteRoots({ projectId: this.#projectId, projectEpoch: this.#projectEpoch })
      if (first.complete !== true) throw new Error("Blob root scan is incomplete")
      const activeTransferDigests = await this.#activeTransferDigests()
      const live = new Set<DigestV2>([...first.digests, ...activeTransferDigests])
      const inventory = await this.#verifiedInventory()
      const loaded = await readGcState(this.#gcPath, this.#projectId, this.#projectEpoch).catch(() => null)
      const rollback = loaded !== null && BigInt(loaded.lastScanUnixMs) > BigInt(now)
      const entries: Record<string, BlobGcEntryV2> = Object.create(null)
      for (const item of inventory) {
        if (live.has(item.digest)) continue
        const previous = rollback ? undefined : loaded?.entries[item.digest]
        entries[item.digest] = previous ?? {
          firstUnreferencedUnixMs: String(now),
          firstStoreGeneration: this.#presence.generation,
          lastScanGeneration: this.#presence.generation,
        }
      }
      const state: BlobGcStateV2 = {
        format: "convax.local-blob-gc/2",
        projectId: this.#projectId,
        projectEpoch: this.#projectEpoch,
        lastScanUnixMs: String(now),
        entries,
      }
      await replaceJcs(this.#gcPath, state)
      if (loaded === null || rollback) return Object.freeze({ deleted: Object.freeze([]) })
      const due = inventory.filter((item) => {
        const entry = entries[item.digest]
        return entry !== undefined && BigInt(now) - BigInt(entry.firstUnreferencedUnixMs) >= BigInt(gcGraceMs) &&
          BigInt(entry.firstStoreGeneration) < BigInt(this.#presence.generation)
      })
      if (due.length === 0) return Object.freeze({ deleted: Object.freeze([]) })
      const second = await roots.scanCompleteRoots({ projectId: this.#projectId, projectEpoch: this.#projectEpoch })
      if (second.complete !== true) throw new Error("Second blob root scan is incomplete")
      const liveAgain = new Set<DigestV2>([...second.digests, ...(await this.#activeTransferDigests())])
      const selected: typeof due = []
      let bytes = 0n
      for (const item of due) {
        if (liveAgain.has(item.digest) || selected.length >= gcMaximumObjects || bytes + item.byteLength > gcMaximumBytes) continue
        selected.push(item)
        bytes += item.byteLength
      }
      // Timing state is durable before unlink. A failed unlink keeps the entry for retry.
      await replaceJcs(this.#gcPath, state)
      const deleted: DigestV2[] = []
      for (const item of selected) {
        await verifyFile(this.#blobPath(item.digest), item.digest, item.byteLength.toString() as Uint64V2)
        await fs.unlink(this.#blobPath(item.digest))
        delete entries[item.digest]
        deleted.push(item.digest)
      }
      if (deleted.length > 0) {
        await this.#replacePresence(this.#presence.entries.filter((entry) => !deleted.includes(entry.blobSha256)))
        await replaceJcs(this.#gcPath, { ...state, entries })
      }
      return Object.freeze({ deleted: Object.freeze(deleted) })
    })
  }

  async #publishStaging(reference: ProjectResourceReferenceV2, staging: string): Promise<ProjectBlobDurabilityEvidenceV2> {
    await verifyFile(staging, reference.blob.digest, reference.blob.byteLength)
    const target = this.#blobPath(reference.blob.digest)
    await ensureRealDirectory(path.dirname(target))
    try { await fs.link(staging, target) } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error
      await verifyFile(target, reference.blob.digest, reference.blob.byteLength)
    }
    await fsyncFile(target)
    await fsyncProjectDirectoryV2(path.dirname(target))
    await fsyncProjectDirectoryV2(this.#cacheRoot)
    const objectKey = `sha256/${reference.blob.digest.slice(0, 2)}/${reference.blob.digest}`
    const without = this.#presence.entries.filter((entry) => entry.blobSha256 !== reference.blob.digest)
    await this.#replacePresence([...without, Object.freeze({
      blobSha256: reference.blob.digest,
      byteLength: reference.blob.byteLength,
      locationKind: "replication-cache" as const,
      verifiedObjectKey: objectKey,
      verifiedGeneration: this.#presence.generation,
    })])
    for (const listener of this.#publishedListeners) {
      try { listener(reference.blob.digest) } catch { /* Blob durability is independent of observers. */ }
    }
    return Object.freeze({
      format: "convax.local-blob-durability-evidence/2",
      reference,
      presenceGeneration: this.#presence.generation,
      verifiedObjectKey: objectKey,
    })
  }

  async #requirePresent(reference: ProjectResourceReferenceV2): Promise<ProjectBlobDurabilityEvidenceV2> {
    const entry = this.#presence.entries.find((candidate) => candidate.blobSha256 === reference.blob.digest && candidate.byteLength === reference.blob.byteLength)
    if (!entry) throw new Error("Project blob is not locally durable")
    await verifyFile(this.#blobPath(reference.blob.digest), reference.blob.digest, reference.blob.byteLength)
    return Object.freeze({ format: "convax.local-blob-durability-evidence/2", reference, presenceGeneration: this.#presence.generation, verifiedObjectKey: entry.verifiedObjectKey })
  }

  async #removePresence(digest: DigestV2) { await this.#replacePresence(this.#presence.entries.filter((entry) => entry.blobSha256 !== digest)) }

  async #replacePresence(entries: readonly PresenceEntryV2[]) {
    const next: PresenceIndexV2 = Object.freeze({
      ...this.#presence,
      entries: Object.freeze([...entries].sort((left, right) => left.blobSha256.localeCompare(right.blobSha256, "en-US"))),
    })
    await replaceJcs(this.#presencePath, next)
    this.#presence = next
  }

  #validateReference(reference: ProjectResourceReferenceV2) {
    if (reference.projectId !== this.#projectId || reference.projectEpoch !== this.#projectEpoch) throw new Error("Project blob reference scope mismatches store")
    parseDigestV2(reference.blob.digest)
    const length = BigInt(parseUint64V2(reference.blob.byteLength))
    if (length > maximumBlobBytes) throw new Error("Project blob exceeds 64 GiB")
  }

  #validateManifest(manifest: PeerTransferManifestV2, reference: ProjectResourceReferenceV2) {
    if (manifest.core.kind !== "project-blob" || manifest.core.channel !== "blob" || manifest.core.scope !== null ||
      manifest.core.protocolDigest !== this.#protocolDigest || manifest.core.subjectDigest !== projectResourceReferenceDigestV2(reference) ||
      manifest.core.sha256 !== reference.blob.digest || manifest.core.byteLength !== reference.blob.byteLength) {
      throw new Error("Blob transfer manifest does not bind the current Project reference")
    }
  }

  #validateTransferRecord(record: TransferRecordV2, sourceMemberId?: MemberIdV2, transferId?: Id128V2) {
    if (
      record.projectId !== this.#projectId || record.projectEpoch !== this.#projectEpoch ||
      (sourceMemberId !== undefined && record.sourceMemberId !== sourceMemberId) ||
      (transferId !== undefined && record.transferId !== transferId)
    ) throw new Error("Blob transfer metadata scope is invalid")
    this.#validateReference(record.reference)
    this.#validateManifest(record.manifest, record.reference)
    if (record.manifest.core.transferId !== record.transferId) throw new Error("Blob transfer metadata identity is invalid")
  }

  #blobPath(digest: DigestV2) { return path.join(this.#cacheRoot, digest.slice(0, 2), digest) }

  async #activeTransferDigests(): Promise<ReadonlySet<DigestV2>> {
    const result = new Set<DigestV2>()
    for (const entry of await fs.readdir(this.#transfersRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[0-9a-f]{64}\.bin$/u.test(entry.name)) continue
      const record = parseTransferRecord(await readRequiredJcs(path.join(this.#transfersRoot, entry.name)))
      this.#validateTransferRecord(record)
      if (record.state === "receiving") result.add(record.reference.blob.digest)
    }
    return result
  }

  async #verifiedInventory(): Promise<readonly { digest: DigestV2; byteLength: bigint }[]> {
    const result: { digest: DigestV2; byteLength: bigint }[] = []
    for (const prefix of await fs.readdir(this.#cacheRoot, { withFileTypes: true })) {
      if (!prefix.isDirectory() || prefix.isSymbolicLink() || !/^[0-9a-f]{2}$/u.test(prefix.name)) continue
      const directory = path.join(this.#cacheRoot, prefix.name)
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !digestPattern.test(entry.name) || entry.name.slice(0, 2) !== prefix.name) continue
        const stat = await fs.lstat(path.join(directory, entry.name), { bigint: true })
        await verifyFile(path.join(directory, entry.name), entry.name as DigestV2, stat.size.toString() as Uint64V2)
        result.push({ digest: entry.name as DigestV2, byteLength: stat.size })
      }
    }
    return result
  }

  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation)
    this.#queue = result.then(() => undefined, () => undefined)
    return result
  }
}

function progress(record: TransferRecordV2): ProjectBlobReceiveProgressV2 {
  return Object.freeze({
    transferId: record.transferId,
    manifestDigest: record.manifest.coreDigest,
    nextChunkIndex: record.nextChunkIndex,
    acceptedByteLength: record.acceptedByteLength,
    complete: record.state === "published",
  })
}

function parseTransferRecord(value: unknown): TransferRecordV2 {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Blob transfer metadata is invalid")
  const keys = Object.keys(value).sort()
  const expectedKeys = ["acceptedByteLength", "format", "manifest", "nextChunkIndex", "projectEpoch", "projectId", "reference", "sourceMemberId", "state", "transferId"]
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) throw new Error("Blob transfer metadata is invalid")
  const input = value as TransferRecordV2
  const record: TransferRecordV2 = Object.freeze({
    format: input.format,
    projectId: parseProjectIdV2(input.projectId),
    projectEpoch: parseId128V2(input.projectEpoch),
    sourceMemberId: parseMemberIdV2(input.sourceMemberId),
    transferId: parseId128V2(input.transferId),
    manifest: parsePeerTransferManifestV2(input.manifest),
    reference: parseProjectResourceReferenceV2(input.reference),
    nextChunkIndex: parseUint32V2(input.nextChunkIndex),
    acceptedByteLength: parseUint64V2(input.acceptedByteLength),
    state: input.state,
  })
  if (record.format !== "convax.local-blob-transfer/2" || (record.state !== "receiving" && record.state !== "published")) throw new Error("Blob transfer metadata is invalid")
  if (BigInt(record.nextChunkIndex) > BigInt(record.manifest.core.chunkCount) || BigInt(record.acceptedByteLength) > BigInt(record.manifest.core.byteLength)) throw new Error("Blob transfer progress is invalid")
  return record
}

async function normalizePartial(partialPath: string, record: TransferRecordV2) {
  if (record.state === "published") return
  const accepted = BigInt(record.acceptedByteLength)
  const stat = await fs.lstat(partialPath, { bigint: true })
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < accepted) throw new Error("Blob transfer staging is truncated")
  if (stat.size > accepted) await fs.truncate(partialPath, Number(accepted))
}

function transferKey(projectId: ProjectIdV2, projectEpoch: Id128V2, sourceMemberId: MemberIdV2, transferId: Id128V2): string {
  const hash = createHash("sha256")
  hash.update("convax.local-blob-transfer-key/2\0")
  hash.update(encodeRestrictedJcsV2({ projectId, projectEpoch, sourceMemberId, transferId }))
  return hash.digest("hex")
}

async function rebuildPresence(cacheRoot: string, projectId: ProjectIdV2, projectEpoch: Id128V2, generation: Uint64V2): Promise<PresenceIndexV2> {
  const entries: PresenceEntryV2[] = []
  for (const prefix of await fs.readdir(cacheRoot, { withFileTypes: true })) {
    if (!prefix.isDirectory() || prefix.isSymbolicLink() || !/^[0-9a-f]{2}$/u.test(prefix.name)) continue
    const directory = path.join(cacheRoot, prefix.name)
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !digestPattern.test(entry.name) || entry.name.slice(0, 2) !== prefix.name) continue
      const target = path.join(directory, entry.name)
      const stat = await fs.lstat(target, { bigint: true })
      await verifyFile(target, entry.name as DigestV2, stat.size.toString() as Uint64V2)
      entries.push({ blobSha256: entry.name as DigestV2, byteLength: stat.size.toString() as Uint64V2, locationKind: "replication-cache", verifiedObjectKey: `sha256/${prefix.name}/${entry.name}`, verifiedGeneration: generation })
    }
  }
  return Object.freeze({ format: "convax.local-blob-presence-index/2", projectId, projectEpoch, generation, entries: Object.freeze(entries.sort((a, b) => a.blobSha256.localeCompare(b.blobSha256, "en-US"))) })
}

async function readPresenceIndex(target: string, projectId: ProjectIdV2, projectEpoch: Id128V2): Promise<PresenceIndexV2> {
  const value = await readRequiredJcs(target) as PresenceIndexV2
  if (value.format !== "convax.local-blob-presence-index/2" || value.projectId !== projectId || value.projectEpoch !== projectEpoch || !Array.isArray(value.entries)) throw new Error("Blob presence index is invalid")
  parseUint64V2(value.generation)
  return value
}

async function readGcState(target: string, projectId: ProjectIdV2, projectEpoch: Id128V2): Promise<BlobGcStateV2> {
  const value = await readRequiredJcs(target) as BlobGcStateV2
  if (value.format !== "convax.local-blob-gc/2" || value.projectId !== projectId || value.projectEpoch !== projectEpoch || !value.entries || typeof value.entries !== "object") throw new Error("Blob GC state is invalid")
  BigInt(value.lastScanUnixMs)
  for (const [digest, entry] of Object.entries(value.entries)) {
    parseDigestV2(digest); BigInt(entry.firstUnreferencedUnixMs); parseUint64V2(entry.firstStoreGeneration); parseUint64V2(entry.lastScanGeneration)
  }
  return value
}

async function verifyFile(target: string, digest: DigestV2, byteLength: Uint64V2) {
  const before = await fs.lstat(target, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.size !== BigInt(byteLength)) throw new Error("Blob file shape or length is invalid")
  const handle = await openReadNoFollow(target)
  try {
    const hash = createHash("sha256")
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let total = 0n
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead)); total += BigInt(bytesRead)
    }
    const after = await handle.stat({ bigint: true })
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || total !== BigInt(byteLength) || hash.digest("hex") !== digest) throw new Error("Blob file digest or identity is invalid")
  } finally { await handle.close() }
}

async function readRange(target: string, offset: number, length: number): Promise<Uint8Array> {
  const handle = await openReadNoFollow(target)
  try {
    const bytes = new Uint8Array(length)
    const { bytesRead } = await handle.read(bytes, 0, length, offset)
    if (bytesRead !== length) throw new Error("Blob transfer staging is truncated")
    return bytes
  } finally { await handle.close() }
}

async function openReadNoFollow(target: string) {
  let flags = fsConstants.O_RDONLY
  if (process.platform !== "win32") flags |= fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK
  return fs.open(target, flags)
}

async function ensureRealDirectory(target: string) {
  await fs.mkdir(target, { recursive: true, mode: 0o700 })
  return requireRealDirectory(target, "Blob store directory")
}

async function requireRealDirectory(target: string, label: string): Promise<string> {
  const stat = await fs.lstat(target)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} is not a real directory`)
  const real = await fs.realpath(target)
  return real
}

async function writeNewDurable(target: string, bytes: Readonly<Uint8Array>) {
  const handle = await fs.open(target, "wx", 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  await fsyncProjectDirectoryV2(path.dirname(target))
}

async function writeNewOrVerify(target: string, bytes: Uint8Array) {
  try { await writeNewDurable(target, bytes) } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error
    const existing = await fs.readFile(target)
    if (!Buffer.from(existing).equals(Buffer.from(bytes))) throw new Error("Immutable blob ACK digest aliases different bytes")
  }
}

async function replaceJcs(target: string, value: unknown) {
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeNewDurable(temporary, encodeRestrictedJcsV2(value))
    await fs.rename(temporary, target)
    await fsyncProjectDirectoryV2(path.dirname(target))
  } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
}

async function readRequiredJcs(target: string): Promise<unknown> {
  const stat = await fs.lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error("Blob metadata file is invalid")
  return decodeRestrictedJcsV2(await fs.readFile(target))
}

async function readJcsIfPresent(target: string): Promise<unknown | null> {
  try { return await readRequiredJcs(target) } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null
    throw error
  }
}

async function fsyncFile(target: string) { const handle = await fs.open(target, "r"); try { await handle.sync() } finally { await handle.close() } }
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error }
