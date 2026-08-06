import { describe, expect, mock, test } from "bun:test"
import {
  encodeBase64url,
  parseActorId,
  parseDigest,
  parseId128,
  parseMemberId,
  parsePeerId,
  parseProjectId,
  parsePublicKey,
  parseReplicaId,
  parseSessionId,
  parseSignature,
  parseUint64,
  structuredDigest,
} from "@convax/collaboration"
import {
  CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2,
  membershipMutationProofCoreDigestV2,
  peerTicketRequestCoreDigestV2,
  replicaIdReservationRequestCoreDigestV2,
  sessionProofCoreDigestV2,
  type ActivePeerDirectoryV2,
  type MemberCredentialV2,
  type MembershipSnapshotV2,
  type PeerFreshnessTicketV2,
  type PeerTicketRequestV2,
  type ProjectAdminCapabilityV2,
  type ReplicaIdReservationRequestV2,
  type SessionChallengeV2,
  type SessionCredentialV2,
  type SessionProofV2,
} from "@convax/project/collaboration-protocol"

import { createDesktopCollaborationControlHttpClientV2 } from "./collaboration-control-http-client"

const id = (byte: number) => parseId128(encodeBase64url(new Uint8Array(16).fill(byte)))
const digest = (digit: string) => parseDigest(digit.repeat(64))
const projectId = parseProjectId("project-a")
const memberId = parseMemberId(id(5))
const actorId = parseActorId(encodeBase64url(new Uint8Array(32).fill(2)))
const replicaId = parseReplicaId("replica_00000001")
const peerId = parsePeerId("peer_aaaaaaaaaaaaaaaaaaaaaaaaaa")
const responderReplicaId = parseReplicaId("replica_00000002")
const responderPeerId = parsePeerId("peer_aeaqcaibaeaqcaibaeaqcaibae")
const publicKey = parsePublicKey(encodeBase64url(new Uint8Array(32).fill(3)))
const signature = parseSignature(encodeBase64url(new Uint8Array(64).fill(4)))
const protocolDigest = parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest)

describe("Desktop collaboration control HTTP client", () => {
  test("calls all four exact routes and verifies pinned purpose/key-id artifacts", async () => {
    const artifacts = fixtureArtifacts()
    const requests: Array<{ url: string; body: unknown }> = []
    const fetch = mock(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request)
      requests.push({ url, body: JSON.parse(String(init?.body)) })
      const value = url.endsWith("/session-challenges") ? artifacts.challenge
        : url.endsWith("/sessions") ? artifacts.credential
        : url.endsWith("/peer-directory") ? artifacts.directory
        : artifacts.ticket
      return Response.json(value)
    })
    const verified: string[] = []
    const client = createDesktopCollaborationControlHttpClientV2({
      serviceBaseUrl: "https://control.example/ignored/path",
      fetch: fetch as unknown as typeof globalThis.fetch,
      nowUnixMs: () => 5_000n,
      verifier: {
        async verify(input) { verified.push(`${input.purpose}:${input.serviceKeyId}`); return true },
      },
    })

    await expect(client.requestSessionChallenge({
      projectId, memberId, replicaId, expected: expectedChallenge(),
    })).resolves.toMatchObject({ status: "ok" })
    await expect(client.issueSessionCredential({
      proof: artifacts.proof, expectedChallenge: artifacts.challenge,
    })).resolves.toMatchObject({ status: "ok" })
    await expect(client.getActivePeerDirectory({ credential: artifacts.credential }))
      .resolves.toMatchObject({ status: "ok" })
    await expect(client.requestPeerFreshnessTicket({
      request: artifacts.ticketRequest,
      requesterCredential: artifacts.credential,
      responderCredential: artifacts.responderCredential,
      expectedChannelContractDigest: parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.channelContractDigest),
    })).resolves.toMatchObject({ status: "ok" })

    expect(requests.map(({ url }) => url)).toEqual([
      "https://control.example/api/v2/projects/project-a/session-challenges",
      "https://control.example/api/v2/projects/project-a/sessions",
      "https://control.example/api/v2/projects/project-a/peer-directory",
      "https://control.example/api/v2/projects/project-a/peer-tickets",
    ])
    expect(requests[0]?.body).toEqual({ memberId, replicaId })
    expect(requests[2]?.body).toEqual({ credentialDigest: artifacts.credential.coreDigest })
    expect(verified).toEqual([
      "membership:membership-1",
      "membership:membership-1",
      "membership:membership-1",
      "rendezvous:rendezvous-1",
      "membership:membership-1",
      "membership:membership-1",
      "rendezvous:rendezvous-1",
    ])
  })

  test("missing service URL reports online-disabled without touching local/network state", async () => {
    const fetch = mock(async () => { throw new Error("must not fetch") })
    const client = createDesktopCollaborationControlHttpClientV2({
      fetch: fetch as unknown as typeof globalThis.fetch,
      verifier: { async verify() { return true } },
    })
    await expect(client.requestSessionChallenge({
      projectId, memberId, replicaId, expected: expectedChallenge(),
    })).resolves.toEqual({ status: "online-disabled", reason: "service-url-unconfigured" })
    expect(fetch).not.toHaveBeenCalled()
  })

  test("rejects tampered and expired service artifacts", async () => {
    const source = challenge()
    const tampered = { ...source, core: { ...source.core, actorId: parseActorId(encodeBase64url(new Uint8Array(32).fill(9))) } }
    const tamperedClient = clientReturning(tampered, 5_000n)
    await expect(tamperedClient.requestSessionChallenge({
      projectId, memberId, replicaId, expected: expectedChallenge(),
    })).resolves.toEqual({ status: "rejected", code: "invalid-service-artifact" })

    const expiredClient = clientReturning(source, 61_000n)
    await expect(expiredClient.requestSessionChallenge({
      projectId, memberId, replicaId, expected: expectedChallenge(),
    })).resolves.toEqual({ status: "rejected", code: "expired" })
  })

  test("never treats peerId alone as session identity", async () => {
    const client = clientReturning(directory(credential()), 5_000n)
    await expect(client.getActivePeerDirectory({ credential: { peerId } as never })).rejects.toThrow()
  })

  test("contains network AbortError as online unavailability", async () => {
    const client = createDesktopCollaborationControlHttpClientV2({
      serviceBaseUrl: "https://control.example",
      fetch: (async () => { throw new DOMException("aborted", "AbortError") }) as unknown as typeof globalThis.fetch,
      verifier: { async verify() { return true } },
    })
    await expect(client.requestSessionChallenge({
      projectId, memberId, replicaId, expected: expectedChallenge(),
    })).resolves.toEqual({ status: "unavailable", code: "aborted" })
  })

  test("bootstraps an exact initial team and rejects crossed authority graphs", async () => {
    const value = teamBootstrapArtifacts()
    const client = clientReturning(value, 5_000n)
    await expect(client.bootstrapTeam({
      projectId,
      ...bootstrapInitialization(),
      ownerMemberId: memberId,
      ownerMemberSigningPublicKey: publicKey,
      expectedProtocolDigest: protocolDigest,
      expectedTrustBundleDigest: digest("2"),
    })).resolves.toMatchObject({ status: "ok", value: { invitation: { projectId } } })

    const crossed = { ...value, ownerCredential: { ...value.ownerCredential, core: {
      ...value.ownerCredential.core, membershipSnapshotDigest: digest("f"),
    } } }
    await expect(clientReturning(crossed, 5_000n).bootstrapTeam({
      projectId,
      ...bootstrapInitialization(),
      ownerMemberId: memberId,
      ownerMemberSigningPublicKey: publicKey,
      expectedProtocolDigest: protocolDigest,
      expectedTrustBundleDigest: digest("2"),
    })).resolves.toEqual({ status: "rejected", code: "invalid-service-artifact" })
  })

  test("calls every membership route and preserves typed service rejections", async () => {
    const urls: string[] = []
    const bodies: unknown[] = []
    const fetch = mock(async (request: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(request)); bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ format: "convax.api-error/2", code: "not-active" }, { status: 403 })
    })
    const client = createDesktopCollaborationControlHttpClientV2({
      serviceBaseUrl: "https://control.example",
      fetch: fetch as unknown as typeof globalThis.fetch,
      nowUnixMs: () => 5_000n,
      verifier: { async verify() { return true } },
    })
    const invitation = teamBootstrapArtifacts().invitation
    const reservation = reservationRequest()
    const mutationProof = memberAddProof()
    await expect(client.createInvitation({ projectId, requesterCredentialDigest: digest("1"), adminCapabilityDigest: digest("2"), initialRole: "viewer" }))
      .resolves.toEqual({ status: "rejected", code: "not-active" })
    await expect(client.prepareInvitation({ invitation, mutationId: id(30), targetMemberId: parseMemberId(id(31)), targetMemberSigningPublicKey: publicKey }))
      .resolves.toEqual({ status: "rejected", code: "not-active" })
    await expect(client.revokeInvitation({ projectId, requesterCredentialDigest: digest("1"), invitationToken: invitation.invitationToken }))
      .resolves.toEqual({ status: "rejected", code: "not-active" })
    await expect(client.submitMemberAddSignatureHalf({
      projectId,
      invitationToken: invitation.invitationToken,
      requestDigest: mutationProof.requestDigest,
      kind: "target-possession",
      signature,
    })).resolves.toEqual({ status: "rejected", code: "not-active" })
    await expect(client.reserveReplicaId({ request: reservation })).resolves.toEqual({ status: "rejected", code: "not-active" })
    await expect(client.requestMutationChallenge({ projectId, intent: {
      purpose: "replica-enroll", mutationId: id(32), requesterCredentialDigest: digest("1"), replicaIdReservationReceiptDigest: digest("3"),
    } })).resolves.toEqual({ status: "rejected", code: "not-active" })
    await expect(client.commitMembershipMutation({ proof: mutationProof })).resolves.toEqual({ status: "rejected", code: "not-active" })

    expect(urls.map((url) => url.slice(url.lastIndexOf("/") + 1))).toEqual([
      "invitations", "invitations", "invitations", "member-add-signature-halves", "replica-reservations", "mutation-challenges", "membership-mutations",
    ])
    expect(bodies[0]).toEqual({ action: "create", requesterCredentialDigest: digest("1"), adminCapabilityDigest: digest("2"), initialRole: "viewer" })
    expect(bodies[2]).toEqual({ action: "revoke", requesterCredentialDigest: digest("1"), invitationToken: invitation.invitationToken })
  })

  test("does not convert malformed or server-failure responses into authority rejection", async () => {
    const malformed = createDesktopCollaborationControlHttpClientV2({
      serviceBaseUrl: "https://control.example", verifier: { async verify() { return true } },
      fetch: (async () => Response.json({ code: "not-active" }, { status: 403 })) as unknown as typeof fetch,
    })
    await expect(malformed.createInvitation({ projectId, requesterCredentialDigest: digest("1"), adminCapabilityDigest: digest("2"), initialRole: "viewer" }))
      .resolves.toEqual({ status: "rejected", code: "invalid-service-artifact" })
    const unavailable = createDesktopCollaborationControlHttpClientV2({
      serviceBaseUrl: "https://control.example", verifier: { async verify() { return true } },
      fetch: (async () => Response.json({ format: "convax.api-error/2", code: "adapter-unavailable" }, { status: 503 })) as unknown as typeof fetch,
    })
    await expect(unavailable.createInvitation({ projectId, requesterCredentialDigest: digest("1"), adminCapabilityDigest: digest("2"), initialRole: "viewer" }))
      .resolves.toEqual({ status: "unavailable", code: "http-error" })
  })
})

function clientReturning(value: unknown, now: bigint) {
  return createDesktopCollaborationControlHttpClientV2({
    serviceBaseUrl: "https://control.example",
    fetch: (async () => Response.json(value)) as unknown as typeof globalThis.fetch,
    nowUnixMs: () => now,
    verifier: { async verify() { return true } },
  })
}

function challenge(): SessionChallengeV2 {
  const core = {
    format: "convax.session-challenge-core/2" as const,
    challengeId: id(1), projectId, projectEpoch: id(2), membershipEpoch: id(3),
    membershipSnapshotDigest: digest("1"), memberId, replicaId, actorId,
    expectedReplicaSessionCounter: parseUint64("1"), serverNonce: id(6),
    sessionId: parseSessionId(id(7)), leaseId: id(8), peerId,
    issuedAtUnixMs: parseUint64("1000"), expiresAtUnixMs: parseUint64("61000"),
    protocolDigest, trustBundleDigest: digest("2"), serviceKeyPurpose: "membership" as const,
    serviceKeyId: "membership-1",
  }
  return { format: "convax.session-challenge/2", core,
    coreDigest: structuredDigest("convax.session-challenge-core/2", core), serviceSignature: signature }
}

function proof(source = challenge()): SessionProofV2 {
  const core = {
    format: "convax.session-proof-core/2" as const,
    challengeDigest: source.coreDigest, projectId, projectEpoch: source.core.projectEpoch,
    membershipEpoch: source.core.membershipEpoch, membershipSnapshotDigest: source.core.membershipSnapshotDigest,
    memberId, memberAuthorizationEpoch: id(9), replicaId, actorId,
    replicaAuthorizationEpoch: id(10), replicaSessionCounter: parseUint64("1"),
    serverNonce: source.core.serverNonce, sessionId: source.core.sessionId, leaseId: source.core.leaseId,
    peerId, sessionSigningPublicKey: publicKey, requestedExpiresAtUnixMs: parseUint64("902000"), protocolDigest,
  }
  return { format: "convax.session-proof/2", core, coreDigest: sessionProofCoreDigestV2(core), replicaSignature: signature }
}

function credential(source = challenge(), sessionProof = proof(source), responder = false): SessionCredentialV2 {
  const selectedReplica = responder ? responderReplicaId : replicaId
  const selectedPeer = responder ? responderPeerId : peerId
  const selectedActor = responder ? parseActorId(encodeBase64url(new Uint8Array(32).fill(8))) : actorId
  const core = {
    format: "convax.session-credential-core/2" as const,
    projectId, projectEpoch: source.core.projectEpoch, membershipEpoch: source.core.membershipEpoch,
    membershipSequence: parseUint64("1"), membershipSnapshotDigest: source.core.membershipSnapshotDigest,
    registrySequence: parseUint64("1"), registryRootDigest: digest("3"), memberId,
    memberAuthorizationEpoch: id(9), role: "editor" as const, replicaId: selectedReplica, actorId: selectedActor,
    replicaAuthorizationEpoch: id(10), replicaSigningPublicKey: publicKey, editState: "active-editor" as const,
    sessionId: responder ? parseSessionId(id(17)) : source.core.sessionId,
    leaseId: responder ? id(18) : source.core.leaseId, peerId: selectedPeer, sessionSigningPublicKey: publicKey,
    sessionChallengeDigest: responder ? digest("9") : source.coreDigest,
    sessionProofDigest: responder ? digest("8") : sessionProof.coreDigest,
    issuedAtUnixMs: parseUint64("2000"), expiresAtUnixMs: parseUint64("902000"),
    protocolDigest, schemaDigest: digest("5"), validationArtifactSetDigest: digest("6"),
    trustBundleDigest: source.core.trustBundleDigest, serviceKeyPurpose: "membership" as const, serviceKeyId: "membership-1",
  }
  return { format: "convax.session-credential/2", core,
    coreDigest: structuredDigest("convax.session-credential-core/2", core), serviceSignature: signature }
}

function directory(source: SessionCredentialV2): ActivePeerDirectoryV2 {
  const core = {
    format: "convax.active-peer-directory-core/2" as const,
    projectId, projectEpoch: source.core.projectEpoch, membershipEpoch: source.core.membershipEpoch,
    membershipSnapshotDigest: source.core.membershipSnapshotDigest, directorySequence: parseUint64("1"),
    peers: [{ credentialDigest: source.coreDigest, memberId, replicaId: source.core.replicaId,
      actorId: source.core.actorId, role: source.core.role, editState: source.core.editState,
      peerId: source.core.peerId, leaseId: source.core.leaseId }],
    issuedAtUnixMs: parseUint64("3000"), expiresAtUnixMs: parseUint64("33000"),
    protocolDigest, trustBundleDigest: source.core.trustBundleDigest,
    serviceKeyPurpose: "rendezvous" as const, serviceKeyId: "rendezvous-1",
  }
  return { format: "convax.active-peer-directory/2", core,
    coreDigest: structuredDigest("convax.active-peer-directory-core/2", core), serviceSignature: signature }
}

function fixtureArtifacts() {
  const challengeValue = challenge()
  const proofValue = proof(challengeValue)
  const requester = credential(challengeValue, proofValue)
  const responder = credential(challengeValue, proofValue, true)
  const requestCore = {
    format: "convax.peer-ticket-request-core/2" as const,
    requestId: id(20), connectionId: id(21), requesterCredentialDigest: requester.coreDigest,
    responderCredentialDigest: responder.coreDigest, requesterPeerId: requester.core.peerId,
    responderPeerId: responder.core.peerId, requesterNonce: id(22), protocolDigest,
  }
  const ticketRequest: PeerTicketRequestV2 = {
    format: "convax.peer-ticket-request/2", core: requestCore,
    coreDigest: peerTicketRequestCoreDigestV2(requestCore), requesterSessionSignature: signature,
  }
  const ticketCore = {
    format: "convax.peer-freshness-ticket-core/2" as const,
    ticketId: id(23), requestDigest: ticketRequest.coreDigest, connectionId: ticketRequest.core.connectionId,
    projectId, projectEpoch: requester.core.projectEpoch, membershipEpoch: requester.core.membershipEpoch,
    membershipSnapshotDigest: requester.core.membershipSnapshotDigest,
    requesterCredentialDigest: requester.coreDigest, responderCredentialDigest: responder.coreDigest,
    requesterPeerId: requester.core.peerId, responderPeerId: responder.core.peerId,
    issuedAtUnixMs: parseUint64("4000"), expiresAtUnixMs: parseUint64("64000"),
    channelContractDigest: parseDigest(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.channelContractDigest),
    protocolDigest, trustBundleDigest: requester.core.trustBundleDigest,
    serviceKeyPurpose: "rendezvous" as const, serviceKeyId: "rendezvous-1",
  }
  const ticket: PeerFreshnessTicketV2 = {
    format: "convax.peer-freshness-ticket/2", core: ticketCore,
    coreDigest: structuredDigest("convax.peer-freshness-ticket-core/2", ticketCore), serviceSignature: signature,
  }
  return { challenge: challengeValue, proof: proofValue, credential: requester,
    responderCredential: responder, directory: directory(requester), ticketRequest, ticket }
}

function expectedChallenge() {
  const source = challenge().core
  return { projectEpoch: source.projectEpoch, membershipEpoch: source.membershipEpoch,
    membershipSnapshotDigest: source.membershipSnapshotDigest, actorId: source.actorId,
    protocolDigest: source.protocolDigest }
}

function teamBootstrapArtifacts(): {
  membershipSnapshot: MembershipSnapshotV2
  ownerCredential: MemberCredentialV2
  ownerAdminCapability: ProjectAdminCapabilityV2
  invitation: { invitationToken: string; projectId: typeof projectId; initialRole: "editor"; expiresAtUnixMs: ReturnType<typeof parseUint64> }
  initialization: ReturnType<typeof bootstrapInitialization> & { readonly projectId: typeof projectId }
} {
  const memberAuthorizationEpoch = id(29)
  const snapshotCore = {
    format: "convax.membership-snapshot-core/2" as const,
    projectId,
    projectEpoch: id(2),
    membershipEpoch: id(3),
    membershipSequence: parseUint64("1"),
    registrySequence: parseUint64("1"),
    registryRootDigest: digest("3"),
    members: [{ memberId, memberSigningPublicKey: publicKey, role: "editor" as const, state: "active" as const, memberAuthorizationEpoch, memberMutationCounter: parseUint64("1") }],
    replicas: [],
    protocolDigest,
    trustBundleDigest: digest("2"),
    serviceKeyPurpose: "membership" as const,
    serviceKeyId: "membership-1",
  }
  const membershipSnapshot: MembershipSnapshotV2 = {
    format: "convax.membership-snapshot/2", core: snapshotCore,
    coreDigest: structuredDigest("convax.membership-snapshot-core/2", snapshotCore), serviceSignature: signature,
  }
  const adminCore = {
    format: "convax.project-admin-capability-core/2" as const,
    projectId, projectEpoch: snapshotCore.projectEpoch, membershipEpoch: snapshotCore.membershipEpoch,
    membershipSnapshotDigest: membershipSnapshot.coreDigest, adminMemberId: memberId,
    adminMemberAuthorizationEpoch: memberAuthorizationEpoch, grants: ["membership-admin"] as const,
    protocolDigest, trustBundleDigest: snapshotCore.trustBundleDigest,
    serviceKeyPurpose: "membership" as const, serviceKeyId: "membership-1",
  }
  const ownerAdminCapability: ProjectAdminCapabilityV2 = {
    format: "convax.project-admin-capability/2", core: adminCore,
    coreDigest: structuredDigest("convax.project-admin-capability-core/2", adminCore), serviceSignature: signature,
  }
  const credentialCore = {
    format: "convax.member-credential-core/2" as const,
    projectId, projectEpoch: snapshotCore.projectEpoch, membershipEpoch: snapshotCore.membershipEpoch,
    membershipSnapshotDigest: membershipSnapshot.coreDigest, memberId, memberSigningPublicKey: publicKey,
    role: "editor" as const, memberAuthorizationEpoch, adminCapabilityDigest: ownerAdminCapability.coreDigest,
    protocolDigest, trustBundleDigest: snapshotCore.trustBundleDigest,
    serviceKeyPurpose: "membership" as const, serviceKeyId: "membership-1",
  }
  const ownerCredential: MemberCredentialV2 = {
    format: "convax.member-credential/2", core: credentialCore,
    coreDigest: structuredDigest("convax.member-credential-core/2", credentialCore), serviceSignature: signature,
  }
  return {
    membershipSnapshot, ownerCredential, ownerAdminCapability,
    invitation: {
      invitationToken: encodeBase64url(new Uint8Array(16).fill(42)), projectId,
      initialRole: "editor", expiresAtUnixMs: parseUint64("10000"),
    },
    initialization: { projectId, ...bootstrapInitialization() },
  }
}

function bootstrapInitialization() {
  return Object.freeze({
    projectEpoch: id(2),
    projectIndexShardEpoch: id(4),
    initializationAuthorityDigest: digest("a"),
    initialProjectIndexCheckpointDigest: digest("b"),
    initialProjectIndexFullUpdateDigest: digest("c"),
    initialProjectIndexStateVectorDigest: digest("d"),
    initialProjectIndexCanonicalStateDigest: digest("e"),
  })
}

function reservationRequest(): ReplicaIdReservationRequestV2 {
  const core = {
    format: "convax.replica-id-reservation-request-core/2" as const,
    allocationRequestId: id(40), projectId, projectEpoch: id(2), membershipEpoch: id(3), purpose: "replica-enroll" as const,
    expectedMembershipSequence: parseUint64("1"), requesterMemberId: memberId, targetMemberId: memberId,
    expectedTargetMemberMutationCounter: parseUint64("1"), requesterCredentialDigest: digest("1"), currentReplicaId: null,
    newReplicaSigningPublicKey: publicKey, requestedEditState: "pending-editor" as const, protocolDigest,
  }
  return { format: "convax.replica-id-reservation-request/2", core, coreDigest: replicaIdReservationRequestCoreDigestV2(core), memberSignature: signature }
}

function memberAddProof() {
  const core = {
    format: "convax.mutation-proof-core/2" as const,
    mutationId: id(41), challengeDigest: digest("4"), projectId, projectEpoch: id(2), membershipEpoch: id(3),
    expectedMembershipSequence: parseUint64("1"), requesterMemberId: memberId, targetMemberId: parseMemberId(id(42)),
    targetMemberMutationCounter: parseUint64("1"), serverNonce: id(43), purpose: "member-add" as const,
    targetMemberSigningPublicKey: publicKey, initialRole: "viewer" as const, adminCapabilityDigest: digest("5"),
  }
  return {
    format: "convax.mutation-proof/2" as const, core, requestDigest: membershipMutationProofCoreDigestV2(core),
    signatures: { purpose: "member-add" as const, adminSignature: signature, targetMemberPossessionSignature: signature },
  }
}
