import type { Digest } from "./codecs"
import { parseDigest, parseSignature } from "./codecs"
import {
  CAUSAL_EDIT_KIND_CODE,
  CAUSAL_EDIT_MAGIC,
  CAUSAL_EDIT_PREFIX_BYTES,
  COLLABORATION_PROTOCOL_MAJOR,
  KERNEL_DIGEST_DOMAINS,
  KERNEL_LIMITS,
} from "./constants"
import type {
  ActualWriteEvidence,
  CausalContext,
  CausalEditCore,
  CausalEditFrameHeader,
  CausalEditFrameSections,
  DecodedCausalEditFrame,
} from "./contracts"
import type { ReplicaSignerPort } from "./crypto"
import { ordinarySha256, rawDomainDigest, structuredDigest, hexToBytes } from "./digest"
import { failFrame } from "./errors"
import { assertByteLength, assertUint8Array, cloneBytes, sameBytes } from "./binary"
import { decodeRestrictedJcs, encodeRestrictedJcs, isPlainDataObject } from "./jcs"
import {
  assertCoreSectionLengths,
  assertSameScope,
  parseActualWriteEvidence,
  parseCausalContext,
  parseCausalEditCore,
  parseCausalEditFrameHeader,
  causalSignerAuthorityDigest,
} from "./parse"
import { assertCurrentProtocolAuthority, type CurrentProtocolAuthority } from "./authority"
import { parseStateVector, stateVectorDigest, yjsUpdateDigest } from "./yjs-codec"
import { causalFrontierDigest } from "./causal"

const MAGIC = (() => {
  const raw = new TextEncoder().encode(CAUSAL_EDIT_MAGIC)
  if (raw.byteLength === 0 || raw.byteLength > 8) {
    throw new TypeError("Causal edit magic must be 1..8 UTF-8 bytes")
  }
  const bytes = new Uint8Array(8)
  bytes.set(raw)
  return bytes
})()

export interface EncodeCausalEditFrameInput {
  readonly header: CausalEditFrameHeader
  readonly sections: CausalEditFrameSections
}

export function causalEditCoreDigest(core: CausalEditCore): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.causalEditCore, parseCausalEditCore(core))
}

export function causalContextDigest(context: CausalContext): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.causalContext, parseCausalContext(context))
}

export function actualWriteEvidenceDigest(evidence: ActualWriteEvidence): Digest {
  return structuredDigest(KERNEL_DIGEST_DOMAINS.actualWriteEvidence, parseActualWriteEvidence(evidence))
}

export function typedIntentDigest(exactJcs: Uint8Array): Digest {
  validateTypedIntentJcs(exactJcs)
  return rawDomainDigest(KERNEL_DIGEST_DOMAINS.typedIntent, exactJcs)
}

export function causalEditSignatureDigest(coreDigest: Digest | string): Uint8Array {
  return hexToBytes(rawDomainDigest(KERNEL_DIGEST_DOMAINS.causalEditSignature, hexToBytes(parseDigest(coreDigest))))
}

export async function signCausalEditCore(
  authority: CurrentProtocolAuthority,
  core: CausalEditCore,
  signer: ReplicaSignerPort,
): Promise<CausalEditFrameHeader> {
  assertCurrentProtocolAuthority(authority)
  const parsedCore = parseCausalEditCore(core)
  const coreDigest = causalEditCoreDigest(parsedCore)
  const signature = parseSignature(await signer.sign(causalEditSignatureDigest(coreDigest)))
  return Object.freeze({ format: "convax.causal-edit-frame", core: parsedCore, coreDigest, replicaSignature: signature })
}

export function encodeCausalEditFrame(
  authority: CurrentProtocolAuthority,
  input: EncodeCausalEditFrameInput,
): Uint8Array {
  assertCurrentProtocolAuthority(authority)
  const header = parseCausalEditFrameHeader(input.header)
  const headerJcs = encodeRestrictedJcs(header)
  assertByteLength(headerJcs, 1, KERNEL_LIMITS.causalHeaderJcsBytes, "Causal edit header JCS")
  const payload = encodeCausalPayload(input.sections)
  const total = CAUSAL_EDIT_PREFIX_BYTES + headerJcs.byteLength + payload.byteLength
  if (!Number.isSafeInteger(total) || total > KERNEL_LIMITS.causalEnvelopeBytes) failFrame("Complete causal envelope exceeds 2 MiB")
  const frame = new Uint8Array(total)
  const view = new DataView(frame.buffer)
  frame.set(MAGIC, 0)
  view.setUint16(8, COLLABORATION_PROTOCOL_MAJOR, false)
  view.setUint8(10, CAUSAL_EDIT_KIND_CODE)
  view.setUint8(11, 0)
  view.setUint32(12, headerJcs.byteLength, false)
  view.setBigUint64(16, BigInt(payload.byteLength), false)
  frame.set(hexToBytes(ordinarySha256(headerJcs)), 24)
  frame.set(hexToBytes(ordinarySha256(payload)), 56)
  frame.set(headerJcs, CAUSAL_EDIT_PREFIX_BYTES)
  frame.set(payload, CAUSAL_EDIT_PREFIX_BYTES + headerJcs.byteLength)
  decodeCausalEditFrame(authority, frame)
  return frame
}

export function decodeCausalEditFrame(
  authority: CurrentProtocolAuthority,
  value: Uint8Array,
): DecodedCausalEditFrame {
  assertCurrentProtocolAuthority(authority)
  assertUint8Array(value, "Causal edit envelope")
  if (value.byteLength < CAUSAL_EDIT_PREFIX_BYTES || value.byteLength > KERNEL_LIMITS.causalEnvelopeBytes) {
    failFrame("Causal edit envelope length is invalid")
  }
  if (!sameBytes(value.subarray(0, 8), MAGIC)) failFrame("Causal edit envelope magic is not CVXCOLL")
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
  if (view.getUint16(8, false) !== COLLABORATION_PROTOCOL_MAJOR) failFrame("Causal edit protocol major is not 2")
  if (view.getUint8(10) !== CAUSAL_EDIT_KIND_CODE) failFrame("Causal edit kind code is not 1")
  if (view.getUint8(11) !== 0) failFrame("Causal edit flags must be zero")
  const headerLength = view.getUint32(12, false)
  if (headerLength < 1 || headerLength > KERNEL_LIMITS.causalHeaderJcsBytes) failFrame("Causal header length is invalid")
  const payloadLength64 = view.getBigUint64(16, false)
  if (payloadLength64 > BigInt(Number.MAX_SAFE_INTEGER)) failFrame("Causal payload length overflows")
  const payloadLength = Number(payloadLength64)
  const payloadStart = CAUSAL_EDIT_PREFIX_BYTES + headerLength
  if (!Number.isSafeInteger(payloadStart + payloadLength) || payloadStart + payloadLength !== value.byteLength) {
    failFrame("Causal edit envelope is truncated or has trailing bytes")
  }
  const headerJcs = value.subarray(CAUSAL_EDIT_PREFIX_BYTES, payloadStart)
  const payload = value.subarray(payloadStart)
  if (!sameBytes(hexToBytes(ordinarySha256(headerJcs)), value.subarray(24, 56)) || !sameBytes(hexToBytes(ordinarySha256(payload)), value.subarray(56, 88))) {
    failFrame("Causal edit ordinary header or payload SHA-256 mismatches")
  }
  const header = parseCausalEditFrameHeader(decodeRestrictedJcs(headerJcs))
  const sections = decodeCausalPayload(payload)
  const context = parseCausalContext(decodeRestrictedJcs(sections.causalContextJcs))
  const evidence = parseActualWriteEvidence(decodeRestrictedJcs(sections.actualWriteEvidenceJcs))
  validateFrameClosure(header, sections, context, evidence)
  const bytes = cloneBytes(value)
  return Object.freeze({
    bytes,
    frameDigest: rawDomainDigest(KERNEL_DIGEST_DOMAINS.causalEditFrameDigest, bytes),
    header,
    headerJcs: cloneBytes(headerJcs),
    payload: cloneBytes(payload),
    context,
    evidence,
    sections,
  })
}

export function encodeCausalPayload(sections: CausalEditFrameSections): Uint8Array {
  validateSections(sections)
  const ordered = [sections.typedIntentJcs, sections.causalContextJcs, sections.baseStateVector, sections.yjsUpdate, sections.actualWriteEvidenceJcs]
  const total = ordered.reduce((sum, section) => sum + 4 + section.byteLength, 0)
  if (!Number.isSafeInteger(total) || total > KERNEL_LIMITS.causalEnvelopeBytes - CAUSAL_EDIT_PREFIX_BYTES) failFrame("Causal five-section payload exceeds its outer bound")
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

export function decodeCausalPayload(payload: Uint8Array): CausalEditFrameSections {
  assertUint8Array(payload, "Causal payload")
  let offset = 0
  const sections: Uint8Array[] = []
  for (let index = 0; index < 5; index += 1) {
    if (offset + 4 > payload.byteLength) failFrame("Causal payload section length is truncated")
    const length = new DataView(payload.buffer, payload.byteOffset + offset, 4).getUint32(0, false)
    offset += 4
    if (offset + length > payload.byteLength) failFrame("Causal payload section is truncated")
    sections.push(cloneBytes(payload.subarray(offset, offset + length)))
    offset += length
  }
  if (offset !== payload.byteLength) failFrame("Causal payload has a sixth or trailing section")
  const result = Object.freeze({
    typedIntentJcs: sections[0]!,
    causalContextJcs: sections[1]!,
    baseStateVector: parseStateVector(sections[2]!),
    yjsUpdate: sections[3]!,
    actualWriteEvidenceJcs: sections[4]!,
  })
  validateSections(result)
  return result
}

function validateSections(sections: CausalEditFrameSections): void {
  assertByteLength(sections.typedIntentJcs, 1, KERNEL_LIMITS.typedIntentJcsBytes, "Typed-intent JCS")
  assertByteLength(sections.causalContextJcs, 1, KERNEL_LIMITS.causalContextJcsBytes, "Causal-context JCS")
  parseStateVector(sections.baseStateVector)
  assertByteLength(sections.yjsUpdate, 0, KERNEL_LIMITS.yjsUpdateBytes, "Yjs update-v1 delta")
  assertByteLength(sections.actualWriteEvidenceJcs, 1, KERNEL_LIMITS.actualWriteEvidenceJcsBytes, "Actual-write-evidence JCS")
  validateTypedIntentJcs(sections.typedIntentJcs)
  decodeRestrictedJcs(sections.causalContextJcs)
  decodeRestrictedJcs(sections.actualWriteEvidenceJcs)
}

function validateFrameClosure(
  header: CausalEditFrameHeader,
  sections: CausalEditFrameSections,
  context: CausalContext,
  evidence: ActualWriteEvidence,
): void {
  const core = header.core
  if (causalEditCoreDigest(core) !== header.coreDigest) failFrame("Causal core digest mismatches the exact core")
  assertCoreSectionLengths(core, [
    sections.typedIntentJcs.byteLength,
    sections.causalContextJcs.byteLength,
    sections.baseStateVector.byteLength,
    sections.yjsUpdate.byteLength,
    sections.actualWriteEvidenceJcs.byteLength,
  ])
  const intent = validateTypedIntentJcs(sections.typedIntentJcs)
  assertSameScope(core.scope, context.scope, "Core/context scope")
  assertSameScope(core.scope, evidence.scope, "Core/evidence scope")
  if (
    core.actorId !== context.signerAuthority.actorId ||
    core.intentKind !== intent.kind ||
    core.intentDigest !== typedIntentDigest(sections.typedIntentJcs) ||
    core.causalContextDigest !== causalContextDigest(context) ||
    core.baseFrontierDigest !== context.baseFrontierDigest ||
    core.baseFrontierDigest !== causalFrontierDigest(context.baseFrontier) ||
    core.baseStateVectorDigest !== context.baseStateVectorDigest ||
    core.baseStateVectorDigest !== stateVectorDigest(sections.baseStateVector) ||
    core.baseCanonicalStateDigest !== context.baseCanonicalStateDigest ||
    core.yjsUpdateDigest !== yjsUpdateDigest(sections.yjsUpdate) ||
    core.actualWriteEvidenceDigest !== actualWriteEvidenceDigest(evidence) ||
    core.ownerSchemaDigest !== evidence.ownerSchemaDigest ||
    core.intentDigest !== evidence.intentDigest ||
    core.validationArtifactSetDigest !== context.validationArtifactSetDigest ||
    core.signerAuthorityKind !== context.signerAuthority.kind ||
    core.signerAuthorityDigest !== causalSignerAuthorityDigest(context.signerAuthority) ||
    evidence.owner !== core.scope.docKind
  ) {
    failFrame("Causal core/context/payload duplicate fields are not byte-identical")
  }
}

function validateTypedIntentJcs(bytes: Uint8Array): { readonly format: "convax.typed-intent"; readonly kind: string } {
  const value = decodeRestrictedJcs(bytes)
  if (!isPlainDataObject(value) || value.format !== "convax.typed-intent" || typeof value.kind !== "string") {
    failFrame("Typed-intent section lacks the exact format and kind discriminators")
  }
  if (value.kind.length === 0 || new TextEncoder().encode(value.kind).byteLength > 128 || !/^[\x20-\x7e]+$/u.test(value.kind)) {
    failFrame("Typed-intent kind is not bounded NFC ASCII")
  }
  return value as { readonly format: "convax.typed-intent"; readonly kind: string }
}
