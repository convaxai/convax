import type { AgentMessagePart, AgentToolState } from "@convax/agent-runtime"
import { describe, expect, test } from "bun:test"
import { getAgentToolPresentation } from "./agent-tool-presentation"

type AgentToolPart = Extract<AgentMessagePart, { type: "tool" }>

function toolPart(tool: string, state: AgentToolState): AgentToolPart {
  return { callId: "call-1", id: "part-1", state, tool, type: "tool" }
}

function completed(output: string, tool = "example"): AgentToolPart {
  return toolPart(tool, { input: {}, output, status: "completed", title: tool })
}

describe("Agent tool presentation", () => {
  test("preserves pending and running presentation states", () => {
    expect(getAgentToolPresentation(toolPart("example", { input: {}, status: "pending" }))).toEqual({
      outcome: "pending",
    })
    expect(getAgentToolPresentation(toolPart("example", { input: {}, status: "running" }))).toEqual({
      outcome: "running",
    })
  })

  test("presents OpenCode errors as failures", () => {
    expect(
      getAgentToolPresentation(
        toolPart("example", {
          error: "Execution failed",
          input: {},
          status: "error",
        }),
      ),
    ).toEqual({ detail: "Execution failed", outcome: "failure" })
  })

  test("presents an interrupted OpenCode error as cancelled without parsing its text", () => {
    const part = toolPart("example", {
      error: "Any host-safe terminal detail",
      input: {},
      status: "error",
    })

    expect(getAgentToolPresentation(part, { interrupted: true })).toEqual({
      detail: "Any host-safe terminal detail",
      outcome: "cancelled",
    })
  })

  test("presents OpenCode's completed invalid tool as a failure", () => {
    expect(getAgentToolPresentation(completed("The requested tool is unavailable", "invalid"))).toEqual({
      detail: "The requested tool is unavailable",
      outcome: "failure",
    })
  })

  test("presents an explicit top-level JSON failure envelope as a failure", () => {
    const output = '  {"ok":false,"code":"TOOL_ERROR","message":"Execution failed"}\n'
    expect(getAgentToolPresentation(completed(output))).toEqual({ detail: output, outcome: "failure" })
  })

  test("does not infer failures from successful, nested, malformed, or plain-text output", () => {
    const outputs = [
      '{"ok":true}',
      '{"data":{"ok":false}}',
      '{"ok":',
      'The tool returned {"ok":false}',
      '[{"ok":false}]',
    ]

    for (const output of outputs) {
      expect(getAgentToolPresentation(completed(output))).toEqual({ detail: output, outcome: "success" })
    }
  })
})
