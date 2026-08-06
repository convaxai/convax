import {
  assertDenseArray,
  assertExactKeys,
  compareBytes,
  decodeBase64url,
  decodeRestrictedJcs,
  encodeBase64url,
  encodeRestrictedJcs,
  isPlainDataObject,
  ordinarySha256,
  parseDigest,
  parseId128,
  parseSignature,
  parseUint32,
  parseUint64,
  rawDomainDigest,
  structuredDigest,
  uint32ToNumber,
  uint64ToBigInt,
  type Digest,
  type DocumentScope,
  type Id128,
  type Signature,
  type Uint32,
  type Uint64,
  parseDocumentScope,
} from "@convax/collaboration"

import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES,
  PEER_CHANNEL_CONTRACT,
  type PeerChannelName,
} from "./control-descriptor"

const peerWireMagic = new TextEncoder().encode("CVXPEER2")
const peerWirePrefixBytes = 22
const rawEd25519SignatureBytes = 64
const maximumPeerCoreJcsBytes = 64 * 1024
const maximumControlBodyBytes = 64 * 1024
const maximumTransferChunkHeaderBytes = 4 * 1024
const maximumObjectRequestDigests = 256

const channelCode: Readonly<Record<PeerChannelName, number>> = Object.freeze({
  control: 1,
  update: 2,
  blob: 3,
  awareness: 4,
})

const channelFromCode = new Map<number, PeerChannelName>(
  Object.entries(channelCode).map(([channel, code]) => [code, channel as PeerChannelName]),
)

export type PeerBodyKind =
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

export interface PeerMessageCore {
  readonly format: "convax.peer-message-core"
  readonly connectionId: Id128
  readonly channelOpenDigest: Digest
  readonly channel: PeerChannelName
  readonly senderCredentialDigest: Digest
  readonly receiverCredentialDigest: Digest
  readonly messageSequence: Uint64
  readonly bodyKind: PeerBodyKind
  readonly bodyLength: Uint64
  readonly bodyDigest: Digest
  readonly protocolDigest: Digest
}

export interface DecodedPeerMessageEnvelope {
  readonly format: "convax.peer-message"
  readonly core: PeerMessageCore
  readonly coreDigest: Digest
  readonly senderSessionSignature: Signature
  /** Exact unparsed body. The caller must verify the session signature first. */
  readonly body: Readonly<Uint8Array>
}

export type PeerObjectKind =
  | "frame"
  | "checkpoint"
  | "certificate"
  | "cutoff"
  | "registry-page"
  | "causal-frontier"
  | "actor-head-set"
  | "state-vector"
  | "blob"

export type PeerTransferKind =
  | "causal-frame"
  | "checkpoint"
  | "validation-suffix"
  | "registry-page"
  | "causal-frontier"
  | "actor-head-set"
  | "state-vector"
  | "project-blob"

export type PeerTransferErrorCode =
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

export interface PeerTransferManifestCore {
  readonly format: "convax.peer-transfer-manifest-core"
  readonly connectionId: Id128
  readonly transferId: Id128
  readonly channel: "update" | "blob"
  readonly kind: PeerTransferKind
  readonly scope: DocumentScope | null
  readonly subjectDigest: Digest
  readonly byteLength: Uint64
  readonly sha256: Digest
  readonly chunkBytes: Uint32
  readonly chunkCount: Uint32
  readonly compression: "none"
  readonly protocolDigest: Digest
}

export interface PeerTransferManifest {
  readonly format: "convax.peer-transfer-manifest"
  readonly core: PeerTransferManifestCore
  readonly coreDigest: Digest
}

export interface PeerTransferChunkHeader {
  readonly format: "convax.peer-transfer-chunk"
  readonly transferId: Id128
  readonly manifestDigest: Digest
  readonly chunkIndex: Uint32
  readonly byteOffset: Uint64
  readonly byteLength: Uint32
  readonly chunkSha256: Digest
}

export type PeerControlBodySubset =
  | Readonly<{
      format: "convax.peer-control"
      kind: "object-request"
      requestId: Id128
      objectKind: PeerObjectKind
      digests: readonly Digest[]
    }>
  | Readonly<{
      format: "convax.peer-control"
      kind: "transfer-offer"
      manifest: PeerTransferManifest
    }>
  | Readonly<{
      format: "convax.peer-control"
      kind: "transfer-accept"
      transferId: Id128
      manifestDigest: Digest
    }>
  | Readonly<{
      format: "convax.peer-control"
      kind: "transfer-ack"
      transferId: Id128
      manifestDigest: Digest
      durabilityProofDigest: Digest | null
    }>
  | Readonly<{
      format: "convax.peer-control"
      kind: "transfer-nack"
      transferId: Id128
      manifestDigest: Digest
      code: PeerTransferErrorCode
    }>
  | Readonly<{
      format: "convax.peer-control"
      kind: "transfer-cancel"
      transferId: Id128
      manifestDigest: Digest
      reason: "caller-cancelled" | "scope-closed" | "superseded" | "capacity"
    }>

export interface DecodedPeerTransferChunk {
  readonly header: PeerTransferChunkHeader
  readonly rawChunk: Readonly<Uint8Array>
}

export interface CreatePeerMessageWireInput {
  readonly connectionId: Id128
  readonly channelOpenDigest: Digest
  readonly channel: PeerChannelName
  readonly senderCredentialDigest: Digest
  readonly receiverCredentialDigest: Digest
  readonly messageSequence: Uint64
  readonly bodyKind: PeerBodyKind
  readonly body: Readonly<Uint8Array>
  readonly signCoreDigest: (input: {
    readonly core: PeerMessageCore
    readonly coreDigest: Digest
  }) => Promise<Signature> | Signature
}

/**
 * Exact browser-safe codec surface consumed by Desktop. It deliberately omits
 * inventory DTOs until the complete root/page verifier exists.
 */
export interface PeerControlCodec {
  createMessageWire(input: CreatePeerMessageWireInput): Promise<Uint8Array>
  decodeMessageWire(exactWireBytes: Readonly<Uint8Array>): DecodedPeerMessageEnvelope
  encodeControlBody(body: PeerControlBodySubset): Uint8Array
  decodeControlBody(exactBodyBytes: Readonly<Uint8Array>, expectedBodyKind: PeerBodyKind): PeerControlBodySubset
  encodeTransferChunk(header: PeerTransferChunkHeader, rawChunk: Readonly<Uint8Array>, channel: "update" | "blob"): Uint8Array
  decodeTransferChunk(exactBodyBytes: Readonly<Uint8Array>, channel: "update" | "blob"): DecodedPeerTransferChunk
  parseTransferManifest(value: unknown): PeerTransferManifest
}

export const peerControlCodec: PeerControlCodec = Object.freeze({
  async createMessageWire(input: CreatePeerMessageWireInput) {
    const body = cloneBytes(input.body)
    const core = parsePeerMessageCore({
      format: "convax.peer-message-core",
      connectionId: input.connectionId,
      channelOpenDigest: input.channelOpenDigest,
      channel: input.channel,
      senderCredentialDigest: input.senderCredentialDigest,
      receiverCredentialDigest: input.receiverCredentialDigest,
      messageSequence: input.messageSequence,
      bodyKind: input.bodyKind,
      bodyLength: String(body.byteLength),
      bodyDigest: rawDomainDigest("convax.peer-message-body", body),
      protocolDigest: CONTROL_PROTOCOL_EXPECTED_IDENTITIES.protocolDigest,
    })
    validateBodyCapAndKind(core.channel, core.bodyKind, body.byteLength)
    const coreDigest = peerMessageCoreDigest(core)
    const signature = parseSignature(await input.signCoreDigest({ core, coreDigest }))
    return encodePeerMessageWire(core, signature, body)
  },
  decodeMessageWire: decodePeerMessageWire,
  encodeControlBody: encodePeerControlBody,
  decodeControlBody: decodePeerControlBody,
  encodeTransferChunk: encodePeerTransferChunk,
  decodeTransferChunk: decodePeerTransferChunk,
  parseTransferManifest: parsePeerTransferManifest,
})

export function peerMessageCoreDigest(core: PeerMessageCore): Digest {
  return structuredDigest("convax.peer-message-core", parsePeerMessageCore(core))
}

export function peerTransferManifestCoreDigest(core: PeerTransferManifestCore): Digest {
  return structuredDigest("convax.peer-transfer-manifest-core", parsePeerTransferManifestCore(core))
}

export function peerTransferChunkHeaderDigest(header: PeerTransferChunkHeader): Digest {
  return structuredDigest("convax.peer-transfer-chunk", parsePeerTransferChunkHeader(header))
}

export function createPeerTransferManifest(coreInput: PeerTransferManifestCore): PeerTransferManifest {
  const core = parsePeerTransferManifestCore(coreInput)
  return Object.freeze({
    format: "convax.peer-transfer-manifest",
    core,
    coreDigest: peerTransferManifestCoreDigest(core),
  })
}

export function parsePeerTransferManifest(value: unknown): PeerTransferManifest {
  if (!isPlainDataObject(value)) throw new Error("PeerTransferManifest must be a plain object")
  assertExactKeys(value, ["format", "core", "coreDigest"], "PeerTransferManifest")
  if (value.format !== "convax.peer-transfer-manifest") throw new Error("PeerTransferManifest format is invalid")
  const core = parsePeerTransferManifestCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (peerTransferManifestCoreDigest(core) !== coreDigest) throw new Error("PeerTransferManifest core digest mismatches")
  return Object.freeze({ format: value.format, core, coreDigest })
}

export function encodePeerControlBody(body: PeerControlBodySubset): Uint8Array {
  const parsed = parsePeerControlBodySubset(body)
  const exact = encodeRestrictedJcs(parsed)
  if (exact.byteLength > maximumControlBodyBytes) throw new Error("Peer control body exceeds 64 KiB")
  return exact
}

export function decodePeerControlBody(
  exactBodyBytes: Readonly<Uint8Array>,
  expectedBodyKind: PeerBodyKind,
): PeerControlBodySubset {
  const bytes = cloneBytes(exactBodyBytes)
  if (bytes.byteLength === 0 || bytes.byteLength > maximumControlBodyBytes) throw new Error("Peer control body exceeds bounds")
  const parsed = parsePeerControlBodySubset(decodeRestrictedJcs(bytes))
  if (`control.${parsed.kind}` !== expectedBodyKind) throw new Error("Peer control body discriminator mismatches message core")
  return parsed
}

export function encodePeerTransferChunk(
  headerInput: PeerTransferChunkHeader,
  rawChunkInput: Readonly<Uint8Array>,
  channel: "update" | "blob",
): Uint8Array {
  const rawChunk = cloneBytes(rawChunkInput)
  const header = parsePeerTransferChunkHeader(headerInput)
  if (uint32ToNumber(header.byteLength) !== rawChunk.byteLength) throw new Error("Transfer chunk header length mismatches raw bytes")
  if (header.chunkSha256 !== ordinarySha256(rawChunk)) throw new Error("Transfer chunk SHA-256 mismatches raw bytes")
  const headerJcs = encodeRestrictedJcs(header)
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

export function decodePeerTransferChunk(
  exactBodyBytes: Readonly<Uint8Array>,
  channel: "update" | "blob",
): DecodedPeerTransferChunk {
  const bytes = cloneBytes(exactBodyBytes)
  const bodyLimit = channel === "update" ? 260 * 1024 : 1028 * 1024
  const rawLimit = channel === "update" ? 256 * 1024 : 1024 * 1024
  if (bytes.byteLength < 5 || bytes.byteLength > bodyLimit) throw new Error("Transfer chunk body exceeds channel bounds")
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false)
  if (headerLength === 0 || headerLength > maximumTransferChunkHeaderBytes || 4 + headerLength >= bytes.byteLength) {
    throw new Error("Transfer chunk header length is invalid")
  }
  const header = parsePeerTransferChunkHeader(decodeRestrictedJcs(bytes.subarray(4, 4 + headerLength)))
  const rawChunk = bytes.slice(4 + headerLength)
  if (rawChunk.byteLength > rawLimit || uint32ToNumber(header.byteLength) !== rawChunk.byteLength) {
    throw new Error("Transfer chunk raw length is invalid")
  }
  if (header.chunkSha256 !== ordinarySha256(rawChunk)) throw new Error("Transfer chunk SHA-256 mismatches")
  return Object.freeze({ header, rawChunk })
}

function encodePeerMessageWire(core: PeerMessageCore, signature: Signature, body: Uint8Array): Uint8Array {
  const coreJcs = encodeRestrictedJcs(core)
  if (coreJcs.byteLength === 0 || coreJcs.byteLength > maximumPeerCoreJcsBytes) throw new Error("Peer message core exceeds bounds")
  const signatureBytes = decodeBase64url(signature)
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

function decodePeerMessageWire(exactWireBytes: Readonly<Uint8Array>): DecodedPeerMessageEnvelope {
  const bytes = cloneBytes(exactWireBytes)
  if (bytes.byteLength < peerWirePrefixBytes + rawEd25519SignatureBytes + 1) throw new Error("Peer message wire is truncated")
  if (compareBytes(bytes.subarray(0, 8), peerWireMagic) !== 0) throw new Error("Peer message magic is invalid")
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
  const core = parsePeerMessageCore(decodeRestrictedJcs(bytes.subarray(peerWirePrefixBytes, peerWirePrefixBytes + coreLength)))
  if (core.channel !== channel || uint64ToBigInt(core.bodyLength) !== bodyLength) throw new Error("Peer message core framing mismatches")
  const signatureStart = peerWirePrefixBytes + coreLength
  const senderSessionSignature = parseSignature(encodeBase64url(bytes.subarray(signatureStart, bodyStart)))
  const body = bytes.slice(bodyStart)
  if (core.bodyDigest !== rawDomainDigest("convax.peer-message-body", body)) throw new Error("Peer message body digest mismatches")
  validateBodyCapAndKind(channel, core.bodyKind, body.byteLength)
  return Object.freeze({
    format: "convax.peer-message",
    core,
    coreDigest: peerMessageCoreDigest(core),
    senderSessionSignature,
    body,
  })
}

function parsePeerMessageCore(value: unknown): PeerMessageCore {
  if (!isPlainDataObject(value)) throw new Error("PeerMessageCore must be a plain object")
  assertExactKeys(value, [
    "format", "connectionId", "channelOpenDigest", "channel", "senderCredentialDigest",
    "receiverCredentialDigest", "messageSequence", "bodyKind", "bodyLength", "bodyDigest", "protocolDigest",
  ], "PeerMessageCore")
  if (value.format !== "convax.peer-message-core") throw new Error("PeerMessageCore format is invalid")
  const channel = parsePeerChannel(value.channel)
  const bodyKind = parsePeerBodyKind(value.bodyKind)
  if (BigInt(parseUint64(value.messageSequence)) === 0n) throw new Error("Peer message sequence starts at one")
  const protocolDigest = parseDigest(value.protocolDigest)
  if (protocolDigest !== CONTROL_PROTOCOL_EXPECTED_IDENTITIES.protocolDigest) throw new Error("Peer message protocol digest is invalid")
  return Object.freeze({
    format: value.format,
    connectionId: parseId128(value.connectionId),
    channelOpenDigest: parseDigest(value.channelOpenDigest),
    channel,
    senderCredentialDigest: parseDigest(value.senderCredentialDigest),
    receiverCredentialDigest: parseDigest(value.receiverCredentialDigest),
    messageSequence: parseUint64(value.messageSequence),
    bodyKind,
    bodyLength: parseUint64(value.bodyLength),
    bodyDigest: parseDigest(value.bodyDigest),
    protocolDigest,
  })
}

function parsePeerControlBodySubset(value: unknown): PeerControlBodySubset {
  if (!isPlainDataObject(value) || value.format !== "convax.peer-control" || typeof value.kind !== "string") {
    throw new Error("Peer control body is invalid")
  }
  if (value.kind === "object-request") {
    assertExactKeys(value, ["format", "kind", "requestId", "objectKind", "digests"], "PeerControlObjectRequest")
    assertDenseArray(value.digests, "PeerControlObjectRequest digests")
    if (value.digests.length === 0 || value.digests.length > maximumObjectRequestDigests) throw new Error("Object request digest count is invalid")
    const digests = value.digests.map(parseDigest)
    requireStrictDecodedDigestOrder(digests, "Object request digests")
    return Object.freeze({
      format: value.format,
      kind: value.kind,
      requestId: parseId128(value.requestId),
      objectKind: parsePeerObjectKind(value.objectKind),
      digests: Object.freeze(digests),
    })
  }
  if (value.kind === "transfer-offer") {
    assertExactKeys(value, ["format", "kind", "manifest"], "PeerControlTransferOffer")
    return Object.freeze({ format: value.format, kind: value.kind, manifest: parsePeerTransferManifest(value.manifest) })
  }
  if (value.kind === "transfer-accept") {
    assertExactKeys(value, ["format", "kind", "transferId", "manifestDigest"], "PeerControlTransferAccept")
    return Object.freeze({ format: value.format, kind: value.kind, transferId: parseId128(value.transferId), manifestDigest: parseDigest(value.manifestDigest) })
  }
  if (value.kind === "transfer-ack") {
    assertExactKeys(value, ["format", "kind", "transferId", "manifestDigest", "durabilityProofDigest"], "PeerControlTransferAck")
    return Object.freeze({
      format: value.format,
      kind: value.kind,
      transferId: parseId128(value.transferId),
      manifestDigest: parseDigest(value.manifestDigest),
      durabilityProofDigest: value.durabilityProofDigest === null ? null : parseDigest(value.durabilityProofDigest),
    })
  }
  if (value.kind === "transfer-nack") {
    assertExactKeys(value, ["format", "kind", "transferId", "manifestDigest", "code"], "PeerControlTransferNack")
    return Object.freeze({
      format: value.format,
      kind: value.kind,
      transferId: parseId128(value.transferId),
      manifestDigest: parseDigest(value.manifestDigest),
      code: parsePeerTransferErrorCode(value.code),
    })
  }
  if (value.kind === "transfer-cancel") {
    assertExactKeys(value, ["format", "kind", "transferId", "manifestDigest", "reason"], "PeerControlTransferCancel")
    return Object.freeze({
      format: value.format,
      kind: value.kind,
      transferId: parseId128(value.transferId),
      manifestDigest: parseDigest(value.manifestDigest),
      reason: parseTransferCancelReason(value.reason),
    })
  }
  throw new Error("Peer control body kind is unsupported by this closed subset")
}

function parsePeerTransferManifestCore(value: unknown): PeerTransferManifestCore {
  if (!isPlainDataObject(value)) throw new Error("PeerTransferManifestCore must be a plain object")
  assertExactKeys(value, [
    "format", "connectionId", "transferId", "channel", "kind", "scope", "subjectDigest", "byteLength",
    "sha256", "chunkBytes", "chunkCount", "compression", "protocolDigest",
  ], "PeerTransferManifestCore")
  if (value.format !== "convax.peer-transfer-manifest-core") throw new Error("Peer transfer manifest format is invalid")
  const channel = value.channel === "update" || value.channel === "blob" ? value.channel : invalid("Peer transfer manifest channel is invalid")
  const kind = parsePeerTransferKind(value.kind)
  const scope = value.scope === null ? null : parseDocumentScope(value.scope)
  const byteLength = parseUint64(value.byteLength)
  const chunkBytes = parseUint32(value.chunkBytes)
  const chunkCount = parseUint32(value.chunkCount)
  const byteLengthValue = uint64ToBigInt(byteLength)
  const chunkBytesValue = BigInt(uint32ToNumber(chunkBytes))
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
  const protocolDigest = parseDigest(value.protocolDigest)
  if (protocolDigest !== CONTROL_PROTOCOL_EXPECTED_IDENTITIES.protocolDigest) throw new Error("Peer transfer protocol digest is invalid")
  if (value.compression !== "none") throw new Error("Peer transfer compression is invalid")
  return Object.freeze({
    format: value.format,
    connectionId: parseId128(value.connectionId),
    transferId: parseId128(value.transferId),
    channel,
    kind,
    scope,
    subjectDigest: parseDigest(value.subjectDigest),
    byteLength,
    sha256: parseDigest(value.sha256),
    chunkBytes,
    chunkCount,
    compression: value.compression,
    protocolDigest,
  })
}

function parsePeerTransferChunkHeader(value: unknown): PeerTransferChunkHeader {
  if (!isPlainDataObject(value)) throw new Error("PeerTransferChunkHeader must be a plain object")
  assertExactKeys(value, ["format", "transferId", "manifestDigest", "chunkIndex", "byteOffset", "byteLength", "chunkSha256"], "PeerTransferChunkHeader")
  if (value.format !== "convax.peer-transfer-chunk") throw new Error("Peer transfer chunk header format is invalid")
  return Object.freeze({
    format: value.format,
    transferId: parseId128(value.transferId),
    manifestDigest: parseDigest(value.manifestDigest),
    chunkIndex: parseUint32(value.chunkIndex),
    byteOffset: parseUint64(value.byteOffset),
    byteLength: parseUint32(value.byteLength),
    chunkSha256: parseDigest(value.chunkSha256),
  })
}

function validateBodyCapAndKind(channel: PeerChannelName, bodyKind: PeerBodyKind, bodyLength: number): void {
  const policy = PEER_CHANNEL_CONTRACT.policies.find((candidate) => candidate.channel === channel)
  if (!policy || bodyLength === 0 || BigInt(bodyLength) > BigInt(policy.maxBodyBytes)) throw new Error("Peer message body exceeds channel bounds")
  const expectedPrefix = `${channel}.`
  if (!bodyKind.startsWith(expectedPrefix)) throw new Error("Peer message body kind does not match channel")
  if (channel === "update" && bodyKind !== "update.transfer-chunk") throw new Error("Update channel accepts only transfer chunks")
  if (channel === "blob" && bodyKind !== "blob.transfer-chunk") throw new Error("Blob channel accepts only transfer chunks")
}

function requireStrictDecodedDigestOrder(digests: readonly Digest[], label: string): void {
  for (let index = 1; index < digests.length; index += 1) {
    if (compareBytes(hexDigestBytes(digests[index - 1]!), hexDigestBytes(digests[index]!)) >= 0) {
      throw new Error(`${label} must be strictly sorted and duplicate-free`)
    }
  }
}

function hexDigestBytes(digest: Digest): Uint8Array {
  return Uint8Array.from(digest.match(/../gu)!, (byte) => Number.parseInt(byte, 16))
}

function cloneBytes(bytes: Readonly<Uint8Array>): Uint8Array {
  if (!(bytes instanceof Uint8Array)) throw new Error("Peer wire bytes must be Uint8Array")
  return new Uint8Array(bytes)
}

function parsePeerChannel(value: unknown): PeerChannelName {
  if (value === "control" || value === "update" || value === "blob" || value === "awareness") return value
  throw new Error("Peer channel is invalid")
}

function parsePeerBodyKind(value: unknown): PeerBodyKind {
  const values: readonly PeerBodyKind[] = [
    "control.inventory-root", "control.inventory-page", "control.object-request", "control.blob-have-query",
    "control.blob-have-response", "control.transfer-offer", "control.transfer-accept", "control.transfer-ack",
    "control.transfer-nack", "control.transfer-cancel", "control.authorization-notice", "update.transfer-chunk",
    "blob.transfer-chunk", "awareness.presence", "awareness.cursor", "awareness.selection",
    "awareness.gesture-hint", "awareness.clear",
  ]
  if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as PeerBodyKind
  throw new Error("Peer body kind is invalid")
}

function parsePeerObjectKind(value: unknown): PeerObjectKind {
  const values: readonly PeerObjectKind[] = ["frame", "checkpoint", "certificate", "cutoff", "registry-page", "causal-frontier", "actor-head-set", "state-vector", "blob"]
  if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as PeerObjectKind
  throw new Error("Peer object kind is invalid")
}

function parsePeerTransferKind(value: unknown): PeerTransferKind {
  const values: readonly PeerTransferKind[] = ["causal-frame", "checkpoint", "validation-suffix", "registry-page", "causal-frontier", "actor-head-set", "state-vector", "project-blob"]
  if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as PeerTransferKind
  throw new Error("Peer transfer kind is invalid")
}

function parsePeerTransferErrorCode(value: unknown): PeerTransferErrorCode {
  const values: readonly PeerTransferErrorCode[] = ["manifest-invalid", "scope-mismatch", "unsupported-kind", "dependency-missing", "capacity-exceeded", "chunk-invalid", "hash-mismatch", "validation-rejected", "durability-failed", "authorization-closed"]
  if (typeof value === "string" && (values as readonly string[]).includes(value)) return value as PeerTransferErrorCode
  throw new Error("Peer transfer error code is invalid")
}

function parseTransferCancelReason(value: unknown): "caller-cancelled" | "scope-closed" | "superseded" | "capacity" {
  if (value === "caller-cancelled" || value === "scope-closed" || value === "superseded" || value === "capacity") return value
  throw new Error("Peer transfer cancellation reason is invalid")
}

function invalid(message: string): never {
  throw new Error(message)
}
