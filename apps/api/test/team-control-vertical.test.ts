import { describe, expect, test } from "bun:test"
import {
  encodeBase64url,
  parseDigest,
  parseId128,
  parseMemberId,
  parseProjectId,
  parsePublicKey,
  parseSignature,
  parseUint64,
  structuredDigest,
} from "@convax/collaboration"
import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2,
  membershipMutationProofCoreDigestV2,
  emptyProjectIndexGenesisAttestationCoreDigestV2,
  parseMemberCredentialV2,
  parseMembershipSnapshotV2,
  parseMutationChallengeV2,
  parseMutationReceiptV2,
  parseProjectAdminCapabilityV2,
  parseReplicaActorCredentialV2,
  parseReplicaEditAuthorizationV2,
  parseReplicaIdReservationReceiptV2,
  projectResetApprovalCoreDigestV2,
  projectResetConfirmationCoreDigestV2,
  replicaIdReservationRequestCoreDigestV2,
  teamEpochRolloverProofCoreDigestV2,
  type MembershipMutationProofV2,
  type ReplicaIdReservationRequestV2,
  type SessionProofV2,
} from "@convax/project/collaboration-protocol"
import {
  CollaborationMembershipServiceV2,
  CollaborationRendezvousServiceV2,
  InMemoryAtomicControlStateStore,
  createProjectBootstrapAuthorizationFactoryV2,
  createEmptyProjectIndexGenesisAttestationAdmissionFactoryV2,
  createSessionChallengeAuthorizationFactoryV2,
  createTeamInvitationAuthorizationFactoryV1,
  type CollaborationControlProjectStateV2,
  type ControlDigestSignaturePortV2,
  type ControlRandomSource,
} from "../src"

const signature = parseSignature(encodeBase64url(new Uint8Array(64).fill(44)))
const otherSignature = parseSignature(encodeBase64url(new Uint8Array(64).fill(45)))
const publicKey = (byte: number) => parsePublicKey(encodeBase64url(new Uint8Array(32).fill(byte)))
const id = (byte: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(byte)))
const digest = (digit: string) => parseDigest(digit.repeat(64))
const protocolDigest = parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest)

const bootstrapInput = (
  projectId: ReturnType<typeof parseProjectId>,
  ownerMemberId: ReturnType<typeof parseMemberId>,
  ownerMemberSigningPublicKey: ReturnType<typeof parsePublicKey>,
  salt: number,
) => Object.freeze({
  projectId,
  projectEpoch: id(salt),
  projectIndexShardEpoch: id(salt + 1),
  initializationAuthorityDigest: digest("a"),
  initialProjectIndexCheckpointDigest: digest("b"),
  initialProjectIndexFullUpdateDigest: digest("c"),
  initialProjectIndexStateVectorDigest: digest("d"),
  initialProjectIndexCanonicalStateDigest: digest("e"),
  ownerMemberId,
  ownerMemberSigningPublicKey,
})

class FakeClock {
  value = 1_000_000
  nowEpochMilliseconds() { return this.value }
}

class DeterministicRandom implements ControlRandomSource {
  private value = 50
  fill(target: Uint8Array): void {
    target.fill(this.value)
    this.value += 1
  }
}

const signatures: ControlDigestSignaturePortV2 = {
  serviceKeyId: (purpose) => `${purpose}-key-1`,
  signServiceDigest: async () => signature,
  verifyPublicKeyDigest: async () => true,
}

describe("team control vertical slice", () => {
  test("rejects a bootstrap epoch mismatch before the Project partition is written", async () => {
    const store = new InMemoryAtomicControlStateStore<CollaborationControlProjectStateV2>()
    const membership = new CollaborationMembershipServiceV2(store, new FakeClock(), new DeterministicRandom(), signatures, {
      registrySequence: parseUint64("0"), registryRootDigest: digest("1"), schemaDigest: digest("2"), validationArtifactSetDigest: digest("3"), uriProtocolDigest: digest("6"), trustBundleDigest: digest("4"),
    }, { verifyInstalledCurrentFloor: async () => true })
    const projectId = parseProjectId("bootstrap-epoch-mismatch")
    const ownerMemberId = parseMemberId(id(19))
    const exact = bootstrapInput(projectId, ownerMemberId, publicKey(19), 20)
    const factory = createProjectBootstrapAuthorizationFactoryV2({ verify: async () => true })
    const authorization = await factory.authorize({ ...exact, evidence: "verified-project-manifest" })
    if (authorization === "rejected") throw new Error("test bootstrap rejected")

    await expect(membership.bootstrapProject({ ...exact, projectEpoch: id(29) }, authorization)).rejects.toMatchObject({ code: "invalid-proof" })
    expect(await store.transact(projectId, (transaction) => transaction.read())).toBeNull()
    await expect(membership.bootstrapProject(exact, authorization)).rejects.toMatchObject({ code: "invalid-proof" })
    expect(await store.transact(projectId, (transaction) => transaction.read())).toBeNull()
  })

  test("recovers byte-identical bootstrap artifacts after a lost response and rejects a conflicting retry", async () => {
    const store = new InMemoryAtomicControlStateStore<CollaborationControlProjectStateV2>()
    const membership = new CollaborationMembershipServiceV2(store, new FakeClock(), new DeterministicRandom(), signatures, {
      registrySequence: parseUint64("0"), registryRootDigest: digest("1"), schemaDigest: digest("2"), validationArtifactSetDigest: digest("3"), uriProtocolDigest: digest("6"), trustBundleDigest: digest("4"),
    }, { verifyInstalledCurrentFloor: async () => true })
    const projectId = parseProjectId("bootstrap-response-loss")
    const ownerMemberId = parseMemberId(id(18))
    const exact = bootstrapInput(projectId, ownerMemberId, publicKey(18), 24)
    const factory = createProjectBootstrapAuthorizationFactoryV2({ verify: async () => true })
    const authorize = async (input: typeof exact) => {
      const authorization = await factory.authorize({ ...input, evidence: "verified-project-manifest" })
      if (authorization === "rejected") throw new Error("test bootstrap rejected")
      return authorization
    }

    const committed = await membership.bootstrapProject(exact, await authorize(exact))
    expect(await membership.bootstrapProject(exact, await authorize(exact))).toEqual(committed)

    const conflicting = { ...exact, initialProjectIndexCanonicalStateDigest: digest("f") }
    await expect(membership.bootstrapProject(conflicting, await authorize(conflicting))).rejects.toMatchObject({ code: "project-exists" })
    expect(await membership.bootstrapProject(exact, await authorize(exact))).toEqual(committed)

    await store.transact(projectId, (transaction) => {
      const state = transaction.read()
      if (!state?.team) throw new Error("test Team state missing")
      transaction.write({
        ...state,
        team: {
          ...state.team,
          currentSnapshot: { ...state.team.currentSnapshot, coreDigest: digest("e") },
        },
      })
    })
    await expect(membership.bootstrapProject(exact, await authorize(exact))).rejects.toMatchObject({ code: "project-exists" })
  })

  test("expires and revokes the opaque invitation without weakening the R5 double-sign proof", async () => {
    const store = new InMemoryAtomicControlStateStore<CollaborationControlProjectStateV2>()
    const clock = new FakeClock()
    const membership = new CollaborationMembershipServiceV2(store, clock, new DeterministicRandom(), signatures, {
      registrySequence: parseUint64("0"), registryRootDigest: digest("1"), schemaDigest: digest("2"), validationArtifactSetDigest: digest("3"), uriProtocolDigest: digest("6"), trustBundleDigest: digest("4"),
    }, { verifyInstalledCurrentFloor: async () => true })
    const projectId = parseProjectId("invitation-project")
    const ownerMemberId = parseMemberId(id(20))
    const targetMemberId = parseMemberId(id(21))
    const bootstrapFactory = createProjectBootstrapAuthorizationFactoryV2({ verify: async () => true })
    const firstBootstrap = bootstrapInput(projectId, ownerMemberId, publicKey(20), 30)
    const auth = await bootstrapFactory.authorize({ ...firstBootstrap, evidence: "owner" })
    if (auth === "rejected") throw new Error("test bootstrap rejected")
    const bootstrap = await membership.bootstrapProject(firstBootstrap, auth)
    const prepared = await membership.prepareInvitation({ projectId, invitationToken: bootstrap.invitation.invitationToken, mutationId: id(22), targetMemberId, targetMemberSigningPublicKey: publicKey(21) })
    const invitationFactory = createTeamInvitationAuthorizationFactoryV1({ verify: async () => true })
    const revokeAuth = await invitationFactory.authorize({ action: "revoke", projectId, requesterCredentialDigest: bootstrap.ownerCredential.coreDigest, invitationToken: bootstrap.invitation.invitationToken, evidence: "owner-session" })
    if (revokeAuth === "rejected") throw new Error("test revoke rejected")
    await membership.revokeInvitation({ projectId, requesterCredentialDigest: bootstrap.ownerCredential.coreDigest, invitationToken: bootstrap.invitation.invitationToken }, revokeAuth)
    await expect(membership.commitMembershipMutation({ format: "convax.mutation-proof/2", core: prepared.proofCore, requestDigest: prepared.requestDigest, signatures: { purpose: "member-add", adminSignature: signature, targetMemberPossessionSignature: signature } })).rejects.toMatchObject({ code: "not-active" })

    const secondProjectId = parseProjectId("expired-invitation-project")
    const secondBootstrap = bootstrapInput(secondProjectId, ownerMemberId, publicKey(20), 32)
    const secondAuth = await bootstrapFactory.authorize({ ...secondBootstrap, evidence: "owner" })
    if (secondAuth === "rejected") throw new Error("test bootstrap rejected")
    const expired = await membership.bootstrapProject(secondBootstrap, secondAuth)
    clock.value += 15 * 60_000
    await expect(membership.prepareInvitation({ projectId: secondProjectId, invitationToken: expired.invitation.invitationToken, mutationId: id(23), targetMemberId, targetMemberSigningPublicKey: publicKey(21) })).rejects.toMatchObject({ code: "expired" })
  })

  test("mediates two independent member-add signature halves without ever signing for either member", async () => {
    const store = new InMemoryAtomicControlStateStore<CollaborationControlProjectStateV2>()
    const clock = new FakeClock()
    const verifiedKeys: string[] = []
    const port: ControlDigestSignaturePortV2 = {
      ...signatures,
      verifyPublicKeyDigest: async (key) => { verifiedKeys.push(key); return true },
    }
    const membership = new CollaborationMembershipServiceV2(store, clock, new DeterministicRandom(), port, {
      registrySequence: parseUint64("0"), registryRootDigest: digest("1"), schemaDigest: digest("2"), validationArtifactSetDigest: digest("3"), uriProtocolDigest: digest("6"), trustBundleDigest: digest("4"),
    }, { verifyInstalledCurrentFloor: async () => true })
    const projectId = parseProjectId("member-add-half-project")
    const ownerMemberId = parseMemberId(id(60))
    const targetMemberId = parseMemberId(id(61))
    const ownerKey = publicKey(20)
    const targetKey = publicKey(21)
    const bootstrapFactory = createProjectBootstrapAuthorizationFactoryV2({ verify: async () => true })
    const request = bootstrapInput(projectId, ownerMemberId, ownerKey, 62)
    const authorization = await bootstrapFactory.authorize({ ...request, evidence: "owner" })
    if (authorization === "rejected") throw new Error("test bootstrap rejected")
    const bootstrap = await membership.bootstrapProject(request, authorization)
    const prepared = await membership.prepareInvitation({ projectId, invitationToken: bootstrap.invitation.invitationToken, mutationId: id(70), targetMemberId, targetMemberSigningPublicKey: targetKey })

    expect(await membership.submitMemberAddSignatureHalf({ projectId, invitationToken: bootstrap.invitation.invitationToken, requestDigest: prepared.requestDigest, kind: "target-possession", signature })).toEqual({ status: "pending-other-signature", requestDigest: prepared.requestDigest })
    const pending = await store.transact(projectId, (transaction) => transaction.read())
    expect(pending?.team?.currentSnapshot.core.members).toHaveLength(1)
    expect(pending?.team?.memberAddSignatureHalves).toHaveLength(1)
    const restarted = new CollaborationMembershipServiceV2(store, clock, new DeterministicRandom(), port, {
      registrySequence: parseUint64("0"), registryRootDigest: digest("1"), schemaDigest: digest("2"), validationArtifactSetDigest: digest("3"), uriProtocolDigest: digest("6"), trustBundleDigest: digest("4"),
    }, { verifyInstalledCurrentFloor: async () => true })
    const listFactory = createTeamInvitationAuthorizationFactoryV1({ verify: async () => true })
    const listAuthorization = await listFactory.authorize({ action: "list-member-add", projectId, requesterCredentialDigest: bootstrap.ownerCredential.coreDigest, invitationToken: null, evidence: "restarted-owner-session" })
    if (listAuthorization === "rejected") throw new Error("test owner list rejected")
    expect(await restarted.listOwnerMemberAddInvitations({ projectId, requesterCredentialDigest: bootstrap.ownerCredential.coreDigest, adminCapabilityDigest: bootstrap.ownerAdminCapability.coreDigest }, listAuthorization)).toEqual([{
      invitation: bootstrap.invitation,
      status: "prepared",
      challenge: prepared.challenge,
      proofCore: prepared.proofCore,
      requestDigest: prepared.requestDigest,
    }])
    await expect(restarted.submitMemberAddSignatureHalf({ projectId, invitationToken: bootstrap.invitation.invitationToken, requestDigest: prepared.requestDigest, kind: "target-possession", signature: otherSignature })).rejects.toMatchObject({ code: "equivocation" })
    expect(await store.transact(projectId, (transaction) => transaction.read())).toEqual(pending)

    const committed = await restarted.submitMemberAddSignatureHalf({ projectId, invitationToken: bootstrap.invitation.invitationToken, requestDigest: prepared.requestDigest, kind: "admin", signature })
    expect(committed.status).toBe("committed")
    if (committed.status !== "committed") throw new Error("member-add did not commit")
    expect(committed.result.membershipSnapshot.core.members.map((member) => member.memberId)).toEqual([ownerMemberId, targetMemberId])
    expect((await store.transact(projectId, (transaction) => transaction.read()))?.team?.memberAddSignatureHalves).toEqual([])
    expect(verifiedKeys).toEqual([targetKey, targetKey, ownerKey, ownerKey, targetKey])
    expect(await restarted.submitMemberAddSignatureHalf({ projectId, invitationToken: bootstrap.invitation.invitationToken, requestDigest: prepared.requestDigest, kind: "admin", signature })).toEqual(committed)
  })

  test("bootstraps, joins with two signatures, allocates/enrolls monotonically, activates offline edit authority, then opens a session", async () => {
    const store = new InMemoryAtomicControlStateStore<CollaborationControlProjectStateV2>()
    const clock = new FakeClock()
    const random = new DeterministicRandom()
    const membership = new CollaborationMembershipServiceV2(store, clock, random, signatures, {
      registrySequence: parseUint64("0"),
      registryRootDigest: digest("1"),
      schemaDigest: digest("2"),
      validationArtifactSetDigest: digest("3"),
      uriProtocolDigest: digest("6"),
      trustBundleDigest: digest("4"),
    }, { verifyInstalledCurrentFloor: async () => true })
    const rendezvous = new CollaborationRendezvousServiceV2(store, clock, random, signatures)
    const projectId = parseProjectId("team-project")
    const ownerMemberId = parseMemberId(id(1))
    const targetMemberId = parseMemberId(id(2))
    const ownerKey = publicKey(1)
    const targetKey = publicKey(2)
    const replicaKey = publicKey(3)
    const bootstrapFactory = createProjectBootstrapAuthorizationFactoryV2({ verify: async () => true })
    const bootstrapRequest = bootstrapInput(projectId, ownerMemberId, ownerKey, 40)
    const bootstrapAuthorization = await bootstrapFactory.authorize({ ...bootstrapRequest, evidence: "account-session" })
    if (bootstrapAuthorization === "rejected") throw new Error("test bootstrap authorization rejected")
    const bootstrap = await membership.bootstrapProject(bootstrapRequest, bootstrapAuthorization)
    expect(bootstrap.membershipSnapshot.core.members).toHaveLength(1)
    expect(bootstrap.ownerCredential.core.adminCapabilityDigest).toBe(bootstrap.ownerAdminCapability.coreDigest)
    expect(parseMembershipSnapshotV2(bootstrap.membershipSnapshot)).toEqual(bootstrap.membershipSnapshot)
    expect(parseMemberCredentialV2(bootstrap.ownerCredential)).toEqual(bootstrap.ownerCredential)
    expect(parseProjectAdminCapabilityV2(bootstrap.ownerAdminCapability)).toEqual(bootstrap.ownerAdminCapability)

    const preparedInvitation = await membership.prepareInvitation({
      projectId,
      invitationToken: bootstrap.invitation.invitationToken,
      mutationId: id(10),
      targetMemberId,
      targetMemberSigningPublicKey: targetKey,
    })
    const memberAddCore = preparedInvitation.proofCore
    const memberAddProof: MembershipMutationProofV2 = {
      format: "convax.mutation-proof/2",
      core: memberAddCore,
      requestDigest: preparedInvitation.requestDigest,
      signatures: { purpose: "member-add", adminSignature: signature, targetMemberPossessionSignature: signature },
    }
    const join = await membership.commitMembershipMutation(memberAddProof)
    expect(join.membershipSnapshot.core.members.map((member) => member.memberId)).toEqual([ownerMemberId, targetMemberId])
    expect(join.targetMemberCredential.core.memberId).toBe(targetMemberId)
    expect(join.requesterAdminCapability?.core.membershipSnapshotDigest).toBe(join.membershipSnapshot.coreDigest)
    expect(parseMutationReceiptV2(join.receipt)).toEqual(join.receipt)
    expect(await membership.commitMembershipMutation(memberAddProof)).toEqual(join)
    const equivocationCore = { ...memberAddCore, targetMemberSigningPublicKey: publicKey(9) }
    await expect(membership.commitMembershipMutation({
      ...memberAddProof,
      core: equivocationCore,
      requestDigest: membershipMutationProofCoreDigestV2(equivocationCore),
    })).rejects.toMatchObject({ code: "equivocation" })

    const reservationCore = {
      format: "convax.replica-id-reservation-request-core/2" as const,
      allocationRequestId: id(11),
      projectId,
      projectEpoch: join.membershipSnapshot.core.projectEpoch,
      membershipEpoch: join.membershipSnapshot.core.membershipEpoch,
      purpose: "replica-enroll" as const,
      expectedMembershipSequence: join.membershipSnapshot.core.membershipSequence,
      requesterMemberId: targetMemberId,
      targetMemberId,
      expectedTargetMemberMutationCounter: parseUint64("1"),
      requesterCredentialDigest: join.targetMemberCredential.coreDigest,
      currentReplicaId: null,
      newReplicaSigningPublicKey: replicaKey,
      requestedEditState: "pending-editor" as const,
      protocolDigest,
    }
    const reservationRequest: ReplicaIdReservationRequestV2 = {
      format: "convax.replica-id-reservation-request/2",
      core: reservationCore,
      coreDigest: replicaIdReservationRequestCoreDigestV2(reservationCore),
      memberSignature: signature,
    }
    const staleReservationCore = { ...reservationCore, allocationRequestId: id(14), expectedMembershipSequence: parseUint64("1") }
    await expect(membership.reserveReplicaId({ ...reservationRequest, core: staleReservationCore, coreDigest: replicaIdReservationRequestCoreDigestV2(staleReservationCore) })).rejects.toMatchObject({ code: "stale-counter" })
    const reservation = await membership.reserveReplicaId(reservationRequest)
    expect(parseReplicaIdReservationReceiptV2(reservation)).toEqual(reservation)
    expect(String(reservation.core.assignedReplicaId)).toBe("replica_00000001")
    expect(await membership.reserveReplicaId(reservationRequest)).toEqual(reservation)

    const enrollChallenge = await membership.issueMutationChallenge(projectId, {
      purpose: "replica-enroll",
      mutationId: id(12),
      requesterCredentialDigest: join.targetMemberCredential.coreDigest,
      replicaIdReservationReceiptDigest: reservation.coreDigest,
    })
    expect(parseMutationChallengeV2(enrollChallenge)).toEqual(enrollChallenge)
    const enrollCore = {
      format: "convax.mutation-proof-core/2" as const,
      mutationId: enrollChallenge.core.mutationId,
      challengeDigest: enrollChallenge.coreDigest,
      projectId,
      projectEpoch: enrollChallenge.core.projectEpoch,
      membershipEpoch: enrollChallenge.core.membershipEpoch,
      expectedMembershipSequence: enrollChallenge.core.expectedMembershipSequence,
      requesterMemberId: targetMemberId,
      targetMemberId,
      targetMemberMutationCounter: parseUint64("2"),
      serverNonce: enrollChallenge.core.serverNonce,
      purpose: "replica-enroll" as const,
      currentReplicaId: null,
      newReplicaId: reservation.core.assignedReplicaId,
      replicaIdReservationReceiptDigest: reservation.coreDigest,
      newReplicaSigningPublicKey: replicaKey,
      requestedEditState: "pending-editor" as const,
      cutoffCoverageRootCoreDigest: null,
    }
    const enroll = await membership.commitMembershipMutation({ format: "convax.mutation-proof/2", core: enrollCore, requestDigest: membershipMutationProofCoreDigestV2(enrollCore), signatures: { purpose: "replica-enroll", memberSignature: signature } })
    expect(enroll.replicaActorCredential?.core.replicaId).toBe(reservation.core.assignedReplicaId)
    if (!enroll.replicaActorCredential) throw new Error("test actor credential missing")
    expect(parseReplicaActorCredentialV2(enroll.replicaActorCredential)).toEqual(enroll.replicaActorCredential)
    expect(enroll.membershipSnapshot.core.replicas[0]?.editState).toBe("pending-editor")

    const floorDigest = digest("5")
    const activationChallenge = await membership.issueMutationChallenge(projectId, {
      purpose: "replica-activate-editor",
      mutationId: id(13),
      requesterCredentialDigest: enroll.targetMemberCredential.coreDigest,
      currentReplicaId: reservation.core.assignedReplicaId,
      installedFloorSetDigest: floorDigest,
    })
    const activationCore = {
      format: "convax.mutation-proof-core/2" as const,
      mutationId: activationChallenge.core.mutationId,
      challengeDigest: activationChallenge.coreDigest,
      projectId,
      projectEpoch: activationChallenge.core.projectEpoch,
      membershipEpoch: activationChallenge.core.membershipEpoch,
      expectedMembershipSequence: activationChallenge.core.expectedMembershipSequence,
      requesterMemberId: targetMemberId,
      targetMemberId,
      targetMemberMutationCounter: parseUint64("3"),
      serverNonce: activationChallenge.core.serverNonce,
      purpose: "replica-activate-editor" as const,
      currentReplicaId: reservation.core.assignedReplicaId,
      installedFloorSetDigest: floorDigest,
      cutoffCoverageRootCoreDigest: null,
    }
    const activation = await membership.commitMembershipMutation({ format: "convax.mutation-proof/2", core: activationCore, requestDigest: membershipMutationProofCoreDigestV2(activationCore), signatures: { purpose: "replica-activate-editor", memberSignature: signature } })
    expect(activation.replicaEditAuthorization?.core.editState).toBe("active-editor")
    expect(activation.replicaEditAuthorization?.core.installedFloorSetDigest).toBe(floorDigest)
    if (!activation.replicaEditAuthorization) throw new Error("test edit authorization missing")
    expect(parseReplicaEditAuthorizationV2(activation.replicaEditAuthorization)).toEqual(activation.replicaEditAuthorization)

    const sessionAuthorization = await createSessionChallengeAuthorizationFactoryV2({ verify: async () => true }).authorize({ projectId, memberId: targetMemberId, replicaId: reservation.core.assignedReplicaId, evidence: "replica-pre-proof" })
    if (sessionAuthorization === "rejected") throw new Error("test session authorization rejected")
    const sessionChallenge = await rendezvous.issueSessionChallenge({ projectId, memberId: targetMemberId, replicaId: reservation.core.assignedReplicaId }, sessionAuthorization)
    const sessionCore = {
      format: "convax.session-proof-core/2" as const,
      challengeDigest: sessionChallenge.coreDigest,
      projectId,
      projectEpoch: sessionChallenge.core.projectEpoch,
      membershipEpoch: sessionChallenge.core.membershipEpoch,
      membershipSnapshotDigest: sessionChallenge.core.membershipSnapshotDigest,
      memberId: targetMemberId,
      memberAuthorizationEpoch: activation.targetMemberCredential.core.memberAuthorizationEpoch,
      replicaId: reservation.core.assignedReplicaId,
      actorId: activation.replicaEditAuthorization!.core.actorId,
      replicaAuthorizationEpoch: activation.replicaEditAuthorization!.core.replicaAuthorizationEpoch,
      replicaSessionCounter: sessionChallenge.core.expectedReplicaSessionCounter,
      serverNonce: sessionChallenge.core.serverNonce,
      sessionId: sessionChallenge.core.sessionId,
      leaseId: sessionChallenge.core.leaseId,
      peerId: sessionChallenge.core.peerId,
      sessionSigningPublicKey: publicKey(4),
      requestedExpiresAtUnixMs: parseUint64("1600000"),
      protocolDigest,
    }
    const sessionProof: SessionProofV2 = { format: "convax.session-proof/2", core: sessionCore, coreDigest: structuredDigest("convax.session-proof-core/2", sessionCore), replicaSignature: signature }
    const session = await rendezvous.issueSessionCredential(sessionProof)
    expect(session.core.editState).toBe("active-editor")
    expect(session.core.peerId).toBe(sessionChallenge.core.peerId)

    const beforeReset = await store.transact(projectId, (transaction) => transaction.read())
    if (!beforeReset?.team || !enroll.replicaActorCredential) throw new Error("test reset authority missing")
    const currentOwnerCredential = [...beforeReset.team.memberCredentials].reverse().find((value) => value.core.memberId === ownerMemberId && value.core.membershipSnapshotDigest === beforeReset.team!.currentSnapshot.coreDigest)
    const currentOwnerAdmin = [...beforeReset.team.adminCapabilities].reverse().find((value) => value.core.adminMemberId === ownerMemberId && value.core.membershipSnapshotDigest === beforeReset.team!.currentSnapshot.coreDigest)
    if (!currentOwnerCredential || !currentOwnerAdmin) throw new Error("owner authority was not rotated with membership")
    const resetId = id(80)
    const confirmationCore = Object.freeze({
      format: "convax.project-reset-confirmation-core/2" as const,
      resetId,
      confirmationId: id(81),
      projectId,
      oldProjectEpoch: beforeReset.seed.projectEpoch,
      reason: "explicit-empty-project-reset" as const,
      observedOldPrivateTreeDigest: digest("7"),
      unsupportedInventoryDigest: digest("8"),
      privateDeletionSetDigest: digest("9"),
      stableProjectIdPreserved: true as const,
      ordinaryProjectFilesPreserved: true as const,
      deletionStatement: "delete-exact-displayed-private-project-state" as const,
      requestedProtocolDigest: protocolDigest,
      requestedSchemaDigest: digest("2"),
      requestedUriProtocolDigest: digest("6"),
      confirmationPrincipal: Object.freeze({ kind: "team-replica" as const, memberId: targetMemberId, replicaId: reservation.core.assignedReplicaId, actorId: enroll.replicaActorCredential.core.actorId, actorCredentialCoreDigest: enroll.replicaActorCredential.coreDigest }),
      protocolDigest,
    })
    const confirmation = Object.freeze({ format: "convax.project-reset-confirmation/2" as const, core: confirmationCore, coreDigest: projectResetConfirmationCoreDigestV2(confirmationCore), confirmationSignature: signature })
    const approvalCore = Object.freeze({
      format: "convax.project-reset-approval-core/2" as const,
      resetId,
      approvalId: id(82),
      confirmationCoreDigest: confirmation.coreDigest,
      projectId,
      oldProjectEpoch: beforeReset.seed.projectEpoch,
      reason: confirmationCore.reason,
      observedOldPrivateTreeDigest: confirmationCore.observedOldPrivateTreeDigest,
      unsupportedInventoryDigest: confirmationCore.unsupportedInventoryDigest,
      privateDeletionSetDigest: confirmationCore.privateDeletionSetDigest,
      requestedProtocolDigest: protocolDigest,
      requestedSchemaDigest: digest("2"),
      requestedUriProtocolDigest: digest("6"),
      adminMemberId: ownerMemberId,
      adminMemberAuthorizationEpoch: currentOwnerCredential.core.memberAuthorizationEpoch,
      adminCapabilityCoreDigest: currentOwnerAdmin.coreDigest,
      approvalStatement: "approve-exact-team-project-reset" as const,
      protocolDigest,
    })
    const approval = Object.freeze({ format: "convax.project-reset-approval/2" as const, core: approvalCore, coreDigest: projectResetApprovalCoreDigestV2(approvalCore), adminMemberSignature: signature })
    const rolloverChallenge = await membership.issueTeamEpochRolloverChallenge({ projectId, confirmation, approval })
    const rolloverProofCore = Object.freeze({
      format: "convax.team-epoch-rollover-proof-core/2" as const,
      challengeDigest: rolloverChallenge.coreDigest,
      resetId,
      projectId,
      oldProjectEpoch: rolloverChallenge.core.oldProjectEpoch,
      newProjectEpoch: rolloverChallenge.core.newProjectEpoch,
      newMembershipEpoch: rolloverChallenge.core.newMembershipEpoch,
      newProjectIndexShardEpoch: rolloverChallenge.core.newProjectIndexShardEpoch,
      expectedProjectResetCounter: rolloverChallenge.core.expectedProjectResetCounter,
      projectResetConfirmationCoreDigest: confirmation.coreDigest,
      projectResetApprovalCoreDigest: approval.coreDigest,
      serverNonce: rolloverChallenge.core.serverNonce,
      requesterMemberId: ownerMemberId,
      requesterMemberAuthorizationEpoch: currentOwnerCredential.core.memberAuthorizationEpoch,
      requesterAdminCapabilityCoreDigest: currentOwnerAdmin.coreDigest,
      stagedEmptyProjectIndexCheckpointDigest: digest("a"),
      stagedEmptyProjectIndexFullUpdateDigest: digest("b"),
      stagedEmptyProjectIndexStateVectorDigest: digest("c"),
      stagedEmptyProjectIndexCanonicalStateDigest: digest("d"),
      protocolDigest,
      schemaDigest: digest("2"),
      uriProtocolDigest: digest("6"),
    })
    const rolloverProof = Object.freeze({ format: "convax.team-epoch-rollover-proof/2" as const, core: rolloverProofCore, requestDigest: teamEpochRolloverProofCoreDigestV2(rolloverProofCore), requesterAdminMemberSignature: signature })
    const newProjectIndexScope = Object.freeze({ projectId, projectEpoch: rolloverChallenge.core.newProjectEpoch, docKind: "project-index" as const, docId: "project-index" as const, shardEpoch: rolloverChallenge.core.newProjectIndexShardEpoch })
    const attestationCore = Object.freeze({
      format: "convax.empty-project-index-genesis-attestation-core/2" as const,
      projectId,
      newProjectEpoch: rolloverChallenge.core.newProjectEpoch,
      newMembershipEpoch: rolloverChallenge.core.newMembershipEpoch,
      newProjectIndexScope,
      teamEpochRolloverProofCoreDigest: rolloverProof.requestDigest,
      checkpointDigest: rolloverProofCore.stagedEmptyProjectIndexCheckpointDigest,
      fullUpdateDigest: rolloverProofCore.stagedEmptyProjectIndexFullUpdateDigest,
      stateVectorDigest: rolloverProofCore.stagedEmptyProjectIndexStateVectorDigest,
      canonicalStateDigest: rolloverProofCore.stagedEmptyProjectIndexCanonicalStateDigest,
      emptyCatalog: true as const,
      protocolDigest,
      schemaDigest: digest("2"),
      uriProtocolDigest: digest("6"),
      validationArtifactSetDigest: digest("3"),
      trustBundleDigest: digest("4"),
      serviceKeyPurpose: "content-attestation" as const,
      serviceKeyId: "content-key",
    })
    const attestation = Object.freeze({ format: "convax.empty-project-index-genesis-attestation/2" as const, core: attestationCore, coreDigest: emptyProjectIndexGenesisAttestationCoreDigestV2(attestationCore), serviceSignature: signature })
    const attestationFactory = createEmptyProjectIndexGenesisAttestationAdmissionFactoryV2({ verify: async ({ evidence }) => evidence === "isolated-attester" })
    const rejectedAdmission = await attestationFactory.authorize({ attestation, evidence: "ordinary-router" })
    expect(rejectedAdmission).toBe("rejected")
    const beforeFailedCommit = await store.transact(projectId, (transaction) => transaction.read())
    const mismatchedProofCore = Object.freeze({ ...rolloverProofCore, stagedEmptyProjectIndexCheckpointDigest: digest("e") })
    const mismatchedProof = Object.freeze({ ...rolloverProof, core: mismatchedProofCore, requestDigest: teamEpochRolloverProofCoreDigestV2(mismatchedProofCore) })
    const mismatchedAdmission = await attestationFactory.authorize({ attestation, evidence: "isolated-attester" })
    if (mismatchedAdmission === "rejected") throw new Error("test reset attestation rejected")
    await expect(membership.commitTeamEpochRollover(mismatchedProof, attestation, mismatchedAdmission)).rejects.toMatchObject({ code: "invalid-proof" })
    expect(await store.transact(projectId, (transaction) => transaction.read())).toEqual(beforeFailedCommit)
    const admission = await attestationFactory.authorize({ attestation, evidence: "isolated-attester" })
    if (admission === "rejected") throw new Error("test reset attestation rejected")
    const rollover = await membership.commitTeamEpochRollover(rolloverProof, attestation, admission)
    expect(rollover.receipt.core.retiredOldEpochState).toBe("permanently-fenced-recovery-only")
    expect(rollover.membershipSnapshot.core.projectEpoch).toBe(rolloverChallenge.core.newProjectEpoch)
    expect(rollover.membershipSnapshot.core.replicas).toEqual([])
    const afterReset = await store.transact(projectId, (transaction) => transaction.read())
    expect(afterReset?.sessions.every((value) => value.closed)).toBe(true)
    expect(afterReset?.tickets).toEqual([])
    expect(afterReset?.metadata?.registryEntries).toEqual([])
    expect(afterReset?.metadata?.projectResetRolloverReceipts).toEqual([rollover.receipt])
    expect(afterReset?.team?.projectResetCounter).toBe(parseUint64("1"))
  })
})
