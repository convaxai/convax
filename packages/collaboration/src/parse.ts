import {
  assertBoundedNfcString,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseReplicaId,
  parseSignature,
  parseUint32,
  parseUint64,
  uint64ToBigInt,
} from "./codecs"
import type {
  ActualWriteEvidence,
  ActualWrite,
  CausalContext,
  CausalDependencyKind,
  CausalDependencyRef,
  CausalEditCore,
  CausalEditFrameHeader,
  CausalFrontier,
  CausalHeadRef,
  CausalSignerAuthority,
  DocumentScope,
  PortableStamp,
  ReplicaActorHeadSet,
  ValidationArtifactRef,
  ValidationArtifactSet,
} from "./contracts"
import { failCodec, failFrame } from "./errors"
import { assertDenseArray, assertExactKeys, compareUtf8 } from "./jcs"
import { KERNEL_LIMITS, CURRENT_PROTOCOL_IDENTITIES } from "./constants"

const DEPENDENCY_KINDS = new Set<CausalDependencyKind>([
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

export function parseDocumentScope(value: unknown): DocumentScope {
  assertExactKeys(value, ["projectId", "projectEpoch", "docKind", "docId", "shardEpoch"], "DocumentScope")
  const projectId = parseProjectId(value.projectId)
  const projectEpoch = parseId128(value.projectEpoch)
  const shardEpoch = parseId128(value.shardEpoch)
  if (value.docKind === "project-index") {
    if (value.docId !== "project-index") failCodec("ProjectIndex scope requires docId project-index")
    return Object.freeze({ projectId, projectEpoch, docKind: "project-index", docId: "project-index", shardEpoch })
  }
  if (value.docKind !== "canvas") failCodec("DocumentScope docKind is invalid")
  return Object.freeze({ projectId, projectEpoch, docKind: "canvas", docId: parseCanvasId(value.docId), shardEpoch })
}

export function parsePortableStamp(value: unknown): PortableStamp {
  assertExactKeys(value, ["format", "lamport", "actorId", "operationId", "writeOrdinal"], "PortableStamp")
  if (value.format !== "convax.portable-stamp") failCodec("PortableStamp format is invalid")
  return Object.freeze({
    format: value.format,
    lamport: parseUint64(value.lamport),
    actorId: parseActorId(value.actorId),
    operationId: parseId128(value.operationId),
    writeOrdinal: parseUint32(value.writeOrdinal),
  })
}

export function parseCausalHeadRef(value: unknown): CausalHeadRef {
  assertExactKeys(value, ["format", "actorId", "actorSequence", "frameDigest", "lamport"], "CausalHeadRef")
  if (value.format !== "convax.causal-head-ref") failCodec("CausalHeadRef format is invalid")
  const actorSequence = parseUint64(value.actorSequence)
  if (actorSequence === "0") failCodec("Causal actor sequence starts at one")
  return Object.freeze({
    format: value.format,
    actorId: parseActorId(value.actorId),
    actorSequence,
    frameDigest: parseDigest(value.frameDigest),
    lamport: parseUint64(value.lamport),
  })
}

export function parseCausalFrontier(value: unknown): CausalFrontier {
  assertExactKeys(value, ["format", "heads"], "CausalFrontier")
  if (value.format !== "convax.causal-frontier") failCodec("CausalFrontier format is invalid")
  assertDenseArray(value.heads, "CausalFrontier heads")
  if (value.heads.length > KERNEL_LIMITS.causalFrontierHeads) failCodec("Causal frontier exceeds 256 heads")
  const heads = value.heads.map(parseCausalHeadRef)
  assertStrictlySorted(heads, (left, right) => compareDecoded(left.actorId, right.actorId), "Causal frontier heads")
  return Object.freeze({ format: value.format, heads: Object.freeze(heads) })
}

export function parseReplicaActorHeadSet(value: unknown): ReplicaActorHeadSet {
  assertExactKeys(value, ["format", "scope", "heads"], "ReplicaActorHeadSet")
  if (value.format !== "convax.replica-actor-head-set") failCodec("ReplicaActorHeadSet format is invalid")
  assertDenseArray(value.heads, "ReplicaActorHeadSet heads")
  if (value.heads.length > KERNEL_LIMITS.causalFrontierHeads) failCodec("Replica actor heads exceed 256")
  const heads = value.heads.map(parseCausalHeadRef)
  assertStrictlySorted(heads, (left, right) => compareDecoded(left.actorId, right.actorId), "ReplicaActorHeadSet heads")
  return Object.freeze({ format: value.format, scope: parseDocumentScope(value.scope), heads: Object.freeze(heads) })
}

export function parseCausalContext(value: unknown): CausalContext {
  assertExactKeys(value, [
    "format", "scope", "baseFrontier", "baseFrontierDigest", "baseStateVectorDigest",
    "baseCanonicalStateDigest", "signerAuthority", "dependencies", "validationArtifactSetDigest",
  ], "CausalContext")
  if (value.format !== "convax.causal-context") failCodec("CausalContext format is invalid")
  assertDenseArray(value.dependencies, "CausalContext dependencies")
  if (value.dependencies.length > KERNEL_LIMITS.causalDependencyRefs) failCodec("Causal dependencies exceed 256 refs")
  const dependencies = value.dependencies.map(parseDependency)
  assertStrictlySorted(dependencies, compareDependency, "Causal dependencies")
  const signerAuthority = parseSignerAuthority(value.signerAuthority)
  requireDependency(dependencies, "membership-snapshot", signerAuthority.membershipSnapshotDigest)
  requireDependency(dependencies, "replica-actor-credential", signerAuthority.replicaActorCredentialCoreDigest)
  requireDependency(dependencies, "replica-edit-authorization", signerAuthority.replicaEditAuthorizationCoreDigest)
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScope(value.scope),
    baseFrontier: parseCausalFrontier(value.baseFrontier),
    baseFrontierDigest: parseDigest(value.baseFrontierDigest),
    baseStateVectorDigest: parseDigest(value.baseStateVectorDigest),
    baseCanonicalStateDigest: parseDigest(value.baseCanonicalStateDigest),
    signerAuthority,
    dependencies: Object.freeze(dependencies),
    validationArtifactSetDigest: parseDigest(value.validationArtifactSetDigest),
  })
}

export function parseActualWriteEvidence(value: unknown): ActualWriteEvidence {
  assertExactKeys(value, ["format", "scope", "owner", "ownerSchemaDigest", "intentDigest", "changedPaths", "writes"], "ActualWriteEvidence")
  if (value.format !== "convax.actual-write-evidence") failCodec("ActualWriteEvidence format is invalid")
  if (value.owner !== "project-index" && value.owner !== "canvas") failCodec("ActualWriteEvidence owner is invalid")
  assertDenseArray(value.changedPaths, "ActualWriteEvidence changedPaths")
  assertDenseArray(value.writes, "ActualWriteEvidence writes")
  if (value.changedPaths.length > KERNEL_LIMITS.changedPaths || value.writes.length > KERNEL_LIMITS.writes) {
    failCodec("ActualWriteEvidence exceeds the kernel outer count limits")
  }
  const changedPaths = value.changedPaths.map((path, index) => {
    assertBoundedNfcString(path, 1, KERNEL_LIMITS.oneChangedPathUtf8Bytes, `changedPaths[${index}]`)
    return path
  })
  assertStrictlySorted(changedPaths, compareUtf8, "ActualWriteEvidence changedPaths")
  const writes = value.writes.map(parseActualWrite)
  assertStrictlySorted(writes, compareActualWrite, "ActualWriteEvidence writes")
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScope(value.scope),
    owner: value.owner,
    ownerSchemaDigest: parseDigest(value.ownerSchemaDigest),
    intentDigest: parseDigest(value.intentDigest),
    changedPaths: Object.freeze(changedPaths),
    writes: Object.freeze(writes),
  })
}

export function parseValidationArtifactSet(value: unknown): ValidationArtifactSet {
  assertExactKeys(value, ["format", "artifacts"], "ValidationArtifactSet")
  if (value.format !== "convax.validation-artifact-set") failCodec("ValidationArtifactSet format is invalid")
  assertDenseArray(value.artifacts, "ValidationArtifactSet artifacts")
  if (value.artifacts.length > KERNEL_LIMITS.validationArtifactRefs) failCodec("Validation artifacts exceed 64 refs")
  const artifacts = value.artifacts.map(parseValidationArtifact)
  assertStrictlySorted(artifacts, compareValidationArtifact, "ValidationArtifactSet artifacts")
  return Object.freeze({ format: value.format, artifacts: Object.freeze(artifacts) })
}

export function parseCausalEditCore(value: unknown): CausalEditCore {
  assertExactKeys(value, CORE_KEYS, "CausalEditCore")
  if (value.format !== "convax.causal-edit-core") failFrame("CausalEditCore format is invalid")
  const actorSequence = parseUint64(value.actorSequence)
  if (actorSequence === "0") failFrame("Causal edit actor sequence starts at one")
  if (value.predecessorFrameDigest !== null && typeof value.predecessorFrameDigest !== "string") failFrame("Causal predecessor is invalid")
  assertBoundedNfcString(value.intentKind, 1, 128, "Causal intentKind")
  if (!/^[\x20-\x7e]+$/u.test(value.intentKind)) failFrame("Causal intentKind must be ASCII")
  const protocolDigest = parseDigest(value.protocolDigest)
  if (protocolDigest !== CURRENT_PROTOCOL_IDENTITIES.protocolDigest) failFrame("Causal edit protocol digest is not the current protocol digest")
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScope(value.scope),
    actorId: parseActorId(value.actorId),
    actorSequence,
    predecessorFrameDigest: value.predecessorFrameDigest === null ? null : parseDigest(value.predecessorFrameDigest),
    operationId: parseId128(value.operationId),
    lamport: parseUint64(value.lamport),
    intentKind: value.intentKind,
    intentDigest: parseDigest(value.intentDigest),
    causalContextDigest: parseDigest(value.causalContextDigest),
    baseFrontierDigest: parseDigest(value.baseFrontierDigest),
    baseStateVectorDigest: parseDigest(value.baseStateVectorDigest),
    baseCanonicalStateDigest: parseDigest(value.baseCanonicalStateDigest),
    yjsUpdateDigest: parseDigest(value.yjsUpdateDigest),
    postStateVectorDigest: parseDigest(value.postStateVectorDigest),
    postCanonicalStateDigest: parseDigest(value.postCanonicalStateDigest),
    actualWriteEvidenceDigest: parseDigest(value.actualWriteEvidenceDigest),
    typedIntentJcsByteLength: parseUint64(value.typedIntentJcsByteLength),
    causalContextJcsByteLength: parseUint64(value.causalContextJcsByteLength),
    baseStateVectorByteLength: parseUint64(value.baseStateVectorByteLength),
    yjsUpdateByteLength: parseUint64(value.yjsUpdateByteLength),
    actualWriteEvidenceJcsByteLength: parseUint64(value.actualWriteEvidenceJcsByteLength),
    protocolDigest,
    ownerSchemaDigest: parseDigest(value.ownerSchemaDigest),
    canonicalizerDigest: parseDigest(value.canonicalizerDigest),
    validationArtifactSetDigest: parseDigest(value.validationArtifactSetDigest),
    membershipSnapshotDigest: parseDigest(value.membershipSnapshotDigest),
    replicaActorCredentialCoreDigest: parseDigest(value.replicaActorCredentialCoreDigest),
    replicaEditAuthorizationCoreDigest: parseDigest(value.replicaEditAuthorizationCoreDigest),
  })
}

export function parseCausalEditFrameHeader(value: unknown): CausalEditFrameHeader {
  assertExactKeys(value, ["format", "core", "coreDigest", "replicaSignature"], "CausalEditFrameHeader")
  if (value.format !== "convax.causal-edit-frame") failFrame("Causal edit frame header format is invalid")
  return Object.freeze({
    format: value.format,
    core: parseCausalEditCore(value.core),
    coreDigest: parseDigest(value.coreDigest),
    replicaSignature: parseSignature(value.replicaSignature),
  })
}

export function assertSameScope(left: DocumentScope, right: DocumentScope, label = "document scope"): void {
  if (left.projectId !== right.projectId || left.projectEpoch !== right.projectEpoch || left.docKind !== right.docKind || left.docId !== right.docId || left.shardEpoch !== right.shardEpoch) {
    failFrame(`${label} fields are not byte-identical`)
  }
}

export function assertCoreSectionLengths(core: CausalEditCore, lengths: readonly number[]): void {
  const fields = [
    core.typedIntentJcsByteLength,
    core.causalContextJcsByteLength,
    core.baseStateVectorByteLength,
    core.yjsUpdateByteLength,
    core.actualWriteEvidenceJcsByteLength,
  ]
  for (let index = 0; index < fields.length; index += 1) {
    if (uint64ToBigInt(fields[index]!) !== BigInt(lengths[index]!)) failFrame("Causal section length differs from its signed core field")
  }
}

function parseSignerAuthority(value: unknown): CausalSignerAuthority {
  assertExactKeys(value, [
    "memberId", "replicaId", "actorId", "memberAuthorizationEpoch", "replicaAuthorizationEpoch",
    "membershipSnapshotDigest", "replicaActorCredentialCoreDigest", "replicaEditAuthorizationCoreDigest",
  ], "CausalSignerAuthority")
  return Object.freeze({
    memberId: parseMemberId(value.memberId),
    replicaId: parseReplicaId(value.replicaId),
    actorId: parseActorId(value.actorId),
    memberAuthorizationEpoch: parseId128(value.memberAuthorizationEpoch),
    replicaAuthorizationEpoch: parseId128(value.replicaAuthorizationEpoch),
    membershipSnapshotDigest: parseDigest(value.membershipSnapshotDigest),
    replicaActorCredentialCoreDigest: parseDigest(value.replicaActorCredentialCoreDigest),
    replicaEditAuthorizationCoreDigest: parseDigest(value.replicaEditAuthorizationCoreDigest),
  })
}

function parseDependency(value: unknown): CausalDependencyRef {
  assertExactKeys(value, ["kind", "digest"], "CausalDependencyRef")
  if (typeof value.kind !== "string" || !DEPENDENCY_KINDS.has(value.kind as CausalDependencyKind)) failCodec("Causal dependency kind is invalid")
  return Object.freeze({ kind: value.kind as CausalDependencyKind, digest: parseDigest(value.digest) })
}

function parseActualWrite(value: unknown): ActualWrite {
  assertExactKeys(value, ["entityKind", "entityId", "field", "valueDigest"], "ActualWrite")
  assertBoundedNfcString(value.entityKind, 1, 64, "ActualWrite entityKind")
  if (!/^[\x21-\x7e]+$/u.test(value.entityKind)) failCodec("ActualWrite entityKind must be an ASCII token")
  assertBoundedNfcString(value.entityId, 1, 256, "ActualWrite entityId")
  assertBoundedNfcString(value.field, 1, 256, "ActualWrite field")
  return Object.freeze({ entityKind: value.entityKind, entityId: value.entityId, field: value.field, valueDigest: parseDigest(value.valueDigest) })
}

function parseValidationArtifact(value: unknown): ValidationArtifactRef {
  assertExactKeys(value, ["owner", "format", "artifactDigest"], "ValidationArtifactRef")
  if (typeof value.owner !== "string" || !ARTIFACT_OWNERS.has(value.owner)) failCodec("Validation artifact owner is invalid")
  assertBoundedNfcString(value.format, 1, 256, "Validation artifact format")
  return Object.freeze({ owner: value.owner as ValidationArtifactRef["owner"], format: value.format, artifactDigest: parseDigest(value.artifactDigest) })
}

function compareDependency(left: CausalDependencyRef, right: CausalDependencyRef): number {
  return compareUtf8(left.kind, right.kind) || compareDecoded(left.digest, right.digest)
}

function compareActualWrite(left: ActualWrite, right: ActualWrite): number {
  return compareUtf8(left.entityKind, right.entityKind) || compareUtf8(left.entityId, right.entityId) || compareUtf8(left.field, right.field) || compareDecoded(left.valueDigest, right.valueDigest)
}

function compareValidationArtifact(left: ValidationArtifactRef, right: ValidationArtifactRef): number {
  return compareUtf8(left.owner, right.owner) || compareUtf8(left.format, right.format) || compareDecoded(left.artifactDigest, right.artifactDigest)
}

function requireDependency(dependencies: readonly CausalDependencyRef[], kind: CausalDependencyKind, digest: string): void {
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
