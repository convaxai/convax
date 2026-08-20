import { describe, expect, test } from "bun:test"
import { CURRENT_PROTOCOL_IDENTITIES, currentProtocolDescriptor } from "@convax/collaboration"
import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES,
  CONTROL_PROTOCOL_LIMITS,
  PEER_CHANNEL_CONTRACT,
  PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION,
  controlProtocolLimit,
} from "../collaboration-protocol"
import type { ControlProtocolLimitName } from "../collaboration-protocol"

const frozenLimitFixtures: readonly (readonly [ControlProtocolLimitName, string])[] = [
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
    expect(Object.keys(CONTROL_PROTOCOL_LIMITS).length - 1).toBe(72)
    expect(PEER_CHANNEL_CONTRACT).toEqual({
      format: "convax.peer-channel-contract",
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
    expect(new Set(PEER_CHANNEL_CONTRACT.policies.map((policy) => policy.channel)).size).toBe(4)
  })

  test("projects every exact and plus-one limit mechanically", () => {
    expect(frozenLimitFixtures).toHaveLength(72)
    expect(Object.fromEntries(frozenLimitFixtures)).toEqual(
      Object.fromEntries(Object.entries(CONTROL_PROTOCOL_LIMITS).filter(([name]) => name !== "format")),
    )
    for (const [name, encoded] of frozenLimitFixtures) {
      const exact = controlProtocolLimit(name)
      expect(exact.toString()).toBe(encoded)
      expect(exact + 1n).toBe(BigInt(encoded) + 1n)
    }
  })

  test("tracks the one code-owned current protocol identity and domain registry", () => {
    expect(CONTROL_PROTOCOL_EXPECTED_IDENTITIES).toEqual({
      protocolDigest: CURRENT_PROTOCOL_IDENTITIES.protocolDigest,
      limitsDigest: CURRENT_PROTOCOL_IDENTITIES.limitsDigest,
      channelContractDigest: CURRENT_PROTOCOL_IDENTITIES.channelContractDigest,
    })
    const currentProtocol = currentProtocolDescriptor()
    expect(PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION).toEqual({
      status: "current-contract-selected",
      requiredProtocolDigest: currentProtocol.protocolDigest,
      requiredDomainCount: currentProtocol.digestDomains.length,
      fallbackDecoder: false,
      compatibilityPrimitiveAliases: false,
    })
  })
})
