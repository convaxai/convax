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

export interface ReplicaProjectFloorEntry {
  readonly scope: DocumentScope
  readonly basis: "project-index" | "project-index-live-route"
  readonly prunableCheckpointSetCertificateDigest: Digest
  readonly replicaCausalFloorAckDigest: Digest
}

export interface ReplicaProjectFloorPageCore {
  readonly format: "convax.replica-project-floor-page-core"
  readonly floorSetId: Id128
  readonly targetReplicaId: ReplicaId
  readonly pageIndex: Uint32
  readonly firstScopeKey: string
  readonly lastScopeKey: string
  readonly entries: readonly ReplicaProjectFloorEntry[]
}

export interface ReplicaProjectFloorPage {
  readonly format: "convax.replica-project-floor-page"
  readonly core: ReplicaProjectFloorPageCore
  readonly coreDigest: Digest
}

export interface ReplicaProjectFloorRootCore {
  readonly format: "convax.replica-project-floor-root-core"
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

export interface ReplicaProjectFloorRoot {
  readonly format: "convax.replica-project-floor-root"
  readonly core: ReplicaProjectFloorRootCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface DocumentRegistrationClaimCore {
  readonly format: "convax.document-registration-claim-core"
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

export interface DocumentRegistrationClaim {
  readonly format: "convax.document-registration-claim"
  readonly core: DocumentRegistrationClaimCore
  readonly coreDigest: Digest
  readonly replicaSignature: Signature
}

export type DocumentRegistrationAbandonmentActor =
  | Readonly<{ kind: "registrar"; replicaId: ReplicaId }>
  | Readonly<{ kind: "project-admin"; memberId: MemberId; adminCapabilityDigest: Digest }>

export interface DocumentRegistrationAbandonmentCore {
  readonly format: "convax.document-registration-abandonment-core"
  readonly registrationClaimDigest: Digest
  readonly scope: DocumentScope
  readonly claimRevision: Uint64
  readonly actor: DocumentRegistrationAbandonmentActor
  readonly reason: "cancelled" | "invalid-genesis" | "superseded-staging"
  readonly protocolDigest: Digest
}

export interface DocumentRegistrationAbandonment {
  readonly format: "convax.document-registration-abandonment"
  readonly core: DocumentRegistrationAbandonmentCore
  readonly coreDigest: Digest
  readonly actorSignature: Signature
}

export interface CollaborationScopeEntryCore {
  readonly format: "convax.collaboration-scope-entry-core"
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

export interface CollaborationScopeEntry {
  readonly format: "convax.collaboration-scope-entry"
  readonly core: CollaborationScopeEntryCore
  readonly coreDigest: Digest
}

export interface RegistryEntrySet {
  readonly format: "convax.registry-entry-set"
  readonly entries: readonly CollaborationScopeEntry[]
}

export interface RegistrySnapshotCore {
  readonly format: "convax.registry-snapshot-core"
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

export interface RegistrySnapshot {
  readonly format: "convax.registry-snapshot"
  readonly core: RegistrySnapshotCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export type RegistryCutoffTarget =
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

export interface RegistryEntryIdentity {
  readonly format: "convax.registry-entry-identity"
  readonly scopeKey: string
  readonly registrarReplicaId: ReplicaId
  readonly claimRevision: Uint64
}

export interface TargetCutoffLeafCore {
  readonly format: "convax.target-cutoff-leaf-core"
  readonly entryIdentity: RegistryEntryIdentity
  readonly entryDigest: Digest
  readonly entryState: "registered-candidate" | "dual-validated" | "abandoned"
  readonly targetFrontier: Readonly<{ kind: "certified"; frontierDigest: Digest }> | Readonly<{ kind: "empty-target-frontier" }>
}

export interface RegistryCutoffCoveragePageCore {
  readonly format: "convax.registry-cutoff-coverage-page-core"
  readonly cutoffId: Id128
  readonly pageIndex: Uint32
  readonly firstLeafIdentityDigest: Digest
  readonly lastLeafIdentityDigest: Digest
  readonly leaves: readonly TargetCutoffLeafCore[]
}

export interface RegistryCutoffCoveragePage {
  readonly format: "convax.registry-cutoff-coverage-page"
  readonly core: RegistryCutoffCoveragePageCore
  readonly coreDigest: Digest
}

export interface RegistryCutoffCoverageRootCore {
  readonly format: "convax.registry-cutoff-coverage-root-core"
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly cutoffId: Id128
  readonly target: RegistryCutoffTarget
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

export interface RegistryCutoffCoverageRoot {
  readonly format: "convax.registry-cutoff-coverage-root"
  readonly core: RegistryCutoffCoverageRootCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}

export interface AuthorizationMutationCore {
  readonly format: "convax.authorization-mutation-core"
  readonly mutationId: Id128
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly membershipEpoch: Id128
  readonly target: RegistryCutoffTarget
  readonly beforeMembershipSnapshotDigest: Digest
  readonly afterMembershipSnapshotDigest: Digest
  readonly registryCutoffCoverageRootCoreDigest: Digest
  readonly closedSessionCredentialDigests: readonly Digest[]
  readonly protocolDigest: Digest
  readonly trustBundleDigest: Digest
  readonly serviceKeyPurpose: "registry-cutoff"
  readonly serviceKeyId: string
}

export interface AuthorizationMutation {
  readonly format: "convax.authorization-mutation"
  readonly core: AuthorizationMutationCore
  readonly coreDigest: Digest
  readonly serviceSignature: Signature
}
