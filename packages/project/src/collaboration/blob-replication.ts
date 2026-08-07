import {
  assertExactKeys,
  isPlainDataObject,
  parseActorId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseReplicaId,
  parseSignature,
  parseUint64,
  structuredDigest,
  type ActorId,
  type Digest,
  type Id128,
  type MemberId,
  type ProjectId,
  type ReplicaId,
  type Signature,
  type Uint64,
} from "@convax/collaboration"
import { parseProjectFileId, type ProjectFileId } from "@convax/project-files/identity"
import type { ProjectIndexResourceReference, ProjectVersionId } from "./project-index"

const VERSION = /^pv_[0-9a-f]{64}$/u

export interface BlobDurableAckCore {
  readonly format: "convax.blob-durable-ack-core"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly fileId: ProjectFileId
  readonly versionId: ProjectVersionId
  readonly blobSha256: Digest
  readonly byteLength: Uint64
  readonly receiverMemberId: MemberId
  readonly receiverReplicaId: ReplicaId
  readonly receiverActorId: ActorId
  readonly receiverAuthorizationDigest: Digest
  readonly protocolDigest: Digest
}

export interface BlobDurableAck {
  readonly format: "convax.blob-durable-ack"
  readonly core: BlobDurableAckCore
  readonly coreDigest: Digest
  readonly replicaSignature: Signature
}

export interface ProjectBlobHave {
  readonly blobSha256: Digest
  readonly byteLength: Uint64
}

export interface ProjectBlobHolder {
  readonly memberId: MemberId
  readonly replicaId: ReplicaId
  readonly actorId: ActorId
  readonly authorizationDigest: Digest
  readonly currentAuthorization: boolean
  readonly have: readonly ProjectBlobHave[]
}

export interface ProjectBlobBootstrapRequest {
  readonly reference: ProjectIndexResourceReference
  readonly holder: Omit<ProjectBlobHolder, "have" | "currentAuthorization">
}

export type ProjectBlobReplicationStatus =
  | "local-structural-only"
  | "structure-replicated-blobs-pending"
  | "blob-replicated"

export interface ProjectIndexCurrentResourceProjectionEntry {
  readonly materializedPath: string | null
  readonly reference: ProjectIndexResourceReference
  readonly storageClass: "project-file" | "managed-blob"
}

/** Browser-safe ProjectIndex owner query used by native GC and blob bootstrap. */
export interface ProjectIndexCurrentBlobReferencePort {
  queryCurrentResources(input: {
    readonly projectId: ProjectId
  }): Promise<readonly ProjectIndexCurrentResourceProjectionEntry[]>
  queryCurrentBlobDigests(input: {
    readonly projectId: ProjectId
  }): Promise<ReadonlySet<Digest>>
}

/**
 * Narrow owner-reference query for proof verification. Unlike the native
 * materialization projection above, this port does not resolve a portable
 * entry to a current filesystem path.
 */
export interface ProjectIndexCurrentResourceReferenceQueryPort {
  queryCurrentResourceReferences(input: {
    readonly projectId: ProjectId
  }): Promise<readonly ProjectIndexResourceReference[]>
}

export function blobDurableAckCoreDigest(core: BlobDurableAckCore): Digest {
  return structuredDigest("convax.blob-durable-ack-core", parseBlobDurableAckCore(core))
}

export function createBlobDurableAck(
  coreInput: BlobDurableAckCore,
  replicaSignatureInput: Signature,
): BlobDurableAck {
  const core = parseBlobDurableAckCore(coreInput)
  return Object.freeze({
    format: "convax.blob-durable-ack",
    core,
    coreDigest: blobDurableAckCoreDigest(core),
    replicaSignature: parseSignature(replicaSignatureInput),
  })
}

export function blobDurableAckCoreFromReference(input: {
  readonly reference: ProjectIndexResourceReference
  readonly receiverMemberId: MemberId
  readonly receiverReplicaId: ReplicaId
  readonly receiverActorId: ActorId
  readonly receiverAuthorizationDigest: Digest
  readonly protocolDigest: Digest
}): BlobDurableAckCore {
  return parseBlobDurableAckCore({
    format: "convax.blob-durable-ack-core",
    projectId: input.reference.projectId,
    projectEpoch: input.reference.projectEpoch,
    fileId: input.reference.entryFileId,
    versionId: input.reference.versionId,
    blobSha256: input.reference.blob.digest,
    byteLength: input.reference.blob.byteLength,
    receiverMemberId: input.receiverMemberId,
    receiverReplicaId: input.receiverReplicaId,
    receiverActorId: input.receiverActorId,
    receiverAuthorizationDigest: input.receiverAuthorizationDigest,
    protocolDigest: input.protocolDigest,
  })
}

export function parseBlobDurableAck(value: unknown): BlobDurableAck {
  if (!isPlainDataObject(value)) throw new TypeError("BlobDurableAck must be a plain object")
  assertExactKeys(value, ["format", "core", "coreDigest", "replicaSignature"], "BlobDurableAck")
  if (value.format !== "convax.blob-durable-ack") throw new TypeError("BlobDurableAck format is invalid")
  const core = parseBlobDurableAckCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (blobDurableAckCoreDigest(core) !== coreDigest) throw new TypeError("BlobDurableAck core digest mismatches")
  return Object.freeze({
    format: value.format,
    core,
    coreDigest,
    replicaSignature: parseSignature(value.replicaSignature),
  })
}

export function parseBlobDurableAckCore(value: unknown): BlobDurableAckCore {
  if (!isPlainDataObject(value)) throw new TypeError("BlobDurableAckCore must be a plain object")
  assertExactKeys(value, [
    "format", "projectId", "projectEpoch", "fileId", "versionId", "blobSha256", "byteLength",
    "receiverMemberId", "receiverReplicaId", "receiverActorId", "receiverAuthorizationDigest", "protocolDigest",
  ], "BlobDurableAckCore")
  if (value.format !== "convax.blob-durable-ack-core") throw new TypeError("BlobDurableAckCore format is invalid")
  if (typeof value.versionId !== "string" || !VERSION.test(value.versionId)) throw new TypeError("Blob ACK version id is invalid")
  return Object.freeze({
    format: value.format,
    projectId: parseProjectId(value.projectId),
    projectEpoch: parseId128(value.projectEpoch),
    fileId: parseProjectFileId(value.fileId),
    versionId: value.versionId as ProjectVersionId,
    blobSha256: parseDigest(value.blobSha256),
    byteLength: parseUint64(value.byteLength),
    receiverMemberId: parseMemberId(value.receiverMemberId),
    receiverReplicaId: parseReplicaId(value.receiverReplicaId),
    receiverActorId: parseActorId(value.receiverActorId),
    receiverAuthorizationDigest: parseDigest(value.receiverAuthorizationDigest),
    protocolDigest: parseDigest(value.protocolDigest),
  })
}

/**
 * Missing-blob bootstrap is a projection of current ProjectIndex references and
 * verified current holders. It never enumerates a native cache as file authority.
 */
export function planProjectBlobBootstrap(input: {
  readonly currentReferences: readonly ProjectIndexResourceReference[]
  readonly localHave: readonly ProjectBlobHave[]
  readonly holders: readonly ProjectBlobHolder[]
}): Readonly<{
  requests: readonly ProjectBlobBootstrapRequest[]
  unavailable: readonly ProjectIndexResourceReference[]
}> {
  const local = new Set(input.localHave.map(haveKey))
  const holders = [...input.holders]
    .filter((holder) => holder.currentAuthorization)
    .sort((left, right) => `${left.replicaId}\0${left.authorizationDigest}`.localeCompare(`${right.replicaId}\0${right.authorizationDigest}`, "en-US"))
  const requests: ProjectBlobBootstrapRequest[] = []
  const unavailable: ProjectIndexResourceReference[] = []
  const seen = new Set<string>()
  for (const reference of input.currentReferences) {
    const key = `${reference.blob.digest}:${reference.blob.byteLength}`
    if (seen.has(key) || local.has(key)) continue
    seen.add(key)
    const holder = holders.find((candidate) => candidate.have.some((value) => haveKey(value) === key))
    if (!holder) {
      unavailable.push(reference)
      continue
    }
    requests.push(Object.freeze({
      reference,
      holder: Object.freeze({
        memberId: holder.memberId,
        replicaId: holder.replicaId,
        actorId: holder.actorId,
        authorizationDigest: holder.authorizationDigest,
      }),
    }))
  }
  return Object.freeze({ requests: Object.freeze(requests), unavailable: Object.freeze(unavailable) })
}

/** Same current remote replica must ACK the frame and every newly referenced blob. */
export function evaluateProjectBlobReplicationStatus(input: {
  readonly references: readonly ProjectIndexResourceReference[]
  readonly frameAckReceivers: readonly Readonly<{
    receiverReplicaId: ReplicaId
    receiverAuthorizationDigest: Digest
  }>[]
  readonly blobAcks: readonly BlobDurableAck[]
  readonly verifyCurrentAck: (ack: BlobDurableAck) => boolean
}): ProjectBlobReplicationStatus {
  if (input.frameAckReceivers.length === 0) return "local-structural-only"
  const references = [...new Map(input.references.map((reference) => [
    `${reference.entryFileId}:${reference.versionId}:${reference.blob.digest}`,
    reference,
  ])).values()]
  for (const receiver of input.frameAckReceivers) {
    const satisfied = references.every((reference) => input.blobAcks.some((ackInput) => {
      let ack: BlobDurableAck
      try { ack = parseBlobDurableAck(ackInput) } catch { return false }
      return input.verifyCurrentAck(ack) && ack.core.receiverReplicaId === receiver.receiverReplicaId &&
        ack.core.receiverAuthorizationDigest === receiver.receiverAuthorizationDigest &&
        ack.core.projectId === reference.projectId && ack.core.projectEpoch === reference.projectEpoch &&
        ack.core.fileId === reference.entryFileId && ack.core.versionId === reference.versionId &&
        ack.core.blobSha256 === reference.blob.digest && ack.core.byteLength === reference.blob.byteLength
    }))
    if (satisfied) return "blob-replicated"
  }
  return "structure-replicated-blobs-pending"
}

function haveKey(value: ProjectBlobHave): string {
  return `${parseDigest(value.blobSha256)}:${parseUint64(value.byteLength)}`
}
