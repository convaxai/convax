import { describe, expect, test } from "bun:test"

import {
  parseProjectTeamBootstrapResult,
  parseProjectTeamCollaborationStatus,
  parseProjectTeamInvitation,
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
      format: "convax.project-team-collaboration-status",
      projectId,
      state: "online",
      canEdit: true,
      connectedPeerCount: 2,
      reason: null,
    } as const
    expect(parseProjectTeamCollaborationStatus(status)).toEqual(status)
    expect(() => parseProjectTeamCollaborationStatus({ ...status, peerId: "secret-route" })).toThrow("unknown")
    expect(() => parseProjectTeamCollaborationStatus({ ...status, connectedPeerCount: 513 })).toThrow("count")
    expect(() => parseProjectTeamCollaborationStatus({ ...status, state: "attention" })).toThrow("reason")
  })

  test("accepts only the API-owned plain invitation carrier", () => {
    expect(parseProjectTeamInvitation(invitation)).toEqual(invitation)
    expect(() => parseProjectTeamInvitation({ ...invitation, format: "convax.project-team-invitation" })).toThrow("unknown")
    expect(() => parseProjectTeamInvitation({ ...invitation, invitationToken: "not-an-exact-128-bit-token" })).toThrow("token")
    expect(() => parseProjectTeamInvitation({ ...invitation, invitationToken: "AAAAAAAAAAAAAAAAAAAAAB" })).toThrow("token")
    expect(() => parseProjectTeamInvitation({ ...invitation, initialRole: "owner" })).toThrow("role")
  })

  test("binds a bootstrap invitation to the exact status Project", () => {
    const status = {
      format: "convax.project-team-collaboration-status",
      projectId,
      state: "online",
      canEdit: true,
      connectedPeerCount: 0,
      reason: null,
    } as const
    expect(parseProjectTeamBootstrapResult({ invitation, status })).toEqual({ invitation, status })
    expect(() => parseProjectTeamBootstrapResult({ invitation: { ...invitation, projectId: "project-two" }, status })).toThrow("crossed")
    expect(() => parseProjectTeamBootstrapResult({ invitation, status, credential: "secret" })).toThrow("unknown")
  })
})
