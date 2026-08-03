import { describe, expect, test } from "bun:test"
import {
  encodeBase64urlV2,
  parseActorIdV2,
  parseDigestV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSignatureV2,
  parseUint64V2,
  structuredDigestV2,
} from "@convax/collaboration"
import { CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2, type SessionProofV2 } from "@convax/project/collaboration-protocol"
import {
  CollaborationControlServiceErrorV2,
  CollaborationRendezvousServiceV2,
  createSessionChallengeAuthorizationFactoryV2,
  createSessionDirectoryAuthorizationFactoryV2,
  InMemoryAtomicControlStateStore,
  type CollaborationControlProjectStateV2,
  type CollaborationProjectSeedV2,
  type ControlDigestSignaturePortV2,
  type ControlRandomSource,
  type SessionChallengeAuthorizationFactoryV2,
} from "../src"

const signature = parseSignatureV2("A".repeat(86))
const publicKey = parsePublicKeyV2("A".repeat(43))
const digest = (value: string) => parseDigestV2(value.repeat(64))
const id = (byte: number) => parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(byte)))
const actor = (byte: number) => parseActorIdV2(encodeBase64urlV2(new Uint8Array(32).fill(byte)))

class FakeClock {
  value = 1_000_000
  nowEpochMilliseconds() { return this.value }
}

class DeterministicRandom implements ControlRandomSource {
  private value = 20
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

function projectSeed(): CollaborationProjectSeedV2 {
  return {
    projectId: parseProjectIdV2("team-project"),
    projectEpoch: id(1),
    membershipEpoch: id(2),
    membershipSequence: parseUint64V2("1"),
    membershipSnapshotDigest: digest("1"),
    registrySequence: parseUint64V2("1"),
    registryRootDigest: digest("2"),
    schemaDigest: digest("3"),
    validationArtifactSetDigest: digest("4"),
    trustBundleDigest: digest("5"),
    members: [member(6, "replica_00000001", 7), member(8, "replica_00000002", 9)],
  }
}

function member(memberByte: number, replica: string, actorByte: number) {
  return {
    memberId: parseMemberIdV2(id(memberByte)),
    memberAuthorizationEpoch: id(memberByte + 20),
    role: "editor" as const,
    active: true,
    replicas: [{
      replicaId: parseReplicaIdV2(replica),
      actorId: actor(actorByte),
      replicaAuthorizationEpoch: id(memberByte + 30),
      replicaSigningPublicKey: publicKey,
      editState: "active-editor" as const,
      sessionCounter: parseUint64V2("0"),
      active: true,
    }],
  }
}

function proofFor(seed: CollaborationProjectSeedV2, memberIndex: number, challenge: Awaited<ReturnType<CollaborationRendezvousServiceV2["issueSessionChallenge"]>>): SessionProofV2 {
  const member = seed.members[memberIndex]!
  const replica = member.replicas[0]!
  const core = {
    format: "convax.session-proof-core/2" as const,
    challengeDigest: challenge.coreDigest,
    projectId: seed.projectId,
    projectEpoch: seed.projectEpoch,
    membershipEpoch: seed.membershipEpoch,
    membershipSnapshotDigest: seed.membershipSnapshotDigest,
    memberId: member.memberId,
    memberAuthorizationEpoch: member.memberAuthorizationEpoch,
    replicaId: replica.replicaId,
    actorId: replica.actorId,
    replicaAuthorizationEpoch: replica.replicaAuthorizationEpoch,
    replicaSessionCounter: challenge.core.expectedReplicaSessionCounter,
    serverNonce: challenge.core.serverNonce,
    sessionId: challenge.core.sessionId,
    leaseId: challenge.core.leaseId,
    peerId: challenge.core.peerId,
    sessionSigningPublicKey: publicKey,
    requestedExpiresAtUnixMs: parseUint64V2("1600000"),
    protocolDigest: parseDigestV2(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest),
  }
  return {
    format: "convax.session-proof/2",
    core,
    coreDigest: structuredDigestV2("convax.session-proof-core/2", core),
    replicaSignature: signature,
  }
}

const authorizationFactory = () => createSessionChallengeAuthorizationFactoryV2({
  verify: async () => true,
})

async function issueChallenge(
  service: CollaborationRendezvousServiceV2,
  factory: SessionChallengeAuthorizationFactoryV2,
  request: Parameters<CollaborationRendezvousServiceV2["issueSessionChallenge"]>[0],
) {
  const authorization = await factory.authorize({ ...request, evidence: "replica-key-pre-proof" })
  if (authorization === "rejected") throw new Error("test authorization rejected")
  return service.issueSessionChallenge(request, authorization)
}

describe("R5 collaboration rendezvous service", () => {
  test("rechecks revoked member and replica state before issuing any peer route", async () => {
    const seed = projectSeed()
    const memberRevoked = { ...seed, members: [{ ...seed.members[0]!, active: false }] }
    const memberService = new CollaborationRendezvousServiceV2(new InMemoryAtomicControlStateStore<CollaborationControlProjectStateV2>(), new FakeClock(), new DeterministicRandom(), signatures)
    await memberService.provisionProject(memberRevoked)
    await expect(issueChallenge(memberService, authorizationFactory(), {
      projectId: seed.projectId,
      memberId: seed.members[0]!.memberId,
      replicaId: seed.members[0]!.replicas[0]!.replicaId,
    })).rejects.toMatchObject({ code: "not-active" })

    const replicaRevoked = { ...seed, members: [{ ...seed.members[0]!, replicas: [{ ...seed.members[0]!.replicas[0]!, active: false }] }] }
    const replicaService = new CollaborationRendezvousServiceV2(new InMemoryAtomicControlStateStore<CollaborationControlProjectStateV2>(), new FakeClock(), new DeterministicRandom(), signatures)
    await replicaService.provisionProject(replicaRevoked)
    await expect(issueChallenge(replicaService, authorizationFactory(), {
      projectId: seed.projectId,
      memberId: seed.members[0]!.memberId,
      replicaId: seed.members[0]!.replicas[0]!.replicaId,
    })).rejects.toMatchObject({ code: "not-active" })
  })

  test("issues service peer ids, current credentials, a bounded directory and a pair ticket", async () => {
    const seed = projectSeed()
    const service = new CollaborationRendezvousServiceV2(
      new InMemoryAtomicControlStateStore<CollaborationControlProjectStateV2>(),
      new FakeClock(),
      new DeterministicRandom(),
      signatures,
    )
    const authorizations = authorizationFactory()
    await service.provisionProject(seed)
    const challengeA = await issueChallenge(service, authorizations, {
      projectId: seed.projectId,
      memberId: seed.members[0]!.memberId,
      replicaId: seed.members[0]!.replicas[0]!.replicaId,
    })
    const challengeB = await issueChallenge(service, authorizations, {
      projectId: seed.projectId,
      memberId: seed.members[1]!.memberId,
      replicaId: seed.members[1]!.replicas[0]!.replicaId,
    })
    expect(challengeA.core.peerId).toMatch(/^peer_[a-z2-7]{26}$/)
    expect(challengeA.core.peerId).not.toBe(challengeB.core.peerId)

    const credentialA = await service.issueSessionCredential(proofFor(seed, 0, challengeA))
    const credentialB = await service.issueSessionCredential(proofFor(seed, 1, challengeB))
    const directoryAuthorization = await createSessionDirectoryAuthorizationFactoryV2({ verify: async () => true }).authorize({
      projectId: seed.projectId,
      credentialDigest: credentialA.coreDigest,
      evidence: "session-signature",
    })
    if (directoryAuthorization === "rejected") throw new Error("test directory authorization rejected")
    const directory = await service.getActivePeerDirectory(seed.projectId, directoryAuthorization)
    expect(directory.core.peers.map((peer) => String(peer.replicaId))).toEqual(["replica_00000001", "replica_00000002"])
    expect(directory.core.peers.map((peer) => peer.peerId)).toEqual([challengeA.core.peerId, challengeB.core.peerId])

    const requestCore = {
      format: "convax.peer-ticket-request-core/2" as const,
      requestId: id(40),
      connectionId: id(41),
      requesterCredentialDigest: credentialA.coreDigest,
      responderCredentialDigest: credentialB.coreDigest,
      requesterPeerId: credentialA.core.peerId,
      responderPeerId: credentialB.core.peerId,
      requesterNonce: id(42),
      protocolDigest: parseDigestV2(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.protocolDigest),
    }
    const request = {
      format: "convax.peer-ticket-request/2" as const,
      core: requestCore,
      coreDigest: structuredDigestV2("convax.peer-ticket-request-core/2", requestCore),
      requesterSessionSignature: signature,
    }
    const first = await service.issuePeerFreshnessTicket(seed.projectId, request)
    const retry = await service.issuePeerFreshnessTicket(seed.projectId, request)
    expect(retry).toEqual(first)
    expect(first.core.connectionId).toBe(requestCore.connectionId)
    expect(first.core.channelContractDigest).toBe(parseDigestV2(CONTROL_PROTOCOL_EXPECTED_IDENTITIES_V2.channelContractDigest))
  })

  test("caps pending challenges and rejects a same-session equivocation", async () => {
    const seed = projectSeed()
    const service = new CollaborationRendezvousServiceV2(
      new InMemoryAtomicControlStateStore<CollaborationControlProjectStateV2>(),
      new FakeClock(),
      new DeterministicRandom(),
      signatures,
    )
    const authorizations = authorizationFactory()
    await service.provisionProject(seed)
    const request = { projectId: seed.projectId, memberId: seed.members[0]!.memberId, replicaId: seed.members[0]!.replicas[0]!.replicaId }
    for (let index = 0; index < 4; index += 1) await issueChallenge(service, authorizations, request)
    await expect(issueChallenge(service, authorizations, request)).rejects.toMatchObject({ code: "capacity-exceeded" })

    const isolated = new CollaborationRendezvousServiceV2(
      new InMemoryAtomicControlStateStore<CollaborationControlProjectStateV2>(),
      new FakeClock(),
      new DeterministicRandom(),
      signatures,
    )
    const isolatedAuthorizations = authorizationFactory()
    await isolated.provisionProject(seed)
    const challenge = await issueChallenge(isolated, isolatedAuthorizations, request)
    const proof = proofFor(seed, 0, challenge)
    await isolated.issueSessionCredential(proof)
    await expect(isolated.issueSessionCredential({ ...proof, coreDigest: digest("f") })).rejects.toBeInstanceOf(CollaborationControlServiceErrorV2)
  })

  test("requires an exact one-shot replica pre-proof capability", async () => {
    const seed = projectSeed()
    const service = new CollaborationRendezvousServiceV2(
      new InMemoryAtomicControlStateStore<CollaborationControlProjectStateV2>(),
      new FakeClock(),
      new DeterministicRandom(),
      signatures,
    )
    await service.provisionProject(seed)
    const request = { projectId: seed.projectId, memberId: seed.members[0]!.memberId, replicaId: seed.members[0]!.replicas[0]!.replicaId }
    const factory = authorizationFactory()
    const authorization = await factory.authorize({ ...request, evidence: "valid" })
    if (authorization === "rejected") throw new Error("test authorization rejected")
    await expect(service.issueSessionChallenge(request, { ...authorization })).rejects.toMatchObject({ code: "invalid-proof" })
    await service.issueSessionChallenge(request, authorization)
    await expect(service.issueSessionChallenge(request, authorization)).rejects.toMatchObject({ code: "invalid-proof" })
  })
})
