import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  CollaborationKernel,
  encodeBase64url,
  encodeRestrictedJcs,
  frameObjectRefFromDecodedFrame,
  incrementUint64,
  inspectAcceptedFrameObject,
  installCurrentProtocolAuthority,
  materializeAcceptedFrame,
  ordinarySha256,
  parseActorId,
  parseId128,
  parseMemberId,
  parseProjectId,
  parsePublicKey,
  parseReplicaId,
  parseSignature,
  replicaActorHeadSetDigest,
  replicaCheckpointCoreDigest,
  type CollaborationPersistencePort,
  type CurrentProtocolAuthority,
  type Digest,
  type DocumentOwnerRuntime,
  type DocumentScope,
  type FrameObjectRef,
  type Id128,
  type OwnerExternalFactPort,
  type OwnerValidatedState,
  type ValidationArtifactSet,
} from "@convax/collaboration"
import {
  PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
  constructProjectDirectoryCreateIntent,
  createProjectIndexDocumentOwnerRuntime,
  createProjectIndexReconstructionYDoc,
  projectIndexSnapshotFromValidatedOwnerState,
  requiredProjectIndexBlobDigests,
} from "../../collaboration/project-index"
import {
  createEmptyProjectIndexGenesisCandidate,
  verifyEmptyProjectIndexGenesis,
} from "./project-index-genesis-store"
import { deriveDocumentNativeKey } from "./native-store-keys"
import {
  NodeCollaborationPersistence,
  nodeCollaborationPersistenceStructuralCounts,
  type NodeAcceptedReplicaHead,
  type NodeCollaborationPersistenceFaultHooks,
  type NodeReplicaHeadMaterializer,
} from "./persistence-store"

const roots: string[] = []
const durabilityTest = test.skipIf(process.platform === "win32")
const authority = installCurrentProtocolAuthority()
const actorId = actor(7)
const memberId = parseMemberId(encodeBase64url(Buffer.alloc(16, 8)))
const replicaId = parseReplicaId("replica_0000002a")
const signature = parseSignature(encodeBase64url(Uint8Array.from(
  { length: 64 },
  (_, index) => index < 32 ? 3 : index === 32 ? 1 : 0,
)))
const publicKey = parsePublicKey(encodeBase64url(Buffer.alloc(32, 2)))
const membershipDigest = ordinarySha256(new TextEncoder().encode("wal-membership"))
const credentialDigest = ordinarySha256(new TextEncoder().encode("wal-credential"))
const authorizationDigest = ordinarySha256(new TextEncoder().encode("wal-authorization"))
const scope = Object.freeze({
  projectId: parseProjectId("project-wal"),
  projectEpoch: id(1),
  docKind: "project-index" as const,
  docId: "project-index" as const,
  shardEpoch: id(2),
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("NodeCollaborationPersistence atomic accepted-frame WAL", () => {
  durabilityTest("keeps 1,000 sequential ProjectIndex commits on the one-sync metadata-only hot path", async () => {
    const fixture = await createFixture()
    const before = nodeCollaborationPersistenceStructuralCounts()
    let finalRef: FrameObjectRef | undefined

    for (let index = 0; index < 1_000; index += 1) {
      const result = await commitDirectory(fixture.kernel, index)
      expect(result.status).toBe("saved-locally")
      finalRef = frameObjectRefFromDecodedFrame(result.frame)
    }

    const delta = countDelta(before, nodeCollaborationPersistenceStructuralCounts())
    expect(delta.atomicAppends).toBe(1_000)
    expect(delta.atomicFileSyncs).toBe(1_000)
    expect(delta.atomicDirectorySyncs).toBe(0)
    expect(delta.outboxUsageHistoryVisits).toBe(0)
    expect(delta.walColdScans).toBe(0)
    expect(delta.walRecordsVisited).toBe(0)
    expect(delta.coldHeadMaterializations).toBe(0)
    expect(delta.acceptedFrameMaterializations).toBe(0)
    expect(delta.fullUpdateClones).toBe(0)
    expect(delta.fullUpdateBytesCloned).toBe(0)
    expect(delta.deltaHistoryVisits).toBe(0)
    expect(delta.metadataEvidenceTransitions).toBe(1_000)
    expect(delta.deltaRefAppends).toBe(1_000)
    if (!finalRef) throw new Error("final WAL frame is missing")
    expect((await fixture.store.lookupOperation(finalRef.actorId, finalRef.operationId)).status).toBe("accepted")
    fixture.dispose()
  }, 120_000)

  durabilityTest("recovers a complete post-fsync record and returns byte-identical commit evidence on retry", async () => {
    let loseResponse = true
    const fixture = await createFixture({
      hooks: {
        async afterAcceptedFrameWalSync() {
          if (!loseResponse) return
          loseResponse = false
          throw new Error("simulated response loss after accepted-frame WAL fsync")
        },
      },
      captureAtomicRequests: true,
    })
    const before = nodeCollaborationPersistenceStructuralCounts()
    const saved = await commitDirectory(fixture.kernel, 1)
    expect(saved.status).toBe("saved-locally")
    expect(fixture.atomicRequests).toHaveLength(1)
    expect(fixture.atomicResults).toHaveLength(1)

    const retry = await fixture.store.commitAcceptedFrame(fixture.atomicRequests[0]!)
    expect(retry).toEqual(fixture.atomicResults[0])
    const delta = countDelta(before, nodeCollaborationPersistenceStructuralCounts())
    expect(delta.atomicAppends).toBe(1)
    expect(delta.atomicFileSyncs).toBe(1)
    expect(delta.walColdScans).toBe(1)
    expect(delta.walRecordsVisited).toBe(1)
    fixture.dispose()
  })

  durabilityTest("cold-scans and exactly replays the durable delta chain only after reopen", async () => {
    const fixture = await createFixture()
    const refs: FrameObjectRef[] = []
    for (let index = 0; index < 8; index += 1) {
      const result = await commitDirectory(fixture.kernel, index)
      refs.push(frameObjectRefFromDecodedFrame(result.frame))
    }
    fixture.dispose()

    const runtime = createProjectIndexDocumentOwnerRuntime(authority)
    const materializer = new ProjectIndexWalMaterializer(authority, runtime)
    const before = nodeCollaborationPersistenceStructuralCounts()
    const reopened = await NodeCollaborationPersistence.open({
      collaborationDirectory: fixture.collaborationDirectory,
      localActorId: actorId,
      materializer,
    })
    const afterOpen = nodeCollaborationPersistenceStructuralCounts()
    expect(afterOpen.outboxUsageHistoryVisits - before.outboxUsageHistoryVisits).toBe(8)
    await reopened.sampleLatencyDiagnostics(scope)
    expect(
      nodeCollaborationPersistenceStructuralCounts().outboxUsageHistoryVisits -
        afterOpen.outboxUsageHistoryVisits,
    ).toBe(0)
    const head = await reopened.loadReplicaHead(scope) as NodeAcceptedReplicaHead
    const delta = countDelta(before, nodeCollaborationPersistenceStructuralCounts())
    expect(delta.walColdScans).toBe(1)
    expect(delta.walRecordsVisited).toBe(8)
    expect(delta.coldHeadMaterializations).toBe(1)
    expect(delta.acceptedFrameMaterializations).toBe(8)
    expect(head.frontier.heads.map((item) => item.frameDigest)).toEqual([refs.at(-1)!.frameDigest])
    for (const ref of [refs[0]!, refs[4]!, refs[7]!]) {
      const lookup = await reopened.lookupOperation(ref.actorId, ref.operationId)
      expect(lookup.status).toBe("accepted")
      if (lookup.status === "accepted") {
        expect(frameObjectRefFromDecodedFrame(inspectAcceptedFrameObject(authority, ref, lookup.bytes))).toEqual(ref)
      }
    }
    expect(await reopened.listDurableReplicationOutbox(scope)).toHaveLength(8)
    reopened.dispose()
  })

  durabilityTest("leaves a truncated tail untouched for readers and repairs it on writer open", async () => {
    const fixture = await createFixture()
    const refs: FrameObjectRef[] = []
    for (let index = 0; index < 2; index += 1) {
      refs.push(frameObjectRefFromDecodedFrame((await commitDirectory(fixture.kernel, index)).frame))
    }
    fixture.dispose()
    const walPath = path.join(
      fixture.collaborationDirectory,
      "documents",
      deriveDocumentNativeKey(scope),
      "journals",
      "accepted-frames.wal",
    )
    const completeSize = (await fs.stat(walPath)).size
    const handle = await fs.open(walPath, "a")
    try {
      await handle.write(Uint8Array.of(0x43, 0x56, 0x58, 0x41, 0x57, 0x52, 0x45))
      await handle.sync()
    } finally {
      await handle.close()
    }

    const readRuntime = createProjectIndexDocumentOwnerRuntime(authority)
    const readOnly = await NodeCollaborationPersistence.openReadOnly({
      collaborationDirectory: fixture.collaborationDirectory,
      localActorId: actorId,
      materializer: new ProjectIndexWalMaterializer(authority, readRuntime),
    })
    expect(
      (await readOnly.loadReplicaHead(scope) as NodeAcceptedReplicaHead).frontier.heads[0]?.frameDigest,
    ).toBe(refs[1]!.frameDigest)
    expect((await fs.stat(walPath)).size).toBeGreaterThan(completeSize)
    readOnly.dispose()

    const writeRuntime = createProjectIndexDocumentOwnerRuntime(authority)
    const writer = await NodeCollaborationPersistence.open({
      collaborationDirectory: fixture.collaborationDirectory,
      localActorId: actorId,
      materializer: new ProjectIndexWalMaterializer(authority, writeRuntime),
    })
    expect((await fs.stat(walPath)).size).toBe(completeSize)
    expect(
      (await writer.loadReplicaHead(scope) as NodeAcceptedReplicaHead).frontier.heads[0]?.frameDigest,
    ).toBe(refs[1]!.frameDigest)
    writer.dispose()
  })

  durabilityTest("persists ACK maintenance in the same log and rebuilds ACK/outbox indexes after reopen", async () => {
    const verifier = { verifyCurrent: async () => true }
    const fixture = await createFixture({ replicaDurableAckVerifier: verifier })
    const refs: FrameObjectRef[] = []
    for (let index = 0; index < 2; index += 1) {
      refs.push(frameObjectRefFromDecodedFrame((await commitDirectory(fixture.kernel, index)).frame))
    }
    const ack = Object.freeze({
      scope,
      frameDigest: refs[0]!.frameDigest,
      receiverMemberId: memberId,
      receiverReplicaId: replicaId,
      receiverActorId: actorId,
      receiverAuthorizationDigest: authorizationDigest,
      ackCoreDigest: ordinarySha256(new TextEncoder().encode("wal-ack-core")),
      exactAckBytes: new TextEncoder().encode("wal-ack-exact"),
    })
    const receipt = await fixture.store.recordVerifiedReplicaDurableAck(ack)
    expect(await fixture.store.recordVerifiedReplicaDurableAck(ack)).toBe(receipt)
    expect((await fixture.store.listDurableReplicaAcks(scope)).map((item) => item.ackCoreDigest))
      .toEqual([ack.ackCoreDigest])
    expect((await fixture.store.listDurableReplicationOutbox(scope)).map((item) => item.ref.frameDigest))
      .toEqual([refs[1]!.frameDigest])
    fixture.dispose()

    const runtime = createProjectIndexDocumentOwnerRuntime(authority)
    const reopened = await NodeCollaborationPersistence.open({
      collaborationDirectory: fixture.collaborationDirectory,
      localActorId: actorId,
      materializer: new ProjectIndexWalMaterializer(authority, runtime),
      replicaDurableAckVerifier: verifier,
    })
    expect((await reopened.listDurableReplicaAcks(scope)).map((item) => item.ackCoreDigest))
      .toEqual([ack.ackCoreDigest])
    expect((await reopened.listDurableReplicationOutbox(scope)).map((item) => item.ref.frameDigest))
      .toEqual([refs[1]!.frameDigest])
    for (const ref of refs) {
      expect((await reopened.lookupOperation(ref.actorId, ref.operationId)).status).toBe("accepted")
    }
    reopened.dispose()
  })

  durabilityTest("never denies a durable commit for post-fsync operation-index, head-cache, or observer faults", async () => {
    for (const fault of ["operation-index", "head-cache", "observer"] as const) {
      let armed = true
      const materializerFault = { observe: fault === "observer" }
      const fixture = await createFixture({
        hooks: {
          async beforeAtomicOperationIndexInstall() {
            if (fault !== "operation-index" || !armed) return
            armed = false
            throw new Error("simulated post-fsync operation-index failure")
          },
          async beforeAtomicHeadCacheInstall() {
            if (fault !== "head-cache" || !armed) return
            armed = false
            throw new Error("simulated post-fsync head-cache failure")
          },
        },
        materializerFault,
      })
      const result = await commitDirectory(fixture.kernel, 20)
      expect(result.status, fault).toBe("saved-locally")
      const ref = frameObjectRefFromDecodedFrame(result.frame)
      if (fault === "observer") expect(fixture.materializer.observeAttempts).toBe(1)
      fixture.dispose()

      const runtime = createProjectIndexDocumentOwnerRuntime(authority)
      const reopened = await NodeCollaborationPersistence.open({
        collaborationDirectory: fixture.collaborationDirectory,
        localActorId: actorId,
        materializer: new ProjectIndexWalMaterializer(authority, runtime),
      })
      expect((await reopened.lookupOperation(ref.actorId, ref.operationId)).status, fault).toBe("accepted")
      expect(
        (await reopened.loadReplicaHead(scope) as NodeAcceptedReplicaHead).frontier.heads[0]?.frameDigest,
        fault,
      ).toBe(ref.frameDigest)
      reopened.dispose()
    }
  })
})

class ProjectIndexWalMaterializer implements NodeReplicaHeadMaterializer {
  observeAttempts = 0

  constructor(
    private readonly selectedAuthority: CurrentProtocolAuthority,
    private readonly runtime: DocumentOwnerRuntime<"project-index">,
    private readonly fault: Readonly<{ observe: boolean }> = { observe: false },
  ) {}

  async inspectFrame(ref: FrameObjectRef, exactBytes: Readonly<Uint8Array>) {
    const frame = inspectAcceptedFrameObject(this.selectedAuthority, ref, exactBytes)
    return Object.freeze({ ref, requiredBlobDigests: requiredProjectIndexBlobDigests(frame) })
  }

  async applyAcceptedFrame(input: {
    readonly previous: NodeAcceptedReplicaHead
    readonly ref: FrameObjectRef
    readonly exactBytes: Readonly<Uint8Array>
    readonly durableDelta: unknown
  }): Promise<NodeAcceptedReplicaHead> {
    return materializeAcceptedFrame({
      authority: this.selectedAuthority,
      owner: this.runtime,
      previous: input.previous,
      ref: input.ref,
      exactFrameBytes: input.exactBytes,
      durableDelta: input.durableDelta,
      causalClosure: { contains: () => false },
      createDocument: createProjectIndexReconstructionYDoc,
    })
  }

  actorHeadsDigest = replicaActorHeadSetDigest

  observeAcceptedFrame(): void {
    this.observeAttempts += 1
    if (this.fault.observe) throw new Error("simulated post-fsync causal observer failure")
  }
}

async function createFixture(options: Readonly<{
  hooks?: NodeCollaborationPersistenceFaultHooks
  materializerFault?: Readonly<{ observe: boolean }>
  captureAtomicRequests?: boolean
  replicaDurableAckVerifier?: Readonly<{ verifyCurrent(input: unknown): Promise<boolean> }>
}> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-project-atomic-wal-"))
  roots.push(root)
  const collaborationDirectory = path.join(root, ".convax", "collaboration")
  const runtime = createProjectIndexDocumentOwnerRuntime(authority)
  const materializer = new ProjectIndexWalMaterializer(authority, runtime, options.materializerFault)
  const store = await NodeCollaborationPersistence.open({
    collaborationDirectory,
    localActorId: actorId,
    materializer,
    ...(options.hooks ? { hooks: options.hooks } : {}),
    ...(options.replicaDurableAckVerifier
      ? { replicaDurableAckVerifier: options.replicaDurableAckVerifier as never }
      : {}),
  })
  const genesis = await emptyGenesis()
  await store.initializeShard({
    scope,
    checkpointObjectDigest: genesis.manifest.projectIndexGenesisCheckpointObjectDigest,
    checkpointExactBytes: genesis.checkpointExactBytes,
    acceptedBase: genesis.acceptedBase,
  })

  const atomicRequests: Parameters<CollaborationPersistencePort["commitAcceptedFrame"]>[0][] = []
  const atomicResults: Awaited<ReturnType<CollaborationPersistencePort["commitAcceptedFrame"]>>[] = []
  const persistence = options.captureAtomicRequests
    ? new Proxy(store as CollaborationPersistencePort, {
        get(target, property) {
          if (property === "commitAcceptedFrame") {
            return async (request: Parameters<CollaborationPersistencePort["commitAcceptedFrame"]>[0]) => {
              atomicRequests.push(request)
              const result = await target.commitAcceptedFrame(request)
              atomicResults.push(result)
              return result
            }
          }
          const value = Reflect.get(target, property)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
    : store
  const kernel = await CollaborationKernel.open({
    authority,
    scope,
    owner: runtime,
    ports: {
      createDocument: createProjectIndexReconstructionYDoc,
      persistence,
      localAuthority: {
        actorId,
        async prepareFinalFrameAuthority(input) {
          return Object.freeze({
            actorId,
            actorSequence: input.previousActorHead
              ? incrementUint64(input.previousActorHead.actorSequence)
              : "1" as never,
            predecessorFrameDigest: input.previousActorHead?.frameDigest ?? null,
            signerAuthority: Object.freeze({
              kind: "team-replica" as const,
              memberId,
              replicaId,
              actorId,
              memberAuthorizationEpoch: id(3),
              replicaAuthorizationEpoch: id(4),
              membershipSnapshotDigest: membershipDigest,
              replicaActorCredentialCoreDigest: credentialDigest,
              replicaEditAuthorizationCoreDigest: authorizationDigest,
            }),
            dependencies: Object.freeze([
              Object.freeze({ kind: "membership-snapshot" as const, digest: membershipDigest }),
              Object.freeze({ kind: "replica-actor-credential" as const, digest: credentialDigest }),
              Object.freeze({ kind: "replica-edit-authorization" as const, digest: authorizationDigest }),
            ]),
            validationArtifacts: validationArtifacts(authority),
            signer: Object.freeze({ sign: async () => signature }),
          })
        },
      },
      incomingAuthority: { verifyFrameAuthority: async () => ({ replicaPublicKey: publicKey }) },
      incomingFacts: { resolve: async () => ({ status: "rejected" as const }) },
      exactBaseResolver: { reconstructExactBase: async () => "pending" as const },
      causalClosure: { contains: () => false },
      pendingInbox: store,
    },
    signatureVerifier: { verify: async () => true },
  })
  runtimesByKernel.set(kernel, runtime)
  return {
    collaborationDirectory,
    kernel,
    materializer,
    store,
    atomicRequests,
    atomicResults,
    dispose() {
      kernel.dispose()
      store.dispose()
    },
  }
}

async function emptyGenesis() {
  const candidate = createEmptyProjectIndexGenesisCandidate({
    scope,
    actorId,
    operationId: id(5),
    checkpointId: id(6),
    authorMemberId: memberId,
    authorReplicaId: replicaId,
    authorAuthorizationDigest: authorizationDigest,
    validationArtifactSetDigest: ordinarySha256(new TextEncoder().encode("wal-artifact-set")),
    authority: {
      protocolDigest: authority.protocolDigest,
      schemaDigest: PROJECT_INDEX_PROTOCOL_SCHEMA_ARTIFACT_DIGEST,
      uriProtocolDigest: authority.protocolSchemaBundle.core.uriProtocolDigest,
    },
  })
  const checkpoint = Object.freeze({
    format: "convax.replica-checkpoint" as const,
    core: candidate.checkpointCore,
    coreDigest: replicaCheckpointCoreDigest(candidate.checkpointCore),
    replicaSignature: signature,
  })
  try {
    return await verifyEmptyProjectIndexGenesis({
      scope,
      document: candidate.document,
      checkpointExactBytes: encodeRestrictedJcs(checkpoint),
      initializationAuthorityDigest: authorizationDigest,
      verifier: { verify: async () => true },
    })
  } finally {
    candidate.document.destroy()
  }
}

async function commitDirectory(kernel: CollaborationKernel, index: number) {
  return kernel.commitLocalIntent({
    operationId: operationId(index),
    prepare({ base, context }) {
      const snapshot = projectIndexSnapshotFromValidatedOwnerState(
        base as OwnerValidatedState<"project-index">,
      )
      if (snapshot === null) throw new Error("ProjectIndex validated snapshot is missing")
      const position = index % 3 === 0 ? "a" : index % 3 === 1 ? "m" : "z"
      const created = constructProjectDirectoryCreateIntent({
        snapshot,
        context,
        parentDirectoryId: snapshot.identity.rootDirectoryId,
        basename: `${position}-${String(index).padStart(6, "0")}`,
      })
      if (created === "rejected") throw new Error(`ProjectIndex directory ${index} construction rejected`)
      return Object.freeze({
        typedIntent: created.intent,
        externalFacts: emptyFacts(kernelRuntime(kernel)),
      })
    },
  })
}

const runtimesByKernel = new WeakMap<CollaborationKernel, DocumentOwnerRuntime<"project-index">>()

function kernelRuntime(kernel: CollaborationKernel): DocumentOwnerRuntime<"project-index"> {
  const runtime = runtimesByKernel.get(kernel)
  if (!runtime) throw new Error("ProjectIndex kernel runtime is missing")
  return runtime
}

function emptyFacts(runtime: DocumentOwnerRuntime<"project-index">): OwnerExternalFactPort<"project-index"> {
  const result = runtime.externalFactPortFactory.createAttemptPort({
    declared: { validationArtifacts: [], externalFacts: [] },
    resolver: {
      owner: "project-index",
      resolveArtifact: (ref) => ({ status: "pending", ref }),
      resolveFact: (requirement) => ({ status: "pending", requirement }),
    },
  })
  if (result.status === "rejected") throw new Error(`ProjectIndex empty fact port rejected: ${result.code}`)
  return result.port
}

function validationArtifacts(selected: CurrentProtocolAuthority): ValidationArtifactSet {
  const ownerByName = {
    "canvas-schema": "canvas",
    "collaboration-kernel": "kernel",
    "control-plane": "control-plane",
    "project-persistence": "project-index",
  } as const
  return Object.freeze({
    format: "convax.validation-artifact-set",
    artifacts: Object.freeze(selected.protocolSchemaBundle.core.artifacts
      .map((artifact) => Object.freeze({
        owner: ownerByName[artifact.name],
        format: artifact.format,
        artifactDigest: artifact.artifactDigest,
      }))
      .sort((left, right) => left.owner.localeCompare(right.owner))),
  })
}

function countDelta(
  before: ReturnType<typeof nodeCollaborationPersistenceStructuralCounts>,
  after: ReturnType<typeof nodeCollaborationPersistenceStructuralCounts>,
) {
  return Object.fromEntries(Object.keys(before).map((key) => [
    key,
    after[key as keyof typeof after] - before[key as keyof typeof before],
  ])) as Record<keyof typeof before, number>
}

function operationId(index: number): Id128 {
  const bytes = Buffer.alloc(16)
  bytes.writeUInt32BE(index + 100, 12)
  return parseId128(encodeBase64url(bytes))
}

function id(byte: number): Id128 {
  return parseId128(encodeBase64url(Buffer.alloc(16, byte)))
}

function actor(byte: number) {
  return parseActorId(encodeBase64url(Buffer.alloc(32, byte)))
}
