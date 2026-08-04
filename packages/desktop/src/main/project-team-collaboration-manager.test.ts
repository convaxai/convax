import { describe, expect, mock, test } from "bun:test"

import {
  ProjectTeamCollaborationManagerV2,
  type ProjectTeamPeerSessionFactoryV2,
  type ProjectTeamPeerSessionOpenResultV2,
  type ProjectTeamPeerSessionSnapshotV2,
  type ProjectTeamPeerSessionV2,
} from "./project-team-collaboration-manager"

const projectOne = "project-one"
const projectTwo = "project-two"
const invitation = {
  invitationToken: "AAAAAAAAAAAAAAAAAAAAAA",
  projectId: projectOne,
  initialRole: "editor" as const,
  expiresAtUnixMs: "1770000000000",
}

class FakeSession implements ProjectTeamPeerSessionV2 {
  readonly listeners = new Set<(snapshot: ProjectTeamPeerSessionSnapshotV2) => void>()
  readonly quiesce = mock(async (): Promise<void> => undefined)
  readonly onlineCalls: boolean[] = []

  constructor(
    readonly projectId: string,
    private current: ProjectTeamPeerSessionSnapshotV2 = {
      state: "online", canEdit: true, connectedPeerCount: 1, reason: null,
    },
  ) {}

  snapshot() { return this.current }
  subscribe(listener: (snapshot: ProjectTeamPeerSessionSnapshotV2) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  setOnline(online: boolean) { this.onlineCalls.push(online) }
  publish(snapshot: ProjectTeamPeerSessionSnapshotV2) {
    this.current = snapshot
    for (const listener of this.listeners) listener(snapshot)
  }
}

function factory(overrides: Partial<ProjectTeamPeerSessionFactoryV2> = {}): ProjectTeamPeerSessionFactoryV2 {
  return {
    openExisting: async () => ({ status: "local-only" }),
    bootstrapTeam: async ({ projectId }) => ({
      invitation: { ...invitation, projectId },
      session: { status: "ready", session: new FakeSession(projectId) },
    }),
    joinTeam: async ({ projectId }) => ({ status: "ready", session: new FakeSession(projectId) }),
    ...overrides,
  }
}

describe("ProjectTeamCollaborationManagerV2", () => {
  test("keeps an unteamed Project local-only without fabricating a session", async () => {
    const manager = new ProjectTeamCollaborationManagerV2(factory())
    await expect(manager.activateProject(projectOne)).resolves.toEqual(expect.objectContaining({
      projectId: projectOne, state: "local-only", canEdit: false, connectedPeerCount: 0,
    }))
    await manager.dispose()
  })

  test("starts one verified session for duplicate active-Project activation", async () => {
    const session = new FakeSession(projectOne)
    const openExisting = mock(async (): Promise<ProjectTeamPeerSessionOpenResultV2> => ({ status: "ready", session }))
    const manager = new ProjectTeamCollaborationManagerV2(factory({ openExisting }))
    await manager.activateProject(projectOne)
    await manager.activateProject(projectOne)
    expect(openExisting).toHaveBeenCalledTimes(1)
    expect(session.onlineCalls).toEqual([true])
    await manager.dispose()
  })

  test("quiesces the previous Project before publishing the next Project session", async () => {
    const first = new FakeSession(projectOne)
    const second = new FakeSession(projectTwo)
    const manager = new ProjectTeamCollaborationManagerV2(factory({
      openExisting: async ({ projectId }) => ({ status: "ready", session: projectId === projectOne ? first : second }),
    }))
    await manager.activateProject(projectOne)
    await manager.activateProject(projectTwo)
    expect(first.quiesce).toHaveBeenCalledTimes(1)
    expect(manager.getStatus(projectTwo).state).toBe("online")
    expect(manager.getStatus(projectOne).state).toBe("local-only")
    await manager.dispose()
  })

  test("a stale async open cannot retain or publish a session after Project switch", async () => {
    let release!: (value: ProjectTeamPeerSessionOpenResultV2) => void
    const late = new FakeSession(projectOne)
    const current = new FakeSession(projectTwo)
    const manager = new ProjectTeamCollaborationManagerV2(factory({
      openExisting: ({ projectId }) => projectId === projectOne
        ? new Promise((resolve) => { release = resolve })
        : Promise.resolve({ status: "ready", session: current }),
    }))
    const first = manager.activateProject(projectOne)
    await waitFor(() => typeof release === "function")
    const second = manager.activateProject(projectTwo)
    release({ status: "ready", session: late })
    await expect(first).rejects.toMatchObject({ name: "AbortError" })
    await expect(second).resolves.toEqual(expect.objectContaining({ projectId: projectTwo, state: "online" }))
    expect(late.quiesce).toHaveBeenCalledTimes(1)
    await manager.dispose()
  })

  test("credential expiry and revocation close transport while retaining a bounded status", async () => {
    for (const reason of ["credential-expired", "authorization-revoked"] as const) {
      const session = new FakeSession(projectOne)
      const manager = new ProjectTeamCollaborationManagerV2(factory({
        openExisting: async () => ({ status: "ready", session }),
      }))
      await manager.activateProject(projectOne)
      session.publish({ state: "attention", canEdit: false, connectedPeerCount: 0, reason })
      await Promise.resolve()
      expect(manager.getStatus(projectOne)).toEqual(expect.objectContaining({ state: "attention", reason }))
      expect(session.quiesce).toHaveBeenCalledTimes(1)
      await manager.dispose()
    }
  })

  test("forwards browser connectivity only to the active physical session", async () => {
    const session = new FakeSession(projectOne)
    const manager = new ProjectTeamCollaborationManagerV2(factory({
      openExisting: async () => ({ status: "ready", session }),
    }))
    await manager.activateProject(projectOne)
    manager.setOnline(false)
    manager.setOnline(false)
    manager.setOnline(true)
    expect(session.onlineCalls).toEqual([true, false, true])
    await manager.dispose()
  })

  test("bootstrap and join require the exact active Project and bound the invitation", async () => {
    const joinTeam = mock(async ({ projectId }: { projectId: string }) => ({
      status: "ready" as const, session: new FakeSession(projectId),
    }))
    const manager = new ProjectTeamCollaborationManagerV2(factory({ joinTeam }))
    await manager.activateProject(projectOne)
    expect(() => manager.joinTeam({ projectId: projectTwo, invitation })).toThrow("stale")
    await expect(manager.joinTeam({ projectId: projectOne, invitation })).resolves.toEqual(
      expect.objectContaining({ projectId: projectOne, state: "online" }),
    )
    expect(joinTeam).toHaveBeenCalledWith(expect.objectContaining({ invitation, projectId: projectOne }))
    expect(() => manager.joinTeam({
      projectId: projectOne,
      invitation: { ...invitation, invitationToken: "not-a-token" },
    })).toThrow("token")
    expect(() => manager.joinTeam({
      projectId: projectOne,
      invitation: { ...invitation, projectId: projectTwo },
    })).toThrow("crossed")
    await manager.dispose()
  })

  test("returns the exact safe invitation from bootstrap without exposing authority", async () => {
    const manager = new ProjectTeamCollaborationManagerV2(factory())
    await manager.activateProject(projectOne)
    await expect(manager.bootstrapTeam(projectOne)).resolves.toEqual({
      invitation,
      status: expect.objectContaining({ projectId: projectOne, state: "online" }),
    })
    await manager.dispose()
  })

  test("forget and quit await the exact session quiescence barrier", async () => {
    let release!: () => void
    const session = new FakeSession(projectOne)
    session.quiesce.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    const manager = new ProjectTeamCollaborationManagerV2(factory({
      openExisting: async () => ({ status: "ready", session }),
    }))
    await manager.activateProject(projectOne)
    let completed = false
    const quiescing = manager.quiesceProject(projectOne).then(() => { completed = true })
    await waitFor(() => typeof release === "function")
    expect(completed).toBeFalse()
    release()
    await quiescing
    expect(manager.getStatus(projectOne).state).toBe("local-only")
    await manager.dispose()
  })
})

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  throw new Error("test condition was not reached")
}
