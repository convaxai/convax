import { describe, expect, test } from "bun:test"
import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2,
  CONTROL_PROTOCOL_LIMITS_V2,
  PEER_CHANNEL_CONTRACT_V2,
  PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2,
  controlProtocolLimitV2,
} from "../collaboration-protocol"
import type { ControlProtocolLimitNameV2 } from "../collaboration-protocol"

const frozenLimitFixtures: readonly (readonly [ControlProtocolLimitNameV2, string])[] = [
  ["serviceTrustKeys", "32"],
  ["activeProjectMembers", "256"],
  ["retainedRevokedMembersPerProjectEpoch", "4096"],
  ["membershipSnapshotMembers", "4352"],
  ["activeReplicasPerMember", "8"],
  ["activeReplicasPerProject", "512"],
  ["activeEditorReplicasPerProject", "256"],
  ["retainedRevokedReplicasPerProjectEpoch", "4096"],
  ["membershipSnapshotReplicas", "4608"],
  ["replicaIdAllocationsPerProjectEpoch", "16384"],
  ["replicaIdAllocationsPerMemberPerProjectEpoch", "64"],
  ["pendingReplicaIdReservationsPerMember", "4"],
  ["pendingReplicaIdReservationsPerProject", "512"],
  ["replicaIdReservationTtlMs", "60000"],
  ["activeSessionsPerReplica", "1"],
  ["pendingSessionChallengesPerReplica", "4"],
  ["pendingMutationChallengesPerMember", "4"],
  ["pendingProjectResetChallengesPerProject", "2"],
  ["pendingDocumentShardResetApprovalsPerProject", "64"],
  ["closedProjectSessionCredentialDigests", "512"],
  ["sessionCredentialTtlMs", "900000"],
  ["challengeTtlMs", "60000"],
  ["freshnessTicketTtlMs", "60000"],
  ["activePeerDirectoryEntries", "512"],
  ["closedSessionCredentialDigests", "8"],
  ["normalServiceRequestJcsBytes", "65536"],
  ["membershipSnapshotBytes", "2097152"],
  ["registrationClaimBytes", "65536"],
  ["outstandingRegistryCandidatesPerReplica", "4"],
  ["retainedRegistryEntriesPerMember", "1024"],
  ["retainedRegistryEntriesPerProject", "4096"],
  ["retainedRegistryClaimPayloadBytesPerProject", "67108864"],
  ["cutoffLeafBytes", "1024"],
  ["cutoffPageBytes", "524288"],
  ["cutoffRootBytes", "65536"],
  ["cutoffPages", "8"],
  ["cutoffLeaves", "4096"],
  ["cutoffAggregatePageBytes", "4194304"],
  ["projectFloorPages", "8"],
  ["projectFloorEntries", "4096"],
  ["projectFloorAggregatePageBytes", "4194304"],
  ["peerInventoryPages", "128"],
  ["peerInventoryDocumentsPerPage", "32"],
  ["peerInventoryDocuments", "4096"],
  ["pendingPeerInventoriesPerPeer", "2"],
  ["blobHaveQueryEntries", "256"],
  ["resetControlObjectBytes", "65536"],
  ["checkpointSnapshotBytes", "33554432"],
  ["checkpointParents", "8"],
  ["stableSetCertificates", "8"],
  ["checkpointFrontierHeads", "256"],
  ["proposalAndParentSnapshotBytes", "268435456"],
  ["validationSuffixFrames", "4096"],
  ["validationSuffixBytes", "67108864"],
  ["encodedAttesterCarrierBytes", "335544320"],
  ["encodedAttesterCarrierSections", "4224"],
  ["canvasGenesisProofCarrierBytes", "335544320"],
  ["documentShardResetAuthorizationCarrierBytes", "402653184"],
  ["validationArtifactsPerCarrier", "64"],
  ["pendingRemoteIngressObjectsPerProjectEpoch", "8192"],
  ["pendingRemoteIngressBytesPerProjectEpoch", "536870912"],
  ["pendingRemoteIngressObjectsPerSourceMember", "512"],
  ["pendingRemoteIngressBytesPerSourceMember", "134217728"],
  ["pendingRemoteInboxFramesPerDocument", "4096"],
  ["pendingRemoteInboxBytesPerDocument", "268435456"],
  ["pendingRemoteInboxFramesPerActor", "512"],
  ["pendingRemoteInboxBytesPerActor", "33554432"],
  ["localReplicationOutboxFramesPerDocument", "4096"],
  ["localReplicationOutboxBytesPerDocument", "536870912"],
  ["retainedDurableAcksPerFrame", "32"],
  ["quarantineObjectsPerProject", "1024"],
  ["quarantineBytesPerProject", "134217728"],
]

describe("frozen control-plane descriptor", () => {
  test("contains exactly 72 named limits and four canonical channels", () => {
    expect(Object.keys(CONTROL_PROTOCOL_LIMITS_V2).length - 1).toBe(72)
    expect(PEER_CHANNEL_CONTRACT_V2).toEqual({
      format: "convax.peer-channel-contract/2",
      policies: [
        {
          channel: "control",
          reliability: "reliable-ordered",
          maxBodyBytes: "65536",
          maxRawChunkBytes: null,
          maxInflightPerPeer: null,
          queuePriority: "highest",
        },
        {
          channel: "update",
          reliability: "reliable-ordered",
          maxBodyBytes: "266240",
          maxRawChunkBytes: "262144",
          maxInflightPerPeer: "4",
          queuePriority: "normal",
        },
        {
          channel: "blob",
          reliability: "reliable-ordered",
          maxBodyBytes: "1052672",
          maxRawChunkBytes: "1048576",
          maxInflightPerPeer: "4",
          queuePriority: "background",
        },
        {
          channel: "awareness",
          reliability: "unordered-unreliable-or-coalesced",
          maxBodyBytes: "16384",
          maxRawChunkBytes: null,
          maxInflightPerPeer: null,
          queuePriority: "ephemeral",
        },
      ],
      awarenessTtlMs: "30000",
      malformedStrikeCloseThreshold: "3",
    })
    expect(new Set(PEER_CHANNEL_CONTRACT_V2.policies.map((policy) => policy.channel)).size).toBe(4)
  })

  test("projects every exact and plus-one limit mechanically", () => {
    expect(frozenLimitFixtures).toHaveLength(72)
    expect(Object.fromEntries(frozenLimitFixtures)).toEqual(
      Object.fromEntries(Object.entries(CONTROL_PROTOCOL_LIMITS_V2).filter(([name]) => name !== "format")),
    )
    for (const [name, encoded] of frozenLimitFixtures) {
      const exact = controlProtocolLimitV2(name)
      expect(exact.toString()).toBe(encoded)
      expect(exact + 1n).toBe(BigInt(encoded) + 1n)
    }
  })

  test("pins the reviewed identities without reconstructing the kernel bundle", () => {
    expect(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2).toEqual({
      protocolDigest: "de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5",
      limitsDigest: "88c018e5289f8b9a359f6ae171aed00885d5fa0913f4a1c36274b35e4cee12f7",
      channelContractDigest: "0fa34e8d93f26e585e6d9baa0ecf0c09a38494d03247b91843e2bca0e93df242",
    })
    expect(PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2).toEqual({
      status: "r5-contract-selected",
      requiredProtocolDigest: "de192e03a7466b631b1cefa50f745e22b1ed997f5ce23cbb9c9aea7e46b73bf5",
      requiredDomainCount: 127,
      fallbackDecoder: false,
      compatibilityPrimitiveAliases: false,
    })
  })
})
