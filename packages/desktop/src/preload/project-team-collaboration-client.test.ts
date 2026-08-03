import { describe, expect, mock, test } from "bun:test"

import { projectTeamCollaborationIpcChannelsV2 } from "../project-team-collaboration-contracts"
import {
  createProjectTeamCollaborationPreloadClientV2,
  type ProjectTeamCollaborationPreloadIpcV2,
} from "./project-team-collaboration-client"

const projectId = "123e4567-e89b-42d3-a456-426614174000"
const invitation = {
  expiresAtUnixMs: "1770000000000",
  initialRole: "editor" as const,
  invitationToken: "AAAAAAAAAAAAAAAAAAAAAA",
  projectId,
}

function onlineStatus() {
  return {
    canEdit: true,
    connectedPeerCount: 1,
    format: "convax.project-team-collaboration-status/2" as const,
    projectId,
    reason: null,
    state: "online" as const,
  }
}

function fakeIpc(response: unknown = onlineStatus()) {
  const listeners = new Map<string, (event: unknown, value: unknown) => void>()
  const invoke = mock(async () => response)
  const ipc: ProjectTeamCollaborationPreloadIpcV2 = {
    invoke,
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel)
    },
  }
  return { invoke, ipc, listeners }
}

describe("Project team collaboration preload client", () => {
  test("exposes only bounded status projections and the plain invitation carrier", async () => {
    const { invoke, ipc } = fakeIpc({ invitation, status: onlineStatus() })
    const client = createProjectTeamCollaborationPreloadClientV2(ipc)

    await expect(client.bootstrapTeam({ projectId })).resolves.toEqual({ invitation, status: onlineStatus() })
    expect(invoke).toHaveBeenLastCalledWith(projectTeamCollaborationIpcChannelsV2.bootstrapTeam, { projectId })

    invoke.mockImplementation(async () => onlineStatus())
    await expect(client.joinTeam({ invitation, projectId })).resolves.toEqual(onlineStatus())
    expect(invoke).toHaveBeenLastCalledWith(projectTeamCollaborationIpcChannelsV2.joinTeam, {
      invitation,
      projectId,
    })
  })

  test("rejects an invitation for another Project before IPC", async () => {
    const { invoke, ipc } = fakeIpc()
    const client = createProjectTeamCollaborationPreloadClientV2(ipc)

    await expect(
      client.joinTeam({ invitation: { ...invitation, projectId: "project-other" }, projectId }),
    ).rejects.toThrow("crossed")
    expect(invoke).not.toHaveBeenCalled()
  })

  test("rejects malformed Main responses instead of leaking them", async () => {
    const { ipc } = fakeIpc({ ...onlineStatus(), peerId: "routing-secret" })
    const client = createProjectTeamCollaborationPreloadClientV2(ipc)

    await expect(client.getStatus({ projectId })).rejects.toThrow("unknown or missing fields")
  })

  test("drops malformed events and removes the exact subscription", () => {
    const { ipc, listeners } = fakeIpc()
    const client = createProjectTeamCollaborationPreloadClientV2(ipc)
    const observed = mock(() => undefined)
    const unsubscribe = client.subscribeStatus(observed)
    const emit = listeners.get(projectTeamCollaborationIpcChannelsV2.changed)!

    emit({}, { ...onlineStatus(), peerId: "not-renderer-safe" })
    emit({}, onlineStatus())
    expect(observed).toHaveBeenCalledTimes(1)
    expect(observed).toHaveBeenCalledWith(onlineStatus())

    unsubscribe()
    expect(listeners.has(projectTeamCollaborationIpcChannelsV2.changed)).toBe(false)
  })
})
