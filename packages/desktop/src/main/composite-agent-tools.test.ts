import { describe, expect, mock, test } from "bun:test"
import type { AgentToolProvider } from "@convax/agent-runtime"

import { createCompositeAgentToolProvider } from "./composite-agent-tools"

describe("composite Agent tools", () => {
  test("forwards transport cancellation context to the selected provider", async () => {
    const callTool = mock(async () => ({ ok: true }))
    const provider: AgentToolProvider = {
      callTool,
      listTools: () => [{ description: "Run", inputSchema: {}, name: "run" }],
    }
    const composite = createCompositeAgentToolProvider([provider])
    const scope = { directory: "/project", scopeId: "project-one" }
    const input = { value: 1 }
    const controller = new AbortController()
    const context = { signal: controller.signal }

    await expect(composite.callTool(scope, "run", input, context)).resolves.toEqual({ ok: true })
    expect(callTool).toHaveBeenCalledWith(scope, "run", input, context)
  })
})
