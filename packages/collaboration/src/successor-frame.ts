import type { DigestV2, SignatureV2, StateVectorV2, Uint64V2 } from "./codecs"
import {
  parseActorIdV2,
  parseDigestV2,
  parseId128V2,
  parseSignatureV2,
  parseUint64V2,
  uint64ToBigIntV2,
} from "./codecs"
import type {
  ActualWriteEvidenceV2,
  CausalDependencyKindV2,
  CausalEditFrameSectionsV2,
  CausalFrontierV2,
  DocumentScopeV2,
} from "./contracts"
import type { ReplicaSignerPortV2 } from "./crypto"
import { ordinarySha256V2 } from "./digest"
import { failCodec, failFrame } from "./errors"
import { assertByteLengthV2, assertUint8ArrayV2, cloneBytesV2, sameBytes } from "./binary"
import {
  assertDenseArrayV2,
  assertExactKeysV2,
  compareUtf8V2,
  decodeRestrictedJcsV2,
  encodeRestrictedJcsV2,
  isPlainDataObject,
} from "./jcs"
import { KERNEL_LIMITS_V2 } from "./constants"
import { parseActualWriteEvidenceV2, parseCausalFrontierV2, parseDocumentScopeV2, assertSameScopeV2 } from "./parse"
import { parseStateVectorV2, stateVectorDigestV2, yjsUpdateDigestV2 } from "./yjs-codec"
import { causalFrontierDigestV2 } from "./causal"
import { decodeCausalEditFrameV2 } from "./frame"
import type { VerifiedProtocolAuthorityV2 } from "./authority"
import {
  parseCausalAuthorityDependenciesV3,
  parseCausalSignerAuthorityV3,
  causalSignerAuthorityDigestV3,
  type CausalAuthorityDependencyKindV3,
  type CausalSignerAuthorityV3,
} from "./successor-authority"

export const SUCCESSOR_CAUSAL_EDIT_MAGIC_V3 = "CVXCOLL3" as const
const MAGIC_V2 = new TextEncoder().encode("CVXCOLL2")
const MAGIC_V3 = new TextEncoder().encode(SUCCESSOR_CAUSAL_EDIT_MAGIC_V3)
const PREFIX_BYTES = 88
const MAJOR = 3
const KIND = 1

const DOMAINS = Object.freeze({
  context: "convax.causal-context/3",
  core: "convax.causal-edit-core/3",
  frame: "convax.causal-edit-frame-digest/3",
  signature: "convax.causal-edit-signature/3",
  typedIntent: "convax.typed-intent/3",
} as const)

export type CausalDependencyKindV3 = CausalDependencyKindV2 | CausalAuthorityDependencyKindV3 | "protocol-promotion-bridge"
export interface CausalDependencyRefV3 {
  readonly kind: CausalDependencyKindV3
  readonly digest: DigestV2
}

export interface CausalContextV3 {
  readonly format: "convax.causal-context/3"
  readonly scope: DocumentScopeV2
  readonly baseFrontier: CausalFrontierV2
  readonly baseFrontierDigest: DigestV2
  readonly baseStateVectorDigest: DigestV2
  readonly baseCanonicalStateDigest: DigestV2
  readonly signerAuthority: CausalSignerAuthorityV3
  readonly dependencies: readonly CausalDependencyRefV3[]
  readonly validationArtifactSetDigest: DigestV2
}

export interface CausalEditCoreV3 {
  readonly format: "convax.causal-edit-core/3"
  readonly scope: DocumentScopeV2
  readonly actorId: ReturnType<typeof parseActorIdV2>
  readonly actorSequence: Uint64V2
  readonly predecessorFrameDigest: DigestV2
  readonly operationId: ReturnType<typeof parseId128V2>
  readonly lamport: Uint64V2
  readonly intentKind: string
  readonly intentDigest: DigestV2
  readonly causalContextDigest: DigestV2
  readonly baseFrontierDigest: DigestV2
  readonly baseStateVectorDigest: DigestV2
  readonly baseCanonicalStateDigest: DigestV2
  readonly yjsUpdateDigest: DigestV2
  readonly postStateVectorDigest: DigestV2
  readonly postCanonicalStateDigest: DigestV2
  readonly actualWriteEvidenceDigest: DigestV2
  readonly typedIntentJcsByteLength: Uint64V2
  readonly causalContextJcsByteLength: Uint64V2
  readonly baseStateVectorByteLength: Uint64V2
  readonly yjsUpdateByteLength: Uint64V2
  readonly actualWriteEvidenceJcsByteLength: Uint64V2
  readonly protocolDigest: DigestV2
  readonly ownerSchemaDigest: DigestV2
  readonly canonicalizerDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly signerAuthorityKind: CausalSignerAuthorityV3["kind"]
  readonly signerAuthorityDigest: DigestV2
}

export interface CausalEditFrameHeaderV3 {
  readonly format: "convax.causal-edit-frame/3"
  readonly core: CausalEditCoreV3
  readonly coreDigest: DigestV2
  readonly replicaSignature: SignatureV2
}
export interface DecodedCausalEditFrameV3 {
  readonly bytes: Uint8Array
  readonly frameDigest: DigestV2
  readonly header: CausalEditFrameHeaderV3
  readonly headerJcs: Uint8Array
  readonly payload: Uint8Array
  readonly context: CausalContextV3
  readonly evidence: ActualWriteEvidenceV2
  readonly sections: CausalEditFrameSectionsV2
}

declare const candidateBrand: unique symbol
declare const verifiedBrand: unique symbol
export interface SuccessorProtocolAuthorityV3 {
  readonly protocolDigest: DigestV2
}
export interface SuccessorProtocolSchemaArtifactRefV3 {
  readonly name: "canvas-schema" | "collaboration-kernel" | "control-plane" | "project-persistence"
  readonly format:
    | "convax.canvas-protocol-schema/3"
    | "convax.collaboration-kernel-protocol-schema/3"
    | "convax.control-plane-protocol-schema/3"
    | "convax.project-persistence-protocol-schema/3"
  readonly artifactDigest: DigestV2
}
export interface HistoricalAuthoritySnapshotMemberV3 {
  readonly path: string
  readonly sha256: DigestV2
}
export interface HistoricalProtocolAuthorityClosureV3 {
  readonly format: "convax.historical-authority-pin/1"
  readonly authorityId: "collaboration-v10"
  readonly revision: "r5"
  readonly activePointerSha256: DigestV2
  readonly manifestSha256: DigestV2
  readonly evidenceSha256: DigestV2
  readonly protocolBundleSha256: DigestV2
  readonly protocolDigest: DigestV2
  readonly snapshot: readonly HistoricalAuthoritySnapshotMemberV3[]
}
export interface CandidateSuccessorProtocolAuthorityV3 {
  readonly protocolDigest: DigestV2
  readonly [candidateBrand]: true
}
export interface VerifiedProtocolAuthorityV3 extends SuccessorProtocolAuthorityV3 {
  readonly format: "convax.protocol-authority-verification/3"
  readonly authorityId: "collaboration-v11"
  readonly revision: "r1"
  readonly sequence: "1"
  readonly historicalAuthorityId: "collaboration-v10/r5"
  readonly protocolBundleSha256: DigestV2
  readonly artifactRefs: readonly SuccessorProtocolSchemaArtifactRefV3[]
  readonly historicalAuthorityPinSha256: DigestV2
  readonly historicalAuthority: HistoricalProtocolAuthorityClosureV3
  readonly [verifiedBrand]: true
}
const candidates = new WeakSet<object>()
const verified = new WeakSet<object>()

/** Test/candidate construction only. Production dispatch never accepts this capability. */
export function createCandidateSuccessorProtocolAuthorityV3(
  protocolDigest: DigestV2,
): CandidateSuccessorProtocolAuthorityV3 {
  const value = Object.freeze({ protocolDigest: parseDigestV2(protocolDigest) })
  candidates.add(value)
  return value as CandidateSuccessorProtocolAuthorityV3
}

/** Called only by the sealed V11 selector after complete release validation. */
export function installVerifiedSuccessorProtocolAuthorityV3(input: {
  readonly protocolDigest: DigestV2
  readonly protocolBundleSha256: DigestV2
  readonly artifactRefs: readonly SuccessorProtocolSchemaArtifactRefV3[]
  readonly historicalAuthorityPinSha256: DigestV2
  readonly historicalAuthority: HistoricalProtocolAuthorityClosureV3
}): VerifiedProtocolAuthorityV3 {
  const value = Object.freeze({
    format: "convax.protocol-authority-verification/3" as const,
    authorityId: "collaboration-v11" as const,
    revision: "r1" as const,
    sequence: "1" as const,
    historicalAuthorityId: "collaboration-v10/r5" as const,
    protocolDigest: parseDigestV2(input.protocolDigest),
    protocolBundleSha256: parseDigestV2(input.protocolBundleSha256),
    artifactRefs: Object.freeze(input.artifactRefs.map((artifact) => Object.freeze({
      name: artifact.name,
      format: artifact.format,
      artifactDigest: parseDigestV2(artifact.artifactDigest),
    }))),
    historicalAuthorityPinSha256: parseDigestV2(input.historicalAuthorityPinSha256),
    historicalAuthority: Object.freeze({
      format: input.historicalAuthority.format,
      authorityId: input.historicalAuthority.authorityId,
      revision: input.historicalAuthority.revision,
      activePointerSha256: parseDigestV2(input.historicalAuthority.activePointerSha256),
      manifestSha256: parseDigestV2(input.historicalAuthority.manifestSha256),
      evidenceSha256: parseDigestV2(input.historicalAuthority.evidenceSha256),
      protocolBundleSha256: parseDigestV2(input.historicalAuthority.protocolBundleSha256),
      protocolDigest: parseDigestV2(input.historicalAuthority.protocolDigest),
      snapshot: Object.freeze(input.historicalAuthority.snapshot.map((member) => Object.freeze({
        path: member.path,
        sha256: parseDigestV2(member.sha256),
      }))),
    }),
  })
  verified.add(value)
  return value as VerifiedProtocolAuthorityV3
}

export function assertSuccessorProtocolAuthorityV3(value: SuccessorProtocolAuthorityV3): void {
  if (!value || (!candidates.has(value as object) && !verified.has(value as object))) {
    failFrame("Successor protocol authority is not a live selected capability")
  }
}

const NON_AUTHORITY_KINDS = new Set<CausalDependencyKindV2>([
  "authorization-mutation",
  "cutoff-coverage-root",
  "checkpoint-content-certificate",
  "project-index-proof",
  "project-resource-proof",
  "plugin-validation-artifact",
  "generation-external-fact",
  "reset-authorization",
])

export function parseCausalContextV3(value: unknown): CausalContextV3 {
  assertExactKeysV2(
    value,
    [
      "format",
      "scope",
      "baseFrontier",
      "baseFrontierDigest",
      "baseStateVectorDigest",
      "baseCanonicalStateDigest",
      "signerAuthority",
      "dependencies",
      "validationArtifactSetDigest",
    ],
    "CausalContextV3",
  )
  if (value.format !== "convax.causal-context/3") failCodec("CausalContextV3 format is invalid")
  const authority = parseCausalSignerAuthorityV3(value.signerAuthority)
  assertDenseArrayV2(value.dependencies, "CausalContextV3 dependencies")
  if (value.dependencies.length > KERNEL_LIMITS_V2.causalDependencyRefs)
    failCodec("Causal dependencies exceed 256 refs")
  const dependencies = value.dependencies.map((entry, index) => {
    assertExactKeysV2(entry, ["kind", "digest"], `CausalDependencyRefV3[${index}]`)
    if (typeof entry.kind !== "string") failCodec("Causal dependency kind is invalid")
    const authorityKind = [
      "local-owner-binding",
      "local-owner-edit-authorization",
      "membership-snapshot",
      "replica-actor-credential",
      "replica-edit-authorization",
    ].includes(entry.kind)
    if (!authorityKind && entry.kind !== "protocol-promotion-bridge" && !NON_AUTHORITY_KINDS.has(entry.kind as CausalDependencyKindV2))
      failCodec("Causal dependency kind is invalid")
    return Object.freeze({ kind: entry.kind as CausalDependencyKindV3, digest: parseDigestV2(entry.digest) })
  })
  for (let index = 1; index < dependencies.length; index += 1) {
    const left = dependencies[index - 1]!,
      right = dependencies[index]!
    if ((compareUtf8V2(left.kind, right.kind) || compareUtf8V2(left.digest, right.digest)) >= 0)
      failCodec("Causal dependencies must be strictly sorted and duplicate-free")
  }
  parseCausalAuthorityDependenciesV3(
    dependencies.filter((dependency) =>
      [
        "local-owner-binding",
        "local-owner-edit-authorization",
        "membership-snapshot",
        "replica-actor-credential",
        "replica-edit-authorization",
      ].includes(dependency.kind),
    ),
    authority,
  )
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScopeV2(value.scope),
    baseFrontier: parseCausalFrontierV2(value.baseFrontier),
    baseFrontierDigest: parseDigestV2(value.baseFrontierDigest),
    baseStateVectorDigest: parseDigestV2(value.baseStateVectorDigest),
    baseCanonicalStateDigest: parseDigestV2(value.baseCanonicalStateDigest),
    signerAuthority: authority,
    dependencies: Object.freeze(dependencies),
    validationArtifactSetDigest: parseDigestV2(value.validationArtifactSetDigest),
  })
}

const CORE_KEYS = [
  "format",
  "scope",
  "actorId",
  "actorSequence",
  "predecessorFrameDigest",
  "operationId",
  "lamport",
  "intentKind",
  "intentDigest",
  "causalContextDigest",
  "baseFrontierDigest",
  "baseStateVectorDigest",
  "baseCanonicalStateDigest",
  "yjsUpdateDigest",
  "postStateVectorDigest",
  "postCanonicalStateDigest",
  "actualWriteEvidenceDigest",
  "typedIntentJcsByteLength",
  "causalContextJcsByteLength",
  "baseStateVectorByteLength",
  "yjsUpdateByteLength",
  "actualWriteEvidenceJcsByteLength",
  "protocolDigest",
  "ownerSchemaDigest",
  "canonicalizerDigest",
  "validationArtifactSetDigest",
  "signerAuthorityKind",
  "signerAuthorityDigest",
] as const

export function parseCausalEditCoreV3(value: unknown, expectedProtocolDigest?: DigestV2): CausalEditCoreV3 {
  assertExactKeysV2(value, CORE_KEYS, "CausalEditCoreV3")
  if (value.format !== "convax.causal-edit-core/3") failFrame("CausalEditCoreV3 format is invalid")
  const actorSequence = parseUint64V2(value.actorSequence)
  if (actorSequence === "0") failFrame("Causal edit actor sequence starts at one")
  if (value.predecessorFrameDigest === null) failFrame("First successor frame must name its signed bridge predecessor")
  if (value.signerAuthorityKind !== "local-project-owner" && value.signerAuthorityKind !== "team-replica")
    failFrame("Causal signer authority kind is invalid")
  if (
    typeof value.intentKind !== "string" ||
    value.intentKind.length === 0 ||
    new TextEncoder().encode(value.intentKind).byteLength > 128 ||
    !/^[\x20-\x7e]+$/u.test(value.intentKind)
  )
    failFrame("Causal intentKind must be bounded ASCII")
  const protocolDigest = parseDigestV2(value.protocolDigest)
  if (expectedProtocolDigest && protocolDigest !== expectedProtocolDigest)
    failFrame("Causal edit protocol digest is not the candidate successor digest")
  return Object.freeze({
    format: value.format,
    scope: parseDocumentScopeV2(value.scope),
    actorId: parseActorIdV2(value.actorId),
    actorSequence,
    predecessorFrameDigest: parseDigestV2(value.predecessorFrameDigest),
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
    signerAuthorityKind: value.signerAuthorityKind,
    signerAuthorityDigest: parseDigestV2(value.signerAuthorityDigest),
  })
}

export function causalContextDigestV3(value: CausalContextV3): DigestV2 {
  return structuredDigest(DOMAINS.context, parseCausalContextV3(value))
}
export function causalEditCoreDigestV3(value: CausalEditCoreV3, protocolDigest?: DigestV2): DigestV2 {
  return structuredDigest(DOMAINS.core, parseCausalEditCoreV3(value, protocolDigest))
}
export function causalEditSignatureDigestV3(coreDigest: DigestV2): Uint8Array {
  return hexToBytes(rawDigest(DOMAINS.signature, hexToBytes(parseDigestV2(coreDigest))))
}

export async function signCausalEditCoreV3(
  authority: SuccessorProtocolAuthorityV3,
  core: CausalEditCoreV3,
  signer: ReplicaSignerPortV2,
): Promise<CausalEditFrameHeaderV3> {
  assertSuccessorProtocolAuthorityV3(authority)
  const parsed = parseCausalEditCoreV3(core, authority.protocolDigest)
  const coreDigest = causalEditCoreDigestV3(parsed, authority.protocolDigest)
  return Object.freeze({
    format: "convax.causal-edit-frame/3",
    core: parsed,
    coreDigest,
    replicaSignature: parseSignatureV2(await signer.sign(causalEditSignatureDigestV3(coreDigest))),
  })
}

export function encodeCausalEditFrameV3(
  authority: SuccessorProtocolAuthorityV3,
  input: { readonly header: CausalEditFrameHeaderV3; readonly sections: CausalEditFrameSectionsV2 },
): Uint8Array {
  assertSuccessorProtocolAuthorityV3(authority)
  const header = parseHeader(input.header, authority.protocolDigest)
  const headerJcs = encodeRestrictedJcsV2(header)
  assertByteLengthV2(headerJcs, 1, KERNEL_LIMITS_V2.causalHeaderJcsBytes, "Causal edit header JCS")
  const payload = encodePayload(input.sections)
  const total = PREFIX_BYTES + headerJcs.byteLength + payload.byteLength
  if (!Number.isSafeInteger(total) || total > KERNEL_LIMITS_V2.causalEnvelopeBytes)
    failFrame("Complete successor causal envelope exceeds 2 MiB")
  const frame = new Uint8Array(total),
    view = new DataView(frame.buffer)
  frame.set(MAGIC_V3)
  view.setUint16(8, MAJOR, false)
  view.setUint8(10, KIND)
  view.setUint8(11, 0)
  view.setUint32(12, headerJcs.byteLength, false)
  view.setBigUint64(16, BigInt(payload.byteLength), false)
  frame.set(hexToBytes(ordinarySha256V2(headerJcs)), 24)
  frame.set(hexToBytes(ordinarySha256V2(payload)), 56)
  frame.set(headerJcs, PREFIX_BYTES)
  frame.set(payload, PREFIX_BYTES + headerJcs.byteLength)
  decodeCausalEditFrameV3(authority, frame)
  return frame
}

export function decodeCausalEditFrameV3(
  authority: SuccessorProtocolAuthorityV3,
  value: Uint8Array,
): DecodedCausalEditFrameV3 {
  assertSuccessorProtocolAuthorityV3(authority)
  assertUint8ArrayV2(value, "Successor causal edit envelope")
  if (value.byteLength < PREFIX_BYTES || value.byteLength > KERNEL_LIMITS_V2.causalEnvelopeBytes)
    failFrame("Successor causal edit envelope length is invalid")
  if (!sameBytes(value.subarray(0, 8), MAGIC_V3)) failFrame("Causal edit envelope magic is not CVXCOLL3")
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
  if (view.getUint16(8, false) !== MAJOR || view.getUint8(10) !== KIND || view.getUint8(11) !== 0)
    failFrame("Successor causal envelope prefix is invalid")
  const headerLength = view.getUint32(12, false),
    payload64 = view.getBigUint64(16, false)
  if (
    headerLength < 1 ||
    headerLength > KERNEL_LIMITS_V2.causalHeaderJcsBytes ||
    payload64 > BigInt(Number.MAX_SAFE_INTEGER)
  )
    failFrame("Successor causal envelope section length is invalid")
  const start = PREFIX_BYTES + headerLength,
    payloadLength = Number(payload64)
  if (!Number.isSafeInteger(start + payloadLength) || start + payloadLength !== value.byteLength)
    failFrame("Successor causal envelope is truncated or has trailing bytes")
  const headerJcs = value.subarray(PREFIX_BYTES, start),
    payload = value.subarray(start)
  if (
    !sameBytes(hexToBytes(ordinarySha256V2(headerJcs)), value.subarray(24, 56)) ||
    !sameBytes(hexToBytes(ordinarySha256V2(payload)), value.subarray(56, 88))
  )
    failFrame("Successor causal ordinary SHA-256 mismatches")
  const header = parseHeader(decodeRestrictedJcsV2(headerJcs), authority.protocolDigest),
    sections = decodePayload(payload),
    context = parseCausalContextV3(decodeRestrictedJcsV2(sections.causalContextJcs)),
    evidence = parseActualWriteEvidenceV2(decodeRestrictedJcsV2(sections.actualWriteEvidenceJcs))
  validateClosure(header, sections, context, evidence)
  const bytes = cloneBytesV2(value)
  return Object.freeze({
    bytes,
    frameDigest: rawDigest(DOMAINS.frame, bytes),
    header,
    headerJcs: cloneBytesV2(headerJcs),
    payload: cloneBytesV2(payload),
    context,
    evidence,
    sections,
  })
}

/** Production reader: V2 is live; V3 remains a fixed fail-closed branch until a sealed successor selector exists. */
export function decodeSelectedCausalEditFrame(value: Uint8Array, authorityV2: VerifiedProtocolAuthorityV2) {
  assertUint8ArrayV2(value, "Causal edit envelope")
  if (value.byteLength < 8 || value.byteLength > KERNEL_LIMITS_V2.causalEnvelopeBytes)
    failFrame("Causal edit envelope outer bound is invalid")
  const magic = value.subarray(0, 8)
  if (sameBytes(magic, MAGIC_V2))
    return Object.freeze({ version: 2 as const, frame: decodeCausalEditFrameV2(authorityV2, value) })
  if (sameBytes(magic, MAGIC_V3)) failFrame("Successor protocol schema bundle is unavailable")
  failFrame("Unknown causal edit envelope version")
}

function parseHeader(value: unknown, protocolDigest: DigestV2): CausalEditFrameHeaderV3 {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "replicaSignature"], "CausalEditFrameHeaderV3")
  if (value.format !== "convax.causal-edit-frame/3") failFrame("Successor causal edit frame header format is invalid")
  return Object.freeze({
    format: value.format,
    core: parseCausalEditCoreV3(value.core, protocolDigest),
    coreDigest: parseDigestV2(value.coreDigest),
    replicaSignature: parseSignatureV2(value.replicaSignature),
  })
}
function validateTypedIntent(bytes: Uint8Array) {
  const value = decodeRestrictedJcsV2(bytes)
  if (
    !isPlainDataObject(value) ||
    value.format !== "convax.typed-intent/2" ||
    typeof value.kind !== "string" ||
    value.kind.length === 0 ||
    new TextEncoder().encode(value.kind).byteLength > 128 ||
    !/^[\x20-\x7e]+$/u.test(value.kind)
  )
    failFrame("Successor typed intent is invalid")
  return value as { readonly kind: string }
}
export function typedIntentDigestV3(bytes: Uint8Array): DigestV2 {
  validateTypedIntent(bytes)
  return rawDigest(DOMAINS.typedIntent, bytes)
}
export function actualWriteEvidenceDigestV3(value: ActualWriteEvidenceV2): DigestV2 {
  return structuredDigest("convax.actual-write-evidence/2", parseActualWriteEvidenceV2(value))
}
function validateSections(value: CausalEditFrameSectionsV2): void {
  assertByteLengthV2(value.typedIntentJcs, 1, KERNEL_LIMITS_V2.typedIntentJcsBytes, "Typed-intent JCS")
  assertByteLengthV2(value.causalContextJcs, 1, KERNEL_LIMITS_V2.causalContextJcsBytes, "Causal-context JCS")
  parseStateVectorV2(value.baseStateVector)
  assertByteLengthV2(value.yjsUpdate, 0, KERNEL_LIMITS_V2.yjsUpdateBytes, "Yjs update-v1 delta")
  assertByteLengthV2(
    value.actualWriteEvidenceJcs,
    1,
    KERNEL_LIMITS_V2.actualWriteEvidenceJcsBytes,
    "Actual-write-evidence JCS",
  )
  validateTypedIntent(value.typedIntentJcs)
  decodeRestrictedJcsV2(value.causalContextJcs)
  decodeRestrictedJcsV2(value.actualWriteEvidenceJcs)
}
function encodePayload(value: CausalEditFrameSectionsV2): Uint8Array {
  validateSections(value)
  const sections = [
      value.typedIntentJcs,
      value.causalContextJcs,
      value.baseStateVector,
      value.yjsUpdate,
      value.actualWriteEvidenceJcs,
    ],
    total = sections.reduce((sum, section) => sum + 4 + section.byteLength, 0)
  if (!Number.isSafeInteger(total) || total > KERNEL_LIMITS_V2.causalEnvelopeBytes - PREFIX_BYTES)
    failFrame("Successor causal payload exceeds its outer bound")
  const result = new Uint8Array(total),
    view = new DataView(result.buffer)
  let offset = 0
  for (const section of sections) {
    view.setUint32(offset, section.byteLength, false)
    offset += 4
    result.set(section, offset)
    offset += section.byteLength
  }
  return result
}
function decodePayload(payload: Uint8Array): CausalEditFrameSectionsV2 {
  let offset = 0
  const sections: Uint8Array[] = []
  for (let index = 0; index < 5; index += 1) {
    if (offset + 4 > payload.byteLength) failFrame("Successor causal payload section length is truncated")
    const length = new DataView(payload.buffer, payload.byteOffset + offset, 4).getUint32(0, false)
    offset += 4
    if (offset + length > payload.byteLength) failFrame("Successor causal payload section is truncated")
    sections.push(cloneBytesV2(payload.subarray(offset, offset + length)))
    offset += length
  }
  if (offset !== payload.byteLength) failFrame("Successor causal payload has trailing section")
  const result = Object.freeze({
    typedIntentJcs: sections[0]!,
    causalContextJcs: sections[1]!,
    baseStateVector: parseStateVectorV2(sections[2]!) as StateVectorV2,
    yjsUpdate: sections[3]!,
    actualWriteEvidenceJcs: sections[4]!,
  })
  validateSections(result)
  return result
}
function validateClosure(
  header: CausalEditFrameHeaderV3,
  sections: CausalEditFrameSectionsV2,
  context: CausalContextV3,
  evidence: ActualWriteEvidenceV2,
): void {
  const core = header.core
  if (causalEditCoreDigestV3(core, core.protocolDigest) !== header.coreDigest)
    failFrame("Successor causal core digest mismatches")
  const lengths = [
      sections.typedIntentJcs.byteLength,
      sections.causalContextJcs.byteLength,
      sections.baseStateVector.byteLength,
      sections.yjsUpdate.byteLength,
      sections.actualWriteEvidenceJcs.byteLength,
    ],
    fields = [
      core.typedIntentJcsByteLength,
      core.causalContextJcsByteLength,
      core.baseStateVectorByteLength,
      core.yjsUpdateByteLength,
      core.actualWriteEvidenceJcsByteLength,
    ]
  fields.forEach((field, index) => {
    if (uint64ToBigIntV2(field) !== BigInt(lengths[index]!))
      failFrame("Successor causal section length differs from signed core")
  })
  const intent = validateTypedIntent(sections.typedIntentJcs)
  assertSameScopeV2(core.scope, context.scope, "Core/context scope")
  assertSameScopeV2(core.scope, evidence.scope, "Core/evidence scope")
  if (
    core.actorId !== context.signerAuthority.actorId ||
    core.signerAuthorityKind !== context.signerAuthority.kind ||
    core.signerAuthorityDigest !== causalSignerAuthorityDigestV3(context.signerAuthority) ||
    core.intentKind !== intent.kind ||
    core.intentDigest !== typedIntentDigestV3(sections.typedIntentJcs) ||
    core.causalContextDigest !== causalContextDigestV3(context) ||
    core.baseFrontierDigest !== context.baseFrontierDigest ||
    core.baseFrontierDigest !== causalFrontierDigestV2(context.baseFrontier) ||
    core.baseStateVectorDigest !== context.baseStateVectorDigest ||
    core.baseStateVectorDigest !== stateVectorDigestV2(sections.baseStateVector) ||
    core.baseCanonicalStateDigest !== context.baseCanonicalStateDigest ||
    core.yjsUpdateDigest !== yjsUpdateDigestV2(sections.yjsUpdate) ||
    core.actualWriteEvidenceDigest !== actualWriteEvidenceDigestV3(evidence) ||
    core.ownerSchemaDigest !== evidence.ownerSchemaDigest ||
    core.intentDigest !== evidence.intentDigest ||
    core.validationArtifactSetDigest !== context.validationArtifactSetDigest ||
    evidence.owner !== core.scope.docKind
  )
    failFrame("Successor causal core/context/payload closure mismatches")
}
function structuredDigest(domain: string, value: unknown): DigestV2 {
  const domainBytes = new TextEncoder().encode(domain),
    bytes = encodeRestrictedJcsV2(value),
    input = new Uint8Array(domainBytes.byteLength + 1 + bytes.byteLength)
  input.set(domainBytes)
  input[domainBytes.byteLength] = 0
  input.set(bytes, domainBytes.byteLength + 1)
  return ordinarySha256V2(input)
}
function rawDigest(domain: string, bytes: Uint8Array): DigestV2 {
  const domainBytes = new TextEncoder().encode(domain),
    input = new Uint8Array(domainBytes.byteLength + 1 + bytes.byteLength)
  input.set(domainBytes)
  input[domainBytes.byteLength] = 0
  input.set(bytes, domainBytes.byteLength + 1)
  return ordinarySha256V2(input)
}
function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16))
}
