import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {
  decodeRestrictedJcs,
  encodeRestrictedJcs,
  ordinarySha256,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseUint32,
  parseUint64,
  type Digest,
  type Id128,
  type MemberId,
  type ProjectId,
  type Uint64,
} from "@convax/collaboration"
import {
  blobDurableAckCoreFromReference,
  evaluateProjectBlobReplicationStatus,
  parseBlobDurableAck,
  type BlobDurableAckCore,
  type BlobDurableAck,
  type ProjectBlobHave,
  type ProjectBlobReplicationStatus,
} from "../../collaboration/blob-replication"
import { BLOB_CHUNK_BYTES } from "../../collaboration/blob-protocol"
import {
  createPeerTransferManifest,
  parsePeerTransferManifest,
  type PeerTransferChunkHeader,
  type PeerTransferManifest,
} from "../../collaboration-protocol/peer-wire"
import {
  parseProjectIndexResourceReference,
  projectIndexResourceReferenceDigest,
  type ProjectIndexResourceReference,
} from "../../collaboration/project-index"
import type { ProjectIndexManagedBlobAdmission } from "../../canvas/project-index-file-application"
import { fsyncProjectDirectory } from "./directory-durability"

const digestPattern = /^[0-9a-f]{64}$/u
const maximumBlobBytes = 64n * 1024n * 1024n * 1024n
const gcGraceMs = 7 * 24 * 60 * 60 * 1000
const gcMaximumObjects = 1_024
const gcMaximumBytes = 16n * 1024n * 1024n * 1024n

export interface ProjectBlobRootScanPort {
  /** Must include every ProjectIndex/Canvas/history/outbox/recovery root or throw. */
  scanCompleteRoots(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
  }): Promise<Readonly<{ complete: true; digests: ReadonlySet<Digest> }>>
}

export interface ProjectBlobRootContributor {
  scanRoots(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
  }): Promise<Readonly<{ complete: true; digests: ReadonlySet<Digest> }>>
}

/**
 * Exact owner seams required before native blob GC may claim a complete scan.
 * Active native transfers are added by ProjectBlobReplicationStore itself.
 */
export interface CompleteProjectBlobRootContributors {
  readonly projectIndex: ProjectBlobRootContributor
  readonly canvasHistory: ProjectBlobRootContributor
  readonly collaborationEvidence: ProjectBlobRootContributor
  readonly conflictReservations: ProjectBlobRootContributor
  readonly publicationResetAndPartialSuccess: ProjectBlobRootContributor
}

export function createCompleteProjectBlobRootScanPort(
  contributors: CompleteProjectBlobRootContributors,
): ProjectBlobRootScanPort {
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
    async scanCompleteRoots(input: { readonly projectId: ProjectId; readonly projectEpoch: Id128 }) {
      const projectId = parseProjectId(input.projectId)
      const projectEpoch = parseId128(input.projectEpoch)
      const results = await Promise.all(ordered.map((contributor) => contributor.scanRoots({ projectId, projectEpoch })))
      const digests = new Set<Digest>()
      for (const result of results) {
        if (!result || result.complete !== true || !result.digests || typeof result.digests[Symbol.iterator] !== "function") {
          throw new Error("Project blob root contributor returned an incomplete scan")
        }
        for (const digest of result.digests) digests.add(parseDigest(digest))
      }
      return Object.freeze({ complete: true as const, digests })
    },
  })
}

export interface ProjectBlobReceiveProgress {
  readonly transferId: Id128
  readonly manifestDigest: Digest
  readonly nextChunkIndex: string
  readonly acceptedByteLength: Uint64
  readonly complete: boolean
}

export interface ProjectBlobDurabilityEvidence {
  readonly format: "convax.local-blob-durability-evidence"
  readonly reference: ProjectIndexResourceReference
  readonly presenceGeneration: Uint64
  readonly verifiedObjectKey: string
}

export interface ProjectBlobSendPlan {
  readonly manifest: PeerTransferManifest
  readonly reference: ProjectIndexResourceReference
}

interface PresenceEntry {
  readonly blobSha256: Digest
  readonly byteLength: Uint64
  readonly locationKind: "replication-cache"
  readonly verifiedObjectKey: string
  readonly verifiedGeneration: Uint64
}

interface PresenceIndex {
  readonly format: "convax.local-blob-presence-index"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly generation: Uint64
  readonly entries: readonly PresenceEntry[]
}

let exactPresenceDigestLookups = 0
let historicalPresenceEntryVisits = 0
let presenceIndexSortComparisons = 0
let presenceIndexRewrites = 0

/** Package-private structural evidence; never enters durable Project state. */
export function projectBlobPresenceStructureMetricsForTests(): Readonly<{
  exactDigestLookups: number
  historicalEntryVisits: number
  sortComparisons: number
  indexRewrites: number
}> {
  return Object.freeze({
    exactDigestLookups: exactPresenceDigestLookups,
    historicalEntryVisits: historicalPresenceEntryVisits,
    sortComparisons: presenceIndexSortComparisons,
    indexRewrites: presenceIndexRewrites,
  })
}

interface TransferRecord {
  readonly format: "convax.local-blob-transfer"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly sourceMemberId: MemberId
  readonly transferId: Id128
  readonly manifest: PeerTransferManifest
  readonly reference: ProjectIndexResourceReference
  readonly nextChunkIndex: string
  readonly acceptedByteLength: Uint64
  readonly state: "receiving" | "published"
}

interface BlobGcEntry {
  readonly firstUnreferencedUnixMs: string
  readonly firstStoreGeneration: Uint64
  readonly lastScanGeneration: Uint64
}

interface BlobGcState {
  readonly format: "convax.local-blob-gc"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly lastScanUnixMs: string
  readonly entries: Readonly<Record<string, BlobGcEntry>>
}

export class ProjectBlobReplicationStore {
  readonly #root: string
  readonly #cacheRoot: string
  readonly #transfersRoot: string
  readonly #acksRoot: string
  readonly #presencePath: string
  readonly #gcPath: string
  readonly #projectId: ProjectId
  readonly #projectEpoch: Id128
  readonly #protocolDigest: Digest
  readonly #now: () => number
  #presence: PresenceIndex
  #presenceByDigest: ReadonlyMap<Digest, PresenceEntry>
  #queue: Promise<void> = Promise.resolve()
  readonly #publishedListeners = new Set<(digest: Digest) => void>()

  private constructor(input: {
    root: string
    projectId: ProjectId
    projectEpoch: Id128
    protocolDigest: Digest
    now: () => number
    presence: PresenceIndex
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
    this.#presenceByDigest = indexPresenceEntries(input.presence.entries)
  }

  static async open(input: {
    readonly collaborationDirectory: string
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
    readonly protocolDigest: Digest
    readonly now?: () => number
  }): Promise<ProjectBlobReplicationStore> {
    if (!path.isAbsolute(input.collaborationDirectory)) throw new TypeError("Collaboration directory must be absolute")
    const projectId = parseProjectId(input.projectId)
    const projectEpoch = parseId128(input.projectEpoch)
    const protocolDigest = parseDigest(input.protocolDigest)
    const collaboration = await requireRealDirectory(input.collaborationDirectory, "Collaboration directory")
    const root = path.join(collaboration, "blob-replication")
    await ensureRealDirectory(root)
    await ensureRealDirectory(path.join(root, "cache"))
    await ensureRealDirectory(path.join(root, "cache", "sha256"))
    await ensureRealDirectory(path.join(root, "transfers"))
    await ensureRealDirectory(path.join(root, "acks"))
    const presencePath = path.join(root, "presence-index-v2.bin")
    const previous = await readPresenceIndex(presencePath, projectId, projectEpoch).catch(() => null)
    const generation = String(BigInt(previous?.generation ?? "0") + 1n) as Uint64
    const rebuilt = await rebuildPresence(path.join(root, "cache", "sha256"), projectId, projectEpoch, generation)
    await replacePresenceIndex(presencePath, rebuilt)
    return new ProjectBlobReplicationStore({
      root,
      projectId,
      projectEpoch,
      protocolDigest,
      now: input.now ?? Date.now,
      presence: rebuilt,
    })
  }

  get generation(): Uint64 { return this.#presence.generation }

  subscribePublished(listener: (digest: Digest) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("Blob publication listener is required")
    this.#publishedListeners.add(listener)
    return () => this.#publishedListeners.delete(listener)
  }

  /**
   * Copies one already verified cache object into a caller-owned create-new
   * staging path. Project/node's materializer owns target containment and final
   * publication; the blob cache never becomes path authority.
   */
  async copyVerifiedBytesTo(reference: ProjectIndexResourceReference, stagingPath: string): Promise<void> {
    return this.#serial(async () => {
      this.#validateReference(reference)
      if (!path.isAbsolute(stagingPath)) throw new TypeError("Blob materialization staging path must be absolute")
      await this.#requirePresent(reference)
      await fs.copyFile(this.#blobPath(reference.blob.digest), stagingPath, fsConstants.COPYFILE_EXCL)
      try {
        await verifyFile(stagingPath, reference.blob.digest, reference.blob.byteLength)
        await fsyncFile(stagingPath)
        await fsyncProjectDirectory(path.dirname(stagingPath))
      } catch (error) {
        await fs.rm(stagingPath, { force: true }).catch(() => undefined)
        throw error
      }
    })
  }

  async admitVerifiedBytes(reference: ProjectIndexResourceReference, bytesInput: Readonly<Uint8Array>): Promise<ProjectBlobDurabilityEvidence> {
    const bytes = new Uint8Array(bytesInput)
    return this.#serial(async () => {
      this.#validateReference(reference)
      if (BigInt(bytes.byteLength) !== BigInt(reference.blob.byteLength) || ordinarySha256(bytes) !== reference.blob.digest) {
        throw new Error("Blob admission bytes do not match the ProjectIndex reference")
      }
      const alreadyPresent = this.#presenceEntry(reference.blob.digest)
      if (alreadyPresent !== undefined) return this.#requireExactPresent(reference, alreadyPresent)
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
    reference: ProjectIndexResourceReference,
    admission: ProjectIndexManagedBlobAdmission,
  ): Promise<ProjectBlobDurabilityEvidence> {
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

  async queryHave(blobs: readonly ProjectBlobHave[]): Promise<readonly ProjectBlobHave[]> {
    return this.#serial(async () => {
      const result: ProjectBlobHave[] = []
      for (const blob of blobs) {
        const digest = parseDigest(blob.blobSha256)
        const byteLength = parseUint64(blob.byteLength)
        const entry = this.#presenceEntry(digest)
        if (!entry || entry.byteLength !== byteLength) continue
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

  async missingCurrentReferences(references: readonly ProjectIndexResourceReference[]): Promise<readonly ProjectIndexResourceReference[]> {
    const wanted = references.map((reference) => {
      this.#validateReference(reference)
      return { blobSha256: reference.blob.digest, byteLength: reference.blob.byteLength }
    })
    const have = new Set((await this.queryHave(wanted)).map((blob) => `${blob.blobSha256}:${blob.byteLength}`))
    return Object.freeze(references.filter((reference) => !have.has(`${reference.blob.digest}:${reference.blob.byteLength}`)))
  }

  async prepareSend(input: {
    readonly reference: ProjectIndexResourceReference
    readonly connectionId: Id128
    readonly transferId: Id128
  }): Promise<ProjectBlobSendPlan> {
    return this.#serial(async () => {
      this.#validateReference(input.reference)
      if (BigInt(input.reference.blob.byteLength) === 0n) throw new Error("Zero-byte blobs are locally materialized and have no wire transfer")
      await this.#requirePresent(input.reference)
      const chunkBytes = Math.min(BLOB_CHUNK_BYTES, Number(BigInt(input.reference.blob.byteLength)))
      const chunkCount = (BigInt(input.reference.blob.byteLength) + BigInt(chunkBytes) - 1n) / BigInt(chunkBytes)
      const manifest = createPeerTransferManifest({
        format: "convax.peer-transfer-manifest-core",
        connectionId: parseId128(input.connectionId),
        transferId: parseId128(input.transferId),
        channel: "blob",
        kind: "project-blob",
        scope: null,
        subjectDigest: projectIndexResourceReferenceDigest(input.reference),
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

  async readSendChunk(plan: ProjectBlobSendPlan, chunkIndexInput: string): Promise<Readonly<{
    header: PeerTransferChunkHeader
    rawChunk: Uint8Array
  }>> {
    return this.#serial(async () => {
      this.#validateReference(plan.reference)
      const index = BigInt(parseUint32(chunkIndexInput))
      const chunkCount = BigInt(plan.manifest.core.chunkCount)
      if (index >= chunkCount) throw new Error("Blob send chunk index is out of range")
      if (plan.manifest.core.subjectDigest !== projectIndexResourceReferenceDigest(plan.reference)) throw new Error("Blob send plan is stale")
      await this.#requirePresent(plan.reference)
      const chunkBytes = BigInt(plan.manifest.core.chunkBytes)
      const offset = index * chunkBytes
      const length = Number(index + 1n === chunkCount ? BigInt(plan.manifest.core.byteLength) - offset : chunkBytes)
      const handle = await openReadNoFollow(this.#blobPath(plan.reference.blob.digest))
      try {
        const rawChunk = new Uint8Array(length)
        const { bytesRead } = await handle.read(rawChunk, 0, length, Number(offset))
        if (bytesRead !== length) throw new Error("Blob send source was truncated")
        const header: PeerTransferChunkHeader = Object.freeze({
          format: "convax.peer-transfer-chunk",
          transferId: plan.manifest.core.transferId,
          manifestDigest: plan.manifest.coreDigest,
          chunkIndex: index.toString() as never,
          byteOffset: offset.toString() as never,
          byteLength: String(length) as never,
          chunkSha256: ordinarySha256(rawChunk),
        })
        return Object.freeze({ header, rawChunk })
      } finally {
        await handle.close()
      }
    })
  }

  async beginReceive(input: {
    readonly sourceMemberId: MemberId
    readonly manifest: PeerTransferManifest
    readonly reference: ProjectIndexResourceReference
  }): Promise<ProjectBlobReceiveProgress> {
    return this.#serial(async () => {
      this.#validateReference(input.reference)
      const sourceMemberId = parseMemberId(input.sourceMemberId)
      this.#validateManifest(input.manifest, input.reference)
      const key = transferKey(this.#projectId, this.#projectEpoch, sourceMemberId, input.manifest.core.transferId)
      const metadataPath = path.join(this.#transfersRoot, `${key}.bin`)
      const partialPath = path.join(this.#transfersRoot, `${key}.part`)
      const existing = await readJcsIfPresent(metadataPath)
      if (existing !== null) {
        const record = parseTransferRecord(existing)
        this.#validateTransferRecord(record, sourceMemberId, input.manifest.core.transferId)
        if (record.manifest.coreDigest !== input.manifest.coreDigest) throw new Error("Blob transfer id equivocation")
        if (projectIndexResourceReferenceDigest(record.reference) !== projectIndexResourceReferenceDigest(input.reference)) {
          throw new Error("Blob transfer reference equivocation")
        }
        await normalizePartial(partialPath, record)
        return progress(record)
      }
      const record: TransferRecord = Object.freeze({
        format: "convax.local-blob-transfer",
        projectId: this.#projectId,
        projectEpoch: this.#projectEpoch,
        sourceMemberId,
        transferId: input.manifest.core.transferId,
        manifest: input.manifest,
        reference: input.reference,
        nextChunkIndex: "0",
        acceptedByteLength: "0" as Uint64,
        state: "receiving",
      })
      await writeNewDurable(partialPath, new Uint8Array())
      await writeNewDurable(metadataPath, encodeRestrictedJcs(record))
      return progress(record)
    })
  }

  async receiveChunk(input: {
    readonly sourceMemberId: MemberId
    readonly transferId: Id128
    readonly header: PeerTransferChunkHeader
    readonly rawChunk: Readonly<Uint8Array>
  }): Promise<ProjectBlobReceiveProgress> {
    return this.#serial(async () => {
      const sourceMemberId = parseMemberId(input.sourceMemberId)
      const transferId = parseId128(input.transferId)
      const key = transferKey(this.#projectId, this.#projectEpoch, sourceMemberId, transferId)
      const metadataPath = path.join(this.#transfersRoot, `${key}.bin`)
      const partialPath = path.join(this.#transfersRoot, `${key}.part`)
      const record = parseTransferRecord(await readRequiredJcs(metadataPath))
      this.#validateTransferRecord(record, sourceMemberId, transferId)
      if (record.state === "published") return progress(record)
      if (input.header.transferId !== transferId || input.header.manifestDigest !== record.manifest.coreDigest) throw new Error("Blob chunk transfer binding mismatches")
      const index = BigInt(parseUint32(input.header.chunkIndex))
      const rawChunk = new Uint8Array(input.rawChunk)
      const chunkCount = BigInt(record.manifest.core.chunkCount)
      const chunkBytes = BigInt(record.manifest.core.chunkBytes)
      if (index >= chunkCount || BigInt(input.header.byteOffset) !== index * chunkBytes) throw new Error("Blob chunk position is invalid")
      const expectedLength = Number(index + 1n === chunkCount ? BigInt(record.manifest.core.byteLength) - index * chunkBytes : chunkBytes)
      if (rawChunk.byteLength !== expectedLength || BigInt(input.header.byteLength) !== BigInt(expectedLength) || ordinarySha256(rawChunk) !== input.header.chunkSha256) {
        throw new Error("Blob chunk bytes are invalid")
      }
      const next = BigInt(record.nextChunkIndex)
      if (index > next) throw new Error("Blob chunks must be contiguous")
      if (index < next) {
        const existing = await readRange(partialPath, Number(BigInt(input.header.byteOffset)), expectedLength)
        if (ordinarySha256(existing) !== input.header.chunkSha256) throw new Error("Duplicate blob chunk storage is corrupt")
        return progress(record)
      }
      const handle = await fs.open(partialPath, "r+")
      try {
        await handle.write(rawChunk, 0, rawChunk.byteLength, Number(BigInt(input.header.byteOffset)))
        await handle.sync()
      } finally { await handle.close() }
      const nextRecord: TransferRecord = Object.freeze({
        ...record,
        nextChunkIndex: String(index + 1n),
        acceptedByteLength: (BigInt(record.acceptedByteLength) + BigInt(expectedLength)).toString() as Uint64,
      })
      await replaceJcs(metadataPath, nextRecord)
      return progress(nextRecord)
    })
  }

  async finalizeReceive(input: {
    readonly sourceMemberId: MemberId
    readonly transferId: Id128
  }): Promise<ProjectBlobDurabilityEvidence> {
    return this.#serial(async () => {
      const sourceMemberId = parseMemberId(input.sourceMemberId)
      const transferId = parseId128(input.transferId)
      const key = transferKey(this.#projectId, this.#projectEpoch, sourceMemberId, transferId)
      const metadataPath = path.join(this.#transfersRoot, `${key}.bin`)
      const partialPath = path.join(this.#transfersRoot, `${key}.part`)
      const record = parseTransferRecord(await readRequiredJcs(metadataPath))
      this.#validateTransferRecord(record, sourceMemberId, transferId)
      if (BigInt(record.nextChunkIndex) !== BigInt(record.manifest.core.chunkCount) || record.acceptedByteLength !== record.manifest.core.byteLength) throw new Error("Blob transfer is incomplete")
      if (record.state === "published") return this.#requirePresent(record.reference)
      await verifyFile(partialPath, record.reference.blob.digest, record.reference.blob.byteLength)
      const evidence = await this.#publishStaging(record.reference, partialPath)
      const published: TransferRecord = Object.freeze({ ...record, state: "published" })
      await replaceJcs(metadataPath, published)
      await fs.rm(partialPath, { force: true })
      await fsyncProjectDirectory(this.#transfersRoot)
      return evidence
    })
  }

  createAckCore(input: {
    readonly evidence: ProjectBlobDurabilityEvidence
    readonly receiverMemberId: BlobDurableAckCore["receiverMemberId"]
    readonly receiverReplicaId: BlobDurableAckCore["receiverReplicaId"]
    readonly receiverActorId: BlobDurableAckCore["receiverActorId"]
    readonly receiverAuthorizationDigest: BlobDurableAckCore["receiverAuthorizationDigest"]
  }): BlobDurableAckCore {
    if (input.evidence.presenceGeneration !== this.#presence.generation) throw new Error("Blob durability evidence is stale")
    return blobDurableAckCoreFromReference({
      reference: input.evidence.reference,
      receiverMemberId: input.receiverMemberId,
      receiverReplicaId: input.receiverReplicaId,
      receiverActorId: input.receiverActorId,
      receiverAuthorizationDigest: input.receiverAuthorizationDigest,
      protocolDigest: this.#protocolDigest,
    })
  }

  async recordVerifiedRemoteAck(input: {
    readonly ack: BlobDurableAck
    readonly verifyCurrentAck: (ack: BlobDurableAck) => Promise<boolean>
  }): Promise<void> {
    return this.#serial(async () => {
      const ack = parseBlobDurableAck(input.ack)
      if (ack.core.projectId !== this.#projectId || ack.core.projectEpoch !== this.#projectEpoch || ack.core.protocolDigest !== this.#protocolDigest) {
        throw new Error("Remote blob ACK scope is invalid")
      }
      if (!(await input.verifyCurrentAck(ack))) throw new Error("Remote blob ACK is not current and verified")
      await writeNewOrVerify(path.join(this.#acksRoot, `${ack.coreDigest}.bin`), encodeRestrictedJcs(ack))
    })
  }

  async evaluateReplication(input: {
    readonly references: readonly ProjectIndexResourceReference[]
    readonly frameAckReceivers: Parameters<typeof evaluateProjectBlobReplicationStatus>[0]["frameAckReceivers"]
    readonly verifyCurrentAck: (ack: BlobDurableAck) => boolean
  }): Promise<ProjectBlobReplicationStatus> {
    return this.#serial(async () => {
      const acks: BlobDurableAck[] = []
      for (const entry of await fs.readdir(this.#acksRoot, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !/^[0-9a-f]{64}\.bin$/u.test(entry.name)) continue
        acks.push(parseBlobDurableAck(await readRequiredJcs(path.join(this.#acksRoot, entry.name))))
      }
      return evaluateProjectBlobReplicationStatus({ ...input, blobAcks: acks })
    })
  }

  async runConservativeGc(roots: ProjectBlobRootScanPort): Promise<Readonly<{ deleted: readonly Digest[] }>> {
    return this.#serial(async () => {
      const now = this.#now()
      if (!Number.isSafeInteger(now) || now < 0) throw new Error("Blob GC clock is invalid")
      const first = await roots.scanCompleteRoots({ projectId: this.#projectId, projectEpoch: this.#projectEpoch })
      if (first.complete !== true) throw new Error("Blob root scan is incomplete")
      const activeTransferDigests = await this.#activeTransferDigests()
      const live = new Set<Digest>([...first.digests, ...activeTransferDigests])
      const inventory = await this.#verifiedInventory()
      const loaded = await readGcState(this.#gcPath, this.#projectId, this.#projectEpoch).catch(() => null)
      const rollback = loaded !== null && BigInt(loaded.lastScanUnixMs) > BigInt(now)
      const entries: Record<string, BlobGcEntry> = Object.create(null)
      for (const item of inventory) {
        if (live.has(item.digest)) continue
        const previous = rollback ? undefined : loaded?.entries[item.digest]
        entries[item.digest] = previous ?? {
          firstUnreferencedUnixMs: String(now),
          firstStoreGeneration: this.#presence.generation,
          lastScanGeneration: this.#presence.generation,
        }
      }
      const state: BlobGcState = {
        format: "convax.local-blob-gc",
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
      const liveAgain = new Set<Digest>([...second.digests, ...(await this.#activeTransferDigests())])
      const selected: typeof due = []
      let bytes = 0n
      for (const item of due) {
        if (liveAgain.has(item.digest) || selected.length >= gcMaximumObjects || bytes + item.byteLength > gcMaximumBytes) continue
        selected.push(item)
        bytes += item.byteLength
      }
      // Timing state is durable before unlink. A failed unlink keeps the entry for retry.
      await replaceJcs(this.#gcPath, state)
      const deleted: Digest[] = []
      for (const item of selected) {
        await verifyFile(this.#blobPath(item.digest), item.digest, item.byteLength.toString() as Uint64)
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

  async #publishStaging(reference: ProjectIndexResourceReference, staging: string): Promise<ProjectBlobDurabilityEvidence> {
    await verifyFile(staging, reference.blob.digest, reference.blob.byteLength)
    const alreadyPresent = this.#presenceEntry(reference.blob.digest)
    if (alreadyPresent !== undefined) return this.#requireExactPresent(reference, alreadyPresent)
    const target = this.#blobPath(reference.blob.digest)
    await ensureRealDirectory(path.dirname(target))
    try { await fs.link(staging, target) } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error
      await verifyFile(target, reference.blob.digest, reference.blob.byteLength)
    }
    await fsyncFile(target)
    await fsyncProjectDirectory(path.dirname(target))
    await fsyncProjectDirectory(this.#cacheRoot)
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
      format: "convax.local-blob-durability-evidence",
      reference,
      presenceGeneration: this.#presence.generation,
      verifiedObjectKey: objectKey,
    })
  }

  async #requirePresent(reference: ProjectIndexResourceReference): Promise<ProjectBlobDurabilityEvidence> {
    const entry = this.#presenceEntry(reference.blob.digest)
    if (!entry) throw new Error("Project blob is not locally durable")
    return this.#requireExactPresent(reference, entry)
  }

  async #requireExactPresent(
    reference: ProjectIndexResourceReference,
    entry: PresenceEntry,
  ): Promise<ProjectBlobDurabilityEvidence> {
    if (entry.byteLength !== reference.blob.byteLength) throw new Error("Project blob durable presence metadata is inconsistent")
    await verifyFile(this.#blobPath(reference.blob.digest), reference.blob.digest, reference.blob.byteLength)
    return Object.freeze({ format: "convax.local-blob-durability-evidence", reference, presenceGeneration: this.#presence.generation, verifiedObjectKey: entry.verifiedObjectKey })
  }

  #presenceEntry(digest: Digest): PresenceEntry | undefined {
    exactPresenceDigestLookups += 1
    return this.#presenceByDigest.get(digest)
  }

  async #removePresence(digest: Digest) { await this.#replacePresence(this.#presence.entries.filter((entry) => entry.blobSha256 !== digest)) }

  async #replacePresence(entries: readonly PresenceEntry[]) {
    const sortedEntries = sortPresenceEntries(entries)
    const next: PresenceIndex = Object.freeze({
      ...this.#presence,
      entries: sortedEntries,
    })
    const nextByDigest = indexPresenceEntries(sortedEntries)
    await replacePresenceIndex(this.#presencePath, next)
    this.#presence = next
    this.#presenceByDigest = nextByDigest
  }

  #validateReference(reference: ProjectIndexResourceReference) {
    if (reference.projectId !== this.#projectId || reference.projectEpoch !== this.#projectEpoch) throw new Error("Project blob reference scope mismatches store")
    parseDigest(reference.blob.digest)
    const length = BigInt(parseUint64(reference.blob.byteLength))
    if (length > maximumBlobBytes) throw new Error("Project blob exceeds 64 GiB")
  }

  #validateManifest(manifest: PeerTransferManifest, reference: ProjectIndexResourceReference) {
    if (manifest.core.kind !== "project-blob" || manifest.core.channel !== "blob" || manifest.core.scope !== null ||
      manifest.core.protocolDigest !== this.#protocolDigest || manifest.core.subjectDigest !== projectIndexResourceReferenceDigest(reference) ||
      manifest.core.sha256 !== reference.blob.digest || manifest.core.byteLength !== reference.blob.byteLength) {
      throw new Error("Blob transfer manifest does not bind the current Project reference")
    }
  }

  #validateTransferRecord(record: TransferRecord, sourceMemberId?: MemberId, transferId?: Id128) {
    if (
      record.projectId !== this.#projectId || record.projectEpoch !== this.#projectEpoch ||
      (sourceMemberId !== undefined && record.sourceMemberId !== sourceMemberId) ||
      (transferId !== undefined && record.transferId !== transferId)
    ) throw new Error("Blob transfer metadata scope is invalid")
    this.#validateReference(record.reference)
    this.#validateManifest(record.manifest, record.reference)
    if (record.manifest.core.transferId !== record.transferId) throw new Error("Blob transfer metadata identity is invalid")
  }

  #blobPath(digest: Digest) { return path.join(this.#cacheRoot, digest.slice(0, 2), digest) }

  async #activeTransferDigests(): Promise<ReadonlySet<Digest>> {
    const result = new Set<Digest>()
    for (const entry of await fs.readdir(this.#transfersRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[0-9a-f]{64}\.bin$/u.test(entry.name)) continue
      const record = parseTransferRecord(await readRequiredJcs(path.join(this.#transfersRoot, entry.name)))
      this.#validateTransferRecord(record)
      if (record.state === "receiving") result.add(record.reference.blob.digest)
    }
    return result
  }

  async #verifiedInventory(): Promise<readonly { digest: Digest; byteLength: bigint }[]> {
    const result: { digest: Digest; byteLength: bigint }[] = []
    for (const prefix of await fs.readdir(this.#cacheRoot, { withFileTypes: true })) {
      if (!prefix.isDirectory() || prefix.isSymbolicLink() || !/^[0-9a-f]{2}$/u.test(prefix.name)) continue
      const directory = path.join(this.#cacheRoot, prefix.name)
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !digestPattern.test(entry.name) || entry.name.slice(0, 2) !== prefix.name) continue
        const stat = await fs.lstat(path.join(directory, entry.name), { bigint: true })
        await verifyFile(path.join(directory, entry.name), entry.name as Digest, stat.size.toString() as Uint64)
        result.push({ digest: entry.name as Digest, byteLength: stat.size })
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

function progress(record: TransferRecord): ProjectBlobReceiveProgress {
  return Object.freeze({
    transferId: record.transferId,
    manifestDigest: record.manifest.coreDigest,
    nextChunkIndex: record.nextChunkIndex,
    acceptedByteLength: record.acceptedByteLength,
    complete: record.state === "published",
  })
}

function parseTransferRecord(value: unknown): TransferRecord {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Blob transfer metadata is invalid")
  const keys = Object.keys(value).sort()
  const expectedKeys = ["acceptedByteLength", "format", "manifest", "nextChunkIndex", "projectEpoch", "projectId", "reference", "sourceMemberId", "state", "transferId"]
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) throw new Error("Blob transfer metadata is invalid")
  const input = value as TransferRecord
  const record: TransferRecord = Object.freeze({
    format: input.format,
    projectId: parseProjectId(input.projectId),
    projectEpoch: parseId128(input.projectEpoch),
    sourceMemberId: parseMemberId(input.sourceMemberId),
    transferId: parseId128(input.transferId),
    manifest: parsePeerTransferManifest(input.manifest),
    reference: parseProjectIndexResourceReference(input.reference),
    nextChunkIndex: parseUint32(input.nextChunkIndex),
    acceptedByteLength: parseUint64(input.acceptedByteLength),
    state: input.state,
  })
  if (record.format !== "convax.local-blob-transfer" || (record.state !== "receiving" && record.state !== "published")) throw new Error("Blob transfer metadata is invalid")
  if (BigInt(record.nextChunkIndex) > BigInt(record.manifest.core.chunkCount) || BigInt(record.acceptedByteLength) > BigInt(record.manifest.core.byteLength)) throw new Error("Blob transfer progress is invalid")
  return record
}

async function normalizePartial(partialPath: string, record: TransferRecord) {
  if (record.state === "published") return
  const accepted = BigInt(record.acceptedByteLength)
  const stat = await fs.lstat(partialPath, { bigint: true })
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < accepted) throw new Error("Blob transfer staging is truncated")
  if (stat.size > accepted) await fs.truncate(partialPath, Number(accepted))
}

function transferKey(projectId: ProjectId, projectEpoch: Id128, sourceMemberId: MemberId, transferId: Id128): string {
  const hash = createHash("sha256")
  hash.update("convax.local-blob-transfer-key\0")
  hash.update(encodeRestrictedJcs({ projectId, projectEpoch, sourceMemberId, transferId }))
  return hash.digest("hex")
}

async function rebuildPresence(cacheRoot: string, projectId: ProjectId, projectEpoch: Id128, generation: Uint64): Promise<PresenceIndex> {
  const entries: PresenceEntry[] = []
  for (const prefix of await fs.readdir(cacheRoot, { withFileTypes: true })) {
    if (!prefix.isDirectory() || prefix.isSymbolicLink() || !/^[0-9a-f]{2}$/u.test(prefix.name)) continue
    const directory = path.join(cacheRoot, prefix.name)
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !digestPattern.test(entry.name) || entry.name.slice(0, 2) !== prefix.name) continue
      const target = path.join(directory, entry.name)
      const stat = await fs.lstat(target, { bigint: true })
      await verifyFile(target, entry.name as Digest, stat.size.toString() as Uint64)
      entries.push({ blobSha256: entry.name as Digest, byteLength: stat.size.toString() as Uint64, locationKind: "replication-cache", verifiedObjectKey: `sha256/${prefix.name}/${entry.name}`, verifiedGeneration: generation })
    }
  }
  return Object.freeze({
    format: "convax.local-blob-presence-index",
    projectId,
    projectEpoch,
    generation,
    entries: sortPresenceEntries(entries),
  })
}

function sortPresenceEntries(entries: readonly PresenceEntry[]): readonly PresenceEntry[] {
  const copied: PresenceEntry[] = []
  for (const entry of entries) {
    historicalPresenceEntryVisits += 1
    copied.push(entry)
  }
  copied.sort((left, right) => {
    presenceIndexSortComparisons += 1
    return left.blobSha256.localeCompare(right.blobSha256, "en-US")
  })
  return Object.freeze(copied)
}

function indexPresenceEntries(entries: readonly PresenceEntry[]): ReadonlyMap<Digest, PresenceEntry> {
  const indexed = new Map<Digest, PresenceEntry>()
  for (const entry of entries) {
    if (indexed.has(entry.blobSha256)) throw new Error("Blob presence index contains duplicate digests")
    indexed.set(entry.blobSha256, entry)
  }
  return indexed
}

async function replacePresenceIndex(target: string, presence: PresenceIndex): Promise<void> {
  presenceIndexRewrites += 1
  await replaceJcs(target, presence)
}

async function readPresenceIndex(target: string, projectId: ProjectId, projectEpoch: Id128): Promise<PresenceIndex> {
  const value = await readRequiredJcs(target) as PresenceIndex
  if (value.format !== "convax.local-blob-presence-index" || value.projectId !== projectId || value.projectEpoch !== projectEpoch || !Array.isArray(value.entries)) throw new Error("Blob presence index is invalid")
  parseUint64(value.generation)
  return value
}

async function readGcState(target: string, projectId: ProjectId, projectEpoch: Id128): Promise<BlobGcState> {
  const value = await readRequiredJcs(target) as BlobGcState
  if (value.format !== "convax.local-blob-gc" || value.projectId !== projectId || value.projectEpoch !== projectEpoch || !value.entries || typeof value.entries !== "object") throw new Error("Blob GC state is invalid")
  BigInt(value.lastScanUnixMs)
  for (const [digest, entry] of Object.entries(value.entries)) {
    parseDigest(digest); BigInt(entry.firstUnreferencedUnixMs); parseUint64(entry.firstStoreGeneration); parseUint64(entry.lastScanGeneration)
  }
  return value
}

async function verifyFile(target: string, digest: Digest, byteLength: Uint64) {
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
  await fsyncProjectDirectory(path.dirname(target))
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
    await writeNewDurable(temporary, encodeRestrictedJcs(value))
    await fs.rename(temporary, target)
    await fsyncProjectDirectory(path.dirname(target))
  } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
}

async function readRequiredJcs(target: string): Promise<unknown> {
  const stat = await fs.lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error("Blob metadata file is invalid")
  return decodeRestrictedJcs(await fs.readFile(target))
}

async function readJcsIfPresent(target: string): Promise<unknown | null> {
  try { return await readRequiredJcs(target) } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null
    throw error
  }
}

async function fsyncFile(target: string) { const handle = await fs.open(target, "r"); try { await handle.sync() } finally { await handle.close() } }
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error }
