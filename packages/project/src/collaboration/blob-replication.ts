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
import type { ProjectResourceReferenceV2, ProjectVersionIdV2 } from "./project-index"

const VERSION = /^pv_[0-9a-f]{64}$/u

export interface BlobDurableAckCoreV2 {
  readonly format: "convax.blob-durable-ack-core/2"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly fileId: ProjectFileId
  readonly versionId: ProjectVersionIdV2
  readonly blobSha256: Digest
  readonly byteLength: Uint64
  readonly receiverMemberId: MemberId
  readonly receiverReplicaId: ReplicaId
  readonly receiverActorId: ActorId
  readonly receiverAuthorizationDigest: Digest
  readonly protocolDigest: Digest
}

export interface BlobDurableAckV2 {
  readonly format: "convax.blob-durable-ack/2"
  readonly core: BlobDurableAckCoreV2
  readonly coreDigest: Digest
  readonly replicaSignature: Signature
}

export interface ProjectBlobHaveV2 {
  readonly blobSha256: Digest
  readonly byteLength: Uint64
}

export interface ProjectBlobHolderV2 {
  readonly memberId: MemberId
  readonly replicaId: ReplicaId
  readonly actorId: ActorId
  readonly authorizationDigest: Digest
  readonly currentAuthorization: boolean
  readonly have: readonly ProjectBlobHaveV2[]
}

export interface ProjectBlobBootstrapRequestV2 {
  readonly reference: ProjectResourceReferenceV2
  readonly holder: Omit<ProjectBlobHolderV2, "have" | "currentAuthorization">
}

export type ProjectBlobReplicationStatusV2 =
  | "local-structural-only"
  | "structure-replicated-blobs-pending"
  | "blob-replicated"

export interface ProjectIndexCurrentResourceProjectionEntryV2 {
  readonly materializedPath: string | null
  readonly reference: ProjectResourceReferenceV2
  readonly storageClass: "project-file" | "managed-blob"
}

/** Browser-safe ProjectIndex owner query used by native GC and blob bootstrap. */
export interface ProjectIndexCurrentBlobReferencePortV2 {
  queryCurrentResources(input: {
    readonly projectId: ProjectId
  }): Promise<readonly ProjectIndexCurrentResourceProjectionEntryV2[]>
  queryCurrentBlobDigests(input: {
    readonly projectId: ProjectId
  }): Promise<ReadonlySet<Digest>>
}

export function blobDurableAckCoreDigestV2(core: BlobDurableAckCoreV2): Digest {
  return structuredDigest("convax.blob-durable-ack-core/2", parseBlobDurableAckCoreV2(core))
}

export function createBlobDurableAckV2(
  coreInput: BlobDurableAckCoreV2,
  replicaSignatureInput: Signature,
): BlobDurableAckV2 {
  const core = parseBlobDurableAckCoreV2(coreInput)
  return Object.freeze({
    format: "convax.blob-durable-ack/2",
    core,
    coreDigest: blobDurableAckCoreDigestV2(core),
    replicaSignature: parseSignature(replicaSignatureInput),
  })
}

export function blobDurableAckCoreFromReferenceV2(input: {
  readonly reference: ProjectResourceReferenceV2
  readonly receiverMemberId: MemberId
  readonly receiverReplicaId: ReplicaId
  readonly receiverActorId: ActorId
  readonly receiverAuthorizationDigest: Digest
  readonly protocolDigest: Digest
}): BlobDurableAckCoreV2 {
  return parseBlobDurableAckCoreV2({
    format: "convax.blob-durable-ack-core/2",
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

export function parseBlobDurableAckV2(value: unknown): BlobDurableAckV2 {
  if (!isPlainDataObject(value)) throw new TypeError("BlobDurableAckV2 must be a plain object")
  assertExactKeys(value, ["format", "core", "coreDigest", "replicaSignature"], "BlobDurableAckV2")
  if (value.format !== "convax.blob-durable-ack/2") throw new TypeError("BlobDurableAckV2 format is invalid")
  const core = parseBlobDurableAckCoreV2(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (blobDurableAckCoreDigestV2(core) !== coreDigest) throw new TypeError("BlobDurableAckV2 core digest mismatches")
  return Object.freeze({
    format: value.format,
    core,
    coreDigest,
    replicaSignature: parseSignature(value.replicaSignature),
  })
}

export function parseBlobDurableAckCoreV2(value: unknown): BlobDurableAckCoreV2 {
  if (!isPlainDataObject(value)) throw new TypeError("BlobDurableAckCoreV2 must be a plain object")
  assertExactKeys(value, [
    "format", "projectId", "projectEpoch", "fileId", "versionId", "blobSha256", "byteLength",
    "receiverMemberId", "receiverReplicaId", "receiverActorId", "receiverAuthorizationDigest", "protocolDigest",
  ], "BlobDurableAckCoreV2")
  if (value.format !== "convax.blob-durable-ack-core/2") throw new TypeError("BlobDurableAckCoreV2 format is invalid")
  if (typeof value.versionId !== "string" || !VERSION.test(value.versionId)) throw new TypeError("Blob ACK version id is invalid")
  return Object.freeze({
    format: value.format,
    projectId: parseProjectId(value.projectId),
    projectEpoch: parseId128(value.projectEpoch),
    fileId: parseProjectFileId(value.fileId),
    versionId: value.versionId as ProjectVersionIdV2,
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
export function planProjectBlobBootstrapV2(input: {
  readonly currentReferences: readonly ProjectResourceReferenceV2[]
  readonly localHave: readonly ProjectBlobHaveV2[]
  readonly holders: readonly ProjectBlobHolderV2[]
}): Readonly<{
  requests: readonly ProjectBlobBootstrapRequestV2[]
  unavailable: readonly ProjectResourceReferenceV2[]
}> {
  const local = new Set(input.localHave.map(haveKey))
  const holders = [...input.holders]
    .filter((holder) => holder.currentAuthorization)
    .sort((left, right) => `${left.replicaId}\0${left.authorizationDigest}`.localeCompare(`${right.replicaId}\0${right.authorizationDigest}`, "en-US"))
  const requests: ProjectBlobBootstrapRequestV2[] = []
  const unavailable: ProjectResourceReferenceV2[] = []
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
export function evaluateProjectBlobReplicationStatusV2(input: {
  readonly references: readonly ProjectResourceReferenceV2[]
  readonly frameAckReceivers: readonly Readonly<{
    receiverReplicaId: ReplicaId
    receiverAuthorizationDigest: Digest
  }>[]
  readonly blobAcks: readonly BlobDurableAckV2[]
  readonly verifyCurrentAck: (ack: BlobDurableAckV2) => boolean
}): ProjectBlobReplicationStatusV2 {
  if (input.frameAckReceivers.length === 0) return "local-structural-only"
  const references = [...new Map(input.references.map((reference) => [
    `${reference.entryFileId}:${reference.versionId}:${reference.blob.digest}`,
    reference,
  ])).values()]
  for (const receiver of input.frameAckReceivers) {
    const satisfied = references.every((reference) => input.blobAcks.some((ackInput) => {
      let ack: BlobDurableAckV2
      try { ack = parseBlobDurableAckV2(ackInput) } catch { return false }
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

function haveKey(value: ProjectBlobHaveV2): string {
  return `${parseDigest(value.blobSha256)}:${parseUint64(value.byteLength)}`
}
