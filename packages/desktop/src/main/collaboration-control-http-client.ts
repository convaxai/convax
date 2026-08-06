import {
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parsePublicKey,
  parseReplicaId,
  parseSignature,
  type Digest,
  type Id128,
  type MemberId,
  type ProjectId,
  type PublicKey,
  type ReplicaId,
  type Signature,
} from "@convax/collaboration"
import {
  membershipMutationProofCoreDigestV2,
  parseActivePeerDirectoryV2,
  parseMemberCredentialV2,
  parseMembershipMutationProofCoreV2,
  parseMembershipMutationProofV2,
  parseMembershipSnapshotV2,
  parseMutationChallengeV2,
  parseMutationReceiptV2,
  parsePeerFreshnessTicketV2,
  parseProjectAdminCapabilityV2,
  parseReplicaActorCredentialV2,
  parseReplicaEditAuthorizationV2,
  parseReplicaIdReservationReceiptV2,
  parseReplicaIdReservationRequestV2,
  parseSessionChallengeV2,
  parseSessionCredentialV2,
  peerTicketRequestCoreDigestV2,
  sessionProofCoreDigestV2,
  type ActivePeerDirectoryV2,
  type MemberCredentialV2,
  type MembershipMutationProofCoreV2,
  type MembershipMutationProofV2,
  type MembershipSnapshotV2,
  type MutationChallengeV2,
  type MutationReceiptV2,
  type PeerFreshnessTicketV2,
  type PeerTicketRequestV2,
  type PinnedControlServiceVerifierV2,
  type ProjectAdminCapabilityV2,
  type ReplicaActorCredentialV2,
  type ReplicaEditAuthorizationV2,
  type ReplicaIdReservationReceiptV2,
  type ReplicaIdReservationRequestV2,
  type SessionChallengeV2,
  type SessionCredentialV2,
  type SessionProofV2,
} from "@convax/project/collaboration-protocol"

import {
  parseProjectTeamInvitationV2,
  type ProjectTeamInvitationCarrierV2,
} from "../project-team-collaboration-contracts"

const MAX_CONTROL_RESPONSE_BYTES = 1024 * 1024

type ControlOperationV2 =
  | "team-bootstrap" | "invitation-create" | "invitation-prepare" | "invitation-revoke"
  | "member-add-signature-half" | "replica-reservation" | "mutation-challenge" | "membership-mutation"
  | "session-challenge" | "session-credential" | "peer-directory" | "peer-ticket"

export type CollaborationControlCallResultV2<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{ status: "online-disabled"; reason: "service-url-unconfigured" }>
  | Readonly<{ status: "rejected"; code: CollaborationControlRejectionCodeV2 }>
  | Readonly<{ status: "unavailable"; code: "aborted" | "http-error" | "network-error" }>

export type CollaborationControlRejectionCodeV2 =
  | "expired" | "identity-mismatch" | "invalid-service-artifact" | "invalid-proof"
  | "not-active" | "not-found" | "stale-counter" | "equivocation"
  | "capacity-exceeded" | "project-exists"

export interface DesktopTeamBootstrapResultV2 {
  readonly membershipSnapshot: MembershipSnapshotV2
  readonly ownerCredential: MemberCredentialV2
  readonly ownerAdminCapability: ProjectAdminCapabilityV2
  readonly invitation: ProjectTeamInvitationCarrierV2
  readonly initialization: DesktopProjectBootstrapInitializationV2
}

export interface DesktopProjectBootstrapInitializationV2 {
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly projectIndexShardEpoch: Id128
  readonly initializationAuthorityDigest: Digest
  readonly initialProjectIndexCheckpointDigest: Digest
  readonly initialProjectIndexFullUpdateDigest: Digest
  readonly initialProjectIndexStateVectorDigest: Digest
  readonly initialProjectIndexCanonicalStateDigest: Digest
}

export interface DesktopPreparedTeamInvitationV1 {
  readonly invitation: ProjectTeamInvitationCarrierV2
  readonly challenge: MutationChallengeV2
  readonly proofCore: Extract<MembershipMutationProofCoreV2, { readonly purpose: "member-add" }>
  readonly requestDigest: Digest
}

export interface DesktopMembershipMutationResultV2 {
  readonly receipt: MutationReceiptV2
  readonly membershipSnapshot: MembershipSnapshotV2
  readonly requesterCredential: MemberCredentialV2
  readonly requesterAdminCapability: ProjectAdminCapabilityV2 | null
  readonly targetMemberCredential: MemberCredentialV2
  readonly replicaActorCredential: ReplicaActorCredentialV2 | null
  readonly replicaEditAuthorization: ReplicaEditAuthorizationV2 | null
}

export type DesktopMemberAddSignatureHalfResultV2 =
  | Readonly<{ status: "pending-other-signature"; requestDigest: Digest }>
  | Readonly<{ status: "committed"; requestDigest: Digest; result: DesktopMembershipMutationResultV2 }>

export type DesktopMutationChallengeIntentV2 =
  | Readonly<{ purpose: "member-add"; mutationId: Id128; requesterCredentialDigest: Digest; adminCapabilityDigest: Digest; targetMemberId: MemberId; targetMemberSigningPublicKey: PublicKey; initialRole: "viewer" | "editor" }>
  | Readonly<{ purpose: "replica-enroll"; mutationId: Id128; requesterCredentialDigest: Digest; replicaIdReservationReceiptDigest: Digest }>
  | Readonly<{ purpose: "replica-activate-editor"; mutationId: Id128; requesterCredentialDigest: Digest; currentReplicaId: ReplicaId; installedFloorSetDigest: Digest }>

export interface DesktopCollaborationControlHttpClientV2 {
  bootstrapTeam(input: {
    readonly projectId: ProjectId
    readonly projectEpoch: Id128
    readonly projectIndexShardEpoch: Id128
    readonly initializationAuthorityDigest: Digest
    readonly initialProjectIndexCheckpointDigest: Digest
    readonly initialProjectIndexFullUpdateDigest: Digest
    readonly initialProjectIndexStateVectorDigest: Digest
    readonly initialProjectIndexCanonicalStateDigest: Digest
    readonly ownerMemberId: MemberId
    readonly ownerMemberSigningPublicKey: PublicKey
    readonly expectedProtocolDigest: Digest
    readonly expectedTrustBundleDigest: Digest
    readonly signal?: AbortSignal
  }): Promise<CollaborationControlCallResultV2<DesktopTeamBootstrapResultV2>>
  createInvitation(input: {
    readonly projectId: ProjectId
    readonly requesterCredentialDigest: Digest
    readonly adminCapabilityDigest: Digest
    readonly initialRole: "viewer" | "editor"
    readonly signal?: AbortSignal
  }): Promise<CollaborationControlCallResultV2<ProjectTeamInvitationCarrierV2>>
  prepareInvitation(input: {
    readonly invitation: ProjectTeamInvitationCarrierV2
    readonly mutationId: Id128
    readonly targetMemberId: MemberId
    readonly targetMemberSigningPublicKey: PublicKey
    readonly signal?: AbortSignal
  }): Promise<CollaborationControlCallResultV2<DesktopPreparedTeamInvitationV1>>
  revokeInvitation(input: {
    readonly projectId: ProjectId
    readonly requesterCredentialDigest: Digest
    readonly invitationToken: string
    readonly signal?: AbortSignal
  }): Promise<CollaborationControlCallResultV2<Readonly<{ status: "revoked" }>>>
  submitMemberAddSignatureHalf(input: {
    readonly projectId: ProjectId
    readonly invitationToken: string
    readonly requestDigest: Digest
    readonly kind: "admin" | "target-possession"
    readonly signature: Signature
    readonly signal?: AbortSignal
  }): Promise<CollaborationControlCallResultV2<DesktopMemberAddSignatureHalfResultV2>>
  reserveReplicaId(input: {
    readonly request: ReplicaIdReservationRequestV2
    readonly signal?: AbortSignal
  }): Promise<CollaborationControlCallResultV2<ReplicaIdReservationReceiptV2>>
  requestMutationChallenge(input: {
    readonly projectId: ProjectId
    readonly intent: DesktopMutationChallengeIntentV2
    readonly signal?: AbortSignal
  }): Promise<CollaborationControlCallResultV2<MutationChallengeV2>>
  commitMembershipMutation(input: {
    readonly proof: MembershipMutationProofV2
    readonly signal?: AbortSignal
  }): Promise<CollaborationControlCallResultV2<DesktopMembershipMutationResultV2>>
  requestSessionChallenge(input: {
    readonly projectId: ProjectId
    readonly memberId: MemberId
    readonly replicaId: ReplicaId
    readonly expected: Pick<SessionChallengeV2["core"],
      "projectEpoch" | "membershipEpoch" | "membershipSnapshotDigest" | "actorId" | "protocolDigest">
    readonly signal?: AbortSignal
  }): Promise<CollaborationControlCallResultV2<SessionChallengeV2>>
  issueSessionCredential(input: {
    readonly proof: SessionProofV2
    readonly expectedChallenge: SessionChallengeV2
    readonly signal?: AbortSignal
  }): Promise<CollaborationControlCallResultV2<SessionCredentialV2>>
  getActivePeerDirectory(input: {
    readonly credential: SessionCredentialV2
    readonly signal?: AbortSignal
  }): Promise<CollaborationControlCallResultV2<ActivePeerDirectoryV2>>
  requestPeerFreshnessTicket(input: {
    readonly request: PeerTicketRequestV2
    readonly requesterCredential: SessionCredentialV2
    readonly responderCredential: SessionCredentialV2
    readonly expectedChannelContractDigest: Digest
    readonly signal?: AbortSignal
  }): Promise<CollaborationControlCallResultV2<PeerFreshnessTicketV2>>
}

/** Main-only metadata client. A disabled/unavailable service never affects local editing. */
export function createDesktopCollaborationControlHttpClientV2(input: {
  readonly serviceBaseUrl?: string | null
  readonly verifier: PinnedControlServiceVerifierV2
  readonly fetch?: typeof globalThis.fetch
  readonly nowUnixMs?: () => bigint
  readonly requestHeaders?: (input: {
    readonly operation: ControlOperationV2
    readonly projectId: ProjectId
  }) => Promise<Readonly<Record<string, string>>>
}): DesktopCollaborationControlHttpClientV2 {
  const baseUrl = input.serviceBaseUrl === null || input.serviceBaseUrl === undefined || !input.serviceBaseUrl.trim()
    ? null
    : parseServiceBaseUrl(input.serviceBaseUrl)
  const fetcher = input.fetch ?? globalThis.fetch
  const now = input.nowUnixMs ?? (() => BigInt(Date.now()))

  const client: DesktopCollaborationControlHttpClientV2 = {
    async bootstrapTeam(request) {
      const projectId = parseProjectId(request.projectId)
      const ownerMemberId = parseMemberId(request.ownerMemberId)
      const ownerMemberSigningPublicKey = parsePublicKey(request.ownerMemberSigningPublicKey)
      const initialization = parseProjectBootstrapInitialization({
        projectId,
        projectEpoch: request.projectEpoch,
        projectIndexShardEpoch: request.projectIndexShardEpoch,
        initializationAuthorityDigest: request.initializationAuthorityDigest,
        initialProjectIndexCheckpointDigest: request.initialProjectIndexCheckpointDigest,
        initialProjectIndexFullUpdateDigest: request.initialProjectIndexFullUpdateDigest,
        initialProjectIndexStateVectorDigest: request.initialProjectIndexStateVectorDigest,
        initialProjectIndexCanonicalStateDigest: request.initialProjectIndexCanonicalStateDigest,
      })
      const expectedProtocolDigest = parseDigest(request.expectedProtocolDigest)
      const expectedTrustBundleDigest = parseDigest(request.expectedTrustBundleDigest)
      const result = await post("team-bootstrap", projectId, "bootstrap", {
        projectEpoch: initialization.projectEpoch,
        projectIndexShardEpoch: initialization.projectIndexShardEpoch,
        initializationAuthorityDigest: initialization.initializationAuthorityDigest,
        initialProjectIndexCheckpointDigest: initialization.initialProjectIndexCheckpointDigest,
        initialProjectIndexFullUpdateDigest: initialization.initialProjectIndexFullUpdateDigest,
        initialProjectIndexStateVectorDigest: initialization.initialProjectIndexStateVectorDigest,
        initialProjectIndexCanonicalStateDigest: initialization.initialProjectIndexCanonicalStateDigest,
        ownerMemberId,
        ownerMemberSigningPublicKey,
      }, parseTeamBootstrapResult, request.signal)
      if (result.status !== "ok") return result
      const value = result.value
      const snapshotStatus = await verifySignedArtifact(value.membershipSnapshot, input.verifier)
      if (snapshotStatus.status !== "ok") return snapshotStatus
      const credentialStatus = await verifySignedArtifact(value.ownerCredential, input.verifier)
      if (credentialStatus.status !== "ok") return credentialStatus
      const adminStatus = await verifySignedArtifact(value.ownerAdminCapability, input.verifier)
      if (adminStatus.status !== "ok") return adminStatus
      const snapshot = value.membershipSnapshot
      const credential = value.ownerCredential
      const admin = value.ownerAdminCapability
      const member = snapshot.core.members[0]
      if (snapshot.core.projectId !== projectId || snapshot.core.protocolDigest !== expectedProtocolDigest ||
        snapshot.core.trustBundleDigest !== expectedTrustBundleDigest || snapshot.core.membershipSequence !== "1" ||
        snapshot.core.members.length !== 1 || snapshot.core.replicas.length !== 0 || !member ||
        member.memberId !== ownerMemberId || member.memberSigningPublicKey !== ownerMemberSigningPublicKey ||
        member.role !== "editor" || member.state !== "active" ||
        credential.core.projectId !== projectId || credential.core.projectEpoch !== snapshot.core.projectEpoch ||
        credential.core.membershipEpoch !== snapshot.core.membershipEpoch || credential.core.membershipSnapshotDigest !== snapshot.coreDigest ||
        credential.core.memberId !== ownerMemberId || credential.core.memberSigningPublicKey !== ownerMemberSigningPublicKey ||
        credential.core.memberAuthorizationEpoch !== member.memberAuthorizationEpoch || credential.core.role !== "editor" ||
        credential.core.adminCapabilityDigest !== admin.coreDigest || credential.core.protocolDigest !== expectedProtocolDigest ||
        credential.core.trustBundleDigest !== expectedTrustBundleDigest || admin.core.projectId !== projectId ||
        admin.core.projectEpoch !== snapshot.core.projectEpoch || admin.core.membershipEpoch !== snapshot.core.membershipEpoch ||
        admin.core.membershipSnapshotDigest !== snapshot.coreDigest || admin.core.adminMemberId !== ownerMemberId ||
        admin.core.adminMemberAuthorizationEpoch !== member.memberAuthorizationEpoch || admin.core.protocolDigest !== expectedProtocolDigest ||
        admin.core.trustBundleDigest !== expectedTrustBundleDigest || value.invitation.projectId !== projectId ||
        !sameProjectBootstrapInitialization(value.initialization, initialization)) {
        return rejected("identity-mismatch")
      }
      if (BigInt(value.invitation.expiresAtUnixMs) <= now()) return rejected("expired")
      return result
    },

    async createInvitation(request) {
      const projectId = parseProjectId(request.projectId)
      const requesterCredentialDigest = parseDigest(request.requesterCredentialDigest)
      const adminCapabilityDigest = parseDigest(request.adminCapabilityDigest)
      if (request.initialRole !== "viewer" && request.initialRole !== "editor") throw new TypeError("Invitation role is invalid")
      const result = await post("invitation-create", projectId, "invitations", {
        action: "create", requesterCredentialDigest, adminCapabilityDigest, initialRole: request.initialRole,
      }, parseProjectTeamInvitationV2, request.signal)
      if (result.status !== "ok") return result
      if (result.value.projectId !== projectId || result.value.initialRole !== request.initialRole) return rejected("identity-mismatch")
      if (BigInt(result.value.expiresAtUnixMs) <= now()) return rejected("expired")
      return result
    },

    async prepareInvitation(request) {
      const invitation = parseProjectTeamInvitationV2(request.invitation)
      if (BigInt(invitation.expiresAtUnixMs) <= now()) return rejected("expired")
      const mutationId = parseId128(request.mutationId)
      const targetMemberId = parseMemberId(request.targetMemberId)
      const targetMemberSigningPublicKey = parsePublicKey(request.targetMemberSigningPublicKey)
      const result = await post("invitation-prepare", parseProjectId(invitation.projectId), "invitations", {
        action: "prepare", invitationToken: invitation.invitationToken, mutationId,
        targetMemberId, targetMemberSigningPublicKey,
      }, parsePreparedTeamInvitation, request.signal)
      if (result.status !== "ok") return result
      const value = result.value
      const challengeStatus = await verifyArtifact(value.challenge, now(), input.verifier)
      if (challengeStatus.status !== "ok") return challengeStatus
      const challenge = value.challenge.core
      const proof = value.proofCore
      if (!sameInvitation(value.invitation, invitation) || challenge.purpose !== "member-add" ||
        challenge.projectId !== invitation.projectId || challenge.mutationId !== mutationId ||
        challenge.targetMemberId !== targetMemberId || proof.purpose !== "member-add" ||
        proof.mutationId !== mutationId || proof.challengeDigest !== value.challenge.coreDigest ||
        proof.projectId !== invitation.projectId || proof.projectEpoch !== challenge.projectEpoch ||
        proof.membershipEpoch !== challenge.membershipEpoch || proof.expectedMembershipSequence !== challenge.expectedMembershipSequence ||
        proof.requesterMemberId !== challenge.requesterMemberId || proof.targetMemberId !== targetMemberId ||
        proof.serverNonce !== challenge.serverNonce || proof.targetMemberSigningPublicKey !== targetMemberSigningPublicKey ||
        proof.initialRole !== invitation.initialRole || proof.adminCapabilityDigest === undefined ||
        value.requestDigest !== membershipMutationProofCoreDigestV2(proof)) {
        return rejected("identity-mismatch")
      }
      return result
    },

    async revokeInvitation(request) {
      const projectId = parseProjectId(request.projectId)
      const requesterCredentialDigest = parseDigest(request.requesterCredentialDigest)
      return post("invitation-revoke", projectId, "invitations", {
        action: "revoke", requesterCredentialDigest, invitationToken: parseInvitationToken(request.invitationToken),
      }, parseRevoked, request.signal)
    },

    async submitMemberAddSignatureHalf(request) {
      const projectId = parseProjectId(request.projectId)
      const invitationToken = parseInvitationToken(request.invitationToken)
      const requestDigest = parseDigest(request.requestDigest)
      if (request.kind !== "admin" && request.kind !== "target-possession") throw new TypeError("Member-add signature-half kind is invalid")
      const signature = parseSignature(request.signature)
      const result = await post("member-add-signature-half", projectId, "member-add-signature-halves", {
        invitationToken, requestDigest, kind: request.kind, signature,
      }, parseMemberAddSignatureHalfResult, request.signal)
      if (result.status !== "ok") return result
      if (result.value.requestDigest !== requestDigest) return rejected("identity-mismatch")
      if (result.value.status === "committed") {
        const mutation = result.value.result
        for (const artifact of membershipMutationArtifacts(mutation)) {
          const verified = await verifySignedArtifact(artifact, input.verifier)
          if (verified.status !== "ok") return verified as CollaborationControlCallResultV2<DesktopMemberAddSignatureHalfResultV2>
        }
        if (mutation.receipt.core.requestDigest !== requestDigest || mutation.receipt.core.purpose !== "member-add" ||
          mutation.membershipSnapshot.core.projectId !== projectId) return rejected("identity-mismatch")
      }
      return result
    },

    async reserveReplicaId(request) {
      const reservation = parseReplicaIdReservationRequestV2(request.request)
      const result = await post("replica-reservation", reservation.core.projectId, "replica-reservations", reservation,
        parseReplicaIdReservationReceiptV2, request.signal)
      if (result.status !== "ok") return result
      const verified = await verifyArtifact(result.value, now(), input.verifier)
      if (verified.status !== "ok") return verified
      const core = result.value.core
      const expected = reservation.core
      if (core.reservationRequestCoreDigest !== reservation.coreDigest || core.allocationRequestId !== expected.allocationRequestId ||
        core.projectId !== expected.projectId || core.projectEpoch !== expected.projectEpoch || core.membershipEpoch !== expected.membershipEpoch ||
        core.purpose !== expected.purpose || core.expectedMembershipSequence !== expected.expectedMembershipSequence ||
        core.targetMemberId !== expected.targetMemberId || core.expectedTargetMemberMutationCounter !== expected.expectedTargetMemberMutationCounter ||
        core.requesterCredentialDigest !== expected.requesterCredentialDigest || core.currentReplicaId !== expected.currentReplicaId ||
        core.newReplicaSigningPublicKey !== expected.newReplicaSigningPublicKey || core.requestedEditState !== expected.requestedEditState ||
        core.protocolDigest !== expected.protocolDigest) return rejected("identity-mismatch")
      return result
    },

    async requestMutationChallenge(request) {
      const projectId = parseProjectId(request.projectId)
      const intent = normalizeMutationIntent(request.intent)
      const result = await post("mutation-challenge", projectId, "mutation-challenges", intent,
        parseMutationChallengeV2, request.signal)
      if (result.status !== "ok") return result
      const verified = await verifyArtifact(result.value, now(), input.verifier)
      if (verified.status !== "ok") return verified
      const core = result.value.core
      if (core.projectId !== projectId || core.purpose !== intent.purpose || core.mutationId !== intent.mutationId ||
        core.requesterCredentialDigest !== intent.requesterCredentialDigest ||
        (intent.purpose === "member-add" && core.targetMemberId !== intent.targetMemberId) ||
        (intent.purpose === "replica-enroll" && core.replicaIdReservationReceiptDigest !== intent.replicaIdReservationReceiptDigest) ||
        (intent.purpose === "replica-activate-editor" && (core.requiredFloorSetDigest !== intent.installedFloorSetDigest || core.targetMemberId !== core.requesterMemberId))) {
        return rejected("identity-mismatch")
      }
      return result
    },

    async commitMembershipMutation(request) {
      const proof = parseMembershipMutationProofV2(request.proof)
      const result = await post("membership-mutation", proof.core.projectId, "membership-mutations", proof,
        parseMembershipMutationResult, request.signal)
      if (result.status !== "ok") return result
      const value = result.value
      for (const artifact of membershipMutationArtifacts(value)) {
        const verified = await verifySignedArtifact(artifact, input.verifier)
        if (verified.status !== "ok") return verified as CollaborationControlCallResultV2<DesktopMembershipMutationResultV2>
      }
      const receipt = value.receipt.core
      const snapshot = value.membershipSnapshot
      const requester = value.requesterCredential.core
      const target = value.targetMemberCredential.core
      if (receipt.mutationId !== proof.core.mutationId || receipt.requestDigest !== proof.requestDigest || receipt.purpose !== proof.core.purpose ||
        receipt.afterMembershipSnapshotDigest !== snapshot.coreDigest || snapshot.core.projectId !== proof.core.projectId ||
        snapshot.core.projectEpoch !== proof.core.projectEpoch || snapshot.core.membershipEpoch !== proof.core.membershipEpoch ||
        requester.projectId !== proof.core.projectId || requester.membershipSnapshotDigest !== snapshot.coreDigest ||
        requester.memberId !== proof.core.requesterMemberId || target.projectId !== proof.core.projectId ||
        target.membershipSnapshotDigest !== snapshot.coreDigest || target.memberId !== proof.core.targetMemberId ||
        requester.protocolDigest !== snapshot.core.protocolDigest || target.protocolDigest !== snapshot.core.protocolDigest ||
        value.requesterAdminCapability !== null && value.requesterAdminCapability.core.membershipSnapshotDigest !== snapshot.coreDigest) {
        return rejected("identity-mismatch")
      }
      if (proof.core.purpose === "replica-enroll") {
        const actor = value.replicaActorCredential?.core
        if (!actor || value.replicaEditAuthorization !== null || actor.projectId !== proof.core.projectId ||
          actor.memberId !== proof.core.targetMemberId || actor.replicaId !== proof.core.newReplicaId ||
          actor.replicaIdReservationReceiptDigest !== proof.core.replicaIdReservationReceiptDigest ||
          actor.replicaSigningPublicKey !== proof.core.newReplicaSigningPublicKey ||
          receipt.consumedReplicaIdReservationReceiptDigest !== proof.core.replicaIdReservationReceiptDigest ||
          receipt.issuedReplicaActorCredentialDigest !== value.replicaActorCredential?.coreDigest) return rejected("identity-mismatch")
      } else if (proof.core.purpose === "replica-activate-editor") {
        const authorization = value.replicaEditAuthorization?.core
        if (!authorization || value.replicaActorCredential !== null || authorization.projectId !== proof.core.projectId ||
          authorization.memberId !== proof.core.targetMemberId || authorization.replicaId !== proof.core.currentReplicaId ||
          authorization.installedFloorSetDigest !== proof.core.installedFloorSetDigest ||
          receipt.issuedReplicaEditAuthorizationDigest !== value.replicaEditAuthorization?.coreDigest) return rejected("identity-mismatch")
      } else if (value.replicaActorCredential !== null || value.replicaEditAuthorization !== null) return rejected("identity-mismatch")
      return result
    },

    async requestSessionChallenge(request: Parameters<DesktopCollaborationControlHttpClientV2["requestSessionChallenge"]>[0]) {
      const projectId = parseProjectId(request.projectId)
      const memberId = parseMemberId(request.memberId)
      const replicaId = parseReplicaId(request.replicaId)
      const result = await post<SessionChallengeV2>("session-challenge", projectId, "session-challenges", {
        memberId, replicaId,
      }, parseSessionChallengeV2, request.signal)
      if (result.status !== "ok") return result
      const challenge = result.value
      const core = challenge.core
      if (core.projectId !== projectId || core.memberId !== memberId || core.replicaId !== replicaId ||
        core.projectEpoch !== request.expected.projectEpoch || core.membershipEpoch !== request.expected.membershipEpoch ||
        core.membershipSnapshotDigest !== request.expected.membershipSnapshotDigest || core.actorId !== request.expected.actorId ||
        core.protocolDigest !== request.expected.protocolDigest) {
        return rejected("identity-mismatch")
      }
      return verifyArtifact(challenge, now(), input.verifier)
    },

    async issueSessionCredential(request: Parameters<DesktopCollaborationControlHttpClientV2["issueSessionCredential"]>[0]) {
      const proof = requireSessionProof(request.proof)
      const challenge = parseSessionChallengeV2(request.expectedChallenge)
      if (proof.core.challengeDigest !== challenge.coreDigest || proof.core.projectId !== challenge.core.projectId ||
        proof.core.projectEpoch !== challenge.core.projectEpoch || proof.core.membershipEpoch !== challenge.core.membershipEpoch ||
        proof.core.membershipSnapshotDigest !== challenge.core.membershipSnapshotDigest || proof.core.memberId !== challenge.core.memberId ||
        proof.core.replicaId !== challenge.core.replicaId || proof.core.actorId !== challenge.core.actorId ||
        proof.core.serverNonce !== challenge.core.serverNonce || proof.core.sessionId !== challenge.core.sessionId ||
        proof.core.leaseId !== challenge.core.leaseId || proof.core.peerId !== challenge.core.peerId ||
        proof.core.protocolDigest !== challenge.core.protocolDigest) {
        return rejected("identity-mismatch")
      }
      const result = await post<SessionCredentialV2>(
        "session-credential", proof.core.projectId, "sessions", proof, parseSessionCredentialV2, request.signal,
      )
      if (result.status !== "ok") return result
      const credential = result.value
      const core = credential.core
      if (core.projectId !== proof.core.projectId || core.projectEpoch !== proof.core.projectEpoch ||
        core.membershipEpoch !== proof.core.membershipEpoch || core.membershipSnapshotDigest !== proof.core.membershipSnapshotDigest ||
        core.memberId !== proof.core.memberId || core.memberAuthorizationEpoch !== proof.core.memberAuthorizationEpoch ||
        core.replicaId !== proof.core.replicaId || core.actorId !== proof.core.actorId ||
        core.replicaAuthorizationEpoch !== proof.core.replicaAuthorizationEpoch || core.sessionId !== proof.core.sessionId ||
        core.leaseId !== proof.core.leaseId || core.peerId !== proof.core.peerId ||
        core.sessionSigningPublicKey !== proof.core.sessionSigningPublicKey || core.sessionChallengeDigest !== proof.core.challengeDigest ||
        core.sessionProofDigest !== proof.coreDigest || core.protocolDigest !== proof.core.protocolDigest) {
        return rejected("identity-mismatch")
      }
      return verifyArtifact(credential, now(), input.verifier)
    },

    async getActivePeerDirectory(request: Parameters<DesktopCollaborationControlHttpClientV2["getActivePeerDirectory"]>[0]) {
      const credential = parseSessionCredentialV2(request.credential)
      const credentialStatus = await verifyArtifact(credential, now(), input.verifier)
      if (credentialStatus.status !== "ok") return credentialStatus
      const result = await post<ActivePeerDirectoryV2>("peer-directory", credential.core.projectId, "peer-directory", {
        credentialDigest: credential.coreDigest,
      }, parseActivePeerDirectoryV2, request.signal)
      if (result.status !== "ok") return result
      const directory = result.value
      const core = directory.core
      if (core.projectId !== credential.core.projectId || core.projectEpoch !== credential.core.projectEpoch ||
        core.membershipEpoch !== credential.core.membershipEpoch ||
        core.membershipSnapshotDigest !== credential.core.membershipSnapshotDigest ||
        core.protocolDigest !== credential.core.protocolDigest ||
        !core.peers.some((peer) => peer.credentialDigest === credential.coreDigest &&
          peer.memberId === credential.core.memberId && peer.replicaId === credential.core.replicaId &&
          peer.actorId === credential.core.actorId && peer.peerId === credential.core.peerId && peer.leaseId === credential.core.leaseId)) {
        return rejected("identity-mismatch")
      }
      return verifyArtifact(directory, now(), input.verifier)
    },

    async requestPeerFreshnessTicket(request: Parameters<DesktopCollaborationControlHttpClientV2["requestPeerFreshnessTicket"]>[0]) {
      const ticketRequest = requirePeerTicketRequest(request.request)
      const requester = parseSessionCredentialV2(request.requesterCredential)
      const responder = parseSessionCredentialV2(request.responderCredential)
      const timestamp = now()
      const requesterStatus = await verifyArtifact(requester, timestamp, input.verifier)
      if (requesterStatus.status !== "ok") return requesterStatus
      const responderStatus = await verifyArtifact(responder, timestamp, input.verifier)
      if (responderStatus.status !== "ok") return responderStatus
      if (requester.core.projectId !== responder.core.projectId || requester.core.projectEpoch !== responder.core.projectEpoch ||
        requester.core.membershipEpoch !== responder.core.membershipEpoch ||
        requester.core.membershipSnapshotDigest !== responder.core.membershipSnapshotDigest ||
        ticketRequest.core.requesterCredentialDigest !== requester.coreDigest ||
        ticketRequest.core.responderCredentialDigest !== responder.coreDigest ||
        ticketRequest.core.requesterPeerId !== requester.core.peerId || ticketRequest.core.responderPeerId !== responder.core.peerId ||
        ticketRequest.core.protocolDigest !== requester.core.protocolDigest || responder.core.protocolDigest !== requester.core.protocolDigest) {
        return rejected("identity-mismatch")
      }
      const result = await post<PeerFreshnessTicketV2>(
        "peer-ticket", requester.core.projectId, "peer-tickets", ticketRequest, parsePeerFreshnessTicketV2, request.signal,
      )
      if (result.status !== "ok") return result
      const ticket = result.value
      const core = ticket.core
      if (core.requestDigest !== ticketRequest.coreDigest || core.connectionId !== ticketRequest.core.connectionId ||
        core.projectId !== requester.core.projectId || core.projectEpoch !== requester.core.projectEpoch ||
        core.membershipEpoch !== requester.core.membershipEpoch ||
        core.membershipSnapshotDigest !== requester.core.membershipSnapshotDigest ||
        core.requesterCredentialDigest !== requester.coreDigest || core.responderCredentialDigest !== responder.coreDigest ||
        core.requesterPeerId !== requester.core.peerId || core.responderPeerId !== responder.core.peerId ||
        core.channelContractDigest !== parseDigest(request.expectedChannelContractDigest) ||
        core.protocolDigest !== requester.core.protocolDigest) {
        return rejected("identity-mismatch")
      }
      return verifyArtifact(ticket, now(), input.verifier)
    },
  }
  return Object.freeze(client)

  async function post<T>(
    operation: ControlOperationV2,
    projectId: ProjectId,
    segment: string,
    body: unknown,
    parse: (value: unknown) => T,
    signal?: AbortSignal,
  ): Promise<CollaborationControlCallResultV2<T>> {
    if (baseUrl === null) return Object.freeze({ status: "online-disabled", reason: "service-url-unconfigured" })
    if (signal?.aborted) return Object.freeze({ status: "unavailable", code: "aborted" })
    let response: Response
    try {
      const headers = await input.requestHeaders?.({ operation, projectId }) ?? {}
      response = await fetcher(new URL(`/api/v2/projects/${encodeURIComponent(projectId)}/${segment}`, baseUrl), {
        method: "POST",
        headers: Object.freeze({ ...headers, "accept": "application/json", "content-type": "application/json" }),
        body: JSON.stringify(body),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal,
      })
    } catch (error) {
      return Object.freeze({
        status: "unavailable",
        code: signal?.aborted || (error instanceof DOMException && error.name === "AbortError") ? "aborted" : "network-error",
      })
    }
    try {
      const text = await response.text()
      if (new TextEncoder().encode(text).byteLength > MAX_CONTROL_RESPONSE_BYTES) {
        return response.ok ? rejected("invalid-service-artifact") : Object.freeze({ status: "unavailable", code: "http-error" })
      }
      const value: unknown = JSON.parse(text)
      if (!response.ok) {
        if (response.status >= 500) return Object.freeze({ status: "unavailable", code: "http-error" })
        const code = parseControlError(value)
        return code === null ? rejected("invalid-service-artifact") : rejected(code)
      }
      return Object.freeze({ status: "ok", value: parse(value) })
    } catch {
      return response.ok ? rejected("invalid-service-artifact") : Object.freeze({ status: "unavailable", code: "http-error" })
    }
  }
}

function requireSessionProof(value: SessionProofV2): SessionProofV2 {
  if (value.format !== "convax.session-proof/2" || value.core.format !== "convax.session-proof-core/2" ||
    value.coreDigest !== sessionProofCoreDigestV2(value.core)) throw new TypeError("Session proof is invalid")
  return value
}

function requirePeerTicketRequest(value: PeerTicketRequestV2): PeerTicketRequestV2 {
  if (value.format !== "convax.peer-ticket-request/2" || value.core.format !== "convax.peer-ticket-request-core/2" ||
    value.coreDigest !== peerTicketRequestCoreDigestV2(value.core)) throw new TypeError("Peer ticket request is invalid")
  return value
}

async function verifyArtifact<T extends {
  readonly core: { readonly issuedAtUnixMs: string; readonly expiresAtUnixMs: string; readonly serviceKeyPurpose: "membership" | "rendezvous"; readonly serviceKeyId: string }
  readonly coreDigest: Digest
  readonly serviceSignature: SessionChallengeV2["serviceSignature"]
}>(artifact: T, now: bigint, verifier: PinnedControlServiceVerifierV2): Promise<CollaborationControlCallResultV2<T>> {
  const issued = BigInt(artifact.core.issuedAtUnixMs)
  const expires = BigInt(artifact.core.expiresAtUnixMs)
  if (issued >= expires || now >= expires) return rejected("expired")
  if (!(await verifier.verify({
    purpose: artifact.core.serviceKeyPurpose,
    serviceKeyId: artifact.core.serviceKeyId,
    coreDigest: artifact.coreDigest,
    serviceSignature: artifact.serviceSignature,
  }))) return rejected("invalid-service-artifact")
  return Object.freeze({ status: "ok", value: artifact })
}

async function verifySignedArtifact<T extends {
  readonly core: { readonly serviceKeyPurpose: "membership" | "rendezvous"; readonly serviceKeyId: string }
  readonly coreDigest: Digest
  readonly serviceSignature: SessionChallengeV2["serviceSignature"]
}>(artifact: T, verifier: PinnedControlServiceVerifierV2): Promise<CollaborationControlCallResultV2<T>> {
  if (!(await verifier.verify({
    purpose: artifact.core.serviceKeyPurpose,
    serviceKeyId: artifact.core.serviceKeyId,
    coreDigest: artifact.coreDigest,
    serviceSignature: artifact.serviceSignature,
  }))) return rejected("invalid-service-artifact")
  return Object.freeze({ status: "ok", value: artifact })
}

function rejected(code: CollaborationControlRejectionCodeV2) {
  return Object.freeze({ status: "rejected" as const, code })
}

function parseControlError(value: unknown): Exclude<CollaborationControlRejectionCodeV2, "identity-mismatch" | "invalid-service-artifact"> | null {
  const record = exactRecordOrNull(value, ["code", "format"])
  if (!record || record.format !== "convax.api-error/2") return null
  switch (record.code) {
    case "expired": case "invalid-proof": case "not-active": case "not-found": case "stale-counter":
    case "equivocation": case "capacity-exceeded": case "project-exists": return record.code
    default: return null
  }
}

function parseTeamBootstrapResult(value: unknown): DesktopTeamBootstrapResultV2 {
  const record = exactRecord(value, ["initialization", "invitation", "membershipSnapshot", "ownerAdminCapability", "ownerCredential"], "Team bootstrap result")
  return Object.freeze({
    membershipSnapshot: parseMembershipSnapshotV2(record.membershipSnapshot),
    ownerCredential: parseMemberCredentialV2(record.ownerCredential),
    ownerAdminCapability: parseProjectAdminCapabilityV2(record.ownerAdminCapability),
    invitation: parseProjectTeamInvitationV2(record.invitation),
    initialization: parseProjectBootstrapInitialization(record.initialization),
  })
}

function parseProjectBootstrapInitialization(value: unknown): DesktopProjectBootstrapInitializationV2 {
  const record = exactRecord(value, [
    "initialProjectIndexCanonicalStateDigest", "initialProjectIndexCheckpointDigest",
    "initialProjectIndexFullUpdateDigest", "initialProjectIndexStateVectorDigest",
    "initializationAuthorityDigest", "projectEpoch", "projectId", "projectIndexShardEpoch",
  ], "Project bootstrap initialization")
  return Object.freeze({
    projectId: parseProjectId(record.projectId),
    projectEpoch: parseId128(record.projectEpoch),
    projectIndexShardEpoch: parseId128(record.projectIndexShardEpoch),
    initializationAuthorityDigest: parseDigest(record.initializationAuthorityDigest),
    initialProjectIndexCheckpointDigest: parseDigest(record.initialProjectIndexCheckpointDigest),
    initialProjectIndexFullUpdateDigest: parseDigest(record.initialProjectIndexFullUpdateDigest),
    initialProjectIndexStateVectorDigest: parseDigest(record.initialProjectIndexStateVectorDigest),
    initialProjectIndexCanonicalStateDigest: parseDigest(record.initialProjectIndexCanonicalStateDigest),
  })
}

function sameProjectBootstrapInitialization(
  left: DesktopProjectBootstrapInitializationV2,
  right: DesktopProjectBootstrapInitializationV2,
): boolean {
  return left.projectId === right.projectId && left.projectEpoch === right.projectEpoch &&
    left.projectIndexShardEpoch === right.projectIndexShardEpoch &&
    left.initializationAuthorityDigest === right.initializationAuthorityDigest &&
    left.initialProjectIndexCheckpointDigest === right.initialProjectIndexCheckpointDigest &&
    left.initialProjectIndexFullUpdateDigest === right.initialProjectIndexFullUpdateDigest &&
    left.initialProjectIndexStateVectorDigest === right.initialProjectIndexStateVectorDigest &&
    left.initialProjectIndexCanonicalStateDigest === right.initialProjectIndexCanonicalStateDigest
}

function parsePreparedTeamInvitation(value: unknown): DesktopPreparedTeamInvitationV1 {
  const record = exactRecord(value, ["challenge", "invitation", "proofCore", "requestDigest"], "Prepared team invitation")
  const proofCore = parseMembershipMutationProofCoreV2(record.proofCore)
  if (proofCore.purpose !== "member-add") throw new TypeError("Prepared invitation proof purpose is invalid")
  const requestDigest = parseDigest(record.requestDigest)
  if (membershipMutationProofCoreDigestV2(proofCore) !== requestDigest) throw new TypeError("Prepared invitation request digest is invalid")
  return Object.freeze({
    invitation: parseProjectTeamInvitationV2(record.invitation),
    challenge: parseMutationChallengeV2(record.challenge),
    proofCore,
    requestDigest,
  })
}

function parseMembershipMutationResult(value: unknown): DesktopMembershipMutationResultV2 {
  const record = exactRecord(value, [
    "membershipSnapshot", "receipt", "replicaActorCredential", "replicaEditAuthorization",
    "requesterAdminCapability", "requesterCredential", "targetMemberCredential",
  ], "Membership mutation result")
  return Object.freeze({
    receipt: parseMutationReceiptV2(record.receipt),
    membershipSnapshot: parseMembershipSnapshotV2(record.membershipSnapshot),
    requesterCredential: parseMemberCredentialV2(record.requesterCredential),
    requesterAdminCapability: record.requesterAdminCapability === null ? null : parseProjectAdminCapabilityV2(record.requesterAdminCapability),
    targetMemberCredential: parseMemberCredentialV2(record.targetMemberCredential),
    replicaActorCredential: record.replicaActorCredential === null ? null : parseReplicaActorCredentialV2(record.replicaActorCredential),
    replicaEditAuthorization: record.replicaEditAuthorization === null ? null : parseReplicaEditAuthorizationV2(record.replicaEditAuthorization),
  })
}

function parseMemberAddSignatureHalfResult(value: unknown): DesktopMemberAddSignatureHalfResultV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Member-add signature-half result is invalid")
  const status = (value as Record<string, unknown>).status
  if (status === "pending-other-signature") {
    const record = exactRecord(value, ["requestDigest", "status"], "Pending member-add signature-half result")
    return Object.freeze({ status, requestDigest: parseDigest(record.requestDigest) })
  }
  if (status === "committed") {
    const record = exactRecord(value, ["requestDigest", "result", "status"], "Committed member-add signature-half result")
    return Object.freeze({ status, requestDigest: parseDigest(record.requestDigest), result: parseMembershipMutationResult(record.result) })
  }
  throw new TypeError("Member-add signature-half result status is invalid")
}

function parseRevoked(value: unknown): Readonly<{ status: "revoked" }> {
  const record = exactRecord(value, ["status"], "Invitation revocation")
  if (record.status !== "revoked") throw new TypeError("Invitation revocation status is invalid")
  return Object.freeze({ status: "revoked" })
}

function normalizeMutationIntent(value: DesktopMutationChallengeIntentV2): DesktopMutationChallengeIntentV2 {
  const purpose = value.purpose
  if (purpose === "member-add") {
    if (value.initialRole !== "viewer" && value.initialRole !== "editor") throw new TypeError("Initial member role is invalid")
    return Object.freeze({
      purpose, mutationId: parseId128(value.mutationId), requesterCredentialDigest: parseDigest(value.requesterCredentialDigest),
      adminCapabilityDigest: parseDigest(value.adminCapabilityDigest), targetMemberId: parseMemberId(value.targetMemberId),
      targetMemberSigningPublicKey: parsePublicKey(value.targetMemberSigningPublicKey), initialRole: value.initialRole,
    })
  }
  if (purpose === "replica-enroll") return Object.freeze({
    purpose, mutationId: parseId128(value.mutationId), requesterCredentialDigest: parseDigest(value.requesterCredentialDigest),
    replicaIdReservationReceiptDigest: parseDigest(value.replicaIdReservationReceiptDigest),
  })
  if (purpose === "replica-activate-editor") return Object.freeze({
    purpose, mutationId: parseId128(value.mutationId), requesterCredentialDigest: parseDigest(value.requesterCredentialDigest),
    currentReplicaId: parseReplicaId(value.currentReplicaId), installedFloorSetDigest: parseDigest(value.installedFloorSetDigest),
  })
  throw new TypeError("Mutation challenge purpose is unsupported")
}

function membershipMutationArtifacts(value: DesktopMembershipMutationResultV2): ReadonlyArray<
  MembershipSnapshotV2 | MutationReceiptV2 | MemberCredentialV2 | ProjectAdminCapabilityV2 |
  ReplicaActorCredentialV2 | ReplicaEditAuthorizationV2
> {
  return Object.freeze([
    value.receipt, value.membershipSnapshot, value.requesterCredential,
    ...(value.requesterAdminCapability ? [value.requesterAdminCapability] : []),
    value.targetMemberCredential,
    ...(value.replicaActorCredential ? [value.replicaActorCredential] : []),
    ...(value.replicaEditAuthorization ? [value.replicaEditAuthorization] : []),
  ])
}

function sameInvitation(left: ProjectTeamInvitationCarrierV2, right: ProjectTeamInvitationCarrierV2): boolean {
  return left.invitationToken === right.invitationToken && left.projectId === right.projectId &&
    left.initialRole === right.initialRole && left.expiresAtUnixMs === right.expiresAtUnixMs
}

function parseInvitationToken(value: string): string {
  return parseProjectTeamInvitationV2({
    invitationToken: value,
    projectId: "token-validation",
    initialRole: "viewer",
    expiresAtUnixMs: "1",
  }).invitationToken
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = exactRecordOrNull(value, keys)
  if (!record) throw new TypeError(`${label} has unknown or missing fields`)
  return record
}

function exactRecordOrNull(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]) ? record : null
}

function parseServiceBaseUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new TypeError("Collaboration control service URL must be an HTTPS origin")
  }
  return new URL(url.origin)
}
