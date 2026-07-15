import { describe, expect, test } from "bun:test"
import type { AgentToolScope } from "../src/contracts"
import { AgentLocalToolServer } from "../src/node/local-tool-server"

async function rpc(url: string, headers: Record<string, string>, body: Record<string, unknown>) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { ...headers, Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
    method: "POST",
  })
  return { response, value: await response.json() as Record<string, unknown> }
}

describe("AgentLocalToolServer", () => {
  test("exposes authenticated MCP tools inside one opaque project scope", async () => {
    const calls: Array<{ input: Record<string, unknown>; name: string; scope: AgentToolScope }> = []
    const server = new AgentLocalToolServer({
      async callTool(scope, name, input) {
        calls.push({ input, name, scope })
        return { echoed: input.value, project: scope.scopeId }
      },
      listTools: () => [{
        description: "Echo a value",
        inputSchema: {
          additionalProperties: false,
          properties: { value: { type: "string" } },
          required: ["value"],
          type: "object",
        },
        name: "canvas_echo",
      }],
    })
    const registration = await server.registerScope({ directory: "/project/a", scopeId: "project-a" })

    try {
      const unauthorized = await fetch(registration.url, {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
      expect(unauthorized.status).toBe(401)

      const initialized = await rpc(registration.url, registration.headers, {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      })
      expect(initialized.response.status).toBe(200)
      expect(initialized.value).toMatchObject({ result: { capabilities: { tools: {} }, protocolVersion: "2025-03-26" } })

      const listed = await rpc(registration.url, registration.headers, {
        id: 2,
        jsonrpc: "2.0",
        method: "tools/list",
        params: {},
      })
      expect(listed.value).toMatchObject({ result: { tools: [{ name: "canvas_echo" }] } })

      const called = await rpc(registration.url, registration.headers, {
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: { value: "hello" }, name: "canvas_echo" },
      })
      const result = called.value.result as { content: Array<{ text: string }> }
      expect(JSON.parse(result.content[0]!.text)).toEqual({ echoed: "hello", project: "project-a" })
      expect(calls).toEqual([{
        input: { value: "hello" },
        name: "canvas_echo",
        scope: { directory: "/project/a", scopeId: "project-a" },
      }])
    } finally {
      await server.close()
    }
  })
})
