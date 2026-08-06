import type { Digest, ReplicaId } from "./codecs"
import {
  assertBoundedNfcString,
  parseActorId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseReplicaId,
  parseSignature,
  parseUint64,
  uint64ToBigInt,
} from "./codecs"
import { KERNEL_DIGEST_DOMAINS, KERNEL_LIMITS, CURRENT_PROTOCOL_IDENTITIES } from "./constants"
import type {
  CheckpointContentCertificateCore,
  CheckpointContentCertificate,
  PrunableCheckpointSetCertificateCore,
  PrunableCheckpointSetCertificate,
  ReplicaCausalFloorAckCore,
  ReplicaCausalFloorAck,
  ReplicaCheckpointCore,
  ReplicaCheckpoint,
  StableCheckpointSetCore,
} from "./contracts"
import { structuredDigest } from "./digest"
import { failCodec } from "./errors"
import { assertDenseArray, assertExactKeys, compareUtf8 } from "./jcs"
import { parseCausalHeadRef, parseDocumentScope } from "./parse"

export function parseReplicaCheckpointCore(value: unknown): ReplicaCheckpointCore {
  assertExactKeys(value, [
    "format", "scope", "checkpointId", "authorMemberId", "authorReplicaId", "authorActorId",
    "authorAuthorizationDigest", "directParentCheckpointDigests", "baseFrontierDigest",
    "computedFrontierDigest", "actorHeadBoundaryDigest", "stateVectorDigest", "canonicalStateDigest",
    "fullUpdateDigest", "fullUpdateByteLength", "protocolDigest", "schemaDigest", "canonicalizerDigest",
    "validationArtifactSetDigest",
  ], "ReplicaCheckpointCore")
  if (value.format !== "convax.replica-checkpoint-core") invalid("ReplicaCheckpointCore format is invalid")
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScope(value.scope),
    checkpointId: parseId128(value.checkpointId),
    authorMemberId: parseMemberId(value.authorMemberId),
    authorReplicaId: parseReplicaId(value.authorReplicaId),
    authorActorId: parseActorId(value.authorActorId),
    authorAuthorizationDigest: parseDigest(value.authorAuthorizationDigest),
    directParentCheckpointDigests: parseDigestList(value.directParentCheckpointDigests, 0, KERNEL_LIMITS.checkpointParents, "checkpoint parents"),
    baseFrontierDigest: parseDigest(value.baseFrontierDigest),
    computedFrontierDigest: parseDigest(value.computedFrontierDigest),
    actorHeadBoundaryDigest: parseDigest(value.actorHeadBoundaryDigest),
    stateVectorDigest: parseDigest(value.stateVectorDigest),
    canonicalStateDigest: parseDigest(value.canonicalStateDigest),
    fullUpdateDigest: parseDigest(value.fullUpdateDigest),
    fullUpdateByteLength: parseBoundedByteLength(value.fullUpdateByteLength, KERNEL_LIMITS.checkpointSnapshotBytes, "checkpoint snapshot"),
    protocolDigest: requireProtocolDigest(value.protocolDigest),
    schemaDigest: parseDigest(value.schemaDigest),
    canonicalizerDigest: parseDigest(value.canonicalizerDigest),
    validationArtifactSetDigest: parseDigest(value.validationArtifactSetDigest),
  })
}

export function parseReplicaCheckpoint(value: unknown): ReplicaCheckpoint {
  assertExactKeys(value, ["format", "core", "coreDigest", "replicaSignature"], "ReplicaCheckpoint")
  if (value.format !== "convax.replica-checkpoint") invalid("ReplicaCheckpoint format is invalid")
  const core = parseReplicaCheckpointCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== replicaCheckpointCoreDigest(core)) invalid("ReplicaCheckpoint core digest mismatches")
  return Object.freeze({ format: value.format, core, coreDigest, replicaSignature: parseSignature(value.replicaSignature) })
}

export function parseCheckpointContentCertificateCore(value: unknown): CheckpointContentCertificateCore {
  assertExactKeys(value, [
    "format", "scope", "checkpointDigest", "parentCertificateDigests", "computedFrontierDigest",
    "actorHeadBoundaryDigest", "stateVectorDigest", "canonicalStateDigest", "fullUpdateDigest", "protocolDigest",
    "schemaDigest", "canonicalizerDigest", "validationArtifactSetDigest", "trustBundleDigest", "contentStatus",
    "serviceKeyPurpose", "serviceKeyId",
  ], "CheckpointContentCertificateCore")
  if (value.format !== "convax.checkpoint-content-certificate-core" || value.contentStatus !== "service-validated-causal-closure" || value.serviceKeyPurpose !== "content-attestation") {
    invalid("CheckpointContentCertificateCore discriminators are invalid")
  }
  assertBoundedNfcString(value.serviceKeyId, 1, 256, "content certificate serviceKeyId")
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScope(value.scope),
    checkpointDigest: parseDigest(value.checkpointDigest),
    parentCertificateDigests: parseDigestList(value.parentCertificateDigests, 0, KERNEL_LIMITS.checkpointParents, "parent certificates"),
    computedFrontierDigest: parseDigest(value.computedFrontierDigest),
    actorHeadBoundaryDigest: parseDigest(value.actorHeadBoundaryDigest),
    stateVectorDigest: parseDigest(value.stateVectorDigest),
    canonicalStateDigest: parseDigest(value.canonicalStateDigest),
    fullUpdateDigest: parseDigest(value.fullUpdateDigest),
    protocolDigest: requireProtocolDigest(value.protocolDigest),
    schemaDigest: parseDigest(value.schemaDigest),
    canonicalizerDigest: parseDigest(value.canonicalizerDigest),
    validationArtifactSetDigest: parseDigest(value.validationArtifactSetDigest),
    trustBundleDigest: parseDigest(value.trustBundleDigest),
    contentStatus: value.contentStatus,
    serviceKeyPurpose: value.serviceKeyPurpose,
    serviceKeyId: value.serviceKeyId,
  })
}

export function parseCheckpointContentCertificate(value: unknown): CheckpointContentCertificate {
  assertExactKeys(value, ["format", "core", "coreDigest", "serviceSignature"], "CheckpointContentCertificate")
  if (value.format !== "convax.checkpoint-content-certificate") invalid("CheckpointContentCertificate format is invalid")
  const core = parseCheckpointContentCertificateCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== checkpointContentCertificateCoreDigest(core)) invalid("Checkpoint content certificate core digest mismatches")
  return Object.freeze({ format: value.format, core, coreDigest, serviceSignature: parseSignature(value.serviceSignature) })
}

export function parseStableCheckpointSetCore(value: unknown): StableCheckpointSetCore {
  assertExactKeys(value, [
    "format", "scope", "priorSetDigest", "contentCertificateDigests", "mergedFrontierDigest",
    "actorHeadBoundaryDigest", "membershipSnapshotDigest", "protocolDigest", "validationArtifactSetDigest",
  ], "StableCheckpointSetCore")
  if (value.format !== "convax.stable-checkpoint-set-core") invalid("StableCheckpointSetCore format is invalid")
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScope(value.scope),
    priorSetDigest: value.priorSetDigest === null ? null : parseDigest(value.priorSetDigest),
    contentCertificateDigests: parseDigestList(value.contentCertificateDigests, 1, KERNEL_LIMITS.checkpointParents, "stable content certificates"),
    mergedFrontierDigest: parseDigest(value.mergedFrontierDigest),
    actorHeadBoundaryDigest: parseDigest(value.actorHeadBoundaryDigest),
    membershipSnapshotDigest: parseDigest(value.membershipSnapshotDigest),
    protocolDigest: requireProtocolDigest(value.protocolDigest),
    validationArtifactSetDigest: parseDigest(value.validationArtifactSetDigest),
  })
}

export function parseReplicaCausalFloorAckCore(value: unknown): ReplicaCausalFloorAckCore {
  assertExactKeys(value, [
    "format", "stableSetCoreDigest", "replicaId", "actorId", "replicaActorCredentialDigest",
    "actorHeadAtAck", "durableCheckpoint", "validatedExactClosure", "installedMonotonicFloor",
  ], "ReplicaCausalFloorAckCore")
  if (value.format !== "convax.replica-causal-floor-ack-core" || value.durableCheckpoint !== true || value.validatedExactClosure !== true || value.installedMonotonicFloor !== true) {
    invalid("ReplicaCausalFloorAckCore proof flags are invalid")
  }
  return Object.freeze({
    format: value.format,
    stableSetCoreDigest: parseDigest(value.stableSetCoreDigest),
    replicaId: parseReplicaId(value.replicaId),
    actorId: parseActorId(value.actorId),
    replicaActorCredentialDigest: parseDigest(value.replicaActorCredentialDigest),
    actorHeadAtAck: value.actorHeadAtAck === null ? null : parseCausalHeadRef(value.actorHeadAtAck),
    durableCheckpoint: true,
    validatedExactClosure: true,
    installedMonotonicFloor: true,
  })
}

export function parseReplicaCausalFloorAck(value: unknown): ReplicaCausalFloorAck {
  assertExactKeys(value, ["format", "core", "coreDigest", "replicaSignature"], "ReplicaCausalFloorAck")
  if (value.format !== "convax.replica-causal-floor-ack") invalid("ReplicaCausalFloorAck format is invalid")
  const core = parseReplicaCausalFloorAckCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== replicaCausalFloorAckCoreDigest(core)) invalid("Replica floor ACK core digest mismatches")
  return Object.freeze({ format: value.format, core, coreDigest, replicaSignature: parseSignature(value.replicaSignature) })
}

export function parsePrunableCheckpointSetCertificateCore(value: unknown): PrunableCheckpointSetCertificateCore {
  assertExactKeys(value, [
    "format", "stableSetCore", "floorAckDigests", "contentStatus", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId",
  ], "PrunableCheckpointSetCertificateCore")
  if (value.format !== "convax.prunable-checkpoint-set-certificate-core" || value.contentStatus !== "service-validated-and-all-editors-acknowledged" || value.serviceKeyPurpose !== "checkpoint-stability") {
    invalid("PrunableCheckpointSetCertificateCore discriminators are invalid")
  }
  assertBoundedNfcString(value.serviceKeyId, 1, 256, "prunable certificate serviceKeyId")
  return Object.freeze({
    format: value.format,
    stableSetCore: parseStableCheckpointSetCore(value.stableSetCore),
    floorAckDigests: parseDigestList(value.floorAckDigests, 0, KERNEL_LIMITS.checkpointFrontierHeads, "floor ACK digests"),
    contentStatus: value.contentStatus,
    trustBundleDigest: parseDigest(value.trustBundleDigest),
    serviceKeyPurpose: value.serviceKeyPurpose,
    serviceKeyId: value.serviceKeyId,
  })
}

export function parsePrunableCheckpointSetCertificate(value: unknown): PrunableCheckpointSetCertificate {
  assertExactKeys(value, ["format", "core", "coreDigest", "serviceSignature"], "PrunableCheckpointSetCertificate")
  if (value.format !== "convax.prunable-checkpoint-set-certificate") invalid("PrunableCheckpointSetCertificate format is invalid")
  const core = parsePrunableCheckpointSetCertificateCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== prunableCheckpointSetCertificateCoreDigest(core)) invalid("Prunable checkpoint certificate core digest mismatches")
  return Object.freeze({ format: value.format, core, coreDigest, serviceSignature: parseSignature(value.serviceSignature) })
}

export function replicaCheckpointCoreDigest(core: ReplicaCheckpointCore): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.replicaCheckpointCore, parseReplicaCheckpointCore(core))
}

/** Digest of the complete closed checkpoint wrapper, including the signer signature. */
export function replicaCheckpointObjectDigest(checkpoint: ReplicaCheckpoint): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.replicaCheckpoint, parseReplicaCheckpoint(checkpoint))
}

export function checkpointContentCertificateCoreDigest(core: CheckpointContentCertificateCore): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.checkpointContentCertificateCore, parseCheckpointContentCertificateCore(core))
}

/** Digest of the complete closed content-certificate wrapper. */
export function checkpointContentCertificateObjectDigest(certificate: CheckpointContentCertificate): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.checkpointContentCertificate, parseCheckpointContentCertificate(certificate))
}

export function stableCheckpointSetCoreDigest(core: StableCheckpointSetCore): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.stableCheckpointSetCore, parseStableCheckpointSetCore(core))
}

export function replicaCausalFloorAckCoreDigest(core: ReplicaCausalFloorAckCore): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.replicaCausalFloorAckCore, parseReplicaCausalFloorAckCore(core))
}

/** Digest of the complete closed replica floor-ACK wrapper. */
export function replicaCausalFloorAckObjectDigest(ack: ReplicaCausalFloorAck): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.replicaCausalFloorAck, parseReplicaCausalFloorAck(ack))
}

export function prunableCheckpointSetCertificateCoreDigest(core: PrunableCheckpointSetCertificateCore): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.prunableCheckpointSetCertificateCore, parsePrunableCheckpointSetCertificateCore(core))
}

/** Digest of the complete closed prunable-checkpoint certificate wrapper. */
export function prunableCheckpointSetCertificateObjectDigest(certificate: PrunableCheckpointSetCertificate): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.prunableCheckpointSetCertificate, parsePrunableCheckpointSetCertificate(certificate))
}

/** Structural dual-gate check; signature, role and membership-snapshot authorization stay at the control-plane port. */
export function assertExactPruningCoverage(input: {
  readonly certificate: PrunableCheckpointSetCertificate
  readonly contentCertificates: readonly Readonly<{ certificateDigest: Digest; certificate: CheckpointContentCertificate }>[]
  readonly floorAcks: readonly Readonly<{ ackDigest: Digest; ack: ReplicaCausalFloorAck }>[]
  readonly activeEditorReplicaIds: readonly ReplicaId[]
}): void {
  const certificate = parsePrunableCheckpointSetCertificate(input.certificate)
  const stable = certificate.core.stableSetCore
  const content = input.contentCertificates.map((item) => Object.freeze({ certificateDigest: parseDigest(item.certificateDigest), certificate: parseCheckpointContentCertificate(item.certificate) }))
  const contentDigests = content.map((item) => item.certificateDigest).sort(compareUtf8)
  if (!sameStrings(contentDigests, stable.contentCertificateDigests)) invalid("Pruning lacks the exact service-certified checkpoint set")
  const acks = input.floorAcks.map((item) => Object.freeze({ ackDigest: parseDigest(item.ackDigest), ack: parseReplicaCausalFloorAck(item.ack) }))
  const ackDigests = acks.map((item) => item.ackDigest).sort(compareUtf8)
  if (!sameStrings(ackDigests, certificate.core.floorAckDigests)) invalid("Pruning floor ACK digest set is not exact")
  const expectedReplicas = input.activeEditorReplicaIds.map(parseReplicaId).sort(compareUtf8)
  const actualReplicas = acks.map((item) => {
    if (item.ack.core.stableSetCoreDigest !== stableCheckpointSetCoreDigest(stable)) invalid("Floor ACK is bound to another stable checkpoint set")
    return item.ack.core.replicaId
  }).sort(compareUtf8)
  if (!sameStrings(expectedReplicas, actualReplicas)) invalid("Floor ACKs do not exactly cover the active-editor replica set")
}

function parseDigestList(value: unknown, minimum: number, maximum: number, label: string): readonly Digest[] {
  assertDenseArray(value, label)
  if (value.length < minimum || value.length > maximum) invalid(`${label} count is outside ${minimum}..${maximum}`)
  const result = value.map(parseDigest)
  assertSortedUnique(result, label)
  return Object.freeze(result)
}

function parseBoundedByteLength(value: unknown, maximum: number, label: string) {
  const parsed = parseUint64(value)
  if (uint64ToBigInt(parsed) > BigInt(maximum)) invalid(`${label} byte length exceeds ${maximum}`)
  return parsed
}

function requireProtocolDigest(value: unknown): Digest {
  const digest = parseDigest(value)
  if (digest !== CURRENT_PROTOCOL_IDENTITIES.protocolDigest) invalid("Checkpoint primitive protocol digest is not the current protocol digest")
  return digest
}

function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compareUtf8(values[index - 1]!, values[index]!) >= 0) invalid(`${label} must be strictly sorted and unique`)
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function invalid(message: string): never {
  failCodec(message)
}
