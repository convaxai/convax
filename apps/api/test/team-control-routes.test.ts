import { describe, expect, test } from "bun:test"
import { encodeBase64urlV2, parseId128V2, parseMemberIdV2, parseProjectIdV2, parsePublicKeyV2 } from "@convax/collaboration"
import {
  CollaborationMembershipServiceV2,
  createCollaborationApiV2Handler,
  createProjectBootstrapAuthorizationFactoryV2,
  createTeamInvitationAuthorizationFactoryV1,
} from "../src"

const projectId = parseProjectIdV2("project-a")
const memberId = parseMemberIdV2(parseId128V2(encodeBase64urlV2(new Uint8Array(16).fill(1))))
const publicKey = parsePublicKeyV2(encodeBase64urlV2(new Uint8Array(32).fill(2)))
const bootstrapResult = Object.freeze({ marker: "signed-bootstrap-artifacts" })
const bootstrapBody = Object.freeze({
  projectEpoch: encodeBase64urlV2(new Uint8Array(16).fill(3)),
  projectIndexShardEpoch: encodeBase64urlV2(new Uint8Array(16).fill(4)),
  initializationAuthorityDigest: "1".repeat(64),
  initialProjectIndexCheckpointDigest: "2".repeat(64),
  initialProjectIndexFullUpdateDigest: "3".repeat(64),
  initialProjectIndexStateVectorDigest: "4".repeat(64),
  initialProjectIndexCanonicalStateDigest: "5".repeat(64),
  ownerMemberId: memberId,
  ownerMemberSigningPublicKey: publicKey,
})

function request(segment: string, body: unknown): Request {
  return new Request(`https://api.example.test/api/v2/projects/${projectId}/${segment}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("team control HTTP routes", () => {
  test("requires deployment identity authorization and never treats peerId as bootstrap authority", async () => {
    const membership = { bootstrapProject: async () => bootstrapResult } as unknown as CollaborationMembershipServiceV2
    const unavailable = createCollaborationApiV2Handler({ membership })
    expect((await unavailable(request("bootstrap", bootstrapBody))).status).toBe(503)

    const rejected = createCollaborationApiV2Handler({
      membership,
      authorizeProjectBootstrap: async () => "rejected",
    })
    expect((await rejected(request("bootstrap", bootstrapBody))).status).toBe(403)
    expect((await rejected(request("bootstrap", { peerId: "peer_aaaaaaaaaaaaaaaaaaaaaaaaaa" }))).status).toBe(400)
  })

  test("passes only a one-shot exact bootstrap capability into the service", async () => {
    const factory = createProjectBootstrapAuthorizationFactoryV2({ verify: async (value) => value.evidence instanceof Request })
    let called = 0
    const membership = {
      async bootstrapProject(input: unknown, authorization: unknown) {
        called += 1
        expect(input).toEqual({ projectId, ...bootstrapBody })
        expect(authorization).toBeTruthy()
        return bootstrapResult
      },
    } as unknown as CollaborationMembershipServiceV2
    const handler = createCollaborationApiV2Handler({
      membership,
      authorizeProjectBootstrap: async ({ request: source, ...input }) => factory.authorize({ ...input, evidence: source }),
    })
    const response = await handler(request("bootstrap", bootstrapBody))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(bootstrapResult)
    expect(called).toBe(1)
  })

  test("keeps mandatory metadata surfaces closed when their owner adapter is absent", async () => {
    const membership = {} as CollaborationMembershipServiceV2
    for (const segment of ["checkpoint-certificates", "stable-checkpoint-sets", "replica-floor-acks", "project-floors", "registry-claims", "cutoffs"]) {
      const response = await createCollaborationApiV2Handler({ membership })(request(segment, { metadata: "only" }))
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ code: "control-adapters-unavailable" })
    }
  })

  test("routes opaque invitation create, prepare and revoke without accepting peerId", async () => {
    const credentialDigest = "1".repeat(64)
    const adminCapabilityDigest = "2".repeat(64)
    const invitationToken = encodeBase64urlV2(new Uint8Array(16).fill(7))
    const factory = createTeamInvitationAuthorizationFactoryV1({ verify: async ({ evidence }) => evidence instanceof Request })
    const calls: string[] = []
    const membership = {
      async createInvitation() { calls.push("create"); return { invitationToken, projectId, initialRole: "editor", expiresAtUnixMs: "1000" } },
      async prepareInvitation() { calls.push("prepare"); return { requestDigest: "3".repeat(64) } },
      async listOwnerMemberAddInvitations() { calls.push("list"); return [] },
      async revokeInvitation() { calls.push("revoke") },
      async submitMemberAddSignatureHalf() { calls.push("half"); return { status: "pending-other-signature", requestDigest: "3".repeat(64) } },
    } as unknown as CollaborationMembershipServiceV2
    const handler = createCollaborationApiV2Handler({
      membership,
      authorizeTeamInvitation: async ({ request: source, ...input }) => factory.authorize({ ...input, evidence: source }),
    })
    expect((await handler(request("invitations", { action: "create", requesterCredentialDigest: credentialDigest, adminCapabilityDigest, initialRole: "editor" }))).status).toBe(200)
    expect((await handler(request("invitations", { action: "prepare", invitationToken, mutationId: encodeBase64urlV2(new Uint8Array(16).fill(8)), targetMemberId: memberId, targetMemberSigningPublicKey: publicKey }))).status).toBe(200)
    expect((await handler(request("invitations", { action: "list-member-add", requesterCredentialDigest: credentialDigest, adminCapabilityDigest }))).status).toBe(200)
    expect((await handler(request("member-add-signature-halves", { invitationToken, requestDigest: "3".repeat(64), kind: "target-possession", signature: encodeBase64urlV2(new Uint8Array(64).fill(9)) }))).status).toBe(200)
    expect((await handler(request("invitations", { action: "revoke", requesterCredentialDigest: credentialDigest, invitationToken }))).status).toBe(200)
    expect(calls).toEqual(["create", "prepare", "list", "half", "revoke"])
    expect((await handler(request("invitations", { action: "create", peerId: "peer_aaaaaaaaaaaaaaaaaaaaaaaaaa" }))).status).toBe(400)
  })
})
