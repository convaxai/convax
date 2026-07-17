import type { AgentMessage, AgentMessagePart, AgentToolState } from "@convax/agent-runtime"
import { describe, expect, test } from "bun:test"
import { buildAgentConversationTurns } from "./agent-conversation-presentation"

function message(id: string, role: AgentMessage["role"], parts: AgentMessagePart[] = [], error?: string): AgentMessage {
  return {
    createdAt: Number(id.replace(/\D/g, "")) || 1,
    error,
    id,
    parts,
    role,
    sessionId: "session-1",
  }
}

function text(id: string, value: string, synthetic = false): AgentMessagePart {
  return { id, synthetic, text: value, type: "text" }
}

function file(id: string): AgentMessagePart {
  return { filename: `${id}.md`, id, mime: "text/markdown", type: "file", url: `file:///${id}.md` }
}

function reasoning(id: string): AgentMessagePart {
  return { id, text: `Reasoning ${id}`, type: "reasoning" }
}

function tool(id: string, state: AgentToolState): AgentMessagePart {
  return { callId: `call-${id}`, id, state, tool: `tool-${id}`, type: "tool" }
}

describe("Agent conversation presentation", () => {
  test("groups assistants with their user and separates the final delivery from activity", () => {
    const skill = { id: "user-skill", name: "review", type: "skill" } as AgentMessagePart
    const user = message("user-1", "user", [
      text("user-text", "Review this change"),
      text("user-instruction", "Hidden host instruction", true),
      skill,
    ])
    const firstAssistant = message("assistant-1", "assistant", [
      reasoning("reasoning-1"),
      tool("tool-1", { input: {}, output: "ok", status: "completed", title: "Read" }),
      text("intermediate-text", "I will inspect it."),
    ])
    const finalAssistant = message("assistant-2", "assistant", [
      reasoning("reasoning-2"),
      tool("tool-2", { input: {}, output: "saved", status: "completed", title: "Write" }),
      text("final-text", "The change is ready."),
      file("delivery-file"),
    ])

    const turns = buildAgentConversationTurns([user, firstAssistant, finalAssistant])

    expect(turns).toHaveLength(1)
    expect(turns[0]?.id).toBe("user-1")
    expect(turns[0]?.user?.message).toBe(user)
    expect(turns[0]?.user?.parts.map((part) => part.id)).toEqual(["user-text", "user-skill"])
    expect(turns[0]?.delivery?.message).toBe(finalAssistant)
    expect(turns[0]?.delivery?.parts.map((part) => part.id)).toEqual(["final-text", "delivery-file"])
    expect(
      turns[0]?.activity.map((entry) => ({
        message: entry.message.id,
        parts: entry.parts.map((part) => part.id),
      })),
    ).toEqual([
      { message: "assistant-1", parts: ["reasoning-1", "tool-1", "intermediate-text"] },
      { message: "assistant-2", parts: ["reasoning-2", "tool-2"] },
    ])
    expect(turns[0]?.tools).toEqual({
      count: 2,
      failed: 0,
      outcome: "success",
      pending: 0,
      running: 0,
      succeeded: 2,
    })
  })

  test("keeps a selected Skill visible in the user message instead of activity", () => {
    const skill = { id: "skill-1", name: "release", type: "skill" } as AgentMessagePart
    const [turn] = buildAgentConversationTurns([
      message("user-1", "user", [skill]),
      message("assistant-1", "assistant", [reasoning("reasoning-1")]),
    ])

    expect(turn?.user?.parts).toEqual([skill])
    expect(turn?.activity.flatMap((entry) => entry.parts)).not.toContain(skill)
    expect(turn?.delivery).toBeUndefined()
  })

  test("uses an assistant error as the final delivery and exposes every error outside activity", () => {
    const earlierError = message("assistant-1", "assistant", [reasoning("reasoning-1")], "First attempt failed")
    const finalError = message("assistant-2", "assistant", [reasoning("reasoning-2")], "Request failed")
    const [turn] = buildAgentConversationTurns([
      message("user-1", "user", [text("user-text", "Try it")]),
      earlierError,
      finalError,
    ])

    expect(turn?.delivery).toEqual({ message: finalError, parts: [] })
    expect(turn?.errors.map((entry) => ({ message: entry.message.id, text: entry.text }))).toEqual([
      { message: "assistant-1", text: "First attempt failed" },
      { message: "assistant-2", text: "Request failed" },
    ])
  })

  test("retains an earlier error when a later assistant provides a successful delivery", () => {
    const errored = message("assistant-1", "assistant", [], "Transient failure")
    const delivered = message("assistant-2", "assistant", [text("final-text", "Recovered")])
    const [turn] = buildAgentConversationTurns([
      message("user-1", "user", [text("user-text", "Continue")]),
      errored,
      delivered,
    ])

    expect(turn?.delivery?.message).toBe(delivered)
    expect(turn?.errors).toEqual([{ message: errored, text: "Transient failure" }])
    expect(turn?.activity[0]?.message).toBe(errored)
  })

  test("summarizes pending, running, successful, and failed tools", () => {
    const [turn] = buildAgentConversationTurns([
      message("user-1", "user", [text("user-text", "Run tools")]),
      message("assistant-1", "assistant", [
        tool("pending", { input: {}, status: "pending" }),
        tool("running", { input: {}, status: "running", title: "Running" }),
        tool("success", { input: {}, output: "ok", status: "completed", title: "Success" }),
        tool("explicit-failure", {
          input: {},
          output: '{"ok":false,"message":"failed"}',
          status: "completed",
          title: "Failure",
        }),
        tool("error", { error: "crashed", input: {}, status: "error" }),
      ]),
    ])

    expect(turn?.tools).toEqual({
      count: 5,
      failed: 2,
      outcome: "running",
      pending: 1,
      running: 1,
      succeeded: 1,
    })
  })

  test("preserves ordered orphan and user-only turns without inventing a delivery", () => {
    const orphan = message("assistant-0", "assistant", [text("orphan-text", "Restored response")])
    const toolOnly = message("assistant-1", "assistant", [reasoning("reasoning-1")])
    const messages = [
      orphan,
      message("user-1", "user", [text("user-text-1", "First")]),
      toolOnly,
      message("user-2", "user", [text("user-text-2", "Second")]),
    ]

    const turns = buildAgentConversationTurns(messages)

    expect(turns.map((turn) => turn.id)).toEqual(["assistant-0", "user-1", "user-2"])
    expect(turns[0]?.user).toBeUndefined()
    expect(turns[0]?.delivery?.message).toBe(orphan)
    expect(turns[1]?.delivery).toBeUndefined()
    expect(turns[1]?.activity).toEqual([{ message: toolOnly, parts: toolOnly.parts }])
    expect(turns[2]?.user?.message.id).toBe("user-2")
    expect(turns[2]?.activity).toEqual([])
  })

  test("does not treat blank or synthetic assistant text as a delivery", () => {
    const synthetic = message("assistant-1", "assistant", [
      text("blank", "   "),
      text("synthetic", "Internal instruction", true),
    ])
    const [turn] = buildAgentConversationTurns([message("user-1", "user", [text("user-text", "Hello")]), synthetic])

    expect(turn?.delivery).toBeUndefined()
    expect(turn?.activity).toEqual([{ message: synthetic, parts: synthetic.parts }])
    expect(turn?.tools.outcome).toBe("none")
  })

  test("marks a persisted activity-only assistant without completedAt as interrupted", () => {
    const interrupted = message("assistant-1", "assistant", [
      tool("failed", { error: "interrupted", input: {}, status: "error" }),
    ])
    const completed = { ...interrupted, completedAt: 2 }

    expect(
      buildAgentConversationTurns([message("user-1", "user", [text("user-text", "Try it")]), interrupted])[0]
        ?.interrupted,
    ).toBeTrue()
    expect(
      buildAgentConversationTurns([message("user-1", "user", [text("user-text", "Try it")]), completed])[0]
        ?.interrupted,
    ).toBeFalse()
  })
})
