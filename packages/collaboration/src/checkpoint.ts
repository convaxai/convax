import type { DigestV2, ReplicaIdV2 } from "./codecs"
import {
  assertBoundedNfcStringV2,
  parseActorIdV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseReplicaIdV2,
  parseSignatureV2,
  parseUint64V2,
  uint64ToBigIntV2,
} from "./codecs"
import { KERNEL_DIGEST_DOMAINS_V2, KERNEL_LIMITS_V2, PINNED_AUTHORITY_IDENTITIES_V2 } from "./constants"
import type {
  CheckpointContentCertificateCoreV2,
  CheckpointContentCertificateV2,
  PrunableCheckpointSetCertificateCoreV2,
  PrunableCheckpointSetCertificateV2,
  ReplicaCausalFloorAckCoreV2,
  ReplicaCausalFloorAckV2,
  ReplicaCheckpointCoreV2,
  ReplicaCheckpointV2,
  StableCheckpointSetCoreV2,
} from "./contracts"
import { structuredDigestV2 } from "./digest"
import { failCodec } from "./errors"
import { assertDenseArrayV2, assertExactKeysV2, compareUtf8V2 } from "./jcs"
import { parseCausalHeadRefV2, parseDocumentScopeV2 } from "./parse"

export function parseReplicaCheckpointCoreV2(value: unknown): ReplicaCheckpointCoreV2 {
  assertExactKeysV2(value, [
    "format", "scope", "checkpointId", "authorMemberId", "authorReplicaId", "authorActorId",
    "authorAuthorizationDigest", "directParentCheckpointDigests", "baseFrontierDigest",
    "computedFrontierDigest", "actorHeadBoundaryDigest", "stateVectorDigest", "canonicalStateDigest",
    "fullUpdateDigest", "fullUpdateByteLength", "protocolDigest", "schemaDigest", "canonicalizerDigest",
    "validationArtifactSetDigest",
  ], "ReplicaCheckpointCoreV2")
  if (value.format !== "convax.replica-checkpoint-core/2") invalid("ReplicaCheckpointCoreV2 format is invalid")
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScopeV2(value.scope),
    checkpointId: parseId128V2(value.checkpointId),
    authorMemberId: parseMemberIdV2(value.authorMemberId),
    authorReplicaId: parseReplicaIdV2(value.authorReplicaId),
    authorActorId: parseActorIdV2(value.authorActorId),
    authorAuthorizationDigest: parseDigestV2(value.authorAuthorizationDigest),
    directParentCheckpointDigests: parseDigestList(value.directParentCheckpointDigests, 0, KERNEL_LIMITS_V2.checkpointParents, "checkpoint parents"),
    baseFrontierDigest: parseDigestV2(value.baseFrontierDigest),
    computedFrontierDigest: parseDigestV2(value.computedFrontierDigest),
    actorHeadBoundaryDigest: parseDigestV2(value.actorHeadBoundaryDigest),
    stateVectorDigest: parseDigestV2(value.stateVectorDigest),
    canonicalStateDigest: parseDigestV2(value.canonicalStateDigest),
    fullUpdateDigest: parseDigestV2(value.fullUpdateDigest),
    fullUpdateByteLength: parseBoundedByteLength(value.fullUpdateByteLength, KERNEL_LIMITS_V2.checkpointSnapshotBytes, "checkpoint snapshot"),
    protocolDigest: requireProtocolDigest(value.protocolDigest),
    schemaDigest: parseDigestV2(value.schemaDigest),
    canonicalizerDigest: parseDigestV2(value.canonicalizerDigest),
    validationArtifactSetDigest: parseDigestV2(value.validationArtifactSetDigest),
  })
}

export function parseReplicaCheckpointV2(value: unknown): ReplicaCheckpointV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "replicaSignature"], "ReplicaCheckpointV2")
  if (value.format !== "convax.replica-checkpoint/2") invalid("ReplicaCheckpointV2 format is invalid")
  const core = parseReplicaCheckpointCoreV2(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== replicaCheckpointCoreDigestV2(core)) invalid("ReplicaCheckpointV2 core digest mismatches")
  return Object.freeze({ format: value.format, core, coreDigest, replicaSignature: parseSignatureV2(value.replicaSignature) })
}

export function parseCheckpointContentCertificateCoreV2(value: unknown): CheckpointContentCertificateCoreV2 {
  assertExactKeysV2(value, [
    "format", "scope", "checkpointDigest", "parentCertificateDigests", "computedFrontierDigest",
    "actorHeadBoundaryDigest", "stateVectorDigest", "canonicalStateDigest", "fullUpdateDigest", "protocolDigest",
    "schemaDigest", "canonicalizerDigest", "validationArtifactSetDigest", "trustBundleDigest", "contentStatus",
    "serviceKeyPurpose", "serviceKeyId",
  ], "CheckpointContentCertificateCoreV2")
  if (value.format !== "convax.checkpoint-content-certificate-core/2" || value.contentStatus !== "service-validated-causal-closure" || value.serviceKeyPurpose !== "content-attestation") {
    invalid("CheckpointContentCertificateCoreV2 discriminators are invalid")
  }
  assertBoundedNfcStringV2(value.serviceKeyId, 1, 256, "content certificate serviceKeyId")
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScopeV2(value.scope),
    checkpointDigest: parseDigestV2(value.checkpointDigest),
    parentCertificateDigests: parseDigestList(value.parentCertificateDigests, 0, KERNEL_LIMITS_V2.checkpointParents, "parent certificates"),
    computedFrontierDigest: parseDigestV2(value.computedFrontierDigest),
    actorHeadBoundaryDigest: parseDigestV2(value.actorHeadBoundaryDigest),
    stateVectorDigest: parseDigestV2(value.stateVectorDigest),
    canonicalStateDigest: parseDigestV2(value.canonicalStateDigest),
    fullUpdateDigest: parseDigestV2(value.fullUpdateDigest),
    protocolDigest: requireProtocolDigest(value.protocolDigest),
    schemaDigest: parseDigestV2(value.schemaDigest),
    canonicalizerDigest: parseDigestV2(value.canonicalizerDigest),
    validationArtifactSetDigest: parseDigestV2(value.validationArtifactSetDigest),
    trustBundleDigest: parseDigestV2(value.trustBundleDigest),
    contentStatus: value.contentStatus,
    serviceKeyPurpose: value.serviceKeyPurpose,
    serviceKeyId: value.serviceKeyId,
  })
}

export function parseCheckpointContentCertificateV2(value: unknown): CheckpointContentCertificateV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "serviceSignature"], "CheckpointContentCertificateV2")
  if (value.format !== "convax.checkpoint-content-certificate/2") invalid("CheckpointContentCertificateV2 format is invalid")
  const core = parseCheckpointContentCertificateCoreV2(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== checkpointContentCertificateCoreDigestV2(core)) invalid("Checkpoint content certificate core digest mismatches")
  return Object.freeze({ format: value.format, core, coreDigest, serviceSignature: parseSignatureV2(value.serviceSignature) })
}

export function parseStableCheckpointSetCoreV2(value: unknown): StableCheckpointSetCoreV2 {
  assertExactKeysV2(value, [
    "format", "scope", "priorSetDigest", "contentCertificateDigests", "mergedFrontierDigest",
    "actorHeadBoundaryDigest", "membershipSnapshotDigest", "protocolDigest", "validationArtifactSetDigest",
  ], "StableCheckpointSetCoreV2")
  if (value.format !== "convax.stable-checkpoint-set-core/2") invalid("StableCheckpointSetCoreV2 format is invalid")
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScopeV2(value.scope),
    priorSetDigest: value.priorSetDigest === null ? null : parseDigestV2(value.priorSetDigest),
    contentCertificateDigests: parseDigestList(value.contentCertificateDigests, 1, KERNEL_LIMITS_V2.checkpointParents, "stable content certificates"),
    mergedFrontierDigest: parseDigestV2(value.mergedFrontierDigest),
    actorHeadBoundaryDigest: parseDigestV2(value.actorHeadBoundaryDigest),
    membershipSnapshotDigest: parseDigestV2(value.membershipSnapshotDigest),
    protocolDigest: requireProtocolDigest(value.protocolDigest),
    validationArtifactSetDigest: parseDigestV2(value.validationArtifactSetDigest),
  })
}

export function parseReplicaCausalFloorAckCoreV2(value: unknown): ReplicaCausalFloorAckCoreV2 {
  assertExactKeysV2(value, [
    "format", "stableSetCoreDigest", "replicaId", "actorId", "replicaActorCredentialDigest",
    "actorHeadAtAck", "durableCheckpoint", "validatedExactClosure", "installedMonotonicFloor",
  ], "ReplicaCausalFloorAckCoreV2")
  if (value.format !== "convax.replica-causal-floor-ack-core/2" || value.durableCheckpoint !== true || value.validatedExactClosure !== true || value.installedMonotonicFloor !== true) {
    invalid("ReplicaCausalFloorAckCoreV2 proof flags are invalid")
  }
  return Object.freeze({
    format: value.format,
    stableSetCoreDigest: parseDigestV2(value.stableSetCoreDigest),
    replicaId: parseReplicaIdV2(value.replicaId),
    actorId: parseActorIdV2(value.actorId),
    replicaActorCredentialDigest: parseDigestV2(value.replicaActorCredentialDigest),
    actorHeadAtAck: value.actorHeadAtAck === null ? null : parseCausalHeadRefV2(value.actorHeadAtAck),
    durableCheckpoint: true,
    validatedExactClosure: true,
    installedMonotonicFloor: true,
  })
}

export function parseReplicaCausalFloorAckV2(value: unknown): ReplicaCausalFloorAckV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "replicaSignature"], "ReplicaCausalFloorAckV2")
  if (value.format !== "convax.replica-causal-floor-ack/2") invalid("ReplicaCausalFloorAckV2 format is invalid")
  const core = parseReplicaCausalFloorAckCoreV2(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== replicaCausalFloorAckCoreDigestV2(core)) invalid("Replica floor ACK core digest mismatches")
  return Object.freeze({ format: value.format, core, coreDigest, replicaSignature: parseSignatureV2(value.replicaSignature) })
}

export function parsePrunableCheckpointSetCertificateCoreV2(value: unknown): PrunableCheckpointSetCertificateCoreV2 {
  assertExactKeysV2(value, [
    "format", "stableSetCore", "floorAckDigests", "contentStatus", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId",
  ], "PrunableCheckpointSetCertificateCoreV2")
  if (value.format !== "convax.prunable-checkpoint-set-certificate-core/2" || value.contentStatus !== "service-validated-and-all-editors-acknowledged" || value.serviceKeyPurpose !== "checkpoint-stability") {
    invalid("PrunableCheckpointSetCertificateCoreV2 discriminators are invalid")
  }
  assertBoundedNfcStringV2(value.serviceKeyId, 1, 256, "prunable certificate serviceKeyId")
  return Object.freeze({
    format: value.format,
    stableSetCore: parseStableCheckpointSetCoreV2(value.stableSetCore),
    floorAckDigests: parseDigestList(value.floorAckDigests, 0, KERNEL_LIMITS_V2.checkpointFrontierHeads, "floor ACK digests"),
    contentStatus: value.contentStatus,
    trustBundleDigest: parseDigestV2(value.trustBundleDigest),
    serviceKeyPurpose: value.serviceKeyPurpose,
    serviceKeyId: value.serviceKeyId,
  })
}

export function parsePrunableCheckpointSetCertificateV2(value: unknown): PrunableCheckpointSetCertificateV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "serviceSignature"], "PrunableCheckpointSetCertificateV2")
  if (value.format !== "convax.prunable-checkpoint-set-certificate/2") invalid("PrunableCheckpointSetCertificateV2 format is invalid")
  const core = parsePrunableCheckpointSetCertificateCoreV2(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== prunableCheckpointSetCertificateCoreDigestV2(core)) invalid("Prunable checkpoint certificate core digest mismatches")
  return Object.freeze({ format: value.format, core, coreDigest, serviceSignature: parseSignatureV2(value.serviceSignature) })
}

export function replicaCheckpointCoreDigestV2(core: ReplicaCheckpointCoreV2): DigestV2 {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.replicaCheckpointCore, parseReplicaCheckpointCoreV2(core))
}

/** Digest of the complete closed checkpoint wrapper, including the signer signature. */
export function replicaCheckpointObjectDigestV2(checkpoint: ReplicaCheckpointV2): DigestV2 {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.replicaCheckpoint, parseReplicaCheckpointV2(checkpoint))
}

export function checkpointContentCertificateCoreDigestV2(core: CheckpointContentCertificateCoreV2): DigestV2 {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.checkpointContentCertificateCore, parseCheckpointContentCertificateCoreV2(core))
}

/** Digest of the complete closed content-certificate wrapper. */
export function checkpointContentCertificateObjectDigestV2(certificate: CheckpointContentCertificateV2): DigestV2 {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.checkpointContentCertificate, parseCheckpointContentCertificateV2(certificate))
}

export function stableCheckpointSetCoreDigestV2(core: StableCheckpointSetCoreV2): DigestV2 {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.stableCheckpointSetCore, parseStableCheckpointSetCoreV2(core))
}

export function replicaCausalFloorAckCoreDigestV2(core: ReplicaCausalFloorAckCoreV2): DigestV2 {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.replicaCausalFloorAckCore, parseReplicaCausalFloorAckCoreV2(core))
}

/** Digest of the complete closed replica floor-ACK wrapper. */
export function replicaCausalFloorAckObjectDigestV2(ack: ReplicaCausalFloorAckV2): DigestV2 {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.replicaCausalFloorAck, parseReplicaCausalFloorAckV2(ack))
}

export function prunableCheckpointSetCertificateCoreDigestV2(core: PrunableCheckpointSetCertificateCoreV2): DigestV2 {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.prunableCheckpointSetCertificateCore, parsePrunableCheckpointSetCertificateCoreV2(core))
}

/** Digest of the complete closed prunable-checkpoint certificate wrapper. */
export function prunableCheckpointSetCertificateObjectDigestV2(certificate: PrunableCheckpointSetCertificateV2): DigestV2 {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.prunableCheckpointSetCertificate, parsePrunableCheckpointSetCertificateV2(certificate))
}

/** Structural dual-gate check; signature, role and membership-snapshot authorization stay at the control-plane port. */
export function assertExactPruningCoverageV2(input: {
  readonly certificate: PrunableCheckpointSetCertificateV2
  readonly contentCertificates: readonly Readonly<{ certificateDigest: DigestV2; certificate: CheckpointContentCertificateV2 }>[]
  readonly floorAcks: readonly Readonly<{ ackDigest: DigestV2; ack: ReplicaCausalFloorAckV2 }>[]
  readonly activeEditorReplicaIds: readonly ReplicaIdV2[]
}): void {
  const certificate = parsePrunableCheckpointSetCertificateV2(input.certificate)
  const stable = certificate.core.stableSetCore
  const content = input.contentCertificates.map((item) => Object.freeze({ certificateDigest: parseDigestV2(item.certificateDigest), certificate: parseCheckpointContentCertificateV2(item.certificate) }))
  const contentDigests = content.map((item) => item.certificateDigest).sort(compareUtf8V2)
  if (!sameStrings(contentDigests, stable.contentCertificateDigests)) invalid("Pruning lacks the exact service-certified checkpoint set")
  const acks = input.floorAcks.map((item) => Object.freeze({ ackDigest: parseDigestV2(item.ackDigest), ack: parseReplicaCausalFloorAckV2(item.ack) }))
  const ackDigests = acks.map((item) => item.ackDigest).sort(compareUtf8V2)
  if (!sameStrings(ackDigests, certificate.core.floorAckDigests)) invalid("Pruning floor ACK digest set is not exact")
  const expectedReplicas = input.activeEditorReplicaIds.map(parseReplicaIdV2).sort(compareUtf8V2)
  const actualReplicas = acks.map((item) => {
    if (item.ack.core.stableSetCoreDigest !== stableCheckpointSetCoreDigestV2(stable)) invalid("Floor ACK is bound to another stable checkpoint set")
    return item.ack.core.replicaId
  }).sort(compareUtf8V2)
  if (!sameStrings(expectedReplicas, actualReplicas)) invalid("Floor ACKs do not exactly cover the active-editor replica set")
}

function parseDigestList(value: unknown, minimum: number, maximum: number, label: string): readonly DigestV2[] {
  assertDenseArrayV2(value, label)
  if (value.length < minimum || value.length > maximum) invalid(`${label} count is outside ${minimum}..${maximum}`)
  const result = value.map(parseDigestV2)
  assertSortedUnique(result, label)
  return Object.freeze(result)
}

function parseBoundedByteLength(value: unknown, maximum: number, label: string) {
  const parsed = parseUint64V2(value)
  if (uint64ToBigIntV2(parsed) > BigInt(maximum)) invalid(`${label} byte length exceeds ${maximum}`)
  return parsed
}

function requireProtocolDigest(value: unknown): DigestV2 {
  const digest = parseDigestV2(value)
  if (digest !== PINNED_AUTHORITY_IDENTITIES_V2.protocolDigest) invalid("Checkpoint primitive protocol digest is not frozen v2")
  return digest
}

function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compareUtf8V2(values[index - 1]!, values[index]!) >= 0) invalid(`${label} must be strictly sorted and unique`)
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function invalid(message: string): never {
  failCodec(message)
}
