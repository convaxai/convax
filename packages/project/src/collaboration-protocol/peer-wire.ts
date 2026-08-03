import {
  assertDenseArrayV2,
  assertExactKeysV2,
  compareBytesV2,
  decodeBase64urlV2,
  decodeRestrictedJcsV2,
  encodeBase64urlV2,
  encodeRestrictedJcsV2,
  isPlainDataObject,
  ordinarySha256V2,
  parseDigestV2,
  parseId128V2,
  parseSignatureV2,
  parseUint32V2,
  parseUint64V2,
  rawDomainDigestV2,
  structuredDigestV2,
  uint32ToNumberV2,
  uint64ToBigIntV2,
  type DigestV2,
  type DocumentScopeV2,
  type Id128V2,
  type SignatureV2,
  type Uint32V2,
  type Uint64V2,
  parseDocumentScopeV2,
} from "@convax/collaboration"

import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2,
  PEER_CHANNEL_CONTRACT_V2,
  type PeerChannelNameV2,
} from "./control-descriptor"

const peerWireMagic = new TextEncoder().encode("CVXPEER2")
const peerWirePrefixBytes = 22
const rawEd25519SignatureBytes = 64
const maximumPeerCoreJcsBytes = 64 * 1024
const maximumControlBodyBytes = 64 * 1024
const maximumTransferChunkHeaderBytes = 4 * 1024
const maximumObjectRequestDigests = 256

const channelCode: Readonly<Record<PeerChannelNameV2, number>> = Object.freeze({
  control: 1,
  update: 2,
  blob: 3,
  awareness: 4,
})

const channelFromCode = new Map<number, PeerChannelNameV2>(
  Object.entries(channelCode).map(([channel, code]) => [code, channel as PeerChannelNameV2]),
)

export type PeerBodyKindV2 =
  | "control.inventory-root"
  | "control.inventory-page"
  | "control.object-request"
  | "control.blob-have-query"
  | "control.blob-have-response"
  | "control.transfer-offer"
  | "control.transfer-accept"
  | "control.transfer-ack"
  | "control.transfer-nack"
  | "control.transfer-cancel"
  | "control.authorization-notice"
  | "update.transfer-chunk"
  | "blob.transfer-chunk"
  | "awareness.presence"
  | "awareness.cursor"
  | "awareness.selection"
  | "awareness.gesture-hint"
  | "awareness.clear"

export interface PeerMessageCoreV2 {
  readonly format: "convax.peer-message-core/2"
  readonly connectionId: Id128V2
  readonly channelOpenDigest: DigestV2
  readonly channel: PeerChannelNameV2
  readonly senderCredentialDigest: DigestV2
  readonly receiverCredentialDigest: DigestV2
  readonly messageSequence: Uint64V2
  readonly bodyKind: PeerBodyKindV2
  readonly bodyLength: Uint64V2
  readonly bodyDigest: DigestV2
  readonly protocolDigest: DigestV2
}

export interface DecodedPeerMessageEnvelopeV2 {
  readonly format: "convax.peer-message/2"
  readonly core: PeerMessageCoreV2
  readonly coreDigest: DigestV2
  readonly senderSessionSignature: SignatureV2
  /** Exact unparsed body. The caller must verify the session signature first. */
  readonly body: Readonly<Uint8Array>
}

export type PeerObjectKindV2 =
  | "frame"
  | "checkpoint"
  | "certificate"
  | "cutoff"
  | "registry-page"
  | "causal-frontier"
  | "actor-head-set"
  | "state-vector"
  | "blob"

export type PeerTransferKindV2 =
  | "causal-frame"
  | "checkpoint"
  | "validation-suffix"
  | "registry-page"
  | "causal-frontier"
  | "actor-head-set"
  | "state-vector"
  | "project-blob"

export type PeerTransferErrorCodeV2 =
  | "manifest-invalid"
  | "scope-mismatch"
  | "unsupported-kind"
  | "dependency-missing"
  | "capacity-exceeded"
  | "chunk-invalid"
  | "hash-mismatch"
  | "validation-rejected"
  | "durability-failed"
  | "authorization-closed"

export interface PeerTransferManifestCoreV2 {
  readonly format: "convax.peer-transfer-manifest-core/2"
  readonly connectionId: Id128V2
  readonly transferId: Id128V2
  readonly channel: "update" | "blob"
  readonly kind: PeerTransferKindV2
  readonly scope: DocumentScopeV2 | null
  readonly subjectDigest: DigestV2
  readonly byteLength: Uint64V2
  readonly sha256: DigestV2
  readonly chunkBytes: Uint32V2
  readonly chunkCount: Uint32V2
  readonly compression: "none"
  readonly protocolDigest: DigestV2
}

export interface PeerTransferManifestV2 {
  readonly format: "convax.peer-transfer-manifest/2"
  readonly core: PeerTransferManifestCoreV2
  readonly coreDigest: DigestV2
}

export interface PeerTransferChunkHeaderV2 {
  readonly format: "convax.peer-transfer-chunk/2"
  readonly transferId: Id128V2
  readonly manifestDigest: DigestV2
  readonly chunkIndex: Uint32V2
  readonly byteOffset: Uint64V2
  readonly byteLength: Uint32V2
  readonly chunkSha256: DigestV2
}

export type PeerControlBodySubsetV2 =
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "object-request"
      requestId: Id128V2
      objectKind: PeerObjectKindV2
      digests: readonly DigestV2[]
    }>
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "transfer-offer"
      manifest: PeerTransferManifestV2
    }>
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "transfer-accept"
      transferId: Id128V2
      manifestDigest: DigestV2
    }>
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "transfer-ack"
      transferId: Id128V2
      manifestDigest: DigestV2
      durabilityProofDigest: DigestV2 | null
    }>
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "transfer-nack"
      transferId: Id128V2
      manifestDigest: DigestV2
      code: PeerTransferErrorCodeV2
    }>
  | Readonly<{
      format: "convax.peer-control/2"
      kind: "transfer-cancel"
      transferId: Id128V2
      manifestDigest: DigestV2
      reason: "caller-cancelled" | "scope-closed" | "superseded" | "capacity"
    }>

export interface DecodedPeerTransferChunkV2 {
  readonly header: PeerTransferChunkHeaderV2
  readonly rawChunk: Readonly<Uint8Array>
}

export interface CreatePeerMessageWireInputV2 {
  readonly connectionId: Id128V2
  readonly channelOpenDigest: DigestV2
  readonly channel: PeerChannelNameV2
  readonly senderCredentialDigest: DigestV2
  readonly receiverCredentialDigest: DigestV2
  readonly messageSequence: Uint64V2
  readonly bodyKind: PeerBodyKindV2
  readonly body: Readonly<Uint8Array>
  readonly signCoreDigest: (input: {
    readonly core: PeerMessageCoreV2
    readonly coreDigest: DigestV2
  }) => Promise<SignatureV2> | SignatureV2
}

/**
 * Exact browser-safe R5 codec surface consumed by Desktop. It deliberately omits
 * inventory DTOs until the complete root/page verifier exists.
 */
export interface PeerControlCodecV2 {
  createMessageWire(input: CreatePeerMessageWireInputV2): Promise<Uint8Array>
  decodeMessageWire(exactWireBytes: Readonly<Uint8Array>): DecodedPeerMessageEnvelopeV2
  encodeControlBody(body: PeerControlBodySubsetV2): Uint8Array
  decodeControlBody(exactBodyBytes: Readonly<Uint8Array>, expectedBodyKind: PeerBodyKindV2): PeerControlBodySubsetV2
  encodeTransferChunk(header: PeerTransferChunkHeaderV2, rawChunk: Readonly<Uint8Array>, channel: "update" | "blob"): Uint8Array
  decodeTransferChunk(exactBodyBytes: Readonly<Uint8Array>, channel: "update" | "blob"): DecodedPeerTransferChunkV2
  parseTransferManifest(value: unknown): PeerTransferManifestV2
}

export const peerControlCodecV2: PeerControlCodecV2 = Object.freeze({
  async createMessageWire(input: CreatePeerMessageWireInputV2) {
    const body = cloneBytes(input.body)
    const core = parsePeerMessageCoreV2({
      format: "convax.peer-message-core/2",
      connectionId: input.connectionId,
      channelOpenDigest: input.channelOpenDigest,
      channel: input.channel,
      senderCredentialDigest: input.senderCredentialDigest,
      receiverCredentialDigest: input.receiverCredentialDigest,
      messageSequence: input.messageSequence,
      bodyKind: input.bodyKind,
      bodyLength: String(body.byteLength),
      bodyDigest: rawDomainDigestV2("convax.peer-message-body/2", body),
      protocolDigest: CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest,
    })
    validateBodyCapAndKind(core.channel, core.bodyKind, body.byteLength)
    const coreDigest = peerMessageCoreDigestV2(core)
    const signature = parseSignatureV2(await input.signCoreDigest({ core, coreDigest }))
    return encodePeerMessageWireV2(core, signature, body)
  },
  decodeMessageWire: decodePeerMessageWireV2,
  encodeControlBody: encodePeerControlBodyV2,
  decodeControlBody: decodePeerControlBodyV2,
  encodeTransferChunk: encodePeerTransferChunkV2,
  decodeTransferChunk: decodePeerTransferChunkV2,
  parseTransferManifest: parsePeerTransferManifestV2,
})

export function peerMessageCoreDigestV2(core: PeerMessageCoreV2): DigestV2 {
  return structuredDigestV2("convax.peer-message-core/2", parsePeerMessageCoreV2(core))
}

export function peerTransferManifestCoreDigestV2(core: PeerTransferManifestCoreV2): DigestV2 {
  return structuredDigestV2("convax.peer-transfer-manifest-core/2", parsePeerTransferManifestCoreV2(core))
}

export function peerTransferChunkHeaderDigestV2(header: PeerTransferChunkHeaderV2): DigestV2 {
  return structuredDigestV2("convax.peer-transfer-chunk/2", parsePeerTransferChunkHeaderV2(header))
}

export function createPeerTransferManifestV2(coreInput: PeerTransferManifestCoreV2): PeerTransferManifestV2 {
  const core = parsePeerTransferManifestCoreV2(coreInput)
  return Object.freeze({
    format: "convax.peer-transfer-manifest/2",
    core,
    coreDigest: peerTransferManifestCoreDigestV2(core),
  })
}

export function parsePeerTransferManifestV2(value: unknown): PeerTransferManifestV2 {
  if (!isPlainDataObject(value)) throw new Error("PeerTransferManifestV2 must be a plain object")
  assertExactKeysV2(value, ["format", "core", "coreDigest"], "PeerTransferManifestV2")
  if (value.format !== "convax.peer-transfer-manifest/2") throw new Error("PeerTransferManifestV2 format is invalid")
  const core = parsePeerTransferManifestCoreV2(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (peerTransferManifestCoreDigestV2(core) !== coreDigest) throw new Error("PeerTransferManifestV2 core digest mismatches")
  return Object.freeze({ format: value.format, core, coreDigest })
}

export function encodePeerControlBodyV2(body: PeerControlBodySubsetV2): Uint8Array {
  const parsed = parsePeerControlBodySubsetV2(body)
  const exact = encodeRestrictedJcsV2(parsed)
  if (exact.byteLength > maximumControlBodyBytes) throw new Error("Peer control body exceeds 64 KiB")
  return exact
}

export function decodePeerControlBodyV2(
  exactBodyBytes: Readonly<Uint8Array>,
  expectedBodyKind: PeerBodyKindV2,
): PeerControlBodySubsetV2 {
  const bytes = cloneBytes(exactBodyBytes)
  if (bytes.byteLength === 0 || bytes.byteLength > maximumControlBodyBytes) throw new Error("Peer control body exceeds bounds")
  const parsed = parsePeerControlBodySubsetV2(decodeRestrictedJcsV2(bytes))
  if (`control.${parsed.kind}` !== expectedBodyKind) throw new Error("Peer control body discriminator mismatches message core")
  return parsed
}

export function encodePeerTransferChunkV2(
  headerInput: PeerTransferChunkHeaderV2,
  rawChunkInput: Readonly<Uint8Array>,
  channel: "update" | "blob",
): Uint8Array {
  const rawChunk = cloneBytes(rawChunkInput)
  const header = parsePeerTransferChunkHeaderV2(headerInput)
  if (uint32ToNumberV2(header.byteLength) !== rawChunk.byteLength) throw new Error("Transfer chunk header length mismatches raw bytes")
  if (header.chunkSha256 !== ordinarySha256(rawChunk)) throw new Error("Transfer chunk SHA-256 mismatches raw bytes")
  const headerJcs = encodeRestrictedJcsV2(header)
  if (headerJcs.byteLength > maximumTransferChunkHeaderBytes) throw new Error("Transfer chunk header exceeds 4 KiB")
  const rawLimit = channel === "update" ? 256 * 1024 : 1024 * 1024
  const bodyLimit = channel === "update" ? 260 * 1024 : 1028 * 1024
  if (rawChunk.byteLength === 0 || rawChunk.byteLength > rawLimit) throw new Error("Transfer raw chunk exceeds channel bounds")
  const output = new Uint8Array(4 + headerJcs.byteLength + rawChunk.byteLength)
  new DataView(output.buffer).setUint32(0, headerJcs.byteLength, false)
  output.set(headerJcs, 4)
  output.set(rawChunk, 4 + headerJcs.byteLength)
  if (output.byteLength > bodyLimit) throw new Error("Transfer chunk body exceeds channel bounds")
  return output
}

export function decodePeerTransferChunkV2(
  exactBodyBytes: Readonly<Uint8Array>,
  channel: "update" | "blob",
): DecodedPeerTransferChunkV2 {
  const bytes = cloneBytes(exactBodyBytes)
  const bodyLimit = channel === "update" ? 260 * 1024 : 1028 * 1024
  const rawLimit = channel === "update" ? 256 * 1024 : 1024 * 1024
  if (bytes.byteLength < 5 || bytes.byteLength > bodyLimit) throw new Error("Transfer chunk body exceeds channel bounds")
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false)
  if (headerLength === 0 || headerLength > maximumTransferChunkHeaderBytes || 4 + headerLength >= bytes.byteLength) {
    throw new Error("Transfer chunk header length is invalid")
  }
  const header = parsePeerTransferChunkHeaderV2(decodeRestrictedJcsV2(bytes.subarray(4, 4 + headerLength)))
  const rawChunk = bytes.slice(4 + headerLength)
  if (rawChunk.byteLength > rawLimit || uint32ToNumberV2(header.byteLength) !== rawChunk.byteLength) {
    throw new Error("Transfer chunk raw length is invalid")
  }
  if (header.chunkSha256 !== ordinarySha256(rawChunk)) throw new Error("Transfer chunk SHA-256 mismatches")
  return Object.freeze({ header, rawChunk })
}

function encodePeerMessageWireV2(core: PeerMessageCoreV2, signature: SignatureV2, body: Uint8Array): Uint8Array {
  const coreJcs = encodeRestrictedJcsV2(core)
  if (coreJcs.byteLength === 0 || coreJcs.byteLength > maximumPeerCoreJcsBytes) throw new Error("Peer message core exceeds bounds")
  const signatureBytes = decodeBase64urlV2(signature)
  const output = new Uint8Array(peerWirePrefixBytes + coreJcs.byteLength + rawEd25519SignatureBytes + body.byteLength)
  output.set(peerWireMagic, 0)
  output[8] = channelCode[core.channel]
  output[9] = 0
  const view = new DataView(output.buffer)
  view.setUint32(10, coreJcs.byteLength, false)
  view.setBigUint64(14, BigInt(body.byteLength), false)
  output.set(coreJcs, peerWirePrefixBytes)
  output.set(signatureBytes, peerWirePrefixBytes + coreJcs.byteLength)
  output.set(body, peerWirePrefixBytes + coreJcs.byteLength + rawEd25519SignatureBytes)
  return output
}

function decodePeerMessageWireV2(exactWireBytes: Readonly<Uint8Array>): DecodedPeerMessageEnvelopeV2 {
  const bytes = cloneBytes(exactWireBytes)
  if (bytes.byteLength < peerWirePrefixBytes + rawEd25519SignatureBytes + 1) throw new Error("Peer message wire is truncated")
  if (compareBytesV2(bytes.subarray(0, 8), peerWireMagic) !== 0) throw new Error("Peer message magic is invalid")
  const channel = channelFromCode.get(bytes[8]!)
  if (!channel || bytes[9] !== 0) throw new Error("Peer message channel code or flags are invalid")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const coreLength = view.getUint32(10, false)
  const bodyLength = view.getBigUint64(14, false)
  if (coreLength === 0 || coreLength > maximumPeerCoreJcsBytes) throw new Error("Peer message core length is invalid")
  const bodyStart = peerWirePrefixBytes + coreLength + rawEd25519SignatureBytes
  if (bodyLength > BigInt(Number.MAX_SAFE_INTEGER) || bodyStart > bytes.byteLength || BigInt(bytes.byteLength - bodyStart) !== bodyLength) {
    throw new Error("Peer message body framing is invalid")
  }
  const core = parsePeerMessageCoreV2(decodeRestrictedJcsV2(bytes.subarray(peerWirePrefixBytes, peerWirePrefixBytes + coreLength)))
  if (core.channel !== channel || uint64ToBigIntV2(core.bodyLength) !== bodyLength) throw new Error("Peer message core framing mismatches")
  const signatureStart = peerWirePrefixBytes + coreLength
  const senderSessionSignature = parseSignatureV2(encodeBase64urlV2(bytes.subarray(signatureStart, bodyStart)))
  const body = bytes.slice(bodyStart)
  if (core.bodyDigest !== rawDomainDigestV2("convax.peer-message-body/2", body)) throw new Error("Peer message body digest mismatches")
  validateBodyCapAndKind(channel, core.bodyKind, body.byteLength)
  return Object.freeze({
    format: "convax.peer-message/2",
    core,
    coreDigest: peerMessageCoreDigestV2(core),
    senderSessionSignature,
    body,
  })
}

function parsePeerMessageCoreV2(value: unknown): PeerMessageCoreV2 {
  if (!isPlainDataObject(value)) throw new Error("PeerMessageCoreV2 must be a plain object")
  assertExactKeysV2(value, [
    "format", "connectionId", "channelOpenDigest", "channel", "senderCredentialDigest",
    "receiverCredentialDigest", "messageSequence", "bodyKind", "bodyLength", "bodyDigest", "protocolDigest",
  ], "PeerMessageCoreV2")
  if (value.format !== "convax.peer-message-core/2") throw new Error("PeerMessageCoreV2 format is invalid")
  const channel = parsePeerChannel(value.channel)
  const bodyKind = parsePeerBodyKind(value.bodyKind)
  if (BigInt(parseUint64V2(value.messageSequence)) === 0n) throw new Error("Peer message sequence starts at one")
  const protocolDigest = parseDigestV2(value.protocolDigest)
  if (protocolDigest !== CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest) throw new Error("Peer message protocol digest is invalid")
  return Object.freeze({
    format: value.format,
    connectionId: parseId128V2(value.connectionId),
    channelOpenDigest: parseDigestV2(value.channelOpenDigest),
    channel,
    senderCredentialDigest: parseDigestV2(value.senderCredentialDigest),
    receiverCredentialDigest: parseDigestV2(value.receiverCredentialDigest),
    messageSequence: parseUint64V2(value.messageSequence),
    bodyKind,
    bodyLength: parseUint64V2(value.bodyLength),
    bodyDigest: parseDigestV2(value.bodyDigest),
    protocolDigest,
  })
}

function parsePeerControlBodySubsetV2(value: unknown): PeerControlBodySubsetV2 {
  if (!isPlainDataObject(value) || value.format !== "convax.peer-control/2" || typeof value.kind !== "string") {
    throw new Error("Peer control body is invalid")
  }
  if (value.kind === "object-request") {
    assertExactKeysV2(value, ["format", "kind", "requestId", "objectKind", "digests"], "PeerControlObjectRequestV2")
    assertDenseArrayV2(value.digests, "PeerControlObjectRequestV2 digests")
    if (value.digests.length === 0 || value.digests.length > maximumObjectRequestDigests) throw new Error("Object request digest count is invalid")
    const digests = value.digests.map(parseDigestV2)
    requireStrictDecodedDigestOrder(digests, "Object request digests")
    return Object.freeze({
      format: value.format,
      kind: value.kind,
      requestId: parseId128V2(value.requestId),
      objectKind: parsePeerObjectKind(value.objectKind),
      digests: Object.freeze(digests),
    })
  }
  if (value.kind === "transfer-offer") {
    assertExactKeysV2(value, ["format", "kind", "manifest"], "PeerControlTransferOfferV2")
    return Object.freeze({ format: value.format, kind: value.kind, manifest: parsePeerTransferManifestV2(value.manifest) })
  }
  if (value.kind === "transfer-accept") {
    assertExactKeysV2(value, ["format", "kind", "transferId", "manifestDigest"], "PeerControlTransferAcceptV2")
    return Object.freeze({ format: value.format, kind: value.kind, transferId: parseId128V2(value.transferId), manifestDigest: parseDigestV2(value.manifestDigest) })
  }
  if (value.kind === "transfer-ack") {
    assertExactKeysV2(value, ["format", "kind", "transferId", "manifestDigest", "durabilityProofDigest"], "PeerControlTransferAckV2")
    return Object.freeze({
      format: value.format,
      kind: value.kind,
      transferId: parseId128V2(value.transferId),
      manifestDigest: parseDigestV2(value.manifestDigest),
      durabilityProofDigest: value.durabilityProofDigest === null ? null : parseDigestV2(value.durabilityProofDigest),
    })
  }
  if (value.kind === "transfer-nack") {
    assertExactKeysV2(value, ["format", "kind", "transferId", "manifestDigest", "code"], "PeerControlTransferNackV2")
    return Object.freeze({
      format: value.format,
      kind: value.kind,
      transferId: parseId128V2(value.transferId),
      manifestDigest: parseDigestV2(value.manifestDigest),
      code: parsePeerTransferErrorCode(value.code),
    })
  }
  if (value.kind === "transfer-cancel") {
    assertExactKeysV2(value, ["format", "kind", "transferId", "manifestDigest", "reason"], "PeerControlTransferCancelV2")
    return Object.freeze({
      format: value.format,
      kind: value.kind,
      transferId: parseId128V2(value.transferId),
      manifestDigest: parseDigestV2(value.manifestDigest),
      reason: parseTransferCancelReason(value.reason),
    })
  }
  throw new Error("Peer control body kind is unsupported by this closed subset")
}

function parsePeerTransferManifestCoreV2(value: unknown): PeerTransferManifestCoreV2 {
  if (!isPlainDataObject(value)) throw new Error("PeerTransferManifestCoreV2 must be a plain object")
  assertExactKeysV2(value, [
    "format", "connectionId", "transferId", "channel", "kind", "scope", "subjectDigest", "byteLength",
    "sha256", "chunkBytes", "chunkCount", "compression", "protocolDigest",
  ], "PeerTransferManifestCoreV2")
  if (value.format !== "convax.peer-transfer-manifest-core/2") throw new Error("Peer transfer manifest format is invalid")
  const channel = value.channel === "update" || value.channel === "blob" ? value.channel : invalid("Peer transfer manifest channel is invalid")
  const kind = parsePeerTransferKind(value.kind)
  const scope = value.scope === null ? null : parseDocumentScopeV2(value.scope)
  const byteLength = parseUint64V2(value.byteLength)
  const chunkBytes = parseUint32V2(value.chunkBytes)
  const chunkCount = parseUint32V2(value.chunkCount)
  const byteLengthValue = uint64ToBigIntV2(byteLength)
  const chunkBytesValue = BigInt(uint32ToNumberV2(chunkBytes))
  if (byteLengthValue === 0n || chunkBytesValue === 0n || BigInt(chunkCount) === 0n) throw new Error("Zero-byte transfer is forbidden")
  const expectedChunks = (byteLengthValue + chunkBytesValue - 1n) / chunkBytesValue
  if (expectedChunks !== BigInt(chunkCount)) throw new Error("Peer transfer chunk count is not the exact ceiling")
  const rawLimit = channel === "update" ? 256 * 1024 : 1024 * 1024
  if (chunkBytesValue > BigInt(rawLimit)) throw new Error("Peer transfer chunk size exceeds channel bounds")
  if ((kind === "project-blob") !== (channel === "blob")) throw new Error("Peer transfer channel/kind mapping is invalid")
  if (kind === "project-blob" || kind === "registry-page") {
    if (scope !== null) throw new Error("Project blob and registry page transfer scope must be null")
  } else if (scope === null) {
    throw new Error("Document transfer scope is required")
  }
  const protocolDigest = parseDigestV2(value.protocolDigest)
  if (protocolDigest !== CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest) throw new Error("Peer transfer protocol digest is invalid")
  if (value.compression !== "none") throw new Error("Peer transfer compression is invalid")
  return Object.freeze({
    format: value.format,
    connectionId: parseId128V2(value.connectionId),
    transferId: parseId128V2(value.transferId),
    channel,
    kind,
    scope,
    subjectDigest: parseDigestV2(value.subjectDigest),
    byteLength,
    sha256: parseDigestV2(value.sha256),
    chunkBytes,
    chunkCount,
    compression: value.compression,
    protocolDigest,
  })
}

function parsePeerTransferChunkHeaderV2(value: unknown): PeerTransferChunkHeaderV2 {
  if (!isPlainDataObject(value)) throw new Error("PeerTransferChunkHeaderV2 must be a plain object")
  assertExactKeysV2(value, ["format", "transferId", "manifestDigest", "chunkIndex", "byteOffset", "byteLength", "chunkSha256"], "PeerTransferChunkHeaderV2")
  if (value.format !== "convax.peer-transfer-chunk/2") throw new Error("Peer transfer chunk header format is invalid")
  return Object.freeze({
    format: value.format,
    transferId: parseId128V2(value.transferId),
    manifestDigest: parseDigestV2(value.manifestDigest),
    chunkIndex: parseUint32V2(value.chunkIndex),
    byteOffset: parseUint64V2(value.byteOffset),
    byteLength: parseUint32V2(value.byteLength),
    chunkSha256: parseDigestV2(value.chunkSha256),
  })
}

function validateBodyCapAndKind(channel: PeerChannelNameV2, bodyKind: PeerBodyKindV2, bodyLength: number): void {
  const policy = PEER_CHANNEL_CONTRACT_V2.policies.find((candidate) => candidate.channel === channel)
  if (!policy || bodyLength === 0 || BigInt(bodyLength) > BigInt(policy.maxBodyBytes)) throw new Error("Peer message body exceeds channel bounds")
  const expectedPrefix = `${channel}.`
  if (!bodyKind.startsWith(expectedPrefix)) throw new Error("Peer message body kind does not match channel")
  if (channel === "update" && bodyKind !== "update.transfer-chunk") throw new Error("Update channel accepts only transfer chunks")
  if (channel === "blob" && bodyKind !== "blob.transfer-chunk") throw new Error("Blob channel accepts only transfer chunks")
}

function requireStrictDecodedDigestOrder(digests: readonly DigestV2[], label: string): void {
  for (let index = 1; index < digests.length; index += 1) {
    if (compareBytesV2(hexDigestBytes(digests[index - 1]!), hexDigestBytes(digests[index]!)) >= 0) {
      throw new Error(`${label} must be strictly sorted and duplicate-free`)
    }
  }
}

function hexDigestBytes(digest: DigestV2): Uint8Array {
  return Uint8Array.from(digest.match(/../gu)!, (byte) => Number.parseInt(byte, 16))
}

function ordinarySha256(bytes: Uint8Array): DigestV2 {
  // `sha256` and `chunkSha256` are the R5 ordinary content-address fields.
  // This dynamic import is intentionally avoided so the codec remains synchronous.
  // `rawDomainDigestV2` cannot represent an ordinary digest, so use WebCrypto-free
  // collaboration's public ordinary helper through the locally bound alias below.
  return ordinarySha256V2(bytes)
}

function cloneBytes(bytes: Readonly<Uint8Array>): Uint8Array {
  if (!(bytes instanceof Uint8Array)) throw new Error("Peer wire bytes must be Uint8Array")
  return new Uint8Array(bytes)
}

function parsePeerChannel(value: unknown): PeerChannelNameV2 {
  if (value === "control" || value === "update" || value === "blob" || value === "awareness") return value
  throw new Error("Peer channel is invalid")
}

function parsePeerBodyKind(value: unknown): PeerBodyKindV2 {
  const values: readonly PeerBodyKindV2[] = [
    "control.inventory-root", "control.inventory-page", "control.object-request", "control.blob-have-query",
    "control.blob-have-response", "control.transfer-offer", "control.transfer-accept", "control.transfer-ack",
    "control.transfer-nack", "control.transfer-cancel", "control.authorization-notice", "update.transfer-chunk",
    "blob.transfer-chunk", "awareness.presence", "awareness.cursor", "awareness.selection",
    "awareness.gesture-hint", "awareness.clear",
  ]
  if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as PeerBodyKindV2
  throw new Error("Peer body kind is invalid")
}

function parsePeerObjectKind(value: unknown): PeerObjectKindV2 {
  const values: readonly PeerObjectKindV2[] = ["frame", "checkpoint", "certificate", "cutoff", "registry-page", "causal-frontier", "actor-head-set", "state-vector", "blob"]
  if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as PeerObjectKindV2
  throw new Error("Peer object kind is invalid")
}

function parsePeerTransferKind(value: unknown): PeerTransferKindV2 {
  const values: readonly PeerTransferKindV2[] = ["causal-frame", "checkpoint", "validation-suffix", "registry-page", "causal-frontier", "actor-head-set", "state-vector", "project-blob"]
  if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as PeerTransferKindV2
  throw new Error("Peer transfer kind is invalid")
}

function parsePeerTransferErrorCode(value: unknown): PeerTransferErrorCodeV2 {
  const values: readonly PeerTransferErrorCodeV2[] = ["manifest-invalid", "scope-mismatch", "unsupported-kind", "dependency-missing", "capacity-exceeded", "chunk-invalid", "hash-mismatch", "validation-rejected", "durability-failed", "authorization-closed"]
  if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as PeerTransferErrorCodeV2
  throw new Error("Peer transfer error code is invalid")
}

function parseTransferCancelReason(value: unknown): "caller-cancelled" | "scope-closed" | "superseded" | "capacity" {
  if (value === "caller-cancelled" || value === "scope-closed" || value === "superseded" || value === "capacity") return value
  throw new Error("Peer transfer cancellation reason is invalid")
}

function invalid(message: string): never {
  throw new Error(message)
}
