import { describe, expect, test } from "bun:test"
import {
  assertExactPruningCoverageV2,
  checkpointContentCertificateCoreDigestV2,
  parseReplicaCausalFloorAckCoreV2,
  parseReplicaCheckpointCoreV2,
  replicaCheckpointCoreDigestV2,
  replicaCheckpointObjectDigestV2,
  prunableCheckpointSetCertificateCoreDigestV2,
  replicaCausalFloorAckCoreDigestV2,
  stableCheckpointSetCoreDigestV2,
} from "./checkpoint"
import {
  encodeBase64urlV2,
  parseActorIdV2,
  parseCanvasIdV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parseReplicaIdV2,
  parseSignatureV2,
} from "./codecs"
import { PINNED_AUTHORITY_IDENTITIES_V2 } from "./constants"
import type {
  CheckpointContentCertificateV2,
  PrunableCheckpointSetCertificateV2,
  ReplicaCausalFloorAckV2,
  StableCheckpointSetCoreV2,
} from "./contracts"
import { ordinarySha256V2 } from "./digest"
import { TransientSessionUndoCoordinatorV2 } from "./undo"

const encoder = new TextEncoder()
const id = (byte: number) => parseId128V2(encodeBase64urlV2(Uint8Array.from({ length: 16 }, () => byte)))
const digest = (label: string) => ordinarySha256V2(encoder.encode(label))
const signature = parseSignatureV2(encodeBase64urlV2(Uint8Array.from({ length: 64 }, (_, index) => index < 32 ? 4 : index === 32 ? 1 : 0)))
const scope = Object.freeze({ projectId: parseProjectIdV2("project"), projectEpoch: id(1), docKind: "canvas" as const, docId: parseCanvasIdV2(`cv_${"3".repeat(64)}`), shardEpoch: id(2) })
const replica = parseReplicaIdV2("replica_0000002a")
const actor = parseActorIdV2(encodeBase64urlV2(Uint8Array.from({ length: 32 }, () => 3)))
const protocolDigest = parseDigestV2(PINNED_AUTHORITY_IDENTITIES_V2.protocolDigest)

describe("checkpoint and causal-floor primitives", () => {
  test("enforces the exact eight-parent and 32 MiB snapshot boundaries", () => {
    const parents = Array.from({ length: 9 }, (_, index) => digest(`parent-${index}`)).sort()
    const base = {
      format: "convax.replica-checkpoint-core/2", scope, checkpointId: id(4), authorMemberId: parseMemberIdV2(id(5)),
      authorReplicaId: replica, authorActorId: actor, authorAuthorizationDigest: digest("credential"),
      directParentCheckpointDigests: parents.slice(0, 8), baseFrontierDigest: digest("base-frontier"),
      computedFrontierDigest: digest("computed-frontier"), actorHeadBoundaryDigest: digest("actor-boundary"),
      stateVectorDigest: digest("vector"), canonicalStateDigest: digest("canonical"), fullUpdateDigest: digest("full"),
      fullUpdateByteLength: String(32 * 1024 * 1024), protocolDigest, schemaDigest: digest("schema"),
      canonicalizerDigest: digest("canonicalizer"), validationArtifactSetDigest: digest("artifacts"),
    }
    expect(parseReplicaCheckpointCoreV2(base).directParentCheckpointDigests).toHaveLength(8)
    expect(() => parseReplicaCheckpointCoreV2({ ...base, directParentCheckpointDigests: parents })).toThrow()
    expect(() => parseReplicaCheckpointCoreV2({ ...base, fullUpdateByteLength: String(32 * 1024 * 1024 + 1) })).toThrow()

    const core = parseReplicaCheckpointCoreV2(base)
    const checkpoint = {
      format: "convax.replica-checkpoint/2" as const,
      core,
      coreDigest: replicaCheckpointCoreDigestV2(core),
      replicaSignature: signature,
    }
    const changedSignature = parseSignatureV2(encodeBase64urlV2(Uint8Array.from({ length: 64 }, (_, index) => index < 32 ? 5 : index === 32 ? 1 : 0)))
    expect(replicaCheckpointObjectDigestV2(checkpoint)).not.toBe(
      replicaCheckpointObjectDigestV2({ ...checkpoint, replicaSignature: changedSignature }),
    )
  })

  test("requires both exact content certificates and exact active-editor floor ACK coverage", () => {
    const contentCore = {
      format: "convax.checkpoint-content-certificate-core/2" as const, scope, checkpointDigest: digest("checkpoint"),
      parentCertificateDigests: [], computedFrontierDigest: digest("frontier"), actorHeadBoundaryDigest: digest("boundary"),
      stateVectorDigest: digest("vector"), canonicalStateDigest: digest("state"), fullUpdateDigest: digest("update"),
      protocolDigest, schemaDigest: digest("schema"), canonicalizerDigest: digest("canonicalizer"), validationArtifactSetDigest: digest("artifacts"),
      trustBundleDigest: digest("trust"), contentStatus: "service-validated-causal-closure" as const,
      serviceKeyPurpose: "content-attestation" as const, serviceKeyId: "content-key",
    }
    const content: CheckpointContentCertificateV2 = {
      format: "convax.checkpoint-content-certificate/2", core: contentCore,
      coreDigest: checkpointContentCertificateCoreDigestV2(contentCore), serviceSignature: signature,
    }
    const contentObjectDigest = digest("content-certificate-object")
    const stable: StableCheckpointSetCoreV2 = {
      format: "convax.stable-checkpoint-set-core/2", scope, priorSetDigest: null, contentCertificateDigests: [contentObjectDigest],
      mergedFrontierDigest: content.core.computedFrontierDigest, actorHeadBoundaryDigest: content.core.actorHeadBoundaryDigest,
      membershipSnapshotDigest: digest("membership"), protocolDigest, validationArtifactSetDigest: content.core.validationArtifactSetDigest,
    }
    const ackCore = parseReplicaCausalFloorAckCoreV2({
      format: "convax.replica-causal-floor-ack-core/2", stableSetCoreDigest: stableCheckpointSetCoreDigestV2(stable),
      replicaId: replica, actorId: actor, replicaActorCredentialDigest: digest("credential"), actorHeadAtAck: null,
      durableCheckpoint: true, validatedExactClosure: true, installedMonotonicFloor: true,
    })
    const ack: ReplicaCausalFloorAckV2 = { format: "convax.replica-causal-floor-ack/2", core: ackCore, coreDigest: replicaCausalFloorAckCoreDigestV2(ackCore), replicaSignature: signature }
    const ackObjectDigest = digest("floor-ack-object")
    const certificateCore = {
      format: "convax.prunable-checkpoint-set-certificate-core/2" as const, stableSetCore: stable, floorAckDigests: [ackObjectDigest],
      contentStatus: "service-validated-and-all-editors-acknowledged" as const, trustBundleDigest: digest("trust"),
      serviceKeyPurpose: "checkpoint-stability" as const, serviceKeyId: "stability-key",
    }
    const certificate: PrunableCheckpointSetCertificateV2 = {
      format: "convax.prunable-checkpoint-set-certificate/2", core: certificateCore,
      coreDigest: prunableCheckpointSetCertificateCoreDigestV2(certificateCore), serviceSignature: signature,
    }
    const contentRef = { certificateDigest: contentObjectDigest, certificate: content }
    const ackRef = { ackDigest: ackObjectDigest, ack }
    expect(() => assertExactPruningCoverageV2({ certificate, contentCertificates: [contentRef], floorAcks: [ackRef], activeEditorReplicaIds: [replica] })).not.toThrow()
    expect(() => assertExactPruningCoverageV2({ certificate, contentCertificates: [], floorAcks: [ackRef], activeEditorReplicaIds: [replica] })).toThrow("service-certified")
    expect(() => assertExactPruningCoverageV2({ certificate, contentCertificates: [contentRef], floorAcks: [ackRef], activeEditorReplicaIds: [] })).toThrow("active-editor")
    const floorDigests = Array.from({ length: 257 }, (_, index) => digest(`floor-${index}`)).sort()
    expect(() => prunableCheckpointSetCertificateCoreDigestV2({ ...certificateCore, floorAckDigests: floorDigests.slice(0, 256) })).not.toThrow()
    expect(() => prunableCheckpointSetCertificateCoreDigestV2({ ...certificateCore, floorAckDigests: floorDigests })).toThrow()
  })
})

describe("SessionUndoCoordinatorV2", () => {
  test("moves only after durable inverse/forward commits and clears on rebuild", () => {
    let next = 10
    const undo = new TransientSessionUndoCoordinatorV2({ createCursorToken: () => id(next++) })
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
