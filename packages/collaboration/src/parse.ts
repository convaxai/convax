import {
  assertBoundedNfcStringV2,
  parseActorIdV2,
  parseCanvasIdV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parseReplicaIdV2,
  parseSignatureV2,
  parseUint32V2,
  parseUint64V2,
  uint64ToBigIntV2,
} from "./codecs"
import type {
  ActualWriteEvidenceV2,
  ActualWriteV2,
  CausalContextV2,
  CausalDependencyKindV2,
  CausalDependencyRefV2,
  CausalEditCoreV2,
  CausalEditFrameHeaderV2,
  CausalFrontierV2,
  CausalHeadRefV2,
  CausalSignerAuthorityV2,
  DocumentScopeV2,
  PortableStampV2,
  ReplicaActorHeadSetV2,
  ValidationArtifactRefV2,
  ValidationArtifactSetV2,
} from "./contracts"
import { failCodec, failFrame } from "./errors"
import { assertDenseArrayV2, assertExactKeysV2, compareUtf8V2 } from "./jcs"
import { KERNEL_LIMITS_V2, PINNED_AUTHORITY_IDENTITIES_V2 } from "./constants"

const DEPENDENCY_KINDS = new Set<CausalDependencyKindV2>([
  "membership-snapshot",
  "replica-actor-credential",
  "replica-edit-authorization",
  "authorization-mutation",
  "cutoff-coverage-root",
  "checkpoint-content-certificate",
  "project-index-proof",
  "project-resource-proof",
  "plugin-validation-artifact",
  "generation-external-fact",
  "reset-authorization",
])
const ARTIFACT_OWNERS = new Set(["kernel", "project-index", "canvas", "control-plane", "plugin"])
const CORE_KEYS = [
  "format", "scope", "actorId", "actorSequence", "predecessorFrameDigest", "operationId", "lamport",
  "intentKind", "intentDigest", "causalContextDigest", "baseFrontierDigest", "baseStateVectorDigest",
  "baseCanonicalStateDigest", "yjsUpdateDigest", "postStateVectorDigest", "postCanonicalStateDigest",
  "actualWriteEvidenceDigest", "typedIntentJcsByteLength", "causalContextJcsByteLength",
  "baseStateVectorByteLength", "yjsUpdateByteLength", "actualWriteEvidenceJcsByteLength", "protocolDigest",
  "ownerSchemaDigest", "canonicalizerDigest", "validationArtifactSetDigest", "membershipSnapshotDigest",
  "replicaActorCredentialCoreDigest", "replicaEditAuthorizationCoreDigest",
] as const

export function parseDocumentScopeV2(value: unknown): DocumentScopeV2 {
  assertExactKeysV2(value, ["projectId", "projectEpoch", "docKind", "docId", "shardEpoch"], "DocumentScopeV2")
  const projectId = parseProjectIdV2(value.projectId)
  const projectEpoch = parseId128V2(value.projectEpoch)
  const shardEpoch = parseId128V2(value.shardEpoch)
  if (value.docKind === "project-index") {
    if (value.docId !== "project-index") failCodec("ProjectIndex scope requires docId project-index")
    return Object.freeze({ projectId, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch })
  }
  if (value.docKind !== "canvas") failCodec("DocumentScopeV2 docKind is invalid")
  return Object.freeze({ projectId, projectEpoch, docKind: "canvas", docId: parseCanvasIdV2(value.docId), shardEpoch })
}

export function parsePortableStampV2(value: unknown): PortableStampV2 {
  assertExactKeysV2(value, ["format", "lamport", "actorId", "operationId", "writeOrdinal"], "PortableStampV2")
  if (value.format !== "convax.portable-stamp/2") failCodec("PortableStampV2 format is invalid")
  return Object.freeze({
    format: value.format,
    lamport: parseUint64V2(value.lamport),
    actorId: parseActorIdV2(value.actorId),
    operationId: parseId128V2(value.operationId),
    writeOrdinal: parseUint32V2(value.writeOrdinal),
  })
}

export function parseCausalHeadRefV2(value: unknown): CausalHeadRefV2 {
  assertExactKeysV2(value, ["format", "actorId", "actorSequence", "frameDigest", "lamport"], "CausalHeadRefV2")
  if (value.format !== "convax.causal-head-ref/2") failCodec("CausalHeadRefV2 format is invalid")
  const actorSequence = parseUint64V2(value.actorSequence)
  if (actorSequence === "0") failCodec("Causal actor sequence starts at one")
  return Object.freeze({
    format: value.format,
    actorId: parseActorIdV2(value.actorId),
    actorSequence,
    frameDigest: parseDigestV2(value.frameDigest),
    lamport: parseUint64V2(value.lamport),
  })
}

export function parseCausalFrontierV2(value: unknown): CausalFrontierV2 {
  assertExactKeysV2(value, ["format", "heads"], "CausalFrontierV2")
  if (value.format !== "convax.causal-frontier/2") failCodec("CausalFrontierV2 format is invalid")
  assertDenseArrayV2(value.heads, "CausalFrontierV2 heads")
  if (value.heads.length > KERNEL_LIMITS_V2.causalFrontierHeads) failCodec("Causal frontier exceeds 256 heads")
  const heads = value.heads.map(parseCausalHeadRefV2)
  assertStrictlySorted(heads, (left, right) => compareDecoded(left.actorId, right.actorId), "Causal frontier heads")
  return Object.freeze({ format: value.format, heads: Object.freeze(heads) })
}

export function parseReplicaActorHeadSetV2(value: unknown): ReplicaActorHeadSetV2 {
  assertExactKeysV2(value, ["format", "scope", "heads"], "ReplicaActorHeadSetV2")
  if (value.format !== "convax.replica-actor-head-set/2") failCodec("ReplicaActorHeadSetV2 format is invalid")
  assertDenseArrayV2(value.heads, "ReplicaActorHeadSetV2 heads")
  if (value.heads.length > KERNEL_LIMITS_V2.causalFrontierHeads) failCodec("Replica actor heads exceed 256")
  const heads = value.heads.map(parseCausalHeadRefV2)
  assertStrictlySorted(heads, (left, right) => compareDecoded(left.actorId, right.actorId), "ReplicaActorHeadSetV2 heads")
  return Object.freeze({ format: value.format, scope: parseDocumentScopeV2(value.scope), heads: Object.freeze(heads) })
}

export function parseCausalContextV2(value: unknown): CausalContextV2 {
  assertExactKeysV2(value, [
    "format", "scope", "baseFrontier", "baseFrontierDigest", "baseStateVectorDigest",
    "baseCanonicalStateDigest", "signerAuthority", "dependencies", "validationArtifactSetDigest",
  ], "CausalContextV2")
  if (value.format !== "convax.causal-context/2") failCodec("CausalContextV2 format is invalid")
  assertDenseArrayV2(value.dependencies, "CausalContextV2 dependencies")
  if (value.dependencies.length > KERNEL_LIMITS_V2.causalDependencyRefs) failCodec("Causal dependencies exceed 256 refs")
  const dependencies = value.dependencies.map(parseDependency)
  assertStrictlySorted(dependencies, compareDependency, "Causal dependencies")
  const signerAuthority = parseSignerAuthority(value.signerAuthority)
  requireDependency(dependencies, "membership-snapshot", signerAuthority.membershipSnapshotDigest)
  requireDependency(dependencies, "replica-actor-credential", signerAuthority.replicaActorCredentialCoreDigest)
  requireDependency(dependencies, "replica-edit-authorization", signerAuthority.replicaEditAuthorizationCoreDigest)
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScopeV2(value.scope),
    baseFrontier: parseCausalFrontierV2(value.baseFrontier),
    baseFrontierDigest: parseDigestV2(value.baseFrontierDigest),
    baseStateVectorDigest: parseDigestV2(value.baseStateVectorDigest),
    baseCanonicalStateDigest: parseDigestV2(value.baseCanonicalStateDigest),
    signerAuthority,
    dependencies: Object.freeze(dependencies),
    validationArtifactSetDigest: parseDigestV2(value.validationArtifactSetDigest),
  })
}

export function parseActualWriteEvidenceV2(value: unknown): ActualWriteEvidenceV2 {
  assertExactKeysV2(value, ["format", "scope", "owner", "ownerSchemaDigest", "intentDigest", "changedPaths", "writes"], "ActualWriteEvidenceV2")
  if (value.format !== "convax.actual-write-evidence/2") failCodec("ActualWriteEvidenceV2 format is invalid")
  if (value.owner !== "project-index" && value.owner !== "canvas") failCodec("ActualWriteEvidenceV2 owner is invalid")
  assertDenseArrayV2(value.changedPaths, "ActualWriteEvidenceV2 changedPaths")
  assertDenseArrayV2(value.writes, "ActualWriteEvidenceV2 writes")
  if (value.changedPaths.length > KERNEL_LIMITS_V2.changedPaths || value.writes.length > KERNEL_LIMITS_V2.writes) {
    failCodec("ActualWriteEvidenceV2 exceeds the kernel outer count limits")
  }
  const changedPaths = value.changedPaths.map((path, index) => {
    assertBoundedNfcStringV2(path, 1, KERNEL_LIMITS_V2.oneChangedPathUtf8Bytes, `changedPaths[${index}]`)
    return path
  })
  assertStrictlySorted(changedPaths, compareUtf8V2, "ActualWriteEvidenceV2 changedPaths")
  const writes = value.writes.map(parseActualWrite)
  assertStrictlySorted(writes, compareActualWrite, "ActualWriteEvidenceV2 writes")
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScopeV2(value.scope),
    owner: value.owner,
    ownerSchemaDigest: parseDigestV2(value.ownerSchemaDigest),
    intentDigest: parseDigestV2(value.intentDigest),
    changedPaths: Object.freeze(changedPaths),
    writes: Object.freeze(writes),
  })
}

export function parseValidationArtifactSetV2(value: unknown): ValidationArtifactSetV2 {
  assertExactKeysV2(value, ["format", "artifacts"], "ValidationArtifactSetV2")
  if (value.format !== "convax.validation-artifact-set/2") failCodec("ValidationArtifactSetV2 format is invalid")
  assertDenseArrayV2(value.artifacts, "ValidationArtifactSetV2 artifacts")
  if (value.artifacts.length > KERNEL_LIMITS_V2.validationArtifactRefs) failCodec("Validation artifacts exceed 64 refs")
  const artifacts = value.artifacts.map(parseValidationArtifact)
  assertStrictlySorted(artifacts, compareValidationArtifact, "ValidationArtifactSetV2 artifacts")
  return Object.freeze({ format: value.format, artifacts: Object.freeze(artifacts) })
}

export function parseCausalEditCoreV2(value: unknown): CausalEditCoreV2 {
  assertExactKeysV2(value, CORE_KEYS, "CausalEditCoreV2")
  if (value.format !== "convax.causal-edit-core/2") failFrame("CausalEditCoreV2 format is invalid")
  const actorSequence = parseUint64V2(value.actorSequence)
  if (actorSequence === "0") failFrame("Causal edit actor sequence starts at one")
  if (value.predecessorFrameDigest !== null && typeof value.predecessorFrameDigest !== "string") failFrame("Causal predecessor is invalid")
  assertBoundedNfcStringV2(value.intentKind, 1, 128, "Causal intentKind")
  if (!/^[\x20-\x7e]+$/u.test(value.intentKind)) failFrame("Causal intentKind must be ASCII")
  const protocolDigest = parseDigestV2(value.protocolDigest)
  if (protocolDigest !== PINNED_AUTHORITY_IDENTITIES_V2.protocolDigest) failFrame("Causal edit protocol digest is not the frozen v2 digest")
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScopeV2(value.scope),
    actorId: parseActorIdV2(value.actorId),
    actorSequence,
    predecessorFrameDigest: value.predecessorFrameDigest === null ? null : parseDigestV2(value.predecessorFrameDigest),
    operationId: parseId128V2(value.operationId),
    lamport: parseUint64V2(value.lamport),
    intentKind: value.intentKind,
    intentDigest: parseDigestV2(value.intentDigest),
    causalContextDigest: parseDigestV2(value.causalContextDigest),
    baseFrontierDigest: parseDigestV2(value.baseFrontierDigest),
    baseStateVectorDigest: parseDigestV2(value.baseStateVectorDigest),
    baseCanonicalStateDigest: parseDigestV2(value.baseCanonicalStateDigest),
    yjsUpdateDigest: parseDigestV2(value.yjsUpdateDigest),
    postStateVectorDigest: parseDigestV2(value.postStateVectorDigest),
    postCanonicalStateDigest: parseDigestV2(value.postCanonicalStateDigest),
    actualWriteEvidenceDigest: parseDigestV2(value.actualWriteEvidenceDigest),
    typedIntentJcsByteLength: parseUint64V2(value.typedIntentJcsByteLength),
    causalContextJcsByteLength: parseUint64V2(value.causalContextJcsByteLength),
    baseStateVectorByteLength: parseUint64V2(value.baseStateVectorByteLength),
    yjsUpdateByteLength: parseUint64V2(value.yjsUpdateByteLength),
    actualWriteEvidenceJcsByteLength: parseUint64V2(value.actualWriteEvidenceJcsByteLength),
    protocolDigest,
    ownerSchemaDigest: parseDigestV2(value.ownerSchemaDigest),
    canonicalizerDigest: parseDigestV2(value.canonicalizerDigest),
    validationArtifactSetDigest: parseDigestV2(value.validationArtifactSetDigest),
    membershipSnapshotDigest: parseDigestV2(value.membershipSnapshotDigest),
    replicaActorCredentialCoreDigest: parseDigestV2(value.replicaActorCredentialCoreDigest),
    replicaEditAuthorizationCoreDigest: parseDigestV2(value.replicaEditAuthorizationCoreDigest),
  })
}

export function parseCausalEditFrameHeaderV2(value: unknown): CausalEditFrameHeaderV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "replicaSignature"], "CausalEditFrameHeaderV2")
  if (value.format !== "convax.causal-edit-frame/2") failFrame("Causal edit frame header format is invalid")
  return Object.freeze({
    format: value.format,
    core: parseCausalEditCoreV2(value.core),
    coreDigest: parseDigestV2(value.coreDigest),
    replicaSignature: parseSignatureV2(value.replicaSignature),
  })
}

export function assertSameScopeV2(left: DocumentScopeV2, right: DocumentScopeV2, label = "document scope"): void {
  if (left.projectId !== right.projectId || left.projectEpoch !== right.projectEpoch || left.docKind !== right.docKind || left.docId !== right.docId || left.shardEpoch !== right.shardEpoch) {
    failFrame(`${label} fields are not byte-identical`)
  }
}

export function assertCoreSectionLengthsV2(core: CausalEditCoreV2, lengths: readonly number[]): void {
  const fields = [
    core.typedIntentJcsByteLength,
    core.causalContextJcsByteLength,
    core.baseStateVectorByteLength,
    core.yjsUpdateByteLength,
    core.actualWriteEvidenceJcsByteLength,
  ]
  for (let index = 0; index < fields.length; index += 1) {
    if (uint64ToBigIntV2(fields[index]!) !== BigInt(lengths[index]!)) failFrame("Causal section length differs from its signed core field")
  }
}

function parseSignerAuthority(value: unknown): CausalSignerAuthorityV2 {
  assertExactKeysV2(value, [
    "memberId", "replicaId", "actorId", "memberAuthorizationEpoch", "replicaAuthorizationEpoch",
    "membershipSnapshotDigest", "replicaActorCredentialCoreDigest", "replicaEditAuthorizationCoreDigest",
  ], "CausalSignerAuthorityV2")
  return Object.freeze({
    memberId: parseMemberIdV2(value.memberId),
    replicaId: parseReplicaIdV2(value.replicaId),
    actorId: parseActorIdV2(value.actorId),
    memberAuthorizationEpoch: parseId128V2(value.memberAuthorizationEpoch),
    replicaAuthorizationEpoch: parseId128V2(value.replicaAuthorizationEpoch),
    membershipSnapshotDigest: parseDigestV2(value.membershipSnapshotDigest),
    replicaActorCredentialCoreDigest: parseDigestV2(value.replicaActorCredentialCoreDigest),
    replicaEditAuthorizationCoreDigest: parseDigestV2(value.replicaEditAuthorizationCoreDigest),
  })
}

function parseDependency(value: unknown): CausalDependencyRefV2 {
  assertExactKeysV2(value, ["kind", "digest"], "CausalDependencyRefV2")
  if (typeof value.kind !== "string" || !DEPENDENCY_KINDS.has(value.kind as CausalDependencyKindV2)) failCodec("Causal dependency kind is invalid")
  return Object.freeze({ kind: value.kind as CausalDependencyKindV2, digest: parseDigestV2(value.digest) })
}

function parseActualWrite(value: unknown): ActualWriteV2 {
  assertExactKeysV2(value, ["entityKind", "entityId", "field", "valueDigest"], "ActualWriteV2")
  assertBoundedNfcStringV2(value.entityKind, 1, 64, "ActualWriteV2 entityKind")
  if (!/^[\x21-\x7e]+$/u.test(value.entityKind)) failCodec("ActualWriteV2 entityKind must be an ASCII token")
  assertBoundedNfcStringV2(value.entityId, 1, 256, "ActualWriteV2 entityId")
  assertBoundedNfcStringV2(value.field, 1, 256, "ActualWriteV2 field")
  return Object.freeze({ entityKind: value.entityKind, entityId: value.entityId, field: value.field, valueDigest: parseDigestV2(value.valueDigest) })
}

function parseValidationArtifact(value: unknown): ValidationArtifactRefV2 {
  assertExactKeysV2(value, ["owner", "format", "artifactDigest"], "ValidationArtifactRefV2")
  if (typeof value.owner !== "string" || !ARTIFACT_OWNERS.has(value.owner)) failCodec("Validation artifact owner is invalid")
  assertBoundedNfcStringV2(value.format, 1, 256, "Validation artifact format")
  return Object.freeze({ owner: value.owner as ValidationArtifactRefV2["owner"], format: value.format, artifactDigest: parseDigestV2(value.artifactDigest) })
}

function compareDependency(left: CausalDependencyRefV2, right: CausalDependencyRefV2): number {
  return compareUtf8V2(left.kind, right.kind) || compareDecoded(left.digest, right.digest)
}

function compareActualWrite(left: ActualWriteV2, right: ActualWriteV2): number {
  return compareUtf8V2(left.entityKind, right.entityKind) || compareUtf8V2(left.entityId, right.entityId) || compareUtf8V2(left.field, right.field) || compareDecoded(left.valueDigest, right.valueDigest)
}

function compareValidationArtifact(left: ValidationArtifactRefV2, right: ValidationArtifactRefV2): number {
  return compareUtf8V2(left.owner, right.owner) || compareUtf8V2(left.format, right.format) || compareDecoded(left.artifactDigest, right.artifactDigest)
}

function requireDependency(dependencies: readonly CausalDependencyRefV2[], kind: CausalDependencyKindV2, digest: string): void {
  if (!dependencies.some((dependency) => dependency.kind === kind && dependency.digest === digest)) failCodec(`Causal context lacks mandatory ${kind} dependency`)
}

function assertStrictlySorted<T>(values: readonly T[], compare: (left: T, right: T) => number, label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compare(values[index - 1]!, values[index]!) >= 0) failCodec(`${label} must be strictly sorted and duplicate-free`)
  }
}

function compareDecoded(left: string, right: string): number {
  if (left.length === 64 && right.length === 64) return left < right ? -1 : left > right ? 1 : 0
  const leftBytes = Uint8Array.from(atob(left.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - left.length % 4) % 4)), (character) => character.charCodeAt(0))
  const rightBytes = Uint8Array.from(atob(right.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - right.length % 4) % 4)), (character) => character.charCodeAt(0))
  const length = Math.min(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!
    if (difference !== 0) return difference
  }
  return leftBytes.length - rightBytes.length
}
