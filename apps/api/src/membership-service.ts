import {
  compareDecodedBase64urlV2,
  encodeBase64urlV2,
  incrementUint64V2,
  parseActorIdV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSignatureV2,
  parseUint32V2,
  parseUint64V2,
  structuredDigestV2,
  uint64ToBigIntV2,
  type DigestV2,
  type Id128V2,
  type MemberIdV2,
  type ProjectIdV2,
  type PublicKeyV2,
  type ReplicaIdV2,
  type SignatureV2,
  type Uint64V2,
} from "@convax/collaboration"
import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2,
  membershipMutationProofCoreDigestV2,
  authorizationMutationCoreDigestV2,
  parseEmptyProjectIndexGenesisAttestationV2,
  parseProjectResetApprovalV2,
  parseProjectResetConfirmationV2,
  parseRegistryCutoffCoveragePageV2,
  registryCutoffCoverageRootCoreDigestV2,
  parseMembershipMutationProofV2,
  parseReplicaIdReservationRequestV2,
  parseTeamEpochRolloverProofV2,
  registryEntrySetDigestV2,
  registrySnapshotCoreDigestV2,
  teamEpochRolloverChallengeCoreDigestV2,
  teamEpochRolloverReceiptCoreDigestV2,
  type CollaborationRoleV2,
  type MemberCredentialCoreV2,
  type MemberCredentialV2,
  type MembershipMemberV2,
  type MembershipMutationProofV2,
  type MembershipReplicaV2,
  type MembershipSnapshotCoreV2,
  type MembershipSnapshotV2,
  type MutationChallengeCoreV2,
  type MutationChallengeV2,
  type MutationReceiptCoreV2,
  type MutationReceiptV2,
  type ProjectAdminCapabilityCoreV2,
  type ProjectAdminCapabilityV2,
  type ReplicaActorCredentialCoreV2,
  type ReplicaActorCredentialV2,
  type ReplicaEditAuthorizationCoreV2,
  type ReplicaEditAuthorizationV2,
  type ReplicaIdReservationReceiptCoreV2,
  type ReplicaIdReservationReceiptV2,
  type ReplicaIdReservationRequestV2,
  type AuthorizationMutationCoreV2,
  type AuthorizationMutationV2,
  type RegistryCutoffCoveragePageV2,
  type RegistryCutoffCoverageRootCoreV2,
  type RegistryCutoffCoverageRootV2,
  type RegistryCutoffTargetV2,
  type EmptyProjectIndexGenesisAttestationV2,
  type ProjectResetApprovalV2,
  type ProjectResetConfirmationV2,
  type RegistrySnapshotCoreV2,
  type RegistrySnapshotV2,
  type TeamEpochRolloverChallengeCoreV2,
  type TeamEpochRolloverChallengeV2,
  type TeamEpochRolloverReceiptCoreV2,
  type TeamEpochRolloverReceiptV2,
} from "@convax/project/collaboration-protocol"

import type { AtomicControlStateStore, AtomicControlStateTransaction, ControlClock, ControlRandomSource } from "./contracts"
import {
  CollaborationControlServiceErrorV2,
  type CollaborationControlProjectStateV2,
  type CollaborationMemberSeedV2,
  type CollaborationProjectSeedV2,
  type CollaborationReplicaSeedV2,
  type ControlDigestSignaturePortV2,
} from "./rendezvous-service"

const CHALLENGE_TTL_MS = 60_000n
const RESERVATION_TTL_MS = 60_000n
const MAX_PENDING_RESERVATIONS_PER_MEMBER = 4
const MAX_PENDING_RESERVATIONS_PER_PROJECT = 512
const MAX_ALLOCATIONS_PER_MEMBER = 64
const MAX_ALLOCATIONS_PER_PROJECT = 16_384
const MAX_PENDING_MUTATION_CHALLENGES_PER_MEMBER = 4
const MAX_PENDING_PROJECT_RESET_CHALLENGES = 2

export interface TeamControlProtocolConfigurationV2 {
  readonly registrySequence: Uint64V2
  readonly registryRootDigest: DigestV2
  readonly schemaDigest: DigestV2
  readonly validationArtifactSetDigest: DigestV2
  readonly uriProtocolDigest: DigestV2
  readonly trustBundleDigest: DigestV2
}

export interface ProjectBootstrapAuthorizationRequestV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly projectIndexShardEpoch: Id128V2
  readonly initializationAuthorityDigest: DigestV2
  readonly initialProjectIndexCheckpointDigest: DigestV2
  readonly initialProjectIndexFullUpdateDigest: DigestV2
  readonly initialProjectIndexStateVectorDigest: DigestV2
  readonly initialProjectIndexCanonicalStateDigest: DigestV2
  readonly ownerMemberId: MemberIdV2
  readonly ownerMemberSigningPublicKey: PublicKeyV2
  readonly evidence: unknown
}

declare const projectBootstrapAuthorizationBrandV2: unique symbol
export interface ProjectBootstrapAuthorizationV2 {
  readonly [projectBootstrapAuthorizationBrandV2]: true
}

const liveBootstrapAuthorizations = new WeakMap<object, Readonly<Omit<ProjectBootstrapAuthorizationRequestV2, "evidence">>>()

export function createProjectBootstrapAuthorizationFactoryV2(verifier: {
  verify(input: ProjectBootstrapAuthorizationRequestV2): Promise<boolean>
}): { authorize(input: ProjectBootstrapAuthorizationRequestV2): Promise<ProjectBootstrapAuthorizationV2 | "rejected"> } {
  return Object.freeze({
    async authorize(input) {
      const normalized = Object.freeze({
        projectId: parseProjectIdV2(input.projectId),
        projectEpoch: parseId128V2(input.projectEpoch),
        projectIndexShardEpoch: parseId128V2(input.projectIndexShardEpoch),
        initializationAuthorityDigest: parseDigestV2(input.initializationAuthorityDigest),
        initialProjectIndexCheckpointDigest: parseDigestV2(input.initialProjectIndexCheckpointDigest),
        initialProjectIndexFullUpdateDigest: parseDigestV2(input.initialProjectIndexFullUpdateDigest),
        initialProjectIndexStateVectorDigest: parseDigestV2(input.initialProjectIndexStateVectorDigest),
        initialProjectIndexCanonicalStateDigest: parseDigestV2(input.initialProjectIndexCanonicalStateDigest),
        ownerMemberId: parseMemberIdV2(input.ownerMemberId),
        ownerMemberSigningPublicKey: parsePublicKeyV2(input.ownerMemberSigningPublicKey),
      })
      if (!await verifier.verify({ ...normalized, evidence: input.evidence })) return "rejected"
      const capability = Object.freeze({}) as ProjectBootstrapAuthorizationV2
      liveBootstrapAuthorizations.set(capability, normalized)
      return capability
    },
  })
}

export interface TeamBootstrapResultV2 {
  readonly membershipSnapshot: MembershipSnapshotV2
  readonly ownerCredential: MemberCredentialV2
  readonly ownerAdminCapability: ProjectAdminCapabilityV2
  readonly invitation: TeamInvitationV1
  readonly initialization: ProjectBootstrapInitializationV2
}

export interface ProjectBootstrapInitializationV2 {
  readonly projectId: ProjectIdV2
  readonly projectEpoch: Id128V2
  readonly projectIndexShardEpoch: Id128V2
  readonly initializationAuthorityDigest: DigestV2
  readonly initialProjectIndexCheckpointDigest: DigestV2
  readonly initialProjectIndexFullUpdateDigest: DigestV2
  readonly initialProjectIndexStateVectorDigest: DigestV2
  readonly initialProjectIndexCanonicalStateDigest: DigestV2
}

export interface MemberAddChallengeIntentV2 {
  readonly purpose: "member-add"
  readonly mutationId: Id128V2
  readonly requesterCredentialDigest: DigestV2
  readonly adminCapabilityDigest: DigestV2
  readonly targetMemberId: MemberIdV2
  readonly targetMemberSigningPublicKey: PublicKeyV2
  readonly initialRole: CollaborationRoleV2
  readonly invitationToken?: string
}

export interface ReplicaEnrollChallengeIntentV2 {
  readonly purpose: "replica-enroll"
  readonly mutationId: Id128V2
  readonly requesterCredentialDigest: DigestV2
  readonly replicaIdReservationReceiptDigest: DigestV2
}

export interface ReplicaActivateEditorChallengeIntentV2 {
  readonly purpose: "replica-activate-editor"
  readonly mutationId: Id128V2
  readonly requesterCredentialDigest: DigestV2
  readonly currentReplicaId: ReplicaIdV2
  readonly installedFloorSetDigest: DigestV2
}

export type SupportedMutationChallengeIntentV2 =
  | MemberAddChallengeIntentV2
  | ReplicaEnrollChallengeIntentV2
  | ReplicaActivateEditorChallengeIntentV2

export type CutoffMutationPurposeV2 = "replica-rotate" | "replica-revoke" | "member-role-change" | "member-revoke"

export type CutoffMutationChallengeIntentV2 =
  | Readonly<{
      purpose: "replica-rotate"
      mutationId: Id128V2
      cutoffId: Id128V2
      requesterCredentialDigest: DigestV2
      currentReplicaId: ReplicaIdV2
      replicaIdReservationReceiptDigest: DigestV2
      pages: readonly RegistryCutoffCoveragePageV2[]
    }>
  | Readonly<{
      purpose: "replica-revoke"
      mutationId: Id128V2
      cutoffId: Id128V2
      requesterCredentialDigest: DigestV2
      currentReplicaId: ReplicaIdV2
      pages: readonly RegistryCutoffCoveragePageV2[]
    }>
  | Readonly<{
      purpose: "member-role-change"
      mutationId: Id128V2
      cutoffId: Id128V2
      requesterCredentialDigest: DigestV2
      adminCapabilityDigest: DigestV2
      targetMemberId: MemberIdV2
      nextRole: "viewer"
      pages: readonly RegistryCutoffCoveragePageV2[]
    }>
  | Readonly<{
      purpose: "member-revoke"
      mutationId: Id128V2
      cutoffId: Id128V2
      requesterCredentialDigest: DigestV2
      adminCapabilityDigest: DigestV2
      targetMemberId: MemberIdV2
      pages: readonly RegistryCutoffCoveragePageV2[]
    }>

interface ReservationStateRecordV2 {
  readonly request: ReplicaIdReservationRequestV2
  readonly receipt: ReplicaIdReservationReceiptV2
  readonly state: "reserved" | "consumed" | "abandoned"
  readonly consumedMutationId: Id128V2 | null
  readonly consumedMutationReceiptCoreDigest: DigestV2 | null
  readonly abandonmentReason: "expired" | "membership-stale" | "explicit-cancel" | "project-reset" | null
}

interface MutationChallengeStateRecordV2 {
  readonly challenge: MutationChallengeV2
  readonly preparedAfterCore: MembershipSnapshotCoreV2
  readonly intent: SupportedMutationChallengeIntentV2
  readonly consumedRequestDigest: DigestV2 | null
  readonly invitationToken: string | null
}

interface CutoffChallengeStateRecordV2 {
  readonly challenge: MutationChallengeV2
  readonly intent: CutoffMutationChallengeIntentV2
  readonly preparedAfterCore: MembershipSnapshotCoreV2
  readonly preparedPages: readonly RegistryCutoffCoveragePageV2[]
  readonly preparedRootCore: RegistryCutoffCoverageRootCoreV2
  readonly consumedRequestDigest: DigestV2 | null
}

interface MemberAddSignatureHalvesV2 {
  readonly invitationToken: string
  readonly challengeDigest: DigestV2
  readonly requestDigest: DigestV2
  readonly adminSignature: SignatureV2 | null
  readonly targetMemberPossessionSignature: SignatureV2 | null
}

interface TeamEpochRolloverChallengeRecordV2 {
  readonly challenge: TeamEpochRolloverChallengeV2
  readonly confirmation: ProjectResetConfirmationV2
  readonly approval: ProjectResetApprovalV2
  readonly preparedMembershipSnapshotCore: MembershipSnapshotCoreV2
  readonly preparedEmptyRegistrySnapshotCore: RegistrySnapshotCoreV2
  readonly consumedRequestDigest: DigestV2 | null
}

export interface TeamEpochRolloverResultV2 {
  readonly receipt: TeamEpochRolloverReceiptV2
  readonly membershipSnapshot: MembershipSnapshotV2
  readonly requesterCredential: MemberCredentialV2
  readonly requesterAdminCapability: ProjectAdminCapabilityV2
  readonly emptyRegistrySnapshot: RegistrySnapshotV2
}

interface TeamEpochRolloverResultRecordV2 {
  readonly resetId: Id128V2
  readonly requestDigest: DigestV2
  readonly result: TeamEpochRolloverResultV2
}

declare const emptyGenesisAttestationAdmissionBrandV2: unique symbol
export interface EmptyProjectIndexGenesisAttestationAdmissionV2 { readonly [emptyGenesisAttestationAdmissionBrandV2]: true }
const liveEmptyGenesisAdmissionsV2 = new WeakMap<object, DigestV2>()

export function createEmptyProjectIndexGenesisAttestationAdmissionFactoryV2(verifier: {
  verify(input: { readonly attestation: EmptyProjectIndexGenesisAttestationV2; readonly evidence: unknown }): Promise<boolean>
}): { authorize(input: { readonly attestation: EmptyProjectIndexGenesisAttestationV2; readonly evidence: unknown }): Promise<EmptyProjectIndexGenesisAttestationAdmissionV2 | "rejected"> } {
  return Object.freeze({
    async authorize(input) {
      const attestation = parseEmptyProjectIndexGenesisAttestationV2(input.attestation)
      if (!await verifier.verify({ attestation, evidence: input.evidence })) return "rejected"
      const capability = Object.freeze({}) as EmptyProjectIndexGenesisAttestationAdmissionV2
      liveEmptyGenesisAdmissionsV2.set(capability, attestation.coreDigest)
      return capability
    },
  })
}

export interface TeamInvitationV1 {
  readonly invitationToken: string
  readonly projectId: ProjectIdV2
  readonly initialRole: CollaborationRoleV2
  readonly expiresAtUnixMs: Uint64V2
}

interface TeamInvitationStateV1 extends TeamInvitationV1 {
  readonly requesterCredentialDigest: DigestV2
  readonly adminCapabilityDigest: DigestV2
  readonly state: "open" | "prepared" | "revoked" | "consumed"
  readonly challengeDigest: DigestV2 | null
  readonly requestDigest: DigestV2 | null
}

export interface PreparedTeamInvitationV1 {
  readonly invitation: TeamInvitationV1
  readonly challenge: MutationChallengeV2
  readonly proofCore: Extract<MembershipMutationProofV2["core"], { readonly purpose: "member-add" }>
  readonly requestDigest: DigestV2
}

export type MemberAddSignatureHalfKindV1 = "admin" | "target-possession"

export type MemberAddSignatureHalfResultV1 =
  | Readonly<{ status: "pending-other-signature"; requestDigest: DigestV2 }>
  | Readonly<{ status: "committed"; requestDigest: DigestV2; result: MembershipMutationResultV2 }>

declare const invitationAuthorizationBrandV1: unique symbol
export interface TeamInvitationAuthorizationV1 { readonly [invitationAuthorizationBrandV1]: true }
export interface TeamInvitationAuthorizationRequestV1 {
  readonly action: "create" | "revoke" | "list-member-add"
  readonly projectId: ProjectIdV2
  readonly requesterCredentialDigest: DigestV2
  readonly invitationToken: string | null
  readonly evidence: unknown
}
const liveInvitationAuthorizations = new WeakMap<object, Readonly<Omit<TeamInvitationAuthorizationRequestV1, "evidence">>>()

export function createTeamInvitationAuthorizationFactoryV1(verifier: { verify(input: TeamInvitationAuthorizationRequestV1): Promise<boolean> }): {
  authorize(input: TeamInvitationAuthorizationRequestV1): Promise<TeamInvitationAuthorizationV1 | "rejected">
} {
  return Object.freeze({
    async authorize(input) {
      const normalized = Object.freeze({ action: input.action, projectId: parseProjectIdV2(input.projectId), requesterCredentialDigest: parseDigestV2(input.requesterCredentialDigest), invitationToken: input.invitationToken === null ? null : parseInvitationToken(input.invitationToken) })
      if (!await verifier.verify({ ...normalized, evidence: input.evidence })) return "rejected"
      const capability = Object.freeze({}) as TeamInvitationAuthorizationV1
      liveInvitationAuthorizations.set(capability, normalized)
      return capability
    },
  })
}

export interface MembershipMutationResultV2 {
  readonly receipt: MutationReceiptV2
  readonly membershipSnapshot: MembershipSnapshotV2
  readonly requesterCredential: MemberCredentialV2
  readonly requesterAdminCapability: ProjectAdminCapabilityV2 | null
  readonly targetMemberCredential: MemberCredentialV2
  readonly replicaActorCredential: ReplicaActorCredentialV2 | null
  readonly replicaEditAuthorization: ReplicaEditAuthorizationV2 | null
}

export interface OwnerMemberAddInvitationProjectionV1 {
  readonly invitation: TeamInvitationV1
  readonly status: "open" | "prepared" | "consumed" | "revoked" | "expired"
  readonly challenge: MutationChallengeV2 | null
  readonly proofCore: Extract<MembershipMutationProofV2["core"], { readonly purpose: "member-add" }> | null
  readonly requestDigest: DigestV2 | null
}

interface MutationResultRecordV2 {
  readonly mutationId: Id128V2
  readonly requestDigest: DigestV2
  readonly result: MembershipMutationResultV2
}

export interface CutoffMembershipMutationResultV2 {
  readonly receipt: MutationReceiptV2
  readonly membershipSnapshot: MembershipSnapshotV2
  readonly requesterCredential: MemberCredentialV2
  readonly requesterAdminCapability: ProjectAdminCapabilityV2 | null
  readonly targetMemberCredential: MemberCredentialV2 | null
  readonly coverageRoot: RegistryCutoffCoverageRootV2
  readonly authorizationMutation: AuthorizationMutationV2
  readonly replicaActorCredential: ReplicaActorCredentialV2 | null
  readonly replicaEditAuthorization: ReplicaEditAuthorizationV2 | null
}

interface CutoffMutationResultRecordV2 {
  readonly mutationId: Id128V2
  readonly requestDigest: DigestV2
  readonly result: CutoffMembershipMutationResultV2
}

export interface CollaborationTeamAuthorityStateV2 {
  readonly format: "convax.team-authority-state/2"
  readonly bootstrapInitialization: ProjectBootstrapInitializationV2
  readonly currentSnapshot: MembershipSnapshotV2
  readonly snapshots: readonly MembershipSnapshotV2[]
  readonly memberCredentials: readonly MemberCredentialV2[]
  readonly adminCapabilities: readonly ProjectAdminCapabilityV2[]
  readonly actorCredentials: readonly ReplicaActorCredentialV2[]
  readonly editAuthorizations: readonly ReplicaEditAuthorizationV2[]
  readonly reservations: readonly ReservationStateRecordV2[]
  readonly mutationChallenges: readonly MutationChallengeStateRecordV2[]
  readonly mutationResults: readonly MutationResultRecordV2[]
  readonly cutoffChallenges: readonly CutoffChallengeStateRecordV2[]
  readonly cutoffResults: readonly CutoffMutationResultRecordV2[]
  readonly memberAddSignatureHalves: readonly MemberAddSignatureHalvesV2[]
  readonly projectResetCounter: Uint64V2
  readonly rolloverChallenges: readonly TeamEpochRolloverChallengeRecordV2[]
  readonly rolloverResults: readonly TeamEpochRolloverResultRecordV2[]
  readonly lastAllocatedReplicaId: ReplicaIdV2 | null
  readonly invitations: readonly TeamInvitationStateV1[]
}

export interface EditorFloorAuthorizationPortV2 {
  verifyInstalledCurrentFloor(input: {
    readonly projectId: ProjectIdV2
    readonly membershipSnapshot: MembershipSnapshotV2
    readonly member: MembershipMemberV2
    readonly replica: MembershipReplicaV2
    readonly installedFloorSetDigest: DigestV2
  }): Promise<boolean>
}

export class CollaborationMembershipServiceV2 {
  private readonly configuration: TeamControlProtocolConfigurationV2

  constructor(
    private readonly store: AtomicControlStateStore<CollaborationControlProjectStateV2>,
    private readonly clock: ControlClock,
    private readonly random: ControlRandomSource,
    private readonly signatures: ControlDigestSignaturePortV2,
    configuration: TeamControlProtocolConfigurationV2,
    private readonly floors: EditorFloorAuthorizationPortV2,
  ) {
    this.configuration = Object.freeze({
      registrySequence: parseUint64V2(configuration.registrySequence),
      registryRootDigest: parseDigestV2(configuration.registryRootDigest),
      schemaDigest: parseDigestV2(configuration.schemaDigest),
      validationArtifactSetDigest: parseDigestV2(configuration.validationArtifactSetDigest),
      uriProtocolDigest: parseDigestV2(configuration.uriProtocolDigest),
      trustBundleDigest: parseDigestV2(configuration.trustBundleDigest),
    })
  }

  async bootstrapProject(input: Omit<ProjectBootstrapAuthorizationRequestV2, "evidence">, authorization: ProjectBootstrapAuthorizationV2): Promise<TeamBootstrapResultV2> {
    const normalized = Object.freeze({
      projectId: parseProjectIdV2(input.projectId),
      projectEpoch: parseId128V2(input.projectEpoch),
      projectIndexShardEpoch: parseId128V2(input.projectIndexShardEpoch),
      initializationAuthorityDigest: parseDigestV2(input.initializationAuthorityDigest),
      initialProjectIndexCheckpointDigest: parseDigestV2(input.initialProjectIndexCheckpointDigest),
      initialProjectIndexFullUpdateDigest: parseDigestV2(input.initialProjectIndexFullUpdateDigest),
      initialProjectIndexStateVectorDigest: parseDigestV2(input.initialProjectIndexStateVectorDigest),
      initialProjectIndexCanonicalStateDigest: parseDigestV2(input.initialProjectIndexCanonicalStateDigest),
      ownerMemberId: parseMemberIdV2(input.ownerMemberId),
      ownerMemberSigningPublicKey: parsePublicKeyV2(input.ownerMemberSigningPublicKey),
    })
    const authority = liveBootstrapAuthorizations.get(authorization)
    liveBootstrapAuthorizations.delete(authorization)
    if (!authority || !sameBootstrap(authority, normalized)) fail("invalid-proof", "A live exact bootstrap capability is required")
    return this.store.transact(normalized.projectId, async (transaction) => {
      if (transaction.read() !== null) fail("project-exists", "Collaboration Project is already provisioned")
      const projectEpoch = normalized.projectEpoch
      const membershipEpoch = this.randomId128()
      const memberAuthorizationEpoch = this.randomId128()
      const serviceKeyId = serviceKeyIdV2(this.signatures)
      const member: MembershipMemberV2 = Object.freeze({
        memberId: normalized.ownerMemberId,
        memberSigningPublicKey: normalized.ownerMemberSigningPublicKey,
        role: "editor",
        state: "active",
        memberAuthorizationEpoch,
        memberMutationCounter: parseUint64V2("1"),
      })
      const snapshot = await this.signSnapshot({
        format: "convax.membership-snapshot-core/2",
        projectId: normalized.projectId,
        projectEpoch,
        membershipEpoch,
        membershipSequence: parseUint64V2("1"),
        registrySequence: this.configuration.registrySequence,
        registryRootDigest: this.configuration.registryRootDigest,
        members: [member],
        replicas: [],
        protocolDigest: protocolDigest(),
        trustBundleDigest: this.configuration.trustBundleDigest,
        serviceKeyPurpose: "membership",
        serviceKeyId,
      })
      const adminCapability = await this.signAdminCapability(snapshot, member)
      const credential = await this.signMemberCredential(snapshot, member, adminCapability.coreDigest)
      const invitation: TeamInvitationV1 = Object.freeze({ invitationToken: this.randomInvitationToken(), projectId: normalized.projectId, initialRole: "editor", expiresAtUnixMs: addU64(nowU64(this.clock), 15n * 60_000n) })
      const team: CollaborationTeamAuthorityStateV2 = Object.freeze({
        format: "convax.team-authority-state/2",
        bootstrapInitialization: Object.freeze({ projectId: normalized.projectId, projectEpoch, projectIndexShardEpoch: normalized.projectIndexShardEpoch, initializationAuthorityDigest: normalized.initializationAuthorityDigest, initialProjectIndexCheckpointDigest: normalized.initialProjectIndexCheckpointDigest, initialProjectIndexFullUpdateDigest: normalized.initialProjectIndexFullUpdateDigest, initialProjectIndexStateVectorDigest: normalized.initialProjectIndexStateVectorDigest, initialProjectIndexCanonicalStateDigest: normalized.initialProjectIndexCanonicalStateDigest }),
        currentSnapshot: snapshot,
        snapshots: [snapshot],
        memberCredentials: [credential],
        adminCapabilities: [adminCapability],
        actorCredentials: [],
        editAuthorizations: [],
        reservations: [],
        mutationChallenges: [],
        mutationResults: [],
        cutoffChallenges: [],
        cutoffResults: [],
        memberAddSignatureHalves: [],
        projectResetCounter: parseUint64V2("0"),
        rolloverChallenges: [],
        rolloverResults: [],
        lastAllocatedReplicaId: null,
        invitations: [{ ...invitation, requesterCredentialDigest: credential.coreDigest, adminCapabilityDigest: adminCapability.coreDigest, state: "open" as const, challengeDigest: null, requestDigest: null }],
      })
      transaction.write({
        format: "convax.control-project-state/2",
        seed: seedFromTeam(team, this.configuration, null),
        challenges: [],
        sessions: [],
        tickets: [],
        directorySequence: parseUint64V2("0"),
        team,
        metadata: null,
      })
      return Object.freeze({ membershipSnapshot: snapshot, ownerCredential: credential, ownerAdminCapability: adminCapability, invitation, initialization: team.bootstrapInitialization })
    })
  }

  async createInvitation(input: {
    readonly projectId: ProjectIdV2
    readonly requesterCredentialDigest: DigestV2
    readonly adminCapabilityDigest: DigestV2
    readonly initialRole: CollaborationRoleV2
  }, authorization: TeamInvitationAuthorizationV1): Promise<TeamInvitationV1> {
    const normalized = Object.freeze({ projectId: parseProjectIdV2(input.projectId), requesterCredentialDigest: parseDigestV2(input.requesterCredentialDigest), adminCapabilityDigest: parseDigestV2(input.adminCapabilityDigest), initialRole: role(input.initialRole) })
    const authority = liveInvitationAuthorizations.get(authorization)
    if (!authority || authority.action !== "create" || authority.projectId !== normalized.projectId || authority.requesterCredentialDigest !== normalized.requesterCredentialDigest || authority.invitationToken !== null) fail("invalid-proof", "A live exact invitation-create capability is required")
    liveInvitationAuthorizations.delete(authorization)
    return this.store.transact(normalized.projectId, (transaction) => {
      const state = requireTeamState(transaction.read())
      const member = requireCurrentMember(state.team, normalized.requesterCredentialDigest)
      requireCurrentAdmin(state.team, member, normalized.adminCapabilityDigest)
      const now = nowU64(this.clock)
      const invitation: TeamInvitationV1 = Object.freeze({ invitationToken: this.randomInvitationToken(), projectId: normalized.projectId, initialRole: normalized.initialRole, expiresAtUnixMs: addU64(now, 15n * 60_000n) })
      const nextTeam = Object.freeze({ ...state.team, invitations: [...state.team.invitations, { ...invitation, requesterCredentialDigest: normalized.requesterCredentialDigest, adminCapabilityDigest: normalized.adminCapabilityDigest, state: "open" as const, challengeDigest: null, requestDigest: null }] })
      transaction.write({ ...state, team: nextTeam })
      return invitation
    })
  }

  async listOwnerMemberAddInvitations(input: {
    readonly projectId: ProjectIdV2
    readonly requesterCredentialDigest: DigestV2
    readonly adminCapabilityDigest: DigestV2
  }, authorization: TeamInvitationAuthorizationV1): Promise<readonly OwnerMemberAddInvitationProjectionV1[]> {
    const normalized = Object.freeze({ projectId: parseProjectIdV2(input.projectId), requesterCredentialDigest: parseDigestV2(input.requesterCredentialDigest), adminCapabilityDigest: parseDigestV2(input.adminCapabilityDigest) })
    const authority = liveInvitationAuthorizations.get(authorization)
    liveInvitationAuthorizations.delete(authorization)
    if (!authority || authority.action !== "list-member-add" || authority.projectId !== normalized.projectId || authority.requesterCredentialDigest !== normalized.requesterCredentialDigest || authority.invitationToken !== null) fail("invalid-proof", "A live exact invitation-list capability is required")
    return this.store.transact(normalized.projectId, (transaction) => {
      const state = requireTeamState(transaction.read())
      const requester = requireCurrentMember(state.team, normalized.requesterCredentialDigest)
      requireCurrentAdmin(state.team, requester, normalized.adminCapabilityDigest)
      const now = BigInt(this.now())
      return Object.freeze(state.team.invitations
        .filter((invitation) => invitation.requesterCredentialDigest === normalized.requesterCredentialDigest && invitation.adminCapabilityDigest === normalized.adminCapabilityDigest)
        .map((invitation): OwnerMemberAddInvitationProjectionV1 => {
          const status = uint64ToBigIntV2(invitation.expiresAtUnixMs) <= now && invitation.state !== "consumed" && invitation.state !== "revoked" ? "expired" as const : invitation.state
          const record = invitation.challengeDigest ? state.team.mutationChallenges.find((candidate) => candidate.challenge.coreDigest === invitation.challengeDigest && candidate.intent.purpose === "member-add") : undefined
          if (!record || !invitation.requestDigest) return Object.freeze({ invitation: projectInvitation(invitation), status, challenge: null, proofCore: null, requestDigest: null })
          const proofCore = memberAddProofCoreV2(record.challenge, record.intent as MemberAddChallengeIntentV2)
          if (membershipMutationProofCoreDigestV2(proofCore) !== invitation.requestDigest) fail("invalid-proof", "Stored invitation proof material is inconsistent")
          return Object.freeze({ invitation: projectInvitation(invitation), status, challenge: record.challenge, proofCore, requestDigest: invitation.requestDigest })
        }))
    })
  }

  async prepareInvitation(input: {
    readonly projectId: ProjectIdV2
    readonly invitationToken: string
    readonly mutationId: Id128V2
    readonly targetMemberId: MemberIdV2
    readonly targetMemberSigningPublicKey: PublicKeyV2
  }): Promise<PreparedTeamInvitationV1> {
    const projectId = parseProjectIdV2(input.projectId)
    const invitationToken = parseInvitationToken(input.invitationToken)
    const state = await this.store.transact(projectId, (transaction) => requireTeamState(transaction.read()))
    const invitation = requireOpenInvitation(state.team, invitationToken, this.now())
    const challenge = await this.issueMutationChallenge(projectId, {
      purpose: "member-add",
      mutationId: parseId128V2(input.mutationId),
      requesterCredentialDigest: invitation.requesterCredentialDigest,
      adminCapabilityDigest: invitation.adminCapabilityDigest,
      targetMemberId: parseMemberIdV2(input.targetMemberId),
      targetMemberSigningPublicKey: parsePublicKeyV2(input.targetMemberSigningPublicKey),
      initialRole: invitation.initialRole,
      invitationToken,
    })
    const proofCore = memberAddProofCoreV2(challenge, {
      targetMemberSigningPublicKey: parsePublicKeyV2(input.targetMemberSigningPublicKey),
      initialRole: invitation.initialRole,
      adminCapabilityDigest: invitation.adminCapabilityDigest,
    })
    const requestDigest = membershipMutationProofCoreDigestV2(proofCore)
    await this.store.transact(projectId, (transaction) => {
      const current = requireTeamState(transaction.read())
      const index = current.team.invitations.findIndex((value) => value.invitationToken === invitationToken)
      const record = current.team.invitations[index]
      if (!record || record.state !== "prepared" || record.challengeDigest !== challenge.coreDigest) fail("not-active", "Invitation preparation was superseded")
      const invitations = current.team.invitations.map((value, candidateIndex) => candidateIndex === index ? { ...value, requestDigest } : value)
      transaction.write({ ...current, team: { ...current.team, invitations } })
    })
    return Object.freeze({ invitation: projectInvitation(invitation), challenge, proofCore, requestDigest })
  }

  async revokeInvitation(input: { readonly projectId: ProjectIdV2; readonly requesterCredentialDigest: DigestV2; readonly invitationToken: string }, authorization: TeamInvitationAuthorizationV1): Promise<void> {
    const normalized = Object.freeze({ projectId: parseProjectIdV2(input.projectId), requesterCredentialDigest: parseDigestV2(input.requesterCredentialDigest), invitationToken: parseInvitationToken(input.invitationToken) })
    const authority = liveInvitationAuthorizations.get(authorization)
    if (!authority || authority.action !== "revoke" || authority.projectId !== normalized.projectId || authority.requesterCredentialDigest !== normalized.requesterCredentialDigest || authority.invitationToken !== normalized.invitationToken) fail("invalid-proof", "A live exact invitation-revoke capability is required")
    liveInvitationAuthorizations.delete(authorization)
    await this.store.transact(normalized.projectId, (transaction) => {
      const state = requireTeamState(transaction.read())
      const member = requireCurrentMember(state.team, normalized.requesterCredentialDigest)
      const index = state.team.invitations.findIndex((value) => value.invitationToken === normalized.invitationToken)
      const invitation = state.team.invitations[index]
      if (!invitation || invitation.requesterCredentialDigest !== normalized.requesterCredentialDigest) fail("not-found", "Invitation was not found")
      requireCurrentAdmin(state.team, member, invitation.adminCapabilityDigest)
      if (invitation.state === "consumed") fail("not-active", "Consumed invitation cannot be revoked")
      const invitations = state.team.invitations.map((value, candidateIndex) => candidateIndex === index ? { ...value, state: "revoked" as const } : value)
      transaction.write({ ...state, team: { ...state.team, invitations } })
    })
  }

  async reserveReplicaId(requestInput: ReplicaIdReservationRequestV2): Promise<ReplicaIdReservationReceiptV2> {
    const request = parseReplicaIdReservationRequestV2(requestInput)
    return this.store.transact(request.core.projectId, async (transaction) => {
      const state = requireTeamState(transaction.read())
      const team = state.team
      const existing = team.reservations.find((record) => record.request.core.allocationRequestId === request.core.allocationRequestId)
      if (existing) {
        if (existing.request.coreDigest !== request.coreDigest) fail("equivocation", "Replica reservation id was reused with another digest")
        return existing.receipt
      }
      const snapshot = team.currentSnapshot
      const member = requireCurrentMember(team, request.core.requesterCredentialDigest)
      assertReservationBinding(request, snapshot, member, team)
      if (!await this.signatures.verifyPublicKeyDigest(member.memberSigningPublicKey, request.coreDigest, request.memberSignature)) {
        fail("invalid-proof", "Replica reservation member signature is invalid")
      }
      const liveReservations = team.reservations.filter((record) => record.state === "reserved" && uint64ToBigIntV2(record.receipt.core.expiresAtUnixMs) > BigInt(this.now()))
      if (liveReservations.filter((record) => record.receipt.core.targetMemberId === member.memberId).length >= MAX_PENDING_RESERVATIONS_PER_MEMBER) fail("capacity-exceeded", "Member reservation capacity is exhausted")
      if (liveReservations.length >= MAX_PENDING_RESERVATIONS_PER_PROJECT) fail("capacity-exceeded", "Project reservation capacity is exhausted")
      if (team.reservations.filter((record) => record.receipt.core.targetMemberId === member.memberId).length >= MAX_ALLOCATIONS_PER_MEMBER) fail("capacity-exceeded", "Member replica allocation lifetime cap is exhausted")
      if (team.reservations.length >= MAX_ALLOCATIONS_PER_PROJECT) fail("capacity-exceeded", "Project replica allocation lifetime cap is exhausted")
      const assignedReplicaId = nextReplicaId(team.lastAllocatedReplicaId)
      const now = nowU64(this.clock)
      const core: ReplicaIdReservationReceiptCoreV2 = Object.freeze({
        format: "convax.replica-id-reservation-receipt-core/2",
        allocationRequestId: request.core.allocationRequestId,
        reservationRequestCoreDigest: request.coreDigest,
        projectId: snapshot.core.projectId,
        projectEpoch: snapshot.core.projectEpoch,
        membershipEpoch: snapshot.core.membershipEpoch,
        purpose: request.core.purpose,
        expectedMembershipSequence: request.core.expectedMembershipSequence,
        targetMemberId: request.core.targetMemberId,
        expectedTargetMemberMutationCounter: request.core.expectedTargetMemberMutationCounter,
        requesterCredentialDigest: request.core.requesterCredentialDigest,
        currentReplicaId: request.core.currentReplicaId,
        assignedReplicaId,
        newReplicaSigningPublicKey: request.core.newReplicaSigningPublicKey,
        requestedEditState: request.core.requestedEditState,
        issuedAtUnixMs: now,
        expiresAtUnixMs: addU64(now, RESERVATION_TTL_MS),
        protocolDigest: protocolDigest(),
        trustBundleDigest: this.configuration.trustBundleDigest,
        serviceKeyPurpose: "membership",
        serviceKeyId: serviceKeyIdV2(this.signatures),
      })
      const receipt: ReplicaIdReservationReceiptV2 = await signArtifact("convax.replica-id-reservation-receipt/2", "convax.replica-id-reservation-receipt-core/2", core, this.signatures)
      const nextTeam: CollaborationTeamAuthorityStateV2 = Object.freeze({
        ...team,
        lastAllocatedReplicaId: assignedReplicaId,
        reservations: [...team.reservations, { request, receipt, state: "reserved" as const, consumedMutationId: null, consumedMutationReceiptCoreDigest: null, abandonmentReason: null }],
      })
      transaction.write({ ...state, team: nextTeam })
      return receipt
    })
  }

  async issueMutationChallenge(projectIdInput: ProjectIdV2, intentInput: SupportedMutationChallengeIntentV2): Promise<MutationChallengeV2> {
    const projectId = parseProjectIdV2(projectIdInput)
    const intent = normalizeIntent(intentInput)
    return this.store.transact(projectId, async (transaction) => {
      const state = requireTeamState(transaction.read())
      const team = state.team
      const snapshot = team.currentSnapshot
      const requester = requireCurrentMember(team, intent.requesterCredentialDigest)
      const pending = team.mutationChallenges.filter((record) => record.consumedRequestDigest === null && uint64ToBigIntV2(record.challenge.core.expiresAtUnixMs) > BigInt(this.now()))
      if (pending.filter((record) => record.challenge.core.requesterMemberId === requester.memberId).length >= MAX_PENDING_MUTATION_CHALLENGES_PER_MEMBER) fail("capacity-exceeded", "Member mutation challenge capacity is exhausted")
      if (intent.purpose === "member-add") requireCurrentAdmin(team, requester, intent.adminCapabilityDigest)
      let invitationIndex = -1
      if (intent.purpose === "member-add" && intent.invitationToken) {
        invitationIndex = team.invitations.findIndex((value) => value.invitationToken === intent.invitationToken)
        const invitation = team.invitations[invitationIndex]
        if (!invitation || invitation.state !== "open" || uint64ToBigIntV2(invitation.expiresAtUnixMs) <= BigInt(this.now()) || invitation.requesterCredentialDigest !== intent.requesterCredentialDigest || invitation.adminCapabilityDigest !== intent.adminCapabilityDigest || invitation.initialRole !== intent.initialRole) fail("not-active", "Invitation is not active")
      }
      const preparedAfterCore = this.prepareAfterSnapshot(team, requester, intent, state.seed)
      const targetCounter = intent.purpose === "member-add"
        ? parseUint64V2("0")
        : requireMember(snapshot, requester.memberId).memberMutationCounter
      const now = nowU64(this.clock)
      const core: MutationChallengeCoreV2 = Object.freeze({
        format: "convax.mutation-challenge-core/2",
        purpose: intent.purpose,
        challengeId: this.randomId128(),
        mutationId: intent.mutationId,
        projectId: snapshot.core.projectId,
        projectEpoch: snapshot.core.projectEpoch,
        membershipEpoch: snapshot.core.membershipEpoch,
        expectedMembershipSequence: snapshot.core.membershipSequence,
        requesterMemberId: requester.memberId,
        targetMemberId: intent.purpose === "member-add" ? intent.targetMemberId : requester.memberId,
        expectedTargetMemberMutationCounter: targetCounter,
        requesterCredentialDigest: intent.requesterCredentialDigest,
        replicaIdReservationReceiptDigest: intent.purpose === "replica-enroll" ? intent.replicaIdReservationReceiptDigest : null,
        requiredFloorSetDigest: intent.purpose === "replica-activate-editor" ? intent.installedFloorSetDigest : null,
        preparedAfterMembershipSnapshotCoreDigest: structuredDigestV2("convax.membership-snapshot-core/2", preparedAfterCore),
        preparedCutoffCoverageRootCoreDigest: null,
        serverNonce: this.randomId128(),
        issuedAtUnixMs: now,
        expiresAtUnixMs: addU64(now, CHALLENGE_TTL_MS),
        protocolDigest: protocolDigest(),
        trustBundleDigest: this.configuration.trustBundleDigest,
        serviceKeyPurpose: "membership",
        serviceKeyId: serviceKeyIdV2(this.signatures),
      })
      const challenge: MutationChallengeV2 = await signArtifact("convax.mutation-challenge/2", "convax.mutation-challenge-core/2", core, this.signatures)
      const invitations = invitationIndex < 0 ? team.invitations : team.invitations.map((value, index) => index === invitationIndex ? { ...value, state: "prepared" as const, challengeDigest: challenge.coreDigest } : value)
      const nextTeam: CollaborationTeamAuthorityStateV2 = Object.freeze({
        ...team,
        mutationChallenges: [...pending, { challenge, preparedAfterCore, intent, consumedRequestDigest: null, invitationToken: intent.purpose === "member-add" ? intent.invitationToken ?? null : null }],
        invitations,
      })
      transaction.write({ ...state, team: nextTeam })
      return challenge
    })
  }

  async commitMembershipMutation(proofInput: MembershipMutationProofV2): Promise<MembershipMutationResultV2> {
    const proof = parseMembershipMutationProofV2(proofInput)
    if (proof.core.purpose === "replica-rotate" || proof.core.purpose === "replica-revoke" || proof.core.purpose === "member-role-change" || proof.core.purpose === "member-revoke") return this.commitCutoffMutation(proof) as unknown as MembershipMutationResultV2
    return this.store.transact(proof.core.projectId, (transaction) => this.commitNonCutoffMutationInTransaction(proof, transaction))
  }

  async submitMemberAddSignatureHalf(input: {
    readonly projectId: ProjectIdV2
    readonly invitationToken: string
    readonly requestDigest: DigestV2
    readonly kind: MemberAddSignatureHalfKindV1
    readonly signature: SignatureV2
  }): Promise<MemberAddSignatureHalfResultV1> {
    const projectId = parseProjectIdV2(input.projectId)
    const invitationToken = parseInvitationToken(input.invitationToken)
    const requestDigest = parseDigestV2(input.requestDigest)
    const signature = parseSignatureV2(input.signature)
    if (input.kind !== "admin" && input.kind !== "target-possession") fail("invalid-proof", "Member-add signature half kind is invalid")
    return this.store.transact(projectId, async (transaction) => {
      const state = requireTeamState(transaction.read())
      const team = state.team
      const invitationIndex = team.invitations.findIndex((value) => value.invitationToken === invitationToken)
      const invitation = team.invitations[invitationIndex]
      if (invitation?.state === "consumed" && invitation.requestDigest === requestDigest && invitation.challengeDigest) {
        const challengeRecord = team.mutationChallenges.find((record) => record.challenge.coreDigest === invitation.challengeDigest && record.intent.purpose === "member-add")
        const committed = team.mutationResults.find((value) => value.requestDigest === requestDigest)
        const historicalRequesterCredential = challengeRecord ? findLastV2(team.memberCredentials, (value) => value.coreDigest === challengeRecord.challenge.core.requesterCredentialDigest) : undefined
        const signingKey = input.kind === "admin" ? historicalRequesterCredential?.core.memberSigningPublicKey : challengeRecord?.intent.purpose === "member-add" ? challengeRecord.intent.targetMemberSigningPublicKey : undefined
        if (!challengeRecord || !committed || !signingKey || !await this.signatures.verifyPublicKeyDigest(signingKey, requestDigest, signature)) fail("not-active", "Committed invitation status requires its exact historical signer")
        return Object.freeze({ status: "committed" as const, requestDigest, result: committed.result })
      }
      if (!invitation || invitation.state !== "prepared" || uint64ToBigIntV2(invitation.expiresAtUnixMs) <= BigInt(this.now()) || invitation.requestDigest !== requestDigest || !invitation.challengeDigest) fail("not-active", "Invitation is not an active exact prepared member-add")
      const challengeRecord = team.mutationChallenges.find((record) => record.challenge.coreDigest === invitation.challengeDigest)
      if (!challengeRecord || challengeRecord.consumedRequestDigest !== null || challengeRecord.invitationToken !== invitationToken || challengeRecord.intent.purpose !== "member-add") fail("not-active", "Invitation challenge is not active")
      if (uint64ToBigIntV2(challengeRecord.challenge.core.expiresAtUnixMs) <= BigInt(this.now())) fail("expired", "Member-add challenge expired")
      const proofCore = memberAddProofCoreV2(challengeRecord.challenge, challengeRecord.intent)
      if (membershipMutationProofCoreDigestV2(proofCore) !== requestDigest) fail("invalid-proof", "Member-add signature half does not bind the prepared proof")
      const requester = requireCurrentMember(team, challengeRecord.challenge.core.requesterCredentialDigest)
      requireCurrentAdmin(team, requester, challengeRecord.intent.adminCapabilityDigest)
      const signingKey = input.kind === "admin" ? requester.memberSigningPublicKey : challengeRecord.intent.targetMemberSigningPublicKey
      if (!await this.signatures.verifyPublicKeyDigest(signingKey, requestDigest, signature)) fail("invalid-proof", "Member-add signature half is invalid")
      const existingIndex = team.memberAddSignatureHalves.findIndex((value) => value.requestDigest === requestDigest)
      const existing = team.memberAddSignatureHalves[existingIndex]
      if (existing && (existing.invitationToken !== invitationToken || existing.challengeDigest !== challengeRecord.challenge.coreDigest)) fail("equivocation", "Member-add signature halves crossed invitation authority")
      const priorSignature = input.kind === "admin" ? existing?.adminSignature : existing?.targetMemberPossessionSignature
      if (priorSignature && priorSignature !== signature) fail("equivocation", "Member-add signature half changed")
      const merged: MemberAddSignatureHalvesV2 = Object.freeze({
        invitationToken,
        challengeDigest: challengeRecord.challenge.coreDigest,
        requestDigest,
        adminSignature: input.kind === "admin" ? signature : existing?.adminSignature ?? null,
        targetMemberPossessionSignature: input.kind === "target-possession" ? signature : existing?.targetMemberPossessionSignature ?? null,
      })
      const halves = existingIndex < 0
        ? Object.freeze([...team.memberAddSignatureHalves, merged])
        : Object.freeze(team.memberAddSignatureHalves.map((value, index) => index === existingIndex ? merged : value))
      transaction.write({ ...state, team: { ...team, memberAddSignatureHalves: halves } })
      if (!merged.adminSignature || !merged.targetMemberPossessionSignature) return Object.freeze({ status: "pending-other-signature" as const, requestDigest })
      const proof = parseMembershipMutationProofV2(Object.freeze({
        format: "convax.mutation-proof/2",
        core: proofCore,
        requestDigest,
        signatures: Object.freeze({ purpose: "member-add", adminSignature: merged.adminSignature, targetMemberPossessionSignature: merged.targetMemberPossessionSignature }),
      }))
      const result = await this.commitNonCutoffMutationInTransaction(proof, transaction)
      return Object.freeze({ status: "committed" as const, requestDigest, result })
    })
  }

  async issueTeamEpochRolloverChallenge(input: {
    readonly projectId: ProjectIdV2
    readonly confirmation: unknown
    readonly approval: unknown
  }): Promise<TeamEpochRolloverChallengeV2> {
    const projectId = parseProjectIdV2(input.projectId)
    const confirmation = parseProjectResetConfirmationV2(input.confirmation)
    const approval = parseProjectResetApprovalV2(input.approval)
    return this.store.transact(projectId, async (transaction) => {
      const state = requireTeamState(transaction.read())
      const team = state.team
      const pending = team.rolloverChallenges.filter((record) => record.consumedRequestDigest === null && uint64ToBigIntV2(record.challenge.core.expiresAtUnixMs) > BigInt(this.now()))
      const retry = pending.find((record) => record.challenge.core.resetId === confirmation.core.resetId)
      if (retry) {
        if (retry.confirmation.coreDigest !== confirmation.coreDigest || retry.approval.coreDigest !== approval.coreDigest) fail("equivocation", "Project reset id was reused with different evidence")
        return retry.challenge
      }
      if (pending.length >= MAX_PENDING_PROJECT_RESET_CHALLENGES) fail("capacity-exceeded", "Project reset challenge capacity is exhausted")
      if (confirmation.core.projectId !== projectId || confirmation.core.oldProjectEpoch !== state.seed.projectEpoch || confirmation.core.protocolDigest !== protocolDigest()) fail("stale-counter", "Project reset confirmation is outside the current Project authority")
      if (confirmation.core.confirmationPrincipal.kind !== "team-replica") fail("invalid-proof", "A team rollover requires a team-replica confirmation")
      const principal = confirmation.core.confirmationPrincipal
      const replica = requireReplica(team.currentSnapshot, principal.replicaId)
      const actorCredential = findLastV2(team.actorCredentials, (value) => value.coreDigest === principal.actorCredentialCoreDigest)
      if (replica.memberId !== principal.memberId
        || replica.actorId !== principal.actorId
        || !actorCredential
        || actorCredential.core.projectId !== projectId
        || actorCredential.core.projectEpoch !== state.seed.projectEpoch
        || actorCredential.core.memberId !== principal.memberId
        || actorCredential.core.replicaId !== principal.replicaId
        || actorCredential.core.actorId !== principal.actorId
        || actorCredential.core.replicaIdReservationReceiptDigest !== replica.replicaIdReservationReceiptDigest
        || actorCredential.core.replicaAuthorizationEpoch !== replica.replicaAuthorizationEpoch
        || actorCredential.core.replicaSigningPublicKey !== replica.replicaSigningPublicKey
        || actorCredential.core.protocolDigest !== protocolDigest()
        || actorCredential.core.trustBundleDigest !== this.configuration.trustBundleDigest
        || !await this.signatures.verifyPublicKeyDigest(actorCredential.core.replicaSigningPublicKey, confirmation.coreDigest, confirmation.confirmationSignature)) fail("invalid-proof", "Project reset confirmation actor authority is invalid")
      if (approval.core.resetId !== confirmation.core.resetId || approval.core.confirmationCoreDigest !== confirmation.coreDigest || approval.core.projectId !== projectId || approval.core.oldProjectEpoch !== state.seed.projectEpoch || approval.core.reason !== confirmation.core.reason || approval.core.observedOldPrivateTreeDigest !== confirmation.core.observedOldPrivateTreeDigest || approval.core.unsupportedInventoryDigest !== confirmation.core.unsupportedInventoryDigest || approval.core.privateDeletionSetDigest !== confirmation.core.privateDeletionSetDigest || approval.core.requestedProtocolDigest !== confirmation.core.requestedProtocolDigest || approval.core.requestedSchemaDigest !== confirmation.core.requestedSchemaDigest || approval.core.requestedUriProtocolDigest !== confirmation.core.requestedUriProtocolDigest) fail("invalid-proof", "Project reset approval and confirmation differ")
      if (approval.core.requestedSchemaDigest !== this.configuration.schemaDigest || approval.core.requestedUriProtocolDigest !== this.configuration.uriProtocolDigest) fail("invalid-proof", "Project reset requests unavailable schema authority")
      const admin = requireMember(team.currentSnapshot, approval.core.adminMemberId)
      requireCurrentAdmin(team, admin, approval.core.adminCapabilityCoreDigest)
      if (admin.memberAuthorizationEpoch !== approval.core.adminMemberAuthorizationEpoch || !await this.signatures.verifyPublicKeyDigest(admin.memberSigningPublicKey, approval.coreDigest, approval.adminMemberSignature)) fail("invalid-proof", "Project reset admin approval signature is invalid")
      const newProjectEpoch = this.randomId128()
      const newMembershipEpoch = this.randomId128()
      const newProjectIndexShardEpoch = this.randomId128()
      const registryEntrySet = Object.freeze({ format: "convax.registry-entry-set/2" as const, entries: Object.freeze([]) })
      const preparedEmptyRegistrySnapshotCore: RegistrySnapshotCoreV2 = Object.freeze({
        format: "convax.registry-snapshot-core/2",
        projectId,
        projectEpoch: newProjectEpoch,
        registrySequence: parseUint64V2("0"),
        priorRegistryDigest: null,
        entriesDigest: registryEntrySetDigestV2(registryEntrySet),
        entryCount: parseUint32V2("0"),
        protocolDigest: protocolDigest(),
        trustBundleDigest: this.configuration.trustBundleDigest,
        serviceKeyPurpose: "registry-cutoff",
        serviceKeyId: serviceKeyIdFor("registry-cutoff", this.signatures),
      })
      const preparedMembershipSnapshotCore: MembershipSnapshotCoreV2 = Object.freeze({
        format: "convax.membership-snapshot-core/2",
        projectId,
        projectEpoch: newProjectEpoch,
        membershipEpoch: newMembershipEpoch,
        membershipSequence: parseUint64V2("1"),
        registrySequence: parseUint64V2("0"),
        registryRootDigest: registrySnapshotCoreDigestV2(preparedEmptyRegistrySnapshotCore),
        members: Object.freeze(team.currentSnapshot.core.members.filter((member) => member.state === "active").map((member) => Object.freeze({ ...member, state: "active" as const, memberAuthorizationEpoch: this.randomId128(), memberMutationCounter: parseUint64V2("1") }))),
        replicas: Object.freeze([]),
        protocolDigest: protocolDigest(),
        trustBundleDigest: this.configuration.trustBundleDigest,
        serviceKeyPurpose: "membership",
        serviceKeyId: serviceKeyIdV2(this.signatures),
      })
      const now = nowU64(this.clock)
      const core: TeamEpochRolloverChallengeCoreV2 = Object.freeze({
        format: "convax.team-epoch-rollover-challenge-core/2",
        challengeId: this.randomId128(),
        resetId: confirmation.core.resetId,
        projectId,
        oldProjectEpoch: state.seed.projectEpoch,
        expectedProjectResetCounter: team.projectResetCounter,
        projectResetConfirmationCoreDigest: confirmation.coreDigest,
        projectResetApprovalCoreDigest: approval.coreDigest,
        observedOldMembershipSnapshotDigest: team.currentSnapshot.coreDigest,
        observedOldRegistryRootDigest: state.seed.registryRootDigest,
        observedOldPrivateTreeDigest: confirmation.core.observedOldPrivateTreeDigest,
        newProjectEpoch,
        newMembershipEpoch,
        newProjectIndexShardEpoch,
        preparedNewMembershipSnapshotCoreDigest: structuredDigestV2("convax.membership-snapshot-core/2", preparedMembershipSnapshotCore),
        serverNonce: this.randomId128(),
        issuedAtUnixMs: now,
        expiresAtUnixMs: addU64(now, CHALLENGE_TTL_MS),
        protocolDigest: protocolDigest(),
        trustBundleDigest: this.configuration.trustBundleDigest,
        serviceKeyPurpose: "membership",
        serviceKeyId: serviceKeyIdV2(this.signatures),
      })
      const coreDigest = teamEpochRolloverChallengeCoreDigestV2(core)
      const challenge: TeamEpochRolloverChallengeV2 = Object.freeze({ format: "convax.team-epoch-rollover-challenge/2", core, coreDigest, serviceSignature: parseSignatureV2(await this.signatures.signServiceDigest("membership", coreDigest)) })
      transaction.write({ ...state, team: { ...team, rolloverChallenges: Object.freeze([...pending, Object.freeze({ challenge, confirmation, approval, preparedMembershipSnapshotCore, preparedEmptyRegistrySnapshotCore, consumedRequestDigest: null })]) } })
      return challenge
    })
  }

  async commitTeamEpochRollover(
    proofInput: unknown,
    attestationInput: unknown,
    admission: EmptyProjectIndexGenesisAttestationAdmissionV2,
  ): Promise<TeamEpochRolloverResultV2> {
    const proof = parseTeamEpochRolloverProofV2(proofInput)
    const attestation = parseEmptyProjectIndexGenesisAttestationV2(attestationInput)
    const admittedDigest = liveEmptyGenesisAdmissionsV2.get(admission)
    liveEmptyGenesisAdmissionsV2.delete(admission)
    if (admittedDigest !== attestation.coreDigest) fail("invalid-proof", "A live exact empty ProjectIndex attestation admission is required")
    return this.store.transact(proof.core.projectId, async (transaction) => {
      const state = requireTeamState(transaction.read())
      const team = state.team
      const existing = team.rolloverResults.find((record) => record.resetId === proof.core.resetId)
      if (existing) {
        if (existing.requestDigest !== proof.requestDigest) fail("equivocation", "Project reset id was reused with another digest")
        return existing.result
      }
      const challengeIndex = team.rolloverChallenges.findIndex((record) => record.challenge.coreDigest === proof.core.challengeDigest)
      const record = team.rolloverChallenges[challengeIndex]
      if (!record || record.consumedRequestDigest !== null) fail("not-active", "Project reset challenge is not active")
      if (uint64ToBigIntV2(record.challenge.core.expiresAtUnixMs) <= BigInt(this.now())) fail("expired", "Project reset challenge expired")
      const challenge = record.challenge.core
      if (proof.core.resetId !== challenge.resetId || proof.core.projectId !== challenge.projectId || proof.core.oldProjectEpoch !== challenge.oldProjectEpoch || proof.core.newProjectEpoch !== challenge.newProjectEpoch || proof.core.newMembershipEpoch !== challenge.newMembershipEpoch || proof.core.newProjectIndexShardEpoch !== challenge.newProjectIndexShardEpoch || proof.core.expectedProjectResetCounter !== challenge.expectedProjectResetCounter || proof.core.projectResetConfirmationCoreDigest !== challenge.projectResetConfirmationCoreDigest || proof.core.projectResetApprovalCoreDigest !== challenge.projectResetApprovalCoreDigest || proof.core.serverNonce !== challenge.serverNonce || proof.core.protocolDigest !== protocolDigest() || proof.core.schemaDigest !== this.configuration.schemaDigest || proof.core.uriProtocolDigest !== this.configuration.uriProtocolDigest) fail("stale-counter", "Project reset proof does not bind the current challenge")
      if (team.projectResetCounter !== challenge.expectedProjectResetCounter || team.currentSnapshot.coreDigest !== challenge.observedOldMembershipSnapshotDigest || state.seed.registryRootDigest !== challenge.observedOldRegistryRootDigest || state.seed.projectEpoch !== challenge.oldProjectEpoch) fail("stale-counter", "Project reset authority changed after challenge issuance")
      const requester = requireMember(team.currentSnapshot, proof.core.requesterMemberId)
      requireCurrentAdmin(team, requester, proof.core.requesterAdminCapabilityCoreDigest)
      if (requester.memberAuthorizationEpoch !== proof.core.requesterMemberAuthorizationEpoch || !await this.signatures.verifyPublicKeyDigest(requester.memberSigningPublicKey, proof.requestDigest, proof.requesterAdminMemberSignature)) fail("invalid-proof", "Project reset proof admin signature is invalid")
      if (attestation.core.projectId !== proof.core.projectId || attestation.core.newProjectEpoch !== proof.core.newProjectEpoch || attestation.core.newMembershipEpoch !== proof.core.newMembershipEpoch || attestation.core.newProjectIndexScope.projectId !== proof.core.projectId || attestation.core.newProjectIndexScope.projectEpoch !== proof.core.newProjectEpoch || attestation.core.newProjectIndexScope.shardEpoch !== proof.core.newProjectIndexShardEpoch || attestation.core.teamEpochRolloverProofCoreDigest !== proof.requestDigest || attestation.core.checkpointDigest !== proof.core.stagedEmptyProjectIndexCheckpointDigest || attestation.core.fullUpdateDigest !== proof.core.stagedEmptyProjectIndexFullUpdateDigest || attestation.core.stateVectorDigest !== proof.core.stagedEmptyProjectIndexStateVectorDigest || attestation.core.canonicalStateDigest !== proof.core.stagedEmptyProjectIndexCanonicalStateDigest || attestation.core.protocolDigest !== protocolDigest() || attestation.core.schemaDigest !== this.configuration.schemaDigest || attestation.core.uriProtocolDigest !== this.configuration.uriProtocolDigest || attestation.core.validationArtifactSetDigest !== this.configuration.validationArtifactSetDigest || attestation.core.trustBundleDigest !== this.configuration.trustBundleDigest) fail("invalid-proof", "Empty ProjectIndex attestation does not bind the rollover proof")
      if (structuredDigestV2("convax.membership-snapshot-core/2", record.preparedMembershipSnapshotCore) !== challenge.preparedNewMembershipSnapshotCoreDigest || registrySnapshotCoreDigestV2(record.preparedEmptyRegistrySnapshotCore) !== record.preparedMembershipSnapshotCore.registryRootDigest) fail("invalid-proof", "Prepared rollover authority changed")
      const membershipSnapshot = await this.signSnapshot(record.preparedMembershipSnapshotCore)
      const requesterAfter = requireMember(membershipSnapshot, requester.memberId)
      const requesterAdminCapability = await this.signAdminCapability(membershipSnapshot, requesterAfter)
      const requesterCredential = await this.signMemberCredential(membershipSnapshot, requesterAfter, requesterAdminCapability.coreDigest)
      const otherCredentials: MemberCredentialV2[] = []
      for (const member of membershipSnapshot.core.members) if (member.memberId !== requesterAfter.memberId) otherCredentials.push(await this.signMemberCredential(membershipSnapshot, member, null))
      const emptyRegistryCoreDigest = registrySnapshotCoreDigestV2(record.preparedEmptyRegistrySnapshotCore)
      const emptyRegistrySnapshot: RegistrySnapshotV2 = Object.freeze({ format: "convax.registry-snapshot/2", core: record.preparedEmptyRegistrySnapshotCore, coreDigest: emptyRegistryCoreDigest, serviceSignature: parseSignatureV2(await this.signatures.signServiceDigest("registry-cutoff", emptyRegistryCoreDigest)) })
      const closedSessionCredentialDigests = Object.freeze(state.sessions.filter((session) => !session.closed).map((session) => session.credential.coreDigest).sort())
      if (closedSessionCredentialDigests.length > 512) fail("capacity-exceeded", "Project reset closes more than 512 sessions")
      const committedProjectResetCounter = incrementUint64V2(team.projectResetCounter)
      const receiptCore: TeamEpochRolloverReceiptCoreV2 = Object.freeze({
        format: "convax.team-epoch-rollover-receipt-core/2",
        resetId: proof.core.resetId,
        requestDigest: proof.requestDigest,
        projectId: proof.core.projectId,
        oldProjectEpoch: proof.core.oldProjectEpoch,
        newProjectEpoch: proof.core.newProjectEpoch,
        newMembershipEpoch: proof.core.newMembershipEpoch,
        newProjectIndexShardEpoch: proof.core.newProjectIndexShardEpoch,
        projectResetConfirmationCoreDigest: proof.core.projectResetConfirmationCoreDigest,
        projectResetApprovalCoreDigest: proof.core.projectResetApprovalCoreDigest,
        newMembershipSnapshotDigest: membershipSnapshot.coreDigest,
        newRequesterMemberCredentialCoreDigest: requesterCredential.coreDigest,
        newRequesterAdminCapabilityCoreDigest: requesterAdminCapability.coreDigest,
        newProjectIndexScope: attestation.core.newProjectIndexScope,
        emptyProjectIndexGenesisAttestationCoreDigest: attestation.coreDigest,
        emptyProjectIndexCheckpointDigest: attestation.core.checkpointDigest,
        emptyProjectIndexFullUpdateDigest: attestation.core.fullUpdateDigest,
        emptyProjectIndexStateVectorDigest: attestation.core.stateVectorDigest,
        emptyProjectIndexCanonicalStateDigest: attestation.core.canonicalStateDigest,
        closedSessionCredentialDigests,
        retiredOldEpochState: "permanently-fenced-recovery-only",
        committedProjectResetCounter,
        protocolDigest: protocolDigest(),
        schemaDigest: this.configuration.schemaDigest,
        uriProtocolDigest: this.configuration.uriProtocolDigest,
        trustBundleDigest: this.configuration.trustBundleDigest,
        serviceKeyPurpose: "membership",
        serviceKeyId: serviceKeyIdV2(this.signatures),
      })
      const receiptCoreDigest = teamEpochRolloverReceiptCoreDigestV2(receiptCore)
      const receipt: TeamEpochRolloverReceiptV2 = Object.freeze({ format: "convax.team-epoch-rollover-receipt/2", core: receiptCore, coreDigest: receiptCoreDigest, serviceSignature: parseSignatureV2(await this.signatures.signServiceDigest("membership", receiptCoreDigest)) })
      const result: TeamEpochRolloverResultV2 = Object.freeze({ receipt, membershipSnapshot, requesterCredential, requesterAdminCapability, emptyRegistrySnapshot })
      const reservations = team.reservations.map((value) => value.state === "reserved" ? { ...value, state: "abandoned" as const, abandonmentReason: "project-reset" as const } : value)
      const nextTeam: CollaborationTeamAuthorityStateV2 = Object.freeze({
        ...team,
        bootstrapInitialization: Object.freeze({ projectId: proof.core.projectId, projectEpoch: proof.core.newProjectEpoch, projectIndexShardEpoch: proof.core.newProjectIndexShardEpoch, initializationAuthorityDigest: receipt.coreDigest, initialProjectIndexCheckpointDigest: attestation.core.checkpointDigest, initialProjectIndexFullUpdateDigest: attestation.core.fullUpdateDigest, initialProjectIndexStateVectorDigest: attestation.core.stateVectorDigest, initialProjectIndexCanonicalStateDigest: attestation.core.canonicalStateDigest }),
        currentSnapshot: membershipSnapshot,
        snapshots: Object.freeze([...team.snapshots, membershipSnapshot]),
        memberCredentials: Object.freeze([...team.memberCredentials, requesterCredential, ...otherCredentials]),
        adminCapabilities: Object.freeze([...team.adminCapabilities, requesterAdminCapability]),
        reservations: Object.freeze(reservations),
        mutationChallenges: Object.freeze([]),
        cutoffChallenges: Object.freeze([]),
        memberAddSignatureHalves: Object.freeze([]),
        lastAllocatedReplicaId: null,
        invitations: Object.freeze(team.invitations.map((value) => value.state === "consumed" ? value : { ...value, state: "revoked" as const })),
        projectResetCounter: committedProjectResetCounter,
        rolloverChallenges: Object.freeze([]),
        rolloverResults: Object.freeze([...team.rolloverResults, Object.freeze({ resetId: proof.core.resetId, requestDigest: proof.requestDigest, result })]),
      })
      const nextMetadata = Object.freeze({ format: "convax.metadata-control-state/2" as const, contentCertificates: [], stableSets: [], projectFloors: [], replicaFloorAcks: [], registrationClaims: [], registrationAbandonments: [], registryEntries: [], registrySnapshots: [emptyRegistrySnapshot], cutoffCommits: [], shardResetApprovals: [], projectResetRolloverReceipts: [receipt] })
      transaction.write({ ...state, seed: seedFromTeam(nextTeam, this.configuration, null), challenges: [], sessions: Object.freeze(state.sessions.map((session) => ({ ...session, closed: true }))), tickets: [], directorySequence: parseUint64V2("0"), team: nextTeam, metadata: nextMetadata })
      return result
    })
  }

  private async commitNonCutoffMutationInTransaction(
    proof: MembershipMutationProofV2,
    transaction: AtomicControlStateTransaction<CollaborationControlProjectStateV2>,
  ): Promise<MembershipMutationResultV2> {
    if (proof.core.purpose === "replica-rotate" || proof.core.purpose === "replica-revoke" || proof.core.purpose === "member-role-change" || proof.core.purpose === "member-revoke") fail("invalid-proof", "Cutoff mutation cannot use the non-cutoff transaction")
      const state = requireTeamState(transaction.read())
      const team = state.team
      const existing = team.mutationResults.find((record) => record.mutationId === proof.core.mutationId)
      if (existing) {
        if (existing.requestDigest !== proof.requestDigest) fail("equivocation", "Mutation id was reused with another digest")
        return existing.result
      }
      const challengeIndex = team.mutationChallenges.findIndex((record) => record.challenge.coreDigest === proof.core.challengeDigest)
      if (challengeIndex < 0) fail("not-found", "Mutation challenge was not found")
      const challengeRecord = team.mutationChallenges[challengeIndex]!
      if (challengeRecord.consumedRequestDigest !== null) fail("equivocation", "Mutation challenge was already consumed")
      if (uint64ToBigIntV2(challengeRecord.challenge.core.expiresAtUnixMs) <= BigInt(this.now())) fail("expired", "Mutation challenge expired")
      let invitationIndex = -1
      if (challengeRecord.invitationToken) {
        invitationIndex = team.invitations.findIndex((value) => value.invitationToken === challengeRecord.invitationToken)
        const invitation = team.invitations[invitationIndex]
        if (!invitation || invitation.state !== "prepared" || uint64ToBigIntV2(invitation.expiresAtUnixMs) <= BigInt(this.now()) || invitation.challengeDigest !== challengeRecord.challenge.coreDigest || invitation.requestDigest !== proof.requestDigest) fail("not-active", "Invitation is revoked, expired, or does not bind this proof")
      }
      const requester = requireCurrentMember(team, challengeRecord.challenge.core.requesterCredentialDigest)
      assertMutationBinding(proof, challengeRecord.challenge.core, team.currentSnapshot, requester)
      await this.verifyMutationSignatures(proof, requester, team)
      const afterCore = challengeRecord.preparedAfterCore
      if (structuredDigestV2("convax.membership-snapshot-core/2", afterCore) !== challengeRecord.challenge.core.preparedAfterMembershipSnapshotCoreDigest) fail("invalid-proof", "Prepared membership snapshot changed")
      if (proof.core.purpose === "replica-activate-editor") {
        const replica = requireReplica(team.currentSnapshot, proof.core.currentReplicaId)
        if (!await this.floors.verifyInstalledCurrentFloor({
          projectId: proof.core.projectId,
          membershipSnapshot: team.currentSnapshot,
          member: requester,
          replica,
          installedFloorSetDigest: proof.core.installedFloorSetDigest,
        })) fail("invalid-proof", "Installed editor floor is not current")
      }
      const afterSnapshot = await this.signSnapshot(afterCore)
      const afterMember = requireMember(afterSnapshot, proof.core.targetMemberId)
      const afterRequester = requireMember(afterSnapshot, requester.memberId)
      const authorities = await this.signNextMemberAuthorities(team, afterSnapshot)
      const requesterAdminCapability = authorities.adminCapabilities.find((value) => value.core.adminMemberId === afterRequester.memberId) ?? null
      const requesterCredential = authorities.memberCredentials.find((value) => value.core.memberId === afterRequester.memberId) ?? fail("invalid-proof", "Requester credential was not issued")
      const targetMemberCredential = authorities.memberCredentials.find((value) => value.core.memberId === afterMember.memberId) ?? fail("invalid-proof", "Target member credential was not issued")
      let actorCredential: ReplicaActorCredentialV2 | null = null
      let editAuthorization: ReplicaEditAuthorizationV2 | null = null
      let consumedReservationDigest: DigestV2 | null = null
      let reservationIndex = -1
      if (proof.core.purpose === "replica-enroll") {
        const enrollCore = proof.core
        reservationIndex = team.reservations.findIndex((record) => record.receipt.coreDigest === enrollCore.replicaIdReservationReceiptDigest)
        const reservation = team.reservations[reservationIndex]
        if (!reservation || reservation.state !== "reserved" || uint64ToBigIntV2(reservation.receipt.core.expiresAtUnixMs) <= BigInt(this.now())) fail("expired", "Replica reservation is not consumable")
        const replica = requireReplica(afterSnapshot, proof.core.newReplicaId)
        actorCredential = await this.signActorCredential(afterSnapshot, replica)
        consumedReservationDigest = reservation.receipt.coreDigest
      } else if (proof.core.purpose === "replica-activate-editor") {
        const replica = requireReplica(afterSnapshot, proof.core.currentReplicaId)
        editAuthorization = await this.signEditAuthorization(afterSnapshot, afterMember, replica, proof.core.installedFloorSetDigest)
      }
      const receiptCore: MutationReceiptCoreV2 = Object.freeze({
        format: "convax.mutation-receipt-core/2",
        mutationId: proof.core.mutationId,
        requestDigest: proof.requestDigest,
        purpose: proof.core.purpose,
        beforeMembershipSnapshotDigest: team.currentSnapshot.coreDigest,
        afterMembershipSnapshotDigest: afterSnapshot.coreDigest,
        consumedReplicaIdReservationReceiptDigest: consumedReservationDigest,
        issuedReplicaActorCredentialDigest: actorCredential?.coreDigest ?? null,
        issuedReplicaEditAuthorizationDigest: editAuthorization?.coreDigest ?? null,
        authorizationMutationDigest: null,
        cutoffCoverageRootCoreDigest: null,
        closedSessionCredentialDigests: [],
        protocolDigest: protocolDigest(),
        trustBundleDigest: this.configuration.trustBundleDigest,
        serviceKeyPurpose: "membership",
        serviceKeyId: serviceKeyIdV2(this.signatures),
      })
      const receipt: MutationReceiptV2 = await signArtifact("convax.mutation-receipt/2", "convax.mutation-receipt-core/2", receiptCore, this.signatures)
      const result: MembershipMutationResultV2 = Object.freeze({ receipt, membershipSnapshot: afterSnapshot, requesterCredential, requesterAdminCapability, targetMemberCredential, replicaActorCredential: actorCredential, replicaEditAuthorization: editAuthorization })
      const challenges = team.mutationChallenges.map((record, index) => index === challengeIndex ? { ...record, consumedRequestDigest: proof.requestDigest } : record)
      const reservations = reservationIndex < 0 ? team.reservations : team.reservations.map((record, index) => index !== reservationIndex ? record : {
        ...record,
        state: "consumed" as const,
        consumedMutationId: proof.core.mutationId,
        consumedMutationReceiptCoreDigest: receipt.coreDigest,
      })
      const nextTeam: CollaborationTeamAuthorityStateV2 = Object.freeze({
        ...team,
        currentSnapshot: afterSnapshot,
        snapshots: [...team.snapshots, afterSnapshot],
        memberCredentials: [...team.memberCredentials, ...authorities.memberCredentials],
        adminCapabilities: [...team.adminCapabilities, ...authorities.adminCapabilities],
        actorCredentials: actorCredential ? [...team.actorCredentials, actorCredential] : team.actorCredentials,
        editAuthorizations: editAuthorization ? [...team.editAuthorizations, editAuthorization] : team.editAuthorizations,
        reservations,
        mutationChallenges: challenges,
        mutationResults: [...team.mutationResults, { mutationId: proof.core.mutationId, requestDigest: proof.requestDigest, result }],
        memberAddSignatureHalves: proof.core.purpose === "member-add" ? team.memberAddSignatureHalves.filter((value) => value.requestDigest !== proof.requestDigest) : team.memberAddSignatureHalves,
        invitations: invitationIndex < 0 ? team.invitations : team.invitations.map((value, index) => index === invitationIndex ? { ...value, state: "consumed" as const } : value),
      })
      transaction.write({ ...state, seed: seedFromTeam(nextTeam, this.configuration, state.seed), team: nextTeam })
      return result
  }

  async issueCutoffChallenge(projectIdInput: ProjectIdV2, intentInput: CutoffMutationChallengeIntentV2): Promise<MutationChallengeV2> {
    const projectId = parseProjectIdV2(projectIdInput)
    const intent = normalizeCutoffIntent(intentInput)
    return this.store.transact(projectId, async (transaction) => {
      const state = requireTeamState(transaction.read())
      const team = state.team
      const snapshot = team.currentSnapshot
      const requester = requireCurrentMember(team, intent.requesterCredentialDigest)
      const pending = team.cutoffChallenges.filter((record) => record.consumedRequestDigest === null && uint64ToBigIntV2(record.challenge.core.expiresAtUnixMs) > BigInt(this.now()))
      if (pending.filter((record) => record.challenge.core.requesterMemberId === requester.memberId).length >= MAX_PENDING_MUTATION_CHALLENGES_PER_MEMBER) fail("capacity-exceeded", "Member cutoff challenge capacity is exhausted")
      if (intent.purpose === "member-role-change" || intent.purpose === "member-revoke") requireCurrentAdmin(team, requester, intent.adminCapabilityDigest)
      const prepared = this.prepareCutoff(state, requester, intent)
      const now = nowU64(this.clock)
      const targetMember = requireMember(snapshot, prepared.target.memberId)
      const core: MutationChallengeCoreV2 = Object.freeze({
        format: "convax.mutation-challenge-core/2",
        purpose: intent.purpose,
        challengeId: this.randomId128(),
        mutationId: intent.mutationId,
        projectId,
        projectEpoch: snapshot.core.projectEpoch,
        membershipEpoch: snapshot.core.membershipEpoch,
        expectedMembershipSequence: snapshot.core.membershipSequence,
        requesterMemberId: requester.memberId,
        targetMemberId: prepared.target.memberId,
        expectedTargetMemberMutationCounter: targetMember.memberMutationCounter,
        requesterCredentialDigest: intent.requesterCredentialDigest,
        replicaIdReservationReceiptDigest: intent.purpose === "replica-rotate" ? intent.replicaIdReservationReceiptDigest : null,
        requiredFloorSetDigest: null,
        preparedAfterMembershipSnapshotCoreDigest: structuredDigestV2("convax.membership-snapshot-core/2", prepared.afterCore),
        preparedCutoffCoverageRootCoreDigest: registryCutoffCoverageRootCoreDigestV2(prepared.rootCore),
        serverNonce: this.randomId128(),
        issuedAtUnixMs: now,
        expiresAtUnixMs: addU64(now, CHALLENGE_TTL_MS),
        protocolDigest: protocolDigest(),
        trustBundleDigest: this.configuration.trustBundleDigest,
        serviceKeyPurpose: "membership",
        serviceKeyId: serviceKeyIdV2(this.signatures),
      })
      const challenge = await signArtifact("convax.mutation-challenge/2", "convax.mutation-challenge-core/2", core, this.signatures)
      const nextTeam = Object.freeze({ ...team, cutoffChallenges: Object.freeze([...pending, Object.freeze({ challenge, intent, preparedAfterCore: prepared.afterCore, preparedPages: intent.pages, preparedRootCore: prepared.rootCore, consumedRequestDigest: null })]) })
      transaction.write({ ...state, team: nextTeam })
      return challenge
    })
  }

  async commitCutoffMutation(proofInput: MembershipMutationProofV2): Promise<CutoffMembershipMutationResultV2> {
    const proof = parseMembershipMutationProofV2(proofInput)
    if (proof.core.purpose !== "replica-rotate" && proof.core.purpose !== "replica-revoke" && proof.core.purpose !== "member-role-change" && proof.core.purpose !== "member-revoke") fail("invalid-proof", "Proof is not a cutoff mutation")
    return this.store.transact(proof.core.projectId, async (transaction) => {
      const state = requireTeamState(transaction.read())
      const team = state.team
      const existing = team.cutoffResults.find((record) => record.mutationId === proof.core.mutationId)
      if (existing) {
        if (existing.requestDigest !== proof.requestDigest) fail("equivocation", "Cutoff mutation id was reused with another digest")
        return existing.result
      }
      const challengeIndex = team.cutoffChallenges.findIndex((record) => record.challenge.coreDigest === proof.core.challengeDigest)
      const record = team.cutoffChallenges[challengeIndex]
      if (!record) fail("not-found", "Cutoff challenge was not found")
      if (record.consumedRequestDigest !== null) fail("equivocation", "Cutoff challenge was already consumed")
      if (uint64ToBigIntV2(record.challenge.core.expiresAtUnixMs) <= BigInt(this.now())) fail("expired", "Cutoff challenge expired")
      const requester = requireCurrentMember(team, record.challenge.core.requesterCredentialDigest)
      assertMutationBinding(proof, record.challenge.core, team.currentSnapshot, requester)
      const cutoffCoverageRootCoreDigest = cutoffDigestFromProof(proof)
      if (cutoffCoverageRootCoreDigest !== record.challenge.core.preparedCutoffCoverageRootCoreDigest) fail("invalid-proof", "Cutoff proof does not bind the prepared coverage root")
      assertCutoffProofIntent(proof, record.intent)
      await this.verifyMutationSignatures(proof, requester, team)
      if (structuredDigestV2("convax.membership-snapshot-core/2", record.preparedAfterCore) !== record.challenge.core.preparedAfterMembershipSnapshotCoreDigest || registryCutoffCoverageRootCoreDigestV2(record.preparedRootCore) !== record.challenge.core.preparedCutoffCoverageRootCoreDigest) fail("invalid-proof", "Prepared cutoff material changed")
      const beforeSnapshot = team.currentSnapshot
      const afterSnapshot = await this.signSnapshot(record.preparedAfterCore)
      if (afterSnapshot.coreDigest !== record.preparedRootCore.afterMembershipSnapshotDigest) fail("invalid-proof", "Prepared cutoff after-membership digest mismatch")
      const closedSessions = state.sessions.filter((session) => !session.closed && isCutoffSessionTarget(session.credential.core.memberId, session.credential.core.replicaId, record.preparedRootCore.target))
      if (closedSessions.length > 8) fail("capacity-exceeded", "Cutoff closes more than eight sessions")
      const closedSessionCredentialDigests = Object.freeze(closedSessions.map((session) => session.credential.coreDigest).sort())
      const coverageRoot = await signArtifactForPurpose("convax.registry-cutoff-coverage-root/2", "convax.registry-cutoff-coverage-root-core/2", record.preparedRootCore, "registry-cutoff", this.signatures)
      const authorizationCore: AuthorizationMutationCoreV2 = Object.freeze({ format: "convax.authorization-mutation-core/2", mutationId: proof.core.mutationId, projectId: proof.core.projectId, projectEpoch: proof.core.projectEpoch, membershipEpoch: proof.core.membershipEpoch, target: record.preparedRootCore.target, beforeMembershipSnapshotDigest: beforeSnapshot.coreDigest, afterMembershipSnapshotDigest: afterSnapshot.coreDigest, registryCutoffCoverageRootCoreDigest: coverageRoot.coreDigest, closedSessionCredentialDigests, protocolDigest: protocolDigest(), trustBundleDigest: this.configuration.trustBundleDigest, serviceKeyPurpose: "registry-cutoff", serviceKeyId: serviceKeyIdFor("registry-cutoff", this.signatures) })
      const authorizationMutation = await signArtifactForPurpose("convax.authorization-mutation/2", "convax.authorization-mutation-core/2", authorizationCore, "registry-cutoff", this.signatures)
      if (authorizationMutationCoreDigestV2(authorizationCore) !== authorizationMutation.coreDigest) fail("invalid-proof", "Authorization mutation digest changed")
      const afterRequester = requireMember(afterSnapshot, requester.memberId)
      const authorities = await this.signNextMemberAuthorities(team, afterSnapshot)
      const requesterAdminCapability = authorities.adminCapabilities.find((value) => value.core.adminMemberId === afterRequester.memberId) ?? null
      const requesterCredential = authorities.memberCredentials.find((value) => value.core.memberId === afterRequester.memberId) ?? fail("invalid-proof", "Requester credential was not issued")
      const afterTarget = afterSnapshot.core.members.find((member) => member.memberId === proof.core.targetMemberId)
      const targetMemberCredential = !afterTarget || afterTarget.state !== "active" ? null : authorities.memberCredentials.find((value) => value.core.memberId === afterTarget.memberId) ?? fail("invalid-proof", "Target member credential was not issued")
      let rotationActorCredential: ReplicaActorCredentialV2 | null = null
      let rotationReservationIndex = -1
      if (proof.core.purpose === "replica-rotate") {
        const rotationCore = proof.core
        rotationReservationIndex = team.reservations.findIndex((item) => item.receipt.coreDigest === rotationCore.replicaIdReservationReceiptDigest)
        const reservation = team.reservations[rotationReservationIndex]
        if (!reservation || reservation.state !== "reserved") fail("not-active", "Replica rotation reservation is not current")
        if (rotationCore.newReplicaId !== reservation.receipt.core.assignedReplicaId || rotationCore.newReplicaSigningPublicKey !== reservation.receipt.core.newReplicaSigningPublicKey || rotationCore.requestedEditState !== reservation.receipt.core.requestedEditState) fail("invalid-proof", "Replica rotation proof does not bind its reservation")
        rotationActorCredential = await this.signActorCredential(afterSnapshot, requireReplica(afterSnapshot, rotationCore.newReplicaId))
      }
      const receiptCore: MutationReceiptCoreV2 = Object.freeze({ format: "convax.mutation-receipt-core/2", mutationId: proof.core.mutationId, requestDigest: proof.requestDigest, purpose: proof.core.purpose, beforeMembershipSnapshotDigest: beforeSnapshot.coreDigest, afterMembershipSnapshotDigest: afterSnapshot.coreDigest, consumedReplicaIdReservationReceiptDigest: proof.core.purpose === "replica-rotate" ? proof.core.replicaIdReservationReceiptDigest : null, issuedReplicaActorCredentialDigest: rotationActorCredential?.coreDigest ?? null, issuedReplicaEditAuthorizationDigest: null, authorizationMutationDigest: authorizationMutation.coreDigest, cutoffCoverageRootCoreDigest: coverageRoot.coreDigest, closedSessionCredentialDigests, protocolDigest: protocolDigest(), trustBundleDigest: this.configuration.trustBundleDigest, serviceKeyPurpose: "membership", serviceKeyId: serviceKeyIdV2(this.signatures) })
      const receipt = await signArtifact("convax.mutation-receipt/2", "convax.mutation-receipt-core/2", receiptCore, this.signatures)
      const result = Object.freeze({ receipt, membershipSnapshot: afterSnapshot, requesterCredential, requesterAdminCapability, targetMemberCredential, coverageRoot, authorizationMutation, replicaActorCredential: rotationActorCredential, replicaEditAuthorization: null })
      const reservations = rotationReservationIndex < 0 ? team.reservations : team.reservations.map((item, index) => index !== rotationReservationIndex ? item : { ...item, state: "consumed" as const, consumedMutationId: proof.core.mutationId, consumedMutationReceiptCoreDigest: receipt.coreDigest })
      const nextTeam: CollaborationTeamAuthorityStateV2 = Object.freeze({ ...team, currentSnapshot: afterSnapshot, snapshots: Object.freeze([...team.snapshots, afterSnapshot]), memberCredentials: Object.freeze([...team.memberCredentials, ...authorities.memberCredentials]), adminCapabilities: Object.freeze([...team.adminCapabilities, ...authorities.adminCapabilities]), actorCredentials: rotationActorCredential ? Object.freeze([...team.actorCredentials, rotationActorCredential]) : team.actorCredentials, reservations, cutoffChallenges: Object.freeze(team.cutoffChallenges.map((value, index) => index === challengeIndex ? { ...value, consumedRequestDigest: proof.requestDigest } : value)), cutoffResults: Object.freeze([...team.cutoffResults, Object.freeze({ mutationId: proof.core.mutationId, requestDigest: proof.requestDigest, result })]) })
      const sessions = Object.freeze(state.sessions.map((session) => closedSessionCredentialDigests.includes(session.credential.coreDigest) ? { ...session, closed: true } : session))
      const metadata = metadataForCutoff(state)
      const nextMetadata = Object.freeze({ ...metadata, cutoffCommits: Object.freeze([...metadata.cutoffCommits, Object.freeze({ pages: record.preparedPages, root: coverageRoot, authorizationMutation })]) })
      transaction.write({ ...state, seed: seedFromTeam(nextTeam, this.configuration, state.seed), team: nextTeam, sessions, metadata: nextMetadata })
      return result
    })
  }

  private prepareCutoff(state: CollaborationControlProjectStateV2 & { readonly team: CollaborationTeamAuthorityStateV2 }, requester: MembershipMemberV2, intent: CutoffMutationChallengeIntentV2): Readonly<{ afterCore: MembershipSnapshotCoreV2; target: RegistryCutoffTargetV2; rootCore: RegistryCutoffCoverageRootCoreV2 }> {
    const before = state.team.currentSnapshot
    const nextSequence = incrementUint64V2(before.core.membershipSequence)
    let members = [...before.core.members]
    let replicas = [...before.core.replicas]
    let target: RegistryCutoffTargetV2
    if (intent.purpose === "replica-revoke" || intent.purpose === "replica-rotate") {
      const replica = requireReplica(before, intent.currentReplicaId)
      if (replica.memberId !== requester.memberId) fail("not-active", "A member may revoke only its own replica")
      const member = requireMember(before, requester.memberId)
      target = Object.freeze({ kind: "replica", action: "revoke", memberId: member.memberId, priorMemberAuthorizationEpoch: member.memberAuthorizationEpoch, replicaId: replica.replicaId, actorId: replica.actorId, priorReplicaAuthorizationEpoch: replica.replicaAuthorizationEpoch })
      members = members.map((value) => value.memberId === member.memberId ? { ...value, memberMutationCounter: incrementUint64V2(value.memberMutationCounter) } : value)
      replicas = replicas.map((value) => value.replicaId === replica.replicaId ? { ...value, state: "revoked" as const, editState: "none" as const, revokedAtMembershipSequence: nextSequence } : value)
      if (intent.purpose === "replica-rotate") {
        const reservation = state.team.reservations.find((item) => item.receipt.coreDigest === intent.replicaIdReservationReceiptDigest)
        if (!reservation || reservation.state !== "reserved" || reservation.receipt.core.purpose !== "replica-rotate" || reservation.receipt.core.currentReplicaId !== replica.replicaId || reservation.receipt.core.targetMemberId !== member.memberId || uint64ToBigIntV2(reservation.receipt.core.expiresAtUnixMs) <= BigInt(this.now())) fail("not-active", "Replica rotation reservation is not consumable")
        const actorId = deriveActorId(before.core.projectId, before.core.projectEpoch, member.memberId, reservation.receipt.core.assignedReplicaId, reservation.receipt.core.newReplicaSigningPublicKey)
        replicas.push(Object.freeze({ replicaId: reservation.receipt.core.assignedReplicaId, replicaIdReservationReceiptDigest: reservation.receipt.coreDigest, memberId: member.memberId, actorId, replicaSigningPublicKey: reservation.receipt.core.newReplicaSigningPublicKey, state: "active", editState: reservation.receipt.core.requestedEditState, replicaAuthorizationEpoch: this.randomId128(), enrolledAtMembershipSequence: nextSequence, revokedAtMembershipSequence: null, replacesReplicaId: replica.replicaId }))
        replicas.sort((left, right) => left.replicaId.localeCompare(right.replicaId))
      }
    } else {
      const member = requireMember(before, intent.targetMemberId)
      if (intent.purpose === "member-revoke" && member.memberId === requester.memberId) fail("not-active", "An admin cannot revoke itself")
      const activeEditors = replicas.filter((replica) => replica.memberId === member.memberId && replica.state === "active" && replica.editState === "active-editor")
      target = Object.freeze({ kind: "member", action: intent.purpose === "member-revoke" ? "revoke" : "downgrade-to-viewer", memberId: member.memberId, priorMemberAuthorizationEpoch: member.memberAuthorizationEpoch, targetedReplicaActorSet: Object.freeze(activeEditors.map((replica) => Object.freeze({ replicaId: replica.replicaId, actorId: replica.actorId, priorReplicaAuthorizationEpoch: replica.replicaAuthorizationEpoch })).sort((left, right) => left.replicaId.localeCompare(right.replicaId))) })
      members = members.map((value) => value.memberId !== member.memberId ? value : { ...value, role: intent.purpose === "member-revoke" ? value.role : "viewer" as const, state: intent.purpose === "member-revoke" ? "revoked" as const : "active" as const, memberAuthorizationEpoch: this.randomId128(), memberMutationCounter: incrementUint64V2(value.memberMutationCounter) })
      replicas = replicas.map((value) => value.memberId !== member.memberId ? value : intent.purpose === "member-revoke" ? { ...value, state: "revoked" as const, editState: "none" as const, revokedAtMembershipSequence: nextSequence } : { ...value, editState: "none" as const, replicaAuthorizationEpoch: this.randomId128() })
    }
    const afterCore = Object.freeze({ ...before.core, membershipSequence: nextSequence, registrySequence: state.seed.registrySequence, registryRootDigest: state.seed.registryRootDigest, members: Object.freeze(members), replicas: Object.freeze(replicas) })
    const afterDigest = structuredDigestV2("convax.membership-snapshot-core/2", afterCore)
    verifyCutoffPages(intent.pages, intent.cutoffId, state)
    const pageDigests = Object.freeze(intent.pages.map((page) => page.coreDigest))
    const leafCount = intent.pages.reduce((count, page) => count + page.core.leaves.length, 0)
    const rootCore: RegistryCutoffCoverageRootCoreV2 = Object.freeze({ format: "convax.registry-cutoff-coverage-root-core/2", projectId: before.core.projectId, projectEpoch: before.core.projectEpoch, cutoffId: intent.cutoffId, target, beforeMembershipSnapshotDigest: before.coreDigest, afterMembershipSnapshotDigest: afterDigest, registrySequence: state.seed.registrySequence, registryRootDigest: state.seed.registryRootDigest, unlistedScopePolicy: "empty-target-frontier", pageDigests, leafCount: parseUint32V2(String(leafCount)), protocolDigest: protocolDigest(), trustBundleDigest: this.configuration.trustBundleDigest, serviceKeyPurpose: "registry-cutoff", serviceKeyId: serviceKeyIdFor("registry-cutoff", this.signatures) })
    return Object.freeze({ afterCore, target, rootCore })
  }

  private prepareAfterSnapshot(team: CollaborationTeamAuthorityStateV2, requester: MembershipMemberV2, intent: SupportedMutationChallengeIntentV2, currentProjection: CollaborationProjectSeedV2): MembershipSnapshotCoreV2 {
    const before = team.currentSnapshot
    const nextSequence = incrementUint64V2(before.core.membershipSequence)
    let members = [...before.core.members]
    let replicas = [...before.core.replicas]
    if (intent.purpose === "member-add") {
      if (members.some((value) => value.memberId === intent.targetMemberId || value.memberSigningPublicKey === intent.targetMemberSigningPublicKey)) fail("invalid-proof", "Member id or key is already retained")
      members.push(Object.freeze({ memberId: intent.targetMemberId, memberSigningPublicKey: intent.targetMemberSigningPublicKey, role: intent.initialRole, state: "active", memberAuthorizationEpoch: this.randomId128(), memberMutationCounter: parseUint64V2("1") }))
      members.sort((left, right) => compareDecodedBase64urlV2(left.memberId, right.memberId))
    } else if (intent.purpose === "replica-enroll") {
      const reservation = team.reservations.find((record) => record.receipt.coreDigest === intent.replicaIdReservationReceiptDigest)
      if (!reservation || reservation.state !== "reserved" || uint64ToBigIntV2(reservation.receipt.core.expiresAtUnixMs) <= BigInt(this.now())) fail("expired", "Replica reservation is not active")
      if (reservation.receipt.core.targetMemberId !== requester.memberId || reservation.receipt.core.purpose !== "replica-enroll") fail("invalid-proof", "Replica reservation does not bind requester")
      const member = requireMember(before, requester.memberId)
      members = members.map((value) => value.memberId !== member.memberId ? value : { ...value, memberMutationCounter: incrementUint64V2(value.memberMutationCounter) })
      const actorId = deriveActorId(before.core.projectId, before.core.projectEpoch, member.memberId, reservation.receipt.core.assignedReplicaId, reservation.receipt.core.newReplicaSigningPublicKey)
      replicas.push(Object.freeze({
        replicaId: reservation.receipt.core.assignedReplicaId,
        replicaIdReservationReceiptDigest: reservation.receipt.coreDigest,
        memberId: member.memberId,
        actorId,
        replicaSigningPublicKey: reservation.receipt.core.newReplicaSigningPublicKey,
        state: "active",
        editState: reservation.receipt.core.requestedEditState,
        replicaAuthorizationEpoch: this.randomId128(),
        enrolledAtMembershipSequence: nextSequence,
        revokedAtMembershipSequence: null,
        replacesReplicaId: null,
      }))
      replicas.sort((left, right) => left.replicaId.localeCompare(right.replicaId))
    } else {
      const member = requireMember(before, requester.memberId)
      const replica = requireReplica(before, intent.currentReplicaId)
      if (member.role !== "editor" || replica.memberId !== member.memberId || replica.state !== "active" || replica.editState !== "pending-editor") fail("not-active", "Replica is not a pending editor")
      members = members.map((value) => value.memberId !== member.memberId ? value : { ...value, memberMutationCounter: incrementUint64V2(value.memberMutationCounter) })
      replicas = replicas.map((value) => value.replicaId !== replica.replicaId ? value : { ...value, editState: "active-editor" as const })
    }
    return Object.freeze({ ...before.core, membershipSequence: nextSequence, registrySequence: currentProjection.registrySequence, registryRootDigest: currentProjection.registryRootDigest, members: Object.freeze(members), replicas: Object.freeze(replicas) })
  }

  private async verifyMutationSignatures(proof: MembershipMutationProofV2, requester: MembershipMemberV2, team: CollaborationTeamAuthorityStateV2): Promise<void> {
    if (proof.core.purpose === "member-add") {
      if (proof.signatures.purpose !== "member-add") fail("invalid-proof", "Mutation signature branch is invalid")
      requireCurrentAdmin(team, requester, proof.core.adminCapabilityDigest)
      if (!await this.signatures.verifyPublicKeyDigest(requester.memberSigningPublicKey, proof.requestDigest, proof.signatures.adminSignature)) fail("invalid-proof", "Admin signature is invalid")
      if (!await this.signatures.verifyPublicKeyDigest(proof.core.targetMemberSigningPublicKey, proof.requestDigest, proof.signatures.targetMemberPossessionSignature)) fail("invalid-proof", "Target member possession signature is invalid")
      return
    }
    if (proof.core.purpose === "member-role-change" || proof.core.purpose === "member-revoke") {
      if (proof.signatures.purpose !== proof.core.purpose) fail("invalid-proof", "Mutation signature branch is invalid")
      requireCurrentAdmin(team, requester, proof.core.adminCapabilityDigest)
      if (!("adminSignature" in proof.signatures) || !await this.signatures.verifyPublicKeyDigest(requester.memberSigningPublicKey, proof.requestDigest, proof.signatures.adminSignature)) fail("invalid-proof", "Admin mutation signature is invalid")
      return
    }
    if (proof.signatures.purpose !== proof.core.purpose) fail("invalid-proof", "Mutation signature branch is invalid")
    if (!("memberSignature" in proof.signatures) || !await this.signatures.verifyPublicKeyDigest(requester.memberSigningPublicKey, proof.requestDigest, proof.signatures.memberSignature)) fail("invalid-proof", "Member signature is invalid")
  }

  private async signSnapshot(core: MembershipSnapshotCoreV2): Promise<MembershipSnapshotV2> {
    return signArtifact("convax.membership-snapshot/2", "convax.membership-snapshot-core/2", core, this.signatures)
  }

  private async signNextMemberAuthorities(team: CollaborationTeamAuthorityStateV2, snapshot: MembershipSnapshotV2): Promise<Readonly<{
    memberCredentials: readonly MemberCredentialV2[]
    adminCapabilities: readonly ProjectAdminCapabilityV2[]
  }>> {
    const priorAdminIds = new Set(team.adminCapabilities
      .filter((value) => value.core.membershipSnapshotDigest === team.currentSnapshot.coreDigest)
      .map((value) => value.core.adminMemberId))
    const adminCapabilities: ProjectAdminCapabilityV2[] = []
    const memberCredentials: MemberCredentialV2[] = []
    for (const member of snapshot.core.members) {
      if (member.state !== "active") continue
      const adminCapability = priorAdminIds.has(member.memberId) && member.role === "editor" ? await this.signAdminCapability(snapshot, member) : null
      if (adminCapability) adminCapabilities.push(adminCapability)
      memberCredentials.push(await this.signMemberCredential(snapshot, member, adminCapability?.coreDigest ?? null))
    }
    return Object.freeze({ memberCredentials: Object.freeze(memberCredentials), adminCapabilities: Object.freeze(adminCapabilities) })
  }

  private async signAdminCapability(snapshot: MembershipSnapshotV2, member: MembershipMemberV2): Promise<ProjectAdminCapabilityV2> {
    const core: ProjectAdminCapabilityCoreV2 = Object.freeze({ format: "convax.project-admin-capability-core/2", projectId: snapshot.core.projectId, projectEpoch: snapshot.core.projectEpoch, membershipEpoch: snapshot.core.membershipEpoch, membershipSnapshotDigest: snapshot.coreDigest, adminMemberId: member.memberId, adminMemberAuthorizationEpoch: member.memberAuthorizationEpoch, grants: ["membership-admin"] as const, protocolDigest: protocolDigest(), trustBundleDigest: this.configuration.trustBundleDigest, serviceKeyPurpose: "membership", serviceKeyId: serviceKeyIdV2(this.signatures) })
    return signArtifact("convax.project-admin-capability/2", "convax.project-admin-capability-core/2", core, this.signatures)
  }

  private async signMemberCredential(snapshot: MembershipSnapshotV2, member: MembershipMemberV2, adminCapabilityDigest: DigestV2 | null): Promise<MemberCredentialV2> {
    const core: MemberCredentialCoreV2 = Object.freeze({ format: "convax.member-credential-core/2", projectId: snapshot.core.projectId, projectEpoch: snapshot.core.projectEpoch, membershipEpoch: snapshot.core.membershipEpoch, membershipSnapshotDigest: snapshot.coreDigest, memberId: member.memberId, memberSigningPublicKey: member.memberSigningPublicKey, role: member.role, memberAuthorizationEpoch: member.memberAuthorizationEpoch, adminCapabilityDigest, protocolDigest: protocolDigest(), trustBundleDigest: this.configuration.trustBundleDigest, serviceKeyPurpose: "membership", serviceKeyId: serviceKeyIdV2(this.signatures) })
    return signArtifact("convax.member-credential/2", "convax.member-credential-core/2", core, this.signatures)
  }

  private async signActorCredential(snapshot: MembershipSnapshotV2, replica: MembershipReplicaV2): Promise<ReplicaActorCredentialV2> {
    const core: ReplicaActorCredentialCoreV2 = Object.freeze({ format: "convax.replica-actor-credential-core/2", projectId: snapshot.core.projectId, projectEpoch: snapshot.core.projectEpoch, memberId: replica.memberId, replicaId: replica.replicaId, replicaIdReservationReceiptDigest: replica.replicaIdReservationReceiptDigest, actorId: replica.actorId, replicaSigningPublicKey: replica.replicaSigningPublicKey, replicaAuthorizationEpoch: replica.replicaAuthorizationEpoch, protocolDigest: protocolDigest(), trustBundleDigest: this.configuration.trustBundleDigest, serviceKeyPurpose: "membership", serviceKeyId: serviceKeyIdV2(this.signatures) })
    return signArtifact("convax.replica-actor-credential/2", "convax.replica-actor-credential-core/2", core, this.signatures)
  }

  private async signEditAuthorization(snapshot: MembershipSnapshotV2, member: MembershipMemberV2, replica: MembershipReplicaV2, floor: DigestV2): Promise<ReplicaEditAuthorizationV2> {
    const core: ReplicaEditAuthorizationCoreV2 = Object.freeze({ format: "convax.replica-edit-authorization-core/2", projectId: snapshot.core.projectId, projectEpoch: snapshot.core.projectEpoch, membershipEpoch: snapshot.core.membershipEpoch, membershipSnapshotDigest: snapshot.coreDigest, membershipSequence: snapshot.core.membershipSequence, memberId: member.memberId, memberAuthorizationEpoch: member.memberAuthorizationEpoch, replicaId: replica.replicaId, replicaIdReservationReceiptDigest: replica.replicaIdReservationReceiptDigest, actorId: replica.actorId, replicaAuthorizationEpoch: replica.replicaAuthorizationEpoch, role: "editor", editState: "active-editor", installedFloorSetDigest: floor, protocolDigest: protocolDigest(), schemaDigest: this.configuration.schemaDigest, validationArtifactSetDigest: this.configuration.validationArtifactSetDigest, trustBundleDigest: this.configuration.trustBundleDigest, serviceKeyPurpose: "membership", serviceKeyId: serviceKeyIdV2(this.signatures) })
    return signArtifact("convax.replica-edit-authorization/2", "convax.replica-edit-authorization-core/2", core, this.signatures)
  }

  private randomId128(): Id128V2 {
    const bytes = new Uint8Array(16)
    this.random.fill(bytes)
    return parseId128V2(encodeBase64urlV2(bytes))
  }

  private randomInvitationToken(): string { return this.randomId128() }

  private now(): number { return this.clock.nowEpochMilliseconds() }
}

async function signArtifact<const Format extends string, const Domain extends `${string}/2`, const Core extends object>(format: Format, coreDomain: Domain, core: Core, signatures: ControlDigestSignaturePortV2): Promise<Readonly<{ format: Format; core: Core; coreDigest: DigestV2; serviceSignature: SignatureV2 }>> {
  const coreDigest = structuredDigestV2(coreDomain, core)
  return Object.freeze({ format, core, coreDigest, serviceSignature: parseSignatureV2(await signatures.signServiceDigest("membership", coreDigest)) })
}

async function signArtifactForPurpose<const Format extends string, const Domain extends `${string}/2`, const Core extends object>(format: Format, coreDomain: Domain, core: Core, purpose: "registry-cutoff", signatures: ControlDigestSignaturePortV2): Promise<Readonly<{ format: Format; core: Core; coreDigest: DigestV2; serviceSignature: SignatureV2 }>> {
  const coreDigest = structuredDigestV2(coreDomain, core)
  return Object.freeze({ format, core, coreDigest, serviceSignature: parseSignatureV2(await signatures.signServiceDigest(purpose, coreDigest)) })
}

function requireTeamState(value: CollaborationControlProjectStateV2 | null): CollaborationControlProjectStateV2 & { readonly team: CollaborationTeamAuthorityStateV2 } {
  if (!value || value.format !== "convax.control-project-state/2" || !value.team) fail("not-found", "Team Project is not provisioned")
  return value as CollaborationControlProjectStateV2 & { readonly team: CollaborationTeamAuthorityStateV2 }
}

function requireCurrentMember(team: CollaborationTeamAuthorityStateV2, credentialDigest: DigestV2): MembershipMemberV2 {
  const credential = findLastV2(team.memberCredentials, (value) => value.coreDigest === credentialDigest)
  if (!credential) fail("not-active", "Member credential is not current")
  const member = requireMember(team.currentSnapshot, credential.core.memberId)
  if (member.state !== "active" || member.memberAuthorizationEpoch !== credential.core.memberAuthorizationEpoch || member.memberSigningPublicKey !== credential.core.memberSigningPublicKey || member.role !== credential.core.role) fail("not-active", "Member credential no longer matches current membership")
  return member
}

function requireCurrentAdmin(team: CollaborationTeamAuthorityStateV2, member: MembershipMemberV2, digest: DigestV2): ProjectAdminCapabilityV2 {
  const capability = findLastV2(team.adminCapabilities, (value) => value.coreDigest === digest)
  if (!capability || capability.core.adminMemberId !== member.memberId || capability.core.adminMemberAuthorizationEpoch !== member.memberAuthorizationEpoch || capability.core.membershipSnapshotDigest !== team.currentSnapshot.coreDigest) fail("not-active", "Admin capability is not current")
  return capability
}

function requireMember(snapshot: MembershipSnapshotV2, memberId: MemberIdV2): MembershipMemberV2 {
  const member = snapshot.core.members.find((value) => value.memberId === memberId)
  if (!member || member.state !== "active") fail("not-active", "Membership member is not active")
  return member
}

function requireReplica(snapshot: MembershipSnapshotV2, replicaId: ReplicaIdV2): MembershipReplicaV2 {
  const replica = snapshot.core.replicas.find((value) => value.replicaId === replicaId)
  if (!replica || replica.state !== "active") fail("not-active", "Membership replica is not active")
  return replica
}

function assertReservationBinding(request: ReplicaIdReservationRequestV2, snapshot: MembershipSnapshotV2, member: MembershipMemberV2, team: CollaborationTeamAuthorityStateV2): void {
  const core = request.core
  if (core.projectEpoch !== snapshot.core.projectEpoch || core.membershipEpoch !== snapshot.core.membershipEpoch || core.expectedMembershipSequence !== snapshot.core.membershipSequence || core.requesterMemberId !== member.memberId || core.targetMemberId !== member.memberId || core.expectedTargetMemberMutationCounter !== member.memberMutationCounter || core.protocolDigest !== protocolDigest()) fail("stale-counter", "Replica reservation does not bind current member state")
  if (core.purpose === "replica-enroll" && core.currentReplicaId !== null) fail("invalid-proof", "Replica enroll reservation must not name a current replica")
  if (team.currentSnapshot.core.replicas.some((value) => value.replicaSigningPublicKey === core.newReplicaSigningPublicKey) || team.reservations.some((value) => value.receipt.core.newReplicaSigningPublicKey === core.newReplicaSigningPublicKey)) fail("invalid-proof", "Replica signing key is already retained")
}

function assertMutationBinding(proof: MembershipMutationProofV2, challenge: MutationChallengeCoreV2, snapshot: MembershipSnapshotV2, requester: MembershipMemberV2): void {
  const core = proof.core
  if (core.purpose !== challenge.purpose || core.mutationId !== challenge.mutationId || core.projectId !== challenge.projectId || core.projectEpoch !== challenge.projectEpoch || core.membershipEpoch !== challenge.membershipEpoch || core.expectedMembershipSequence !== snapshot.core.membershipSequence || core.requesterMemberId !== requester.memberId || core.targetMemberId !== challenge.targetMemberId || core.serverNonce !== challenge.serverNonce || core.targetMemberMutationCounter !== incrementUint64V2(challenge.expectedTargetMemberMutationCounter)) fail("stale-counter", "Mutation proof does not bind the current challenge")
  if (membershipMutationProofCoreDigestV2(core) !== proof.requestDigest) fail("invalid-proof", "Mutation proof digest is invalid")
  if (core.purpose === "replica-enroll" && (core.replicaIdReservationReceiptDigest !== challenge.replicaIdReservationReceiptDigest || core.newReplicaId === null)) fail("invalid-proof", "Mutation proof does not bind replica reservation")
  if (core.purpose === "replica-activate-editor" && core.installedFloorSetDigest !== challenge.requiredFloorSetDigest) fail("invalid-proof", "Mutation proof does not bind required floor")
}

function memberAddProofCoreV2(
  challenge: MutationChallengeV2,
  intent: Pick<MemberAddChallengeIntentV2, "targetMemberSigningPublicKey" | "initialRole" | "adminCapabilityDigest">,
): Extract<MembershipMutationProofV2["core"], { readonly purpose: "member-add" }> {
  if (challenge.core.purpose !== "member-add") fail("invalid-proof", "Member-add proof requires a member-add challenge")
  return Object.freeze({
    format: "convax.mutation-proof-core/2",
    mutationId: challenge.core.mutationId,
    challengeDigest: challenge.coreDigest,
    projectId: challenge.core.projectId,
    projectEpoch: challenge.core.projectEpoch,
    membershipEpoch: challenge.core.membershipEpoch,
    expectedMembershipSequence: challenge.core.expectedMembershipSequence,
    requesterMemberId: challenge.core.requesterMemberId,
    targetMemberId: challenge.core.targetMemberId,
    targetMemberMutationCounter: incrementUint64V2(challenge.core.expectedTargetMemberMutationCounter),
    serverNonce: challenge.core.serverNonce,
    purpose: "member-add",
    targetMemberSigningPublicKey: parsePublicKeyV2(intent.targetMemberSigningPublicKey),
    initialRole: role(intent.initialRole),
    adminCapabilityDigest: parseDigestV2(intent.adminCapabilityDigest),
  })
}

function normalizeIntent(value: SupportedMutationChallengeIntentV2): SupportedMutationChallengeIntentV2 {
  const base = { purpose: value.purpose, mutationId: parseId128V2(value.mutationId), requesterCredentialDigest: parseDigestV2(value.requesterCredentialDigest) }
  if (value.purpose === "member-add") return Object.freeze({ ...base, purpose: "member-add", adminCapabilityDigest: parseDigestV2(value.adminCapabilityDigest), targetMemberId: parseMemberIdV2(value.targetMemberId), targetMemberSigningPublicKey: parsePublicKeyV2(value.targetMemberSigningPublicKey), initialRole: role(value.initialRole), ...(value.invitationToken ? { invitationToken: parseInvitationToken(value.invitationToken) } : {}) })
  if (value.purpose === "replica-enroll") return Object.freeze({ ...base, purpose: "replica-enroll", replicaIdReservationReceiptDigest: parseDigestV2(value.replicaIdReservationReceiptDigest) })
  return Object.freeze({ ...base, purpose: "replica-activate-editor", currentReplicaId: parseReplicaIdV2(value.currentReplicaId), installedFloorSetDigest: parseDigestV2(value.installedFloorSetDigest) })
}

function normalizeCutoffIntent(value: CutoffMutationChallengeIntentV2): CutoffMutationChallengeIntentV2 {
  const base = { purpose: value.purpose, mutationId: parseId128V2(value.mutationId), cutoffId: parseId128V2(value.cutoffId), requesterCredentialDigest: parseDigestV2(value.requesterCredentialDigest), pages: Object.freeze(value.pages.map(parseRegistryCutoffCoveragePageV2)) }
  if (value.purpose === "replica-rotate") return Object.freeze({ ...base, purpose: "replica-rotate", currentReplicaId: parseReplicaIdV2(value.currentReplicaId), replicaIdReservationReceiptDigest: parseDigestV2(value.replicaIdReservationReceiptDigest) })
  if (value.purpose === "replica-revoke") return Object.freeze({ ...base, purpose: "replica-revoke", currentReplicaId: parseReplicaIdV2(value.currentReplicaId) })
  if (value.purpose === "member-role-change") {
    if (value.nextRole !== "viewer") fail("invalid-proof", "Cutoff role change must be a downgrade to viewer")
    return Object.freeze({ ...base, purpose: "member-role-change", adminCapabilityDigest: parseDigestV2(value.adminCapabilityDigest), targetMemberId: parseMemberIdV2(value.targetMemberId), nextRole: "viewer" })
  }
  return Object.freeze({ ...base, purpose: "member-revoke", adminCapabilityDigest: parseDigestV2(value.adminCapabilityDigest), targetMemberId: parseMemberIdV2(value.targetMemberId) })
}

function assertCutoffProofIntent(proof: MembershipMutationProofV2, intent: CutoffMutationChallengeIntentV2): void {
  if (proof.core.purpose !== intent.purpose) fail("invalid-proof", "Cutoff proof purpose differs from its prepared intent")
  if (proof.core.purpose === "replica-rotate" && intent.purpose === "replica-rotate") {
    if (proof.core.currentReplicaId !== intent.currentReplicaId || proof.core.replicaIdReservationReceiptDigest !== intent.replicaIdReservationReceiptDigest) fail("invalid-proof", "Replica rotation proof differs from its prepared intent")
    return
  }
  if (proof.core.purpose === "replica-revoke" && intent.purpose === "replica-revoke") {
    if (proof.core.currentReplicaId !== intent.currentReplicaId) fail("invalid-proof", "Replica revoke proof names another replica")
    return
  }
  if (proof.core.purpose === "member-role-change" && intent.purpose === "member-role-change") {
    if (proof.core.targetMemberId !== intent.targetMemberId || proof.core.nextRole !== intent.nextRole || proof.core.adminCapabilityDigest !== intent.adminCapabilityDigest) fail("invalid-proof", "Member downgrade proof differs from its prepared intent")
    return
  }
  if (proof.core.purpose === "member-revoke" && intent.purpose === "member-revoke") {
    if (proof.core.targetMemberId !== intent.targetMemberId || proof.core.adminCapabilityDigest !== intent.adminCapabilityDigest) fail("invalid-proof", "Member revoke proof differs from its prepared intent")
    return
  }
  fail("invalid-proof", "Cutoff proof branch is invalid")
}

function cutoffDigestFromProof(proof: MembershipMutationProofV2): DigestV2 {
  switch (proof.core.purpose) {
    case "replica-rotate":
    case "replica-revoke":
    case "member-role-change":
    case "member-revoke":
      return proof.core.cutoffCoverageRootCoreDigest ?? fail("invalid-proof", "Shrinking mutation requires cutoff coverage")
    default:
      return fail("invalid-proof", "Mutation proof is not a cutoff branch")
  }
}

function verifyCutoffPages(pages: readonly RegistryCutoffCoveragePageV2[], cutoffId: Id128V2, state: CollaborationControlProjectStateV2): void {
  if (pages.length > 8) fail("capacity-exceeded", "Cutoff coverage exceeds eight pages")
  const entries = metadataForCutoff(state).registryEntries
  const leaves = pages.flatMap((page, index) => {
    if (page.core.cutoffId !== cutoffId || page.core.pageIndex !== String(index)) fail("invalid-proof", "Cutoff coverage page sequence is invalid")
    return page.core.leaves
  })
  if (leaves.length !== entries.length) fail("invalid-proof", "Cutoff coverage does not contain every retained registry entry")
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    const leaf = leaves[index]!
    if (leaf.entryIdentity.scopeKey !== entry.core.scopeKey || leaf.entryIdentity.registrarReplicaId !== entry.core.registrarReplicaId || leaf.entryIdentity.claimRevision !== entry.core.claimRevision || leaf.entryDigest !== entry.coreDigest || leaf.entryState !== entry.core.state) fail("invalid-proof", "Cutoff leaf does not bind the exact registry entry")
  }
}

function isCutoffSessionTarget(memberId: MemberIdV2, replicaId: ReplicaIdV2, target: RegistryCutoffTargetV2): boolean {
  return target.kind === "replica" ? replicaId === target.replicaId : memberId === target.memberId
}

function metadataForCutoff(state: CollaborationControlProjectStateV2): NonNullable<CollaborationControlProjectStateV2["metadata"]> {
  return state.metadata ?? Object.freeze({ format: "convax.metadata-control-state/2", contentCertificates: [], stableSets: [], projectFloors: [], replicaFloorAcks: [], registrationClaims: [], registrationAbandonments: [], registryEntries: [], registrySnapshots: [], cutoffCommits: [], shardResetApprovals: [], projectResetRolloverReceipts: [] })
}

function parseInvitationToken(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{22}$/u.test(value)) fail("invalid-proof", "Invitation token is invalid")
  return value
}

function requireOpenInvitation(team: CollaborationTeamAuthorityStateV2, token: string, now: number): TeamInvitationStateV1 {
  const invitation = team.invitations.find((value) => value.invitationToken === token)
  if (!invitation || invitation.state !== "open") fail("not-active", "Invitation is not open")
  if (uint64ToBigIntV2(invitation.expiresAtUnixMs) <= BigInt(now)) fail("expired", "Invitation expired")
  return invitation
}

function projectInvitation(value: TeamInvitationStateV1): TeamInvitationV1 {
  return Object.freeze({ invitationToken: value.invitationToken, projectId: value.projectId, initialRole: value.initialRole, expiresAtUnixMs: value.expiresAtUnixMs })
}

function seedFromTeam(team: CollaborationTeamAuthorityStateV2, configuration: TeamControlProtocolConfigurationV2, prior: CollaborationProjectSeedV2 | null): CollaborationProjectSeedV2 {
  const snapshot = team.currentSnapshot
  const members: CollaborationMemberSeedV2[] = snapshot.core.members.map((member) => ({
    memberId: member.memberId,
    memberAuthorizationEpoch: member.memberAuthorizationEpoch,
    role: member.role,
    active: member.state === "active",
    replicas: snapshot.core.replicas.filter((replica) => replica.memberId === member.memberId).map((replica): CollaborationReplicaSeedV2 => ({
      replicaId: replica.replicaId,
      actorId: replica.actorId,
      replicaAuthorizationEpoch: replica.replicaAuthorizationEpoch,
      replicaSigningPublicKey: replica.replicaSigningPublicKey,
      editState: replica.editState,
      sessionCounter: prior?.members.flatMap((value) => value.replicas).find((value) => value.replicaId === replica.replicaId)?.sessionCounter ?? parseUint64V2("1"),
      active: replica.state === "active",
    })),
  }))
  return Object.freeze({ projectId: snapshot.core.projectId, projectEpoch: snapshot.core.projectEpoch, membershipEpoch: snapshot.core.membershipEpoch, membershipSequence: snapshot.core.membershipSequence, membershipSnapshotDigest: snapshot.coreDigest, registrySequence: snapshot.core.registrySequence, registryRootDigest: snapshot.core.registryRootDigest, schemaDigest: configuration.schemaDigest, validationArtifactSetDigest: configuration.validationArtifactSetDigest, trustBundleDigest: configuration.trustBundleDigest, members })
}

function deriveActorId(projectId: ProjectIdV2, projectEpoch: Id128V2, memberId: MemberIdV2, replicaId: ReplicaIdV2, replicaSigningPublicKey: PublicKeyV2) {
  const digest = structuredDigestV2("convax.replica-actor-id/2", { projectId, projectEpoch, memberId, replicaId, replicaSigningPublicKey })
  const bytes = new Uint8Array(32)
  for (let index = 0; index < 32; index += 1) bytes[index] = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16)
  return parseActorIdV2(encodeBase64urlV2(bytes))
}

function nextReplicaId(current: ReplicaIdV2 | null): ReplicaIdV2 {
  const next = current === null ? 1 : Number.parseInt(current.slice(8), 16) + 1
  if (next > 0xffff_ffff) fail("capacity-exceeded", "Replica id space is exhausted")
  return parseReplicaIdV2(`replica_${next.toString(16).padStart(8, "0")}`)
}

function protocolDigest(): DigestV2 { return parseDigestV2(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest) }
function serviceKeyIdV2(port: ControlDigestSignaturePortV2): string {
  return serviceKeyIdFor("membership", port)
}
function serviceKeyIdFor(purpose: "membership" | "registry-cutoff", port: ControlDigestSignaturePortV2): string {
  const value = port.serviceKeyId(purpose)
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(value)) fail("invalid-proof", "Membership service key id is invalid")
  return value
}
function nowU64(clock: ControlClock): Uint64V2 {
  const value = clock.nowEpochMilliseconds()
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid-proof", "Control clock is invalid")
  return parseUint64V2(String(value))
}
function addU64(value: Uint64V2, delta: bigint): Uint64V2 { return parseUint64V2((uint64ToBigIntV2(value) + delta).toString()) }
function role(value: CollaborationRoleV2): CollaborationRoleV2 {
  if (value !== "viewer" && value !== "editor") fail("invalid-proof", "Collaboration role is invalid")
  return value
}
function sameBootstrap(left: Readonly<Omit<ProjectBootstrapAuthorizationRequestV2, "evidence">>, right: Readonly<Omit<ProjectBootstrapAuthorizationRequestV2, "evidence">>): boolean {
  return left.projectId === right.projectId && left.projectEpoch === right.projectEpoch && left.projectIndexShardEpoch === right.projectIndexShardEpoch && left.initializationAuthorityDigest === right.initializationAuthorityDigest && left.initialProjectIndexCheckpointDigest === right.initialProjectIndexCheckpointDigest && left.initialProjectIndexFullUpdateDigest === right.initialProjectIndexFullUpdateDigest && left.initialProjectIndexStateVectorDigest === right.initialProjectIndexStateVectorDigest && left.initialProjectIndexCanonicalStateDigest === right.initialProjectIndexCanonicalStateDigest && left.ownerMemberId === right.ownerMemberId && left.ownerMemberSigningPublicKey === right.ownerMemberSigningPublicKey
}
function findLastV2<T>(values: readonly T[], predicate: (value: T) => boolean): T | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) if (predicate(values[index]!)) return values[index]
  return undefined
}
function fail(code: ConstructorParameters<typeof CollaborationControlServiceErrorV2>[0], message: string): never { throw new CollaborationControlServiceErrorV2(code, message) }
