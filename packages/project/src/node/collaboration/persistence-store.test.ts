import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type {
  ActorId,
  CausalFrontier,
  DecodedCausalEditFrame,
  Digest,
  DocumentScope,
  FrameObjectRef,
  Id128,
  ReplicaActorHeadSet,
  MemberId,
  ReplicaId,
  StateVector,
} from "@convax/collaboration"
import { deriveDocumentNativeKey, deriveObjectNativeKey } from "./native-store-keys"
import {
  NodeCollaborationPersistenceError,
  NodeCollaborationPersistence,
  type NodeAcceptedReplicaHead,
  type NodeCollaborationPersistenceFaultHooks,
  type NodeLocalCommitDurabilityDiagnostics,
  type NodeLocalCommitDurabilityMeasurement,
  type NodeReplicaHeadMaterializer,
} from "./persistence-store"

const roots: string[] = []
const encoder = new TextEncoder()
const projectEpoch = id128(1)
const shardEpoch = id128(2)
const localActor = actorId(1)
const remoteActor = actorId(2)
const durabilityTest = test.skipIf(process.platform === "win32")

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("NodeCollaborationPersistence", () => {
  durabilityTest("transfers the privately owned pending head into the hot cache without recopying its full update", async () => {
    const fixture = await createFixture()
    const scope = projectIndexScope()
    const genesis = await initialize(fixture.store, scope)
    const frame = fixture.frames.create(scope, localActor, "1", id128(119))
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    await fixture.store.putReplicationOutboxRef(frame.ref)
    const journal = await fixture.store.appendFrameJournal(frame.ref)

    const from = spyOn(Uint8Array, "from")
    try {
      const committed = await fixture.store.compareAndCommitReplicaHead({
        ref: frame.ref,
        journal,
        expectedReplicaHeadRecordDigest: genesis.headDigest,
        resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref),
      })
      expect(committed.status).toBe("committed")
      // The only same-sized conversion is the required frame file read. A pending
      // head rebind or cache install must not clone the full update again.
      expect(from.mock.calls.filter(([value]) =>
        value instanceof Uint8Array && value.byteLength === frame.bytes.byteLength
      )).toHaveLength(1)
    } finally {
      from.mockRestore()
    }

    const exposed = await fixture.store.loadReplicaHead(scope) as NodeAcceptedReplicaHead
    const expected = Uint8Array.from(exposed.fullUpdate)
    exposed.fullUpdate.fill(0xff)
    expect((await fixture.store.loadReplicaHead(scope) as NodeAcceptedReplicaHead).fullUpdate).toEqual(expected)
    fixture.store.dispose()
  })

  durabilityTest("fast head verification is disk-bound and fails closed for mismatch, cache mutation, and below-head recovery", async () => {
    const fixture = await createFixture()
    const scope = projectIndexScope()
    const genesis = await initialize(fixture.store, scope)
    expect(await fixture.store.verifyReplicaHeadCurrent({
      scope,
      expectedHeadDigest: genesis.headDigest,
      expectedFrontierDigest: genesis.frontierDigest,
    })).toBe("verified")
    expect(await fixture.store.verifyReplicaHeadCurrent({
      scope,
      expectedHeadDigest: digest("stale-head"),
      expectedFrontierDigest: genesis.frontierDigest,
    })).toBe("reload-required")
    expect(await fixture.store.verifyReplicaHeadCurrent({
      scope,
      expectedHeadDigest: genesis.headDigest,
      expectedFrontierDigest: digest("stale-frontier"),
    })).toBe("reload-required")

    const exposed = await fixture.store.loadReplicaHead(scope) as NodeAcceptedReplicaHead
    exposed.fullUpdate.fill(0xff)
    exposed.stateVector.fill(0xff)
    expect(await fixture.store.verifyReplicaHeadCurrent({
      scope,
      expectedHeadDigest: genesis.headDigest,
      expectedFrontierDigest: genesis.frontierDigest,
    })).toBe("verified")

    const frame = fixture.frames.create(scope, localActor, "1", id128(120))
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    await fixture.store.putReplicationOutboxRef(frame.ref)
    await fixture.store.appendFrameJournal(frame.ref)
    expect(await fixture.store.verifyReplicaHeadCurrent({
      scope,
      expectedHeadDigest: genesis.headDigest,
      expectedFrontierDigest: genesis.frontierDigest,
    })).toBe("reload-required")
    fixture.store.dispose()
  })

  durabilityTest("physically shards ProjectIndex and Canvas without raw identities in paths", async () => {
    const fixture = await createFixture()
    const index = projectIndexScope()
    const canvas = canvasScope()
    await initialize(fixture.store, index)
    await initialize(fixture.store, canvas)

    const names = (await fs.readdir(path.join(fixture.collaborationDirectory, "documents"))).sort()
    expect(names).toEqual([deriveDocumentNativeKey(index), deriveDocumentNativeKey(canvas)].sort())
    expect(names.join("/")).not.toContain("project-index")
    expect(names.join("/")).not.toContain("cv_")
    expect((await fixture.store.loadReplicaHead(index) as NodeAcceptedReplicaHead).scope).toEqual(index)
    expect((await fixture.store.loadReplicaHead(canvas) as NodeAcceptedReplicaHead).scope).toEqual(canvas)
    fixture.store.dispose()
  })

  durabilityTest("publishes checkpoint, base, head and genesis proof behind one idempotent shard barrier", async () => {
    const fixture = await createFixture()
    const scope = canvasScope()
    const input = genesisProofInput(scope, "proof-one")
    const first = await fixture.store.initializeShardWithGenesisProof(input)
    expect(await fixture.store.readGenesisProof(scope, input.checkpointObjectDigest)).toEqual(input.proofCarrierExactBytes)
    expect(await fixture.store.initializeShardWithGenesisProof(input)).toEqual(first)
    await expect(fixture.store.initializeShardWithGenesisProof({
      ...input,
      proofCarrierExactBytes: encoder.encode("proof-equivocation"),
    })).rejects.toMatchObject({ code: "store-corrupt" })
    fixture.store.dispose()
  })

  durabilityTest("inspects the durable frame only once while deriving its outbox record", async () => {
    const fixture = await createFixture()
    const scope = projectIndexScope()
    await initialize(fixture.store, scope)
    const frame = fixture.frames.create(scope, localActor, "1", id128(121))
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    const beforeOutbox = fixture.frames.inspectCount

    await fixture.store.putReplicationOutboxRef(frame.ref)

    expect(fixture.frames.inspectCount - beforeOutbox).toBe(1)
    fixture.store.dispose()
  })

  durabilityTest("fails closed when the sole durable head loses its installed checkpoint-set closure", async () => {
    const fixture = await createFixture()
    const scope = projectIndexScope()
    await initialize(fixture.store, scope)
    const sets = path.join(
      fixture.collaborationDirectory,
      "documents",
      deriveDocumentNativeKey(scope),
      "snapshots",
      "sets",
    )
    const [setName] = await fs.readdir(sets)
    await fs.unlink(path.join(sets, setName!))
    fixture.store.dispose()
    const reopened = await NodeCollaborationPersistence.open({
      collaborationDirectory: fixture.collaborationDirectory,
      localActorId: localActor,
      materializer: fixture.frames,
    })
    await expect(reopened.loadReplicaHead(scope)).rejects.toMatchObject({ code: "store-corrupt" })
    reopened.dispose()
  })

  durabilityTest("installs a verified checkpoint set behind object, journal and sole-head barriers", async () => {
    const fixture = await createFixture({}, undefined, { verifyCurrent: async () => true })
    const scope = projectIndexScope()
    const genesis = await initialize(fixture.store, scope)
    const checkpoint = fixture.frames.createCheckpoint(await fixture.store.loadReplicaHead(scope) as NodeAcceptedReplicaHead)
    const contentCertificate = encoder.encode("content-certificate")
    const result = await fixture.store.installCheckpointSet({
      scope,
      expectedReplicaHeadRecordDigest: genesis.headDigest,
      bootstrapCheckpointObjectDigest: checkpoint.objectDigest,
      checkpointObjects: [checkpoint],
      contentCertificateObjects: [{ objectDigest: digestBytes(contentCertificate), exactBytes: contentCertificate }],
      prunableSetCertificateObjects: [],
    })
    expect(result.status).toBe("committed")
    expect((await fixture.store.loadInstalledBase(scope)).canonicalStateDigest).toBe(checkpoint.accepted.canonicalStateDigest)
    fixture.store.dispose()

    const reopened = await NodeCollaborationPersistence.open({
      collaborationDirectory: fixture.collaborationDirectory,
      localActorId: localActor,
      materializer: fixture.frames,
      checkpointInstallationVerifier: { verifyCurrent: async () => true },
    })
    expect((await reopened.loadInstalledBase(scope)).fullUpdate).toEqual(checkpoint.accepted.fullUpdate)
    reopened.dispose()
  })

  durabilityTest("does not write checkpoint candidates for a stale sole head", async () => {
    const fixture = await createFixture({}, undefined, { verifyCurrent: async () => true })
    const scope = projectIndexScope()
    await initialize(fixture.store, scope)
    const checkpoint = fixture.frames.createCheckpoint(await fixture.store.loadReplicaHead(scope) as NodeAcceptedReplicaHead)
    const result = await fixture.store.installCheckpointSet({
      scope,
      expectedReplicaHeadRecordDigest: digest("stale-head"),
      bootstrapCheckpointObjectDigest: checkpoint.objectDigest,
      checkpointObjects: [checkpoint],
      contentCertificateObjects: [{ objectDigest: digest("certificate"), exactBytes: encoder.encode("certificate") }],
      prunableSetCertificateObjects: [],
    })
    expect(result).toEqual({ status: "rejected", code: "head-stale" })
    const checkpointDirectory = path.join(fixture.collaborationDirectory, "documents", deriveDocumentNativeKey(scope), "objects", "checkpoints")
    expect(await fs.readdir(checkpointDirectory)).toHaveLength(1)
    fixture.store.dispose()
  })

  durabilityTest("prunes only after dual authority, a new journal-base head and a second complete root scan", async () => {
    const beforeRoots = digest("roots-before")
    const afterRoots = digest("roots-after")
    let scan = 0
    const fixture = await createFixture(
      {},
      { verifyCurrent: async () => true },
      { verifyCurrent: async () => true },
      { verifyCurrent: async () => ({ verified: true as const, expectedPostBarrierRootSetDigest: afterRoots }) },
      { scanComplete: async () => ({ complete: true, rootSetDigest: scan++ === 0 ? beforeRoots : afterRoots, retainedObjectDigests: [] }) },
    )
    const scope = projectIndexScope()
    const genesis = await initialize(fixture.store, scope)
    const frame = fixture.frames.create(scope, localActor, "1", id128(122))
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    await fixture.store.putReplicationOutboxRef(frame.ref)
    const frameJournal = await fixture.store.appendFrameJournal(frame.ref)
    const accepted = await fixture.store.compareAndCommitReplicaHead({
      ref: frame.ref,
      journal: frameJournal,
      expectedReplicaHeadRecordDigest: genesis.headDigest,
      resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref),
    })
    if (accepted.status !== "committed") throw new Error("expected accepted frame")
    await fixture.store.recordVerifiedReplicaDurableAck(durableAck(frame.ref))
    const current = await fixture.store.loadReplicaHead(scope) as NodeAcceptedReplicaHead
    const checkpoint = fixture.frames.createCheckpoint(current)
    const contentCertificate = encoder.encode("prune-content-certificate")
    const prunableCertificate = encoder.encode("prunable-set-certificate")
    const installed = await fixture.store.installCheckpointSet({
      scope,
      expectedReplicaHeadRecordDigest: current.headDigest,
      bootstrapCheckpointObjectDigest: checkpoint.objectDigest,
      checkpointObjects: [checkpoint],
      contentCertificateObjects: [{ objectDigest: digestBytes(contentCertificate), exactBytes: contentCertificate }],
      prunableSetCertificateObjects: [{ objectDigest: digestBytes(prunableCertificate), exactBytes: prunableCertificate }],
    })
    if (installed.status !== "committed") throw new Error("expected installed checkpoint")
    const floor = encoder.encode("complete-causal-floor")
    const pruned = await fixture.store.pruneCheckpointHistory({
      scope,
      expectedReplicaHeadRecordDigest: installed.resultingReplicaHeadRecordDigest,
      prunableSetCertificateObjectDigest: digestBytes(prunableCertificate),
      causalFloorObjectDigest: digestBytes(floor),
      causalFloorExactBytes: floor,
      candidateDeleteObjects: [{ kind: "frame", objectDigest: frame.ref.frameDigest, exactByteLength: String(frame.bytes.byteLength) }],
    })
    expect(pruned.status).toBe("deleted")
    expect(pruned.deletedObjectCount).toBe(1)
    expect((await fixture.store.loadReplicaHead(scope) as NodeAcceptedReplicaHead).canonicalStateDigest).toBe(current.canonicalStateDigest)
    const framePath = path.join(
      fixture.collaborationDirectory,
      "documents",
      deriveDocumentNativeKey(scope),
      "objects",
      "frames",
      `${deriveObjectNativeKey("frame", frame.ref.frameDigest)}.bin`,
    )
    await expect(fs.lstat(framePath)).rejects.toBeDefined()
    fixture.store.dispose()
  })

  durabilityTest("does not publish a partial genesis and resumes the same G after staging loss", async () => {
    let fail = true
    const fixture = await createFixture({
      afterGenesisStagingFsync: async () => {
        if (!fail) return
        fail = false
        throw new Error("simulated loss before genesis directory publication")
      },
    })
    const scope = canvasScope()
    const input = genesisProofInput(scope, "proof-retry")
    await expect(fixture.store.initializeShardWithGenesisProof(input)).rejects.toMatchObject({ code: "durability-failed" })
    const published = path.join(fixture.collaborationDirectory, "documents", deriveDocumentNativeKey(scope))
    await expect(fs.lstat(published)).rejects.toBeDefined()
    const recovered = await fixture.store.initializeShardWithGenesisProof(input)
    expect(recovered.scope).toEqual(scope)
    expect(await fixture.store.readGenesisProof(scope, input.checkpointObjectDigest)).toEqual(input.proofCarrierExactBytes)
    fixture.store.dispose()
  })

  durabilityTest("crosses object, outbox, journal and sole-head barriers before ACK eligibility", async () => {
    const events: string[] = []
    const fixture = await createFixture({
      afterFrameFileFsync: async () => { events.push("frame") },
      afterOutboxFileFsync: async () => { events.push("outbox") },
      afterJournalFileFsync: async () => { events.push("journal") },
      afterHeadTempFsync: async () => { events.push("head-temp") },
      afterHeadRename: async () => { events.push("head-rename") },
      afterHeadDirectoryFsync: async () => { events.push("head-directory") },
    })
    const scope = projectIndexScope()
    const genesis = await initialize(fixture.store, scope)
    const frame = fixture.frames.create(scope, localActor, "1", id128(11))

    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    expect(await fixture.store.isReachableFromAcceptedHead(frame.ref)).toBe(false)
    await fixture.store.putReplicationOutboxRef(frame.ref)
    expect(await fixture.store.isFrameDurableForAck(frame.ref)).toBe(false)
    const journal = await fixture.store.appendFrameJournal(frame.ref)
    expect(await fixture.store.isReachableFromAcceptedHead(frame.ref)).toBe(false)
    const result = await fixture.store.compareAndCommitReplicaHead({
      ref: frame.ref,
      journal,
      expectedReplicaHeadRecordDigest: genesis.headDigest,
      resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref),
    })
    expect(result.status).toBe("committed")
    expect(events).toEqual(["frame", "outbox", "journal", "head-temp", "head-rename", "head-directory"])
    expect(await fixture.store.isReachableFromAcceptedHead(frame.ref)).toBe(true)
    expect(await fixture.store.isFrameDurableForAck(frame.ref)).toBe(true)
    fixture.store.dispose()
  })

  durabilityTest("observes the real local commit durability calls per root attempt", async () => {
    const measurements: NodeLocalCommitDurabilityMeasurement[] = []
    let attemptId: string | undefined
    const diagnostics: NodeLocalCommitDurabilityDiagnostics = {
      currentAttemptId: () => attemptId,
      observe: (measurement) => measurements.push(measurement),
      observeLocalStep: () => {
        throw new Error("local profiling sink unavailable")
      },
    }
    const fixture = await createFixture({}, undefined, undefined, undefined, undefined, diagnostics)
    const scope = projectIndexScope()
    const genesis = await initialize(fixture.store, scope)
    expect(measurements).toEqual([])
    const frame = fixture.frames.create(scope, localActor, "1", id128(211))

    attemptId = "root-1"
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    await fixture.store.putReplicationOutboxRef(frame.ref)
    const journal = await fixture.store.appendFrameJournal(frame.ref)
    const result = await fixture.store.compareAndCommitReplicaHead({
      ref: frame.ref,
      journal,
      expectedReplicaHeadRecordDigest: genesis.headDigest,
      resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref),
    })
    expect(result.status).toBe("committed")
    expect(measurements.every((entry) => entry.attemptId === "root-1" && entry.operationId === frame.ref.operationId)).toBe(true)
    expect(measurements.every((entry) => entry.callCount === 1 && entry.durationNanoseconds >= 0n && entry.outcome === "succeeded")).toBe(true)
    expect(measurements.map(({ stage, barrierKind }) => `${stage}:${barrierKind}`)).toEqual([
      "object-frame:file-sync",
      "object-frame:directory-sync",
      "object-operation-sidecar:file-sync",
      "object-operation-sidecar:directory-sync",
      "outbox:file-sync",
      "outbox:directory-sync",
      "journal:file-sync",
      "journal:directory-sync",
      "journal:directory-sync",
      "head:file-sync",
      "head:directory-sync",
    ])

    const counts = Object.fromEntries(["object-frame", "object-operation-sidecar", "outbox", "journal", "head"].map(
      (stage) => [stage, measurements.filter((entry) => entry.stage === stage).reduce((sum, entry) => sum + entry.callCount, 0)],
    ))
    expect(counts).toEqual({
      "object-frame": 2,
      "object-operation-sidecar": 2,
      outbox: 2,
      journal: 3,
      head: 2,
    })

    attemptId = "root-1-retry"
    const beforeRetry = measurements.length
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    await fixture.store.putReplicationOutboxRef(frame.ref)
    await fixture.store.compareAndCommitReplicaHead({
      ref: frame.ref,
      journal,
      expectedReplicaHeadRecordDigest: genesis.headDigest,
      resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref),
    })
    expect(measurements).toHaveLength(beforeRetry)
    fixture.store.dispose()
  })

  durabilityTest("exposes only the installed base and accepted exact frame closure", async () => {
    const fixture = await createFixture()
    const scope = projectIndexScope()
    const genesis = await initialize(fixture.store, scope)
    const installed = await fixture.store.loadInstalledBase(scope)
    expect(installed.frontier.heads).toEqual([])
    expect(installed.headDigest).not.toBe(genesis.headDigest)
    const frame = fixture.frames.create(scope, localActor, "1", id128(112))
    expect(await fixture.store.readAcceptedFrame(scope, frame.ref.frameDigest)).toBeNull()
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    expect(await fixture.store.readAcceptedFrame(scope, frame.ref.frameDigest)).toBeNull()
    await fixture.store.putReplicationOutboxRef(frame.ref)
    const journal = await fixture.store.appendFrameJournal(frame.ref)
    const committed = await fixture.store.compareAndCommitReplicaHead({
      ref: frame.ref,
      journal,
      expectedReplicaHeadRecordDigest: genesis.headDigest,
      resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref),
    })
    if (committed.status !== "committed") throw new Error("expected committed frame")
    expect(await fixture.store.readAcceptedFrame(scope, frame.ref.frameDigest)).toEqual(frame.bytes)
    expect(await fixture.store.listAcceptedFrames(scope)).toEqual([{ ref: frame.ref, exactFrameBytes: frame.bytes }])
    expect((await fixture.store.loadInstalledBase(scope)).frontier.heads).toEqual([])
    fixture.store.dispose()
  })

  durabilityTest("retains dependency-pending exact bytes durably and idempotently outside accepted objects", async () => {
    const fixture = await createFixture()
    const scope = projectIndexScope()
    await initialize(fixture.store, scope)
    const frame = fixture.frames.create(scope, remoteActor, "1", id128(113))
    const decoded = decodedFrame(frame)
    expect(await fixture.store.retainExactFrame(decoded, "missing-base")).toBe("retained")
    expect(await fixture.store.retainExactFrame(decoded, "missing-proof")).toBe("retained")
    expect(await fixture.store.readAcceptedFrame(scope, frame.ref.frameDigest)).toBeNull()
    const pendingDirectory = path.join(
      fixture.collaborationDirectory,
      "documents",
      deriveDocumentNativeKey(scope),
      "inbox",
      "pending-frames",
    )
    expect(await fs.readdir(pendingDirectory)).toHaveLength(1)
    fixture.store.dispose()
    const reopened = await NodeCollaborationPersistence.open({
      collaborationDirectory: fixture.collaborationDirectory,
      localActorId: localActor,
      materializer: fixture.frames,
    })
    expect(await reopened.retainExactFrame(decoded, "missing-artifact")).toBe("retained")
    expect(await fs.readdir(pendingDirectory)).toHaveLength(1)
    reopened.dispose()
  })

  durabilityTest("lists only exact durable outbox frames and retains them for separate ACK policy", async () => {
    const fixture = await createFixture()
    const scope = projectIndexScope()
    const genesis = await initialize(fixture.store, scope)
    const frame = fixture.frames.create(scope, localActor, "1", id128(111))
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    await fixture.store.putReplicationOutboxRef(frame.ref)
    await expect(fixture.store.listDurableReplicationOutbox(scope)).rejects.toMatchObject({
      code: "read-only-recovery-required",
    })
    const journal = await fixture.store.appendFrameJournal(frame.ref)
    await fixture.store.compareAndCommitReplicaHead({
      ref: frame.ref,
      journal,
      expectedReplicaHeadRecordDigest: genesis.headDigest,
      resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref),
    })

    const first = await fixture.store.listDurableReplicationOutbox(scope)
    expect(first).toHaveLength(1)
    expect(first[0]?.ref).toEqual(frame.ref)
    expect(first[0]?.exactFrameBytes).toEqual(frame.bytes)
    expect(first[0]?.requiredBlobDigests).toEqual([])
    expect(await fixture.store.isFrameDurableForAck(frame.ref)).toBe(true)
    expect(await fixture.store.listDurableReplicationOutbox(scope)).toEqual(first)
    fixture.store.dispose()
  })

  durabilityTest("journals a verified replica ACK before retiring the frame outbox and reopens it idempotently", async () => {
    const fixture = await createFixture({}, { verifyCurrent: async () => true })
    const scope = projectIndexScope()
    const genesis = await initialize(fixture.store, scope)
    const frame = fixture.frames.create(scope, localActor, "1", id128(119))
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    await fixture.store.putReplicationOutboxRef(frame.ref)
    const journal = await fixture.store.appendFrameJournal(frame.ref)
    await fixture.store.compareAndCommitReplicaHead({ ref: frame.ref, journal, expectedReplicaHeadRecordDigest: genesis.headDigest, resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref) })
    const ack = durableAck(frame.ref)
    const receipt = await fixture.store.recordVerifiedReplicaDurableAck(ack)
    expect(receipt).toMatch(/^[0-9a-f]{64}$/)
    expect(await fixture.store.listDurableReplicationOutbox(scope)).toEqual([])
    expect(await fixture.store.listDurableReplicaAcks(scope)).toEqual([ack])
    expect(await fixture.store.recordVerifiedReplicaDurableAck(ack)).toBe(receipt)
    fixture.store.dispose()
  })

  durabilityTest("recovers an ACK journal below head before outbox retirement", async () => {
    let armed = false
    const verifier = { verifyCurrent: async () => true }
    const fixture = await createFixture({ afterJournalFileFsync: async () => { if (armed) throw new Error("ack crash") } }, verifier)
    const scope = projectIndexScope()
    const genesis = await initialize(fixture.store, scope)
    const frame = fixture.frames.create(scope, localActor, "1", id128(120))
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    await fixture.store.putReplicationOutboxRef(frame.ref)
    const journal = await fixture.store.appendFrameJournal(frame.ref)
    await fixture.store.compareAndCommitReplicaHead({ ref: frame.ref, journal, expectedReplicaHeadRecordDigest: genesis.headDigest, resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref) })
    armed = true
    await expect(fixture.store.recordVerifiedReplicaDurableAck(durableAck(frame.ref))).rejects.toThrow("ack crash")
    expect(await fixture.store.listDurableReplicationOutbox(scope)).toHaveLength(1)
    fixture.store.dispose()
    const reopened = await NodeCollaborationPersistence.open({ collaborationDirectory: fixture.collaborationDirectory, localActorId: localActor, materializer: fixture.frames, replicaDurableAckVerifier: verifier })
    await reopened.loadReplicaHead(scope)
    expect(await reopened.listDurableReplicationOutbox(scope)).toEqual([])
    expect(await reopened.listDurableReplicaAcks(scope)).toHaveLength(1)
    reopened.dispose()
  })

  durabilityTest("closes the shard when outbox cleanup is visible but its durable ACK object is missing", async () => {
    const fixture = await createFixture({}, { verifyCurrent: async () => true })
    const scope = projectIndexScope()
    const genesis = await initialize(fixture.store, scope)
    const frame = fixture.frames.create(scope, localActor, "1", id128(121))
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    await fixture.store.putReplicationOutboxRef(frame.ref)
    const journal = await fixture.store.appendFrameJournal(frame.ref)
    await fixture.store.compareAndCommitReplicaHead({ ref: frame.ref, journal, expectedReplicaHeadRecordDigest: genesis.headDigest, resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref) })
    const ack = durableAck(frame.ref)
    await fixture.store.recordVerifiedReplicaDurableAck(ack)
    const ackPath = path.join(
      fixture.collaborationDirectory,
      "documents",
      deriveDocumentNativeKey(scope),
      "objects",
      "acks",
      `${deriveObjectNativeKey("ack", ack.ackCoreDigest)}.bin`,
    )
    await fs.unlink(ackPath)
    await expect(fixture.store.loadReplicaHead(scope)).rejects.toMatchObject({ code: "store-corrupt" })
    fixture.store.dispose()
  })

  durabilityTest("fails closed on an unexpected outbox filename instead of skipping it", async () => {
    const fixture = await createFixture()
    const scope = projectIndexScope()
    await initialize(fixture.store, scope)
    const documentDirectory = path.join(
      fixture.collaborationDirectory,
      "documents",
      deriveDocumentNativeKey(scope),
      "outbox",
      "frames",
    )
    await fs.writeFile(path.join(documentDirectory, "unexpected.ref"), "{}")
    await expect(fixture.store.listDurableReplicationOutbox(scope)).rejects.toMatchObject({
      code: "store-corrupt",
    })
    fixture.store.dispose()
  })

  durabilityTest("reopen completes the exact journal-below-head frame without command replay", async () => {
    const fixture = await createFixture()
    const scope = projectIndexScope()
    await initialize(fixture.store, scope)
    const frame = fixture.frames.create(scope, localActor, "1", id128(12))
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    await fixture.store.putReplicationOutboxRef(frame.ref)
    await fixture.store.appendFrameJournal(frame.ref)
    expect(fixture.frames.applyCount).toBe(1)
    fixture.store.dispose()

    const reopened = await NodeCollaborationPersistence.open({
      collaborationDirectory: fixture.collaborationDirectory,
      localActorId: localActor,
      materializer: fixture.frames,
    })
    const head = await reopened.loadReplicaHead(scope) as NodeAcceptedReplicaHead
    expect(head.fullUpdate).toEqual(frame.bytes)
    expect(await reopened.isReachableFromAcceptedHead(frame.ref)).toBe(true)
    expect(fixture.frames.applyCount).toBe(2)
    reopened.dispose()
  })

  durabilityTest("materializes only the new frame once on a warm commit regardless of retained history", async () => {
    const fixture = await createFixture()
    const scope = projectIndexScope()
    let head = await initialize(fixture.store, scope)
    for (let sequence = 1; sequence <= 32; sequence += 1) {
      const frame = fixture.frames.create(scope, localActor, String(sequence), id128(500 + sequence))
      const before = fixture.frames.applyCount
      await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
      await fixture.store.putReplicationOutboxRef(frame.ref)
      const journal = await fixture.store.appendFrameJournal(frame.ref)
      const result = await fixture.store.compareAndCommitReplicaHead({
        ref: frame.ref,
        journal,
        expectedReplicaHeadRecordDigest: head.headDigest,
        resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref),
      })
      if (result.status !== "committed") throw new Error("expected committed frame")
      head = await fixture.store.loadReplicaHead(scope) as NodeAcceptedReplicaHead
      expect(fixture.frames.applyCount - before).toBe(1)
    }
    expect(await fixture.store.listDurableReplicationOutbox(scope)).toHaveLength(32)
    expect(fixture.frames.applyCount).toBe(32)
    fixture.store.dispose()
  })

  durabilityTest("accepts a complete head after response loss immediately after rename", async () => {
    let crash = true
    const fixture = await createFixture({
      afterHeadRename: async () => {
        if (crash) {
          crash = false
          throw new Error("simulated process loss after rename")
        }
      },
    })
    const scope = projectIndexScope()
    const genesis = await initialize(fixture.store, scope)
    const frame = fixture.frames.create(scope, remoteActor, "1", id128(13))
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    await fixture.store.putReplicationOutboxRef(frame.ref)
    const journal = await fixture.store.appendFrameJournal(frame.ref)
    expect(await fixture.store.isFrameDurableForAck(frame.ref)).toBe(false)
    expect(await fixture.store.compareAndCommitReplicaHead({
      ref: frame.ref,
      journal,
      expectedReplicaHeadRecordDigest: genesis.headDigest,
      resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref),
    })).toEqual({ status: "rejected", code: "durability-failed" })

    fixture.store.dispose()
    const reopened = await NodeCollaborationPersistence.open({
      collaborationDirectory: fixture.collaborationDirectory,
      localActorId: localActor,
      materializer: fixture.frames,
    })
    expect(await reopened.isReachableFromAcceptedHead(frame.ref)).toBe(true)
    expect(await reopened.isFrameDurableForAck(frame.ref)).toBe(true)
    reopened.dispose()
  })

  durabilityTest("lookup distinguishes object-only, same-frame recovery and accepted", async () => {
    const fixture = await createFixture()
    const scope = projectIndexScope()
    const genesis = await initialize(fixture.store, scope)
    const frame = fixture.frames.create(scope, localActor, "1", id128(14))
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    expect((await fixture.store.lookupOperation(frame.ref.actorId, frame.ref.operationId)).status).toBe("object-only-recovery")
    await fixture.store.putReplicationOutboxRef(frame.ref)
    const journal = await fixture.store.appendFrameJournal(frame.ref)
    expect((await fixture.store.lookupOperation(frame.ref.actorId, frame.ref.operationId)).status).toBe("same-frame-recovery")
    await fixture.store.compareAndCommitReplicaHead({
      ref: frame.ref,
      journal,
      expectedReplicaHeadRecordDigest: genesis.headDigest,
      resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref),
    })
    expect((await fixture.store.lookupOperation(frame.ref.actorId, frame.ref.operationId)).status).toBe("accepted")
    fixture.store.dispose()
  })

  durabilityTest("reopens an opaque object-only frame after loss at the immutable-object barrier", async () => {
    let crash = true
    const fixture = await createFixture({
      afterFrameFileFsync: async () => {
        if (crash) {
          crash = false
          throw new Error("simulated process loss after frame closure fsync")
        }
      },
    })
    const scope = projectIndexScope()
    await initialize(fixture.store, scope)
    const frame = fixture.frames.create(scope, localActor, "1", id128(141))
    await expect(fixture.store.putImmutableFrame(frame.ref, frame.bytes)).rejects.toThrow(
      "simulated process loss after frame closure fsync",
    )
    fixture.store.dispose()

    const reopened = await NodeCollaborationPersistence.open({
      collaborationDirectory: fixture.collaborationDirectory,
      localActorId: localActor,
      materializer: fixture.frames,
    })
    expect((await reopened.lookupOperation(frame.ref.actorId, frame.ref.operationId)).status).toBe(
      "object-only-recovery",
    )
    reopened.dispose()
  })

  durabilityTest("stale head evidence quarantines the shard instead of exposing a version conflict", async () => {
    const fixture = await createFixture()
    const scope = projectIndexScope()
    const genesis = await initialize(fixture.store, scope)
    const frame = fixture.frames.create(scope, localActor, "1", id128(15))
    await fixture.store.putImmutableFrame(frame.ref, frame.bytes)
    await fixture.store.putReplicationOutboxRef(frame.ref)
    const journal = await fixture.store.appendFrameJournal(frame.ref)
    const committed = await fixture.store.compareAndCommitReplicaHead({
      ref: frame.ref,
      journal,
      expectedReplicaHeadRecordDigest: genesis.headDigest,
      resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref),
    })
    if (committed.status !== "committed") throw new Error("expected committed frame")
    const result = await fixture.store.compareAndCommitReplicaHead({
      ref: frame.ref,
      journal,
      expectedReplicaHeadRecordDigest: digest("not-the-prior-head"),
      resultingFrontierDigest: fixture.frames.frontierDigest(frame.ref),
    })
    expect(result.status).toBe("quarantined")
    if (result.status !== "quarantined") throw new Error("expected quarantine evidence")
    expect(await fixture.store.verifyReplicaHeadCurrent({
      scope,
      expectedHeadDigest: committed.evidence.resultingReplicaHeadRecordDigest,
      expectedFrontierDigest: fixture.frames.frontierDigest(frame.ref),
    })).toBe("reload-required")
    const disposition = await fixture.store.loadReplicaHead(scope) as NodeAcceptedReplicaHead
    expect(disposition.headDigest).toBe(result.evidence.shardDispositionHeadRecordDigest)
    expect(await fixture.store.isFrameDurableForAck(frame.ref)).toBe(false)
    await expect(fixture.store.putReplicationOutboxRef(frame.ref)).rejects.toMatchObject({
      code: "read-only-recovery-required",
    })
    fixture.store.dispose()
  })

  test("enforces one Main-owned writer lease per Project in a process", async () => {
    const fixture = await createFixture()
    await expect(NodeCollaborationPersistence.open({
      collaborationDirectory: fixture.collaborationDirectory,
      localActorId: localActor,
      materializer: fixture.frames,
    })).rejects.toBeInstanceOf(NodeCollaborationPersistenceError)
    fixture.store.dispose()
    const reopened = await NodeCollaborationPersistence.open({
      collaborationDirectory: fixture.collaborationDirectory,
      localActorId: localActor,
      materializer: fixture.frames,
    })
    reopened.dispose()
  })
})

class FakeFrameMaterializer implements NodeReplicaHeadMaterializer {
  readonly records = new Map<string, { bytes: Uint8Array; ref: FrameObjectRef }>()
  readonly checkpoints = new Map<string, { bytes: Uint8Array; accepted: Omit<NodeAcceptedReplicaHead, "headDigest"> }>()
  applyCount = 0
  inspectCount = 0

  readonly create = (scope: DocumentScope, actorId: ActorId, actorSequence: string, operationId: Id128) => {
    const seed = encoder.encode(`${actorId}:${actorSequence}:${operationId}:${this.records.size}`)
    const frameDigest = digestBytes(seed)
    const ref = { scope, actorId, actorSequence, operationId, frameDigest } as FrameObjectRef
    const bytes = Uint8Array.from(seed)
    this.records.set(frameDigest, { bytes, ref })
    return { bytes, ref }
  }

  async inspectFrame(ref: FrameObjectRef, exactBytes: Readonly<Uint8Array>) {
    this.inspectCount += 1
    const expected = this.records.get(ref.frameDigest)
    if (!expected || !Buffer.from(expected.bytes).equals(Buffer.from(exactBytes))) throw new Error("unknown fake frame")
    return { ref: expected.ref, requiredBlobDigests: [] }
  }

  async applyAcceptedFrame(input: {
    previous: NodeAcceptedReplicaHead
    ref: FrameObjectRef
    exactBytes: Readonly<Uint8Array>
  }): Promise<NodeAcceptedReplicaHead> {
    await this.inspectFrame(input.ref, input.exactBytes)
    this.applyCount += 1
    const head = {
      format: "convax.causal-head-ref",
      actorId: input.ref.actorId,
      actorSequence: input.ref.actorSequence,
      frameDigest: input.ref.frameDigest,
      lamport: input.ref.actorSequence,
    } as const
    const frontier = { format: "convax.causal-frontier", heads: [head] } as CausalFrontier
    const actorHeads = { format: "convax.replica-actor-head-set", scope: input.ref.scope, heads: [head] } as ReplicaActorHeadSet
    return {
      scope: input.ref.scope,
      headDigest: input.previous.headDigest,
      frontier,
      frontierDigest: this.frontierDigest(input.ref),
      actorHeads,
      fullUpdate: Uint8Array.from(input.exactBytes),
      stateVector: Uint8Array.of(Number(input.ref.actorSequence)) as StateVector,
      canonicalStateDigest: digestBytes(input.exactBytes),
    }
  }

  actorHeadsDigest(actorHeads: ReplicaActorHeadSet): Digest {
    return digest(canonical(actorHeads))
  }

  createCheckpoint(accepted: NodeAcceptedReplicaHead) {
    const bytes = encoder.encode(`checkpoint-install:${accepted.canonicalStateDigest}:${this.checkpoints.size}`)
    const objectDigest = digestBytes(bytes)
    const value = {
      scope: accepted.scope,
      frontier: accepted.frontier,
      frontierDigest: accepted.frontierDigest,
      actorHeads: accepted.actorHeads,
      fullUpdate: Uint8Array.from(accepted.fullUpdate),
      stateVector: Uint8Array.from(accepted.stateVector) as StateVector,
      canonicalStateDigest: accepted.canonicalStateDigest,
    }
    this.checkpoints.set(objectDigest, { bytes, accepted: value })
    return { objectDigest, exactBytes: bytes, accepted: value }
  }

  async materializeCheckpoint(input: { scope: DocumentScope; checkpointObjectDigest: Digest; exactCheckpointBytes: Readonly<Uint8Array> }) {
    const value = this.checkpoints.get(input.checkpointObjectDigest)
    if (!value || !Buffer.from(value.bytes).equals(Buffer.from(input.exactCheckpointBytes))) throw new Error("unknown fake checkpoint")
    return value.accepted
  }

  frontierDigest(ref: FrameObjectRef): Digest {
    return digest(JSON.stringify({
      format: "convax.causal-frontier",
      heads: [{
        format: "convax.causal-head-ref",
        actorId: ref.actorId,
        actorSequence: ref.actorSequence,
        frameDigest: ref.frameDigest,
        lamport: ref.actorSequence,
      }],
    }))
  }
}

async function createFixture(
  hooks: NodeCollaborationPersistenceFaultHooks = {},
  replicaDurableAckVerifier?: { verifyCurrent(input: unknown): Promise<boolean> },
  checkpointInstallationVerifier?: { verifyCurrent(input: unknown): Promise<boolean> },
  checkpointPruneAuthority?: { verifyCurrent(input: unknown): Promise<unknown> },
  checkpointPruneRootScanner?: { scanComplete(input: unknown): Promise<unknown> },
  durabilityDiagnostics?: NodeLocalCommitDurabilityDiagnostics,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-r5-persistence-"))
  roots.push(root)
  const collaborationDirectory = path.join(root, ".convax", "collaboration")
  const frames = new FakeFrameMaterializer()
  const store = await NodeCollaborationPersistence.open({
    collaborationDirectory,
    localActorId: localActor,
    materializer: frames,
    replicaDurableAckVerifier: replicaDurableAckVerifier as never,
    checkpointInstallationVerifier: checkpointInstallationVerifier as never,
    checkpointPruneAuthority: checkpointPruneAuthority as never,
    checkpointPruneRootScanner: checkpointPruneRootScanner as never,
    hooks,
    durabilityDiagnostics,
  })
  return { collaborationDirectory, frames, store }
}

function durableAck(ref: FrameObjectRef) {
  return Object.freeze({
    scope: ref.scope,
    frameDigest: ref.frameDigest,
    receiverMemberId: id128(7) as MemberId,
    receiverReplicaId: "replica_00000007" as ReplicaId,
    receiverActorId: actorId(7),
    receiverAuthorizationDigest: digest("receiver-authorization"),
    ackCoreDigest: digest(`ack:${ref.frameDigest}`),
    exactAckBytes: encoder.encode(`ack-bytes:${ref.frameDigest}`),
  })
}

async function initialize(store: NodeCollaborationPersistence, scope: DocumentScope) {
  const checkpoint = encoder.encode(`checkpoint:${scope.docKind}:${scope.docId}`)
  const frontier = { format: "convax.causal-frontier", heads: [] } as CausalFrontier
  const actorHeads = { format: "convax.replica-actor-head-set", scope, heads: [] } as ReplicaActorHeadSet
  return store.initializeShard({
    scope,
    checkpointObjectDigest: digestBytes(checkpoint),
    checkpointExactBytes: checkpoint,
    acceptedBase: {
      scope,
      frontier,
      frontierDigest: digest(JSON.stringify(frontier)),
      actorHeads,
      fullUpdate: new Uint8Array(),
      stateVector: Uint8Array.of(0) as StateVector,
      canonicalStateDigest: digest("empty"),
    },
  })
}

function genesisProofInput(scope: DocumentScope, proof: string) {
  const checkpoint = encoder.encode(`checkpoint:${scope.docKind}:${scope.docId}`)
  const frontier = { format: "convax.causal-frontier", heads: [] } as CausalFrontier
  const actorHeads = { format: "convax.replica-actor-head-set", scope, heads: [] } as ReplicaActorHeadSet
  return {
    scope,
    checkpointObjectDigest: digestBytes(checkpoint),
    checkpointExactBytes: checkpoint,
    proofCarrierExactBytes: encoder.encode(proof),
    acceptedBase: {
      scope,
      frontier,
      frontierDigest: digest(JSON.stringify(frontier)),
      actorHeads,
      fullUpdate: new Uint8Array(),
      stateVector: Uint8Array.of(0) as StateVector,
      canonicalStateDigest: digest("empty"),
    },
  }
}

function projectIndexScope(): DocumentScope {
  return {
    projectId: "project-a",
    projectEpoch,
    docKind: "project-index",
    docId: "project-index",
    shardEpoch,
  } as DocumentScope
}

function canvasScope(): DocumentScope {
  return {
    projectId: "project-a",
    projectEpoch,
    docKind: "canvas",
    docId: `cv_${"c".repeat(64)}`,
    shardEpoch: id128(3),
  } as DocumentScope
}

function id128(byte: number): Id128 {
  return Buffer.alloc(16, byte).toString("base64url") as Id128
}

function actorId(byte: number): ActorId {
  return Buffer.alloc(32, byte).toString("base64url") as ActorId
}

function digest(value: string): Digest {
  return digestBytes(encoder.encode(value))
}

function digestBytes(value: Readonly<Uint8Array>): Digest {
  return createHash("sha256").update(value).digest("hex") as Digest
}

function decodedFrame(frame: { readonly ref: FrameObjectRef; readonly bytes: Uint8Array }): DecodedCausalEditFrame {
  return {
    bytes: frame.bytes,
    frameDigest: frame.ref.frameDigest,
    header: { core: {
      scope: frame.ref.scope,
      actorId: frame.ref.actorId,
      actorSequence: frame.ref.actorSequence,
      operationId: frame.ref.operationId,
    } },
  } as unknown as DecodedCausalEditFrame
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`
}
