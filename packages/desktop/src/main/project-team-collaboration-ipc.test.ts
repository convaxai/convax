import { describe, expect, mock, test } from "bun:test"

import {
  projectTeamCollaborationIpcChannels,
  type ProjectTeamCollaborationStatus,
} from "../project-team-collaboration-contracts"
import {
  registerProjectTeamCollaborationIpc,
  type ProjectTeamCollaborationIpcMain,
  type ProjectTeamCollaborationMainService,
} from "./project-team-collaboration-ipc"

const projectId = "project-one"
const otherProjectId = "project-two"
const invitation = {
  invitationToken: "AAAAAAAAAAAAAAAAAAAAAA",
  projectId,
  initialRole: "editor" as const,
  expiresAtUnixMs: "1770000000000",
}

function onlineStatus(targetProjectId = projectId): ProjectTeamCollaborationStatus {
  return {
    format: "convax.project-team-collaboration-status",
    projectId: targetProjectId,
    state: "online",
    canEdit: true,
    connectedPeerCount: 1,
    reason: null,
  }
}

function setup() {
  const handlers = new Map<string, (event: any, value: unknown) => unknown>()
  const ipcMain: ProjectTeamCollaborationIpcMain = {
    handle: (channel, listener) => handlers.set(channel, listener),
    removeHandler: (channel) => { handlers.delete(channel) },
  }
  let statusListener: ((status: ProjectTeamCollaborationStatus) => void) | undefined
  const service: ProjectTeamCollaborationMainService = {
    getStatus: mock(() => onlineStatus()),
    bootstrapTeam: mock(async () => ({ invitation, status: onlineStatus() })),
    joinTeam: mock(async () => onlineStatus()),
    subscribe: (listener) => {
      statusListener = listener
      return () => { statusListener = undefined }
    },
  }
  let activeProjectId: string | null = projectId
  const target = { isDestroyed: mock(() => false), send: mock(() => undefined) }
  const trustedEvent = { trusted: true } as any
  const registration = registerProjectTeamCollaborationIpc({
    ipcMain,
    service,
    getActiveProjectId: () => activeProjectId,
    getStatusTarget: () => target,
    isTrustedSender: (event) => event === trustedEvent,
  })
  const invoke = (channel: string, event: any, value: unknown) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`missing ${channel}`)
    return handler(event, value)
  }
  return {
    handlers,
    invoke,
    registration,
    service,
    setActiveProjectId: (value: string | null) => { activeProjectId = value },
    statusListener: () => statusListener,
    target,
    trustedEvent,
  }
}

describe("Project team collaboration Main IPC", () => {
  test("serves status and bootstrap only for the trusted active Project", async () => {
    const harness = setup()
    expect(harness.invoke(projectTeamCollaborationIpcChannels.getStatus, harness.trustedEvent, { projectId })).toEqual(onlineStatus())
    await expect(harness.invoke(
      projectTeamCollaborationIpcChannels.bootstrapTeam,
      harness.trustedEvent,
      { projectId },
    )).resolves.toEqual({ invitation, status: onlineStatus() })

    expect(() => harness.invoke(
      projectTeamCollaborationIpcChannels.getStatus,
      {},
      { projectId },
    )).toThrow("not trusted")
    expect(() => harness.invoke(
      projectTeamCollaborationIpcChannels.getStatus,
      harness.trustedEvent,
      { projectId: otherProjectId },
    )).toThrow("stale")
    harness.registration.dispose()
  })

  test("passes only an exact Project-bound invitation into join", async () => {
    const harness = setup()
    await expect(harness.invoke(
      projectTeamCollaborationIpcChannels.joinTeam,
      harness.trustedEvent,
      { invitation, projectId },
    )).resolves.toEqual(onlineStatus())
    expect(harness.service.joinTeam).toHaveBeenCalledWith({ invitation, projectId })

    await expect(Promise.resolve().then(() => harness.invoke(
      projectTeamCollaborationIpcChannels.joinTeam,
      harness.trustedEvent,
      { invitation: { ...invitation, projectId: otherProjectId }, projectId },
    ))).rejects.toThrow("crossed")
    expect(() => harness.invoke(
      projectTeamCollaborationIpcChannels.joinTeam,
      harness.trustedEvent,
      { invitation, peerId: "route-secret", projectId },
    )).toThrow("unknown")
    harness.registration.dispose()
  })

  test("publishes only active bounded status and stops exactly on dispose", () => {
    const harness = setup()
    harness.statusListener()!(onlineStatus(otherProjectId))
    expect(harness.target.send).not.toHaveBeenCalled()
    harness.statusListener()!(onlineStatus())
    expect(harness.target.send).toHaveBeenCalledWith(projectTeamCollaborationIpcChannels.changed, onlineStatus())

    harness.registration.dispose()
    expect(harness.statusListener()).toBeUndefined()
    expect(harness.handlers.size).toBe(0)
  })
})
