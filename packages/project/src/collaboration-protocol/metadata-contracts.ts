import type {
  ActorIdV2,
  DigestV2,
  DocumentScopeV2,
  Id128V2,
  MemberIdV2,
  ProjectIdV2,
  ReplicaIdV2,
  SignatureV2,
  Uint32V2,
  Uint64V2,
} from "@convax/collaboration"

export interface ReplicaProjectFloorEntryV2 {
  readonly scope: DocumentScopeV2
  readonly basis: "project-index" | "project-index-live-route"
  readonly prunableCheckpointSetCertificateDigest: DigestV2
  readonly replicaCausalFloorAckDigest: DigestV2
}

export interface ReplicaProjectFloorPageCoreV2 {
  readonly format: "convax.replica-project-floor-page-core/2"
  readonly floorSetId: Id128V2
  readonly targetReplicaId: ReplicaIdV2
  readonly pageIndex: Uint32V2
  readonly firstScopeKey: string
  readonly lastScopeKey: string
  readonly entries: readonly ReplicaProjectFloorEntryV2[]
}

export interface ReplicaProjectFloorPageV2 {
  readonly format: "convax.replica-project-floor-page/2"
  readonly core: ReplicaProjectFloorPageCoreV2
  readonly coreDigest: DigestV2
}

export interface ReplicaProjectFloorRootCoreV2 {
  readonly format: "convax.replica-project-floor-root-core/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly floorSetId: Id128V2
  readonly targetMemberId: MemberIdV2
  readonly targetReplicaId: ReplicaIdV2
  readonly targetActorId: ActorIdV2
  readonly targetReplicaAuthorizationEpoch: Id128V2
  readonly membershipSnapshotDigest: DigestV2
  readonly projectIndexLiveScopeManifestDigest: DigestV2
  readonly registrySequence: Uint64V2
  readonly registryRootDigest: DigestV2
  readonly requiredScopeSetPolicy: "project-index-plus-certified-live-routes"
  readonly unlistedScopePolicy: "registry-only-is-advisory-and-never-blocks-or-grants"
  readonly pageDigests: readonly DigestV2[]
  readonly entryCount: Uint32V2
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "checkpoint-stability"
  readonly serviceKeyId: string
}

export interface ReplicaProjectFloorRootV2 {
  readonly format: "convax.replica-project-floor-root/2"
  readonly core: ReplicaProjectFloorRootCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export interface DocumentRegistrationClaimCoreV2 {
  readonly format: "convax.document-registration-claim-core/2"
  readonly scope: DocumentScopeV2
  readonly registrarMemberId: MemberIdV2
  readonly registrarReplicaId: ReplicaIdV2
  readonly registrarActorId: ActorIdV2
  readonly registrarAuthorizationDigest: DigestV2
  readonly claimRevision: Uint64V2
  readonly genesisCheckpointDigest: DigestV2
  readonly projectIndexRouteDependencyDigest: DigestV2
  readonly protocolDigest: DigestV2
}

export interface DocumentRegistrationClaimV2 {
  readonly format: "convax.document-registration-claim/2"
  readonly core: DocumentRegistrationClaimCoreV2
  readonly coreDigest: DigestV2
  readonly replicaSignature: SignatureV2
}

export type DocumentRegistrationAbandonmentActorV2 =
  | Readonly<{ kind: "registrar"; replicaId: ReplicaIdV2 }>
  | Readonly<{ kind: "project-admin"; memberId: MemberIdV2; adminCapabilityDigest: DigestV2 }>

export interface DocumentRegistrationAbandonmentCoreV2 {
  readonly format: "convax.document-registration-abandonment-core/2"
  readonly registrationClaimDigest: DigestV2
  readonly scope: DocumentScopeV2
  readonly claimRevision: Uint64V2
  readonly actor: DocumentRegistrationAbandonmentActorV2
  readonly reason: "cancelled" | "invalid-genesis" | "superseded-staging"
  readonly protocolDigest: DigestV2
}

export interface DocumentRegistrationAbandonmentV2 {
  readonly format: "convax.document-registration-abandonment/2"
  readonly core: DocumentRegistrationAbandonmentCoreV2
  readonly coreDigest: DigestV2
  readonly actorSignature: SignatureV2
}

export interface CollaborationScopeEntryCoreV2 {
  readonly format: "convax.collaboration-scope-entry-core/2"
  readonly scopeKey: string
  readonly registrarReplicaId: ReplicaIdV2
  readonly claimRevision: Uint64V2
  readonly registrationClaimDigest: DigestV2
  readonly state: "registered-candidate" | "dual-validated" | "abandoned"
  readonly projectIndexContentCertificateDigest: DigestV2 | null
  readonly canvasGenesisContentCertificateDigest: DigestV2 | null
  readonly genesisPrunableSetDigest: DigestV2 | null
  readonly abandonmentDigest: DigestV2 | null
}

export interface CollaborationScopeEntryV2 {
  readonly format: "convax.collaboration-scope-entry/2"
  readonly core: CollaborationScopeEntryCoreV2
  readonly coreDigest: DigestV2
}

export interface RegistryEntrySetV2 {
  readonly format: "convax.registry-entry-set/2"
  readonly entries: readonly CollaborationScopeEntryV2[]
}

export interface RegistrySnapshotCoreV2 {
  readonly format: "convax.registry-snapshot-core/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly registrySequence: Uint64V2
  readonly priorRegistryDigest: DigestV2 | null
  readonly entriesDigest: DigestV2
  readonly entryCount: Uint32V2
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "registry-cutoff"
  readonly serviceKeyId: string
}

export interface RegistrySnapshotV2 {
  readonly format: "convax.registry-snapshot/2"
  readonly core: RegistrySnapshotCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export type RegistryCutoffTargetV2 =
  | Readonly<{
      kind: "replica"
      action: "revoke"
      memberId: MemberIdV2
      priorMemberAuthorizationEpoch: Id128V2
      replicaId: ReplicaIdV2
      actorId: ActorIdV2
      priorReplicaAuthorizationEpoch: Id128V2
    }>
  | Readonly<{
      kind: "member"
      action: "revoke" | "downgrade-to-viewer"
      memberId: MemberIdV2
      priorMemberAuthorizationEpoch: Id128V2
      targetedReplicaActorSet: readonly Readonly<{
        replicaId: ReplicaIdV2
        actorId: ActorIdV2
        priorReplicaAuthorizationEpoch: Id128V2
      }>[]
    }>

export interface RegistryEntryIdentityV2 {
  readonly format: "convax.registry-entry-identity/2"
  readonly scopeKey: string
  readonly registrarReplicaId: ReplicaIdV2
  readonly claimRevision: Uint64V2
}

export interface TargetCutoffLeafCoreV2 {
  readonly format: "convax.target-cutoff-leaf-core/2"
  readonly entryIdentity: RegistryEntryIdentityV2
  readonly entryDigest: DigestV2
  readonly entryState: "registered-candidate" | "dual-validated" | "abandoned"
  readonly targetFrontier: Readonly<{ kind: "certified"; frontierDigest: DigestV2 }> | Readonly<{ kind: "empty-target-frontier" }>
}

export interface RegistryCutoffCoveragePageCoreV2 {
  readonly format: "convax.registry-cutoff-coverage-page-core/2"
  readonly cutoffId: Id128V2
  readonly pageIndex: Uint32V2
  readonly firstLeafIdentityDigest: DigestV2
  readonly lastLeafIdentityDigest: DigestV2
  readonly leaves: readonly TargetCutoffLeafCoreV2[]
}

export interface RegistryCutoffCoveragePageV2 {
  readonly format: "convax.registry-cutoff-coverage-page/2"
  readonly core: RegistryCutoffCoveragePageCoreV2
  readonly coreDigest: DigestV2
}

export interface RegistryCutoffCoverageRootCoreV2 {
  readonly format: "convax.registry-cutoff-coverage-root-core/2"
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly cutoffId: Id128V2
  readonly target: RegistryCutoffTargetV2
  readonly beforeMembershipSnapshotDigest: DigestV2
  readonly afterMembershipSnapshotDigest: DigestV2
  readonly registrySequence: Uint64V2
  readonly registryRootDigest: DigestV2
  readonly unlistedScopePolicy: "empty-target-frontier"
  readonly pageDigests: readonly DigestV2[]
  readonly leafCount: Uint32V2
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "registry-cutoff"
  readonly serviceKeyId: string
}

export interface RegistryCutoffCoverageRootV2 {
  readonly format: "convax.registry-cutoff-coverage-root/2"
  readonly core: RegistryCutoffCoverageRootCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}

export interface AuthorizationMutationCoreV2 {
  readonly format: "convax.authorization-mutation-core/2"
  readonly mutationId: Id128V2
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly membershipEpoch: Id128V2
  readonly target: RegistryCutoffTargetV2
  readonly beforeMembershipSnapshotDigest: DigestV2
  readonly afterMembershipSnapshotDigest: DigestV2
  readonly registryCutoffCoverageRootCoreDigest: DigestV2
  readonly closedSessionCredentialDigests: readonly DigestV2[]
  readonly protocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
  readonly serviceKeyPurpose: "registry-cutoff"
  readonly serviceKeyId: string
}

export interface AuthorizationMutationV2 {
  readonly format: "convax.authorization-mutation/2"
  readonly core: AuthorizationMutationCoreV2
  readonly coreDigest: DigestV2
  readonly serviceSignature: SignatureV2
}
