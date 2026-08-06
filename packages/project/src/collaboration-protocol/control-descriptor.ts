/**
 * Exact control-plane-owned constants from the current control artifact.
 *
 * The 127-domain registry, ProtocolSchemaBundle and digest implementation remain
 * kernel-owned and are deliberately not reconstructed in this package. The kernel
 * integration gate will compare these constants with its exact limits/channel
 * digests once the public v2 kernel export is available.
 */
export const CONTROL_PROTOCOL_LIMITS = Object.freeze({
  format: "convax.protocol-limits",
  serviceTrustKeys: "32",
  activeProjectMembers: "256",
  retainedRevokedMembersPerProjectEpoch: "4096",
  membershipSnapshotMembers: "4352",
  activeReplicasPerMember: "8",
  activeReplicasPerProject: "512",
  activeEditorReplicasPerProject: "256",
  retainedRevokedReplicasPerProjectEpoch: "4096",
  membershipSnapshotReplicas: "4608",
  replicaIdAllocationsPerProjectEpoch: "16384",
  replicaIdAllocationsPerMemberPerProjectEpoch: "64",
  pendingReplicaIdReservationsPerMember: "4",
  pendingReplicaIdReservationsPerProject: "512",
  replicaIdReservationTtlMs: "60000",
  activeSessionsPerReplica: "1",
  pendingSessionChallengesPerReplica: "4",
  pendingMutationChallengesPerMember: "4",
  pendingProjectResetChallengesPerProject: "2",
  pendingDocumentShardResetApprovalsPerProject: "64",
  closedProjectSessionCredentialDigests: "512",
  sessionCredentialTtlMs: "900000",
  challengeTtlMs: "60000",
  freshnessTicketTtlMs: "60000",
  activePeerDirectoryEntries: "512",
  closedSessionCredentialDigests: "8",
  normalServiceRequestJcsBytes: "65536",
  membershipSnapshotBytes: "2097152",
  registrationClaimBytes: "65536",
  outstandingRegistryCandidatesPerReplica: "4",
  retainedRegistryEntriesPerMember: "1024",
  retainedRegistryEntriesPerProject: "4096",
  retainedRegistryClaimPayloadBytesPerProject: "67108864",
  cutoffLeafBytes: "1024",
  cutoffPageBytes: "524288",
  cutoffRootBytes: "65536",
  cutoffPages: "8",
  cutoffLeaves: "4096",
  cutoffAggregatePageBytes: "4194304",
  projectFloorPages: "8",
  projectFloorEntries: "4096",
  projectFloorAggregatePageBytes: "4194304",
  peerInventoryPages: "128",
  peerInventoryDocumentsPerPage: "32",
  peerInventoryDocuments: "4096",
  pendingPeerInventoriesPerPeer: "2",
  blobHaveQueryEntries: "256",
  resetControlObjectBytes: "65536",
  checkpointSnapshotBytes: "33554432",
  checkpointParents: "8",
  stableSetCertificates: "8",
  checkpointFrontierHeads: "256",
  proposalAndParentSnapshotBytes: "268435456",
  validationSuffixFrames: "4096",
  validationSuffixBytes: "67108864",
  encodedAttesterCarrierBytes: "335544320",
  encodedAttesterCarrierSections: "4224",
  canvasGenesisProofCarrierBytes: "335544320",
  documentShardResetAuthorizationCarrierBytes: "402653184",
  validationArtifactsPerCarrier: "64",
  pendingRemoteIngressObjectsPerProjectEpoch: "8192",
  pendingRemoteIngressBytesPerProjectEpoch: "536870912",
  pendingRemoteIngressObjectsPerSourceMember: "512",
  pendingRemoteIngressBytesPerSourceMember: "134217728",
  pendingRemoteInboxFramesPerDocument: "4096",
  pendingRemoteInboxBytesPerDocument: "268435456",
  pendingRemoteInboxFramesPerActor: "512",
  pendingRemoteInboxBytesPerActor: "33554432",
  localReplicationOutboxFramesPerDocument: "4096",
  localReplicationOutboxBytesPerDocument: "536870912",
  retainedDurableAcksPerFrame: "32",
  quarantineObjectsPerProject: "1024",
  quarantineBytesPerProject: "134217728",
} as const)

export type ControlProtocolLimitName = Exclude<keyof typeof CONTROL_PROTOCOL_LIMITS, "format">

export type PeerChannelName = "control" | "update" | "blob" | "awareness"

export const PEER_CHANNEL_CONTRACT = Object.freeze({
  format: "convax.peer-channel-contract",
  policies: Object.freeze([
    Object.freeze({
      channel: "control",
      reliability: "reliable-ordered",
      maxBodyBytes: "65536",
      maxRawChunkBytes: null,
      maxInflightPerPeer: null,
      queuePriority: "highest",
    }),
    Object.freeze({
      channel: "update",
      reliability: "reliable-ordered",
      maxBodyBytes: "266240",
      maxRawChunkBytes: "262144",
      maxInflightPerPeer: "4",
      queuePriority: "normal",
    }),
    Object.freeze({
      channel: "blob",
      reliability: "reliable-ordered",
      maxBodyBytes: "1052672",
      maxRawChunkBytes: "1048576",
      maxInflightPerPeer: "4",
      queuePriority: "background",
    }),
    Object.freeze({
      channel: "awareness",
      reliability: "unordered-unreliable-or-coalesced",
      maxBodyBytes: "16384",
      maxRawChunkBytes: null,
      maxInflightPerPeer: null,
      queuePriority: "ephemeral",
    }),
  ]),
  awarenessTtlMs: "30000",
  malformedStrikeCloseThreshold: "3",
} as const)

export const CONTROL_PROTOCOL_EXPECTED_IDENTITIES = Object.freeze({
  protocolDigest: "8295f918e8f7b8297c080db03672fc410542280f639d9b40a8e324e560f07ae9",
  limitsDigest: "88c018e5289f8b9a359f6ae171aed00885d5fa0913f4a1c36274b35e4cee12f7",
  channelContractDigest: "0fa34e8d93f26e585e6d9baa0ecf0c09a38494d03247b91843e2bca0e93df242",
} as const)

export function controlProtocolLimit(name: ControlProtocolLimitName): bigint {
  return BigInt(CONTROL_PROTOCOL_LIMITS[name])
}

export function assertControlDescriptorShape(): void {
  if (Object.keys(CONTROL_PROTOCOL_LIMITS).length !== 73) {
    throw new Error("control protocol limit descriptor must contain exactly 73 fields")
  }
  if (PEER_CHANNEL_CONTRACT.policies.length !== 4) {
    throw new Error("control protocol channel descriptor must contain exactly four channels")
  }
  const channels = PEER_CHANNEL_CONTRACT.policies.map((policy) => policy.channel)
  if (channels.join(",") !== "control,update,blob,awareness" || new Set(channels).size !== 4) {
    throw new Error("control protocol channel descriptor has a duplicate or noncanonical order")
  }
}

assertControlDescriptorShape()
