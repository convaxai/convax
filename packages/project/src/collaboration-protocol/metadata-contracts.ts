import type {
  ActorId,
  Digest,
  DocumentScope,
  Id128,
  MemberId,
  ProjectId,
  ReplicaId,
  Signature,
  Uint32,
  Uint64,
} from "@convax/collaboration"

export interface ReplicaProjectFloorEntryV2 {
  readonly scope: DocumentScope
  readonly basis: "project-index" | "project-index-live-route"
  readonly prunableCheckpointSetCertificateDigest: Digest
  readonly replicaCausalFloorAckDigest: Digest
}

export interface ReplicaProjectFloorPageCoreV2 {
  readonly format: "convax.replica-project-floor-page-core/2"
  readonly floorSetId: Id128
  readonly targetReplicaId: ReplicaId
  readonly pageIndex: Uint32
  readonly firstScopeKey: string
  readonly lastScopeKey: string
  readonly entries: readonly ReplicaProjectFloorEntryV2[]
}

export interface ReplicaProjectFloorPageV2 {
  readonly format: "convax.replica-project-floor-page/2"
  readonly core: ReplicaProjectFloorPageCoreV2
  readonly coreDigest: Digest
}

export interface ReplicaProjectFloorRootCoreV2 {
  readonly format: "convax.replica-project-floor-root-core/2"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly floorSetId: Id128
  readonly targetMemberId: MemberId
  readonly targetReplicaId: ReplicaId
  readonly targetActorId: ActorId
  readonly targetReplicaAuthorizationEpoch: Id128
  readonly membershipSnapshotDigest: Digest
  readonly projectIndexLiveScopeManifestDigest: Digest
  readonly registrySequence: Uint64
  readonly registryRootDigest: Digest
  readonly requiredScopeSetPolicy: "project-index-plus-certified-live-routes"
  readonly unlistedScopePolicy: "registry-only-is-advisory-and-never-blocks-or-grants"
  readonly pageDigests: readonly Digest[]
  readonly entryCount: Uint32
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "checkpoint-stability"
  readonly serviceKeyId: string
}

export interface ReplicaProjectFloorRootV2 {
  readonly format: "convax.replica-project-floor-root/2"
  readonly core: ReplicaProjectFloorRootCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface DocumentRegistrationClaimCoreV2 {
  readonly format: "convax.document-registration-claim-core/2"
  readonly scope: DocumentScope
  readonly registrarMemberId: MemberId
  readonly registrarReplicaId: ReplicaId
  readonly registrarActorId: ActorId
  readonly registrarAuthorizationDigest: Digest
  readonly claimRevision: Uint64
  readonly genesisCheckpointDigest: Digest
  readonly projectIndexRouteDependencyDigest: Digest
  readonly protocolDigest: Digest
}

export interface DocumentRegistrationClaimV2 {
  readonly format: "convax.document-registration-claim/2"
  readonly core: DocumentRegistrationClaimCoreV2
  readonly coreDigest: Digest
  readonly replicaSignature: Signature
}

export type DocumentRegistrationAbandonmentActorV2 =
  | Readonly<{ kind: "registrar"; replicaId: ReplicaId }>
  | Readonly<{ kind: "project-admin"; memberId: MemberId; adminCapabilityDigest: Digest }>

export interface DocumentRegistrationAbandonmentCoreV2 {
  readonly format: "convax.document-registration-abandonment-core/2"
  readonly registrationClaimDigest: Digest
  readonly scope: DocumentScope
  readonly claimRevision: Uint64
  readonly actor: DocumentRegistrationAbandonmentActorV2
  readonly reason: "cancelled" | "invalid-genesis" | "superseded-staging"
  readonly protocolDigest: Digest
}

export interface DocumentRegistrationAbandonmentV2 {
  readonly format: "convax.document-registration-abandonment/2"
  readonly core: DocumentRegistrationAbandonmentCoreV2
  readonly coreDigest: Digest
  readonly actorSignature: Signature
}

export interface CollaborationScopeEntryCoreV2 {
  readonly format: "convax.collaboration-scope-entry-core/2"
  readonly scopeKey: string
  readonly registrarReplicaId: ReplicaId
  readonly claimRevision: Uint64
  readonly registrationClaimDigest: Digest
  readonly state: "registered-candidate" | "dual-validated" | "abandoned"
  readonly projectIndexContentCertificateDigest: Digest | null
  readonly canvasGenesisContentCertificateDigest: Digest | null
  readonly genesisPrunableSetDigest: Digest | null
  readonly abandonmentDigest: Digest | null
}

export interface CollaborationScopeEntryV2 {
  readonly format: "convax.collaboration-scope-entry/2"
  readonly core: CollaborationScopeEntryCoreV2
  readonly coreDigest: Digest
}

export interface RegistryEntrySetV2 {
  readonly format: "convax.registry-entry-set/2"
  readonly entries: readonly CollaborationScopeEntryV2[]
}

export interface RegistrySnapshotCoreV2 {
  readonly format: "convax.registry-snapshot-core/2"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly registrySequence: Uint64
  readonly priorRegistryDigest: Digest | null
  readonly entriesDigest: Digest
  readonly entryCount: Uint32
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "registry-cutoff"
  readonly serviceKeyId: string
}

export interface RegistrySnapshotV2 {
  readonly format: "convax.registry-snapshot/2"
  readonly core: RegistrySnapshotCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export type RegistryCutoffTargetV2 =
  | Readonly<{
      kind: "replica"
      action: "revoke"
      memberId: MemberId
      priorMemberAuthorizationEpoch: Id128
      replicaId: ReplicaId
      actorId: ActorId
      priorReplicaAuthorizationEpoch: Id128
    }>
  | Readonly<{
      kind: "member"
      action: "revoke" | "downgrade-to-viewer"
      memberId: MemberId
      priorMemberAuthorizationEpoch: Id128
      targetedReplicaActorSet: readonly Readonly<{
        replicaId: ReplicaId
        actorId: ActorId
        priorReplicaAuthorizationEpoch: Id128
      }>[]
    }>

export interface RegistryEntryIdentityV2 {
  readonly format: "convax.registry-entry-identity/2"
  readonly scopeKey: string
  readonly registrarReplicaId: ReplicaId
  readonly claimRevision: Uint64
}

export interface TargetCutoffLeafCoreV2 {
  readonly format: "convax.target-cutoff-leaf-core/2"
  readonly entryIdentity: RegistryEntryIdentityV2
  readonly entryDigest: Digest
  readonly entryState: "registered-candidate" | "dual-validated" | "abandoned"
  readonly targetFrontier: Readonly<{ kind: "certified"; frontierDigest: Digest }> | Readonly<{ kind: "empty-target-frontier" }>
}

export interface RegistryCutoffCoveragePageCoreV2 {
  readonly format: "convax.registry-cutoff-coverage-page-core/2"
  readonly cutoffId: Id128
  readonly pageIndex: Uint32
  readonly firstLeafIdentityDigest: Digest
  readonly lastLeafIdentityDigest: Digest
  readonly leaves: readonly TargetCutoffLeafCoreV2[]
}

export interface RegistryCutoffCoveragePageV2 {
  readonly format: "convax.registry-cutoff-coverage-page/2"
  readonly core: RegistryCutoffCoveragePageCoreV2
  readonly coreDigest: Digest
}

export interface RegistryCutoffCoverageRootCoreV2 {
  readonly format: "convax.registry-cutoff-coverage-root-core/2"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly cutoffId: Id128
  readonly target: RegistryCutoffTargetV2
  readonly beforeMembershipSnapshotDigest: Digest
  readonly afterMembershipSnapshotDigest: Digest
  readonly registrySequence: Uint64
  readonly registryRootDigest: Digest
  readonly unlistedScopePolicy: "empty-target-frontier"
  readonly pageDigests: readonly Digest[]
  readonly leafCount: Uint32
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "registry-cutoff"
  readonly serviceKeyId: string
}

export interface RegistryCutoffCoverageRootV2 {
  readonly format: "convax.registry-cutoff-coverage-root/2"
  readonly core: RegistryCutoffCoverageRootCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface AuthorizationMutationCoreV2 {
  readonly format: "convax.authorization-mutation-core/2"
  readonly mutationId: Id128
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly target: RegistryCutoffTargetV2
  readonly beforeMembershipSnapshotDigest: Digest
  readonly afterMembershipSnapshotDigest: Digest
  readonly registryCutoffCoverageRootCoreDigest: Digest
  readonly closedSessionCredentialDigests: readonly Digest[]
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "registry-cutoff"
  readonly serviceKeyId: string
}

export interface AuthorizationMutationV2 {
  readonly format: "convax.authorization-mutation/2"
  readonly core: AuthorizationMutationCoreV2
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}
