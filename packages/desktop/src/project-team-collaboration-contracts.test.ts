import { describe, expect, test } from "bun:test"

import {
  parseProjectTeamBootstrapResultV2,
  parseProjectTeamCollaborationStatusV2,
  parseProjectTeamInvitationV2,
} from "./project-team-collaboration-contracts"

const projectId = "project-one"
const invitation = {
  invitationToken: "AAAAAAAAAAAAAAAAAAAAAA",
  projectId,
  initialRole: "editor" as const,
  expiresAtUnixMs: "1770000000000",
}

describe("Project team collaboration renderer contract", () => {
  test("accepts only the closed bounded status projection", () => {
    const status = {
      format: "convax.project-team-collaboration-status/2",
      projectId,
      state: "online",
      canEdit: true,
      connectedPeerCount: 2,
      reason: null,
    } as const
    expect(parseProjectTeamCollaborationStatusV2(status)).toEqual(status)
    expect(() => parseProjectTeamCollaborationStatusV2({ ...status, peerId: "secret-route" })).toThrow("unknown")
    expect(() => parseProjectTeamCollaborationStatusV2({ ...status, connectedPeerCount: 513 })).toThrow("count")
    expect(() => parseProjectTeamCollaborationStatusV2({ ...status, state: "attention" })).toThrow("reason")
  })

  test("accepts only the API-owned plain invitation carrier", () => {
    expect(parseProjectTeamInvitationV2(invitation)).toEqual(invitation)
    expect(() => parseProjectTeamInvitationV2({ ...invitation, format: "convax.project-team-invitation/2" })).toThrow("unknown")
    expect(() => parseProjectTeamInvitationV2({ ...invitation, invitationToken: "not-an-exact-128-bit-token" })).toThrow("token")
    expect(() => parseProjectTeamInvitationV2({ ...invitation, invitationToken: "AAAAAAAAAAAAAAAAAAAAAB" })).toThrow("token")
    expect(() => parseProjectTeamInvitationV2({ ...invitation, initialRole: "owner" })).toThrow("role")
  })

  test("binds a bootstrap invitation to the exact status Project", () => {
    const status = {
      format: "convax.project-team-collaboration-status/2",
      projectId,
      state: "online",
      canEdit: true,
      connectedPeerCount: 0,
      reason: null,
    } as const
    expect(parseProjectTeamBootstrapResultV2({ invitation, status })).toEqual({ invitation, status })
    expect(() => parseProjectTeamBootstrapResultV2({ invitation: { ...invitation, projectId: "project-two" }, status })).toThrow("crossed")
    expect(() => parseProjectTeamBootstrapResultV2({ invitation, status, credential: "secret" })).toThrow("unknown")
  })
})
