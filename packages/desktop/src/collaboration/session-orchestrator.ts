import {
  documentScopeDigest,
  encodeBase64url,
  ordinarySha256,
  parseDigest,
  parseDocumentScope,
  parseId128,
  parseUint32,
  parseUint64,
  type Digest,
  type DocumentScope,
  type Id128,
  type IncomingFrameResult,
  type Signature,
} from "@convax/collaboration"
import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2,
  peerControlCodecV2,
  createPeerTransferManifestV2,
  type DecodedPeerMessageEnvelopeV2,
  type PeerBodyKindV2,
  type PeerChannelNameV2,
  type PeerControlBodySubsetV2,
  type PeerControlCodecV2,
  type PeerTransferChunkHeaderV2,
  type PeerTransferManifestV2,
} from "@convax/project/collaboration-protocol"

import type {
  CollaborationPeerWireIngress,
  CollaborationPeerChannel,
} from "./peerjs-transport"

const maximumInflightTransfersPerPeer = 4
const maximumRememberedTransfersPerPeer = 4_096
const causalFrameChunkBytes = 256 * 1024

export interface CollaborationSessionDataPlaneV2 {
  connect(peerId: string): void
  sendHandshakeWireBytes(peerId: string, exactHandshakeBytes: Uint8Array): boolean
  sendPeerWireBytes(peerId: string, channel: CollaborationPeerChannel, exactPeerWireBytes: Uint8Array): boolean
  markHandshakeComplete(peerId: string): boolean
  setOnline(online: boolean): void
  closePeer(peerId: string): void
  dispose(): void
}

export interface CollaborationSessionDataPlaneLifecycleV2 {
  onRouteReady(peerId: string): void
  onRouteReset(peerId: string): void
}

/**
 * Exact result of the already-verified R5 handshake plus its four independently
 * verified channel opens. PeerJS metadata and peerId are never a substitute.
 */
export interface CollaborationPeerSessionPrincipalV2 {
  readonly connectionId: Id128
  readonly localCredentialDigest: Digest
  readonly remoteCredentialDigest: Digest
  readonly channelOpenDigests: Readonly<Record<PeerChannelNameV2, Digest>>
  signMessageCoreDigest(input: {
    readonly channel: PeerChannelNameV2
    readonly coreDigest: Digest
  }): Promise<Signature> | Signature
  verifyRemoteMessageCoreDigest(input: {
    readonly channel: PeerChannelNameV2
    readonly coreDigest: Digest
    readonly signature: Signature
  }): Promise<boolean> | boolean
}

export interface CollaborationPeerAdmissionV2 {
  /** Exact R5 handshake/channel-open carrier chosen by the Main admission owner. */
  localHandshake(peerId: string): Promise<Uint8Array> | Uint8Array
  /** Returns the verified connection/channel principal, never a boolean identity hint. */
  verifyRemoteHandshake(
    peerId: string,
    exactBytes: Readonly<Uint8Array>,
  ): Promise<CollaborationPeerSessionPrincipalV2 | "rejected"> | CollaborationPeerSessionPrincipalV2 | "rejected"
}

export interface CollaborationKernelFrameAdmissionV2 {
  readonly result: IncomingFrameResult
  /** Required only when result is accepted/duplicate and already durably reconstructed. */
  readonly replicaDurableAckCoreDigest: Digest | null
}

/** Main-only seam around one owner-composed CollaborationKernel registry entry. */
export interface CollaborationKernelEndpointV2 {
  readonly scope: DocumentScope
  receiveFrame(exactCausalFrameBytes: Readonly<Uint8Array>): Promise<CollaborationKernelFrameAdmissionV2>
  loadDurableFrame(frameDigest: Digest): Promise<Readonly<Uint8Array> | null>
  recordDurableAck(input: {
    readonly peerId: string
    readonly frameDigest: Digest
    readonly replicaDurableAckCoreDigest: Digest
  }): Promise<void>
}

export interface CollaborationSessionOrchestratorOptionsV2 {
  readonly localPeerId: string
  readonly createDataPlane: (input: {
    ingress: CollaborationPeerWireIngress
    lifecycle: CollaborationSessionDataPlaneLifecycleV2
  }) => CollaborationSessionDataPlaneV2
  readonly admission: CollaborationPeerAdmissionV2
  /** Production injects the exact Project protocol export; tests may inject a fake. */
  readonly peerCodec?: PeerControlCodecV2
  readonly createProtocolId?: () => Id128
  readonly awareness?: {
    receive(input: {
      readonly peerId: string
      readonly bodyKind: Extract<PeerBodyKindV2, `awareness.${string}`>
      readonly exactBodyBytes: Readonly<Uint8Array>
    }): void | Promise<void>
  }
  readonly blob?: {
    receiveChunk(input: {
      readonly peerId: string
      readonly message: DecodedPeerMessageEnvelopeV2
      readonly exactChunkBodyBytes: Readonly<Uint8Array>
    }): void | Promise<void>
  }
  readonly onError?: (input: {
    readonly peerId?: string
    readonly channel?: CollaborationPeerChannel
    readonly reason:
      | "admission-rejected"
      | "peer-wire-invalid"
      | "peer-signature-invalid"
      | "peer-sequence-invalid"
      | "peer-principal-mismatch"
      | "control-invalid"
      | "transfer-capacity"
      | "transfer-equivocation"
      | "transfer-invalid"
      | "frame-mismatch"
      | "frame-send-failed"
      | "durable-ack-invalid"
      | "endpoint-failed"
  }) => void
}

interface PendingFrameV2 {
  readonly scopeKey: Digest
  readonly frameDigest: Digest
}

interface OutboundTransferV2 {
  readonly pending: PendingFrameV2
  readonly manifest: PeerTransferManifestV2
  readonly exactFrameBytes: Uint8Array
  state: "offered" | "accepted" | "awaiting-ack"
}

interface InboundTransferV2 {
  readonly manifest: PeerTransferManifestV2
  readonly chunks: Uint8Array[]
  receivedBytes: number
  nextChunkIndex: number
}

interface CompletedInboundTransferV2 {
  readonly manifestDigest: Digest
  readonly durabilityProofDigest: Digest
}

interface PeerSessionRouteV2 {
  readonly peerId: string
  desired: boolean
  admitted: boolean
  handshakeSent: boolean
  principal?: CollaborationPeerSessionPrincipalV2
  readonly outboundSequence: Record<PeerChannelNameV2, bigint>
  readonly inboundSequence: Record<PeerChannelNameV2, bigint>
  readonly pendingFrames: Map<string, PendingFrameV2>
  readonly outboundTransfers: Map<Id128, OutboundTransferV2>
  readonly outboundTransferByFrame: Map<string, Id128>
  readonly inboundTransfers: Map<Id128, InboundTransferV2>
  readonly seenTransferManifestById: Map<Id128, Digest>
  readonly completedInbound: Map<Id128, CompletedInboundTransferV2>
}

export class CollaborationSessionOrchestratorV2 {
  readonly #localPeerId: string
  readonly #admission: CollaborationPeerAdmissionV2
  readonly #codec: PeerControlCodecV2
  readonly #createProtocolId: () => Id128
  readonly #awareness?: CollaborationSessionOrchestratorOptionsV2["awareness"]
  readonly #blob?: CollaborationSessionOrchestratorOptionsV2["blob"]
  readonly #onError?: CollaborationSessionOrchestratorOptionsV2["onError"]
  readonly #transport: CollaborationSessionDataPlaneV2
  readonly #endpoints = new Map<Digest, CollaborationKernelEndpointV2>()
  readonly #routes = new Map<string, PeerSessionRouteV2>()
  readonly #lanes = new Map<string, Promise<void>>()
  #disposed = false

  constructor(options: CollaborationSessionOrchestratorOptionsV2) {
    requirePeerRouteId(options.localPeerId)
    this.#localPeerId = options.localPeerId
    this.#admission = options.admission
    this.#codec = options.peerCodec ?? peerControlCodecV2
    this.#createProtocolId = options.createProtocolId ?? createRandomProtocolId
    this.#awareness = options.awareness
    this.#blob = options.blob
    this.#onError = options.onError
    this.#transport = options.createDataPlane({
      ingress: {
        receivePeerWireBytes: (input) => {
          const bytes = new Uint8Array(input.wireBytes)
          this.#enqueue(input.peerId, input.channel, async () => {
            if (input.purpose === "handshake") await this.#receiveHandshake(input.peerId, bytes)
            else await this.#receivePeerWire(input.peerId, input.channel, bytes)
          })
        },
      },
      lifecycle: {
        onRouteReady: (peerId) => this.#enqueue(peerId, "control", () => this.#onRouteReady(peerId)),
        onRouteReset: (peerId) => this.#resetRoute(peerId),
      },
    })
  }

  registerEndpoint(endpoint: CollaborationKernelEndpointV2): () => void {
    this.#assertLive()
    const scope = parseDocumentScope(endpoint.scope)
    const scopeKey = documentScopeDigest(scope)
    if (this.#endpoints.has(scopeKey)) throw new Error("Collaboration endpoint scope is already registered")
    this.#endpoints.set(scopeKey, endpoint)
    return () => {
      if (this.#endpoints.get(scopeKey) !== endpoint) return
      this.#endpoints.delete(scopeKey)
      for (const route of this.#routes.values()) {
        for (const [key, pending] of route.pendingFrames) if (pending.scopeKey === scopeKey) route.pendingFrames.delete(key)
      }
    }
  }

  connectPeer(peerId: string): void {
    this.#assertLive()
    requirePeerRouteId(peerId)
    if (peerId === this.#localPeerId) throw new Error("Cannot connect collaboration session to itself")
    const route = this.#route(peerId)
    route.desired = true
    this.#transport.connect(peerId)
  }

  /** Retains only a durable object identity while offline; exact bytes are reloaded for every offer. */
  async announceLocalFrame(scopeInput: DocumentScope, frameDigestInput: Digest): Promise<void> {
    this.#assertLive()
    const scopeKey = documentScopeDigest(parseDocumentScope(scopeInput))
    const frameDigest = parseDigest(frameDigestInput)
    const endpoint = this.#endpoints.get(scopeKey)
    if (!endpoint || await endpoint.loadDurableFrame(frameDigest) === null) throw new Error("Only an exact durable causal frame can be announced")
    const pending = Object.freeze({ scopeKey, frameDigest })
    for (const route of this.#routes.values()) {
      if (!route.desired) continue
      route.pendingFrames.set(frameKey(pending), pending)
      if (route.admitted) await this.#offerPendingFrame(route, pending)
    }
  }

  /**
   * Starts known-object reconciliation without inventing an inventory root/page.
   * Full inventory discovery stays absent from this production API.
   */
  async requestFrames(peerId: string, frameDigests: readonly Digest[]): Promise<boolean> {
    const route = this.#routes.get(peerId)
    if (!route?.admitted) return false
    const digests = [...frameDigests].map(parseDigest).sort()
    if (digests.length === 0 || digests.length > 256 || new Set(digests).size !== digests.length) throw new Error("Frame request digests are invalid")
    return this.#sendControl(route, {
      format: "convax.peer-control/2",
      kind: "object-request",
      requestId: parseId128(this.#createProtocolId()),
      objectKind: "frame",
      digests: Object.freeze(digests),
    })
  }

  async publishAwareness(
    peerId: string,
    bodyKind: Extract<PeerBodyKindV2, `awareness.${string}`>,
    exactCanonicalBodyBytes: Readonly<Uint8Array>,
  ): Promise<boolean> {
    const route = this.#routes.get(peerId)
    if (!route?.admitted) return false
    return this.#sendPeerMessage(route, "awareness", bodyKind, exactCanonicalBodyBytes)
  }

  setOnline(online: boolean): void {
    if (this.#disposed) return
    if (!online) for (const route of this.#routes.values()) this.#resetRoute(route.peerId)
    this.#transport.setOnline(online)
  }

  closePeer(peerId: string): void {
    const route = this.#routes.get(peerId)
    if (!route) return
    route.desired = false
    this.#transport.closePeer(peerId)
    this.#routes.delete(peerId)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#transport.dispose()
    this.#routes.clear()
    this.#endpoints.clear()
    this.#lanes.clear()
  }

  async idle(): Promise<void> {
    while (this.#lanes.size > 0) await Promise.all([...this.#lanes.values()])
  }

  async #onRouteReady(peerId: string): Promise<void> {
    if (this.#disposed) return
    const route = this.#route(peerId)
    if (!route.desired) route.desired = true
    await this.#sendHandshake(route)
  }

  #resetRoute(peerId: string): void {
    const route = this.#routes.get(peerId)
    if (!route) return
    route.admitted = false
    route.handshakeSent = false
    route.principal = undefined
    resetSequences(route.outboundSequence)
    resetSequences(route.inboundSequence)
    route.outboundTransfers.clear()
    route.outboundTransferByFrame.clear()
    route.inboundTransfers.clear()
  }

  async #sendHandshake(route: PeerSessionRouteV2): Promise<void> {
    if (route.handshakeSent || this.#disposed) return
    const bytes = new Uint8Array(await this.#admission.localHandshake(route.peerId))
    route.handshakeSent = this.#transport.sendHandshakeWireBytes(route.peerId, bytes)
  }

  async #receiveHandshake(peerId: string, exactBytes: Uint8Array): Promise<void> {
    const principal = await this.#admission.verifyRemoteHandshake(peerId, exactBytes)
    if (principal === "rejected") {
      this.#report(peerId, "control", "admission-rejected")
      return
    }
    const parsed = parseSessionPrincipal(principal)
    const route = this.#route(peerId)
    if (!route.desired) {
      route.desired = true
      this.#transport.connect(peerId)
    }
    if (!route.handshakeSent) await this.#sendHandshake(route)
    if (!this.#transport.markHandshakeComplete(peerId)) return
    if (route.principal && !samePrincipal(route.principal, parsed)) {
      this.#failRoute(route, "control", "peer-principal-mismatch")
      return
    }
    route.principal = parsed
    route.admitted = true
    resetSequences(route.outboundSequence)
    resetSequences(route.inboundSequence)
    for (const pending of route.pendingFrames.values()) await this.#offerPendingFrame(route, pending)
  }

  async #receivePeerWire(peerId: string, physicalChannel: CollaborationPeerChannel, exactWireBytes: Uint8Array): Promise<void> {
    const route = this.#routes.get(peerId)
    const principal = route?.principal
    if (!route?.admitted || !principal) return
    let message: DecodedPeerMessageEnvelopeV2
    try {
      message = this.#codec.decodeMessageWire(exactWireBytes)
    } catch {
      this.#failRoute(route, physicalChannel, "peer-wire-invalid")
      return
    }
    if (message.core.channel !== physicalChannel
      || message.core.connectionId !== principal.connectionId
      || message.core.channelOpenDigest !== principal.channelOpenDigests[physicalChannel]
      || message.core.senderCredentialDigest !== principal.remoteCredentialDigest
      || message.core.receiverCredentialDigest !== principal.localCredentialDigest) {
      this.#failRoute(route, physicalChannel, "peer-principal-mismatch")
      return
    }
    if (!await principal.verifyRemoteMessageCoreDigest({
      channel: physicalChannel,
      coreDigest: message.coreDigest,
      signature: message.senderSessionSignature,
    })) {
      this.#failRoute(route, physicalChannel, "peer-signature-invalid")
      return
    }
    const sequence = BigInt(message.core.messageSequence)
    const highWater = route.inboundSequence[physicalChannel]
    if (physicalChannel === "awareness" ? sequence <= highWater : sequence !== highWater + 1n) {
      this.#failRoute(route, physicalChannel, "peer-sequence-invalid")
      return
    }
    route.inboundSequence[physicalChannel] = sequence

    if (physicalChannel === "control") await this.#receiveControl(route, message)
    else if (physicalChannel === "update") await this.#receiveUpdateChunk(route, message)
    else if (physicalChannel === "blob") await this.#blob?.receiveChunk({ peerId, message, exactChunkBodyBytes: message.body })
    else await this.#awareness?.receive({
      peerId,
      bodyKind: message.core.bodyKind as Extract<PeerBodyKindV2, `awareness.${string}`>,
      exactBodyBytes: message.body,
    })
  }

  async #receiveControl(route: PeerSessionRouteV2, message: DecodedPeerMessageEnvelopeV2): Promise<void> {
    let body: PeerControlBodySubsetV2
    try {
      body = this.#codec.decodeControlBody(message.body, message.core.bodyKind)
    } catch {
      this.#failRoute(route, "control", "control-invalid")
      return
    }
    switch (body.kind) {
      case "object-request":
        if (body.objectKind !== "frame") return
        for (const digest of body.digests) {
          const pending = await this.#findDurableFrame(digest)
          if (pending) await this.#offerPendingFrame(route, pending)
        }
        return
      case "transfer-offer":
        await this.#acceptTransferOffer(route, body.manifest)
        return
      case "transfer-accept":
        await this.#sendAcceptedTransfer(route, body.transferId, body.manifestDigest)
        return
      case "transfer-ack":
        await this.#acceptTransferAck(route, body.transferId, body.manifestDigest, body.durabilityProofDigest)
        return
      case "transfer-nack":
      case "transfer-cancel":
        this.#dropOutboundTransfer(route, body.transferId, body.manifestDigest)
    }
  }

  async #offerPendingFrame(route: PeerSessionRouteV2, pending: PendingFrameV2): Promise<void> {
    const principal = route.principal
    const endpoint = this.#endpoints.get(pending.scopeKey)
    const key = frameKey(pending)
    if (!route.admitted || !principal || !endpoint || route.outboundTransferByFrame.has(key)) return
    if (route.outboundTransfers.size >= maximumInflightTransfersPerPeer) {
      this.#report(route.peerId, "control", "transfer-capacity")
      return
    }
    try {
      const loaded = await endpoint.loadDurableFrame(pending.frameDigest)
      if (loaded === null) return
      const exactFrameBytes = new Uint8Array(loaded)
      const manifest = createPeerTransferManifestV2({
        format: "convax.peer-transfer-manifest-core/2",
        connectionId: principal.connectionId,
        transferId: parseId128(this.#createProtocolId()),
        channel: "update",
        kind: "causal-frame",
        scope: parseDocumentScope(endpoint.scope),
        subjectDigest: pending.frameDigest,
        byteLength: parseUint64(String(exactFrameBytes.byteLength)),
        sha256: ordinarySha256(exactFrameBytes),
        chunkBytes: parseUint32(String(Math.min(causalFrameChunkBytes, exactFrameBytes.byteLength))),
        chunkCount: parseUint32(String(Math.ceil(exactFrameBytes.byteLength / causalFrameChunkBytes))),
        compression: "none",
        protocolDigest: parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest),
      })
      const transfer: OutboundTransferV2 = { pending, manifest, exactFrameBytes, state: "offered" }
      route.outboundTransfers.set(manifest.core.transferId, transfer)
      route.outboundTransferByFrame.set(key, manifest.core.transferId)
      if (!await this.#sendControl(route, { format: "convax.peer-control/2", kind: "transfer-offer", manifest })) {
        this.#dropOutboundTransfer(route, manifest.core.transferId, manifest.coreDigest)
      }
    } catch {
      this.#report(route.peerId, "control", "endpoint-failed")
    }
  }

  async #acceptTransferOffer(route: PeerSessionRouteV2, manifest: PeerTransferManifestV2): Promise<void> {
    const principal = route.principal
    if (!principal || manifest.core.connectionId !== principal.connectionId) {
      this.#failRoute(route, "control", "peer-principal-mismatch")
      return
    }
    const previousDigest = route.seenTransferManifestById.get(manifest.core.transferId)
    if (previousDigest && previousDigest !== manifest.coreDigest) {
      this.#failRoute(route, "control", "transfer-equivocation")
      return
    }
    rememberTransfer(route, manifest.core.transferId, manifest.coreDigest)
    const completed = route.completedInbound.get(manifest.core.transferId)
    if (completed?.manifestDigest === manifest.coreDigest) {
      await this.#sendControl(route, {
        format: "convax.peer-control/2",
        kind: "transfer-ack",
        transferId: manifest.core.transferId,
        manifestDigest: manifest.coreDigest,
        durabilityProofDigest: completed.durabilityProofDigest,
      })
      return
    }
    const existing = route.inboundTransfers.get(manifest.core.transferId)
    if (existing) {
      await this.#sendControl(route, { format: "convax.peer-control/2", kind: "transfer-accept", transferId: manifest.core.transferId, manifestDigest: manifest.coreDigest })
      return
    }
    const scope = manifest.core.scope
    if (manifest.core.kind !== "causal-frame" || manifest.core.channel !== "update" || !scope) {
      await this.#sendNack(route, manifest, "unsupported-kind")
      return
    }
    const scopeKey = documentScopeDigest(scope)
    if (!this.#endpoints.has(scopeKey)) {
      await this.#sendNack(route, manifest, "scope-mismatch")
      return
    }
    if (route.inboundTransfers.size >= maximumInflightTransfersPerPeer) {
      await this.#sendNack(route, manifest, "capacity-exceeded")
      return
    }
    route.inboundTransfers.set(manifest.core.transferId, { manifest, chunks: [], receivedBytes: 0, nextChunkIndex: 0 })
    await this.#sendControl(route, { format: "convax.peer-control/2", kind: "transfer-accept", transferId: manifest.core.transferId, manifestDigest: manifest.coreDigest })
  }

  async #sendAcceptedTransfer(route: PeerSessionRouteV2, transferId: Id128, manifestDigest: Digest): Promise<void> {
    const transfer = route.outboundTransfers.get(transferId)
    if (!transfer || transfer.manifest.coreDigest !== manifestDigest) return
    transfer.state = "accepted"
    const chunkBytes = Number(transfer.manifest.core.chunkBytes)
    for (let offset = 0, index = 0; offset < transfer.exactFrameBytes.byteLength; offset += chunkBytes, index += 1) {
      const rawChunk = transfer.exactFrameBytes.slice(offset, Math.min(offset + chunkBytes, transfer.exactFrameBytes.byteLength))
      const header: PeerTransferChunkHeaderV2 = {
        format: "convax.peer-transfer-chunk/2",
        transferId,
        manifestDigest,
        chunkIndex: parseUint32(String(index)),
        byteOffset: parseUint64(String(offset)),
        byteLength: parseUint32(String(rawChunk.byteLength)),
        chunkSha256: ordinarySha256(rawChunk),
      }
      const body = this.#codec.encodeTransferChunk(header, rawChunk, "update")
      if (!await this.#sendPeerMessage(route, "update", "update.transfer-chunk", body)) {
        this.#report(route.peerId, "update", "frame-send-failed")
        return
      }
    }
    transfer.state = "awaiting-ack"
  }

  async #receiveUpdateChunk(route: PeerSessionRouteV2, message: DecodedPeerMessageEnvelopeV2): Promise<void> {
    let decoded
    try {
      decoded = this.#codec.decodeTransferChunk(message.body, "update")
    } catch {
      this.#failRoute(route, "update", "transfer-invalid")
      return
    }
    const transfer = route.inboundTransfers.get(decoded.header.transferId)
    if (!transfer) {
      const completed = route.completedInbound.get(decoded.header.transferId)
      if (completed?.manifestDigest === decoded.header.manifestDigest) return
      this.#failRoute(route, "update", "transfer-invalid")
      return
    }
    if (transfer.manifest.coreDigest !== decoded.header.manifestDigest) {
      this.#failRoute(route, "update", "transfer-invalid")
      return
    }
    const index = Number(decoded.header.chunkIndex)
    const offset = BigInt(decoded.header.byteOffset)
    if (index < transfer.nextChunkIndex) {
      const previous = transfer.chunks[index]
      if (!previous || !sameBytes(previous, decoded.rawChunk)) this.#failRoute(route, "update", "transfer-equivocation")
      return
    }
    if (index !== transfer.nextChunkIndex || offset !== BigInt(transfer.receivedBytes)) {
      this.#failRoute(route, "update", "transfer-invalid")
      return
    }
    transfer.chunks.push(new Uint8Array(decoded.rawChunk))
    transfer.receivedBytes += decoded.rawChunk.byteLength
    transfer.nextChunkIndex += 1
    if (transfer.nextChunkIndex < Number(transfer.manifest.core.chunkCount)) return
    await this.#completeInboundTransfer(route, transfer)
  }

  async #completeInboundTransfer(route: PeerSessionRouteV2, transfer: InboundTransferV2): Promise<void> {
    const manifest = transfer.manifest
    const exact = concatenate(transfer.chunks, transfer.receivedBytes)
    if (BigInt(exact.byteLength) !== BigInt(manifest.core.byteLength) || ordinarySha256(exact) !== manifest.core.sha256) {
      route.inboundTransfers.delete(manifest.core.transferId)
      await this.#sendNack(route, manifest, "hash-mismatch")
      return
    }
    const scope = manifest.core.scope
    const endpoint = scope ? this.#endpoints.get(documentScopeDigest(scope)) : undefined
    if (!endpoint) {
      route.inboundTransfers.delete(manifest.core.transferId)
      await this.#sendNack(route, manifest, "scope-mismatch")
      return
    }
    try {
      // The exact reassembled final frame is admitted before any durable ACK.
      const admission = await endpoint.receiveFrame(exact)
      if (admission.result.frame.frameDigest !== manifest.core.subjectDigest) {
        route.inboundTransfers.delete(manifest.core.transferId)
        this.#report(route.peerId, "update", "frame-mismatch")
        await this.#sendNack(route, manifest, "validation-rejected")
        return
      }
      if (admission.result.status === "dependency-pending") {
        route.inboundTransfers.delete(manifest.core.transferId)
        await this.#sendNack(route, manifest, "dependency-missing")
        return
      }
      if (!admission.replicaDurableAckCoreDigest) {
        route.inboundTransfers.delete(manifest.core.transferId)
        this.#report(route.peerId, "control", "durable-ack-invalid")
        await this.#sendNack(route, manifest, "durability-failed")
        return
      }
      const durabilityProofDigest = parseDigest(admission.replicaDurableAckCoreDigest)
      route.inboundTransfers.delete(manifest.core.transferId)
      route.completedInbound.set(manifest.core.transferId, { manifestDigest: manifest.coreDigest, durabilityProofDigest })
      trimMap(route.completedInbound, maximumRememberedTransfersPerPeer)
      await this.#sendControl(route, {
        format: "convax.peer-control/2",
        kind: "transfer-ack",
        transferId: manifest.core.transferId,
        manifestDigest: manifest.coreDigest,
        durabilityProofDigest,
      })
    } catch {
      route.inboundTransfers.delete(manifest.core.transferId)
      this.#report(route.peerId, "update", "endpoint-failed")
      await this.#sendNack(route, manifest, "durability-failed")
    }
  }

  async #acceptTransferAck(
    route: PeerSessionRouteV2,
    transferId: Id128,
    manifestDigest: Digest,
    durabilityProofDigest: Digest | null,
  ): Promise<void> {
    const transfer = route.outboundTransfers.get(transferId)
    if (!transfer || transfer.manifest.coreDigest !== manifestDigest) return
    if (!durabilityProofDigest) {
      this.#report(route.peerId, "control", "durable-ack-invalid")
      return
    }
    const endpoint = this.#endpoints.get(transfer.pending.scopeKey)
    if (!endpoint) return
    try {
      await endpoint.recordDurableAck({
        peerId: route.peerId,
        frameDigest: transfer.pending.frameDigest,
        replicaDurableAckCoreDigest: parseDigest(durabilityProofDigest),
      })
      route.pendingFrames.delete(frameKey(transfer.pending))
      this.#dropOutboundTransfer(route, transferId, manifestDigest)
      for (const pending of route.pendingFrames.values()) await this.#offerPendingFrame(route, pending)
    } catch {
      this.#report(route.peerId, "control", "endpoint-failed")
    }
  }

  async #sendNack(route: PeerSessionRouteV2, manifest: PeerTransferManifestV2, code: Extract<PeerControlBodySubsetV2, { kind: "transfer-nack" }>["code"]): Promise<void> {
    await this.#sendControl(route, {
      format: "convax.peer-control/2",
      kind: "transfer-nack",
      transferId: manifest.core.transferId,
      manifestDigest: manifest.coreDigest,
      code,
    })
  }

  #dropOutboundTransfer(route: PeerSessionRouteV2, transferId: Id128, manifestDigest: Digest): void {
    const transfer = route.outboundTransfers.get(transferId)
    if (!transfer || transfer.manifest.coreDigest !== manifestDigest) return
    route.outboundTransfers.delete(transferId)
    route.outboundTransferByFrame.delete(frameKey(transfer.pending))
  }

  async #findDurableFrame(frameDigest: Digest): Promise<PendingFrameV2 | null> {
    for (const [scopeKey, endpoint] of this.#endpoints) {
      if (await endpoint.loadDurableFrame(frameDigest) !== null) return Object.freeze({ scopeKey, frameDigest })
    }
    return null
  }

  async #sendControl(route: PeerSessionRouteV2, body: PeerControlBodySubsetV2): Promise<boolean> {
    const exactBody = this.#codec.encodeControlBody(body)
    return this.#sendPeerMessage(route, "control", `control.${body.kind}`, exactBody)
  }

  async #sendPeerMessage(
    route: PeerSessionRouteV2,
    channel: PeerChannelNameV2,
    bodyKind: PeerBodyKindV2,
    exactBody: Readonly<Uint8Array>,
  ): Promise<boolean> {
    const principal = route.principal
    if (this.#disposed || !route.admitted || !principal) return false
    const nextSequence = route.outboundSequence[channel] + 1n
    if (nextSequence > 0xffff_ffff_ffff_ffffn) {
      this.#failRoute(route, channel, "peer-sequence-invalid")
      return false
    }
    const wire = await this.#codec.createMessageWire({
      connectionId: principal.connectionId,
      channelOpenDigest: principal.channelOpenDigests[channel],
      channel,
      senderCredentialDigest: principal.localCredentialDigest,
      receiverCredentialDigest: principal.remoteCredentialDigest,
      messageSequence: parseUint64(nextSequence.toString()),
      bodyKind,
      body: exactBody,
      signCoreDigest: ({ coreDigest }) => principal.signMessageCoreDigest({ channel, coreDigest }),
    })
    if (!this.#transport.sendPeerWireBytes(route.peerId, channel, wire)) return false
    route.outboundSequence[channel] = nextSequence
    return true
  }

  #route(peerId: string): PeerSessionRouteV2 {
    const existing = this.#routes.get(peerId)
    if (existing) return existing
    const route: PeerSessionRouteV2 = {
      peerId,
      desired: false,
      admitted: false,
      handshakeSent: false,
      outboundSequence: newSequenceRecord(),
      inboundSequence: newSequenceRecord(),
      pendingFrames: new Map(),
      outboundTransfers: new Map(),
      outboundTransferByFrame: new Map(),
      inboundTransfers: new Map(),
      seenTransferManifestById: new Map(),
      completedInbound: new Map(),
    }
    this.#routes.set(peerId, route)
    return route
  }

  #failRoute(route: PeerSessionRouteV2, channel: CollaborationPeerChannel, reason: Parameters<NonNullable<CollaborationSessionOrchestratorOptionsV2["onError"]>>[0]["reason"]): void {
    this.#report(route.peerId, channel, reason)
    this.#transport.closePeer(route.peerId)
    this.#resetRoute(route.peerId)
  }

  #enqueue(peerId: string, channel: CollaborationPeerChannel, task: () => Promise<void>): void {
    const key = `${peerId}:${channel}`
    const previous = this.#lanes.get(key) ?? Promise.resolve()
    const next = previous.then(task, task).catch(() => this.#report(peerId, channel, "endpoint-failed")).finally(() => {
      if (this.#lanes.get(key) === next) this.#lanes.delete(key)
    })
    this.#lanes.set(key, next)
  }

  #report(peerId: string | undefined, channel: CollaborationPeerChannel | undefined, reason: Parameters<NonNullable<CollaborationSessionOrchestratorOptionsV2["onError"]>>[0]["reason"]): void {
    this.#onError?.({ peerId, channel, reason })
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error("Collaboration session orchestrator is disposed")
  }
}

function parseSessionPrincipal(principal: CollaborationPeerSessionPrincipalV2): CollaborationPeerSessionPrincipalV2 {
  const channelOpenDigests = Object.freeze({
    control: parseDigest(principal.channelOpenDigests.control),
    update: parseDigest(principal.channelOpenDigests.update),
    blob: parseDigest(principal.channelOpenDigests.blob),
    awareness: parseDigest(principal.channelOpenDigests.awareness),
  })
  return Object.freeze({
    connectionId: parseId128(principal.connectionId),
    localCredentialDigest: parseDigest(principal.localCredentialDigest),
    remoteCredentialDigest: parseDigest(principal.remoteCredentialDigest),
    channelOpenDigests,
    signMessageCoreDigest: principal.signMessageCoreDigest,
    verifyRemoteMessageCoreDigest: principal.verifyRemoteMessageCoreDigest,
  })
}

function samePrincipal(left: CollaborationPeerSessionPrincipalV2, right: CollaborationPeerSessionPrincipalV2): boolean {
  return left.connectionId === right.connectionId
    && left.localCredentialDigest === right.localCredentialDigest
    && left.remoteCredentialDigest === right.remoteCredentialDigest
    && left.channelOpenDigests.control === right.channelOpenDigests.control
    && left.channelOpenDigests.update === right.channelOpenDigests.update
    && left.channelOpenDigests.blob === right.channelOpenDigests.blob
    && left.channelOpenDigests.awareness === right.channelOpenDigests.awareness
}

function frameKey(frame: PendingFrameV2): string {
  return `${frame.scopeKey}:${frame.frameDigest}`
}

function rememberTransfer(route: PeerSessionRouteV2, transferId: Id128, manifestDigest: Digest): void {
  route.seenTransferManifestById.set(transferId, manifestDigest)
  trimMap(route.seenTransferManifestById, maximumRememberedTransfersPerPeer)
}

function trimMap<K, V>(map: Map<K, V>, maximum: number): void {
  while (map.size > maximum) {
    const oldest = map.keys().next().value as K | undefined
    if (oldest === undefined) return
    map.delete(oldest)
  }
}

function newSequenceRecord(): Record<PeerChannelNameV2, bigint> {
  return { control: 0n, update: 0n, blob: 0n, awareness: 0n }
}

function resetSequences(sequences: Record<PeerChannelNameV2, bigint>): void {
  sequences.control = 0n
  sequences.update = 0n
  sequences.blob = 0n
  sequences.awareness = 0n
}

function concatenate(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
  const output = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function sameBytes(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>): boolean {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!
  return difference === 0
}

function requirePeerRouteId(peerId: string): void {
  if (typeof peerId !== "string" || peerId.length === 0 || peerId.length > 256) throw new Error("peerId is invalid")
}

function createRandomProtocolId(): Id128 {
  const bytes = new Uint8Array(16)
  if (!globalThis.crypto?.getRandomValues) throw new Error("Web Crypto is required for protocol identities")
  globalThis.crypto.getRandomValues(bytes)
  return parseId128(encodeBase64url(bytes))
}
