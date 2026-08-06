import {
  assertBoundedNfcString,
  assertDenseArray,
  assertExactKeys,
  compareUtf8,
  encodeRestrictedJcsText,
  parseActorId,
  parseDigest,
  parseDocumentScope,
  parseId128,
  parseMemberId,
  parseProjectId,
  parseReplicaId,
  parseSignature,
  parseUint32,
  parseUint64,
  structuredDigest,
  type Digest,
  type DocumentScope,
} from "@convax/collaboration"
import { PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION } from "./kernel-integration"
import type {
  AuthorizationMutationCore,
  AuthorizationMutation,
  CollaborationScopeEntryCore,
  CollaborationScopeEntry,
  DocumentRegistrationAbandonmentCore,
  DocumentRegistrationAbandonment,
  DocumentRegistrationClaimCore,
  DocumentRegistrationClaim,
  RegistryCutoffCoveragePageCore,
  RegistryCutoffCoveragePage,
  RegistryCutoffCoverageRootCore,
  RegistryCutoffCoverageRoot,
  RegistryCutoffTarget,
  RegistryEntryIdentity,
  RegistryEntrySet,
  RegistrySnapshotCore,
  RegistrySnapshot,
  ReplicaProjectFloorEntry,
  ReplicaProjectFloorPageCore,
  ReplicaProjectFloorPage,
  ReplicaProjectFloorRootCore,
  ReplicaProjectFloorRoot,
  TargetCutoffLeafCore,
} from "./metadata-contracts"

const MAX_PROJECT_FLOOR_ENTRIES_PER_PAGE = 512
const MAX_PROJECT_FLOOR_PAGES = 8
const MAX_REGISTRY_ENTRIES = 4_096
const MAX_CUTOFF_LEAVES_PER_PAGE = 512
const MAX_CUTOFF_PAGES = 8
const MAX_TARGET_REPLICAS = 8
const MAX_CLOSED_SESSIONS = 8

export function replicaProjectFloorPageCoreDigest(core: ReplicaProjectFloorPageCore): Digest {
  return structuredDigest("convax.replica-project-floor-page-core", parseReplicaProjectFloorPageCore(core))
}

export function replicaProjectFloorRootCoreDigest(core: ReplicaProjectFloorRootCore): Digest {
  return structuredDigest("convax.replica-project-floor-root-core", parseReplicaProjectFloorRootCore(core))
}

export function registrationClaimCoreDigest(core: DocumentRegistrationClaimCore): Digest {
  return structuredDigest("convax.document-registration-claim-core", parseDocumentRegistrationClaimCore(core))
}

export function registrationAbandonmentCoreDigest(core: DocumentRegistrationAbandonmentCore): Digest {
  return structuredDigest("convax.document-registration-abandonment-core", parseDocumentRegistrationAbandonmentCore(core))
}

export function collaborationScopeEntryCoreDigest(core: CollaborationScopeEntryCore): Digest {
  return structuredDigest("convax.collaboration-scope-entry-core", parseCollaborationScopeEntryCore(core))
}

export function registryEntrySetDigest(set: RegistryEntrySet): Digest {
  return structuredDigest("convax.registry-entry-set", parseRegistryEntrySet(set))
}

export function registrySnapshotCoreDigest(core: RegistrySnapshotCore): Digest {
  return structuredDigest("convax.registry-snapshot-core", parseRegistrySnapshotCore(core))
}

export function registryEntryIdentityDigest(identity: RegistryEntryIdentity): Digest {
  return structuredDigest("convax.registry-entry-identity", parseRegistryEntryIdentity(identity))
}

export function registryCutoffCoveragePageCoreDigest(core: RegistryCutoffCoveragePageCore): Digest {
  return structuredDigest("convax.registry-cutoff-coverage-page-core", parseRegistryCutoffCoveragePageCore(core))
}

export function registryCutoffCoverageRootCoreDigest(core: RegistryCutoffCoverageRootCore): Digest {
  return structuredDigest("convax.registry-cutoff-coverage-root-core", parseRegistryCutoffCoverageRootCore(core))
}

export function authorizationMutationCoreDigest(core: AuthorizationMutationCore): Digest {
  return structuredDigest("convax.authorization-mutation-core", parseAuthorizationMutationCore(core))
}

export function parseReplicaProjectFloorPageCore(value: unknown): ReplicaProjectFloorPageCore {
  assertExactKeys(value, ["format", "floorSetId", "targetReplicaId", "pageIndex", "firstScopeKey", "lastScopeKey", "entries"], "ReplicaProjectFloorPageCore")
  if (value.format !== "convax.replica-project-floor-page-core") invalid("Project floor page format is invalid")
  assertBoundedNfcString(value.firstScopeKey, 1, 1_024, "Project floor first scope key")
  assertBoundedNfcString(value.lastScopeKey, 1, 1_024, "Project floor last scope key")
  assertDenseArray(value.entries, "Project floor entries")
  if (value.entries.length === 0 || value.entries.length > MAX_PROJECT_FLOOR_ENTRIES_PER_PAGE) invalid("Project floor page entry count is invalid")
  const entries = Object.freeze(value.entries.map(parseProjectFloorEntry))
  assertScopeOrder(entries.map((entry) => entry.scope), "Project floor entries")
  const scopeKeys = entries.map((entry) => scopeKey(entry.scope))
  if (value.firstScopeKey !== scopeKeys[0] || value.lastScopeKey !== scopeKeys.at(-1)) invalid("Project floor page range keys mismatch")
  return Object.freeze({ format: value.format, floorSetId: parseId128(value.floorSetId), targetReplicaId: parseReplicaId(value.targetReplicaId), pageIndex: parseUint32(value.pageIndex), firstScopeKey: value.firstScopeKey, lastScopeKey: value.lastScopeKey, entries })
}

export function parseReplicaProjectFloorPage(value: unknown): ReplicaProjectFloorPage {
  assertExactKeys(value, ["format", "core", "coreDigest"], "ReplicaProjectFloorPage")
  if (value.format !== "convax.replica-project-floor-page") invalid("Project floor page wrapper format is invalid")
  const core = parseReplicaProjectFloorPageCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== replicaProjectFloorPageCoreDigest(core)) invalid("Project floor page digest mismatch")
  return Object.freeze({ format: value.format, core, coreDigest })
}

export function parseReplicaProjectFloorRootCore(value: unknown): ReplicaProjectFloorRootCore {
  assertExactKeys(value, ["format", "projectId", "projectEpoch", "membershipEpoch", "floorSetId", "targetMemberId", "targetReplicaId", "targetActorId", "targetReplicaAuthorizationEpoch", "membershipSnapshotDigest", "projectIndexLiveScopeManifestDigest", "registrySequence", "registryRootDigest", "requiredScopeSetPolicy", "unlistedScopePolicy", "pageDigests", "entryCount", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "ReplicaProjectFloorRootCore")
  if (value.format !== "convax.replica-project-floor-root-core" || value.requiredScopeSetPolicy !== "project-index-plus-certified-live-routes" || value.unlistedScopePolicy !== "registry-only-is-advisory-and-never-blocks-or-grants" || value.serviceKeyPurpose !== "checkpoint-stability") invalid("Project floor root discriminators are invalid")
  assertBoundedNfcString(value.serviceKeyId, 1, 128, "Project floor service key id")
  return Object.freeze({
    format: value.format,
    projectId: parseProjectId(value.projectId), projectEpoch: parseId128(value.projectEpoch), membershipEpoch: parseId128(value.membershipEpoch), floorSetId: parseId128(value.floorSetId), targetMemberId: parseMemberId(value.targetMemberId), targetReplicaId: parseReplicaId(value.targetReplicaId), targetActorId: parseActorId(value.targetActorId), targetReplicaAuthorizationEpoch: parseId128(value.targetReplicaAuthorizationEpoch), membershipSnapshotDigest: parseDigest(value.membershipSnapshotDigest), projectIndexLiveScopeManifestDigest: parseDigest(value.projectIndexLiveScopeManifestDigest), registrySequence: parseUint64(value.registrySequence), registryRootDigest: parseDigest(value.registryRootDigest), requiredScopeSetPolicy: value.requiredScopeSetPolicy, unlistedScopePolicy: value.unlistedScopePolicy, pageDigests: digestList(value.pageDigests, 1, MAX_PROJECT_FLOOR_PAGES, "Project floor pages", false), entryCount: parseUint32(value.entryCount), protocolDigest: protocolDigest(value.protocolDigest), trustBundleDigest: parseDigest(value.trustBundleDigest), serviceKeyPurpose: value.serviceKeyPurpose, serviceKeyId: value.serviceKeyId,
  })
}

export function parseReplicaProjectFloorRoot(value: unknown): ReplicaProjectFloorRoot {
  return closeService(value, "convax.replica-project-floor-root", parseReplicaProjectFloorRootCore, replicaProjectFloorRootCoreDigest)
}

export function parseDocumentRegistrationClaimCore(value: unknown): DocumentRegistrationClaimCore {
  assertExactKeys(value, ["format", "scope", "registrarMemberId", "registrarReplicaId", "registrarActorId", "registrarAuthorizationDigest", "claimRevision", "genesisCheckpointDigest", "projectIndexRouteDependencyDigest", "protocolDigest"], "DocumentRegistrationClaimCore")
  if (value.format !== "convax.document-registration-claim-core") invalid("Registration claim format is invalid")
  return Object.freeze({ format: value.format, scope: parseDocumentScope(value.scope), registrarMemberId: parseMemberId(value.registrarMemberId), registrarReplicaId: parseReplicaId(value.registrarReplicaId), registrarActorId: parseActorId(value.registrarActorId), registrarAuthorizationDigest: parseDigest(value.registrarAuthorizationDigest), claimRevision: parseUint64(value.claimRevision), genesisCheckpointDigest: parseDigest(value.genesisCheckpointDigest), projectIndexRouteDependencyDigest: parseDigest(value.projectIndexRouteDependencyDigest), protocolDigest: protocolDigest(value.protocolDigest) })
}

export function parseDocumentRegistrationClaim(value: unknown): DocumentRegistrationClaim {
  return closeReplica(value, "convax.document-registration-claim", parseDocumentRegistrationClaimCore, registrationClaimCoreDigest, "replicaSignature")
}

export function parseDocumentRegistrationAbandonmentCore(value: unknown): DocumentRegistrationAbandonmentCore {
  assertExactKeys(value, ["format", "registrationClaimDigest", "scope", "claimRevision", "actor", "reason", "protocolDigest"], "DocumentRegistrationAbandonmentCore")
  if (value.format !== "convax.document-registration-abandonment-core" || (value.reason !== "cancelled" && value.reason !== "invalid-genesis" && value.reason !== "superseded-staging")) invalid("Registration abandonment discriminators are invalid")
  const actorKind = (value.actor as { readonly kind?: unknown }).kind
  assertExactKeys(value.actor, actorKind === "registrar" ? ["kind", "replicaId"] : ["kind", "memberId", "adminCapabilityDigest"], "registration abandonment actor")
  const actor = value.actor.kind === "registrar"
    ? Object.freeze({ kind: "registrar" as const, replicaId: parseReplicaId(value.actor.replicaId) })
    : value.actor.kind === "project-admin"
      ? Object.freeze({ kind: "project-admin" as const, memberId: parseMemberId(value.actor.memberId), adminCapabilityDigest: parseDigest(value.actor.adminCapabilityDigest) })
      : invalid("Registration abandonment actor is invalid")
  return Object.freeze({ format: value.format, registrationClaimDigest: parseDigest(value.registrationClaimDigest), scope: parseDocumentScope(value.scope), claimRevision: parseUint64(value.claimRevision), actor, reason: value.reason, protocolDigest: protocolDigest(value.protocolDigest) })
}

export function parseDocumentRegistrationAbandonment(value: unknown): DocumentRegistrationAbandonment {
  return closeReplica(value, "convax.document-registration-abandonment", parseDocumentRegistrationAbandonmentCore, registrationAbandonmentCoreDigest, "actorSignature")
}

export function parseCollaborationScopeEntryCore(value: unknown): CollaborationScopeEntryCore {
  assertExactKeys(value, ["format", "scopeKey", "registrarReplicaId", "claimRevision", "registrationClaimDigest", "state", "projectIndexContentCertificateDigest", "canvasGenesisContentCertificateDigest", "genesisPrunableSetDigest", "abandonmentDigest"], "CollaborationScopeEntryCore")
  if (value.format !== "convax.collaboration-scope-entry-core" || (value.state !== "registered-candidate" && value.state !== "dual-validated" && value.state !== "abandoned")) invalid("Collaboration scope entry discriminators are invalid")
  assertBoundedNfcString(value.scopeKey, 1, 1_024, "Collaboration scope key")
  const optional = (input: unknown) => input === null ? null : parseDigest(input)
  const core = Object.freeze({ format: value.format, scopeKey: value.scopeKey, registrarReplicaId: parseReplicaId(value.registrarReplicaId), claimRevision: parseUint64(value.claimRevision), registrationClaimDigest: parseDigest(value.registrationClaimDigest), state: value.state, projectIndexContentCertificateDigest: optional(value.projectIndexContentCertificateDigest), canvasGenesisContentCertificateDigest: optional(value.canvasGenesisContentCertificateDigest), genesisPrunableSetDigest: optional(value.genesisPrunableSetDigest), abandonmentDigest: optional(value.abandonmentDigest) })
  if (core.state === "registered-candidate" && (core.projectIndexContentCertificateDigest !== null || core.canvasGenesisContentCertificateDigest !== null || core.genesisPrunableSetDigest !== null || core.abandonmentDigest !== null)) invalid("Candidate registry entry has terminal evidence")
  if (core.state === "abandoned" && (core.abandonmentDigest === null || core.projectIndexContentCertificateDigest !== null || core.canvasGenesisContentCertificateDigest !== null || core.genesisPrunableSetDigest !== null)) invalid("Abandoned registry entry evidence is invalid")
  if (core.state === "dual-validated" && (core.projectIndexContentCertificateDigest === null || core.canvasGenesisContentCertificateDigest === null || core.genesisPrunableSetDigest === null || core.abandonmentDigest !== null)) invalid("Dual-validated registry entry evidence is incomplete")
  return core
}

export function parseCollaborationScopeEntry(value: unknown): CollaborationScopeEntry {
  assertExactKeys(value, ["format", "core", "coreDigest"], "CollaborationScopeEntry")
  if (value.format !== "convax.collaboration-scope-entry") invalid("Collaboration scope entry wrapper is invalid")
  const core = parseCollaborationScopeEntryCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== collaborationScopeEntryCoreDigest(core)) invalid("Collaboration scope entry digest mismatch")
  return Object.freeze({ format: value.format, core, coreDigest })
}

export function parseRegistryEntrySet(value: unknown): RegistryEntrySet {
  assertExactKeys(value, ["format", "entries"], "RegistryEntrySet")
  if (value.format !== "convax.registry-entry-set") invalid("Registry entry-set format is invalid")
  assertDenseArray(value.entries, "Registry entries")
  if (value.entries.length > MAX_REGISTRY_ENTRIES) invalid("Registry entry-set exceeds capacity")
  const entries = Object.freeze(value.entries.map(parseCollaborationScopeEntry))
  assertEntryOrder(entries.map((entry) => Object.freeze({ scopeKey: entry.core.scopeKey, registrarReplicaId: entry.core.registrarReplicaId, claimRevision: entry.core.claimRevision })), "Registry entries")
  return Object.freeze({ format: value.format, entries })
}

export function parseRegistrySnapshotCore(value: unknown): RegistrySnapshotCore {
  assertExactKeys(value, ["format", "projectId", "projectEpoch", "registrySequence", "priorRegistryDigest", "entriesDigest", "entryCount", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "RegistrySnapshotCore")
  if (value.format !== "convax.registry-snapshot-core" || value.serviceKeyPurpose !== "registry-cutoff") invalid("Registry snapshot discriminators are invalid")
  assertBoundedNfcString(value.serviceKeyId, 1, 128, "Registry service key id")
  return Object.freeze({ format: value.format, projectId: parseProjectId(value.projectId), projectEpoch: parseId128(value.projectEpoch), registrySequence: parseUint64(value.registrySequence), priorRegistryDigest: value.priorRegistryDigest === null ? null : parseDigest(value.priorRegistryDigest), entriesDigest: parseDigest(value.entriesDigest), entryCount: parseUint32(value.entryCount), protocolDigest: protocolDigest(value.protocolDigest), trustBundleDigest: parseDigest(value.trustBundleDigest), serviceKeyPurpose: value.serviceKeyPurpose, serviceKeyId: value.serviceKeyId })
}

export function parseRegistrySnapshot(value: unknown): RegistrySnapshot {
  return closeService(value, "convax.registry-snapshot", parseRegistrySnapshotCore, registrySnapshotCoreDigest)
}

export function parseRegistryCutoffTarget(value: unknown): RegistryCutoffTarget {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Cutoff target must be an object")
  if ((value as { kind?: unknown }).kind === "replica") {
    assertExactKeys(value, ["kind", "action", "memberId", "priorMemberAuthorizationEpoch", "replicaId", "actorId", "priorReplicaAuthorizationEpoch"], "replica cutoff target")
    if (value.action !== "revoke") invalid("Replica cutoff action is invalid")
    return Object.freeze({ kind: "replica", action: "revoke", memberId: parseMemberId(value.memberId), priorMemberAuthorizationEpoch: parseId128(value.priorMemberAuthorizationEpoch), replicaId: parseReplicaId(value.replicaId), actorId: parseActorId(value.actorId), priorReplicaAuthorizationEpoch: parseId128(value.priorReplicaAuthorizationEpoch) })
  }
  assertExactKeys(value, ["kind", "action", "memberId", "priorMemberAuthorizationEpoch", "targetedReplicaActorSet"], "member cutoff target")
  if (value.kind !== "member" || (value.action !== "revoke" && value.action !== "downgrade-to-viewer")) invalid("Member cutoff target is invalid")
  assertDenseArray(value.targetedReplicaActorSet, "Targeted replica actor set")
  if (value.targetedReplicaActorSet.length > MAX_TARGET_REPLICAS) invalid("Targeted replica actor set exceeds capacity")
  const targetedReplicaActorSet = Object.freeze(value.targetedReplicaActorSet.map((entry) => {
    assertExactKeys(entry, ["replicaId", "actorId", "priorReplicaAuthorizationEpoch"], "targeted replica actor")
    return Object.freeze({ replicaId: parseReplicaId(entry.replicaId), actorId: parseActorId(entry.actorId), priorReplicaAuthorizationEpoch: parseId128(entry.priorReplicaAuthorizationEpoch) })
  }))
  assertStrictDecodedReplicaOrder(targetedReplicaActorSet.map((entry) => entry.replicaId), "Targeted replica actor set")
  return Object.freeze({ kind: "member", action: value.action, memberId: parseMemberId(value.memberId), priorMemberAuthorizationEpoch: parseId128(value.priorMemberAuthorizationEpoch), targetedReplicaActorSet })
}

export function parseRegistryEntryIdentity(value: unknown): RegistryEntryIdentity {
  assertExactKeys(value, ["format", "scopeKey", "registrarReplicaId", "claimRevision"], "RegistryEntryIdentity")
  if (value.format !== "convax.registry-entry-identity") invalid("Registry entry identity format is invalid")
  assertBoundedNfcString(value.scopeKey, 1, 1_024, "Registry identity scope key")
  return Object.freeze({ format: value.format, scopeKey: value.scopeKey, registrarReplicaId: parseReplicaId(value.registrarReplicaId), claimRevision: parseUint64(value.claimRevision) })
}

export function parseRegistryCutoffCoveragePageCore(value: unknown): RegistryCutoffCoveragePageCore {
  assertExactKeys(value, ["format", "cutoffId", "pageIndex", "firstLeafIdentityDigest", "lastLeafIdentityDigest", "leaves"], "RegistryCutoffCoveragePageCore")
  if (value.format !== "convax.registry-cutoff-coverage-page-core") invalid("Cutoff page format is invalid")
  assertDenseArray(value.leaves, "Cutoff leaves")
  if (value.leaves.length === 0 || value.leaves.length > MAX_CUTOFF_LEAVES_PER_PAGE) invalid("Cutoff page leaf count is invalid")
  const leaves = Object.freeze(value.leaves.map(parseCutoffLeaf))
  assertEntryOrder(leaves.map((leaf) => leaf.entryIdentity), "Cutoff leaves")
  const first = registryEntryIdentityDigest(leaves[0]!.entryIdentity)
  const last = registryEntryIdentityDigest(leaves.at(-1)!.entryIdentity)
  if (parseDigest(value.firstLeafIdentityDigest) !== first || parseDigest(value.lastLeafIdentityDigest) !== last) invalid("Cutoff page range digests mismatch")
  return Object.freeze({ format: value.format, cutoffId: parseId128(value.cutoffId), pageIndex: parseUint32(value.pageIndex), firstLeafIdentityDigest: first, lastLeafIdentityDigest: last, leaves })
}

export function parseRegistryCutoffCoveragePage(value: unknown): RegistryCutoffCoveragePage {
  assertExactKeys(value, ["format", "core", "coreDigest"], "RegistryCutoffCoveragePage")
  if (value.format !== "convax.registry-cutoff-coverage-page") invalid("Cutoff page wrapper format is invalid")
  const core = parseRegistryCutoffCoveragePageCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== registryCutoffCoveragePageCoreDigest(core)) invalid("Cutoff page digest mismatch")
  return Object.freeze({ format: value.format, core, coreDigest })
}

export function parseRegistryCutoffCoverageRootCore(value: unknown): RegistryCutoffCoverageRootCore {
  assertExactKeys(value, ["format", "projectId", "projectEpoch", "cutoffId", "target", "beforeMembershipSnapshotDigest", "afterMembershipSnapshotDigest", "registrySequence", "registryRootDigest", "unlistedScopePolicy", "pageDigests", "leafCount", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "RegistryCutoffCoverageRootCore")
  if (value.format !== "convax.registry-cutoff-coverage-root-core" || value.unlistedScopePolicy !== "empty-target-frontier" || value.serviceKeyPurpose !== "registry-cutoff") invalid("Cutoff root discriminators are invalid")
  assertBoundedNfcString(value.serviceKeyId, 1, 128, "Cutoff root service key id")
  return Object.freeze({ format: value.format, projectId: parseProjectId(value.projectId), projectEpoch: parseId128(value.projectEpoch), cutoffId: parseId128(value.cutoffId), target: parseRegistryCutoffTarget(value.target), beforeMembershipSnapshotDigest: parseDigest(value.beforeMembershipSnapshotDigest), afterMembershipSnapshotDigest: parseDigest(value.afterMembershipSnapshotDigest), registrySequence: parseUint64(value.registrySequence), registryRootDigest: parseDigest(value.registryRootDigest), unlistedScopePolicy: value.unlistedScopePolicy, pageDigests: digestList(value.pageDigests, 0, MAX_CUTOFF_PAGES, "Cutoff pages", false), leafCount: parseUint32(value.leafCount), protocolDigest: protocolDigest(value.protocolDigest), trustBundleDigest: parseDigest(value.trustBundleDigest), serviceKeyPurpose: value.serviceKeyPurpose, serviceKeyId: value.serviceKeyId })
}

export function parseRegistryCutoffCoverageRoot(value: unknown): RegistryCutoffCoverageRoot {
  return closeService(value, "convax.registry-cutoff-coverage-root", parseRegistryCutoffCoverageRootCore, registryCutoffCoverageRootCoreDigest)
}

export function parseAuthorizationMutationCore(value: unknown): AuthorizationMutationCore {
  assertExactKeys(value, ["format", "mutationId", "projectId", "projectEpoch", "membershipEpoch", "target", "beforeMembershipSnapshotDigest", "afterMembershipSnapshotDigest", "registryCutoffCoverageRootCoreDigest", "closedSessionCredentialDigests", "protocolDigest", "trustBundleDigest", "serviceKeyPurpose", "serviceKeyId"], "AuthorizationMutationCore")
  if (value.format !== "convax.authorization-mutation-core" || value.serviceKeyPurpose !== "registry-cutoff") invalid("Authorization mutation discriminators are invalid")
  assertBoundedNfcString(value.serviceKeyId, 1, 128, "Authorization mutation service key id")
  return Object.freeze({ format: value.format, mutationId: parseId128(value.mutationId), projectId: parseProjectId(value.projectId), projectEpoch: parseId128(value.projectEpoch), membershipEpoch: parseId128(value.membershipEpoch), target: parseRegistryCutoffTarget(value.target), beforeMembershipSnapshotDigest: parseDigest(value.beforeMembershipSnapshotDigest), afterMembershipSnapshotDigest: parseDigest(value.afterMembershipSnapshotDigest), registryCutoffCoverageRootCoreDigest: parseDigest(value.registryCutoffCoverageRootCoreDigest), closedSessionCredentialDigests: digestList(value.closedSessionCredentialDigests, 0, MAX_CLOSED_SESSIONS, "Closed session credentials", true), protocolDigest: protocolDigest(value.protocolDigest), trustBundleDigest: parseDigest(value.trustBundleDigest), serviceKeyPurpose: value.serviceKeyPurpose, serviceKeyId: value.serviceKeyId })
}

export function parseAuthorizationMutation(value: unknown): AuthorizationMutation {
  return closeService(value, "convax.authorization-mutation", parseAuthorizationMutationCore, authorizationMutationCoreDigest)
}

function parseProjectFloorEntry(value: unknown): ReplicaProjectFloorEntry {
  assertExactKeys(value, ["scope", "basis", "prunableCheckpointSetCertificateDigest", "replicaCausalFloorAckDigest"], "ReplicaProjectFloorEntry")
  const scope = parseDocumentScope(value.scope)
  if (value.basis !== "project-index" && value.basis !== "project-index-live-route") invalid("Project floor entry basis is invalid")
  if ((scope.docKind === "project-index") !== (value.basis === "project-index")) invalid("Project floor basis does not match scope kind")
  return Object.freeze({ scope, basis: value.basis, prunableCheckpointSetCertificateDigest: parseDigest(value.prunableCheckpointSetCertificateDigest), replicaCausalFloorAckDigest: parseDigest(value.replicaCausalFloorAckDigest) })
}

function parseCutoffLeaf(value: unknown): TargetCutoffLeafCore {
  assertExactKeys(value, ["format", "entryIdentity", "entryDigest", "entryState", "targetFrontier"], "TargetCutoffLeafCore")
  if (value.format !== "convax.target-cutoff-leaf-core" || (value.entryState !== "registered-candidate" && value.entryState !== "dual-validated" && value.entryState !== "abandoned")) invalid("Cutoff leaf discriminators are invalid")
  const frontierKind = (value.targetFrontier as { readonly kind?: unknown }).kind
  assertExactKeys(value.targetFrontier, frontierKind === "certified" ? ["kind", "frontierDigest"] : ["kind"], "Cutoff target frontier")
  const targetFrontier = value.targetFrontier.kind === "certified"
    ? Object.freeze({ kind: "certified" as const, frontierDigest: parseDigest(value.targetFrontier.frontierDigest) })
    : value.targetFrontier.kind === "empty-target-frontier"
      ? Object.freeze({ kind: "empty-target-frontier" as const })
      : invalid("Cutoff target frontier is invalid")
  if ((value.entryState === "dual-validated") !== (targetFrontier.kind === "certified")) invalid("Cutoff target frontier does not match entry state")
  return Object.freeze({ format: value.format, entryIdentity: parseRegistryEntryIdentity(value.entryIdentity), entryDigest: parseDigest(value.entryDigest), entryState: value.entryState, targetFrontier })
}

function closeService<Core, Result>(value: unknown, format: string, parseCore: (value: unknown) => Core, digest: (core: Core) => Digest): Result {
  assertExactKeys(value, ["format", "core", "coreDigest", "serviceSignature"], format)
  if (value.format !== format) invalid(`${format} wrapper format is invalid`)
  const core = parseCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== digest(core)) invalid(`${format} digest mismatch`)
  return Object.freeze({ format, core, coreDigest, serviceSignature: parseSignature(value.serviceSignature) }) as Result
}

function closeReplica<Core, Result>(value: unknown, format: string, parseCore: (value: unknown) => Core, digest: (core: Core) => Digest, signatureKey: "replicaSignature" | "actorSignature"): Result {
  assertExactKeys(value, ["format", "core", "coreDigest", signatureKey], format)
  if (value.format !== format) invalid(`${format} wrapper format is invalid`)
  const core = parseCore(value.core)
  const coreDigest = parseDigest(value.coreDigest)
  if (coreDigest !== digest(core)) invalid(`${format} digest mismatch`)
  return Object.freeze({ format, core, coreDigest, [signatureKey]: parseSignature(value[signatureKey]) }) as Result
}

function digestList(value: unknown, minimum: number, maximum: number, label: string, sort: boolean): readonly Digest[] {
  assertDenseArray(value, label)
  if (value.length < minimum || value.length > maximum) invalid(`${label} count is invalid`)
  const values = value.map(parseDigest)
  if (sort) assertStrictOrder(values, label)
  else if (new Set(values).size !== values.length) invalid(`${label} must be unique`)
  return Object.freeze(values)
}

function protocolDigest(value: unknown): Digest {
  const parsed = parseDigest(value)
  if (parsed !== PROJECT_CONTROL_PROTOCOL_KERNEL_INTEGRATION.requiredProtocolDigest) invalid("Protocol digest is not the current protocol digest")
  return parsed
}

function scopeKey(scope: DocumentScope): string {
  return encodeRestrictedJcsText(scope)
}

function assertScopeOrder(scopes: readonly DocumentScope[], label: string): void {
  assertStrictOrder(scopes.map(scopeKey), label)
}

function assertStrictOrder(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) if (compareUtf8(values[index - 1]!, values[index]!) >= 0) invalid(`${label} must be strictly sorted and unique`)
}

function assertEntryOrder(values: readonly Readonly<{ scopeKey: string; registrarReplicaId: string; claimRevision: string }>[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    const left = values[index - 1]!
    const right = values[index]!
    const comparison = compareUtf8(left.scopeKey, right.scopeKey) || compareUtf8(left.registrarReplicaId, right.registrarReplicaId) || (BigInt(left.claimRevision) < BigInt(right.claimRevision) ? -1 : BigInt(left.claimRevision) > BigInt(right.claimRevision) ? 1 : 0)
    if (comparison >= 0) invalid(`${label} must be strictly sorted and unique`)
  }
}

function assertStrictDecodedReplicaOrder(values: readonly string[], label: string): void {
  // ReplicaId is fixed-width lower-hex, so UTF-8 order is its decoded numeric order.
  assertStrictOrder(values, label)
}

function invalid(message: string): never {
  throw new TypeError(message)
}
