import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  ordinarySha256,
  parseId128,
  parseProjectId,
  parseSignature,
  type Digest,
  type DocumentScope,
  type IncomingFrameResult,
} from "@convax/collaboration"
import { peerControlCodecV2 } from "@convax/project/collaboration-protocol"

import {
  CollaborationPeerJsTransport,
  type CollaborationPeerWireIngress,
  type PeerJsLikeDataConnection,
  type PeerJsLikeFactory,
  type PeerJsLikePeer,
} from "./peerjs-transport"
import {
  CollaborationSessionOrchestratorV2,
  type CollaborationKernelEndpointV2,
  type CollaborationPeerAdmissionV2,
  type CollaborationPeerSessionPrincipalV2,
} from "./session-orchestrator"

type ConnectionEvent = "open" | "data" | "close" | "error"
type PeerEvent = "open" | "connection" | "error" | "disconnected" | "close"

class LinkedConnection implements PeerJsLikeDataConnection {
  readonly #listeners = new Map<ConnectionEvent, Array<(...args: readonly unknown[]) => void>>()
  linked?: LinkedConnection
  open = true
  bufferSize = 0
  #closed = false

  constructor(readonly peer: string, readonly label: string) {}

  send(data: Uint8Array): void {
    if (this.#closed) throw new Error("connection is closed")
    this.linked?.emit("data", new Uint8Array(data))
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.open = false
    this.emit("close")
    this.linked?.closeFromPeer()
  }

  closeFromPeer(): void {
    if (this.#closed) return
    this.#closed = true
    this.open = false
    this.emit("close")
  }

  on(event: ConnectionEvent, listener: (...args: readonly unknown[]) => void): void {
    const listeners = this.#listeners.get(event) ?? []
    listeners.push(listener)
    this.#listeners.set(event, listeners)
  }

  emit(event: ConnectionEvent, ...args: readonly unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(...args)
  }
}

class NetworkPeer implements PeerJsLikePeer {
  readonly #listeners = new Map<PeerEvent, Array<(...args: readonly unknown[]) => void>>()
  open = true

  constructor(readonly id: string, readonly network: FakePeerNetwork) {}

  connect(peerId: string, options: { label: string; serialization: "binary" }): PeerJsLikeDataConnection {
    if (options.serialization !== "binary") throw new Error("binary serialization is required")
    const remote = this.network.peer(peerId)
    const outgoing = new LinkedConnection(peerId, options.label)
    const incoming = new LinkedConnection(this.id, options.label)
    outgoing.linked = incoming
    incoming.linked = outgoing
    remote.emit("connection", incoming)
    return outgoing
  }

  on(event: PeerEvent, listener: (...args: readonly unknown[]) => void): void {
    const listeners = this.#listeners.get(event) ?? []
    listeners.push(listener)
    this.#listeners.set(event, listeners)
  }

  emit(event: PeerEvent, ...args: readonly unknown[]): void {
    for (const listener of this.#listeners.get(event) ?? []) listener(...args)
  }

  reconnect(): void {}
  destroy(): void {}
}

class FakePeerNetwork {
  readonly #peers = new Map<string, NetworkPeer>()
  connectionFill = 10

  factory(localPeerId: string): PeerJsLikeFactory {
    const peer = new NetworkPeer(localPeerId, this)
    this.#peers.set(localPeerId, peer)
    return { create: () => peer }
  }

  peer(peerId: string): NetworkPeer {
    const peer = this.#peers.get(peerId)
    if (!peer) throw new Error(`unknown peer ${peerId}`)
    return peer
  }

  rotateConnection(): void {
    this.connectionFill += 1
  }
}

class FakeKernelEndpoint implements CollaborationKernelEndpointV2 {
  readonly durable = new Map<Digest, Uint8Array>()
  readonly accepted = new Set<Digest>()
  readonly received: Uint8Array[] = []
  readonly acks: Array<{ peerId: string; frameDigest: Digest; replicaDurableAckCoreDigest: Digest }> = []

  constructor(readonly scope: DocumentScope) {}

  localEdit(exactFrameBytes: Uint8Array): Digest {
    const frameDigest = ordinarySha256(exactFrameBytes)
    this.durable.set(frameDigest, new Uint8Array(exactFrameBytes))
    this.accepted.add(frameDigest)
    return frameDigest
  }

  async receiveFrame(exactCausalFrameBytes: Readonly<Uint8Array>) {
    const exact = new Uint8Array(exactCausalFrameBytes)
    const frameDigest = ordinarySha256(exact)
    const status = this.accepted.has(frameDigest) ? "duplicate" : "accepted"
    this.received.push(exact)
    this.accepted.add(frameDigest)
    this.durable.set(frameDigest, exact)
    const result = { status, frame: { frameDigest } } as unknown as IncomingFrameResult
    return { result, replicaDurableAckCoreDigest: ordinarySha256(new TextEncoder().encode(`durable:${frameDigest}`)) }
  }

  async loadDurableFrame(frameDigest: Digest): Promise<Readonly<Uint8Array> | null> {
    const bytes = this.durable.get(frameDigest)
    return bytes ? new Uint8Array(bytes) : null
  }

  async recordDurableAck(input: { peerId: string; frameDigest: Digest; replicaDurableAckCoreDigest: Digest }): Promise<void> {
    this.acks.push({ ...input })
  }
}

const deterministicSignature = parseSignature(
  encodeBase64url(Uint8Array.from({ length: 64 }, (_, index) => index === 0 || index === 32 ? 2 : 0)),
)

function admission(localPeerId: string, remotePeerId: string, network: FakePeerNetwork): CollaborationPeerAdmissionV2 {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const credential = (peerId: string) => ordinarySha256(encoder.encode(`credential:${peerId}`))
  const currentConnection = () => parseId128(encodeBase64url(new Uint8Array(16).fill(network.connectionFill)))
  return {
    localHandshake: () => encoder.encode(currentConnection()),
    verifyRemoteHandshake: (_peerId, exactBytes) => {
      const connectionId = parseId128(decoder.decode(exactBytes))
      if (connectionId !== currentConnection()) return "rejected"
      const channelOpen = (channel: string) => ordinarySha256(encoder.encode(`${connectionId}:${channel}`))
      const principal: CollaborationPeerSessionPrincipalV2 = {
        connectionId,
        localCredentialDigest: credential(localPeerId),
        remoteCredentialDigest: credential(remotePeerId),
        channelOpenDigests: {
          control: channelOpen("control"),
          update: channelOpen("update"),
          blob: channelOpen("blob"),
          awareness: channelOpen("awareness"),
        },
        signMessageCoreDigest: () => deterministicSignature,
        verifyRemoteMessageCoreDigest: ({ signature }) => signature === deterministicSignature,
      }
      return principal
    },
  }
}

function createOrchestrator(input: {
  localPeerId: string
  remotePeerId: string
  network: FakePeerNetwork
  capturedWire: Array<{ channel: string; bytes: Uint8Array }>
  idFillStart: number
}): CollaborationSessionOrchestratorV2 {
  let idFill = input.idFillStart
  return new CollaborationSessionOrchestratorV2({
    localPeerId: input.localPeerId,
    admission: admission(input.localPeerId, input.remotePeerId, input.network),
    createProtocolId: () => parseId128(encodeBase64url(new Uint8Array(16).fill(idFill++))),
    createDataPlane: ({ ingress, lifecycle }) => {
      const capturingIngress: CollaborationPeerWireIngress = {
        receivePeerWireBytes(message) {
          if (message.purpose === "message") input.capturedWire.push({ channel: message.channel, bytes: new Uint8Array(message.wireBytes) })
          ingress.receivePeerWireBytes(message)
        },
      }
      return new CollaborationPeerJsTransport({
        factory: input.network.factory(input.localPeerId),
        localPeerId: input.localPeerId,
        sessionScope: { credentialEpoch: "r5", documentEpoch: "r5" },
        peerWireIngress: capturingIngress,
        onRouteReady: lifecycle.onRouteReady,
        onRouteReset: lifecycle.onRouteReset,
        random: () => 0.5,
      })
    },
  })
}

async function settle(...orchestrators: CollaborationSessionOrchestratorV2[]): Promise<void> {
  for (let pass = 0; pass < 20; pass += 1) {
    for (const orchestrator of orchestrators) await orchestrator.idle()
  }
}

describe("Main R5 collaboration session orchestrator", () => {
  test("retains offline frames, reconnects over exact CVXPEER2, converges exact bytes and records durable proof ACKs", async () => {
    const network = new FakePeerNetwork()
    const alphaWire: Array<{ channel: string; bytes: Uint8Array }> = []
    const omegaWire: Array<{ channel: string; bytes: Uint8Array }> = []
    const alpha = createOrchestrator({ localPeerId: "alpha", remotePeerId: "omega", network, capturedWire: alphaWire, idFillStart: 30 })
    const omega = createOrchestrator({ localPeerId: "omega", remotePeerId: "alpha", network, capturedWire: omegaWire, idFillStart: 80 })
    const scope: DocumentScope = {
      projectId: parseProjectId("project"),
      projectEpoch: parseId128(encodeBase64url(new Uint8Array(16).fill(1))),
      docKind: "project-index",
      docId: "project-index",
      shardEpoch: parseId128(encodeBase64url(new Uint8Array(16).fill(2))),
    }
    const alphaEndpoint = new FakeKernelEndpoint(scope)
    const omegaEndpoint = new FakeKernelEndpoint(scope)
    alpha.registerEndpoint(alphaEndpoint)
    omega.registerEndpoint(omegaEndpoint)

    alpha.connectPeer("omega")
    await settle(alpha, omega)
    alpha.setOnline(false)
    omega.setOnline(false)

    const alphaBytes = new TextEncoder().encode("alpha exact final frame")
    const omegaBytes = new TextEncoder().encode("omega exact final frame")
    const alphaDigest = alphaEndpoint.localEdit(alphaBytes)
    const omegaDigest = omegaEndpoint.localEdit(omegaBytes)
    await alpha.announceLocalFrame(scope, alphaDigest)
    await omega.announceLocalFrame(scope, omegaDigest)
    expect(alphaEndpoint.acks).toEqual([])
    expect(omegaEndpoint.acks).toEqual([])

    network.rotateConnection()
    omega.setOnline(true)
    alpha.setOnline(true)
    await settle(alpha, omega)

    expect(alphaEndpoint.accepted).toEqual(new Set([alphaDigest, omegaDigest]))
    expect(omegaEndpoint.accepted).toEqual(new Set([omegaDigest, alphaDigest]))
    expect(alphaEndpoint.received).toContainEqual(omegaBytes)
    expect(omegaEndpoint.received).toContainEqual(alphaBytes)
    expect(alphaEndpoint.acks).toEqual([expect.objectContaining({ peerId: "omega", frameDigest: alphaDigest })])
    expect(omegaEndpoint.acks).toEqual([expect.objectContaining({ peerId: "alpha", frameDigest: omegaDigest })])

    const allWire = [...alphaWire, ...omegaWire]
    expect(allWire.length).toBeGreaterThan(0)
    const decoded = allWire.map(({ channel, bytes }) => ({ channel, message: peerControlCodecV2.decodeMessageWire(bytes) }))
    expect(decoded.every(({ channel, message }) => message.core.channel === channel)).toBe(true)
    expect(decoded.some(({ message }) => message.core.bodyKind === "control.transfer-offer")).toBe(true)
    expect(decoded.some(({ message }) => message.core.bodyKind === "update.transfer-chunk")).toBe(true)
    expect(decoded.some(({ message }) => message.core.bodyKind === "control.transfer-ack")).toBe(true)
    for (const { message } of decoded.filter(({ channel }) => channel === "control")) {
      const body = peerControlCodecV2.decodeControlBody(message.body, message.core.bodyKind)
      expect(["transfer-offer", "transfer-accept", "transfer-ack"]).toContain(body.kind)
      if (body.kind === "transfer-ack") expect(body.durabilityProofDigest).not.toBeNull()
    }
    await alpha.announceLocalFrame(scope, alphaDigest)
    await settle(alpha, omega)
    expect(omegaEndpoint.received.filter((bytes) => ordinarySha256(bytes) === alphaDigest)).toHaveLength(2)
    expect(alphaEndpoint.accepted).toEqual(omegaEndpoint.accepted)

    alpha.dispose()
    omega.dispose()
  })
})
