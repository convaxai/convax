import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  buildCanvasProjectionIndex,
  createCanvasReconstructionYDoc,
  createCanvasYDoc,
  derivedNodeRef,
  encodeCanvasCanonicalState,
  selectedCanvasDocumentOwnerArtifactDefinition,
  validateCanvasYDoc,
  type CanvasTypedIntentUnion,
} from "@convax/canvas/collaboration"
import {
  CollaborationKernel,
  applyYjsUpdate,
  canonicalStateDigest,
  causalFrontierDigest,
  createSelectedDocumentOwnerArtifactFactory,
  encodeBase64url,
  encodeFullUpdate,
  encodeStateVector,
  frameObjectRefFromDecodedFrame,
  ordinarySha256,
  parseActorId,
  parseCanvasId,
  parseId128,
  parseMemberId,
  parseProjectId,
  parsePublicKey,
  parseReplicaId,
  parseSignature,
  parseUint32,
  parseUint64,
  structuredDigest,
  type ActorId,
  type Digest,
  type DocumentOwnerRuntime,
  type DocumentScope,
  type Id128,
  type LocalFrameAuthority,
  type MemberId,
  type ReplicaId,
  type ValidationArtifactSet,
  type CurrentProtocolAuthority,
} from "@convax/collaboration"
import {
  NodeCollaborationPersistence,
  type NodeAcceptedReplicaHead,
} from "@convax/project/node"
import { peerControlCodec } from "@convax/project/collaboration-protocol"

import { loadHistoricalTestAuthority } from "../main/collaboration-authority.test-support"
import {
  createMainCollaborationProductionRuntime,
  createProjectCollaborationMaterializerRegistry,
} from "../main/collaboration-production-runtime"
import {
  CollaborationPeerJsTransport,
  type CollaborationPeerWireIngress,
  type PeerJsLikeDataConnection,
  type PeerJsLikeFactory,
  type PeerJsLikePeer,
} from "./peerjs-transport"
import {
  CollaborationSessionOrchestrator,
  type CollaborationKernelEndpoint,
  type CollaborationPeerAdmission,
  type CollaborationPeerSessionPrincipal,
} from "./session-orchestrator"

type ConnectionEvent = "open" | "data" | "close" | "error"
type PeerEvent = "open" | "connection" | "error" | "disconnected" | "close"

const roots: string[] = []
const encoder = new TextEncoder()
const signature = parseSignature(encodeBase64url(Uint8Array.from(
  { length: 64 },
  (_, index) => index === 0 || index === 32 ? 2 : 0,
)))
const publicKey = parsePublicKey(encodeBase64url(new Uint8Array(32).fill(2)))
const routeDependencyDigest = ordinarySha256(encoder.encode("project-index-route"))
const u0 = parseUint32("0")
const reconstructionOrigin = Object.freeze({ format: "convax.desktop-real-session-test/1" })

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("real Canvas collaboration session", () => {
  test("reopens disconnected durable edits, reconnects over CVXPEER2, converges and ACKs only durable receive", async () => {
    const authority = await loadHistoricalTestAuthority()
    const runtime = createCanvasRuntime(authority)
    const scope = canvasScope()
    const genesis = createGenesis(authority, runtime, scope)
    const alphaIdentity = replicaIdentity(11)
    const omegaIdentity = replicaIdentity(22)
    const alphaDirectory = await temporaryCollaborationDirectory("alpha")
    const omegaDirectory = await temporaryCollaborationDirectory("omega")

    const alphaFirst = await openReplica({
      authority,
      runtime,
      scope,
      genesis,
      collaborationDirectory: alphaDirectory,
      identity: alphaIdentity,
      initialize: true,
    })
    const omegaFirst = await openReplica({
      authority,
      runtime,
      scope,
      genesis,
      collaborationDirectory: omegaDirectory,
      identity: omegaIdentity,
      initialize: true,
    })
    const alphaFrameDigest = await commitOneNode(alphaFirst.kernel, alphaFirst.createFacts, id128(41), "alpha")
    const omegaFrameDigest = await commitOneNode(omegaFirst.kernel, omegaFirst.createFacts, id128(42), "omega")
    alphaFirst.kernel.dispose()
    omegaFirst.kernel.dispose()
    alphaFirst.persistence.dispose()
    omegaFirst.persistence.dispose()

    const alpha = await openReplica({
      authority,
      runtime,
      scope,
      genesis,
      collaborationDirectory: alphaDirectory,
      identity: alphaIdentity,
      initialize: false,
    })
    const omega = await openReplica({
      authority,
      runtime,
      scope,
      genesis,
      collaborationDirectory: omegaDirectory,
      identity: omegaIdentity,
      initialize: false,
    })
    expect((await alpha.persistence.listDurableReplicationOutbox(scope)).map((entry) => entry.ref.frameDigest)).toEqual([alphaFrameDigest])
    expect((await omega.persistence.listDurableReplicationOutbox(scope)).map((entry) => entry.ref.frameDigest)).toEqual([omegaFrameDigest])

    const network = new FakePeerNetwork()
    const alphaWire: Array<{ channel: string; bytes: Uint8Array }> = []
    const omegaWire: Array<{ channel: string; bytes: Uint8Array }> = []
    const alphaEndpoint = new RealKernelEndpoint("alpha", alphaIdentity, authority, alpha.kernel, alpha.persistence, scope)
    const omegaEndpoint = new RealKernelEndpoint("omega", omegaIdentity, authority, omega.kernel, omega.persistence, scope)
    const alphaSession = createOrchestrator({ localPeerId: "alpha", remotePeerId: "omega", network, capturedWire: alphaWire, idFillStart: 70 })
    const omegaSession = createOrchestrator({ localPeerId: "omega", remotePeerId: "alpha", network, capturedWire: omegaWire, idFillStart: 110 })
    alphaSession.registerEndpoint(alphaEndpoint)
    omegaSession.registerEndpoint(omegaEndpoint)

    alphaSession.connectPeer("omega")
    await settle(alphaSession, omegaSession)
    alphaSession.setOnline(false)
    omegaSession.setOnline(false)
    await alphaSession.announceLocalFrame(scope, alphaFrameDigest)
    await omegaSession.announceLocalFrame(scope, omegaFrameDigest)
    expect(alphaEndpoint.acks).toEqual([])
    expect(omegaEndpoint.acks).toEqual([])

    network.rotateConnection()
    omegaSession.setOnline(true)
    alphaSession.setOnline(true)
    await settle(alphaSession, omegaSession)

    expect(alphaEndpoint.receivedDurably).toContain(omegaFrameDigest)
    expect(omegaEndpoint.receivedDurably).toContain(alphaFrameDigest)
    expect(alphaEndpoint.acks.some((ack) => ack.frameDigest === alphaFrameDigest)).toBeTrue()
    expect(omegaEndpoint.acks.some((ack) => ack.frameDigest === omegaFrameDigest)).toBeTrue()
    expect(alphaEndpoint.acks.every((ack) => ack.replicaDurableAckCoreDigest !== null)).toBeTrue()
    expect(omegaEndpoint.acks.every((ack) => ack.replicaDurableAckCoreDigest !== null)).toBeTrue()

    const alphaSnapshot = alpha.kernel.getProjectionSnapshot()
    const omegaSnapshot = omega.kernel.getProjectionSnapshot()
    expect(alphaSnapshot.canonicalStateDigest).toBe(omegaSnapshot.canonicalStateDigest)
    expect(alphaSnapshot.fullUpdate).toEqual(omegaSnapshot.fullUpdate)
    expect(canonicalCanvasBytes(alphaSnapshot.fullUpdate)).toEqual(canonicalCanvasBytes(omegaSnapshot.fullUpdate))
    const projected = projectionFromUpdate(alphaSnapshot.fullUpdate)
    expect(projected.nodes.map((node) => node.data.title).sort()).toEqual(["alpha", "omega"])

    const digestBeforeDuplicate = omegaSnapshot.canonicalStateDigest
    const ackCountBeforeDuplicate = alphaEndpoint.acks.length
    await alphaSession.announceLocalFrame(scope, alphaFrameDigest)
    await settle(alphaSession, omegaSession)
    expect(omega.kernel.getProjectionSnapshot().canonicalStateDigest).toBe(digestBeforeDuplicate)
    expect(alphaEndpoint.acks.length).toBeGreaterThan(ackCountBeforeDuplicate)

    const decodedKinds = [...alphaWire, ...omegaWire].map(({ channel, bytes }) => {
      const decoded = peerControlCodec.decodeMessageWire(bytes)
      return `${channel}:${decoded.core.bodyKind}`
    })
    expect(decodedKinds.some((kind) => kind === "control:control.transfer-offer")).toBeTrue()
    expect(decodedKinds.some((kind) => kind === "control:control.transfer-accept")).toBeTrue()
    expect(decodedKinds.some((kind) => kind === "update:update.transfer-chunk")).toBeTrue()
    expect(decodedKinds.some((kind) => kind === "control:control.transfer-ack")).toBeTrue()

    alphaSession.dispose()
    omegaSession.dispose()
    alpha.kernel.dispose()
    omega.kernel.dispose()
    alpha.persistence.dispose()
    omega.persistence.dispose()
  })
})

function createCanvasRuntime(authority: CurrentProtocolAuthority): DocumentOwnerRuntime<"canvas"> {
  const result = createSelectedDocumentOwnerArtifactFactory(authority, "canvas")
    .createRuntime(selectedCanvasDocumentOwnerArtifactDefinition)
  if ("status" in result) throw new Error(`Canvas owner runtime rejected: ${result.code}`)
  return result
}

function canvasScope(): DocumentScope {
  return Object.freeze({
    projectId: parseProjectId("project"),
    projectEpoch: id128(1),
    docKind: "canvas",
    docId: parseCanvasId(`cv_${"2".repeat(64)}`),
    shardEpoch: id128(2),
  })
}

function createGenesis(
  authority: CurrentProtocolAuthority,
  runtime: DocumentOwnerRuntime<"canvas">,
  scope: DocumentScope,
): { acceptedBase: Omit<NodeAcceptedReplicaHead, "headDigest">; checkpointBytes: Uint8Array; checkpointDigest: Digest } {
  const document = createCanvasYDoc(
    scope,
    CANVAS_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
    authority.protocolDigest,
    routeDependencyDigest,
    parseReplicaId("replica_00000001"),
  )
  try {
    const fullUpdate = encodeFullUpdate(document)
    const frontier = Object.freeze({ format: "convax.causal-frontier" as const, heads: Object.freeze([]) })
    const acceptedBase = Object.freeze({
      scope,
      frontier,
      frontierDigest: causalFrontierDigest(frontier),
      actorHeads: Object.freeze({ format: "convax.replica-actor-head-set" as const, scope, heads: Object.freeze([]) }),
      fullUpdate,
      stateVector: encodeStateVector(document),
      canonicalStateDigest: canonicalStateDigest(
        runtime.protocolPort.schemaDigest,
        encodeCanvasCanonicalState(document),
      ),
    })
    return {
      acceptedBase,
      checkpointBytes: new Uint8Array(fullUpdate),
      checkpointDigest: ordinarySha256(fullUpdate),
    }
  } finally {
    document.destroy()
  }
}

interface ReplicaIdentity {
  readonly actorId: ActorId
  readonly memberId: MemberId
  readonly replicaId: ReplicaId
  readonly authorizationDigest: Digest
}

function replicaIdentity(seed: number): ReplicaIdentity {
  return Object.freeze({
    actorId: parseActorId(encoded(seed, 32)),
    memberId: parseMemberId(encoded(seed + 1, 16)),
    replicaId: parseReplicaId(`replica_${seed.toString(16).padStart(8, "0")}`),
    authorizationDigest: ordinarySha256(encoder.encode(`authorization:${seed}`)),
  })
}

async function openReplica(input: {
  authority: CurrentProtocolAuthority
  runtime: DocumentOwnerRuntime<"canvas">
  scope: DocumentScope
  genesis: ReturnType<typeof createGenesis>
  collaborationDirectory: string
  identity: ReplicaIdentity
  initialize: boolean
}) {
  const createFacts = () => createEmptyCanvasFacts(input.runtime)
  const materializers = createProjectCollaborationMaterializerRegistry()
  const persistence = await NodeCollaborationPersistence.open({
    collaborationDirectory: input.collaborationDirectory,
    localActorId: input.identity.actorId,
    materializer: materializers,
  })
  const production = await createMainCollaborationProductionRuntime({
    authority: input.authority,
    scope: input.scope,
    owner: input.runtime,
    actorId: input.identity.actorId,
    localAuthority: localAuthoritySource(input.authority, input.identity),
    incomingAuthority: {
      verify: async ({ frame }) => ({
        scope: frame.header.core.scope,
        frameDigest: frame.frameDigest,
        actorId: frame.header.core.actorId,
        membershipSnapshotDigest: frame.header.core.membershipSnapshotDigest,
        replicaActorCredentialCoreDigest: frame.header.core.replicaActorCredentialCoreDigest,
        replicaEditAuthorizationCoreDigest: frame.header.core.replicaEditAuthorizationCoreDigest,
        replicaPublicKey: publicKey,
      }),
    },
    incomingFacts: { resolve: async () => ({ status: "resolved", port: createFacts() }) },
    createDocument: createCanvasReconstructionYDoc,
    requiredBlobDigests: () => [],
    persistence,
    materializers,
    prepareShard: async () => {
      if (input.initialize) {
        await persistence.initializeShard({
          scope: input.scope,
          checkpointObjectDigest: input.genesis.checkpointDigest,
          checkpointExactBytes: input.genesis.checkpointBytes,
          acceptedBase: input.genesis.acceptedBase,
        })
      }
    },
  })
  const kernel = await CollaborationKernel.open({
    authority: input.authority,
    scope: input.scope,
    owner: input.runtime,
    signatureVerifier: { verify: async () => true },
    ports: {
      ...production.ports,
    },
  })
  return { kernel, persistence, createFacts }
}

function createEmptyCanvasFacts(runtime: DocumentOwnerRuntime<"canvas">) {
  const facts = runtime.externalFactPortFactory.createAttemptPort({
    declared: { validationArtifacts: [], externalFacts: [] },
    resolver: {
      owner: "canvas",
      resolveArtifact: (ref) => ({ status: "pending", ref }),
      resolveFact: (requirement) => ({ status: "pending", requirement }),
    },
  })
  if (facts.status !== "created") throw new Error(`Canvas facts rejected: ${facts.code}`)
  return facts.port
}

function localAuthority(authority: CurrentProtocolAuthority, identity: ReplicaIdentity) {
  const membershipSnapshotDigest = ordinarySha256(encoder.encode(`membership:${identity.memberId}`))
  const actorCredentialDigest = ordinarySha256(encoder.encode(`credential:${identity.actorId}`))
  const editAuthorizationDigest = identity.authorizationDigest
  return {
    actorId: identity.actorId,
    async prepareFinalFrameAuthority(): Promise<LocalFrameAuthority> {
      return {
        actorId: identity.actorId,
        actorSequence: parseUint64("1"),
        predecessorFrameDigest: null,
        signerAuthority: {
          memberId: identity.memberId,
          replicaId: identity.replicaId,
          actorId: identity.actorId,
          memberAuthorizationEpoch: id128(61),
          replicaAuthorizationEpoch: id128(62),
          membershipSnapshotDigest,
          replicaActorCredentialCoreDigest: actorCredentialDigest,
          replicaEditAuthorizationCoreDigest: editAuthorizationDigest,
        },
        dependencies: [
          { kind: "membership-snapshot", digest: membershipSnapshotDigest },
          { kind: "replica-actor-credential", digest: actorCredentialDigest },
          { kind: "replica-edit-authorization", digest: editAuthorizationDigest },
        ],
        validationArtifacts: requiredValidationArtifacts(authority),
        signer: { sign: async () => signature },
      }
    },
  }
}

function localAuthoritySource(authority: CurrentProtocolAuthority, identity: ReplicaIdentity) {
  const port = localAuthority(authority, identity)
  return {
    async resolveCurrent(request: {
      scope: DocumentScope
      operationId: Id128
      baseFrontierDigest: Digest
      ownerSchemaDigest: Digest
    }) {
      const prepared = await port.prepareFinalFrameAuthority()
      if (typeof prepared === "string") return prepared
      return {
        scope: request.scope,
        operationId: request.operationId,
        baseFrontierDigest: request.baseFrontierDigest,
        ownerSchemaDigest: request.ownerSchemaDigest,
        signerAuthority: prepared.signerAuthority,
        dependencies: prepared.dependencies,
        validationArtifacts: prepared.validationArtifacts,
        signer: prepared.signer,
      }
    },
  }
}

function requiredValidationArtifacts(authority: CurrentProtocolAuthority): ValidationArtifactSet {
  const byName = new Map(authority.protocolSchemaBundle.core.artifacts.map((artifact) => [artifact.name, artifact]))
  const artifact = (
    owner: "canvas" | "control-plane" | "kernel" | "project-index",
    name: "canvas-schema" | "collaboration-kernel" | "control-plane" | "project-persistence",
  ) => {
    const value = byName.get(name)
    if (!value) throw new Error(`Missing authority artifact ${name}`)
    return { owner, format: value.format, artifactDigest: value.artifactDigest }
  }
  return Object.freeze({
    format: "convax.validation-artifact-set",
    artifacts: Object.freeze([
      artifact("canvas", "canvas-schema"),
      artifact("control-plane", "control-plane"),
      artifact("kernel", "collaboration-kernel"),
      artifact("project-index", "project-persistence"),
    ]),
  })
}

async function commitOneNode(
  kernel: CollaborationKernel,
  createFacts: () => ReturnType<typeof createEmptyCanvasFacts>,
  operationId: Id128,
  title: string,
): Promise<Digest> {
  const result = await kernel.commitLocalIntent({
    operationId,
    prepare: ({ context }) => {
      const node = derivedNodeRef(context, u0)
      const intent: Extract<CanvasTypedIntentUnion, { kind: "canvas.agent.create" }> = {
        format: "convax.typed-intent",
        kind: "canvas.agent.create",
        guard: { ordinal: u0, node, expectedAbsent: true },
        body: {
          node: {
            ordinal: u0,
            nodeId: node.id,
            incarnation: node.incarnation,
            role: "agent",
            position: { x: title === "alpha" ? 0 : 300, y: 0 },
            size: { width: 240, height: 120 },
            data: { format: "convax.canvas-node-data", kind: "agent", title, instructions: null },
            plugin: null,
          },
        },
      }
      return { typedIntent: intent, externalFacts: createFacts() }
    },
  })
  return result.frame.frameDigest
}

class RealKernelEndpoint implements CollaborationKernelEndpoint {
  readonly acks: Array<{ peerId: string; frameDigest: Digest; replicaDurableAckCoreDigest: Digest }> = []
  readonly receivedDurably: Digest[] = []

  constructor(
    readonly peerId: string,
    readonly identity: ReplicaIdentity,
    readonly authority: CurrentProtocolAuthority,
    readonly kernel: CollaborationKernel,
    readonly persistence: NodeCollaborationPersistence,
    readonly scope: DocumentScope,
  ) {}

  async receiveFrame(exactCausalFrameBytes: Readonly<Uint8Array>) {
    const result = await this.kernel.receiveFrame(new Uint8Array(exactCausalFrameBytes))
    if (result.status === "dependency-pending") return { result, replicaDurableAckCoreDigest: null }
    const ref = frameObjectRefFromDecodedFrame(result.frame)
    if (!await this.persistence.isFrameDurableForAck(ref)) {
      throw new Error("Kernel reported acceptance before the persistence ACK barrier")
    }
    this.receivedDurably.push(ref.frameDigest)
    const projection = this.kernel.getProjectionSnapshot()
    const core = {
      format: "convax.replica-durable-ack-core",
      scope: this.scope,
      frameOrCheckpointDigest: ref.frameDigest,
      receiverMemberId: this.identity.memberId,
      receiverReplicaId: this.identity.replicaId,
      receiverActorId: this.identity.actorId,
      receiverAuthorizationDigest: this.identity.authorizationDigest,
      receiverDurableHeadDigest: projection.acceptedHeadDigest,
      receiverFrontierDigest: causalFrontierDigest(projection.frontier),
      protocolDigest: this.authority.protocolDigest,
    }
    return {
      result,
      replicaDurableAckCoreDigest: structuredDigest("convax.replica-durable-ack-core", core),
    }
  }

  async loadDurableFrame(frameDigest: Digest): Promise<Readonly<Uint8Array> | null> {
    const entry = (await this.persistence.listDurableReplicationOutbox(this.scope))
      .find((candidate) => candidate.ref.frameDigest === frameDigest)
    return entry ? new Uint8Array(entry.exactFrameBytes) : null
  }

  async recordDurableAck(input: { peerId: string; frameDigest: Digest; replicaDurableAckCoreDigest: Digest }): Promise<void> {
    this.acks.push({ ...input })
  }
}

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
  rotateConnection(): void { this.connectionFill += 1 }
}

function admission(localPeerId: string, remotePeerId: string, network: FakePeerNetwork): CollaborationPeerAdmission {
  const credential = (peerId: string) => ordinarySha256(encoder.encode(`credential:${peerId}`))
  const currentConnection = () => id128(network.connectionFill)
  return {
    localHandshake: () => encoder.encode(currentConnection()),
    verifyRemoteHandshake: (_peerId, exactBytes) => {
      const connectionId = parseId128(new TextDecoder().decode(exactBytes))
      if (connectionId !== currentConnection()) return "rejected"
      const channelOpen = (channel: string) => ordinarySha256(encoder.encode(`${connectionId}:${channel}`))
      const principal: CollaborationPeerSessionPrincipal = {
        connectionId,
        localCredentialDigest: credential(localPeerId),
        remoteCredentialDigest: credential(remotePeerId),
        channelOpenDigests: {
          control: channelOpen("control"),
          update: channelOpen("update"),
          blob: channelOpen("blob"),
          awareness: channelOpen("awareness"),
        },
        signMessageCoreDigest: () => signature,
        verifyRemoteMessageCoreDigest: ({ signature: remoteSignature }) => remoteSignature === signature,
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
}): CollaborationSessionOrchestrator {
  let idFill = input.idFillStart
  return new CollaborationSessionOrchestrator({
    localPeerId: input.localPeerId,
    admission: admission(input.localPeerId, input.remotePeerId, input.network),
    createProtocolId: () => id128(idFill++),
    createDataPlane: ({ ingress, lifecycle }) => {
      const capturingIngress: CollaborationPeerWireIngress = {
        receivePeerWireBytes(message) {
          if (message.purpose === "message") {
            input.capturedWire.push({ channel: message.channel, bytes: new Uint8Array(message.wireBytes) })
          }
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

async function settle(...orchestrators: CollaborationSessionOrchestrator[]): Promise<void> {
  for (let pass = 0; pass < 30; pass += 1) {
    for (const orchestrator of orchestrators) await orchestrator.idle()
  }
}

function canonicalCanvasBytes(fullUpdate: Uint8Array): Uint8Array {
  const document = createCanvasReconstructionYDoc()
  try {
    applyYjsUpdate(document, fullUpdate, reconstructionOrigin)
    return encodeCanvasCanonicalState(document)
  } finally {
    document.destroy()
  }
}

function projectionFromUpdate(fullUpdate: Uint8Array) {
  const document = createCanvasReconstructionYDoc()
  try {
    applyYjsUpdate(document, fullUpdate, reconstructionOrigin)
    return buildCanvasProjectionIndex(validateCanvasYDoc(document)).projection
  } finally {
    document.destroy()
  }
}

async function temporaryCollaborationDirectory(label: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `convax-real-${label}-`))
  roots.push(root)
  return path.join(root, "collaboration")
}

function id128(seed: number): Id128 {
  return parseId128(encoded(seed, 16))
}

function encoded(seed: number, length: number): string {
  return encodeBase64url(Uint8Array.from({ length }, (_, index) => (seed + index * 17) % 256))
}
