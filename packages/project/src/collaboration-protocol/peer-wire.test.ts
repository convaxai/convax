import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  ordinarySha256,
  parseDigest,
  parseId128,
  parseProjectId,
  parseSignature,
  parseUint32,
  parseUint64,
} from "@convax/collaboration"

import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES,
  createPeerTransferManifest,
  decodePeerControlBody,
  decodePeerTransferChunk,
  encodePeerControlBody,
  encodePeerTransferChunk,
  peerControlCodec,
  peerTransferChunkHeaderDigest,
  type PeerTransferChunkHeader,
} from "../collaboration-protocol"

const encoder = new TextEncoder()
const id = (fill: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(fill)))
const digest = (label: string) => ordinarySha256(encoder.encode(label))
const signature = parseSignature(encodeBase64url(Uint8Array.from({ length: 64 }, (_, index) => index === 0 || index === 32 ? 2 : 0)))
const connectionId = id(1)

function header(raw: Uint8Array, overrides: Partial<PeerTransferChunkHeader> = {}): PeerTransferChunkHeader {
  return {
    format: "convax.peer-transfer-chunk",
    transferId: id(2),
    manifestDigest: digest("manifest"),
    chunkIndex: parseUint32("0"),
    byteOffset: parseUint64("0"),
    byteLength: parseUint32(String(raw.byteLength)),
    chunkSha256: ordinarySha256(raw),
    ...overrides,
  }
}

describe("Exact Peer wire codec", () => {
  test("encodes CVXPEER2 with exact core, raw signature and body then decodes without parsing the body", async () => {
    const body = encodePeerControlBody({
      format: "convax.peer-control",
      kind: "object-request",
      requestId: id(3),
      objectKind: "frame",
      digests: [digest("a"), digest("b")].sort(),
    })
    const wire = await peerControlCodec.createMessageWire({
      connectionId,
      channelOpenDigest: digest("channel-open"),
      channel: "control",
      senderCredentialDigest: digest("sender"),
      receiverCredentialDigest: digest("receiver"),
      messageSequence: parseUint64("1"),
      bodyKind: "control.object-request",
      body,
      signCoreDigest: ({ coreDigest }) => {
        expect(coreDigest).toMatch(/^[0-9a-f]{64}$/)
        return signature
      },
    })

    expect(new TextDecoder().decode(wire.subarray(0, 8))).toBe("CVXPEER2")
    expect(wire[8]).toBe(1)
    expect(wire[9]).toBe(0)
    const decoded = peerControlCodec.decodeMessageWire(wire)
    expect(decoded.core.messageSequence).toBe(parseUint64("1"))
    expect(decoded.core.bodyLength).toBe(parseUint64(String(body.byteLength)))
    expect(decoded.senderSessionSignature).toBe(signature)
    expect(decoded.body).toEqual(body)
    expect(peerControlCodec.decodeControlBody(decoded.body, decoded.core.bodyKind)).toEqual({
      format: "convax.peer-control",
      kind: "object-request",
      requestId: id(3),
      objectKind: "frame",
      digests: [digest("a"), digest("b")].sort(),
    })

    const tampered = wire.slice()
    tampered[tampered.length - 1] ^= 1
    expect(() => peerControlCodec.decodeMessageWire(tampered)).toThrow("body digest mismatches")
  })

  test("enforces exact control 64 KiB and update raw/full chunk limits", async () => {
    const common = {
      connectionId,
      channelOpenDigest: digest("channel-open"),
      senderCredentialDigest: digest("sender"),
      receiverCredentialDigest: digest("receiver"),
      messageSequence: parseUint64("1"),
      signCoreDigest: () => signature,
    }
    await expect(peerControlCodec.createMessageWire({
      ...common,
      channel: "control",
      bodyKind: "control.object-request",
      body: new Uint8Array(64 * 1024),
    })).resolves.toBeInstanceOf(Uint8Array)
    await expect(peerControlCodec.createMessageWire({
      ...common,
      channel: "control",
      bodyKind: "control.object-request",
      body: new Uint8Array(64 * 1024 + 1),
    })).rejects.toThrow("channel bounds")

    const exact = new Uint8Array(256 * 1024).fill(9)
    const encoded = encodePeerTransferChunk(header(exact), exact, "update")
    expect(encoded.byteLength).toBeLessThanOrEqual(260 * 1024)
    expect(decodePeerTransferChunk(encoded, "update").rawChunk).toEqual(exact)
    const plusOne = new Uint8Array(256 * 1024 + 1)
    expect(() => encodePeerTransferChunk(header(plusOne), plusOne, "update")).toThrow("raw chunk")
  })

  test("closes manifest mapping, exact ceiling and chunk integrity", () => {
    const bytes = encoder.encode("exact final causal frame bytes")
    const manifest = createPeerTransferManifest({
      format: "convax.peer-transfer-manifest-core",
      connectionId,
      transferId: id(4),
      channel: "update",
      kind: "causal-frame",
      scope: { projectId: parseProjectId("project"), projectEpoch: id(5), docKind: "project-index", docId: "project-index", shardEpoch: id(6) },
      subjectDigest: digest("frame"),
      byteLength: parseUint64(String(bytes.byteLength)),
      sha256: ordinarySha256(bytes),
      chunkBytes: parseUint32("8"),
      chunkCount: parseUint32(String(Math.ceil(bytes.byteLength / 8))),
      compression: "none",
      protocolDigest: parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES.protocolDigest),
    })
    expect(manifest.coreDigest).toMatch(/^[0-9a-f]{64}$/)

    expect(() => createPeerTransferManifest({ ...manifest.core, chunkCount: parseUint32("1") })).toThrow("exact ceiling")
    expect(() => createPeerTransferManifest({ ...manifest.core, channel: "blob" })).toThrow("channel/kind mapping")

    const first = bytes.subarray(0, 8)
    const exactHeader = header(first, { transferId: manifest.core.transferId, manifestDigest: manifest.coreDigest })
    expect(peerTransferChunkHeaderDigest(exactHeader)).toMatch(/^[0-9a-f]{64}$/)
    const encoded = encodePeerTransferChunk(exactHeader, first, "update")
    const tampered = encoded.slice()
    tampered[tampered.length - 1] ^= 1
    expect(() => decodePeerTransferChunk(tampered, "update")).toThrow("SHA-256")
  })

  test("rejects noncanonical object requests and discriminator substitution", () => {
    const repeated = digest("same")
    expect(() => encodePeerControlBody({
      format: "convax.peer-control",
      kind: "object-request",
      requestId: id(6),
      objectKind: "frame",
      digests: [repeated, repeated],
    })).toThrow("strictly sorted")

    const offer = encodePeerControlBody({
      format: "convax.peer-control",
      kind: "transfer-accept",
      transferId: id(7),
      manifestDigest: digest("manifest"),
    })
    expect(() => decodePeerControlBody(offer, "control.transfer-ack")).toThrow("discriminator")
  })
})
