import type { DigestV2 } from "./codecs"
import { parseDigestV2, parseSignatureV2 } from "./codecs"
import {
  CAUSAL_EDIT_KIND_CODE_V2,
  CAUSAL_EDIT_MAGIC_V2,
  CAUSAL_EDIT_PREFIX_BYTES_V2,
  COLLABORATION_PROTOCOL_MAJOR_V2,
  KERNEL_DIGEST_DOMAINS_V2,
  KERNEL_LIMITS_V2,
} from "./constants"
import type {
  ActualWriteEvidenceV2,
  CausalContextV2,
  CausalEditCoreV2,
  CausalEditFrameHeaderV2,
  CausalEditFrameSectionsV2,
  DecodedCausalEditFrameV2,
} from "./contracts"
import type { ReplicaSignerPortV2 } from "./crypto"
import { ordinarySha256V2, rawDomainDigestV2, structuredDigestV2, hexToBytes } from "./digest"
import { failFrame } from "./errors"
import { assertByteLengthV2, assertUint8ArrayV2, cloneBytesV2, sameBytes } from "./binary"
import { decodeRestrictedJcsV2, encodeRestrictedJcsV2, isPlainDataObject } from "./jcs"
import {
  assertCoreSectionLengthsV2,
  assertSameScopeV2,
  parseActualWriteEvidenceV2,
  parseCausalContextV2,
  parseCausalEditCoreV2,
  parseCausalEditFrameHeaderV2,
} from "./parse"
import { assertVerifiedProtocolAuthorityV2, type VerifiedProtocolAuthorityV2 } from "./authority"
import { parseStateVectorV2, stateVectorDigestV2, yjsUpdateDigestV2 } from "./yjs-codec"
import { causalFrontierDigestV2 } from "./causal"

const MAGIC = new TextEncoder().encode(CAUSAL_EDIT_MAGIC_V2)

export interface EncodeCausalEditFrameInputV2 {
  readonly header: CausalEditFrameHeaderV2
  readonly sections: CausalEditFrameSectionsV2
}

export function causalEditCoreDigestV2(core: CausalEditCoreV2): DigestV2 {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.causalEditCore, parseCausalEditCoreV2(core))
}

export function causalContextDigestV2(context: CausalContextV2): DigestV2 {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.causalContext, parseCausalContextV2(context))
}

export function actualWriteEvidenceDigestV2(evidence: ActualWriteEvidenceV2): DigestV2 {
  return structuredDigestV2(KERNEL_DIGEST_DOMAINS_V2.actualWriteEvidence, parseActualWriteEvidenceV2(evidence))
}

export function typedIntentDigestV2(exactJcs: Uint8Array): DigestV2 {
  validateTypedIntentJcs(exactJcs)
  return rawDomainDigestV2(KERNEL_DIGEST_DOMAINS_V2.typedIntent, exactJcs)
}

export function causalEditSignatureDigestV2(coreDigest: DigestV2 | string): Uint8Array {
  return hexToBytes(rawDomainDigestV2(KERNEL_DIGEST_DOMAINS_V2.causalEditSignature, hexToBytes(parseDigestV2(coreDigest))))
}

export async function signCausalEditCoreV2(
  authority: VerifiedProtocolAuthorityV2,
  core: CausalEditCoreV2,
  signer: ReplicaSignerPortV2,
): Promise<CausalEditFrameHeaderV2> {
  assertVerifiedProtocolAuthorityV2(authority)
  const parsedCore = parseCausalEditCoreV2(core)
  const coreDigest = causalEditCoreDigestV2(parsedCore)
  const signature = parseSignatureV2(await signer.sign(causalEditSignatureDigestV2(coreDigest)))
  return Object.freeze({ format: "convax.causal-edit-frame/2", core: parsedCore, coreDigest, replicaSignature: signature })
}

export function encodeCausalEditFrameV2(
  authority: VerifiedProtocolAuthorityV2,
  input: EncodeCausalEditFrameInputV2,
): Uint8Array {
  assertVerifiedProtocolAuthorityV2(authority)
  const header = parseCausalEditFrameHeaderV2(input.header)
  const headerJcs = encodeRestrictedJcsV2(header)
  assertByteLengthV2(headerJcs, 1, KERNEL_LIMITS_V2.causalHeaderJcsBytes, "Causal edit header JCS")
  const payload = encodeCausalPayloadV2(input.sections)
  const total = CAUSAL_EDIT_PREFIX_BYTES_V2 + headerJcs.byteLength + payload.byteLength
  if (!Number.isSafeInteger(total) || total > KERNEL_LIMITS_V2.causalEnvelopeBytes) failFrame("Complete causal envelope exceeds 2 MiB")
  const frame = new Uint8Array(total)
  const view = new DataView(frame.buffer)
  frame.set(MAGIC, 0)
  view.setUint16(8, COLLABORATION_PROTOCOL_MAJOR_V2, false)
  view.setUint8(10, CAUSAL_EDIT_KIND_CODE_V2)
  view.setUint8(11, 0)
  view.setUint32(12, headerJcs.byteLength, false)
  view.setBigUint64(16, BigInt(payload.byteLength), false)
  frame.set(hexToBytes(ordinarySha256V2(headerJcs)), 24)
  frame.set(hexToBytes(ordinarySha256V2(payload)), 56)
  frame.set(headerJcs, CAUSAL_EDIT_PREFIX_BYTES_V2)
  frame.set(payload, CAUSAL_EDIT_PREFIX_BYTES_V2 + headerJcs.byteLength)
  decodeCausalEditFrameV2(authority, frame)
  return frame
}

export function decodeCausalEditFrameV2(
  authority: VerifiedProtocolAuthorityV2,
  value: Uint8Array,
): DecodedCausalEditFrameV2 {
  assertVerifiedProtocolAuthorityV2(authority)
  assertUint8ArrayV2(value, "Causal edit envelope")
  if (value.byteLength < CAUSAL_EDIT_PREFIX_BYTES_V2 || value.byteLength > KERNEL_LIMITS_V2.causalEnvelopeBytes) {
    failFrame("Causal edit envelope length is invalid")
  }
  if (!sameBytes(value.subarray(0, 8), MAGIC)) failFrame("Causal edit envelope magic is not CVXCOLL2")
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
  if (view.getUint16(8, false) !== COLLABORATION_PROTOCOL_MAJOR_V2) failFrame("Causal edit protocol major is not 2")
  if (view.getUint8(10) !== CAUSAL_EDIT_KIND_CODE_V2) failFrame("Causal edit kind code is not 1")
  if (view.getUint8(11) !== 0) failFrame("Causal edit flags must be zero")
  const headerLength = view.getUint32(12, false)
  if (headerLength < 1 || headerLength > KERNEL_LIMITS_V2.causalHeaderJcsBytes) failFrame("Causal header length is invalid")
  const payloadLength64 = view.getBigUint64(16, false)
  if (payloadLength64 > BigInt(Number.MAX_SAFE_INTEGER)) failFrame("Causal payload length overflows")
  const payloadLength = Number(payloadLength64)
  const payloadStart = CAUSAL_EDIT_PREFIX_BYTES_V2 + headerLength
  if (!Number.isSafeInteger(payloadStart + payloadLength) || payloadStart + payloadLength !== value.byteLength) {
    failFrame("Causal edit envelope is truncated or has trailing bytes")
  }
  const headerJcs = value.subarray(CAUSAL_EDIT_PREFIX_BYTES_V2, payloadStart)
  const payload = value.subarray(payloadStart)
  if (!sameBytes(hexToBytes(ordinarySha256V2(headerJcs)), value.subarray(24, 56)) || !sameBytes(hexToBytes(ordinarySha256V2(payload)), value.subarray(56, 88))) {
    failFrame("Causal edit ordinary header or payload SHA-256 mismatches")
  }
  const header = parseCausalEditFrameHeaderV2(decodeRestrictedJcsV2(headerJcs))
  const sections = decodeCausalPayloadV2(payload)
  const context = parseCausalContextV2(decodeRestrictedJcsV2(sections.causalContextJcs))
  const evidence = parseActualWriteEvidenceV2(decodeRestrictedJcsV2(sections.actualWriteEvidenceJcs))
  validateFrameClosure(header, sections, context, evidence)
  const bytes = cloneBytesV2(value)
  return Object.freeze({
    bytes,
    frameDigest: rawDomainDigestV2(KERNEL_DIGEST_DOMAINS_V2.causalEditFrameDigest, bytes),
    header,
    headerJcs: cloneBytesV2(headerJcs),
    payload: cloneBytesV2(payload),
    context,
    evidence,
    sections,
  })
}

export function encodeCausalPayloadV2(sections: CausalEditFrameSectionsV2): Uint8Array {
  validateSections(sections)
  const ordered = [sections.typedIntentJcs, sections.causalContextJcs, sections.baseStateVector, sections.yjsUpdate, sections.actualWriteEvidenceJcs]
  const total = ordered.reduce((sum, section) => sum + 4 + section.byteLength, 0)
  if (!Number.isSafeInteger(total) || total > KERNEL_LIMITS_V2.causalEnvelopeBytes - CAUSAL_EDIT_PREFIX_BYTES_V2) failFrame("Causal five-section payload exceeds its outer bound")
  const result = new Uint8Array(total)
  const view = new DataView(result.buffer)
  let offset = 0
  for (const section of ordered) {
    view.setUint32(offset, section.byteLength, false)
    offset += 4
    result.set(section, offset)
    offset += section.byteLength
  }
  return result
}

export function decodeCausalPayloadV2(payload: Uint8Array): CausalEditFrameSectionsV2 {
  assertUint8ArrayV2(payload, "Causal payload")
  let offset = 0
  const sections: Uint8Array[] = []
  for (let index = 0; index < 5; index += 1) {
    if (offset + 4 > payload.byteLength) failFrame("Causal payload section length is truncated")
    const length = new DataView(payload.buffer, payload.byteOffset + offset, 4).getUint32(0, false)
    offset += 4
    if (offset + length > payload.byteLength) failFrame("Causal payload section is truncated")
    sections.push(cloneBytesV2(payload.subarray(offset, offset + length)))
    offset += length
  }
  if (offset !== payload.byteLength) failFrame("Causal payload has a sixth or trailing section")
  const result = Object.freeze({
    typedIntentJcs: sections[0]!,
    causalContextJcs: sections[1]!,
    baseStateVector: parseStateVectorV2(sections[2]!),
    yjsUpdate: sections[3]!,
    actualWriteEvidenceJcs: sections[4]!,
  })
  validateSections(result)
  return result
}

function validateSections(sections: CausalEditFrameSectionsV2): void {
  assertByteLengthV2(sections.typedIntentJcs, 1, KERNEL_LIMITS_V2.typedIntentJcsBytes, "Typed-intent JCS")
  assertByteLengthV2(sections.causalContextJcs, 1, KERNEL_LIMITS_V2.causalContextJcsBytes, "Causal-context JCS")
  parseStateVectorV2(sections.baseStateVector)
  assertByteLengthV2(sections.yjsUpdate, 0, KERNEL_LIMITS_V2.yjsUpdateBytes, "Yjs update-v1 delta")
  assertByteLengthV2(sections.actualWriteEvidenceJcs, 1, KERNEL_LIMITS_V2.actualWriteEvidenceJcsBytes, "Actual-write-evidence JCS")
  validateTypedIntentJcs(sections.typedIntentJcs)
  decodeRestrictedJcsV2(sections.causalContextJcs)
  decodeRestrictedJcsV2(sections.actualWriteEvidenceJcs)
}

function validateFrameClosure(
  header: CausalEditFrameHeaderV2,
  sections: CausalEditFrameSectionsV2,
  context: CausalContextV2,
  evidence: ActualWriteEvidenceV2,
): void {
  const core = header.core
  if (causalEditCoreDigestV2(core) !== header.coreDigest) failFrame("Causal core digest mismatches the exact core")
  assertCoreSectionLengthsV2(core, [
    sections.typedIntentJcs.byteLength,
    sections.causalContextJcs.byteLength,
    sections.baseStateVector.byteLength,
    sections.yjsUpdate.byteLength,
    sections.actualWriteEvidenceJcs.byteLength,
  ])
  const intent = validateTypedIntentJcs(sections.typedIntentJcs)
  assertSameScopeV2(core.scope, context.scope, "Core/context scope")
  assertSameScopeV2(core.scope, evidence.scope, "Core/evidence scope")
  if (
    core.actorId !== context.signerAuthority.actorId ||
    core.intentKind !== intent.kind ||
    core.intentDigest !== typedIntentDigestV2(sections.typedIntentJcs) ||
    core.causalContextDigest !== causalContextDigestV2(context) ||
    core.baseFrontierDigest !== context.baseFrontierDigest ||
    core.baseFrontierDigest !== causalFrontierDigestV2(context.baseFrontier) ||
    core.baseStateVectorDigest !== context.baseStateVectorDigest ||
    core.baseStateVectorDigest !== stateVectorDigestV2(sections.baseStateVector) ||
    core.baseCanonicalStateDigest !== context.baseCanonicalStateDigest ||
    core.yjsUpdateDigest !== yjsUpdateDigestV2(sections.yjsUpdate) ||
    core.actualWriteEvidenceDigest !== actualWriteEvidenceDigestV2(evidence) ||
    core.ownerSchemaDigest !== evidence.ownerSchemaDigest ||
    core.intentDigest !== evidence.intentDigest ||
    core.validationArtifactSetDigest !== context.validationArtifactSetDigest ||
    core.membershipSnapshotDigest !== context.signerAuthority.membershipSnapshotDigest ||
    core.replicaActorCredentialCoreDigest !== context.signerAuthority.replicaActorCredentialCoreDigest ||
    core.replicaEditAuthorizationCoreDigest !== context.signerAuthority.replicaEditAuthorizationCoreDigest ||
    evidence.owner !== core.scope.docKind
  ) {
    failFrame("Causal core/context/payload duplicate fields are not byte-identical")
  }
}

function validateTypedIntentJcs(bytes: Uint8Array): { readonly format: "convax.typed-intent/2"; readonly kind: string } {
  const value = decodeRestrictedJcsV2(bytes)
  if (!isPlainDataObject(value) || value.format !== "convax.typed-intent/2" || typeof value.kind !== "string") {
    failFrame("Typed-intent section lacks the exact format and kind discriminators")
  }
  if (value.kind.length === 0 || new TextEncoder().encode(value.kind).byteLength > 128 || !/^[\x20-\x7e]+$/u.test(value.kind)) {
    failFrame("Typed-intent kind is not bounded NFC ASCII")
  }
  return value as { readonly format: "convax.typed-intent/2"; readonly kind: string }
}
