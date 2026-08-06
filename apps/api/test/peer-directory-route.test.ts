import { describe, expect, test } from "bun:test"
import { parseDigest, parseProjectId } from "@convax/collaboration"
import {
  CollaborationRendezvousServiceV2,
  createCollaborationApiV2Handler,
  createSessionDirectoryAuthorizationFactoryV2,
} from "../src"

const projectId = parseProjectId("project-a")
const credentialDigest = parseDigest("1".repeat(64))
const directory = Object.freeze({ format: "convax.active-peer-directory/2", marker: "signed-directory" })

function handler(options?: { readonly authorize?: boolean }) {
  const rendezvous = {
    async getActivePeerDirectory(receivedProjectId: typeof projectId) {
      expect(receivedProjectId).toBe(projectId)
      return directory
    },
  } as unknown as CollaborationRendezvousServiceV2
  return createCollaborationApiV2Handler({
    rendezvous,
    authorizeSessionDirectory: options?.authorize === false ? undefined : async (input) => {
      const factory = createSessionDirectoryAuthorizationFactoryV2({
        verify: async (request) => request.projectId === projectId && request.credentialDigest === credentialDigest,
      })
      return factory.authorize({
        projectId: input.projectId,
        credentialDigest: parseDigest(input.credentialDigest),
        evidence: input.request,
      })
    },
  })
}

function request(body: unknown): Request {
  return new Request(`https://api.example.test/api/v2/projects/${projectId}/peer-directory`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("active peer directory API route", () => {
  test("requires deployment authorization before spending the one-shot service capability", async () => {
    const response = await handler({ authorize: false })(request({ credentialDigest }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: "directory-auth-adapter-unavailable" })
  })

  test("returns the signed directory only after exact credential authorization", async () => {
    const response = await handler()(request({ credentialDigest }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(directory)
  })

  test("does not accept peerId as directory authority", async () => {
    const response = await handler()(request({ peerId: "peer_aaaaaaaaaaaaaaaaaaaaaaaaaa" }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "invalid-proof" })
  })
})
