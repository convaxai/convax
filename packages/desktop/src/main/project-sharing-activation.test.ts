import { describe, expect, mock, test } from "bun:test"

import {
  ProjectTeamCollaborationManager,
  type ProjectTeamPeerSessionFactory,
} from "./project-team-collaboration-manager"
import { activateProjectSharingFromDurableBinding } from "./project-sharing-activation"

const projectId = "project-local-first-activation"

describe("durable Project sharing activation", () => {
  test("an unshared Project makes zero Control, Team-vault, rendezvous, and PeerJS factory calls", async () => {
    const calls = {
      openExisting: mock(async () => { throw new Error("Team factory must stay cold") }),
      bootstrapTeam: mock(async () => { throw new Error("Control bootstrap must stay cold") }),
      joinTeam: mock(async () => { throw new Error("Team join must stay cold") }),
    }
    const manager = new ProjectTeamCollaborationManager(calls as ProjectTeamPeerSessionFactory)

    await expect(activateProjectSharingFromDurableBinding({
      projectId,
      sharing: { async open() { return "missing" } },
      service: manager,
    })).resolves.toEqual(expect.objectContaining({ projectId, state: "local-only" }))

    expect(calls.openExisting).not.toHaveBeenCalled()
    expect(calls.bootstrapTeam).not.toHaveBeenCalled()
    expect(calls.joinTeam).not.toHaveBeenCalled()
    await manager.dispose()
  })

  test("a durable or corrupt sharing selector never falls back to local activation", async () => {
    for (const selected of [{ projectId } as never, "rejected" as const]) {
      const activateLocalProject = mock(async () => { throw new Error("must not downgrade to personal") })
      const activateProject = mock(async () => ({
        format: "convax.project-team-collaboration-status" as const,
        projectId,
        state: "attention" as const,
        canEdit: false,
        connectedPeerCount: 0,
        reason: "protocol-rejected" as const,
      }))
      await expect(activateProjectSharingFromDurableBinding({
        projectId,
        sharing: { async open() { return selected } },
        service: { activateLocalProject, activateProject },
      })).resolves.toEqual(expect.objectContaining({ state: "attention" }))
      expect(activateProject).toHaveBeenCalledTimes(1)
      expect(activateLocalProject).not.toHaveBeenCalled()
    }
  })
})
