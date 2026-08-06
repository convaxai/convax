import { describe, expect, test } from "bun:test"
import {
  assertExactPruningCoverage,
  checkpointContentCertificateCoreDigest,
  parseReplicaCausalFloorAckCore,
  parseReplicaCheckpointCore,
  replicaCheckpointCoreDigest,
  replicaCheckpointObjectDigest,
  prunableCheckpointSetCertificateCoreDigest,
  replicaCausalFloorAckCoreDigest,
  stableCheckpointSetCoreDigest,
} from "./checkpoint"
import {
  encodeBase64url,
  parseActorId,
  parseCanvasId,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseReplicaId,
  parseSignature,
} from "./codecs"
import { CURRENT_PROTOCOL_IDENTITIES } from "./constants"
import type {
  CheckpointContentCertificate,
  PrunableCheckpointSetCertificate,
  ReplicaCausalFloorAck,
  StableCheckpointSetCore,
} from "./contracts"
import { ordinarySha256 } from "./digest"
import { TransientSessionUndoCoordinator } from "./undo"

const encoder = new TextEncoder()
const id = (byte: number) => parseId128(encodeBase64url(Uint8Array.from({ length: 16 }, () => byte)))
const digest = (label: string) => ordinarySha256(encoder.encode(label))
const signature = parseSignature(encodeBase64url(Uint8Array.from({ length: 64 }, (_, index) => index < 32 ? 4 : index === 32 ? 1 : 0)))
const scope = Object.freeze({ projectId: parseProjectId("project"), projectEpoch: id(1), docKind: "canvas" as const, docId: parseCanvasId(`cv_${"3".repeat(64)}`), shardEpoch: id(2) })
const replica = parseReplicaId("replica_0000002a")
const actor = parseActorId(encodeBase64url(Uint8Array.from({ length: 32 }, () => 3)))
const protocolDigest = parseDigest(CURRENT_PROTOCOL_IDENTITIES.protocolDigest)

describe("checkpoint and causal-floor primitives", () => {
  test("enforces the exact eight-parent and 32 MiB snapshot boundaries", () => {
    const parents = Array.from({ length: 9 }, (_, index) => digest(`parent-${index}`)).sort()
    const base = {
      format: "convax.replica-checkpoint-core", scope, checkpointId: id(4), authorMemberId: parseMemberId(id(5)),
      authorReplicaId: replica, authorActorId: actor, authorAuthorizationDigest: digest("credential"),
      directParentCheckpointDigests: parents.slice(0, 8), baseFrontierDigest: digest("base-frontier"),
      computedFrontierDigest: digest("computed-frontier"), actorHeadBoundaryDigest: digest("actor-boundary"),
      stateVectorDigest: digest("vector"), canonicalStateDigest: digest("canonical"), fullUpdateDigest: digest("full"),
      fullUpdateByteLength: String(32 * 1024 * 1024), protocolDigest, schemaDigest: digest("schema"),
      canonicalizerDigest: digest("canonicalizer"), validationArtifactSetDigest: digest("artifacts"),
    }
    expect(parseReplicaCheckpointCore(base).directParentCheckpointDigests).toHaveLength(8)
    expect(() => parseReplicaCheckpointCore({ ...base, directParentCheckpointDigests: parents })).toThrow()
    expect(() => parseReplicaCheckpointCore({ ...base, fullUpdateByteLength: String(32 * 1024 * 1024 + 1) })).toThrow()

    const core = parseReplicaCheckpointCore(base)
    const checkpoint = {
      format: "convax.replica-checkpoint" as const,
      core,
      coreDigest: replicaCheckpointCoreDigest(core),
      replicaSignature: signature,
    }
    const changedSignature = parseSignature(encodeBase64url(Uint8Array.from({ length: 64 }, (_, index) => index < 32 ? 5 : index === 32 ? 1 : 0)))
    expect(replicaCheckpointObjectDigest(checkpoint)).not.toBe(
      replicaCheckpointObjectDigest({ ...checkpoint, replicaSignature: changedSignature }),
    )
  })

  test("requires both exact content certificates and exact active-editor floor ACK coverage", () => {
    const contentCore = {
      format: "convax.checkpoint-content-certificate-core" as const, scope, checkpointDigest: digest("checkpoint"),
      parentCertificateDigests: [], computedFrontierDigest: digest("frontier"), actorHeadBoundaryDigest: digest("boundary"),
      stateVectorDigest: digest("vector"), canonicalStateDigest: digest("state"), fullUpdateDigest: digest("update"),
      protocolDigest, schemaDigest: digest("schema"), canonicalizerDigest: digest("canonicalizer"), validationArtifactSetDigest: digest("artifacts"),
      trustBundleDigest: digest("trust"), contentStatus: "service-validated-causal-closure" as const,
      serviceKeyPurpose: "content-attestation" as const, serviceKeyId: "content-key",
    }
    const content: CheckpointContentCertificate = {
      format: "convax.checkpoint-content-certificate", core: contentCore,
      coreDigest: checkpointContentCertificateCoreDigest(contentCore), serviceSignature: signature,
    }
    const contentObjectDigest = digest("content-certificate-object")
    const stable: StableCheckpointSetCore = {
      format: "convax.stable-checkpoint-set-core", scope, priorSetDigest: null, contentCertificateDigests: [contentObjectDigest],
      mergedFrontierDigest: content.core.computedFrontierDigest, actorHeadBoundaryDigest: content.core.actorHeadBoundaryDigest,
      membershipSnapshotDigest: digest("membership"), protocolDigest, validationArtifactSetDigest: content.core.validationArtifactSetDigest,
    }
    const ackCore = parseReplicaCausalFloorAckCore({
      format: "convax.replica-causal-floor-ack-core", stableSetCoreDigest: stableCheckpointSetCoreDigest(stable),
      replicaId: replica, actorId: actor, replicaActorCredentialDigest: digest("credential"), actorHeadAtAck: null,
      durableCheckpoint: true, validatedExactClosure: true, installedMonotonicFloor: true,
    })
    const ack: ReplicaCausalFloorAck = { format: "convax.replica-causal-floor-ack", core: ackCore, coreDigest: replicaCausalFloorAckCoreDigest(ackCore), replicaSignature: signature }
    const ackObjectDigest = digest("floor-ack-object")
    const certificateCore = {
      format: "convax.prunable-checkpoint-set-certificate-core" as const, stableSetCore: stable, floorAckDigests: [ackObjectDigest],
      contentStatus: "service-validated-and-all-editors-acknowledged" as const, trustBundleDigest: digest("trust"),
      serviceKeyPurpose: "checkpoint-stability" as const, serviceKeyId: "stability-key",
    }
    const certificate: PrunableCheckpointSetCertificate = {
      format: "convax.prunable-checkpoint-set-certificate", core: certificateCore,
      coreDigest: prunableCheckpointSetCertificateCoreDigest(certificateCore), serviceSignature: signature,
    }
    const contentRef = { certificateDigest: contentObjectDigest, certificate: content }
    const ackRef = { ackDigest: ackObjectDigest, ack }
    expect(() => assertExactPruningCoverage({ certificate, contentCertificates: [contentRef], floorAcks: [ackRef], activeEditorReplicaIds: [replica] })).not.toThrow()
    expect(() => assertExactPruningCoverage({ certificate, contentCertificates: [], floorAcks: [ackRef], activeEditorReplicaIds: [replica] })).toThrow("service-certified")
    expect(() => assertExactPruningCoverage({ certificate, contentCertificates: [contentRef], floorAcks: [ackRef], activeEditorReplicaIds: [] })).toThrow("active-editor")
    const floorDigests = Array.from({ length: 257 }, (_, index) => digest(`floor-${index}`)).sort()
    expect(() => prunableCheckpointSetCertificateCoreDigest({ ...certificateCore, floorAckDigests: floorDigests.slice(0, 256) })).not.toThrow()
    expect(() => prunableCheckpointSetCertificateCoreDigest({ ...certificateCore, floorAckDigests: floorDigests })).toThrow()
  })
})

describe("SessionUndoCoordinator", () => {
  test("moves only after durable inverse/forward commits and clears on rebuild", () => {
    let next = 10
    const undo = new TransientSessionUndoCoordinator({ createCursorToken: () => id(next++) })
    const root = id(6)
    undo.recordDurableRoot(root)
    const undoCursor = undo.peekUndo()!
    expect(undo.peekUndo()).toEqual(undoCursor)
    undo.commitUndo(undoCursor.cursorToken, id(7))
    expect(undo.peekUndo()).toBeNull()
    const redoCursor = undo.peekRedo()!
    undo.commitRedo(redoCursor.cursorToken, id(8))
    expect(undo.getSnapshot().undo).toEqual([root])
    undo.clear("rebuild")
    expect(undo.getSnapshot()).toEqual({ undo: [], redo: [], pending: null })
  })
})
