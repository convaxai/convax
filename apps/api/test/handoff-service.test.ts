import { describe, expect, test } from "bun:test"
import {
  encodeBase64urlV2,
  encodeRestrictedJcsV2,
  ordinarySha256V2,
  parseActorIdV2,
  parseId128V2,
  parseMemberIdV2,
  parseProjectIdV2,
  parsePublicKeyV2,
  parseReplicaIdV2,
  parseSignatureV2,
  parseUint64V2,
  projectSharingHandoffCoreDigestV3,
  structuredDigestV2,
  type ProjectSharingHandoffCoreV3,
  type ProjectSharingHandoffProposalV3,
} from "@convax/collaboration"
import type {
  MembershipSnapshotV2,
  ReplicaActorCredentialV2,
  ReplicaEditAuthorizationV2,
} from "@convax/project/collaboration-protocol"
import { createProjectSharingHandoffApiV3Handler } from "../src/handoff-api"
import {
  InMemoryProjectSharingHandoffStoreV3,
  ProjectSharingHandoffServiceV3,
  type ProjectSharingInitialTeamArtifactsV3,
} from "../src/handoff-service"

const bytes = (length: number, value: number) => encodeBase64urlV2(Uint8Array.from({ length }, () => value))
const ID = parseId128V2(bytes(16, 1))
const PROJECT = parseProjectIdV2(`project_${"a".repeat(64)}`)
const MEMBER = parseMemberIdV2(bytes(16, 2))
const REPLICA = parseReplicaIdV2("replica_00000001")
const OWNER_KEY = parsePublicKeyV2(bytes(32, 3))
const ACTOR = parseActorIdV2(OWNER_KEY)
const SERVICE_KEY = parsePublicKeyV2(bytes(32, 4))
const SIGNATURE = parseSignatureV2(bytes(64, 5))
const PROTOCOL = digest("protocol-v3")
const TRUST = digest("trust-v3")
const SERVICE_KEY_ID = domainDigest("convax.project-sharing-service-public-key/3", SERVICE_KEY)

describe("V3 sharing handoff service", () => {
  test("commits one dual-signed receipt, retries byte-identically and recovers lost responses", async () => {
    const artifacts = teamArtifacts()
    const proposal = handoffProposal(artifacts)
    const service = createService(artifacts)
    const first = await service.submit(proposal)
    expect(first.status).toBe("committed")
    if (first.status !== "committed") throw new Error("handoff did not commit")
    const retry = await service.submit(proposal)
    expect(retry).toEqual(first)
    const recovered = await service.recover({ projectId: PROJECT, handoffId: ID })
    expect(recovered).toEqual(first)
    const changed = handoffProposal(artifacts, { projectIndexHead: { ...proposal.core.projectIndexHead, acceptedHeadDigest: digest("other") } })
    expect((await service.submit(changed)).status).toBe("equivocation")
  })

  test("keeps outcome pending when closure or recovery evidence is unavailable", async () => {
    const artifacts = teamArtifacts()
    const service = createService(artifacts, "pending")
    expect((await service.submit(handoffProposal(artifacts))).status).toBe("pending")
    expect((await service.recover({ projectId: PROJECT, handoffId: ID })).status).toBe("pending")
  })

  test("exposes bounded submit/recover endpoints without frame payload routes", async () => {
    const artifacts = teamArtifacts()
    const proposal = handoffProposal(artifacts)
    const handler = createProjectSharingHandoffApiV3Handler(createService(artifacts))
    const submit = await handler(new Request(`https://api.convax.test/api/v3/projects/${PROJECT}/handoffs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(proposal),
    }))
    expect(submit.status).toBe(200)
    const recover = await handler(new Request(`https://api.convax.test/api/v3/projects/${PROJECT}/handoff-recovery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handoffId: ID }),
    }))
    expect(recover.status).toBe(200)
    expect((await handler(new Request(`https://api.convax.test/api/v3/projects/${PROJECT}/frames`, { method: "POST" }))).status).toBe(404)
  })
})

function createService(artifacts: ProjectSharingInitialTeamArtifactsV3, closure: "verified" | "pending" = "verified") {
  return new ProjectSharingHandoffServiceV3({
    protocolDigest: PROTOCOL,
    trustBundleDigest: TRUST,
    ownerAuthority: { resolve: async () => ({ status: "verified", ownerPublicKey: OWNER_KEY }) },
    causalClosure: { verifyExact: async () => closure },
    teamArtifacts: { resolveExact: async () => ({ status: "resolved", artifacts }) },
    verifier: { verify: async () => true },
    serviceSigningPublicKey: SERVICE_KEY,
    serviceSigningKeyId: SERVICE_KEY_ID,
    signer: { sign: async () => SIGNATURE },
    store: new InMemoryProjectSharingHandoffStoreV3(),
  })
}

function handoffProposal(artifacts: ProjectSharingInitialTeamArtifactsV3, overrides: Partial<ProjectSharingHandoffCoreV3> = {}): ProjectSharingHandoffProposalV3 {
  const core: ProjectSharingHandoffCoreV3 = {
    format: "convax.project-sharing-handoff-core/3",
    handoffId: ID,
    projectId: PROJECT,
    projectEpoch: ID,
    previousOwnerBindingCoreDigest: digest("owner-binding"),
    previousOwnerKeyId: domainDigest("convax.local-project-owner-public-key/3", OWNER_KEY),
    sharingGeneration: "1",
    projectIndexHead: {
      scope: { projectId: PROJECT, projectEpoch: ID, docKind: "project-index", docId: "project-index", shardEpoch: ID },
      acceptedFrontierDigest: digest("frontier"),
      acceptedHeadDigest: digest("head"),
    },
    liveCanvasHeads: [],
    serviceTrustBundleDigest: TRUST,
    initialMembershipSnapshotDigest: artifacts.membershipSnapshot.coreDigest,
    initialOwnerMemberId: MEMBER,
    initialOwnerReplicaId: REPLICA,
    initialOwnerActorId: ACTOR,
    initialReplicaActorCredentialCoreDigest: artifacts.replicaActorCredential.coreDigest,
    initialReplicaEditAuthorizationCoreDigest: artifacts.replicaEditAuthorization.coreDigest,
    successorProtocolDigest: PROTOCOL,
    ...overrides,
  }
  return Object.freeze({
    format: "convax.project-sharing-handoff-proposal/3",
    core,
    coreDigest: projectSharingHandoffCoreDigestV3(core),
    ownerSignature: SIGNATURE,
  })
}

function teamArtifacts(): ProjectSharingInitialTeamArtifactsV3 {
  const serviceFields = { protocolDigest: PROTOCOL, trustBundleDigest: TRUST, serviceKeyPurpose: "membership" as const, serviceKeyId: "membership-key" }
  const reservation = digest("reservation")
  const membershipCore = {
    format: "convax.membership-snapshot-core/2" as const,
    projectId: PROJECT,
    projectEpoch: ID,
    membershipEpoch: ID,
    membershipSequence: parseUint64V2("1"),
    registrySequence: parseUint64V2("0"),
    registryRootDigest: digest("registry"),
    members: [{ memberId: MEMBER, memberSigningPublicKey: OWNER_KEY, role: "editor" as const, state: "active" as const, memberAuthorizationEpoch: ID, memberMutationCounter: parseUint64V2("0") }],
    replicas: [{ replicaId: REPLICA, replicaIdReservationReceiptDigest: reservation, memberId: MEMBER, actorId: ACTOR, replicaSigningPublicKey: OWNER_KEY, state: "active" as const, editState: "active-editor" as const, replicaAuthorizationEpoch: ID, enrolledAtMembershipSequence: parseUint64V2("1"), revokedAtMembershipSequence: null, replacesReplicaId: null }],
    ...serviceFields,
  }
  const membershipSnapshot: MembershipSnapshotV2 = { format: "convax.membership-snapshot/2", core: membershipCore, coreDigest: structuredDigestV2("convax.membership-snapshot-core/2", membershipCore), serviceSignature: SIGNATURE }
  const actorCore = { format: "convax.replica-actor-credential-core/2" as const, projectId: PROJECT, projectEpoch: ID, memberId: MEMBER, replicaId: REPLICA, replicaIdReservationReceiptDigest: reservation, actorId: ACTOR, replicaSigningPublicKey: OWNER_KEY, replicaAuthorizationEpoch: ID, ...serviceFields }
  const replicaActorCredential: ReplicaActorCredentialV2 = { format: "convax.replica-actor-credential/2", core: actorCore, coreDigest: structuredDigestV2("convax.replica-actor-credential-core/2", actorCore), serviceSignature: SIGNATURE }
  const editCore = { format: "convax.replica-edit-authorization-core/2" as const, projectId: PROJECT, projectEpoch: ID, membershipEpoch: ID, membershipSnapshotDigest: membershipSnapshot.coreDigest, membershipSequence: parseUint64V2("1"), memberId: MEMBER, memberAuthorizationEpoch: ID, replicaId: REPLICA, replicaIdReservationReceiptDigest: reservation, actorId: ACTOR, replicaAuthorizationEpoch: ID, role: "editor" as const, editState: "active-editor" as const, installedFloorSetDigest: digest("floor"), schemaDigest: digest("schema"), validationArtifactSetDigest: digest("artifacts"), ...serviceFields }
  const replicaEditAuthorization: ReplicaEditAuthorizationV2 = { format: "convax.replica-edit-authorization/2", core: editCore, coreDigest: structuredDigestV2("convax.replica-edit-authorization-core/2", editCore), serviceSignature: SIGNATURE }
  return Object.freeze({ membershipSnapshot, replicaActorCredential, replicaEditAuthorization })
}

function domainDigest(domain: string, value: unknown) {
  const left = new TextEncoder().encode(domain)
  const right = encodeRestrictedJcsV2(value)
  const joined = new Uint8Array(left.length + 1 + right.length)
  joined.set(left); joined.set(right, left.length + 1)
  return ordinarySha256V2(joined)
}

function digest(label: string) { return ordinarySha256V2(new TextEncoder().encode(label)) }
