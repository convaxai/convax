import { describe, expect, test } from "bun:test"

import type { AgentSessionState } from "../src/contracts"
import { compareAgentActivity, projectAgentActivity } from "../src/activity"

function sessionState(overrides: Partial<AgentSessionState> = {}): AgentSessionState {
  return {
    messages: [],
    pendingPermissions: [],
    pendingQuestions: [],
    session: {
      createdAt: 100,
      directory: "/private/project-alpha",
      id: "session-alpha",
      title: "Private session title",
      updatedAt: 200,
    },
    status: { type: "idle" },
    ...overrides,
  }
}

function assistantMessage(overrides: Record<string, unknown> = {}) {
  return {
    completedAt: 300,
    createdAt: 250,
    id: "message-alpha",
    parts: [{ id: "part-alpha", text: "secret response", type: "text" as const }],
    role: "assistant" as const,
    sessionId: "session-alpha",
    ...overrides,
  }
}

describe("content-free Agent activity projection", () => {
  test("projects pending questions and permissions without their content", () => {
    const question = {
      id: "question-alpha",
      questions: [{ header: "Secret", options: [], question: "secret question" }],
      sessionID: "session-alpha",
    }
    const permission = {
      always: [],
      id: "permission-alpha",
      metadata: { file: "/private/secret" },
      patterns: ["secret-pattern"],
      permission: "secret permission",
      sessionID: "session-alpha",
    }

    expect(projectAgentActivity(sessionState({ pendingQuestions: [question] }))).toEqual({
      input: "question",
      state: "needs-input",
    })
    expect(projectAgentActivity(sessionState({ pendingPermissions: [permission] }))).toEqual({
      input: "permission",
      state: "needs-input",
    })
    expect(JSON.stringify(projectAgentActivity(sessionState({ pendingQuestions: [question] })))).not.toContain(
      "secret",
    )
  })

  test("maps busy and retry status to running without retry diagnostics", () => {
    expect(projectAgentActivity(sessionState({ status: { type: "busy" } }))).toEqual({ state: "running" })
    const projected = projectAgentActivity(
      sessionState({ status: { attempt: 2, message: "secret retry", next: 500, type: "retry" } }),
    )
    expect(projected).toEqual({ state: "running" })
    expect(JSON.stringify(projected)).not.toContain("secret")
  })

  test("projects terminal failure and unseen success without message content", () => {
    const failed = projectAgentActivity(
      sessionState({ messages: [assistantMessage({ error: "secret error", parts: [] })] }),
    )
    expect(failed).toEqual({ state: "blocked" })
    expect(JSON.stringify(failed)).not.toContain("secret")

    expect(projectAgentActivity(sessionState({ messages: [assistantMessage()] }), { seenAfter: 299 })).toEqual({
      state: "ready",
    })
    expect(projectAgentActivity(sessionState({ messages: [assistantMessage()] }), { seenAfter: 300 })).toEqual({
      state: "idle",
    })
  })

  test("lets explicit cancellation clear a recovered session", () => {
    expect(
      projectAgentActivity(sessionState({ messages: [assistantMessage({ error: "secret error" })] }), {
        canceled: true,
      }),
    ).toEqual({ state: "idle" })
  })

  test("orders activity using the documented cross-session priority", () => {
    const states = [
      { state: "idle" as const },
      { state: "running" as const },
      { state: "ready" as const },
      { state: "blocked" as const },
      { input: "question" as const, state: "needs-input" as const },
    ]

    expect(states.sort(compareAgentActivity).map((item) => item.state)).toEqual([
      "needs-input",
      "blocked",
      "ready",
      "running",
      "idle",
    ])
  })
})
