import { describe, expect, test } from "bun:test"
import {
  encodeBase64urlV2,
  ordinarySha256V2,
  parseActorIdV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parseReplicaIdV2,
  parseSignatureV2,
} from "@convax/collaboration"
import {
  blobDurableAckCoreFromReferenceV2,
  createBlobDurableAckV2,
  evaluateProjectBlobReplicationStatusV2,
  planProjectBlobBootstrapV2,
} from "./blob-replication"
import type { ProjectResourceReferenceV2 } from "./project-index"

const bytes = new TextEncoder().encode("blob")
const blob = ordinarySha256V2(bytes)
const id = (fill: number) => parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(fill)))
const actor = (fill: number) => parseActorIdV2(encodeBase64urlV2(new Uint8Array(32).fill(fill)))
const signature = parseSignatureV2(encodeBase64urlV2(new Uint8Array(64).fill(7)))
const reference: ProjectResourceReferenceV2 = Object.freeze({
  format: "convax.project-resource-reference/2",
  projectId: parseProjectIdV2("project-a"),
  projectEpoch: id(1),
  entryFileId: `pf_${"a".repeat(64)}` as never,
  familyPrimaryFileId: `pf_${"a".repeat(64)}` as never,
  versionId: `pv_${"b".repeat(64)}`,
  canonicalUri: `convax-project://project-a/epochs/${id(1)}/entries/pf_${"a".repeat(64)}?blob=sha256%3A${blob}`,
  blob: { format: "convax.blob-ref/2" as const, algorithm: "sha256" as const, digest: blob, byteLength: String(bytes.byteLength) as never, mime: "application/octet-stream" },
  versionRecordDigest: ordinarySha256V2(new TextEncoder().encode("version")),
})
const receiver = {
  receiverMemberId: parseMemberIdV2(id(2)),
  receiverReplicaId: parseReplicaIdV2("replica_00000002"),
  receiverActorId: actor(2),
  receiverAuthorizationDigest: ordinarySha256V2(new TextEncoder().encode("authorization")),
}

describe("Project blob holder and durable ACK semantics", () => {
  test("plans only missing current refs against current verified holders", () => {
    const plan = planProjectBlobBootstrapV2({
      currentReferences: [reference],
      localHave: [],
      holders: [{
        memberId: receiver.receiverMemberId,
        replicaId: receiver.receiverReplicaId,
        actorId: receiver.receiverActorId,
        authorizationDigest: receiver.receiverAuthorizationDigest,
        currentAuthorization: true,
        have: [{ blobSha256: blob, byteLength: reference.blob.byteLength }],
      }],
    })
    expect(plan.requests).toHaveLength(1)
    expect(plan.unavailable).toEqual([])
    expect(planProjectBlobBootstrapV2({ currentReferences: [reference], localHave: [{ blobSha256: blob, byteLength: reference.blob.byteLength }], holders: [] }).requests).toEqual([])
  })

  test("does not call an early blob ACK replicated without a same-replica frame ACK", () => {
    const core = blobDurableAckCoreFromReferenceV2({ reference, ...receiver, protocolDigest: ordinarySha256V2(new TextEncoder().encode("protocol")) })
    const ack = createBlobDurableAckV2(core, signature)
    expect(evaluateProjectBlobReplicationStatusV2({ references: [reference], frameAckReceivers: [], blobAcks: [ack], verifyCurrentAck: () => true })).toBe("local-structural-only")
    expect(evaluateProjectBlobReplicationStatusV2({
      references: [reference],
      frameAckReceivers: [{ receiverReplicaId: receiver.receiverReplicaId, receiverAuthorizationDigest: receiver.receiverAuthorizationDigest }],
      blobAcks: [ack],
      verifyCurrentAck: () => true,
    })).toBe("blob-replicated")
    expect(evaluateProjectBlobReplicationStatusV2({
      references: [reference],
      frameAckReceivers: [{ receiverReplicaId: parseReplicaIdV2("replica_00000003"), receiverAuthorizationDigest: receiver.receiverAuthorizationDigest }],
      blobAcks: [ack],
      verifyCurrentAck: () => true,
    })).toBe("structure-replicated-blobs-pending")
  })
})
