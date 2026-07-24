import { describe, expect, mock, test } from "bun:test"
import type { AgentRuntime, AgentSessionState } from "@convax/agent-runtime"
import type { ProjectRecord } from "@convax/project"

import { AgentActivityController, type AgentActivityClock } from "./agent-activity-controller"

class FakeClock implements AgentActivityClock {
  current = 10_000
  timers: Array<{ delay: number; handler: () => void }> = []

  clearTimeout(handle: unknown) {
    const index = this.timers.indexOf(handle as { delay: number; handler: () => void })
    if (index >= 0) this.timers.splice(index, 1)
  }

  now() {
    return this.current
  }

  setTimeout(handler: () => void, delay: number) {
    const timer = { delay, handler }
    this.timers.push(timer)
    return timer
  }

  async runNext() {
    const timer = this.timers.shift()
    if (!timer) throw new Error("No timer was scheduled")
    this.current += timer.delay
    timer.handler()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function project(id: string, name: string, updatedAt: number, missing = false): ProjectRecord {
  return {
    createdAt: 1,
    id,
    lastOpenedAt: updatedAt,
    ...(missing ? { missing: true } : {}),
    name,
    rootPath: `/private/${id}`,
  }
}

function state(
  projectId: string,
  sessionId: string,
  sessionName: string,
  updatedAt: number,
  overrides: Partial<AgentSessionState> = {},
): AgentSessionState {
  return {
    messages: [],
    pendingPermissions: [],
    pendingQuestions: [],
    session: {
      createdAt: updatedAt - 100,
      directory: `/private/${projectId}`,
      id: sessionId,
      title: sessionName,
      updatedAt,
    },
    status: { type: "idle" },
    ...overrides,
  }
}

function fixture(input: {
  clock?: FakeClock
  maxActivities?: number
  projects?: ProjectRecord[]
  states?: Record<string, AgentSessionState>
  watermarks?: {
    loadSeen(): Promise<Record<string, number>>
    markSeen(key: string, timestamp: number): Promise<void>
  }
}) {
  const clock = input.clock ?? new FakeClock()
  const projects = input.projects ?? [project("project-a", "Alpha", 100), project("project-b", "Beta", 200)]
  const states = input.states ?? {}
  const list = mock(async () => projects)
  const resolveEntryPath = mock(async ({ projectId }: { projectId: string }) => `/private/${projectId}`)
  const runtime = {
    getSessionState: mock(async ({ sessionId }: { sessionId: string }) => states[sessionId]!),
    listSessions: mock(async ({ directory }: { directory: string }) =>
      Object.values(states)
        .filter((item) => item.session.directory === directory)
        .map((item) => item.session),
    ),
  } as unknown as AgentRuntime
  let nextId = 0
  const controller = new AgentActivityController({
    clock,
    createId: () => `activity-${++nextId}`,
    ...(input.maxActivities === undefined ? {} : { maxActivities: input.maxActivities }),
    pollMs: 700,
    projects: { list, resolveEntryPath },
    runtime,
    ...(input.watermarks ? { watermarks: input.watermarks } : {}),
  })
  return { clock, controller, list, projects, resolveEntryPath, runtime, states }
}

describe("AgentActivityController", () => {
  test("recovers every project and publishes only sorted, content-free activity", async () => {
    const question = {
      id: "question-b",
      questions: [{ header: "Secret", options: [], question: "secret question" }],
      sessionID: "session-b",
    }
    const states = {
      "session-a": state("project-a", "session-a", "Alpha session", 300, { status: { type: "busy" } }),
      "session-b": state("project-b", "session-b", "Beta session", 400, { pendingQuestions: [question] }),
    }
    const { controller } = fixture({ states })

    await controller.start()
    expect(controller.getSnapshot().activities.map(({ projectId, state }) => [projectId, state])).toEqual([
      ["project-b", "needs-input"],
      ["project-a", "running"],
    ])
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("/private/")
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("secret question")
    const first = controller.getSnapshot().activities[0]!
    expect(controller.resolveActivity(first.id)).toEqual({ projectId: "project-b", sessionId: "session-b" })
    controller.stop()
  })

  test("uses recency within one priority and enforces the configured activity bound", async () => {
    const projects = [project("project-a", "Alpha", 100)]
    const states = {
      "session-a": state("project-a", "session-a", "A", 100, { status: { type: "busy" } }),
      "session-b": state("project-a", "session-b", "B", 300, { status: { type: "busy" } }),
      "session-c": state("project-a", "session-c", "C", 200, { status: { type: "busy" } }),
    }
    const { controller } = fixture({ maxActivities: 2, projects, states })

    await controller.start()
    expect(controller.getSnapshot().activities.map((item) => item.sessionId)).toEqual(["session-b", "session-c"])
    controller.stop()
  })

  test("marks only the current revision seen and clears canceled activity", async () => {
    const complete = {
      completedAt: 500,
      createdAt: 450,
      id: "message-a",
      parts: [{ id: "part-a", text: "secret response", type: "text" as const }],
      role: "assistant" as const,
      sessionId: "session-a",
    }
    const states = { "session-a": state("project-a", "session-a", "A", 500, { messages: [complete] }) }
    const watermarks = {
      loadSeen: mock(async () => ({})),
      markSeen: mock(async () => undefined),
    }
    const { controller } = fixture({ projects: [project("project-a", "Alpha", 100)], states, watermarks })

    await controller.start()
    const ready = controller.getSnapshot()
    await expect(controller.markSeen(ready.activities[0]!.id, ready.revision - 1)).rejects.toThrow("stale")
    await controller.markSeen(ready.activities[0]!.id, ready.revision)
    expect(watermarks.markSeen).toHaveBeenCalledWith("project-a\u0000session-a", 500)
    expect(controller.getSnapshot().activities).toEqual([])

    await controller.promptStarted("project-a", "session-a")
    expect(controller.getSnapshot().activities[0]?.state).toBe("running")
    await controller.aborted("project-a", "session-a")
    expect(controller.getSnapshot().activities).toEqual([])
    controller.stop()
  })

  test("marks a terminal session seen when its conversation is actually displayed", async () => {
    const complete = {
      completedAt: 500,
      createdAt: 450,
      id: "message-a",
      parts: [{ id: "part-a", text: "secret response", type: "text" as const }],
      role: "assistant" as const,
      sessionId: "session-a",
    }
    const states = { "session-a": state("project-a", "session-a", "A", 500, { messages: [complete] }) }
    const watermarks = {
      loadSeen: mock(async () => ({})),
      markSeen: mock(async () => undefined),
    }
    const { controller } = fixture({ projects: [project("project-a", "Alpha", 100)], states, watermarks })

    await controller.start()
    expect(controller.getSnapshot().activities[0]?.state).toBe("ready")
    await controller.markSessionDisplayed("project-a", "session-a")

    expect(watermarks.markSeen).toHaveBeenCalledWith("project-a\u0000session-a", 500)
    expect(controller.getSnapshot().activities).toEqual([])

    await controller.markSessionDisplayed("project-a", "missing")
    expect(watermarks.markSeen).toHaveBeenCalledTimes(1)
    controller.stop()
  })

  test("does not clear or watermark a visible non-terminal session", async () => {
    const states = {
      "session-a": state("project-a", "session-a", "A", 500, { status: { type: "busy" } }),
      "session-b": state("project-a", "session-b", "B", 600, {
        pendingQuestions: [{ id: "question-b", questions: [], sessionID: "session-b" }],
      }),
    }
    const watermarks = {
      loadSeen: mock(async () => ({})),
      markSeen: mock(async () => undefined),
    }
    const { controller } = fixture({ projects: [project("project-a", "Alpha", 100)], states, watermarks })

    await controller.start()
    await controller.markSessionDisplayed("project-a", "session-a")
    await controller.markSessionDisplayed("project-a", "session-b")

    expect(controller.getSnapshot().activities.map(({ sessionId, state }) => [sessionId, state])).toEqual([
      ["session-b", "needs-input"],
      ["session-a", "running"],
    ])
    expect(watermarks.markSeen).not.toHaveBeenCalled()
    controller.stop()
  })

  test("marks a blocked terminal activity seen", async () => {
    const failed = {
      completedAt: 500,
      createdAt: 450,
      error: "secret failure",
      id: "message-a",
      parts: [],
      role: "assistant" as const,
      sessionId: "session-a",
    }
    const states = { "session-a": state("project-a", "session-a", "A", 500, { messages: [failed] }) }
    const { controller } = fixture({ projects: [project("project-a", "Alpha", 100)], states })

    await controller.start()
    const blocked = controller.getSnapshot()
    expect(blocked.activities[0]?.state).toBe("blocked")
    await controller.markSeen(blocked.activities[0]!.id, blocked.revision)
    expect(controller.getSnapshot().activities).toEqual([])
    controller.stop()
  })

  test("rejects a slow refresh after a newer local mutation", async () => {
    const running = state("project-a", "session-a", "A", 500, { status: { type: "busy" } })
    const { controller, runtime } = fixture({
      projects: [project("project-a", "Alpha", 100)],
      states: { "session-a": running },
    })
    await controller.start()

    let release!: (value: AgentSessionState) => void
    let requestStarted!: () => void
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve
    })
    ;(runtime.getSessionState as ReturnType<typeof mock>).mockImplementationOnce(
      () =>
        new Promise<AgentSessionState>((resolve) => {
          release = resolve
          requestStarted()
        }),
    )
    const refresh = controller.refresh()
    await started
    await controller.promptStarted("project-a", "session-a")
    release(state("project-a", "session-a", "A", 400))
    await refresh

    expect(controller.getSnapshot().activities[0]?.state).toBe("running")
    controller.stop()
  })

  test("rejects an older poll response after a newer poll has completed", async () => {
    const initial = state("project-a", "session-a", "A", 500, { status: { type: "busy" } })
    const { controller, runtime } = fixture({
      projects: [project("project-a", "Alpha", 100)],
      states: { "session-a": initial },
    })
    await controller.start()

    let releaseOlder!: (value: AgentSessionState) => void
    let olderStarted!: () => void
    const started = new Promise<void>((resolve) => {
      olderStarted = resolve
    })
    const getSessionState = runtime.getSessionState as ReturnType<typeof mock>
    getSessionState.mockImplementationOnce(
      () =>
        new Promise<AgentSessionState>((resolve) => {
          releaseOlder = resolve
          olderStarted()
        }),
    )
    getSessionState.mockImplementationOnce(async () =>
      state("project-a", "session-a", "A", 700, {
        pendingQuestions: [{ id: "question", questions: [], sessionID: "session-a" }],
      }),
    )

    const older = controller.refresh()
    await started
    await controller.refresh()
    releaseOlder(state("project-a", "session-a", "A", 600))
    await older

    expect(controller.getSnapshot().activities[0]).toMatchObject({ state: "needs-input", updatedAt: 700 })
    controller.stop()
  })

  test("bounds recurring recovery state requests after the initial scan", async () => {
    const states = Object.fromEntries(
      Array.from({ length: 24 }, (_, index) => {
        const id = `session-${index}`
        return [id, state("project-a", id, id, 1_000 - index)]
      }),
    )
    const { controller, runtime } = fixture({ projects: [project("project-a", "Alpha", 100)], states })

    await controller.start()
    const getSessionState = runtime.getSessionState as ReturnType<typeof mock>
    expect(getSessionState).toHaveBeenCalledTimes(24)
    getSessionState.mockClear()
    await controller.refresh()
    expect(getSessionState.mock.calls.length).toBeLessThanOrEqual(16)
    controller.stop()
  })

  test("selects recurring recovery candidates globally across projects", async () => {
    const states = Object.fromEntries([
      ...Array.from({ length: 20 }, (_, index) => {
        const id = `session-a-${index}`
        return [id, state("project-a", id, id, 2_000 - index, { status: { type: "busy" } })] as const
      }),
      [
        "session-b",
        state("project-b", "session-b", "B", 100, {
          pendingQuestions: [{ id: "question-b", questions: [], sessionID: "session-b" }],
        }),
      ] as const,
    ])
    const { controller, runtime } = fixture({
      projects: [project("project-a", "Alpha", 200), project("project-b", "Beta", 100)],
      states,
    })

    await controller.start()
    const getSessionState = runtime.getSessionState as ReturnType<typeof mock>
    getSessionState.mockClear()
    await controller.refresh()

    expect(getSessionState.mock.calls.map(([input]) => input.sessionId)).toContain("session-b")
    expect(getSessionState.mock.calls.length).toBeLessThanOrEqual(16)
    controller.stop()
  })

  test("loads persisted read watermarks before the first activity projection", async () => {
    const complete = {
      completedAt: 500,
      createdAt: 450,
      id: "message-a",
      parts: [{ id: "part-a", text: "done", type: "text" as const }],
      role: "assistant" as const,
      sessionId: "session-a",
    }
    const states = { "session-a": state("project-a", "session-a", "A", 500, { messages: [complete] }) }
    const { controller } = fixture({
      projects: [project("project-a", "Alpha", 100)],
      states,
      watermarks: {
        loadSeen: mock(async () => ({ "project-a\u0000session-a": 500 })),
        markSeen: mock(async () => undefined),
      },
    })

    await controller.start()
    expect(controller.getSnapshot().activities).toEqual([])
    controller.stop()
  })

  test("skips missing projects and backs off after a runtime failure", async () => {
    const clock = new FakeClock()
    const states = {
      "session-a": state("project-a", "session-a", "A", 100, {
        status: { type: "retry", attempt: 1, message: "secret", next: 1 },
      }),
    }
    const fixtureValue = fixture({
      clock,
      projects: [project("project-a", "Alpha", 100), project("project-missing", "Missing", 200, true)],
      states,
    })
    const listSessions = fixtureValue.runtime.listSessions as ReturnType<typeof mock>
    listSessions.mockRejectedValueOnce(new Error("runtime unavailable"))

    await fixtureValue.controller.start()
    expect(fixtureValue.resolveEntryPath).not.toHaveBeenCalledWith({ projectId: "project-missing" })
    expect(clock.timers[0]?.delay).toBe(1_400)

    await clock.runNext()
    expect(fixtureValue.controller.getSnapshot().activities).toEqual([
      expect.objectContaining({ projectId: "project-a", state: "running" }),
    ])
    expect(clock.timers[0]?.delay).toBe(700)
    fixtureValue.controller.stop()
  })
})
