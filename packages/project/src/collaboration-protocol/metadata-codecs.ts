import {
  assertBoundedNfcStringV2,
  assertDenseArrayV2,
  assertExactKeysV2,
  compareUtf8V2,
  encodeRestrictedJcsTextV2,
  parseActorIdV2,
  parseDigestV2,
  parseDocumentScopeV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parseReplicaIdV2,
  parseSignatureV2,
  parseUint32V2,
  parseUint64V2,
  structuredDigestV2,
  type DigestV2,
  type DocumentScopeV2,
} from "@convax/collaboration"
import { PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2 } from "./kernel-integration"
import type {
  AuthorizationMutationCoreV2,
  AuthorizationMutationV2,
  CollaborationScopeEntryCoreV2,
  CollaborationScopeEntryV2,
  DocumentRegistrationAbandonmentCoreV2,
  DocumentRegistrationAbandonmentV2,
  DocumentRegistrationClaimCoreV2,
  DocumentRegistrationClaimV2,
  RegistryCutoffCoveragePageCoreV2,
  RegistryCutoffCoveragePageV2,
  RegistryCutoffCoverageRootCoreV2,
  RegistryCutoffCoverageRootV2,
  RegistryCutoffTargetV2,
  RegistryEntryIdentityV2,
  RegistryEntrySetV2,
  RegistrySnapshotCoreV2,
  RegistrySnapshotV2,
  ReplicaProjectFloorEntryV2,
  ReplicaProjectFloorPageCoreV2,
  ReplicaProjectFloorPageV2,
  ReplicaProjectFloorRootCoreV2,
  ReplicaProjectFloorRootV2,
  TargetCutoffLeafCoreV2,
} from "./metadata-contracts"

const MAX_PROJECT_FLOOR_ENTRIES_PER_PAGE = 512
const MAX_PROJECT_FLOOR_PAGES = 8
const MAX_REGISTRY_ENTRIES = 4_096
const MAX_CUTOFF_LEAVES_PER_PAGE = 512
const MAX_CUTOFF_PAGES = 8
const MAX_TARGET_REPLICAS = 8
const MAX_CLOSED_SESSIONS = 8

export function replicaProjectFloorPageCoreDigestV2(core: ReplicaProjectFloorPageCoreV2): DigestV2 {
  return structuredDigestV2("convax.replica-project-floor-page-core/2", parseReplicaProjectFloorPageCoreV2(core))
}

export function replicaProjectFloorRootCoreDigestV2(core: ReplicaProjectFloorRootCoreV2): DigestV2 {
  return structuredDigestV2("convax.replica-project-floor-root-core/2", parseReplicaProjectFloorRootCoreV2(core))
}

export function registrationClaimCoreDigestV2(core: DocumentRegistrationClaimCoreV2): DigestV2 {
  return structuredDigestV2("convax.document-registration-claim-core/2", parseDocumentRegistrationClaimCoreV2(core))
}

export function registrationAbandonmentCoreDigestV2(core: DocumentRegistrationAbandonmentCoreV2): DigestV2 {
  return structuredDigestV2("convax.document-registration-abandonment-core/2", parseDocumentRegistrationAbandonmentCoreV2(core))
}

export function collaborationScopeEntryCoreDigestV2(core: CollaborationScopeEntryCoreV2): DigestV2 {
  return structuredDigestV2("convax.collaboration-scope-entry-core/2", parseCollaborationScopeEntryCoreV2(core))
}

export function registryEntrySetDigestV2(set: RegistryEntrySetV2): DigestV2 {
  return structuredDigestV2("convax.registry-entry-set/2", parseRegistryEntrySetV2(set))
}

export function registrySnapshotCoreDigestV2(core: RegistrySnapshotCoreV2): DigestV2 {
  return structuredDigestV2("convax.registry-snapshot-core/2", parseRegistrySnapshotCoreV2(core))
}

export function registryEntryIdentityDigestV2(identity: RegistryEntryIdentityV2): DigestV2 {
  return structuredDigestV2("convax.registry-entry-identity/2", parseRegistryEntryIdentityV2(identity))
}

export function registryCutoffCoveragePageCoreDigestV2(core: RegistryCutoffCoveragePageCoreV2): DigestV2 {
  return structuredDigestV2("convax.registry-cutoff-coverage-page-core/2", parseRegistryCutoffCoveragePageCoreV2(core))
}

export function registryCutoffCoverageRootCoreDigestV2(core: RegistryCutoffCoverageRootCoreV2): DigestV2 {
  return structuredDigestV2("convax.registry-cutoff-coverage-root-core/2", parseRegistryCutoffCoverageRootCoreV2(core))
}

export function authorizationMutationCoreDigestV2(core: AuthorizationMutationCoreV2): DigestV2 {
  return structuredDigestV2("convax.authorization-mutation-core/2", parseAuthorizationMutationCoreV2(core))
}

export function parseReplicaProjectFloorPageCoreV2(value: unknown): ReplicaProjectFloorPageCoreV2 {
  assertExactKeysV2(value, ["format", "floorSetId", "targetReplicaId", "pageIndex", "firstScopeKey", "lastScopeKey", "entries"], "ReplicaProjectFloorPageCoreV2")
  if (value.format !== "convax.replica-project-floor-page-core/2") invalid("Project floor page format is invalid")
  assertBoundedNfcStringV2(value.firstScopeKey, 1, 1_024, "Project floor first scope key")
  assertBoundedNfcStringV2(value.lastScopeKey, 1, 1_024, "Project floor last scope key")
  assertDenseArrayV2(value.entries, "Project floor entries")
  if (value.entries.length === 0 || value.entries.length > MAX_PROJECT_FLOOR_ENTRIES_PER_PAGE) invalid("Project floor page entry count is invalid")
  const entries = Object.freeze(value.entries.map(parseProjectFloorEntry))
  assertScopeOrder(entries.map((entry) => entry.scope), "Project floor entries")
  const scopeKeys = entries.map((entry) => scopeKey(entry.scope))
  if (value.firstScopeKey !== scopeKeys[0] || value.lastScopeKey !== scopeKeys.at(-1)) invalid("Project floor page range keys mismatch")
  return Object.freeze({ format: value.format, floorSetId: parseId128V2(value.floorSetId), targetReplicaId: parseReplicaIdV2(value.targetReplicaId), pageIndex: parseUint32V2(value.pageIndex), firstScopeKey: value.firstScopeKey, lastScopeKey: value.lastScopeKey, entries })
}

export function parseReplicaProjectFloorPageV2(value: unknown): ReplicaProjectFloorPageV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest"], "ReplicaProjectFloorPageV2")
  if (value.format !== "convax.replica-project-floor-page/2") invalid("Project floor page wrapper format is invalid")
  const core = parseReplicaProjectFloorPageCoreV2(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== replicaProjectFloorPageCoreDigestV2(core)) invalid("Project floor page digest mismatch")
  return Object.freeze({ format: value.format, core, coreDigest })
}

export function parseReplicaProjectFloorRootCoreV2(value: unknown): ReplicaProjectFloorRootCoreV2 {
  assertExactKeysV2(value, ["format", "projectId", "projectEpoch", "membershipEpoch", "floorSetId", "targetMemberId", "targetReplicaId", "targetActorId", "targetReplicaAuthorizationEpoch", "membershipSnapshotDigest", "projectIndexLiveScopeManifestDigest", "registrySequence", "registryRootDigest", "requiredScopeSetPolicy", "unlistedScopePolicy", "pageDigests", "entryCount", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "ReplicaProjectFloorRootCoreV2")
  if (value.format !== "convax.replica-project-floor-root-core/2" || value.requiredScopeSetPolicy !== "project-index-plus-certified-live-routes" || value.unlistedScopePolicy !== "registry-only-is-advisory-and-never-blocks-or-grants" || value.serviceKeyPurpose !== "checkpoint-stability") invalid("Project floor root discriminators are invalid")
  assertBoundedNfcStringV2(value.serviceKeyId, 1, 128, "Project floor service key id")
  return Object.freeze({
    format: value.format,
    projectId: parseProjectIdV2(value.projectId), projectEpoch: parseId128V2(value.projectEpoch), membershipEpoch: parseId128V2(value.membershipEpoch), floorSetId: parseId128V2(value.floorSetId), targetMemberId: parseMemberIdV2(value.targetMemberId), targetReplicaId: parseReplicaIdV2(value.targetReplicaId), targetActorId: parseActorIdV2(value.targetActorId), targetReplicaAuthorizationEpoch: parseId128V2(value.targetReplicaAuthorizationEpoch), membershipSnapshotDigest: parseDigestV2(value.membershipSnapshotDigest), projectIndexLiveScopeManifestDigest: parseDigestV2(value.projectIndexLiveScopeManifestDigest), registrySequence: parseUint64V2(value.registrySequence), registryRootDigest: parseDigestV2(value.registryRootDigest), requiredScopeSetPolicy: value.requiredScopeSetPolicy, unlistedScopePolicy: value.unlistedScopePolicy, pageDigests: digestList(value.pageDigests, 1, MAX_PROJECT_FLOOR_PAGES, "Project floor pages", false), entryCount: parseUint32V2(value.entryCount), protocolDigest: protocolDigest(value.protocolDigest), trustBundleDigest: parseDigestV2(value.trustBundleDigest), serviceKeyPurpose: value.serviceKeyPurpose, serviceKeyId: value.serviceKeyId,
  })
}

export function parseReplicaProjectFloorRootV2(value: unknown): ReplicaProjectFloorRootV2 {
  return closeService(value, "convax.replica-project-floor-root/2", parseReplicaProjectFloorRootCoreV2, replicaProjectFloorRootCoreDigestV2)
}

export function parseDocumentRegistrationClaimCoreV2(value: unknown): DocumentRegistrationClaimCoreV2 {
  assertExactKeysV2(value, ["format", "scope", "registrarMemberId", "registrarReplicaId", "registrarActorId", "registrarAuthorizationDigest", "claimRevision", "genesisCheckpointDigest", "projectIndexRouteDependencyDigest", "protocolDigest"], "DocumentRegistrationClaimCoreV2")
  if (value.format !== "convax.document-registration-claim-core/2") invalid("Registration claim format is invalid")
  return Object.freeze({ format: value.format, scope: parseDocumentScopeV2(value.scope), registrarMemberId: parseMemberIdV2(value.registrarMemberId), registrarReplicaId: parseReplicaIdV2(value.registrarReplicaId), registrarActorId: parseActorIdV2(value.registrarActorId), registrarAuthorizationDigest: parseDigestV2(value.registrarAuthorizationDigest), claimRevision: parseUint64V2(value.claimRevision), genesisCheckpointDigest: parseDigestV2(value.genesisCheckpointDigest), projectIndexRouteDependencyDigest: parseDigestV2(value.projectIndexRouteDependencyDigest), protocolDigest: protocolDigest(value.protocolDigest) })
}

export function parseDocumentRegistrationClaimV2(value: unknown): DocumentRegistrationClaimV2 {
  return closeReplica(value, "convax.document-registration-claim/2", parseDocumentRegistrationClaimCoreV2, registrationClaimCoreDigestV2, "replicaSignature")
}

export function parseDocumentRegistrationAbandonmentCoreV2(value: unknown): DocumentRegistrationAbandonmentCoreV2 {
  assertExactKeysV2(value, ["format", "registrationClaimDigest", "scope", "claimRevision", "actor", "reason", "protocolDigest"], "DocumentRegistrationAbandonmentCoreV2")
  if (value.format !== "convax.document-registration-abandonment-core/2" || (value.reason !== "cancelled" && value.reason !== "invalid-genesis" && value.reason !== "superseded-staging")) invalid("Registration abandonment discriminators are invalid")
  const actorKind = (value.actor as { readonly kind?: unknown }).kind
  assertExactKeysV2(value.actor, actorKind === "registrar" ? ["kind", "replicaId"] : ["kind", "memberId", "adminCapabilityDigest"], "registration abandonment actor")
  const actor = value.actor.kind === "registrar"
    ? Object.freeze({ kind: "registrar" as const, replicaId: parseReplicaIdV2(value.actor.replicaId) })
    : value.actor.kind === "project-admin"
      ? Object.freeze({ kind: "project-admin" as const, memberId: parseMemberIdV2(value.actor.memberId), adminCapabilityDigest: parseDigestV2(value.actor.adminCapabilityDigest) })
      : invalid("Registration abandonment actor is invalid")
  return Object.freeze({ format: value.format, registrationClaimDigest: parseDigestV2(value.registrationClaimDigest), scope: parseDocumentScopeV2(value.scope), claimRevision: parseUint64V2(value.claimRevision), actor, reason: value.reason, protocolDigest: protocolDigest(value.protocolDigest) })
}

export function parseDocumentRegistrationAbandonmentV2(value: unknown): DocumentRegistrationAbandonmentV2 {
  return closeReplica(value, "convax.document-registration-abandonment/2", parseDocumentRegistrationAbandonmentCoreV2, registrationAbandonmentCoreDigestV2, "actorSignature")
}

export function parseCollaborationScopeEntryCoreV2(value: unknown): CollaborationScopeEntryCoreV2 {
  assertExactKeysV2(value, ["format", "scopeKey", "registrarReplicaId", "claimRevision", "registrationClaimDigest", "state", "projectIndexContentCertificateDigest", "canvasGenesisContentCertificateDigest", "genesisPrunableSetDigest", "abandonmentDigest"], "CollaborationScopeEntryCoreV2")
  if (value.format !== "convax.collaboration-scope-entry-core/2" || (value.state !== "registered-candidate" && value.state !== "dual-validated" && value.state !== "abandoned")) invalid("Collaboration scope entry discriminators are invalid")
  assertBoundedNfcStringV2(value.scopeKey, 1, 1_024, "Collaboration scope key")
  const optional = (input: unknown) => input === null ? null : parseDigestV2(input)
  const core = Object.freeze({ format: value.format, scopeKey: value.scopeKey, registrarReplicaId: parseReplicaIdV2(value.registrarReplicaId), claimRevision: parseUint64V2(value.claimRevision), registrationClaimDigest: parseDigestV2(value.registrationClaimDigest), state: value.state, projectIndexContentCertificateDigest: optional(value.projectIndexContentCertificateDigest), canvasGenesisContentCertificateDigest: optional(value.canvasGenesisContentCertificateDigest), genesisPrunableSetDigest: optional(value.genesisPrunableSetDigest), abandonmentDigest: optional(value.abandonmentDigest) })
  if (core.state === "registered-candidate" && (core.projectIndexContentCertificateDigest !== null || core.canvasGenesisContentCertificateDigest !== null || core.genesisPrunableSetDigest !== null || core.abandonmentDigest !== null)) invalid("Candidate registry entry has terminal evidence")
  if (core.state === "abandoned" && (core.abandonmentDigest === null || core.projectIndexContentCertificateDigest !== null || core.canvasGenesisContentCertificateDigest !== null || core.genesisPrunableSetDigest !== null)) invalid("Abandoned registry entry evidence is invalid")
  if (core.state === "dual-validated" && (core.projectIndexContentCertificateDigest === null || core.canvasGenesisContentCertificateDigest === null || core.genesisPrunableSetDigest === null || core.abandonmentDigest !== null)) invalid("Dual-validated registry entry evidence is incomplete")
  return core
}

export function parseCollaborationScopeEntryV2(value: unknown): CollaborationScopeEntryV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest"], "CollaborationScopeEntryV2")
  if (value.format !== "convax.collaboration-scope-entry/2") invalid("Collaboration scope entry wrapper is invalid")
  const core = parseCollaborationScopeEntryCoreV2(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== collaborationScopeEntryCoreDigestV2(core)) invalid("Collaboration scope entry digest mismatch")
  return Object.freeze({ format: value.format, core, coreDigest })
}

export function parseRegistryEntrySetV2(value: unknown): RegistryEntrySetV2 {
  assertExactKeysV2(value, ["format", "entries"], "RegistryEntrySetV2")
  if (value.format !== "convax.registry-entry-set/2") invalid("Registry entry-set format is invalid")
  assertDenseArrayV2(value.entries, "Registry entries")
  if (value.entries.length > MAX_REGISTRY_ENTRIES) invalid("Registry entry-set exceeds capacity")
  const entries = Object.freeze(value.entries.map(parseCollaborationScopeEntryV2))
  assertEntryOrder(entries.map((entry) => Object.freeze({ scopeKey: entry.core.scopeKey, registrarReplicaId: entry.core.registrarReplicaId, claimRevision: entry.core.claimRevision })), "Registry entries")
  return Object.freeze({ format: value.format, entries })
}

export function parseRegistrySnapshotCoreV2(value: unknown): RegistrySnapshotCoreV2 {
  assertExactKeysV2(value, ["format", "projectId", "projectEpoch", "registrySequence", "priorRegistryDigest", "entriesDigest", "entryCount", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "RegistrySnapshotCoreV2")
  if (value.format !== "convax.registry-snapshot-core/2" || value.serviceKeyPurpose !== "registry-cutoff") invalid("Registry snapshot discriminators are invalid")
  assertBoundedNfcStringV2(value.serviceKeyId, 1, 128, "Registry service key id")
  return Object.freeze({ format: value.format, projectId: parseProjectIdV2(value.projectId), projectEpoch: parseId128V2(value.projectEpoch), registrySequence: parseUint64V2(value.registrySequence), priorRegistryDigest: value.priorRegistryDigest === null ? null : parseDigestV2(value.priorRegistryDigest), entriesDigest: parseDigestV2(value.entriesDigest), entryCount: parseUint32V2(value.entryCount), protocolDigest: protocolDigest(value.protocolDigest), trustBundleDigest: parseDigestV2(value.trustBundleDigest), serviceKeyPurpose: value.serviceKeyPurpose, serviceKeyId: value.serviceKeyId })
}

export function parseRegistrySnapshotV2(value: unknown): RegistrySnapshotV2 {
  return closeService(value, "convax.registry-snapshot/2", parseRegistrySnapshotCoreV2, registrySnapshotCoreDigestV2)
}

export function parseRegistryCutoffTargetV2(value: unknown): RegistryCutoffTargetV2 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Cutoff target must be an object")
  if ((value as { kind?: unknown }).kind === "replica") {
    assertExactKeysV2(value, ["kind", "action", "memberId", "priorMemberAuthorizationEpoch", "replicaId", "actorId", "priorReplicaAuthorizationEpoch"], "replica cutoff target")
    if (value.action !== "revoke") invalid("Replica cutoff action is invalid")
    return Object.freeze({ kind: "replica", action: "revoke", memberId: parseMemberIdV2(value.memberId), priorMemberAuthorizationEpoch: parseId128V2(value.priorMemberAuthorizationEpoch), replicaId: parseReplicaIdV2(value.replicaId), actorId: parseActorIdV2(value.actorId), priorReplicaAuthorizationEpoch: parseId128V2(value.priorReplicaAuthorizationEpoch) })
  }
  assertExactKeysV2(value, ["kind", "action", "memberId", "priorMemberAuthorizationEpoch", "targetedReplicaActorSet"], "member cutoff target")
  if (value.kind !== "member" || (value.action !== "revoke" && value.action !== "downgrade-to-viewer")) invalid("Member cutoff target is invalid")
  assertDenseArrayV2(value.targetedReplicaActorSet, "Targeted replica actor set")
  if (value.targetedReplicaActorSet.length > MAX_TARGET_REPLICAS) invalid("Targeted replica actor set exceeds capacity")
  const targetedReplicaActorSet = Object.freeze(value.targetedReplicaActorSet.map((entry) => {
    assertExactKeysV2(entry, ["replicaId", "actorId", "priorReplicaAuthorizationEpoch"], "targeted replica actor")
    return Object.freeze({ replicaId: parseReplicaIdV2(entry.replicaId), actorId: parseActorIdV2(entry.actorId), priorReplicaAuthorizationEpoch: parseId128V2(entry.priorReplicaAuthorizationEpoch) })
  }))
  assertStrictDecodedReplicaOrder(targetedReplicaActorSet.map((entry) => entry.replicaId), "Targeted replica actor set")
  return Object.freeze({ kind: "member", action: value.action, memberId: parseMemberIdV2(value.memberId), priorMemberAuthorizationEpoch: parseId128V2(value.priorMemberAuthorizationEpoch), targetedReplicaActorSet })
}

export function parseRegistryEntryIdentityV2(value: unknown): RegistryEntryIdentityV2 {
  assertExactKeysV2(value, ["format", "scopeKey", "registrarReplicaId", "claimRevision"], "RegistryEntryIdentityV2")
  if (value.format !== "convax.registry-entry-identity/2") invalid("Registry entry identity format is invalid")
  assertBoundedNfcStringV2(value.scopeKey, 1, 1_024, "Registry identity scope key")
  return Object.freeze({ format: value.format, scopeKey: value.scopeKey, registrarReplicaId: parseReplicaIdV2(value.registrarReplicaId), claimRevision: parseUint64V2(value.claimRevision) })
}

export function parseRegistryCutoffCoveragePageCoreV2(value: unknown): RegistryCutoffCoveragePageCoreV2 {
  assertExactKeysV2(value, ["format", "cutoffId", "pageIndex", "firstLeafIdentityDigest", "lastLeafIdentityDigest", "leaves"], "RegistryCutoffCoveragePageCoreV2")
  if (value.format !== "convax.registry-cutoff-coverage-page-core/2") invalid("Cutoff page format is invalid")
  assertDenseArrayV2(value.leaves, "Cutoff leaves")
  if (value.leaves.length === 0 || value.leaves.length > MAX_CUTOFF_LEAVES_PER_PAGE) invalid("Cutoff page leaf count is invalid")
  const leaves = Object.freeze(value.leaves.map(parseCutoffLeaf))
  assertEntryOrder(leaves.map((leaf) => leaf.entryIdentity), "Cutoff leaves")
  const first = registryEntryIdentityDigestV2(leaves[0]!.entryIdentity)
  const last = registryEntryIdentityDigestV2(leaves.at(-1)!.entryIdentity)
  if (parseDigestV2(value.firstLeafIdentityDigest) !== first || parseDigestV2(value.lastLeafIdentityDigest) !== last) invalid("Cutoff page range digests mismatch")
  return Object.freeze({ format: value.format, cutoffId: parseId128V2(value.cutoffId), pageIndex: parseUint32V2(value.pageIndex), firstLeafIdentityDigest: first, lastLeafIdentityDigest: last, leaves })
}

export function parseRegistryCutoffCoveragePageV2(value: unknown): RegistryCutoffCoveragePageV2 {
  assertExactKeysV2(value, ["format", "core", "coreDigest"], "RegistryCutoffCoveragePageV2")
  if (value.format !== "convax.registry-cutoff-coverage-page/2") invalid("Cutoff page wrapper format is invalid")
  const core = parseRegistryCutoffCoveragePageCoreV2(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== registryCutoffCoveragePageCoreDigestV2(core)) invalid("Cutoff page digest mismatch")
  return Object.freeze({ format: value.format, core, coreDigest })
}

export function parseRegistryCutoffCoverageRootCoreV2(value: unknown): RegistryCutoffCoverageRootCoreV2 {
  assertExactKeysV2(value, ["format", "projectId", "projectEpoch", "cutoffId", "target", "beforeMembershipSnapshotDigest", "afterMembershipSnapshotDigest", "registrySequence", "registryRootDigest", "unlistedScopePolicy", "pageDigests", "leafCount", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "RegistryCutoffCoverageRootCoreV2")
  if (value.format !== "convax.registry-cutoff-coverage-root-core/2" || value.unlistedScopePolicy !== "empty-target-frontier" || value.serviceKeyPurpose !== "registry-cutoff") invalid("Cutoff root discriminators are invalid")
  assertBoundedNfcStringV2(value.serviceKeyId, 1, 128, "Cutoff root service key id")
  return Object.freeze({ format: value.format, projectId: parseProjectIdV2(value.projectId), projectEpoch: parseId128V2(value.projectEpoch), cutoffId: parseId128V2(value.cutoffId), target: parseRegistryCutoffTargetV2(value.target), beforeMembershipSnapshotDigest: parseDigestV2(value.beforeMembershipSnapshotDigest), afterMembershipSnapshotDigest: parseDigestV2(value.afterMembershipSnapshotDigest), registrySequence: parseUint64V2(value.registrySequence), registryRootDigest: parseDigestV2(value.registryRootDigest), unlistedScopePolicy: value.unlistedScopePolicy, pageDigests: digestList(value.pageDigests, 0, MAX_CUTOFF_PAGES, "Cutoff pages", false), leafCount: parseUint32V2(value.leafCount), protocolDigest: protocolDigest(value.protocolDigest), trustBundleDigest: parseDigestV2(value.trustBundleDigest), serviceKeyPurpose: value.serviceKeyPurpose, serviceKeyId: value.serviceKeyId })
}

export function parseRegistryCutoffCoverageRootV2(value: unknown): RegistryCutoffCoverageRootV2 {
  return closeService(value, "convax.registry-cutoff-coverage-root/2", parseRegistryCutoffCoverageRootCoreV2, registryCutoffCoverageRootCoreDigestV2)
}

export function parseAuthorizationMutationCoreV2(value: unknown): AuthorizationMutationCoreV2 {
  assertExactKeysV2(value, ["format", "mutationId", "projectId", "projectEpoch", "membershipEpoch", "target", "beforeMembershipSnapshotDigest", "afterMembershipSnapshotDigest", "registryCutoffCoverageRootCoreDigest", "closedSessionCredentialDigests", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "AuthorizationMutationCoreV2")
  if (value.format !== "convax.authorization-mutation-core/2" || value.serviceKeyPurpose !== "registry-cutoff") invalid("Authorization mutation discriminators are invalid")
  assertBoundedNfcStringV2(value.serviceKeyId, 1, 128, "Authorization mutation service key id")
  return Object.freeze({ format: value.format, mutationId: parseId128V2(value.mutationId), projectId: parseProjectIdV2(value.projectId), projectEpoch: parseId128V2(value.projectEpoch), membershipEpoch: parseId128V2(value.membershipEpoch), target: parseRegistryCutoffTargetV2(value.target), beforeMembershipSnapshotDigest: parseDigestV2(value.beforeMembershipSnapshotDigest), afterMembershipSnapshotDigest: parseDigestV2(value.afterMembershipSnapshotDigest), registryCutoffCoverageRootCoreDigest: parseDigestV2(value.registryCutoffCoverageRootCoreDigest), closedSessionCredentialDigests: digestList(value.closedSessionCredentialDigests, 0, MAX_CLOSED_SESSIONS, "Closed session credentials", true), protocolDigest: protocolDigest(value.protocolDigest), trustBundleDigest: parseDigestV2(value.trustBundleDigest), serviceKeyPurpose: value.serviceKeyPurpose, serviceKeyId: value.serviceKeyId })
}

export function parseAuthorizationMutationV2(value: unknown): AuthorizationMutationV2 {
  return closeService(value, "convax.authorization-mutation/2", parseAuthorizationMutationCoreV2, authorizationMutationCoreDigestV2)
}

function parseProjectFloorEntry(value: unknown): ReplicaProjectFloorEntryV2 {
  assertExactKeysV2(value, ["scope", "basis", "prunableCheckpointSetCertificateDigest", "replicaCausalFloorAckDigest"], "ReplicaProjectFloorEntryV2")
  const scope = parseDocumentScopeV2(value.scope)
  if (value.basis !== "project-index" && value.basis !== "project-index-live-route") invalid("Project floor entry basis is invalid")
  if ((scope.docKind === "project-index") !== (value.basis === "project-index")) invalid("Project floor basis does not match scope kind")
  return Object.freeze({ scope, basis: value.basis, prunableCheckpointSetCertificateDigest: parseDigestV2(value.prunableCheckpointSetCertificateDigest), replicaCausalFloorAckDigest: parseDigestV2(value.replicaCausalFloorAckDigest) })
}

function parseCutoffLeaf(value: unknown): TargetCutoffLeafCoreV2 {
  assertExactKeysV2(value, ["format", "entryIdentity", "entryDigest", "entryState", "targetFrontier"], "TargetCutoffLeafCoreV2")
  if (value.format !== "convax.target-cutoff-leaf-core/2" || (value.entryState !== "registered-candidate" && value.entryState !== "dual-validated" && value.entryState !== "abandoned")) invalid("Cutoff leaf discriminators are invalid")
  const frontierKind = (value.targetFrontier as { readonly kind?: unknown }).kind
  assertExactKeysV2(value.targetFrontier, frontierKind === "certified" ? ["kind", "frontierDigest"] : ["kind"], "Cutoff target frontier")
  const targetFrontier = value.targetFrontier.kind === "certified"
    ? Object.freeze({ kind: "certified" as const, frontierDigest: parseDigestV2(value.targetFrontier.frontierDigest) })
    : value.targetFrontier.kind === "empty-target-frontier"
      ? Object.freeze({ kind: "empty-target-frontier" as const })
      : invalid("Cutoff target frontier is invalid")
  if ((value.entryState === "dual-validated") !== (targetFrontier.kind === "certified")) invalid("Cutoff target frontier does not match entry state")
  return Object.freeze({ format: value.format, entryIdentity: parseRegistryEntryIdentityV2(value.entryIdentity), entryDigest: parseDigestV2(value.entryDigest), entryState: value.entryState, targetFrontier })
}

function closeService<Core, Result>(value: unknown, format: string, parseCore: (value: unknown) => Core, digest: (core: Core) => DigestV2): Result {
  assertExactKeysV2(value, ["format", "core", "coreDigest", "serviceSignature"], format)
  if (value.format !== format) invalid(`${format} wrapper format is invalid`)
  const core = parseCore(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== digest(core)) invalid(`${format} digest mismatch`)
  return Object.freeze({ format, core, coreDigest, serviceSignature: parseSignatureV2(value.serviceSignature) }) as Result
}

function closeReplica<Core, Result>(value: unknown, format: string, parseCore: (value: unknown) => Core, digest: (core: Core) => DigestV2, signatureKey: "replicaSignature" | "actorSignature"): Result {
  assertExactKeysV2(value, ["format", "core", "coreDigest", signatureKey], format)
  if (value.format !== format) invalid(`${format} wrapper format is invalid`)
  const core = parseCore(value.core)
  const coreDigest = parseDigestV2(value.coreDigest)
  if (coreDigest !== digest(core)) invalid(`${format} digest mismatch`)
  return Object.freeze({ format, core, coreDigest, [signatureKey]: parseSignatureV2(value[signatureKey]) }) as Result
}

function digestList(value: unknown, minimum: number, maximum: number, label: string, sort: boolean): readonly DigestV2[] {
  assertDenseArrayV2(value, label)
  if (value.length < minimum || value.length > maximum) invalid(`${label} count is invalid`)
  const values = value.map(parseDigestV2)
  if (sort) assertStrictOrder(values, label)
  else if (new Set(values).size !== values.length) invalid(`${label} must be unique`)
  return Object.freeze(values)
}

function protocolDigest(value: unknown): DigestV2 {
  const parsed = parseDigestV2(value)
  if (parsed !== PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION_V2.requiredProtocolDigest) invalid("Protocol digest is not the selected R5 digest")
  return parsed
}

function scopeKey(scope: DocumentScopeV2): string {
  return encodeRestrictedJcsTextV2(scope)
}

function assertScopeOrder(scopes: readonly DocumentScopeV2[], label: string): void {
  assertStrictOrder(scopes.map(scopeKey), label)
}

function assertStrictOrder(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) if (compareUtf8V2(values[index - 1]!, values[index]!) >= 0) invalid(`${label} must be strictly sorted and unique`)
}

function assertEntryOrder(values: readonly Readonly<{ scopeKey: string; registrarReplicaId: string; claimRevision: string }>[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    const left = values[index - 1]!
    const right = values[index]!
    const comparison = compareUtf8V2(left.scopeKey, right.scopeKey) || compareUtf8V2(left.registrarReplicaId, right.registrarReplicaId) || (BigInt(left.claimRevision) < BigInt(right.claimRevision) ? -1 : BigInt(left.claimRevision) > BigInt(right.claimRevision) ? 1 : 0)
    if (comparison >= 0) invalid(`${label} must be strictly sorted and unique`)
  }
}

function assertStrictDecodedReplicaOrder(values: readonly string[], label: string): void {
  // ReplicaIdV2 is fixed-width lower-hex, so UTF-8 order is its decoded numeric order.
  assertStrictOrder(values, label)
}

function invalid(message: string): never {
  throw new TypeError(message)
}
